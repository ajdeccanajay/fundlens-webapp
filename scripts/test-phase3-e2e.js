#!/usr/bin/env node
/**
 * Phase 3 Advanced Retrieval End-to-End Test
 * 
 * Tests the Phase 3 integration via the Research Assistant API
 * which is used by workspace.html's Research tab.
 * 
 * Test queries designed to exercise:
 * 1. HyDE (Hypothetical Document Embeddings)
 * 2. Query Decomposition
 * 3. Contextual Expansion
 * 4. Iterative Retrieval
 * 
 * Note: Reranking is DISABLED (Cohere Rerank 3.5 not available in us-east-1)
 */

const BASE_URL = 'http://localhost:3000';

// Default tenant ID for platform administration (from tenant-context.ts)
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Generate a mock JWT token for testing
 * This creates a base64-encoded JWT that the TenantGuard will decode
 */
function generateTestToken() {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  
  const payload = {
    sub: '11111111-1111-1111-1111-111111111111', // Must be valid UUID
    'custom:tenant_id': DEFAULT_TENANT_ID,
    'custom:tenant_slug': 'default',
    'custom:tenant_role': 'admin',
    email: 'test@fundlens.ai',
    username: 'test@fundlens.ai',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
  };
  
  // Base64url encode
  const base64url = (obj) => {
    return Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };
  
  // Create unsigned JWT (signature doesn't matter for decode-only mode)
  return `${base64url(header)}.${base64url(payload)}.test-signature`;
}

const AUTH_TOKEN = generateTestToken();

// Test queries designed to exercise different Phase 3 techniques
const TEST_QUERIES = [
  {
    name: 'HyDE Test - Competitive Intelligence',
    query: 'Who are NVDA\'s main competitors in the GPU market?',
    ticker: 'NVDA',
    expectedTechniques: ['hyde', 'contextual_expansion'],
    description: 'Should use HyDE to generate hypothetical answer about competitors'
  },
  {
    name: 'Query Decomposition Test - Multi-faceted',
    query: 'What is Apple\'s revenue and how does it compare to Microsoft\'s growth rate?',
    ticker: 'AAPL',
    expectedTechniques: ['query_decomposition'],
    description: 'Should decompose into sub-queries for revenue and growth comparison'
  },
  {
    name: 'Contextual Expansion Test - Risk Factors',
    query: 'What are the main risk factors for AMZN?',
    ticker: 'AMZN',
    expectedTechniques: ['contextual_expansion'],
    description: 'Should expand retrieved chunks with adjacent context'
  },
  {
    name: 'Iterative Retrieval Test - Specific Topic',
    query: 'What is NVDA\'s revenue recognition policy for gaming products?',
    ticker: 'NVDA',
    expectedTechniques: ['iterative_retrieval'],
    description: 'May need iterative retrieval if initial results are low confidence'
  },
  {
    name: 'Standard Query - Simple',
    query: 'What is NVDA\'s total revenue?',
    ticker: 'NVDA',
    expectedTechniques: ['standard'],
    description: 'Simple query that may not need advanced techniques'
  }
];

// Regression test queries to ensure existing functionality still works
const REGRESSION_QUERIES = [
  {
    name: 'Regression - Basic Financial Query',
    query: 'What is NVDA\'s net income?',
    ticker: 'NVDA',
    description: 'Basic financial query should still work'
  },
  {
    name: 'Regression - MD&A Query',
    query: 'What are NVDA\'s growth drivers?',
    ticker: 'NVDA',
    description: 'MD&A intelligence query should still work'
  },
  {
    name: 'Regression - Risk Factors Query',
    query: 'What are the operational risks for NVDA?',
    ticker: 'NVDA',
    description: 'Risk factors query should still work'
  }
];

