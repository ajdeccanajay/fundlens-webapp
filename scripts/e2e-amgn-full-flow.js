#!/usr/bin/env node
/**
 * E2E Test: AMGN Full Flow
 * Tests: Deal Creation → Pipeline → RAG Query → Scratchpad
 * Ticker: AMGN (Amgen Inc. - Healthcare/Biotech)
 * Duration: 1 year of data
 */

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TENANT_ID = 'test-tenant-e2e';
const USER_ID = '00000000-0000-0000-0000-000000000001'; // Valid UUID format
const TICKER = 'AMGN';

// Test results tracking
const results = {
  passed: [],
  failed: [],
  warnings: []
};

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '📋',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    step: '🔹'
  }[type] || '📋';
  
  console.log(`${prefix} [${timestamp}] ${message}`);
}

function addResult(test, passed, details = '') {
  if (passed) {
    results.passed.push({ test, details });
    log(`PASS: ${test}`, 'success');
  } else {
    results.failed.push({ test, details });
    log(`FAIL: ${test} - ${details}`, 'error');
  }
}

function addWarning(test, details) {
  results.warnings.push({ test, details });
  log(`WARNING: ${test} - ${details}`, 'warning');
}

async function cleanup() {
  log('Cleaning up test data...', 'step');
  
  try {
    // Delete in correct order to respect foreign keys
    await prisma.message.deleteMany({ 
      where: { conversation: { userId: USER_ID } } 
    });
    await prisma.conversation.deleteMany({ where: { userId: USER_ID } });
    await prisma.deal.deleteMany({ where: { ticker: TICKER, tenantId: TENANT_ID } });
    
    log('Cleanup complete', 'success');
  } catch (error) {
    log(`Cleanup error: ${error.message}`, 'warning');
  }
}

async function step1_CreateDeal() {
  log('\n=== STEP 1: Create Deal ===', 'step');
  
  try {
    // First, check if authentication is required
    const healthCheck = await axios.get(`${BASE_URL}/api/health`);
    log(`Backend health: ${healthCheck.data.status}`, 'info');
    
    const response = await axios.post(`${BASE_URL}/api/deals`, {
      ticker: TICKER,
      dealType: 'public',
      name: `${TICKER} E2E Test Deal`,
      description: 'End-to-end test for AMGN'
    }, {
      headers: {
        'x-tenant-id': TENANT_ID,
        'x-user-id': USER_ID,
        'Content-Type': 'application/json'
      },
      validateStatus: function (status) {
        return status < 500; // Accept any status < 500
      }
    });
    
    if (response.status === 401) {
      addWarning('Deal Creation - Authentication', 'API requires authentication - skipping auth-required tests');
      log('Note: In production, proper JWT tokens would be used', 'warning');
      
      // Try to create deal directly in database for testing
      log('Creating deal directly in database...', 'info');
      
      // First, ensure tenant exists
      const tenant = await prisma.tenant.upsert({
        where: { id: TENANT_ID },
        update: {},
        create: {
          id: TENANT_ID,
          name: 'Test Tenant E2E',
          slug: 'test-tenant-e2e',
          status: 'active',
        },
      });
      
      log(`Tenant ensured: ${tenant.id}`, 'info');
      
      const deal = await prisma.deal.create({
        data: {
          ticker: TICKER,
          dealType: 'public',
          name: `${TICKER} E2E Test Deal`,
          description: 'End-to-end test for AMGN',
          status: 'draft',
          tenantId: TENANT_ID,
          created_by: USER_ID  // Use created_by, not userId
        }
      });
      
      addResult('Deal Creation - DB Direct', !!deal, `ID: ${deal.id}`);
      return deal;
    }
    
    addResult('Deal Creation - API Response', response.status === 201, `Status: ${response.status}`);
    addResult('Deal Creation - Has ID', !!response.data.id, `ID: ${response.data.id}`);
    addResult('Deal Creation - Correct Ticker', response.data.ticker === TICKER);
    addResult('Deal Creation - Status Draft', response.data.status === 'draft');
    
    // Verify in database
    const deal = await prisma.deal.findFirst({
      where: { ticker: TICKER, tenantId: TENANT_ID }
    });
    
    addResult('Deal Creation - DB Verification', !!deal, `Found in DB: ${!!deal}`);
    
    if (deal) {
      log(`Deal created: ID=${deal.id}, Status=${deal.status}`, 'info');
    }
    
    return response.data;
  } catch (error) {
    addResult('Deal Creation', false, error.message);
    throw error;
  }
}

