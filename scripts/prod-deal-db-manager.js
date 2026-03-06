#!/usr/bin/env node
/**
 * Production Deal DB Manager
 * Connects directly to RDS to manage deals (bypasses Cognito auth).
 * 
 * Usage:
 *   node scripts/prod-deal-db-manager.js list
 *   node scripts/prod-deal-db-manager.js status ETSY
 *   node scripts/prod-deal-db-manager.js unstick <dealId>
 *   node scripts/prod-deal-db-manager.js reset <dealId>
 *   node scripts/prod-deal-db-manager.js create TICKER "Company Name"
 *   node scripts/prod-deal-db-manager.js delete <dealId>
 *   node scripts/prod-deal-db-manager.js coverage <ticker>
 *   node scripts/prod-deal-db-manager.js trigger-pipeline <dealId>
 */

const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL || 
  'postgresql://fundlens_admin:FundLens2025SecureDB@fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db';

const TENANT_ID = '00000000-0000-0000-0000-000000000000';

async function getClient() {
  const client = new Client({ 
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

async function listDeals(client) {
  const res = await client.query(`
    SELECT id, ticker, company_name, status, processing_message, deal_type, years,
           created_at, updated_at
    FROM deals 
    WHERE tenant_id = $1
    ORDER BY updated_at DESC
  `, [TENANT_ID]);
  
  console.log(`\n📊 ${res.rows.length} deals found:\n`);
  console.log('ID'.padEnd(38) + 'Ticker'.padEnd(10) + 'Status'.padEnd(18) + 'Company'.padEnd(30) + 'Updated');
  console.log('-'.repeat(120));
  for (const d of res.rows) {
    console.log(
      (d.id || '?').padEnd(38) +
      (d.ticker || '?').padEnd(10) +
      (d.status || '?').padEnd(18) +
      (d.company_name || '?').substring(0, 28).padEnd(30) +
      (d.updated_at ? new Date(d.updated_at).toISOString().substring(0, 19) : '?')
    );
  }
  if (res.rows.length > 0) {
    console.log(`\nProcessing messages:`);
    for (const d of res.rows) {
      if (d.processing_message) {
        console.log(`  ${d.ticker}: ${d.processing_message}`);
      }
    }
  }
  return res.rows;
}

async function getDealByTicker(client, ticker) {
  const res = await client.query(`
    SELECT id, ticker, company_name, status, processing_message, deal_type, years,
           created_at, updated_at
    FROM deals 
    WHERE UPPER(ticker) = $1 AND tenant_id = $2
    ORDER BY created_at DESC LIMIT 1
  `, [ticker.toUpperCase(), TENANT_ID]);
  
  if (res.rows.length === 0) {
    console.log(`No deal found for ticker ${ticker}`);
    return null;
  }
  const d = res.rows[0];
  console.log(`\n📋 Deal for ${ticker}:`);
  console.log(`  ID: ${d.id}`);
  console.log(`  Status: ${d.status}`);
  console.log(`  Processing: ${d.processing_message || 'none'}`);
  console.log(`  Company: ${d.company_name}`);
  console.log(`  Created: ${d.created_at}`);
  console.log(`  Updated: ${d.updated_at}`);
  return d;
}

async function getDataCoverage(client, ticker) {
  const upper = ticker.toUpperCase();
  
  // Filing counts
  const filings = await client.query(`
    SELECT filing_type, COUNT(*)::int as count, MAX(filing_date)::text as latest
    FROM filing_metadata WHERE ticker = $1 AND processed = true
    GROUP BY filing_type ORDER BY filing_type
  `, [upper]);
  
  // Metrics
  const metrics = await client.query(`
    SELECT COUNT(*)::int as count FROM financial_metrics WHERE ticker = $1
  `, [upper]);
  
  // Calculated metrics
  const calcMetrics = await client.query(`
    SELECT COUNT(*)::int as count FROM calculated_metrics WHERE ticker = $1
  `, [upper]);
  
  // Narrative chunks
  const chunks = await client.query(`
    SELECT COUNT(*)::int as count FROM narrative_chunks WHERE ticker = $1
  `, [upper]);
  
  console.log(`\n📊 Data Coverage for ${upper}:`);
  console.log(`\n  Filings:`);
  for (const f of filings.rows) {
    console.log(`    ${f.filing_type}: ${f.count} (latest: ${f.latest || 'n/a'})`);
  }
  console.log(`\n  Raw Metrics: ${metrics.rows[0]?.count || 0}`);
  console.log(`  Calculated Metrics: ${calcMetrics.rows[0]?.count || 0}`);
  console.log(`  Narrative Chunks: ${chunks.rows[0]?.count || 0}`);
}

async function unstickDeal(client, dealId) {
  const res = await client.query(`
    UPDATE deals SET status = 'ready', 
      processing_message = 'Manually unstuck - ready for use',
      updated_at = NOW()
    WHERE id = $1::uuid AND tenant_id = $2
    RETURNING id, ticker, status
  `, [dealId, TENANT_ID]);
  
  if (res.rows.length === 0) {
    console.log('Deal not found or not owned by tenant');
    return;
  }
  console.log(`\n✅ Deal ${res.rows[0].ticker} (${dealId}) set to 'ready'`);
}

async function resetDeal(client, dealId) {
  // Reset to processing so pipeline can be re-triggered
  const res = await client.query(`
    UPDATE deals SET status = 'processing', 
      processing_message = 'Reset for re-processing',
      updated_at = NOW()
    WHERE id = $1::uuid AND tenant_id = $2
    RETURNING id, ticker, status
  `, [dealId, TENANT_ID]);
  
  if (res.rows.length === 0) {
    console.log('Deal not found');
    return;
  }
  console.log(`\n✅ Deal ${res.rows[0].ticker} (${dealId}) reset to 'processing'`);
}

async function createDeal(client, ticker, companyName) {
  const upper = ticker.toUpperCase();
  
  // Check if deal already exists
  const existing = await client.query(`
    SELECT id, status FROM deals WHERE UPPER(ticker) = $1 AND tenant_id = $2
  `, [upper, TENANT_ID]);
  
  if (existing.rows.length > 0) {
    console.log(`\n⚠️  Deal for ${upper} already exists (ID: ${existing.rows[0].id}, status: ${existing.rows[0].status})`);
    return existing.rows[0];
  }
  
  const res = await client.query(`
    INSERT INTO deals (tenant_id, name, description, deal_type, ticker, company_name, years, status, processing_message)
    VALUES ($1, $2, '', 'public', $3, $4, 5, 'processing', 'Deal created - awaiting pipeline trigger')
    RETURNING id, ticker, company_name, status
  `, [TENANT_ID, `${upper} Analysis`, upper, companyName]);
  
  const deal = res.rows[0];
  console.log(`\n✅ Created deal for ${upper}:`);
  console.log(`  ID: ${deal.id}`);
  console.log(`  Ticker: ${deal.ticker}`);
  console.log(`  Company: ${deal.company_name}`);
  
  // Create default session and scratch pad
  await client.query(`
    INSERT INTO analysis_sessions (deal_id, session_name) VALUES ($1::uuid, 'Main Analysis')
  `, [deal.id]);
  
  await client.query(`
    INSERT INTO scratch_pads (deal_id, title, content) 
    VALUES ($1::uuid, 'Investment Analysis', '# Investment Analysis\n\n## Executive Summary\n\n## Key Findings\n\n## Recommendation\n')
  `, [deal.id]);
  
  console.log(`  ✅ Session and scratch pad created`);
  return deal;
}

async function triggerPipeline(client, dealId) {
  // Get deal info
  const deal = await client.query(`
    SELECT id, ticker, company_name, status, years FROM deals WHERE id = $1::uuid
  `, [dealId]);
  
  if (deal.rows.length === 0) {
    console.log('Deal not found');
    return;
  }
  
  const d = deal.rows[0];
  console.log(`\n🚀 Triggering pipeline for ${d.ticker} (${dealId})...`);
  console.log(`  This calls the production API's analyze endpoint.`);
  
  // We need to call the API for this since the pipeline runs in the ECS container
  // Use the API with platform admin key instead of Cognito
  const https = require('https');
  const platformKey = 'c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06';
  
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({});
    const req = https.request({
      hostname: 'app.fundlens.ai',
      path: `/api/deals/${dealId}/analyze`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': TENANT_ID,
        'x-platform-admin-key': platformKey,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`  Response (${res.statusCode}): ${data.substring(0, 500)}`);
        resolve(data);
      });
    });
    req.on('error', (e) => {
      console.log(`  Error: ${e.message}`);
      reject(e);
    });
    req.write(body);
    req.end();
  });
}

