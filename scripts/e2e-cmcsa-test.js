#!/usr/bin/env node
/**
 * END-TO-END TEST: COMCAST (CMCSA)
 * 
 * Tests the complete pipeline from deal creation to workspace access
 * Verifies all steps complete successfully and data is accessible
 * 
 * USAGE: node scripts/e2e-cmcsa-test.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const API_BASE = 'http://localhost:3000/api';
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
  blue: '\x1b[34m',
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

async function cleanupExistingDeal() {
  log('\n🧹 Cleanup: Checking for existing CMCSA deal...', 'cyan');
  
  const existingDeal = await prisma.deal.findFirst({
    where: { ticker: TICKER },
    orderBy: { createdAt: 'desc' },
  });

  if (existingDeal) {
    log(`   Found existing deal: ${existingDeal.id} (status: ${existingDeal.status})`, 'yellow');
    log('   Deleting to start fresh...', 'yellow');
    
    await prisma.deal.delete({ where: { id: existingDeal.id } });
    log('   ✅ Deleted', 'green');
  } else {
    log('   No existing deal found', 'cyan');
  }
}

async function createDeal() {
  log('\n📝 Step 1: Creating CMCSA deal via database...', 'bright');
  
  // Create deal directly in database (bypasses auth for testing)
  const deal = await prisma.deal.create({
    data: {
      ticker: TICKER,
      status: 'pending',
      processingMessage: 'Initializing...',
      tenantId: '00000000-0000-0000-0000-000000000000',
    },
  });

  log(`   ✅ Deal created: ${deal.id}`, 'green');
  log(`   Status: ${deal.status}`, 'cyan');
  
  // Trigger pipeline via API
  log('   Triggering pipeline...', 'cyan');
  const response = await fetch(`${API_BASE}/deals/${deal.id}/start-pipeline`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ years: YEARS }),
  });

  if (!response.ok) {
    // Try alternative: update deal to trigger pipeline
    log('   Using alternative pipeline trigger...', 'yellow');
    await prisma.deal.update({
      where: { id: deal.id },
      data: { status: 'processing', processingMessage: 'Starting pipeline...' },
    });
  }
  
  return deal;
}

async function pollPipelineStatus(dealId) {
  log('\n⏳ Step 2: Monitoring pipeline execution...', 'bright');
  log(`   Polling every ${POLL_INTERVAL_MS / 1000}s (max ${formatDuration(MAX_WAIT_TIME_MS)})`, 'cyan');
  
  const startTime = Date.now();
  let lastStep = null;
  let lastMessage = null;

  while (true) {
    const elapsed = Date.now() - startTime;
    
    // Check timeout
    if (elapsed > MAX_WAIT_TIME_MS) {
      throw new Error(`Pipeline timed out after ${formatDuration(MAX_WAIT_TIME_MS)}`);
    }

    // Fetch pipeline status
    const response = await fetch(`${API_BASE}/deals/${dealId}/pipeline-status`);
    if (!response.ok) {
      throw new Error(`Failed to fetch pipeline status: ${response.status}`);
    }

    const status = await response.json();
    
    // Log step changes
    if (status.currentStep !== lastStep || status.steps.find(s => s.id === status.currentStep)?.message !== lastMessage) {
      const currentStepData = status.steps.find(s => s.id === status.currentStep);
      lastStep = status.currentStep;
      lastMessage = currentStepData?.message;
      
      log(`   [${formatDuration(elapsed)}] Step ${status.currentStep}: ${currentStepData?.name}`, 'yellow');
      log(`      ${currentStepData?.message}`, 'cyan');
    }

    // Check completion
    if (status.overallStatus === 'completed') {
      log(`\n   ✅ Pipeline completed in ${formatDuration(elapsed)}`, 'green');
      return status;
    }

    // Check failure
    if (status.overallStatus === 'failed') {
      log(`\n   ❌ Pipeline failed: ${status.error}`, 'red');
      throw new Error(`Pipeline failed: ${status.error}`);
    }

    // Wait before next poll
    await sleep(POLL_INTERVAL_MS);
  }
}

async function verifyDealStatus(dealId) {
  log('\n🔍 Step 3: Verifying deal status...', 'bright');
  
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
  });

  if (!deal) {
    throw new Error('Deal not found in database');
  }

  log(`   Status: ${deal.status}`, 'cyan');
  log(`   Message: ${deal.processingMessage}`, 'cyan');
  
  if (deal.status !== 'ready') {
    throw new Error(`Expected status 'ready', got '${deal.status}'`);
  }

  log('   ✅ Deal status is ready', 'green');
  return deal;
}

async function verifyDataAvailability() {
  log('\n📊 Step 4: Verifying data availability...', 'bright');
  
  const [
    metricsCount,
    calculatedCount,
    chunksCount,
    filingsCount,
  ] = await Promise.all([
    prisma.financialMetric.count({ where: { ticker: TICKER } }),
    prisma.calculatedMetric.count({ where: { ticker: TICKER } }),
    prisma.narrativeChunk.count({ where: { ticker: TICKER } }),
    prisma.filingMetadata.count({ where: { ticker: TICKER, processed: true } }),
  ]);

  log(`   Financial Metrics: ${metricsCount}`, 'cyan');
  log(`   Calculated Metrics: ${calculatedCount}`, 'cyan');
  log(`   Narrative Chunks: ${chunksCount}`, 'cyan');
  log(`   Processed Filings: ${filingsCount}`, 'cyan');

  // Validation
  const errors = [];
  if (metricsCount === 0) errors.push('No financial metrics found');
  if (chunksCount === 0) errors.push('No narrative chunks found');
  if (filingsCount === 0) errors.push('No processed filings found');

  if (errors.length > 0) {
    throw new Error(`Data validation failed: ${errors.join(', ')}`);
  }

  log('   ✅ All data available', 'green');
  
  return { metricsCount, calculatedCount, chunksCount, filingsCount };
}

async function verifyWorkspaceAccess(dealId) {
  log('\n🌐 Step 5: Verifying workspace access...', 'bright');
  
  // Test deal endpoint
  const dealResponse = await fetch(`${API_BASE}/deals/${dealId}`);
  if (!dealResponse.ok) {
    throw new Error(`Failed to fetch deal: ${dealResponse.status}`);
  }
  const dealData = await dealResponse.json();
  log(`   ✅ Deal endpoint accessible`, 'green');

  // Test metrics endpoint
  const metricsResponse = await fetch(`${API_BASE}/deals/${dealId}/metrics`);
  if (!metricsResponse.ok) {
    throw new Error(`Failed to fetch metrics: ${metricsResponse.status}`);
  }
  const metricsData = await metricsResponse.json();
  log(`   ✅ Metrics endpoint accessible (${metricsData.length || 0} metrics)`, 'green');

  // Test insights endpoint
  const insightsResponse = await fetch(`${API_BASE}/deals/${dealId}/insights`);
  if (!insightsResponse.ok) {
    throw new Error(`Failed to fetch insights: ${insightsResponse.status}`);
  }
  const insightsData = await insightsResponse.json();
  log(`   ✅ Insights endpoint accessible`, 'green');

  // Test hierarchy endpoint
  const hierarchyResponse = await fetch(`${API_BASE}/deals/${dealId}/hierarchy`);
  if (!hierarchyResponse.ok) {
    throw new Error(`Failed to fetch hierarchy: ${hierarchyResponse.status}`);
  }
  const hierarchyData = await hierarchyResponse.json();
  log(`   ✅ Hierarchy endpoint accessible`, 'green');

  return { dealData, metricsData, insightsData, hierarchyData };
}

async function testChatFunctionality(dealId) {
  log('\n💬 Step 6: Testing chat functionality...', 'bright');
  
  const testQuestion = 'What is Comcast\'s revenue for the most recent year?';
  
  const response = await fetch(`${API_BASE}/deals/${dealId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: testQuestion,
      conversationHistory: [],
    }),
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`);
  }

  const chatResponse = await response.json();
  log(`   Question: "${testQuestion}"`, 'cyan');
  log(`   Answer: "${chatResponse.answer?.substring(0, 100)}..."`, 'cyan');
  log(`   Sources: ${chatResponse.sources?.length || 0}`, 'cyan');
  
  if (!chatResponse.answer) {
    throw new Error('Chat response has no answer');
  }

  log('   ✅ Chat functionality working', 'green');
  return chatResponse;
}

async function generateSummaryReport(dealId, data, duration) {
  log('\n' + '='.repeat(80), 'bright');
  log('📋 END-TO-END TEST SUMMARY', 'bright');
  log('='.repeat(80), 'bright');
  
  log('\n✅ TEST PASSED - All steps completed successfully!', 'green');
  
  log('\n📊 Test Details:', 'bright');
  log(`   Ticker: ${TICKER}`, 'cyan');
  log(`   Years: ${YEARS}`, 'cyan');
  log(`   Deal ID: ${dealId}`, 'cyan');
  log(`   Total Duration: ${formatDuration(duration)}`, 'cyan');
  
  log('\n📈 Data Summary:', 'bright');
  log(`   Financial Metrics: ${data.metricsCount}`, 'cyan');
  log(`   Calculated Metrics: ${data.calculatedCount}`, 'cyan');
  log(`   Narrative Chunks: ${data.chunksCount}`, 'cyan');
  log(`   Processed Filings: ${data.filingsCount}`, 'cyan');
  
  log('\n🌐 Access URLs:', 'bright');
  log(`   Workspace: http://localhost:3000/app/deals/workspace.html?ticker=${TICKER}`, 'cyan');
  log(`   Deal Dashboard: http://localhost:3000/app/deals/index.html`, 'cyan');
  
  log('\n✨ All Systems Operational!', 'green');
  log('='.repeat(80) + '\n', 'bright');
}

async function main() {
  const overallStartTime = Date.now();
  
  log('\n' + '='.repeat(80), 'bright');
  log('🚀 COMCAST (CMCSA) END-TO-END PIPELINE TEST', 'bright');
  log('='.repeat(80), 'bright');
  log(`\nTesting complete pipeline: Deal Creation → Processing → Verification`, 'cyan');
  log(`Ticker: ${TICKER} | Years: ${YEARS} | Max Wait: ${formatDuration(MAX_WAIT_TIME_MS)}`, 'cyan');

  let dealId;
  let dataStats;

  try {
    // Cleanup
    await cleanupExistingDeal();

    // Step 1: Create deal
    const deal = await createDeal();
    dealId = deal.id;

    // Step 2: Monitor pipeline
    await pollPipelineStatus(dealId);

    // Step 3: Verify deal status
    await verifyDealStatus(dealId);

    // Step 4: Verify data
    dataStats = await verifyDataAvailability();

    // Step 5: Verify workspace access
    await verifyWorkspaceAccess(dealId);

    // Step 6: Test chat
    await testChatFunctionality(dealId);

    // Generate summary
    const totalDuration = Date.now() - overallStartTime;
    await generateSummaryReport(dealId, dataStats, totalDuration);

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

    if (dealId) {
      log(`\nDeal ID: ${dealId}`, 'cyan');
      log(`Workspace: http://localhost:3000/app/deals/workspace.html?ticker=${TICKER}`, 'cyan');
      
      // Try to get current status
      try {
        const deal = await prisma.deal.findUnique({ where: { id: dealId } });
        if (deal) {
          log(`\nCurrent Status: ${deal.status}`, 'yellow');
          log(`Message: ${deal.processingMessage}`, 'yellow');
        }
      } catch (e) {
        // Ignore
      }
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