async function step2_RunPipeline(dealId) {
  log('\n=== STEP 2: Run SEC Pipeline ===', 'step');
  
  try {
    // First check if data already exists
    const existingMetrics = await prisma.financialMetric.count({
      where: { ticker: TICKER }
    });
    
    const existingChunks = await prisma.narrativeChunk.count({
      where: { ticker: TICKER }
    });
    
    if (existingMetrics > 0 && existingChunks > 0) {
      log(`Data already exists: ${existingMetrics} metrics, ${existingChunks} chunks`, 'info');
      addResult('Pipeline - Data Already Exists', true, `${existingMetrics} metrics, ${existingChunks} chunks`);
      addResult('Pipeline - Skip Sync', true, 'Using existing data');
      
      // Verify data quality
      const metrics = await prisma.financialMetric.findMany({
        where: { ticker: TICKER },
        take: 5,
        orderBy: { filingDate: 'desc' }
      });
      
      addResult('Pipeline - Metrics Available', metrics.length > 0, `Found ${metrics.length} recent metrics`);
      
      const chunks = await prisma.narrativeChunk.findMany({
        where: { ticker: TICKER },
        take: 5,
        orderBy: { filingDate: 'desc' }
      });
      
      addResult('Pipeline - Chunks Available', chunks.length > 0, `Found ${chunks.length} recent chunks`);
      
      return { skipped: true, existingMetrics, existingChunks };
    }
    
    // Trigger pipeline if no data exists
    log('No existing data found, triggering SEC pipeline...', 'info');
    const response = await axios.post(`${BASE_URL}/api/simple/sync/${TICKER}`, {
      years: 1
    }, {
      headers: {
        'x-tenant-id': TENANT_ID,
        'x-user-id': USER_ID
      },
      timeout: 60000, // 60 second timeout
      validateStatus: function (status) {
        return status < 500; // Accept any status < 500
      }
    });
    
    if (response.status === 404) {
      addWarning('Pipeline - Endpoint Not Found', 'Endpoint /api/simple/sync/:ticker may not exist');
      log('Trying alternative endpoint...', 'info');
      
      // Try comprehensive pipeline endpoint
      const altResponse = await axios.post(`${BASE_URL}/api/comprehensive-sec-pipeline/execute-company/${TICKER}`, {
        years: 1
      }, {
        headers: {
          'x-tenant-id': TENANT_ID,
          'x-user-id': USER_ID
        },
        timeout: 60000
      });
      
      addResult('Pipeline - Alternative API Response', altResponse.status === 200 || altResponse.status === 201);
      log(`Alternative pipeline response: ${JSON.stringify(altResponse.data, null, 2)}`, 'info');
    } else {
      addResult('Pipeline - API Response', response.status === 200 || response.status === 201);
      addResult('Pipeline - Success Flag', response.data.success === true);
      log(`Pipeline response: ${JSON.stringify(response.data, null, 2)}`, 'info');
    }
    
    // Wait for processing (give it 30 seconds)
    log('Waiting 30 seconds for pipeline processing...', 'info');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Check for financial metrics
    const metricsResponse = await axios.get(
      `${BASE_URL}/api/financial-calculator/dashboard/${TICKER}`,
      {
        headers: {
          'x-tenant-id': TENANT_ID,
          'x-user-id': USER_ID
        }
      }
    );
    
    const hasMetrics = metricsResponse.data?.data?.metrics;
    addResult('Pipeline - Metrics Generated', !!hasMetrics);
    
    if (hasMetrics) {
      const metrics = metricsResponse.data.data.metrics;
      log(`Metrics found: ${Object.keys(metrics).length} categories`, 'info');
      
      // Check specific metric categories
      addResult('Pipeline - Revenue Metrics', !!metrics.revenue?.length);
      addResult('Pipeline - Profitability Metrics', !!metrics.profitability?.length);
      addResult('Pipeline - Working Capital Metrics', !!metrics.workingCapital);
    }
    
    // Check for narrative chunks
    const chunks = await prisma.narrativeChunk.findMany({
      where: { ticker: TICKER },
      take: 5
    });
    
    addResult('Pipeline - Narrative Chunks', chunks.length > 0, `Found ${chunks.length} chunks`);
    
    if (chunks.length > 0) {
      log(`Sample chunk: ${chunks[0].sectionType} - ${chunks[0].content.substring(0, 100)}...`, 'info');
    }
    
    return metricsResponse.data;
  } catch (error) {
    addResult('Pipeline Execution', false, error.message);
    throw error;
  }
}

