#!/usr/bin/env node

/**
 * KB Sync Monitoring Script
 * 
 * Monitors KB sync status across all tickers and provides:
 * - Sync status dashboard
 * - Unsynced chunks report
 * - Last sync timestamps
 * - Failed ingestion jobs
 * 
 * Usage: node scripts/monitor-kb-sync-status.js [ticker]
 */

const { PrismaClient } = require('@prisma/client');
const { 
  BedrockAgentClient, 
  ListIngestionJobsCommand,
} = require('@aws-sdk/client-bedrock-agent');

const prisma = new PrismaClient();
const bedrockAgent = new BedrockAgentClient({ 
  region: process.env.AWS_REGION || 'us-east-1',
  maxAttempts: 10,
  retryMode: 'adaptive',
});

const KB_ID = process.env.BEDROCK_KB_ID || 'NB5XNMHBQT';
const DATA_SOURCE_ID = process.env.BEDROCK_DATA_SOURCE_ID || 'OQMSFOE5SL';

/**
 * Get sync status for all tickers
 */
async function getAllTickersSyncStatus() {
  const result = await prisma.$queryRaw`
    SELECT 
      ticker,
      COUNT(*) as total_chunks,
      COUNT(bedrock_kb_id) as synced_chunks,
      COUNT(*) - COUNT(bedrock_kb_id) as unsynced_chunks,
      ROUND(COUNT(bedrock_kb_id)::numeric / COUNT(*)::numeric * 100, 1) as sync_rate,
      MAX(created_at) as last_chunk_created
    FROM narrative_chunks
    GROUP BY ticker
    ORDER BY unsynced_chunks DESC, ticker ASC
  `;

  return result.map(row => ({
    ticker: row.ticker,
    totalChunks: Number(row.total_chunks),
    syncedChunks: Number(row.synced_chunks),
    unsyncedChunks: Number(row.unsynced_chunks),
    syncRate: Number(row.sync_rate),
    lastChunkCreated: row.last_chunk_created,
  }));
}

/**
 * Get sync status for specific ticker
 */
async function getTickerSyncStatus(ticker) {
  const result = await prisma.$queryRaw`
    SELECT 
      ticker,
      COUNT(*) as total_chunks,
      COUNT(bedrock_kb_id) as synced_chunks,
      COUNT(*) - COUNT(bedrock_kb_id) as unsynced_chunks,
      ROUND(COUNT(bedrock_kb_id)::numeric / COUNT(*)::numeric * 100, 1) as sync_rate,
      MAX(created_at) as last_chunk_created,
      MIN(bedrock_kb_id) as first_job_id,
      MAX(bedrock_kb_id) as last_job_id
    FROM narrative_chunks
    WHERE ticker = ${ticker}
    GROUP BY ticker
  `;

  if (result.length === 0) {
    return null;
  }

  const row = result[0];
  return {
    ticker: row.ticker,
    totalChunks: Number(row.total_chunks),
    syncedChunks: Number(row.synced_chunks),
    unsyncedChunks: Number(row.unsynced_chunks),
    syncRate: Number(row.sync_rate),
    lastChunkCreated: row.last_chunk_created,
    firstJobId: row.first_job_id,
    lastJobId: row.last_job_id,
  };
}

/**
 * Get recent ingestion jobs
 */
async function getRecentIngestionJobs(maxResults = 10) {
  try {
    const command = new ListIngestionJobsCommand({
      knowledgeBaseId: KB_ID,
      dataSourceId: DATA_SOURCE_ID,
      maxResults,
    });

    const response = await bedrockAgent.send(command);
    return response.ingestionJobSummaries || [];
  } catch (error) {
    console.error(`Failed to get ingestion jobs: ${error.message}`);
    return [];
  }
}

/**
 * Display dashboard for all tickers
 */
