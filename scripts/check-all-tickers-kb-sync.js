#!/usr/bin/env node

/**
 * Check All Tickers KB Sync Status
 * 
 * Identifies tickers that need KB sync backfill
 * 
 * Usage: node scripts/check-all-tickers-kb-sync.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Checking All Tickers for KB Sync Issues                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Get all tickers with unsynced chunks
    const unsyncedTickers = await prisma.$queryRaw`
      SELECT 
        ticker,
        COUNT(*) as total_chunks,
        COUNT(bedrock_kb_id) as synced_chunks,
        COUNT(*) - COUNT(bedrock_kb_id) as unsynced_chunks,
        ROUND(COUNT(bedrock_kb_id)::numeric / COUNT(*)::numeric * 100, 1) as sync_rate
      FROM narrative_chunks
      GROUP BY ticker
      HAVING COUNT(*) > COUNT(bedrock_kb_id)
      ORDER BY unsynced_chunks DESC
    `;

    if (unsyncedTickers.length === 0) {
      console.log('✅ All tickers are fully synced to Bedrock KB!\n');
      console.log('No backfill needed.\n');
      return;
    }

    console.log(`⚠️  Found ${unsyncedTickers.length} tickers with unsynced chunks:\n`);
    console.log('Ticker  | Total | Synced | Unsynced | Rate');
    console.log('--------|-------|--------|----------|------');

    unsyncedTickers.forEach(row => {
      const ticker = row.ticker.padEnd(7);
      const total = String(Number(row.total_chunks)).padStart(5);
      const synced = String(Number(row.synced_chunks)).padStart(6);
      const unsynced = String(Number(row.unsynced_chunks)).padStart(8);
      const rate = `${Number(row.sync_rate)}%`.padStart(5);
      
      console.log(`${ticker} | ${total} | ${synced} | ${unsynced} | ${rate}`);
    });

    console.log('\n📋 Backfill Commands:\n');
    
    unsyncedTickers.forEach(row => {
      console.log(`# ${row.ticker} - ${Number(row.unsynced_chunks)} chunks to sync`);
      console.log(`node scripts/manual-kb-sync-ticker.js ${row.ticker}\n`);
    });

    console.log('💡 Tip: Run these commands one at a time to avoid rate limiting.\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