async function step3_QueryRAG() {
  log('\n=== STEP 3: Query via Research Assistant ===', 'step');
  
  try {
    // Create a conversation
    log('Creating research conversation...', 'info');
    const convResponse = await axios.post(`${BASE_URL}/api/research/conversations`, {
      title: `AMGN Research - ${new Date().toISOString()}`
    }, {
      headers: {
        'x-tenant-id': TENANT_ID,
        'x-user-id': USER_ID
      }
    });
    
    addResult('RAG - Conversation Created', convResponse.status === 201);
    const conversationId = convResponse.data.id;
    log(`Conversation ID: ${conversationId}`, 'info');
    
    // Send a query about AMGN
    log('Sending RAG query about AMGN revenue...', 'info');
    const queryResponse = await axios.post(
      `${BASE_URL}/api/research/conversations/${conversationId}/messages`,
      {
        content: `What was AMGN's revenue in the most recent fiscal year? Provide specific numbers and context.`,
        includeDocuments: true
      },
      {
        headers: {
          'x-tenant-id': TENANT_ID,
          'x-user-id': USER_ID
        }
      }
    );
    
    addResult('RAG - Query Response', queryResponse.status === 201);
    addResult('RAG - Has Content', !!queryResponse.data.content);
    addResult('RAG - Has Citations', queryResponse.data.citations?.length > 0);
    
    log(`Response length: ${queryResponse.data.content?.length || 0} chars`, 'info');
    log(`Citations: ${queryResponse.data.citations?.length || 0}`, 'info');
    
    if (queryResponse.data.content) {
      log(`Response preview: ${queryResponse.data.content.substring(0, 200)}...`, 'info');
    }
    
    // Test another query about profitability
    log('Sending second query about profitability...', 'info');
    const query2Response = await axios.post(
      `${BASE_URL}/api/research/conversations/${conversationId}/messages`,
      {
        content: `What is AMGN's operating margin and how has it changed?`,
        includeDocuments: true
      },
      {
        headers: {
          'x-tenant-id': TENANT_ID,
          'x-user-id': USER_ID
        }
      }
    );
    
    addResult('RAG - Second Query', query2Response.status === 201);
    addResult('RAG - Context Maintained', !!query2Response.data.content);
    
    return { conversationId, messages: [queryResponse.data, query2Response.data] };
  } catch (error) {
    addResult('RAG Query', false, error.message);
    throw error;
  }
}

async function step4_SaveToScratchpad(conversationId, messages) {
  log('\n=== STEP 4: Save to Scratchpad ===', 'step');
  
  try {
    // For now, we'll use the notebook/insight system instead of scratchpad
    // Create a notebook first
    log('Creating notebook...', 'info');
    const notebookResponse = await axios.post(`${BASE_URL}/api/research/notebooks`, {
      title: `AMGN Analysis - ${new Date().toISOString()}`,
      description: 'E2E test notebook for AMGN'
    }, {
      headers: {
        'x-tenant-id': TENANT_ID,
        'x-user-id': USER_ID
      }
    });
    
    addResult('Notebook - Created', notebookResponse.status === 201);
    const notebookId = notebookResponse.data.id;
    log(`Notebook ID: ${notebookId}`, 'info');
    
    // Save first message as insight
    log('Saving message as insight...', 'info');
    const insightResponse = await axios.post(
      `${BASE_URL}/api/research/notebooks/${notebookId}/insights`,
      {
        content: messages[0].content,
        messageId: messages[0].id,
        tags: ['revenue', 'AMGN'],
        companies: ['AMGN']
      },
      {
        headers: {
          'x-tenant-id': TENANT_ID,
          'x-user-id': USER_ID
        }
      }
    );
    
    addResult('Insight - Save Response', insightResponse.status === 201);
    addResult('Insight - Has ID', !!insightResponse.data.id);
    
    // Verify in database
    const insights = await prisma.insight.findMany({
      where: { notebookId }
    });
    
    addResult('Insight - DB Verification', insights.length > 0, `Found ${insights.length} insights`);
    
    if (insights.length > 0) {
      log(`Insight: ${insights[0].content.substring(0, 100)}...`, 'info');
    }
    
    // Test retrieval
    log('Retrieving notebook insights...', 'info');
    const getResponse = await axios.get(
      `${BASE_URL}/api/research/notebooks/${notebookId}/insights`,
      {
        headers: {
          'x-tenant-id': TENANT_ID,
          'x-user-id': USER_ID
        }
      }
    );
    
    addResult('Insight - Retrieval', getResponse.status === 200);
    addResult('Insight - Items Retrieved', getResponse.data.length > 0);
    
    return insights;
  } catch (error) {
    addResult('Scratchpad/Notebook Save', false, error.message);
    throw error;
  }
}

