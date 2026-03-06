#!/usr/bin/env node
/**
 * Force Full Refresh of All Deals
 * 
 * Triggers the full pipeline (including expanded filing types: DEF 14A, Form 4,
 * 13F-HR, S-1, 40-F, 6-K, F-1, and earnings transcripts) for every deal in the DB.
 * 
 * Usage:
 *   node scripts/force-refresh-all-deals.js                    # List deals + coverage
 *   node scripts/force-refresh-all-deals.js --execute          # Actually trigger pipelines
 *   node scripts/force-refresh-all-deals.js --ticker SHOP      # Single ticker only
 *   node scripts/force-refresh-all-deals.js --coverage         # Show detailed coverage
 *   node scripts/force-refresh-all-deals.js --test-rag NVDA    # Test RAG queries after refresh
 */

const { Client } = require('pg');
const https = require('https');
const crypto = require('crypto');

const DB_URL = process.env.DATABASE_URL || 
  'postgresql://fundlens_admin:FundLens2025SecureDB@fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db';
const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const API_HOST = 'app.fundlens.ai';

// Cognito auth config
const COGNITO_REGION = 'us-east-1';
const COGNITO_CLIENT_ID = '4s4k1usimlqkr6sk55gbva183s';
const COGNITO_CLIENT_SECRET = 'f52bpc2kg5j6dqua46d14o9bj5o796bakn4mnguiu9b1qusn8nh';
const COGNITO_USERNAME = '64981488-7091-7071-7150-459f03b52886';
const COGNITO_PASSWORD = 'FundLens2024!';

let cachedIdToken = null;