async function main() {
  const [,, command, ...args] = process.argv;
  
  if (!command) {
    console.log('Usage: node scripts/prod-deal-db-manager.js <command> [args]');
    console.log('Commands: list, status <ticker>, unstick <id>, reset <id>, create <ticker> <name>, coverage <ticker>, trigger-pipeline <id>, delete <id>');
    process.exit(1);
  }

  const client = await getClient();
  console.log('✅ Connected to database');

  try {
    switch (command) {
      case 'list':
        await listDeals(client);
        break;
      case 'status': {
        const ticker = args[0];
        if (!ticker) { console.log('Usage: status <ticker>'); break; }
        await getDealByTicker(client, ticker);
        break;
      }
      case 'unstick': {
        const dealId = args[0];
        if (!dealId) { console.log('Usage: unstick <dealId>'); break; }
        await unstickDeal(client, dealId);
        break;
      }
      case 'reset': {
        const dealId = args[0];
        if (!dealId) { console.log('Usage: reset <dealId>'); break; }
        await resetDeal(client, dealId);
        break;
      }
      case 'create': {
        const [ticker, ...nameParts] = args;
        const name = nameParts.join(' ');
        if (!ticker || !name) { console.log('Usage: create <ticker> <Company Name>'); break; }
        await createDeal(client, ticker, name);
        break;
      }
      case 'coverage': {
        const ticker = args[0];
        if (!ticker) { console.log('Usage: coverage <ticker>'); break; }
        await getDataCoverage(client, ticker);
        break;
      }
      case 'trigger-pipeline': {
        const dealId = args[0];
        if (!dealId) { console.log('Usage: trigger-pipeline <dealId>'); break; }
        await triggerPipeline(client, dealId);
        break;
      }
      default:
        console.log(`Unknown command: ${command}`);
    }
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
