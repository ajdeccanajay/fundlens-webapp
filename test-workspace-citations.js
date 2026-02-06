#!/usr/bin/env node

/**
 * Test script to verify workspace research assistant citations
 * Tests that:
 * 1. Backend sends citations via SSE
 * 2. Citations have proper structure
 * 3. Response uses ## headers (not **bold**)
 */

const https = require('https');

// Test configuration
const TEST_CONFIG = {
  baseUrl: 'http://localhost:3000',
  ticker: 'NVDA',
  query: 'What are NVDA\'s risks?',
  // Use a test token - replace with actual token if needed
  token: process.env.TEST_TOKEN || 'test-token'
};

async function testWorkspaceCitations() {
  console.log('🧪 Testing Workspace Research Assistant Citations\n');
  console.log(`Query: "${TEST_CONFIG.query}"`);
  console.log(`Ticker: ${TEST_CONFIG.ticker}\n`);

  try {
    // Step 1: Create a conversation
    console.log('📝 Step 1: Creating conversation...');
    const conversationId = await createConversation();
    console.log(`✅ Conversation created: ${conversationId}\n`);

    // Step 2: Send message and stream response
    console.log('💬 Step 2: Sending message and streaming response...');
    await streamMessage(conversationId);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

async function createConversation() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      title: 'Test Citations',
      ticker: TEST_CONFIG.ticker
    });

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/research/conversations',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': `Bearer ${TEST_CONFIG.token}`
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 201) {
          const result = JSON.parse(body);
          resolve(result.id);
        } else {
          reject(new Error(`Failed to create conversation: ${res.statusCode} ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function streamMessage(conversationId) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      content: TEST_CONFIG.query,
      context: {
        tickers: [TEST_CONFIG.ticker]
      }
    });

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: `/api/research/conversations/${conversationId}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': `Bearer ${TEST_CONFIG.token}`
      }
    };

    let buffer = '';
    let currentEvent = null;
    let responseContent = '';
    let citations = [];
    let citationsReceived = false;

    const req = https.request(options, (res) => {
      console.log(`📡 Response status: ${res.statusCode}\n`);

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.substring(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.substring(6).trim();
              if (!jsonStr) continue;

              const data = JSON.parse(jsonStr);

              if (currentEvent === 'token' && data.text) {
                responseContent += data.text;
                process.stdout.write(data.text);
              } else if (currentEvent === 'citations' && data.citations) {
                citations = data.citations;
                citationsReceived = true;
                console.log(`\n\n📎 Citations received: ${citations.length}`);
                citations.forEach((c, i) => {
                  console.log(`   [${c.number || c.citationNumber}] ${c.ticker} ${c.filingType} ${c.fiscalPeriod} - ${c.section}`);
                });
              } else if (currentEvent === 'done' && data.complete) {
                console.log('\n\n✅ Stream complete\n');
                
                // Validate response
                console.log('🔍 Validation Results:');
                
                // Check for ## headers
                const hasProperHeaders = /^## /m.test(responseContent);
                console.log(`   ${hasProperHeaders ? '✅' : '❌'} Uses ## markdown headers: ${hasProperHeaders}`);
                
                // Check for **bold** headers (bad)
                const hasBoldHeaders = /^\*\*[^*]+\*\*$/m.test(responseContent);
                console.log(`   ${!hasBoldHeaders ? '✅' : '❌'} No **bold** headers: ${!hasBoldHeaders}`);
                
                // Check for citations
                const hasCitationNumbers = /\[\d+\]/.test(responseContent);
                console.log(`   ${hasCitationNumbers ? '✅' : '❌'} Has citation numbers [1], [2]: ${hasCitationNumbers}`);
                
                // Check citations received
                console.log(`   ${citationsReceived ? '✅' : '❌'} Citations event received: ${citationsReceived}`);
                console.log(`   ${citations.length > 0 ? '✅' : '❌'} Citations count: ${citations.length}`);
                
                if (hasProperHeaders && !hasBoldHeaders && hasCitationNumbers && citationsReceived && citations.length > 0) {
                  console.log('\n🎉 All checks passed!');
                  resolve();
                } else {
                  console.log('\n⚠️ Some checks failed - see details above');
                  resolve();
                }
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      });

      res.on('end', () => {
        if (!citationsReceived) {
          console.log('\n⚠️ Stream ended but no citations received');
        }
        resolve();
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Run test
testWorkspaceCitations();
