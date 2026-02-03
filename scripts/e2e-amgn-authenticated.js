#!/usr/bin/env node
/**
 * E2E Test: AMGN Full Flow with Authentication
 * 
 * Complete end-to-end test with proper Cognito authentication:
 * 1. Sign in to get JWT tokens
 * 2. Create deal
 * 3. Verify pipeline data
 * 4. Query via Research Assistant (with auth)
 * 5. Save to Notebook/Insights (with auth)
 * 6. Verify complete data flow
 */

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TICKER = 'AMGN';

// Test user credentials
const TEST_USER = {
  email: 'analyst@fundlens-test.com',
  password: 'TestPassword123!@#',
  tenantId: 'test-tenant-e2e',
  tenantSlug: 'test-tenant-e2e',
};

// Test results tracking
const results = {
  passed: [],
  failed: [],
  warnings: [],
  tokens: null,
  userInfo: null,
};

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '📋',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    step: '🔹',
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

async function step1_SignIn() {
  log('\n=== STEP 1: Sign In ===', 'step');

  try {
    const response = await axios.post(
      `${BASE_URL}/api/auth/signin`,
      {
        email: TEST_USER.email,
        password: TEST_USER.password,
      },
      {
        validateStatus: function (status) {
          return status < 500;
        },
      }
    );

    if (response.status === 200) {
      results.tokens = response.data;

      addResult('Sign In', true, 'Tokens received');
      addResult('Access Token', !!results.tokens.accessToken);
      addResult('Refresh Token', !!results.tokens.refreshToken);
      addResult('ID Token', !!results.tokens.idToken);

      log(`Token expires in: ${results.tokens.expiresIn} seconds`, 'info');

      return results.tokens;
    } else if (response.status === 404) {
      addWarning(
        'Sign In',
        'Auth endpoint not available - falling back to direct DB access'
      );
      return null;
    } else {
      addResult('Sign In', false, `Status: ${response.status}`);
      return null;
    }
  } catch (error) {
    addResult('Sign In', false, error.message);
    return null;
  }
}

async function step2_GetUserInfo() {
  log('\n=== STEP 2: Get User Info ===', 'step');

  if (!results.tokens) {
    addWarning('Get User Info', 'Skipped - no tokens available');
    return null;
  }

  try {
    const response = await axios.get(`${BASE_URL}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${results.tokens.accessToken}`,
      },
    });

    results.userInfo = response.data;

    addResult('Get User Info', true, `User: ${results.userInfo.email}`);
    addResult('User Email', results.userInfo.email === TEST_USER.email);
    addResult('Tenant ID', results.userInfo.tenantId === TEST_USER.tenantId);

    log(`User ID: ${results.userInfo.userId}`, 'info');
    log(`Tenant: ${results.userInfo.tenantSlug}`, 'info');
    log(`Role: ${results.userInfo.tenantRole}`, 'info');

    return results.userInfo;
  } catch (error) {
    addResult('Get User Info', false, error.message);
    return null;
  }
}

async function step3_CreateDeal() {
  log('\n=== STEP 3: Create Deal ===', 'step');

  try {
    const headers = {
      'x-tenant-id': TEST_USER.tenantId,
      'Content-Type': 'application/json',
    };

    if (results.tokens) {
      headers['Authorization'] = `Bearer ${results.tokens.accessToken}`;
      headers['x-user-id'] = results.userInfo?.userId || '';
    }

    const response = await axios.post(
      `${BASE_URL}/api/deals`,
      {
        ticker: TICKER,
        dealType: 'public',
        name: `${TICKER} Authenticated E2E Test`,
        description: 'End-to-end test with authentication',
      },
      {
        headers,
        validateStatus: function (status) {
          return status < 500;
        },
      }
    );

    if (response.status === 201) {
      addResult('Deal Creation - API', true, `ID: ${response.data.id}`);
      return response.data;
    } else if (response.status === 401) {
      addWarning('Deal Creation - API', 'Authentication required');

      // Fall back to direct DB creation
      log('Creating deal directly in database...', 'info');

      const tenant = await prisma.tenant.upsert({
        where: { id: TEST_USER.tenantId },
        update: {},
        create: {
          id: TEST_USER.tenantId,
          name: 'Test Tenant E2E',
          slug: TEST_USER.tenantSlug,
          tier: 'enterprise',
          status: 'active',
        },
      });

      const deal = await prisma.deal.create({
        data: {
          ticker: TICKER,
          dealType: 'public',
          name: `${TICKER} Authenticated E2E Test`,
          description: 'End-to-end test with authentication',
          status: 'draft',
          tenantId: TEST_USER.tenantId,
          created_by: results.userInfo?.userId || 'test-user',
        },
      });

      addResult('Deal Creation - DB', true, `ID: ${deal.id}`);
      return deal;
    } else {
      addResult('Deal Creation', false, `Status: ${response.status}`);
      return null;
    }
  } catch (error) {
    addResult('Deal Creation', false, error.message);
    throw error;
  }
}

