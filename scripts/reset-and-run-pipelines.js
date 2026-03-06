#!/usr/bin/env node
/**
 * DEFINITIVE pipeline execution script.
 * 
 * Strategy:
 * 1. Connect to RDS directly and reset ALL filing_metadata.processed = false
 *    This ensures ingestFiling() will never short-circuit.
 * 2. Fire ONE request to the executeFullDataset endpoint with all 10 tickers.
 *    The ALB will timeout the HTTP response at 120s, but the NestJS server
 *    continues processing all tickers server-side.
 * 3. Poll CloudWatch logs to monitor progress.
 * 4. After all tickers complete, verify chunk counts in RDS.
 * 
 * Usage: node scripts/reset-and-run-pipelines.js [--reset-only] [--monitor-only] [--verify-only]
 */

const { Client } = require('pg');

const DB_URL = 'postgresql://fundlens_admin:FundLens2025SecureDB@fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db';
const ALB_URL = 'https://fundlens-production-alb-931926615.us-east-1.elb.amazonaws.com';

const TICKERS = ['AAPL', 'ABNB', 'AMGN', 'AMZN', 'ETSY', 'GOOGL', 'MSFT', 'NVDA', 'SHOP', 'TSLA'];
const YEARS = [2021, 2022, 2023, 2024, 2025, 2026];
const FILING_TYPES = ['10-K', '10-Q', '8-K', 'DEF 14A', '4', 'S-1', '40-F', '6-K', 'F-1'];

const args = process.argv.slice(2);
const RESET_ONLY = args.includes('--reset-only');
const MONITOR_ONLY = args.includes('--monitor-only');
const VERIFY_ONLY = args.includes('--verify-only');

async function getDbClient() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

// ─── STEP 1: Reset all processed flags ───────────────────────────────────────

async function resetAllProcessedFlags() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('STEP 1: Reset ALL filing_metadata.processed = false');
  console.log('═══════════════════════════════════════════════════════\n');

  const db = await getDbClient();

  // Show current state
  const state = await db.query(`
    SELECT fm.ticker, fm.filing_type,
           COUNT(*) as total_filings,
           SUM(CASE WHEN fm.processed THEN 1 ELSE 0 END) as processed,
           COALESCE(nc.chunk_count, 0) as actual_chunks
    FROM filing_metadata fm
    LEFT JOIN (
      SELECT ticker, filing_type, COUNT(*) as chunk_count
      FROM narrative_chunks GROUP BY ticker, filing_type
    ) nc ON fm.ticker = nc.ticker AND fm.filing_type = nc.filing_type
    GROUP BY fm.ticker, fm.filing_type, nc.chunk_count
    ORDER BY fm.ticker, fm.filing_type
  `);

  console.log('Current state (filing_metadata vs actual narrative_chunks):');
  console.log('─'.repeat(70));
  console.log('Ticker  | Filing Type | Filings | Processed | Actual Chunks');
  console.log('─'.repeat(70));
  for (const r of state.rows) {
    const mismatch = parseInt(r.processed) > 0 && parseInt(r.actual_chunks) === 0 ? ' ⚠️ MISMATCH' : '';
    console.log(`${r.ticker.padEnd(8)}| ${r.filing_type.padEnd(12)}| ${String(r.total_filings).padEnd(9)}| ${String(r.processed).padEnd(10)}| ${r.actual_chunks}${mismatch}`);
  }

  // Reset ALL processed flags
  const result = await db.query(`UPDATE filing_metadata SET processed = false WHERE processed = true`);
  console.log(`\n✅ Reset ${result.rowCount} rows to processed = false`);

  // Also delete narrative_chunks with 0 content (orphans) if any
  const orphans = await db.query(`DELETE FROM narrative_chunks WHERE content IS NULL OR content = ''`);
  if (orphans.rowCount > 0) {
    console.log(`🗑️  Deleted ${orphans.rowCount} empty/null narrative chunks`);
  }

  await db.end();
  return result.rowCount;
}

// ─── STEP 2: Trigger the full pipeline ───────────────────────────────────────