async function displayDashboard() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  KB Sync Status Dashboard                                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const statuses = await getAllTickersSyncStatus();
  
  if (statuses.length === 0) {
    console.log('No narrative chunks found in database.\n');
    return;
  }

  // Summary stats
  const totalChunks = statuses.reduce((sum, s) => sum + s.totalChunks, 0);
  const syncedChunks = statuses.reduce((sum, s) => sum + s.syncedChunks, 0);
  const unsyncedChunks = statuses.reduce((sum, s) => sum + s.unsyncedChunks, 0);
  const overallSyncRate = (syncedChunks / totalChunks * 100).toFixed(1);

  console.log('📊 Overall Statistics:\n');
  console.log(`   Total Tickers: ${statuses.length}`);
  console.log(`   Total Chunks: ${totalChunks.toLocaleString()}`);
  console.log(`   Synced: ${syncedChunks.toLocaleString()} (${overallSyncRate}%)`);
  console.log(`   Unsynced: ${unsyncedChunks.toLocaleString()}`);
  console.log('');

  // Tickers with unsynced chunks
  const unsyncedTickers = statuses.filter(s => s.unsyncedChunks > 0);
  
  if (unsyncedTickers.length > 0) {
    console.log(`⚠️  Tickers with Unsynced Chunks (${unsyncedTickers.length}):\n`);
    console.log('   Ticker  | Total | Synced | Unsynced | Rate  | Last Created');
    console.log('   --------|-------|--------|----------|-------|-------------');
    
    unsyncedTickers.forEach(s => {
      const ticker = s.ticker.padEnd(7);
      const total = String(s.totalChunks).padStart(5);
      const synced = String(s.syncedChunks).padStart(6);
      const unsynced = String(s.unsyncedChunks).padStart(8);
      const rate = `${s.syncRate}%`.padStart(5);
      const date = s.lastChunkCreated ? new Date(s.lastChunkCreated).toISOString().split('T')[0] : 'N/A';
      
      console.log(`   ${ticker} | ${total} | ${synced} | ${unsynced} | ${rate} | ${date}`);
    });
    console.log('');
  } else {
    console.log('✅ All tickers are fully synced!\n');
  }

  // Fully synced tickers
  const syncedTickers = statuses.filter(s => s.unsyncedChunks === 0);
  
  if (syncedTickers.length > 0) {
    console.log(`✅ Fully Synced Tickers (${syncedTickers.length}):\n`);
    
    syncedTickers.slice(0, 10).forEach(s => {
      console.log(`   ${s.ticker}: ${s.totalChunks} chunks (100%)`);
    });
    
    if (syncedTickers.length > 10) {
      console.log(`   ... and ${syncedTickers.length - 10} more`);
    }
    console.log('');
  }

  // Recent ingestion jobs
  console.log('📋 Recent Ingestion Jobs:\n');
  const jobs = await getRecentIngestionJobs(5);
  
  if (jobs.length > 0) {
    jobs.forEach((job, i) => {
      const status = job.status === 'COMPLETE' ? '✅' : 
                     job.status === 'FAILED' ? '❌' : 
                     job.status === 'IN_PROGRESS' ? '🔄' : '⏳';
      
      console.log(`   ${i + 1}. ${status} ${job.ingestionJobId}`);
      console.log(`      Status: ${job.status}`);
      console.log(`      Started: ${new Date(job.startedAt).toLocaleString()}`);
      
      if (job.statistics) {
        console.log(`      Scanned: ${job.statistics.numberOfDocumentsScanned || 0}`);
        console.log(`      Indexed: ${job.statistics.numberOfNewDocumentsIndexed || 0}`);
        console.log(`      Modified: ${job.statistics.numberOfModifiedDocumentsIndexed || 0}`);
        console.log(`      Failed: ${job.statistics.numberOfDocumentsFailed || 0}`);
      }
      console.log('');
    });
  } else {
    console.log('   No recent jobs found\n');
  }
}

/**
 * Display detailed status for specific ticker
 */
async function displayTickerStatus(ticker) {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log(`║  KB Sync Status: ${ticker.padEnd(46)} ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const status = await getTickerSyncStatus(ticker);
  
  if (!status) {
    console.log(`❌ No narrative chunks found for ticker: ${ticker}\n`);
    return;
  }

  console.log('📊 Sync Statistics:\n');
  console.log(`   Total Chunks: ${status.totalChunks}`);
  console.log(`   Synced: ${status.syncedChunks} (${status.syncRate}%)`);
  console.log(`   Unsynced: ${status.unsyncedChunks}`);
  console.log(`   Last Created: ${status.lastChunkCreated ? new Date(status.lastChunkCreated).toLocaleString() : 'N/A'}`);
  console.log('');

  if (status.firstJobId) {
    console.log('🔗 KB Job IDs:\n');
    console.log(`   First: ${status.firstJobId}`);
    console.log(`   Last: ${status.lastJobId}`);
    console.log('');
  }

  if (status.unsyncedChunks > 0) {
    console.log(`⚠️  ${status.unsyncedChunks} chunks need to be synced\n`);
    console.log('   To sync manually:');
    console.log(`   node scripts/manual-kb-sync-amzn.js ${ticker}\n`);
  } else {
    console.log('✅ All chunks are synced to Bedrock KB\n');
  }

  // Sample chunks
  console.log('📄 Sample Chunks:\n');
  const sampleChunks = await prisma.narrativeChunk.findMany({
    where: { ticker },
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      sectionType: true,
      filingDate: true,
      bedrockKbId: true,
      content: true,
    },
  });

  sampleChunks.forEach((chunk, i) => {
    const syncStatus = chunk.bedrockKbId ? '✅' : '❌';
    console.log(`   ${i + 1}. ${syncStatus} ${chunk.sectionType || 'unknown'}`);
    console.log(`      Filing Date: ${chunk.filingDate ? new Date(chunk.filingDate).toISOString().split('T')[0] : 'N/A'}`);
    console.log(`      KB Job ID: ${chunk.bedrockKbId || 'Not synced'}`);
    console.log(`      Content: ${chunk.content?.substring(0, 80)}...`);
    console.log('');
  });
}

/**
 * Main execution
 */
async function main() {
  const ticker = process.argv[2];

  try {
    if (ticker) {
      await displayTickerStatus(ticker.toUpperCase());
    } else {
      await displayDashboard();
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