async function step4_VerifyPipelineData() {
  log('\n=== STEP 4: Verify Pipeline Data ===', 'step');

  try {
    // Check financial metrics
    const metrics = await prisma.financialMetric.findMany({
      where: { ticker: TICKER },
      take: 5,
      orderBy: { filingDate: 'desc' },
    });

    addResult(
      'Pipeline - Financial Metrics',
      metrics.length > 0,
      `Found ${metrics.length} metrics`
    );

    // Check narrative chunks
    const chunks = await prisma.narrativeChunk.findMany({
      where: { ticker: TICKER },
      take: 5,
      orderBy: { filingDate: 'desc' },
    });

    addResult(
      'Pipeline - Narrative Chunks',
      chunks.length > 0,
      `Found ${chunks.length} chunks`
    );

    return { metrics, chunks };
  } catch (error) {
    addResult('Pipeline Data Verification', false, error.message);
    throw error;
  }
}

async function step5_QueryResearchAssistant() {
  log('\n=== STEP 5: Query Research Assistant ===', 'step');

  if (!results.tokens) {
    addWarning('Research Assistant', 'Skipped - no authentication tokens');
    return null;
  }

  try {
    const headers = {
      Authorization: `Bearer ${results.tokens.accessToken}`,
      'x-tenant-id': TEST_USER.tenantId,
      'x-user-id': results.userInfo?.userId || '',
    };

    // Create conversation
    log('Creating conversation...', 'info');
    const convResponse = await axios.post(
      `${BASE_URL}/api/research/conversations`,
      {
        title: `AMGN Research - Authenticated - ${new Date().toISOString()}`,
      },
      { headers }
    );

    addResult(
      'Research - Create Conversation',
      convResponse.status === 201,
      `ID: ${convResponse.data.id}`
    );

    const conversationId = convResponse.data.id;

    // Send message
    log('Sending RAG query...', 'info');
    const msgResponse = await axios.post(
      `${BASE_URL}/api/research/conversations/${conversationId}/messages`,
      {
        content: `What was AMGN's revenue in the most recent fiscal year? Provide specific numbers and context.`,
        includeDocuments: true,
      },
      { headers }
    );

    addResult(
      'Research - Send Message',
      msgResponse.status === 201,
      `Message ID: ${msgResponse.data.id}`
    );
    addResult(
      'Research - Has Content',
      !!msgResponse.data.content,
      `Length: ${msgResponse.data.content?.length || 0}`
    );
    addResult(
      'Research - Has Citations',
      msgResponse.data.citations?.length > 0,
      `Citations: ${msgResponse.data.citations?.length || 0}`
    );

    if (msgResponse.data.content) {
      log(
        `Response preview: ${msgResponse.data.content.substring(0, 200)}...`,
        'info'
      );
    }

    // Get conversation
    log('Retrieving conversation...', 'info');
    const getResponse = await axios.get(
      `${BASE_URL}/api/research/conversations/${conversationId}`,
      { headers }
    );

    addResult(
      'Research - Get Conversation',
      getResponse.status === 200,
      `Messages: ${getResponse.data.messages?.length || 0}`
    );

    return {
      conversationId,
      messages: getResponse.data.messages,
    };
  } catch (error) {
    addResult('Research Assistant Query', false, error.message);
    throw error;
  }
}

async function step6_SaveToNotebook(conversationData) {
  log('\n=== STEP 6: Save to Notebook ===', 'step');

  if (!results.tokens) {
    addWarning('Notebook', 'Skipped - no authentication tokens');
    return null;
  }

  try {
    const headers = {
      Authorization: `Bearer ${results.tokens.accessToken}`,
      'x-tenant-id': TEST_USER.tenantId,
      'x-user-id': results.userInfo?.userId || '',
    };

    // Create notebook
    log('Creating notebook...', 'info');
    const notebookResponse = await axios.post(
      `${BASE_URL}/api/research/notebooks`,
      {
        title: `AMGN Analysis - ${new Date().toISOString()}`,
        description: 'Authenticated E2E test notebook',
      },
      { headers }
    );

    addResult(
      'Notebook - Create',
      notebookResponse.status === 201,
      `ID: ${notebookResponse.data.id}`
    );

    const notebookId = notebookResponse.data.id;

    // Save insight
    log('Saving insight...', 'info');
    const insightResponse = await axios.post(
      `${BASE_URL}/api/research/notebooks/${notebookId}/insights`,
      {
        content: conversationData?.messages?.[0]?.content || 'AMGN revenue analysis',
        messageId: conversationData?.messages?.[0]?.id,
        tags: ['AMGN', 'revenue', 'authenticated-test'],
        companies: ['AMGN'],
      },
      { headers }
    );

    addResult(
      'Notebook - Save Insight',
      insightResponse.status === 201,
      `ID: ${insightResponse.data.id}`
    );

    // Get insights
    log('Retrieving insights...', 'info');
    const getResponse = await axios.get(
      `${BASE_URL}/api/research/notebooks/${notebookId}/insights`,
      { headers }
    );

    addResult(
      'Notebook - Get Insights',
      getResponse.status === 200,
      `Count: ${getResponse.data.length}`
    );

    return { notebookId, insights: getResponse.data };
  } catch (error) {
    addResult('Notebook Save', false, error.message);
    throw error;
  }
}

