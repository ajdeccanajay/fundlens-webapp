/**
 * Manual API Test for Research Assistant
 * 
 * Tests the Research Assistant API endpoints manually.
 * Run with: node scripts/test-research-api.js
 */

const http = require('http');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const USER_ID = '00000000-0000-0000-0000-000000000001';

// Mock JWT token (for testing only)
const AUTH_TOKEN = 'mock-jwt-token';

let conversationId = null;

async function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Testing Research Assistant API\n');

  try {
    // Test 1: Create Conversation
    console.log('1️⃣  Creating conversation...');
    const createResponse = await makeRequest('POST', '/research/conversations', {
      title: 'API Test Conversation'
    });
    
    if (createResponse.status === 201 && createResponse.data.success) {
      conversationId = createResponse.data.data.id;
      console.log('✅ Created conversation:', conversationId);
    } else {
      console.log('❌ Failed to create conversation:', createResponse.status);
      return;
    }

    // Test 2: List Conversations
    console.log('\n2️⃣  Listing conversations...');
    const listResponse = await makeRequest('GET', '/research/conversations');
    
    if (listResponse.status === 200 && listResponse.data.success) {
      console.log(`✅ Found ${listResponse.data.data.length} conversations`);
    } else {
      console.log('❌ Failed to list conversations:', listResponse.status);
    }

    // Test 3: Get Conversation
    console.log('\n3️⃣  Getting conversation...');
    const getResponse = await makeRequest('GET', `/research/conversations/${conversationId}`);
    
    if (getResponse.status === 200 && getResponse.data.success) {
      console.log('✅ Retrieved conversation');
      console.log(`   Messages: ${getResponse.data.data.messages.length}`);
    } else {
      console.log('❌ Failed to get conversation:', getResponse.status);
    }

    // Test 4: Update Conversation
    console.log('\n4️⃣  Updating conversation...');
    const updateResponse = await makeRequest('PATCH', `/research/conversations/${conversationId}`, {
      title: 'Updated Title',
      isPinned: true
    });
    
    if (updateResponse.status === 200 && updateResponse.data.success) {
      console.log('✅ Updated conversation');
      console.log(`   Title: ${updateResponse.data.data.title}`);
      console.log(`   Pinned: ${updateResponse.data.data.isPinned}`);
    } else {
      console.log('❌ Failed to update conversation:', updateResponse.status);
    }

    // Test 5: Send Message (Note: This will stream, so we just check it starts)
    console.log('\n5️⃣  Sending message...');
    console.log('   (Streaming response - checking endpoint only)');
    const messageResponse = await makeRequest('POST', `/research/conversations/${conversationId}/messages`, {
      content: 'What is AAPL revenue?'
    });
    
    if (messageResponse.status === 200) {
      console.log('✅ Message endpoint responded');
    } else {
      console.log('❌ Failed to send message:', messageResponse.status);
    }

    // Test 6: Delete Conversation
    console.log('\n6️⃣  Deleting conversation...');
    const deleteResponse = await makeRequest('DELETE', `/research/conversations/${conversationId}`);
    
    if (deleteResponse.status === 200 && deleteResponse.data.success) {
      console.log('✅ Deleted conversation');
    } else {
      console.log('❌ Failed to delete conversation:', deleteResponse.status);
    }

    // Test 7: Verify Deletion
    console.log('\n7️⃣  Verifying deletion...');
    const verifyResponse = await makeRequest('GET', `/research/conversations/${conversationId}`);
    
    if (verifyResponse.status === 404) {
      console.log('✅ Conversation properly deleted (404)');
    } else {
      console.log('❌ Conversation still exists:', verifyResponse.status);
    }

    console.log('\n✅ All tests completed!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Check if server is running
console.log(`Testing API at: ${API_BASE}`);
console.log(`Tenant ID: ${TENANT_ID}`);
console.log(`User ID: ${USER_ID}\n`);

runTests();