async function createConversation(ticker) {
  const response = await fetch(`${BASE_URL}/api/research/conversations`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify({
      title: `Phase 3 Test - ${ticker}`,
      context: { tickers: [ticker] }
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create conversation: ${response.status} - ${errorText}`);
  }
  
  const result = await response.json();
  return result.data || result;
}

async function sendMessage(conversationId, message, ticker) {
  const startTime = Date.now();
  
  const response = await fetch(`${BASE_URL}/api/research/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify({
      content: message,
      context: { tickers: [ticker] }
    })
  });
  
  const latencyMs = Date.now() - startTime;
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send message: ${response.status} - ${errorText}`);
  }
  
  // Handle SSE response - collect all chunks
  const text = await response.text();
  
  // Parse SSE events
  let content = '';
  let citations = [];
  
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data:')) {
      try {
        const data = JSON.parse(line.substring(5).trim());
        if (data.text) {
          content += data.text;
        }
        if (data.citations) {
          citations = data.citations;
        }
      } catch (e) {
        // Ignore parse errors for non-JSON data
      }
    }
  }
  
  return { content, citations, latencyMs };
}

async function runTest(test, isRegression = false) {
  const testType = isRegression ? 'REGRESSION' : 'PHASE 3';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${testType}] ${test.name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Query: "${test.query}"`);
  console.log(`Ticker: ${test.ticker}`);
  console.log(`Description: ${test.description}`);
  if (test.expectedTechniques) {
    console.log(`Expected Techniques: ${test.expectedTechniques.join(', ')}`);
  }
  console.log('-'.repeat(60));
  
  try {
    // Create conversation
    const conversation = await createConversation(test.ticker);
    console.log(`✅ Created conversation: ${conversation.id}`);
    
    // Send message
    console.log('📤 Sending query...');
    const result = await sendMessage(conversation.id, test.query, test.ticker);
    
    // Analyze result
    console.log(`\n📊 Results:`);
    console.log(`   Latency: ${result.latencyMs}ms`);
    console.log(`   Response length: ${result.content?.length || 0} chars`);
    
    // Check if response has content
    if (result.content && result.content.length > 0) {
      console.log(`   ✅ Got response`);
      
      // Show first 300 chars of response
      const preview = result.content.substring(0, 300);
      console.log(`\n   Response preview:`);
      console.log(`   "${preview}${result.content.length > 300 ? '...' : ''}"`);
      
      // Check for citations
      if (result.citations && result.citations.length > 0) {
        console.log(`\n   📚 Citations: ${result.citations.length}`);
      }
      
      // Check latency SLA (< 5 seconds)
      if (result.latencyMs < 5000) {
        console.log(`   ✅ Latency within SLA (< 5s)`);
      } else {
        console.log(`   ⚠️ Latency exceeded SLA: ${result.latencyMs}ms > 5000ms`);
      }
      
      return { success: true, latencyMs: result.latencyMs, responseLength: result.content.length };
    } else {
      console.log(`   ❌ Empty response`);
      return { success: false, error: 'Empty response' };
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('🚀 Phase 3 Advanced Retrieval End-to-End Test');
  console.log('='.repeat(60));
  console.log('Testing via Research Assistant API (workspace.html Research tab)');
  console.log('');
  console.log('Phase 3 Techniques:');
  console.log('  - HyDE: ENABLED');
  console.log('  - Query Decomposition: ENABLED');
  console.log('  - Contextual Expansion: ENABLED');
  console.log('  - Iterative Retrieval: ENABLED');
  console.log('  - Reranking: DISABLED (Cohere not available in us-east-1)');
  console.log('');
  
  // Check server health
  try {
    const healthResponse = await fetch(`${BASE_URL}/api/health`);
    if (!healthResponse.ok) {
      console.log('❌ Server not healthy. Please start the server first.');
      process.exit(1);
    }
    console.log('✅ Server is healthy');
  } catch (error) {
    console.log('❌ Cannot connect to server. Please start with: npm run start:dev');
    process.exit(1);
  }
  
  const results = {
    phase3: [],
    regression: []
  };
  
  // Run Phase 3 tests
  console.log('\n\n📋 PHASE 3 TESTS');
  console.log('Testing advanced retrieval techniques...');
  
  for (const test of TEST_QUERIES) {
    const result = await runTest(test, false);
    results.phase3.push({ name: test.name, ...result });
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Run regression tests
  console.log('\n\n📋 REGRESSION TESTS');
  console.log('Ensuring existing functionality still works...');
  
  for (const test of REGRESSION_QUERIES) {
    const result = await runTest(test, true);
    results.regression.push({ name: test.name, ...result });
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Summary
  console.log('\n\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  
  const phase3Passed = results.phase3.filter(r => r.success).length;
  const phase3Total = results.phase3.length;
  const regressionPassed = results.regression.filter(r => r.success).length;
  const regressionTotal = results.regression.length;
  
  console.log(`\nPhase 3 Tests: ${phase3Passed}/${phase3Total} passed`);
  results.phase3.forEach(r => {
    const status = r.success ? '✅' : '❌';
    const latency = r.latencyMs ? ` (${r.latencyMs}ms)` : '';
    console.log(`  ${status} ${r.name}${latency}`);
  });
  
  console.log(`\nRegression Tests: ${regressionPassed}/${regressionTotal} passed`);
  results.regression.forEach(r => {
    const status = r.success ? '✅' : '❌';
    const latency = r.latencyMs ? ` (${r.latencyMs}ms)` : '';
    console.log(`  ${status} ${r.name}${latency}`);
  });
  
  // Calculate average latency
  const allSuccessful = [...results.phase3, ...results.regression].filter(r => r.success && r.latencyMs);
  if (allSuccessful.length > 0) {
    const avgLatency = Math.round(allSuccessful.reduce((sum, r) => sum + r.latencyMs, 0) / allSuccessful.length);
    console.log(`\nAverage Latency: ${avgLatency}ms`);
  }
  
  // Overall result
  const allPassed = phase3Passed === phase3Total && regressionPassed === regressionTotal;
  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED');
  } else {
    console.log('❌ SOME TESTS FAILED');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
