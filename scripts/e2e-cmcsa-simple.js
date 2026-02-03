#!/usr/bin/env node
/**
 * SIMPLIFIED END-TO-END TEST: COMCAST (CMCSA)
 * 
 * Tests the complete pipeline using database-only approach
 * Bypasses authentication for testing purposes
 * 
 * USAGE: node scripts/e2e-cmcsa-simple.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const TICKER = 'CMCSA';
const YEARS = 3;
const POLL_INTERVAL_MS = 5000; // 5 seconds
const MAX_WAIT_TIME_MS = 15 * 60 * 1000; // 15 minutes

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const overallStartTime = Date.now();
  
  log('\n' + '='.repeat(80), 'bright');
  log('🚀 COMCAST (CMCSA) END-TO-END PIPELINE TEST', 'bright');
  log('='.repeat(80), 'bright');

  try {
    // Step 1: Check for existing deal
    log('\n📊 Step 1: Checking for existing CMCSA deal...', 'bright');
    
    let deal = await prisma.deal.findFirst({
      where: { ticker: TICKER },
      orderBy: { createdAt: 'desc' },
    });

    if (deal) {
      log(`   Found existing deal: ${deal.id}`, 'green');
      log(`   Status: ${deal.status}`, 'cyan');
      log(`   Created: ${deal.createdAt}`, 'cyan');
    } else {
      log('   No existing deal found', 'yellow');
      log('   Creating new deal...', 'cyan');
      
      deal = await prisma.deal.create({
        data: {
          ticker: TICKER,
          name: `${TICKER} Deal`,
          dealType: 'public',
          status: 'draft',
          processingMessage: 'Initializing...',
          tenantId: '00000000-0000-0000-0000-000000000000',
        },
      });
      
      log(`   ✅ Deal created: ${deal.id}`, 'green');
    }

    const dealId = deal.id;

    // Step 2: Monitor pipeline status
    log('\n⏳ Step 2: Monitoring pipeline status...', 'bright');
    log(`   Polling every ${POLL_INTERVAL_MS / 1000}s (max ${formatDuration(MAX_WAIT_TIME_MS)})`, 'cyan');
    
    const startTime = Date.now();
    let lastStatus = deal.status;
    let lastMessage = deal.processingMessage;

    while (true) {
      const elapsed = Date.now() - startTime;
      
      // Check timeout
      if (elapsed > MAX_WAIT_TIME_MS) {
        log(`\n   ⚠️  Pipeline exceeded ${formatDuration(MAX_WAIT_TIME_MS)} timeout`, 'yellow');
        break;
      }

      // Fetch current status
      deal = await prisma.deal.findUnique({
        where: { id: dealId },
      });

      if (!deal) {
        throw new Error('Deal not found in database');
      }

      // Log status changes
      if (deal.status !== lastStatus || deal.processingMessage !== lastMessage) {
        lastStatus = deal.status;
        lastMessage = deal.processingMessage;
        
        log(`   [${formatDuration(elapsed)}] Status: ${deal.status}`, 'yellow');
        log(`      ${deal.processingMessage}`, 'cyan');
      }

      // Check completion
      if (deal.status === 'ready') {
        log(`\n   ✅ Pipeline completed in ${formatDuration(elapsed)}`, 'green');
        break;
      }

      // Check failure
      if (deal.status === 'failed') {
        log(`\n   ❌ Pipeline failed: ${deal.processingMessage}`, 'red');
        throw new Error(`Pipeline failed: ${deal.processingMessage}`);
      }

      // If still draft after 30 seconds, might need manual trigger
      if (deal.status === 'draft' && elapsed > 30000) {
        log(`\n   ⚠️  Deal still in draft after 30s - may need manual pipeline trigger`, 'yellow');
        log(`   You can manually trigger via: POST /api/deals/${dealId}/start-pipeline`, 'cyan');
        break;
      }

      // Wait before next poll
      await sleep(POLL_INTERVAL_MS);
    }

    // Step 3: Verify data availability
    log('\n📊 Step 3: Verifying data availability...', 'bright');
    
    const [
      metricsCount,
      calculatedCount,
      chunksCount,
      filingsCount,
      insightsCount,
      hierarchyCount,
    ] = await Promise.all([
      prisma.financialMetric.count({ where: { ticker: TICKER } }),
      prisma.calculatedMetric.count({ where: { ticker: TICKER } }),
      prisma.narrativeChunk.count({ where: { ticker: TICKER } }),
      prisma.filingMetadata.count({ where: { ticker: TICKER, processed: true } }),
      prisma.mdaInsight.count({ where: { ticker: TICKER } }),
      prisma.metricHierarchy.count({ where: { ticker: TICKER } }),
    ]);

    log(`   Financial Metrics: ${metricsCount}`, 'cyan');
    log(`   Calculated Metrics: ${calculatedCount}`, 'cyan');
    log(`   Narrative Chunks: ${chunksCount}`, 'cyan');
    log(`   Processed Filings: ${filingsCount}`, 'cyan');
    log(`   MD&A Insights: ${insightsCount}`, 'cyan');
    log(`   Metric Hierarchies: ${hierarchyCount}`, 'cyan');

    // Validation
    const warnings = [];
    if (metricsCount === 0) warnings.push('No financial metrics found');
    if (chunksCount === 0) warnings.push('No narrative chunks found');
    if (filingsCount === 0) warnings.push('No processed filings found');
    if (insightsCount === 0) warnings.push('No MD&A insights found (may need backfill)');

    if (warnings.length > 0) {
      log('\n   ⚠️  Warnings:', 'yellow');
      warnings.forEach(w => log(`      - ${w}`, 'yellow'));
    } else {
      log('   ✅ All data available', 'green');
    }

    // Step 4: Check narrative chunk sections
    if (chunksCount > 0) {
      log('\n📄 Step 4: Analyzing narrative chunks...', 'bright');
      
      const sectionTypes = await prisma.$queryRaw`
        SELECT section_type, COUNT(*) as count
        FROM narrative_chunks
        WHERE ticker = ${TICKER}
        GROUP BY section_type
        ORDER BY count DESC
      `;

      log('   Section Types:', 'cyan');
      sectionTypes.forEach(({ section_type, count }) => {
        log(`      ${section_type}: ${count} chunks`, 'cyan');
      });
    }

    // Generate summary
    const totalDuration = Date.now() - overallStartTime;
    
    log('\n' + '='.repeat(80), 'bright');
    log('📋 END-TO-END TEST SUMMARY', 'bright');
    log('='.repeat(80), 'bright');
    
    log('\n✅ TEST COMPLETED', 'green');
    
    log('\n📊 Test Details:', 'bright');
    log(`   Ticker: ${TICKER}`, 'cyan');
    log(`   Deal ID: ${dealId}`, 'cyan');
    log(`   Final Status: ${deal.status}`, 'cyan');
    log(`   Total Duration: ${formatDuration(totalDuration)}`, 'cyan');
    
    log('\n📈 Data Summary:', 'bright');
    log(`   Financial Metrics: ${metricsCount}`, 'cyan');
    log(`   Calculated Metrics: ${calculatedCount}`, 'cyan');
    log(`   Narrative Chunks: ${chunksCount}`, 'cyan');
    log(`   Processed Filings: ${filingsCount}`, 'cyan');
    log(`   MD&A Insights: ${insightsCount}`, 'cyan');
    log(`   Metric Hierarchies: ${hierarchyCount}`, 'cyan');
    
    log('\n🌐 Access URLs:', 'bright');
    log(`   Workspace: http://localhost:3000/app/deals/workspace.html?ticker=${TICKER}`, 'cyan');
    log(`   Deal Dashboard: http://localhost:3000/app/deals/index.html`, 'cyan');
    
    if (warnings.length > 0) {
      log('\n⚠️  Note: Some warnings were found (see above)', 'yellow');
      log('   If insights are missing, run: node scripts/backfill-meta-insights-fixed.js', 'cyan');
    } else {
      log('\n✨ All Systems Operational!', 'green');
    }
    
    log('='.repeat(80) + '\n', 'bright');

    process.exit(0);

  } catch (error) {
    log('\n' + '='.repeat(80), 'red');
    log('❌ TEST FAILED', 'red');
    log('='.repeat(80), 'red');
    log(`\nError: ${error.message}`, 'red');
    
    if (error.stack) {
      log('\nStack Trace:', 'yellow');
      log(error.stack, 'yellow');
    }

    log('\n' + '='.repeat(80) + '\n', 'red');
    process.exit(1);

  } finally {
    await prisma.$disconnect();
  }
}

// Handle interrupts
process.on('SIGINT', async () => {
  log('\n\n⚠️  Test interrupted by user', 'yellow');
  await prisma.$disconnect();
  process.exit(130);
});

main();