async function triggerFullPipeline() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('STEP 2: Trigger executeFullDataset for all 10 tickers');
  console.log('═══════════════════════════════════════════════════════\n');

  const body = {
    companies: TICKERS,
    years: YEARS,
    filingTypes: FILING_TYPES,
    batchSize: 1,  // Process one ticker at a time to avoid overwhelming the Python parser
    skipExisting: true,  // Smart check: will re-process filings with low chunk counts
    syncToKnowledgeBase: false,  // We'll do KB sync separately
  };

  console.log(`Tickers: ${TICKERS.join(', ')}`);
  console.log(`Years: ${YEARS.join(', ')}`);
  console.log(`Filing types: ${FILING_TYPES.join(', ')}`);
  console.log(`skipExisting: true (smart check — all flags are reset so everything will be processed)`);
  console.log(`batchSize: 1 (sequential)`);
  console.log('');
  console.log('Firing request to ALB... (will timeout at ~120s, but pipeline continues server-side)');

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000); // 3 min client timeout

    const response = await fetch(`${ALB_URL}/api/comprehensive-sec-pipeline/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      const result = await response.json();
      console.log(`\n✅ Pipeline completed and returned response!`);
      console.log(JSON.stringify(result.summary, null, 2));
      return true;
    } else {
      const text = await response.text();
      console.log(`\n⚠️  HTTP ${response.status}: ${text.substring(0, 200)}`);
      return false;
    }
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    if (error.name === 'AbortError' || error.message.includes('abort')) {
      console.log(`\n⏱️  Client timeout after ${elapsed}s — this is EXPECTED.`);
      console.log('   The pipeline continues running on ECS.');
      console.log('   Use --monitor-only to watch progress via logs.');
      console.log('   Use --verify-only to check final results.');
      return 'timeout';
    } else {
      console.error(`\n❌ Error: ${error.message} (${elapsed}s)`);
      return false;
    }
  }
}

// ─── STEP 3: Monitor progress ────────────────────────────────────────────────

async function monitorProgress() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('STEP 3: Monitor pipeline progress');
  console.log('═══════════════════════════════════════════════════════\n');

  const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
  const cwl = new CloudWatchLogsClient({ region: 'us-east-1' });

  let lastSeen = Date.now() - 60000; // Start from 1 minute ago
  let completedTickers = new Set();
  let running = true;

  console.log('Polling CloudWatch logs for pipeline completion messages...');
  console.log('(Press Ctrl+C to stop monitoring)\n');

  while (running && completedTickers.size < TICKERS.length) {
    try {
      const cmd = new FilterLogEventsCommand({
        logGroupName: '/ecs/fundlens-production/backend',
        startTime: lastSeen,
        filterPattern: 'complete',
        limit: 50,
      });

      const result = await cwl.send(cmd);

      if (result.events?.length > 0) {
        for (const event of result.events) {
          const msg = event.message || '';
          // Look for completion messages like "✅ AAPL complete: 298/298 filings..."
          const match = msg.match(/✅ (\w+) complete: (\d+)\/(\d+) filings, (\d+) metrics, (\d+) narratives/);
          if (match) {
            const [, ticker, processed, total, metrics, narratives] = match;
            if (!completedTickers.has(ticker)) {
              completedTickers.add(ticker);
              console.log(`✅ ${ticker}: ${processed}/${total} filings, ${metrics} metrics, ${narratives} narratives`);
            }
          }
          lastSeen = Math.max(lastSeen, (event.timestamp || 0) + 1);
        }
      }

      // Also check for "Comprehensive pipeline complete" which means ALL done
      const doneCmd = new FilterLogEventsCommand({
        logGroupName: '/ecs/fundlens-production/backend',
        startTime: lastSeen - 5000,
        filterPattern: 'Comprehensive pipeline complete',
        limit: 5,
      });
      const doneResult = await cwl.send(doneCmd);
      if (doneResult.events?.length > 0) {
        console.log('\n🎉 Full pipeline completed!');
        running = false;
        break;
      }

    } catch (error) {
      // Ignore transient errors
    }

    // Poll every 30 seconds
    if (running) {
      process.stdout.write(`  [${completedTickers.size}/${TICKERS.length} tickers done, polling...]\r`);
      await new Promise(r => setTimeout(r, 30000));
    }
  }

  console.log(`\nCompleted tickers: ${[...completedTickers].join(', ')}`);
  const missing = TICKERS.filter(t => !completedTickers.has(t));
  if (missing.length > 0) {
    console.log(`Still running/missing: ${missing.join(', ')}`);
  }
}

// ─── STEP 4: Verify results ─────────────────────────────────────────────────

async function verifyResults() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('STEP 4: Verify final chunk counts in RDS');
  console.log('═══════════════════════════════════════════════════════\n');

  const db = await getDbClient();

  // Chunk counts by ticker and filing type
  const chunks = await db.query(`
    SELECT ticker, filing_type, COUNT(*) as chunk_count
    FROM narrative_chunks
    GROUP BY ticker, filing_type
    ORDER BY ticker, filing_type
  `);

  console.log('Narrative chunks by ticker/filing_type:');
  console.log('─'.repeat(50));
  let total = 0;
  let currentTicker = '';
  let tickerTotal = 0;
  for (const r of chunks.rows) {
    if (r.ticker !== currentTicker) {
      if (currentTicker) console.log(`  ${''.padEnd(14)}SUBTOTAL: ${tickerTotal}`);
      currentTicker = r.ticker;
      tickerTotal = 0;
    }
    const count = parseInt(r.chunk_count);
    tickerTotal += count;
    total += count;
    console.log(`  ${r.ticker.padEnd(8)} ${r.filing_type.padEnd(12)} ${count}`);
  }
  if (currentTicker) console.log(`  ${''.padEnd(14)}SUBTOTAL: ${tickerTotal}`);
  console.log('─'.repeat(50));
  console.log(`TOTAL: ${total} narrative chunks`);

  // Check for tickers with missing filing types
  console.log('\n\nMissing filing types (expected vs actual):');
  const expected = { '10-K': 8, '10-Q': 8, 'DEF 14A': 3 }; // Rough minimums per ticker
  for (const ticker of TICKERS) {
    const tickerChunks = chunks.rows.filter(r => r.ticker === ticker);
    const types = tickerChunks.map(r => r.filing_type);
    const missing = [];
    if (!types.includes('10-K') && !types.includes('40-F')) missing.push('10-K/40-F');
    if (!types.includes('10-Q')) missing.push('10-Q');
    if (missing.length > 0) {
      console.log(`  ⚠️  ${ticker}: missing ${missing.join(', ')}`);
    }
  }

  // Filing metadata state
  const meta = await db.query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN processed THEN 1 ELSE 0 END) as processed,
      SUM(CASE WHEN NOT processed THEN 1 ELSE 0 END) as unprocessed
    FROM filing_metadata
  `);
  console.log(`\nFiling metadata: ${meta.rows[0].total} total, ${meta.rows[0].processed} processed, ${meta.rows[0].unprocessed} unprocessed`);

  await db.end();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 FundLens Pipeline — Reset, Run, Monitor, Verify');
  console.log('══════════════════════════════════════════════════\n');

  if (VERIFY_ONLY) {
    await verifyResults();
    return;
  }

  if (MONITOR_ONLY) {
    await monitorProgress();
    await verifyResults();
    return;
  }

  // Step 1: Reset flags
  await resetAllProcessedFlags();

  if (RESET_ONLY) {
    console.log('\n--reset-only: Stopping after flag reset.');
    return;
  }

  // Step 2: Trigger pipeline
  const result = await triggerFullPipeline();

  if (result === 'timeout') {
    // Expected — monitor progress
    console.log('\nStarting progress monitor...');
    await monitorProgress();
  }

  // Step 3: Verify
  await verifyResults();

  console.log('\n🏁 Done! Next steps:');
  console.log('  1. Run KB sync: node scripts/clean-slate-kb-sync.js');
  console.log('  2. Trigger Bedrock ingestion');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
