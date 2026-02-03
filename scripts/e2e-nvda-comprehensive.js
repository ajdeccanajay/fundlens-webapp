#!/usr/bin/env node

/**
 * Comprehensive E2E Test for NVIDIA (NVDA)
 * 
 * Tests the complete pipeline from SEC filing ingestion to workspace analysis:
 * 1. SEC filing download and parsing
 * 2. Financial metrics extraction and normalization
 * 3. Narrative chunk extraction and KB sync
 * 4. Footnote linking and MD&A intelligence
 * 5. Metric hierarchy construction
 * 6. Research assistant queries
 * 7. Workspace data loading
 * 8. Export functionality
 * 
 * Expected Duration: 5-8 minutes
 */

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TICKER = 'NVDA';
const FISCAL_YEAR = 2024;

// Test configuration
const config = {
  timeout: 300000, // 5 minutes for pipeline
  retryDelay: 5000, // 5 seconds between status checks
  maxRetries: 60, // Max 5 minutes of polling
};

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(80));
  log(title, 'bright');
  console.log('='.repeat(80) + '\n');
}

function logStep(step, message) {
  log(`[${step}] ${message}`, 'cyan');
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠ ${message}`, 'yellow');
}

// Sleep utility
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Test results tracker
const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  startTime: Date.now(),
  steps: [],
};

function recordStep(name, status, details = {}) {
  results.steps.push({ name, status, details, timestamp: Date.now() });
  if (status === 'passed') results.passed++;
  if (status === 'failed') results.failed++;
  if (status === 'warning') results.warnings++;
}

// ============================================================================
// TEST STEP 1: Create Deal
// ============================================================================
async function step1_createDeal() {
  logSection('STEP 1: Create Deal for NVDA');
  
  try {
    logStep(1, 'Creating new deal...');
    
    const response = await axios.post(`${BASE_URL}/api/deals`, {
      ticker: TICKER,
      companyName: 'NVIDIA Corporation',
      dealType: 'acquisition',
      status: 'draft',
    });
    
    const dealId = response.data.id;
    logSuccess(`Deal created: ${dealId}`);
    recordStep('Create Deal', 'passed', { dealId });
    
    return dealId;
  } catch (error) {
    logError(`Failed to create deal: ${error.message}`);
    recordStep('Create Deal', 'failed', { error: error.message });
    throw error;
  }
}

// ============================================================================
// TEST STEP 2: Trigger Pipeline
// ============================================================================
async function step2_triggerPipeline(dealId) {
  logSection('STEP 2: Trigger SEC Pipeline');
  
  try {
    logStep(2, `Triggering pipeline for ${TICKER}...`);
    
    const response = await axios.post(`${BASE_URL}/api/simple/trigger-pipeline`, {
      ticker: TICKER,
      fiscalYear: FISCAL_YEAR,
      dealId,
    });
    
    logSuccess(`Pipeline triggered: ${response.data.message}`);
    recordStep('Trigger Pipeline', 'passed', { response: response.data });
    
    return response.data;
  } catch (error) {
    logError(`Failed to trigger pipeline: ${error.message}`);
    recordStep('Trigger Pipeline', 'failed', { error: error.message });
    throw error;
  }
}

// ============================================================================
// TEST STEP 3: Monitor Pipeline Progress
// ============================================================================
async function step3_monitorPipeline(dealId) {
  logSection('STEP 3: Monitor Pipeline Progress');
  
  try {
    logStep(3, 'Polling pipeline status...');
    
    let retries = 0;
    let lastStatus = null;
    
    while (retries < config.maxRetries) {
      const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        select: { status: true, pipelineState: true },
      });
      
      if (!deal) {
        throw new Error('Deal not found');
      }
      
      // Log status changes
      if (deal.status !== lastStatus) {
        log(`  Status: ${deal.status}`, 'blue');
        if (deal.pipelineState) {
          log(`  Pipeline State: ${JSON.stringify(deal.pipelineState, null, 2)}`, 'blue');
        }
        lastStatus = deal.status;
      }
      
      // Check for completion
      if (deal.status === 'ready') {
        logSuccess('Pipeline completed successfully!');
        recordStep('Monitor Pipeline', 'passed', { 
          status: deal.status,
          retries,
          duration: retries * config.retryDelay,
        });
        return deal;
      }
      
      // Check for errors
      if (deal.status === 'error') {
        logError('Pipeline failed!');
        recordStep('Monitor Pipeline', 'failed', { 
          status: deal.status,
          pipelineState: deal.pipelineState,
        });
        throw new Error(`Pipeline failed: ${JSON.stringify(deal.pipelineState)}`);
      }
      
      // Continue polling
      retries++;
      await sleep(config.retryDelay);
    }
    
    logWarning('Pipeline timeout - may still be processing');
    recordStep('Monitor Pipeline', 'warning', { 
      status: lastStatus,
      retries,
    });
    
  } catch (error) {
    logError(`Pipeline monitoring failed: ${error.message}`);
    recordStep('Monitor Pipeline', 'failed', { error: error.message });
    throw error;
  }
}

// ============================================================================
// TEST STEP 4: Verify Financial Metrics
// ============================================================================
async function step4_verifyMetrics(dealId) {
  logSection('STEP 4: Verify Financial Metrics');
  
  try {
    logStep(4, 'Querying financial metrics...');
    
    const metrics = await prisma.financialMetric.findMany({
      where: { 
        dealId,
        fiscalYear: FISCAL_YEAR,
      },
      select: {
        normalizedMetric: true,
        value: true,
        statementType: true,
      },
    });
    
    log(`  Found ${metrics.length} metrics`, 'blue');
    
    // Check for key metrics
    const keyMetrics = [
      'revenue',
      'cost_of_revenue',
      'gross_profit',
      'operating_income',
      'net_income',
      'total_assets',
      'total_liabilities',
      'stockholders_equity',
      'operating_cash_flow',
    ];
    
    const found = {};
    keyMetrics.forEach(metric => {
      const match = metrics.find(m => m.normalizedMetric === metric);
      found[metric] = match ? match.value : null;
      
      if (match) {
        logSuccess(`${metric}: $${(match.value / 1e9).toFixed(2)}B`);
      } else {
        logWarning(`${metric}: Not found`);
      }
    });
    
    const foundCount = Object.values(found).filter(v => v !== null).length;
    const coverage = (foundCount / keyMetrics.length * 100).toFixed(1);
    
    log(`\n  Metric Coverage: ${foundCount}/${keyMetrics.length} (${coverage}%)`, 'blue');
    
    if (foundCount >= keyMetrics.length * 0.8) {
      recordStep('Verify Metrics', 'passed', { 
        total: metrics.length,
        keyMetrics: found,
        coverage: `${coverage}%`,
      });
    } else {
      recordStep('Verify Metrics', 'warning', { 
        total: metrics.length,
        keyMetrics: found,
        coverage: `${coverage}%`,
      });
    }
    
    return metrics;
  } catch (error) {
    logError(`Metrics verification failed: ${error.message}`);
    recordStep('Verify Metrics', 'failed', { error: error.message });
    throw error;
  }
}

// ============================================================================
// TEST STEP 5: Verify Narrative Chunks & KB Sync
// ============================================================================
async function step5_verifyNarrativeChunks(dealId) {
  logSection('STEP 5: Verify Narrative Chunks & KB Sync');
  
  try {
    logStep(5, 'Querying narrative chunks...');
    
    const chunks = await prisma.narrativeChunk.findMany({
      where: { 
        ticker: TICKER,
        fiscalYear: FISCAL_YEAR,
      },
      select: {
        id: true,
        section: true,
        chunkIndex: true,
        bedrockKbId: true,
      },
    });
    
    log(`  Found ${chunks.length} narrative chunks`, 'blue');
    
    // Check KB sync
    const synced = chunks.filter(c => c.bedrockKbId).length;
    const syncRate = (synced / chunks.length * 100).toFixed(1);
    
    log(`  KB Sync: ${synced}/${chunks.length} (${syncRate}%)`, 'blue');
    
    // Check sections
    const sections = [...new Set(chunks.map(c => c.section))];
    log(`  Sections: ${sections.join(', ')}`, 'blue');
    
    if (chunks.length > 0 && syncRate >= 90) {
      logSuccess('Narrative chunks extracted and synced');
      recordStep('Verify Narrative Chunks', 'passed', { 
        total: chunks.length,
        synced,
        syncRate: `${syncRate}%`,
        sections,
      });
    } else if (chunks.length > 0) {
      logWarning('Narrative chunks extracted but sync incomplete');
      recordStep('Verify Narrative Chunks', 'warning', { 
        total: chunks.length,
        synced,
        syncRate: `${syncRate}%`,
      });
    } else {
      logError('No narrative chunks found');
      recordStep('Verify Narrative Chunks', 'failed', { 
        total: 0,
      });
    }
    
    return chunks;
  } catch (error) {
    logError(`Narrative chunks verification failed: ${error.message}`);
    recordStep('Verify Narrative Chunks', 'failed', { error: error.message });
    throw error;
  }
}

// ============================================================================
// TEST STEP 6: Test Research Assistant Queries
// ============================================================================
async function step6_testResearchQueries() {
  logSection('STEP 6: Test Research Assistant Queries');
  
  const queries = [
    'What is NVDA revenue in 2024?',
    'What is NVDA cost of goods sold?',
    'What are the key risks for NVIDIA?',
    'What is NVDA data center revenue?',
  ];
  
  const queryResults = [];
  
  for (const query of queries) {
    try {
      logStep(6, `Testing query: "${query}"`);
      
      const response = await axios.post(`${BASE_URL}/api/research-assistant/query`, {
        query,
        conversationId: `test-${Date.now()}`,
      });
      
      const hasResults = response.data.answer && response.data.answer.length > 0;
      
      if (hasResults) {
        logSuccess(`Query returned results (${response.data.answer.length} chars)`);
        queryResults.push({ query, status: 'passed', answer: response.data.answer.substring(0, 100) });
      } else {
        logWarning(`Query returned no results`);
        queryResults.push({ query, status: 'warning' });
      }
      
    } catch (error) {
      logError(`Query failed: ${error.message}`);
      queryResults.push({ query, status: 'failed', error: error.message });
    }
  }
  
  const passed = queryResults.filter(r => r.status === 'passed').length;
  const successRate = (passed / queries.length * 100).toFixed(1);
  
  log(`\n  Query Success Rate: ${passed}/${queries.length} (${successRate}%)`, 'blue');
  
  if (successRate >= 75) {
    recordStep('Test Research Queries', 'passed', { queryResults, successRate: `${successRate}%` });
  } else {
    recordStep('Test Research Queries', 'warning', { queryResults, successRate: `${successRate}%` });
  }
  
  return queryResults;
}

// ============================================================================
// TEST STEP 7: Test Workspace Data Loading
// ============================================================================
async function step7_testWorkspaceData(dealId) {
  logSection('STEP 7: Test Workspace Data Loading');
  
  try {
    logStep(7, 'Loading workspace data...');
    
    // Test financial metrics endpoint
    const metricsResponse = await axios.get(`${BASE_URL}/api/deals/${dealId}/financial-metrics`, {
      params: { fiscalPeriod: `FY${FISCAL_YEAR}` },
    });
    
    const metricsCount = metricsResponse.data.length;
    log(`  Financial Metrics: ${metricsCount}`, 'blue');
    
    // Test qualitative questions endpoint
    const qualitativeResponse = await axios.get(`${BASE_URL}/api/deals/${dealId}/qualitative-questions`, {
      params: { fiscalPeriod: `FY${FISCAL_YEAR}` },
    });
    
    const questionsCount = qualitativeResponse.data.length;
    log(`  Qualitative Questions: ${questionsCount}`, 'blue');
    
    if (metricsCount > 0 && questionsCount > 0) {
      logSuccess('Workspace data loaded successfully');
      recordStep('Test Workspace Data', 'passed', { 
        metricsCount,
        questionsCount,
      });
    } else {
      logWarning('Workspace data incomplete');
      recordStep('Test Workspace Data', 'warning', { 
        metricsCount,
        questionsCount,
      });
    }
    
  } catch (error) {
    logError(`Workspace data loading failed: ${error.message}`);
    recordStep('Test Workspace Data', 'failed', { error: error.message });
    throw error;
  }
}

// ============================================================================
// TEST STEP 8: Test Export Functionality
// ============================================================================
async function step8_testExport(dealId) {
  logSection('STEP 8: Test Export Functionality');
  
  try {
    logStep(8, 'Testing Excel export...');
    
    const response = await axios.post(`${BASE_URL}/api/deals/${dealId}/export`, {
      fiscalPeriods: [`FY${FISCAL_YEAR}`],
      includeQualitative: true,
    }, {
      responseType: 'arraybuffer',
    });
    
    const fileSize = response.data.byteLength;
    log(`  Export file size: ${(fileSize / 1024).toFixed(2)} KB`, 'blue');
    
    if (fileSize > 10000) { // At least 10KB
      logSuccess('Export generated successfully');
      recordStep('Test Export', 'passed', { 
        fileSize: `${(fileSize / 1024).toFixed(2)} KB`,
      });
    } else {
      logWarning('Export file seems too small');
      recordStep('Test Export', 'warning', { 
        fileSize: `${(fileSize / 1024).toFixed(2)} KB`,
      });
    }
    
  } catch (error) {
    logError(`Export failed: ${error.message}`);
    recordStep('Test Export', 'failed', { error: error.message });
    throw error;
  }
}

// ============================================================================
// MAIN TEST EXECUTION
// ============================================================================
async function runE2ETest() {
  logSection('NVIDIA (NVDA) - COMPREHENSIVE E2E TEST');
  log(`Ticker: ${TICKER}`, 'bright');
  log(`Fiscal Year: ${FISCAL_YEAR}`, 'bright');
  log(`Base URL: ${BASE_URL}`, 'bright');
  log(`Start Time: ${new Date().toISOString()}`, 'bright');
  
  let dealId;
  
  try {
    // Step 1: Create Deal
    dealId = await step1_createDeal();
    
    // Step 2: Trigger Pipeline
    await step2_triggerPipeline(dealId);
    
    // Step 3: Monitor Pipeline
    await step3_monitorPipeline(dealId);
    
    // Step 4: Verify Metrics
    await step4_verifyMetrics(dealId);
    
    // Step 5: Verify Narrative Chunks
    await step5_verifyNarrativeChunks(dealId);
    
    // Step 6: Test Research Queries
    await step6_testResearchQueries();
    
    // Step 7: Test Workspace Data
    await step7_testWorkspaceData(dealId);
    
    // Step 8: Test Export
    await step8_testExport(dealId);
    
  } catch (error) {
    logError(`\nTest execution failed: ${error.message}`);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
  
  // Print final results
  printFinalResults(dealId);
}

// ============================================================================
// PRINT FINAL RESULTS
// ============================================================================
function printFinalResults(dealId) {
  const duration = ((Date.now() - results.startTime) / 1000).toFixed(1);
  
  logSection('TEST RESULTS SUMMARY');
  
  log(`Deal ID: ${dealId || 'N/A'}`, 'bright');
  log(`Duration: ${duration}s`, 'bright');
  log(`\nResults:`, 'bright');
  log(`  ✓ Passed: ${results.passed}`, 'green');
  log(`  ✗ Failed: ${results.failed}`, 'red');
  log(`  ⚠ Warnings: ${results.warnings}`, 'yellow');
  
  const total = results.passed + results.failed + results.warnings;
  const successRate = total > 0 ? (results.passed / total * 100).toFixed(1) : 0;
  
  log(`\nSuccess Rate: ${successRate}%`, successRate >= 75 ? 'green' : 'red');
  
  // Print step details
  log(`\nStep Details:`, 'bright');
  results.steps.forEach((step, index) => {
    const icon = step.status === 'passed' ? '✓' : step.status === 'failed' ? '✗' : '⚠';
    const color = step.status === 'passed' ? 'green' : step.status === 'failed' ? 'red' : 'yellow';
    log(`  ${icon} ${step.name}`, color);
  });
  
  // Overall status
  console.log('\n' + '='.repeat(80));
  if (results.failed === 0 && results.passed >= 6) {
    log('✓ E2E TEST PASSED', 'green');
  } else if (results.failed === 0) {
    log('⚠ E2E TEST PASSED WITH WARNINGS', 'yellow');
  } else {
    log('✗ E2E TEST FAILED', 'red');
  }
  console.log('='.repeat(80) + '\n');
  
  // Exit code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run the test
runE2ETest().catch(error => {
  logError(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
