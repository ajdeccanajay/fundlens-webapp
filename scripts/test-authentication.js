#!/usr/bin/env node
/**
 * Automated Authentication Tests
 * 
 * Tests authentication flow and creates test users for E2E testing.
 * This script:
 * 1. Creates test users in Cognito
 * 2. Tests sign-in flow
 * 3. Tests token refresh
 * 4. Tests authenticated API calls
 * 5. Provides tokens for E2E tests
 */

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Test user credentials
const TEST_USERS = {
  admin: {
    email: 'admin@fundlens-test.com',
    password: 'TestPassword123!@#',
    tenantId: 'test-tenant-e2e',
    tenantSlug: 'test-tenant-e2e',
    tenantRole: 'admin',
  },
  analyst: {
    email: 'analyst@fundlens-test.com',
    password: 'TestPassword123!@#',
    tenantId: 'test-tenant-e2e',
    tenantSlug: 'test-tenant-e2e',
    tenantRole: 'analyst',
  },
};

// Test results tracking
const results = {
  passed: [],
  failed: [],
  warnings: [],
  tokens: {},
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

async function checkCognitoConfig() {
  log('\n=== Checking Cognito Configuration ===', 'step');

  const requiredEnvVars = [
    'COGNITO_USER_POOL_ID',
    'COGNITO_APP_CLIENT_ID',
    'COGNITO_REGION',
  ];

  const missing = requiredEnvVars.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    addWarning(
      'Cognito Configuration',
      `Missing env vars: ${missing.join(', ')}`
    );
    log(
      'Run: npm run setup:cognito to configure Cognito',
      'warning'
    );
    return false;
  }

  addResult('Cognito Configuration', true, 'All env vars present');
  return true;
}

async function ensureTenant() {
  log('\n=== Ensuring Test Tenant Exists ===', 'step');

  try {
    const tenant = await prisma.tenant.upsert({
      where: { id: TEST_USERS.admin.tenantId },
      update: {},
      create: {
        id: TEST_USERS.admin.tenantId,
        name: 'Test Tenant E2E',
        slug: TEST_USERS.admin.tenantSlug,
        tier: 'enterprise',
        status: 'active',
      },
    });

    addResult('Tenant Creation', true, `Tenant: ${tenant.slug}`);
    return tenant;
  } catch (error) {
    addResult('Tenant Creation', false, error.message);
    throw error;
  }
}

async function createTestUsers() {
  log('\n=== Creating Test Users ===', 'step');

  for (const [role, user] of Object.entries(TEST_USERS)) {
    try {
      log(`Creating ${role} user: ${user.email}`, 'info');

      const response = await axios.post(
        `${BASE_URL}/api/auth/admin/create-user`,
        {
          email: user.email,
          password: user.password,
          tenantId: user.tenantId,
          tenantSlug: user.tenantSlug,
          tenantRole: user.tenantRole,
        },
        {
          validateStatus: function (status) {
            return status < 500; // Accept any status < 500
          },
        }
      );

      if (response.status === 201) {
        addResult(
          `Create ${role} User`,
          true,
          `User ID: ${response.data.userId}`
        );
      } else if (response.status === 409) {
        addWarning(
          `Create ${role} User`,
          'User already exists'
        );
      } else if (response.status === 404) {
        addWarning(
          `Create ${role} User`,
          'Admin endpoint not available - user may need to be created manually'
        );
      } else {
        addResult(
          `Create ${role} User`,
          false,
          `Status: ${response.status}`
        );
      }
    } catch (error) {
      addResult(`Create ${role} User`, false, error.message);
    }
  }
}

async function testSignIn(role) {
  log(`\n=== Testing Sign In (${role}) ===`, 'step');

  const user = TEST_USERS[role];

  try {
    const response = await axios.post(
      `${BASE_URL}/api/auth/signin`,
      {
        email: user.email,
        password: user.password,
      },
      {
        validateStatus: function (status) {
          return status < 500;
        },
      }
    );

    if (response.status === 200) {
      const tokens = response.data;

      addResult(`Sign In (${role})`, true, 'Tokens received');
      addResult(
        `Access Token (${role})`,
        !!tokens.accessToken,
        `Length: ${tokens.accessToken?.length || 0}`
      );
      addResult(
        `Refresh Token (${role})`,
        !!tokens.refreshToken,
        `Length: ${tokens.refreshToken?.length || 0}`
      );
      addResult(
        `ID Token (${role})`,
        !!tokens.idToken,
        `Length: ${tokens.idToken?.length || 0}`
      );

      // Store tokens for later tests
      results.tokens[role] = tokens;

      return tokens;
    } else {
      addResult(
        `Sign In (${role})`,
        false,
        `Status: ${response.status} - ${JSON.stringify(response.data)}`
      );
      return null;
    }
  } catch (error) {
    addResult(`Sign In (${role})`, false, error.message);
    return null;
  }
}

