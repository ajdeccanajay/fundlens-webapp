/**
 * End-to-end test for Multi-Ticker Peer Comparison feature
 * 
 * Tests:
 * 1. Peer comparison intent detection
 * 2. Peer identification from tenant deals
 * 3. Multi-ticker RAG query
 * 4. Response with peer metadata
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
  
  // Create fake signature (not validated in dev mode)
  const signature = 'fake_signature_for_testing';
  
  return `${base64url(header)}.${base64url(payload)}.${signature}`;
}

const AUTH_TOKEN = generateTestToken();

async function createConversation() {
  console.log('📝 Creating conversation...');
  const response = await fetch(`${BASE_URL}/api/research/conversations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify({ title: 'Peer Comparison Test' })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Create conversation failed: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  console.log(`✅ Created conversation: ${data.data.id}`);
  return data.data.id;
}

async function sendPeerComparisonQuery(conversationId, query, ticker) {
  console.log(`\n🔍 Sending query: "${query}"`);
  console.log(`   Ticker context: ${ticker}`);
  
  const response = await fetch(`${BASE_URL}/api/research/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify({
      content: query,
      context: { tickers: [ticker] }
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Send message failed: ${response.status} - ${errorText}`);
  }
  
  // Parse SSE response
  const text = await response.text();
  const lines = text.split('\n');
  
  let content = '';
  let peerComparison = null;
  let citations = [];
  let currentEvent = null;
  
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.substring(7).trim();
    } else if (line.startsWith('data: ')) {
      try {
        const data = JSON.parse(line.substring(6).trim());
        
        if (currentEvent === 'token' && data.text) {
          content += data.text;
        } else if (currentEvent === 'peerComparison') {
          peerComparison = data;
        } else if (currentEvent === 'citations') {
          citations = data.citations || [];
        }
      } catch (e) {
        // Skip parse errors
      }
    }
  }
  
  return { content, peerComparison, citations };
}

async function runTests() {
  console.log('🧪 Starting Peer Comparison E2E Tests\n');
  console.log('='.repeat(60));
  console.log(`Using test token for tenant: ${DEFAULT_TENANT_ID}`);
  
  try {
    // Create conversation
    const conversationId = await createConversation();
    
    // Test 1: Peer comparison query with "peers" keyword
    console.log('\n' + '='.repeat(60));
    console.log('TEST 1: Query with "peers" keyword');
    console.log('='.repeat(60));
    
    const result1 = await sendPeerComparisonQuery(
      conversationId,
      'How does NVDA compare to its peers in terms of revenue growth?',
      'NVDA'
    );
    
    console.log('\n📊 Results:');
    console.log(`   Content length: ${result1.content.length} chars`);
    console.log(`   Has peer comparison metadata: ${!!result1.peerComparison}`);
    
    if (result1.peerComparison) {
      console.log(`   Primary ticker: ${result1.peerComparison.primaryTicker}`);
      console.log(`   Peers included: ${result1.peerComparison.peersIncluded?.join(', ') || 'none'}`);
      console.log(`   Missing peers: ${result1.peerComparison.missingPeers?.map(p => p.ticker).join(', ') || 'none'}`);
    }
    
    // Test 2: Query with "competitors" keyword
    console.log('\n' + '='.repeat(60));
    console.log('TEST 2: Query with "competitors" keyword');
    console.log('='.repeat(60));
    
    const result2 = await sendPeerComparisonQuery(
      conversationId,
      'What are the main competitors and how do their margins compare?',
      'AMZN'
    );
    
    console.log('\n📊 Results:');
    console.log(`   Content length: ${result2.content.length} chars`);
    console.log(`   Has peer comparison metadata: ${!!result2.peerComparison}`);
    
    if (result2.peerComparison) {
      console.log(`   Primary ticker: ${result2.peerComparison.primaryTicker}`);
      console.log(`   Peers included: ${result2.peerComparison.peersIncluded?.join(', ') || 'none'}`);
      console.log(`   Missing peers: ${result2.peerComparison.missingPeers?.map(p => p.ticker).join(', ') || 'none'}`);
    }
    
    // Test 3: Non-peer query (should NOT have peer comparison)
    console.log('\n' + '='.repeat(60));
    console.log('TEST 3: Non-peer query (control test)');
    console.log('='.repeat(60));
    
    const result3 = await sendPeerComparisonQuery(
      conversationId,
      'What is the revenue for the latest fiscal year?',
      'AAPL'
    );
    
    console.log('\n📊 Results:');
    console.log(`   Content length: ${result3.content.length} chars`);
    console.log(`   Has peer comparison metadata: ${!!result3.peerComparison}`);
    
    if (result3.peerComparison) {
      console.log('   ⚠️ WARNING: Non-peer query returned peer comparison metadata!');
    } else {
      console.log('   ✅ Correctly no peer comparison for non-peer query');
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📋 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const test1Pass = result1.peerComparison !== null;
    const test2Pass = result2.peerComparison !== null;
    const test3Pass = result3.peerComparison === null;
    
    console.log(`   Test 1 (peers keyword): ${test1Pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Test 2 (competitors keyword): ${test2Pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Test 3 (non-peer query): ${test3Pass ? '✅ PASS' : '❌ FAIL'}`);
    
    const allPass = test1Pass && test2Pass && test3Pass;
    console.log(`\n   Overall: ${allPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
    
    process.exit(allPass ? 0 : 1);
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    process.exit(1);
  }
}

runTests();