async function getIdToken() {
  if (cachedIdToken) return cachedIdToken;
  
  console.log('🔐 Authenticating with Cognito...');
  
  const secretHash = crypto
    .createHmac('sha256', COGNITO_CLIENT_SECRET)
    .update(COGNITO_USERNAME + COGNITO_CLIENT_ID)
    .digest('base64');
  
  const body = JSON.stringify({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: {
      USERNAME: COGNITO_USERNAME,
      PASSWORD: COGNITO_PASSWORD,
      SECRET_HASH: secretHash,
    },
  });
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: `cognito-idp.${COGNITO_REGION}.amazonaws.com`,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.AuthenticationResult?.IdToken) {
            cachedIdToken = parsed.AuthenticationResult.IdToken;
            console.log('✅ Cognito auth successful');
            resolve(cachedIdToken);
          } else {
            reject(new Error(`Cognito auth failed: ${data.substring(0, 200)}`));
          }
        } catch (e) {
          reject(new Error(`Cognito parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getClient() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function listDeals(client) {
  const result = await client.query(`
    SELECT id, ticker, company_name, status, deal_type, years,
           created_at, updated_at
    FROM deals 
    WHERE tenant_id = $1 AND ticker IS NOT NULL
    ORDER BY ticker
  `, [TENANT_ID]);
  return result.rows;
}

async function getDetailedCoverage(client, ticker) {
  const upper = ticker.toUpperCase();
  
  // Filing metadata counts
  const filings = await client.query(`
    SELECT filing_type, COUNT(*)::int as count, MAX(filing_date)::text as latest
    FROM filing_metadata WHERE ticker = $1 AND processed = true
    GROUP BY filing_type ORDER BY filing_type
  `, [upper]);

  // Narrative chunk counts by filing type
  const chunks = await client.query(`
    SELECT filing_type, COUNT(*)::int as count
    FROM narrative_chunks WHERE ticker = $1
    GROUP BY filing_type ORDER BY filing_type
  `, [upper]);

  // Metrics count
  const metrics = await client.query(`
    SELECT COUNT(*)::int as count FROM financial_metrics WHERE ticker = $1
  `, [upper]);

  // Insider transactions
  let insiderCount = 0;
  try {
    const insider = await client.query(`
      SELECT COUNT(*)::int as count FROM insider_transactions WHERE ticker = $1
    `, [upper]);
    insiderCount = insider.rows[0]?.count || 0;
  } catch { /* table may not exist */ }

  // Institutional holdings
  let holdingsCount = 0;
  try {
    const holdings = await client.query(`
      SELECT COUNT(*)::int as count FROM institutional_holdings WHERE ticker = $1
    `, [upper]);
    holdingsCount = holdings.rows[0]?.count || 0;
  } catch { /* table may not exist */ }

  // IR page mapping
  let irMapping = null;
  try {
    const ir = await client.query(`
      SELECT ticker, ir_base_url, confidence, last_verified
      FROM ir_page_mappings WHERE ticker = $1
    `, [upper]);
    irMapping = ir.rows[0] || null;
  } catch { /* table may not exist */ }

  return {
    ticker: upper,
    filings: filings.rows,
    chunks: chunks.rows,
    metricsCount: metrics.rows[0]?.count || 0,
    insiderCount,
    holdingsCount,
    irMapping,
  };
}

function printCoverage(cov) {
  console.log(`\n📊 ${cov.ticker} Data Coverage:`);
  
  const allTypes = ['10-K', '10-Q', '8-K', 'DEF 14A', '4', '13F-HR', 'S-1', '40-F', '6-K', 'F-1', 'EARNINGS'];
  const filingMap = {};
  for (const f of cov.filings) filingMap[f.filing_type] = f;
  const chunkMap = {};
  for (const c of cov.chunks) chunkMap[c.filing_type] = c;

  for (const type of allTypes) {
    const f = filingMap[type];
    const c = chunkMap[type];
    const status = f ? `${f.count} filings (latest: ${f.latest?.split('T')[0] || 'n/a'})` : '—';
    const chunkStr = c ? `, ${c.count} chunks` : '';
    const icon = f ? '✅' : '❌';
    console.log(`  ${icon} ${type.padEnd(10)} ${status}${chunkStr}`);
  }

  console.log(`  📈 Metrics: ${cov.metricsCount}`);
  console.log(`  👤 Insider Transactions: ${cov.insiderCount}`);
  console.log(`  🏦 Institutional Holdings: ${cov.holdingsCount}`);
  if (cov.irMapping) {
    console.log(`  🌐 IR Page: ${cov.irMapping.ir_base_url} (confidence: ${cov.irMapping.confidence})`);
  } else {
    console.log(`  🌐 IR Page: not mapped`);
  }
}

async function resetDealForRefresh(client, dealId) {
  // Reset deal status to 'ready' so the controller doesn't think it's already processing
  // The startPipeline method will set it to 'processing' itself
  await client.query(`
    UPDATE deals SET status = 'ready', updated_at = NOW() WHERE id = $1::uuid
  `, [dealId]);
}

function triggerPipeline(dealId, idToken) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({});
    const req = https.request({
      hostname: API_HOST,
      path: `/api/deals/${dealId}/analyze`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, data: parsed });
        } catch {
          resolve({ statusCode: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

// ─── RAG Test Queries ────────────────────────────────────────────────

const RAG_TEST_QUERIES = [
  // Standard 10-K/10-Q queries (should already work)
  { q: 'What are the main risk factors?', category: '10-K Basics' },
  { q: 'What is the revenue trend over the last 3 years?', category: '10-K Metrics' },
  // DEF 14A queries
  { q: 'What is the CEO total compensation?', category: 'Proxy (DEF 14A)' },
  { q: 'What is the CEO-to-median-employee pay ratio?', category: 'Proxy (DEF 14A)' },
  { q: 'Are there any related-party transactions?', category: 'Proxy (DEF 14A)' },
  // Form 4 queries
  { q: 'Has any insider been selling shares recently?', category: 'Insider (Form 4)' },
  { q: 'What is the insider buying vs selling pattern?', category: 'Insider (Form 4)' },
  // 13F queries
  { q: 'Who are the largest institutional holders?', category: 'Holdings (13F)' },
  // Earnings transcript queries
  { q: 'What did the CEO say about growth outlook on the last earnings call?', category: 'Earnings Transcript' },
  { q: 'How has management tone changed over recent earnings calls?', category: 'Earnings Transcript' },
  // Cross-source queries (the FundLens moat)
  { q: 'What should worry me most about this investment?', category: 'Cross-Source Analysis' },
  { q: 'Is there a divergence between what management says and what insiders are doing?', category: 'Cross-Source Analysis' },
];

async function testRagQueries(ticker) {
  const idToken = await getIdToken();
  console.log(`\n🧪 Testing RAG queries for ${ticker}...`);
  console.log('─'.repeat(80));

  for (const test of RAG_TEST_QUERIES) {
    try {
      const result = await new Promise((resolve, reject) => {
        const body = JSON.stringify({
          message: `For ${ticker}: ${test.q}`,
          dealId: null, // Will be resolved by the API
        });
        const req = https.request({
          hostname: API_HOST,
          path: '/api/research/chat',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
            'Content-Length': Buffer.byteLength(body),
          },
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try { resolve({ statusCode: res.statusCode, data: JSON.parse(data) }); }
            catch { resolve({ statusCode: res.statusCode, data }); }
          });
        });
        req.on('error', reject);
        req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(body);
        req.end();
      });

      const hasContent = result.data?.response?.length > 50;
      const citations = result.data?.citations?.length || 0;
      const icon = hasContent ? '✅' : '⚠️';
      const preview = typeof result.data?.response === 'string' 
        ? result.data.response.substring(0, 120).replace(/\n/g, ' ')
        : '(no response)';
      
      console.log(`  ${icon} [${test.category}] ${test.q}`);
      console.log(`     → ${preview}...`);
      console.log(`     → ${citations} citations, HTTP ${result.statusCode}`);
    } catch (error) {
      console.log(`  ❌ [${test.category}] ${test.q}`);
      console.log(`     → Error: ${error.message}`);
    }
    
    // Small delay between queries
    await new Promise(r => setTimeout(r, 2000));
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const coverageOnly = args.includes('--coverage');
  const tickerIdx = args.indexOf('--ticker');
  const singleTicker = tickerIdx >= 0 ? args[tickerIdx + 1]?.toUpperCase() : null;
  const testRagIdx = args.indexOf('--test-rag');
  const testRagTicker = testRagIdx >= 0 ? args[testRagIdx + 1]?.toUpperCase() : null;

  const client = await getClient();

  try {
    // If just testing RAG
    if (testRagTicker) {
      const cov = await getDetailedCoverage(client, testRagTicker);
      printCoverage(cov);
      await testRagQueries(testRagTicker);
      return;
    }

    // List all deals
    const deals = await listDeals(client);
    console.log(`\n📋 Found ${deals.length} deals with tickers:\n`);
    for (const d of deals) {
      console.log(`  ${d.ticker?.padEnd(8) || '(none)'} ${d.company_name?.padEnd(30) || ''} status=${d.status} id=${d.id}`);
    }

    // Filter to single ticker if specified
    const targetDeals = singleTicker 
      ? deals.filter(d => d.ticker?.toUpperCase() === singleTicker)
      : deals.filter(d => d.ticker);

    if (singleTicker && targetDeals.length === 0) {
      console.log(`\n❌ No deal found for ticker: ${singleTicker}`);
      return;
    }

    // Show coverage for each deal
    console.log('\n' + '═'.repeat(80));
    console.log('DATA COVERAGE BEFORE REFRESH');
    console.log('═'.repeat(80));

    for (const deal of targetDeals) {
      const cov = await getDetailedCoverage(client, deal.ticker);
      printCoverage(cov);
    }

    if (coverageOnly) return;

    if (!execute) {
      console.log('\n' + '═'.repeat(80));
      console.log('DRY RUN — Add --execute to actually trigger pipelines');
      console.log('═'.repeat(80));
      console.log(`\nWould trigger full pipeline refresh for ${targetDeals.length} deals:`);
      for (const d of targetDeals) {
        console.log(`  🔄 ${d.ticker} (${d.company_name})`);
      }
      console.log(`\nThis will re-download and re-parse ALL filing types including:`);
      console.log(`  10-K, 10-Q, 8-K, DEF 14A, Form 4, S-1, 40-F, 6-K, F-1`);
      console.log(`  + Agentic earnings transcript acquisition`);
      console.log(`\nRun: node scripts/force-refresh-all-deals.js --execute`);
      return;
    }

    // Execute pipeline refresh
    console.log('\n' + '═'.repeat(80));
    console.log('EXECUTING FULL PIPELINE REFRESH');
    console.log('═'.repeat(80));

    const idToken = await getIdToken();

    for (const deal of targetDeals) {
      console.log(`\n🔄 Refreshing ${deal.ticker} (${deal.company_name})...`);
      
      // Reset deal status so pipeline can re-run
      await resetDealForRefresh(client, deal.id);
      console.log(`  ✅ Reset deal status to 'processing'`);

      // Trigger pipeline via API
      try {
        const result = await triggerPipeline(deal.id, idToken);
        console.log(`  ✅ Pipeline triggered (HTTP ${result.statusCode})`);
        if (result.data?.pipelineId) {
          console.log(`  📋 Pipeline ID: ${result.data.pipelineId}`);
        }
      } catch (error) {
        console.log(`  ❌ Pipeline trigger failed: ${error.message}`);
      }

      // Wait between deals to avoid overwhelming the system
      if (targetDeals.indexOf(deal) < targetDeals.length - 1) {
        console.log(`  ⏳ Waiting 10s before next deal...`);
        await new Promise(r => setTimeout(r, 10000));
      }
    }

    console.log('\n' + '═'.repeat(80));
    console.log('REFRESH TRIGGERED');
    console.log('═'.repeat(80));
    console.log(`\nPipelines are running in the background on ECS.`);
    console.log(`Monitor progress at: https://app.fundlens.ai`);
    console.log(`\nAfter pipelines complete, check coverage:`);
    console.log(`  node scripts/force-refresh-all-deals.js --coverage`);
    console.log(`\nThen test RAG with expanded data:`);
    for (const d of targetDeals) {
      console.log(`  node scripts/force-refresh-all-deals.js --test-rag ${d.ticker}`);
    }

  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