async function testGetUserInfo(role, tokens) {
  log(`\n=== Testing Get User Info (${role}) ===`, 'step');

  try {
    const response = await axios.get(`${BASE_URL}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      validateStatus: function (status) {
        return status < 500;
      },
    });

    if (response.status === 200) {
      const userInfo = response.data;

      addResult(`Get User Info (${role})`, true, `User: ${userInfo.email}`);
      addResult(
        `User Email (${role})`,
        userInfo.email === TEST_USERS[role].email
      );
      addResult(
        `Tenant ID (${role})`,
        userInfo.tenantId === TEST_USERS[role].tenantId
      );
      addResult(
        `Tenant Role (${role})`,
        userInfo.tenantRole === TEST_USERS[role].tenantRole
      );

      return userInfo;
    } else {
      addResult(
        `Get User Info (${role})`,
        false,
        `Status: ${response.status}`
      );
      return null;
    }
  } catch (error) {
    addResult(`Get User Info (${role})`, false, error.message);
    return null;
  }
}

async function testResearchAssistantAPI(role, tokens) {
  log(`\n=== Testing Research Assistant API (${role}) ===`, 'step');

  const user = TEST_USERS[role];

  try {
    // Test 1: Create conversation
    log('Creating conversation...', 'info');
    const convResponse = await axios.post(
      `${BASE_URL}/api/research/conversations`,
      {
        title: `Auth Test - ${role} - ${new Date().toISOString()}`,
      },
      {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'x-tenant-id': user.tenantId,
          'x-user-id': tokens.idToken, // Use ID token as user ID
        },
        validateStatus: function (status) {
          return status < 500;
        },
      }
    );

    if (convResponse.status === 201) {
      addResult(
        `Create Conversation (${role})`,
        true,
        `ID: ${convResponse.data.id}`
      );

      const conversationId = convResponse.data.id;

      // Test 2: Send message
      log('Sending message...', 'info');
      const msgResponse = await axios.post(
        `${BASE_URL}/api/research/conversations/${conversationId}/messages`,
        {
          content: 'What was AMGN revenue in the most recent fiscal year?',
          includeDocuments: true,
        },
        {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            'x-tenant-id': user.tenantId,
            'x-user-id': tokens.idToken,
          },
          validateStatus: function (status) {
            return status < 500;
          },
        }
      );

      if (msgResponse.status === 201) {
        addResult(
          `Send Message (${role})`,
          true,
          `Message ID: ${msgResponse.data.id}`
        );
        addResult(
          `Message Has Content (${role})`,
          !!msgResponse.data.content,
          `Length: ${msgResponse.data.content?.length || 0}`
        );
        addResult(
          `Message Has Citations (${role})`,
          msgResponse.data.citations?.length > 0,
          `Citations: ${msgResponse.data.citations?.length || 0}`
        );
      } else {
        addResult(
          `Send Message (${role})`,
          false,
          `Status: ${msgResponse.status}`
        );
      }

      // Test 3: Get conversation
      log('Retrieving conversation...', 'info');
      const getResponse = await axios.get(
        `${BASE_URL}/api/research/conversations/${conversationId}`,
        {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            'x-tenant-id': user.tenantId,
            'x-user-id': tokens.idToken,
          },
          validateStatus: function (status) {
            return status < 500;
          },
        }
      );

      if (getResponse.status === 200) {
        addResult(
          `Get Conversation (${role})`,
          true,
          `Messages: ${getResponse.data.messages?.length || 0}`
        );
      } else {
        addResult(
          `Get Conversation (${role})`,
          false,
          `Status: ${getResponse.status}`
        );
      }

      return conversationId;
    } else {
      addResult(
        `Create Conversation (${role})`,
        false,
        `Status: ${convResponse.status} - ${JSON.stringify(convResponse.data)}`
      );
      return null;
    }
  } catch (error) {
    addResult(`Research Assistant API (${role})`, false, error.message);
    return null;
  }
}

async function testNotebookAPI(role, tokens) {
  log(`\n=== Testing Notebook API (${role}) ===`, 'step');

  const user = TEST_USERS[role];

  try {
    // Test 1: Create notebook
    log('Creating notebook...', 'info');
    const notebookResponse = await axios.post(
      `${BASE_URL}/api/research/notebooks`,
      {
        title: `Auth Test Notebook - ${role}`,
        description: 'Automated authentication test',
      },
      {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'x-tenant-id': user.tenantId,
          'x-user-id': tokens.idToken,
        },
        validateStatus: function (status) {
          return status < 500;
        },
      }
    );

    if (notebookResponse.status === 201) {
      addResult(
        `Create Notebook (${role})`,
        true,
        `ID: ${notebookResponse.data.id}`
      );

      const notebookId = notebookResponse.data.id;

      // Test 2: Create insight
      log('Creating insight...', 'info');
      const insightResponse = await axios.post(
        `${BASE_URL}/api/research/notebooks/${notebookId}/insights`,
        {
          content: 'AMGN revenue analysis from authenticated test',
          tags: ['AMGN', 'revenue', 'test'],
          companies: ['AMGN'],
        },
        {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            'x-tenant-id': user.tenantId,
            'x-user-id': tokens.idToken,
          },
          validateStatus: function (status) {
            return status < 500;
          },
        }
      );

      if (insightResponse.status === 201) {
        addResult(
          `Create Insight (${role})`,
          true,
          `ID: ${insightResponse.data.id}`
        );
      } else {
        addResult(
          `Create Insight (${role})`,
          false,
          `Status: ${insightResponse.status}`
        );
      }

      // Test 3: Get insights
      log('Retrieving insights...', 'info');
      const getResponse = await axios.get(
        `${BASE_URL}/api/research/notebooks/${notebookId}/insights`,
        {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            'x-tenant-id': user.tenantId,
            'x-user-id': tokens.idToken,
          },
          validateStatus: function (status) {
            return status < 500;
          },
        }
      );

      if (getResponse.status === 200) {
        addResult(
          `Get Insights (${role})`,
          true,
          `Count: ${getResponse.data.length}`
        );
      } else {
        addResult(
          `Get Insights (${role})`,
          false,
          `Status: ${getResponse.status}`
        );
      }

      return notebookId;
    } else {
      addResult(
        `Create Notebook (${role})`,
        false,
        `Status: ${notebookResponse.status}`
      );
      return null;
    }
  } catch (error) {
    addResult(`Notebook API (${role})`, false, error.message);
    return null;
  }
}

async function testTokenRefresh(role, tokens) {
  log(`\n=== Testing Token Refresh (${role}) ===`, 'step');

  const user = TEST_USERS[role];

  try {
    const response = await axios.post(
      `${BASE_URL}/api/auth/refresh`,
      {
        refreshToken: tokens.refreshToken,
        email: user.email,
      },
      {
        validateStatus: function (status) {
          return status < 500;
        },
      }
    );

    if (response.status === 200) {
      const newTokens = response.data;

      addResult(`Token Refresh (${role})`, true, 'New tokens received');
      addResult(
        `New Access Token (${role})`,
        !!newTokens.accessToken && newTokens.accessToken !== tokens.accessToken,
        'Token changed'
      );

      return newTokens;
    } else {
      addResult(
        `Token Refresh (${role})`,
        false,
        `Status: ${response.status}`
      );
      return null;
    }
  } catch (error) {
    addResult(`Token Refresh (${role})`, false, error.message);
    return null;
  }
}

async function printResults() {
  log('\n' + '='.repeat(80), 'info');
  log('AUTHENTICATION TEST RESULTS', 'info');
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

  // Print tokens for use in other tests
  if (Object.keys(results.tokens).length > 0) {
    log('\n📋 TOKENS FOR E2E TESTING:', 'info');
    for (const [role, tokens] of Object.entries(results.tokens)) {
      log(`\n${role.toUpperCase()} USER:`, 'info');
      log(`  Email: ${TEST_USERS[role].email}`, 'info');
      log(`  Access Token: ${tokens.accessToken.substring(0, 50)}...`, 'info');
      log(`  Expires In: ${tokens.expiresIn} seconds`, 'info');
    }
    log('', 'info');
  }

  return results.failed.length === 0;
}

async function main() {
  log('Starting Authentication Tests', 'info');
  log(`Base URL: ${BASE_URL}\n`, 'info');

  let success = false;

  try {
    // Check Cognito configuration
    const cognitoConfigured = await checkCognitoConfig();

    if (!cognitoConfigured) {
      log(
        '\n⚠️  Cognito not configured. Some tests will be skipped.',
        'warning'
      );
      log('Run: npm run setup:cognito to configure Cognito\n', 'warning');
    }

    // Ensure tenant exists
    await ensureTenant();

    // Create test users
    await createTestUsers();

    // Test authentication for each role
    for (const role of Object.keys(TEST_USERS)) {
      const tokens = await testSignIn(role);

      if (tokens) {
        await testGetUserInfo(role, tokens);
        await testResearchAssistantAPI(role, tokens);
        await testNotebookAPI(role, tokens);
        await testTokenRefresh(role, tokens);
      }
    }

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

// Run the tests
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