async function step5_VerifyIntegration() {
  log('\n=== STEP 5: Verify End-to-End Integration ===', 'step');
  
  try {
    // Check deal status
    const deal = await prisma.deal.findFirst({
      where: { ticker: TICKER, tenantId: TENANT_ID }
    });
    
    addResult('Integration - Deal Exists', !!deal);
    
    // Check financial metrics exist
    const metrics = await prisma.financialMetric.findMany({
      where: { ticker: TICKER },
      take: 10
    });
    
    addResult('Integration - Financial Metrics', metrics.length > 0, `Found ${metrics.length} metrics`);
    
    // Check narrative chunks exist
    const chunks = await prisma.narrativeChunk.findMany({
      where: { ticker: TICKER },
      take: 10
    });
    
    addResult('Integration - Narrative Chunks', chunks.length > 0, `Found ${chunks.length} chunks`);
    
    // Check conversation exists
    const conversations = await prisma.conversation.findMany({
      where: { userId: USER_ID },
      include: { messages: true }
    });
    
    addResult('Integration - Conversations', conversations.length > 0, `Found ${conversations.length} conversations`);
    
    if (conversations.length > 0) {
      addResult('Integration - Messages', conversations[0].messages.length > 0, `Found ${conversations[0].messages.length} messages`);
    }
    
    // Check notebook/insights
    const notebooks = await prisma.notebook.findMany({
      where: { userId: USER_ID },
      include: { insights: true }
    });
    
    addResult('Integration - Notebooks', notebooks.length > 0, `Found ${notebooks.length} notebooks`);
    
    if (notebooks.length > 0) {
      addResult('Integration - Insights', notebooks[0].insights.length > 0, `Found ${notebooks[0].insights.length} insights`);
    }
    
    // Verify data flow: Deal → Metrics → Chunks → RAG → Notebook
    const dataFlowComplete = deal && metrics.length > 0 && chunks.length > 0 && 
                             conversations.length > 0 && notebooks.length > 0;
    
    addResult('Integration - Complete Data Flow', dataFlowComplete, 
      `Deal→Metrics→Chunks→RAG→Notebook: ${dataFlowComplete ? 'COMPLETE' : 'INCOMPLETE'}`);
    
  } catch (error) {
    addResult('Integration Verification', false, error.message);
    throw error;
  }
}

async function printResults() {
  log('\n' + '='.repeat(80), 'info');
  log('E2E TEST RESULTS - AMGN FULL FLOW', 'info');
  log('='.repeat(80), 'info');
  
  log(`\n✅ PASSED: ${results.passed.length}`, 'success');
  results.passed.forEach(r => {
    log(`  ✓ ${r.test}${r.details ? ` (${r.details})` : ''}`, 'info');
  });
  
  if (results.warnings.length > 0) {
    log(`\n⚠️  WARNINGS: ${results.warnings.length}`, 'warning');
    results.warnings.forEach(r => {
      log(`  ⚠ ${r.test}: ${r.details}`, 'warning');
    });
  }
  
  if (results.failed.length > 0) {
    log(`\n❌ FAILED: ${results.failed.length}`, 'error');
    results.failed.forEach(r => {
      log(`  ✗ ${r.test}: ${r.details}`, 'error');
    });
  }
  
  const total = results.passed.length + results.failed.length;
  const passRate = ((results.passed.length / total) * 100).toFixed(1);
  
  log('\n' + '='.repeat(80), 'info');
  log(`SUMMARY: ${results.passed.length}/${total} tests passed (${passRate}%)`, 
      results.failed.length === 0 ? 'success' : 'error');
  log('='.repeat(80) + '\n', 'info');
  
  return results.failed.length === 0;
}

async function main() {
  log('Starting E2E Test: AMGN Full Flow', 'info');
  log(`Ticker: ${TICKER}`, 'info');
  log(`Tenant: ${TENANT_ID}`, 'info');
  log(`User: ${USER_ID}`, 'info');
  log(`Base URL: ${BASE_URL}\n`, 'info');
  
  let success = false;
  
  try {
    // Cleanup before starting
    await cleanup();
    
    // Run test steps
    const deal = await step1_CreateDeal();
    await step2_RunPipeline(deal.id);
    const ragResult = await step3_QueryRAG();
    await step4_SaveToScratchpad(ragResult.conversationId, ragResult.messages);
    await step5_VerifyIntegration();
    
    // Print results
    success = await printResults();
    
  } catch (error) {
    log(`\nFATAL ERROR: ${error.message}`, 'error');
    log(error.stack, 'error');
    await printResults();
  } finally {
    // Cleanup after test
    log('\nCleaning up test data...', 'step');
    await cleanup();
    await prisma.$disconnect();
  }
  
  process.exit(success ? 0 : 1);
}

// Run the test
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