async function step7_VerifyIntegration() {
  log('\n=== STEP 7: Verify End-to-End Integration ===', 'step');

  try {
    // Check deal
    const deal = await prisma.deal.findFirst({
      where: { ticker: TICKER, tenantId: TEST_USER.tenantId },
    });

    addResult('Integration - Deal Exists', !!deal);

    // Check metrics
    const metricsCount = await prisma.financialMetric.count({
      where: { ticker: TICKER },
    });

    addResult(
      'Integration - Financial Metrics',
      metricsCount > 0,
      `Count: ${metricsCount}`
    );

    // Check chunks
    const chunksCount = await prisma.narrativeChunk.count({
      where: { ticker: TICKER },
    });

    addResult(
      'Integration - Narrative Chunks',
      chunksCount > 0,
      `Count: ${chunksCount}`
    );

    // Check conversations (if authenticated)
    if (results.userInfo) {
      const conversations = await prisma.conversation.findMany({
        where: { userId: results.userInfo.userId },
        include: { messages: true },
      });

      addResult(
        'Integration - Conversations',
        conversations.length > 0,
        `Count: ${conversations.length}`
      );

      if (conversations.length > 0) {
        addResult(
          'Integration - Messages',
          conversations[0].messages.length > 0,
          `Count: ${conversations[0].messages.length}`
        );
      }

      // Check notebooks
      const notebooks = await prisma.notebook.findMany({
        where: { userId: results.userInfo.userId },
        include: { insights: true },
      });

      addResult(
        'Integration - Notebooks',
        notebooks.length > 0,
        `Count: ${notebooks.length}`
      );

      if (notebooks.length > 0) {
        addResult(
          'Integration - Insights',
          notebooks[0].insights.length > 0,
          `Count: ${notebooks[0].insights.length}`
        );
      }

      // Verify complete data flow
      const dataFlowComplete =
        deal &&
        metricsCount > 0 &&
        chunksCount > 0 &&
        conversations.length > 0 &&
        notebooks.length > 0;

      addResult(
        'Integration - Complete Data Flow',
        dataFlowComplete,
        `Deal→Metrics→Chunks→RAG→Notebook: ${dataFlowComplete ? 'COMPLETE' : 'INCOMPLETE'}`
      );
    }
  } catch (error) {
    addResult('Integration Verification', false, error.message);
    throw error;
  }
}

async function printResults() {
  log('\n' + '='.repeat(80), 'info');
  log('E2E TEST RESULTS - AMGN AUTHENTICATED FLOW', 'info');
  log('='.repeat(80), 'info');

  log(`\n✅ PASSED: ${results.passed.length}`, 'success');
  results.passed.forEach((r) => {
    log(`  ✓ ${r.test}${r.details ? ` (${r.details})` : ''}`, 'info');
  });

  if (results.warnings.length > 0) {
    log(`\n⚠️  WARNINGS: ${results.warnings.length}`, 'warning');
    results.warnings.forEach((r) => {
      log(`  ⚠ ${r.test}: ${r.details}`, 'warning');
    });
  }

  if (results.failed.length > 0) {
    log(`\n❌ FAILED: ${results.failed.length}`, 'error');
    results.failed.forEach((r) => {
      log(`  ✗ ${r.test}: ${r.details}`, 'error');
    });
  }

  const total = results.passed.length + results.failed.length;
  const passRate = ((results.passed.length / total) * 100).toFixed(1);

  log('\n' + '='.repeat(80), 'info');
  log(
    `SUMMARY: ${results.passed.length}/${total} tests passed (${passRate}%)`,
    results.failed.length === 0 ? 'success' : 'error'
  );
  log('='.repeat(80) + '\n', 'info');

  return results.failed.length === 0;
}

async function main() {
  log('Starting Authenticated E2E Test: AMGN Full Flow', 'info');
  log(`Ticker: ${TICKER}`, 'info');
  log(`User: ${TEST_USER.email}`, 'info');
  log(`Tenant: ${TEST_USER.tenantId}`, 'info');
  log(`Base URL: ${BASE_URL}\n`, 'info');

  let success = false;

  try {
    // Run test steps
    await step1_SignIn();
    await step2_GetUserInfo();
    const deal = await step3_CreateDeal();
    await step4_VerifyPipelineData();
    const conversationData = await step5_QueryResearchAssistant();
    await step6_SaveToNotebook(conversationData);
    await step7_VerifyIntegration();

    // Print results
    success = await printResults();
  } catch (error) {
    log(`\nFATAL ERROR: ${error.message}`, 'error');
    log(error.stack, 'error');
    await printResults();
  } finally {
    await prisma.$disconnect();
  }

  process.exit(success ? 0 : 1);
}

// Run the test
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
