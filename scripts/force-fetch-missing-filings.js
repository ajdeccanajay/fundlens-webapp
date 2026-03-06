#!/usr/bin/env node
/**
 * Force-Fetch Missing Filings
 * 
 * Diagnoses which tickers have missing filing types or insufficient historical depth,
 * then triggers pipeline re-runs for those tickers via the production API.
 * 
 * Usage:
 *   node scripts/force-fetch-missing-filings.js                # Diagnose only (dry run)
 *   node scripts/force-fetch-missing-filings.js --execute      # Actually trigger pipelines
 *   node scripts/force-fetch-missing-filings.js --ticker AAPL  # Single ticker only
 */

const { Client } = require('pg');
const https = require('https');
const crypto = require('crypto');

const DB_URL = 'postgresql://fundlens_admin:FundLens2025SecureDB@fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db';
const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const API_HOST = 'app.fundlens.ai';

const COGNITO_REGION = 'us-east-1';
const COGNITO_CLIENT_ID = '4s4k1usimlqkr6sk55gbva183s';
const COGNITO_CLIENT_SECRET = 'f52bpc2kg5j6dqua46d14o9bj5o796bakn4mnguiu9b1qusn8nh';
const COGNITO_USERNAME = '64981488-7091-7071-7150-459f03b52886';
const COGNITO_PASSWORD = 'FundLens2024!';

let cachedIdToken = null;

// Expected minimum coverage per filing type
// Foreign filers (40-F) substitute for 10-K
const EXPECTED_COVERAGE = {
  '10-K': { minYears: 3, minChunks: 50, label: 'Annual Report' },
  '10-Q': { minYears: 2, minChunks: 20, label: 'Quarterly Report' },
  '8-K':  { minYears: 1, minChunks: 5, label: 'Current Report' },
  'DEF 14A': { minYears: 2, minChunks: 30, label: 'Proxy Statement' },
};

// Tickers known to be foreign filers (file 40-F instead of 10-K)
const FOREIGN_FILERS = ['SHOP'];

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function getIdToken() {
  if (cachedIdToken) return cachedIdToken;
  log('Authenticating with Cognito...');
  const secretHash = crypto
    .createHmac('sha256', COGNITO_CLIENT_SECRET)
    .update(COGNITO_USERNAME + COGNITO_CLIENT_ID)
    .digest('base64');
  const body = JSON.stringify({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: { USERNAME: COGNITO_USERNAME, PASSWORD: COGNITO_PASSWORD, SECRET_HASH: secretHash },
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: `cognito-idp.${COGNITO_REGION}.amazonaws.com`,
      path: '/', method: 'POST',
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
            log('Cognito auth successful');
            resolve(cachedIdToken);
          } else reject(new Error(`Auth failed: ${data.substring(0, 200)}`));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function apiCall(method, path, body) {
  const token = await getIdToken();
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_HOST, path, method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-tenant-id': TENANT_ID,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function diagnoseGaps(db, filterTicker) {
  log('═══════════════════════════════════════════════════════════');
  log('  FILING COVERAGE DIAGNOSIS');
  log('═══════════════════════════════════════════════════════════');

  // Get all deals
  const dealsResult = await db.query(`
    SELECT id, ticker, company_name FROM deals 
    WHERE tenant_id = $1 AND ticker IS NOT NULL ORDER BY ticker
  `, [TENANT_ID]);
  const deals = dealsResult.rows;

  // Get chunk coverage
  const coverageResult = await db.query(`
    SELECT ticker, filing_type, COUNT(*)::int as chunks,
           COUNT(DISTINCT filing_date) as distinct_dates,
           MIN(filing_date) as earliest, MAX(filing_date) as latest
    FROM narrative_chunks
    GROUP BY ticker, filing_type
    ORDER BY ticker, filing_type
  `);

  // Build coverage map
  const coverageMap = new Map();
  for (const row of coverageResult.rows) {
    if (!coverageMap.has(row.ticker)) coverageMap.set(row.ticker, new Map());
    coverageMap.get(row.ticker).set(row.filing_type, {
      chunks: row.chunks,
      dates: row.distinct_dates,
      earliest: row.earliest,
      latest: row.latest,
    });
  }

  // Check for transcript coverage
  const transcriptResult = await db.query(`
    SELECT ticker, COUNT(*)::int as chunks, COUNT(DISTINCT filing_date) as dates
    FROM narrative_chunks
    WHERE section_type = 'earnings_transcript'
    GROUP BY ticker
  `);
  const transcriptMap = new Map();
  for (const row of transcriptResult.rows) {
    transcriptMap.set(row.ticker, { chunks: row.chunks, dates: row.dates });
  }

  const gaps = [];

  for (const deal of deals) {
    const ticker = deal.ticker;
    if (filterTicker && ticker !== filterTicker.toUpperCase()) continue;

    const tickerCoverage = coverageMap.get(ticker) || new Map();
    const isForeign = FOREIGN_FILERS.includes(ticker);
    const tickerGaps = [];

    log(`\n─── ${ticker} (${deal.company_name}) ───`);

    // Check each expected filing type
    for (const [filingType, expected] of Object.entries(EXPECTED_COVERAGE)) {
      // Foreign filers: skip 10-K check, check 40-F instead
      if (filingType === '10-K' && isForeign) {
        const fortyF = tickerCoverage.get('40-F');
        if (!fortyF || fortyF.dates < 2) {
          tickerGaps.push({ type: '40-F (foreign annual)', reason: fortyF ? `Only ${fortyF.dates} years` : 'MISSING entirely' });
          log(`  ❌ 40-F: ${fortyF ? `${fortyF.chunks} chunks, ${fortyF.dates} dates` : 'MISSING'} (expected ≥2 years)`);
        } else {
          log(`  ✅ 40-F: ${fortyF.chunks} chunks, ${fortyF.dates} dates`);
        }
        continue;
      }

      const coverage = tickerCoverage.get(filingType);
      if (!coverage) {
        tickerGaps.push({ type: filingType, reason: 'MISSING entirely' });
        log(`  ❌ ${filingType}: MISSING (expected ≥${expected.minYears} years, ≥${expected.minChunks} chunks)`);
      } else if (coverage.dates < expected.minYears) {
        tickerGaps.push({ type: filingType, reason: `Only ${coverage.dates} year(s), expected ≥${expected.minYears}` });
        log(`  ⚠️  ${filingType}: ${coverage.chunks} chunks, ${coverage.dates} dates (expected ≥${expected.minYears} years)`);
      } else if (coverage.chunks < expected.minChunks) {
        tickerGaps.push({ type: filingType, reason: `Only ${coverage.chunks} chunks, expected ≥${expected.minChunks}` });
        log(`  ⚠️  ${filingType}: ${coverage.chunks} chunks (expected ≥${expected.minChunks})`);
      } else {
        log(`  ✅ ${filingType}: ${coverage.chunks} chunks, ${coverage.dates} dates`);
      }
    }

    // Check transcripts
    const transcripts = transcriptMap.get(ticker);
    if (!transcripts || transcripts.dates < 2) {
      tickerGaps.push({ type: 'EARNINGS', reason: transcripts ? `Only ${transcripts.dates} calls` : 'MISSING entirely' });
      log(`  ❌ Transcripts: ${transcripts ? `${transcripts.chunks} chunks, ${transcripts.dates} calls` : 'MISSING'}`);
    } else {
      log(`  ✅ Transcripts: ${transcripts.chunks} chunks, ${transcripts.dates} calls`);
    }

    // Also show any extra filing types we have
    for (const [ft, cov] of tickerCoverage) {
      if (!EXPECTED_COVERAGE[ft] && ft !== '40-F' && ft !== '6-K') {
        log(`  📋 ${ft}: ${cov.chunks} chunks, ${cov.dates} dates (bonus)`);
      }
    }

    if (tickerGaps.length > 0) {
      gaps.push({ dealId: deal.id, ticker, companyName: deal.company_name, gaps: tickerGaps });
    }
  }

  log('\n═══════════════════════════════════════════════════════════');
  log(`  SUMMARY: ${gaps.length} tickers with gaps out of ${deals.length} total`);
  log('═══════════════════════════════════════════════════════════');
  for (const g of gaps) {
    log(`  ${g.ticker}: ${g.gaps.map(x => `${x.type} (${x.reason})`).join(', ')}`);
  }

  return gaps;
}

async function triggerPipeline(dealId, ticker) {
  log(`Triggering pipeline for ${ticker} (deal ${dealId})...`);
  try {
    const resp = await apiCall('POST', `/api/deals/${dealId}/analyze`, {});
    if (resp.status === 200 || resp.status === 201) {
      log(`  ✅ Pipeline triggered for ${ticker}`);
      return true;
    } else {
      log(`  ❌ Failed (${resp.status}): ${JSON.stringify(resp.data).substring(0, 200)}`);
      return false;
    }
  } catch (e) {
    log(`  ❌ Error: ${e.message}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const tickerIdx = args.indexOf('--ticker');
  const filterTicker = tickerIdx >= 0 ? args[tickerIdx + 1] : null;

  const db = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  log('Connected to RDS');

  const gaps = await diagnoseGaps(db, filterTicker);

  if (gaps.length === 0) {
    log('\nNo gaps found — all tickers have adequate coverage.');
    await db.end();
    return;
  }

  if (!execute) {
    log('\n⚠️  DRY RUN — add --execute to trigger pipelines for tickers with gaps');
    await db.end();
    return;
  }

  log('\n═══════════════════════════════════════════════════════════');
  log('  TRIGGERING PIPELINES FOR TICKERS WITH GAPS');
  log('═══════════════════════════════════════════════════════════');

  let triggered = 0;
  let failed = 0;

  for (const gap of gaps) {
    const success = await triggerPipeline(gap.dealId, gap.ticker);
    if (success) triggered++;
    else failed++;

    // Rate limit: 10s between pipeline triggers to avoid overwhelming the server
    if (gaps.indexOf(gap) < gaps.length - 1) {
      log('  Waiting 10s before next trigger...');
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  log(`\nDone: ${triggered} triggered, ${failed} failed`);
  await db.end();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
