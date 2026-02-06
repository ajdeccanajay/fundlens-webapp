#!/usr/bin/env node

/**
 * Test Research Assistant Sources Fix
 * 
 * This script tests that sources are properly formatted with valid data
 * and that undefined values don't appear in the response.
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

async function testResearchSources() {
  console.log('🧪 Testing Research Assistant Sources Fix\n');
  
  // Test credentials
  const email = 'admin@fundlens.com';
  const password = 'admin123';
  
  try {
    // Step 1: Login
    console.log('1️⃣ Logging in...');
    const loginResponse = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    if (!loginResponse.ok) {
      throw new Error(`Login failed: ${loginResponse.status}`);
    }
    
    const { token } = await loginResponse.json();
    console.log('✅ Logged in successfully\n');
    
    // Step 2: Create a conversation
    console.log('2️⃣ Creating conversation...');
    const convResponse = await fetch(`${API_BASE_URL}/research/conversations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'Sources Test' })
    });
    
    if (!convResponse.ok) {
      throw new Error(`Create conversation failed: ${convResponse.status}`);
    }
    
    const { data: conversation } = await convResponse.json();
    console.log(`✅ Created conversation: ${conversation.id}\n`);
    
    // Step 3: Send a test query
    console.log('3️⃣ Sending test query: "What is NVDA revenue?"');
    const messageResponse = await fetch(
      `${API_BASE_URL}/research/conversations/${conversation.id}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: 'What is NVDA revenue?'
        })
      }
    );
    
    if (!messageResponse.ok) {
      throw new Error(`Send message failed: ${messageResponse.status}`);
    }
    
    // Step 4: Parse streaming response
    console.log('4️⃣ Parsing streaming response...\n');
    const reader = messageResponse.body.getReader();
    const decoder = new TextDecoder();
    
    let sources = [];
    let hasUndefinedSources = false;
    let responseText = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));
            
            if (data.text) {
              responseText += data.text;
            } else if (data.title) {
              // Source received
              sources.push(data);
              
              // Check for undefined values
              if (data.title.includes('undefined') || 
                  data.ticker === undefined || 
                  data.filingType === undefined) {
                hasUndefinedSources = true;
                console.log('❌ Found source with undefined values:', data);
              } else {
                console.log(`✅ Valid source: ${data.title}`);
              }
            } else if (data.complete) {
              console.log('\n5️⃣ Response complete\n');
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
    
    // Step 5: Verify results
    console.log('📊 Test Results:');
    console.log(`   - Total sources: ${sources.length}`);
    console.log(`   - Has undefined sources: ${hasUndefinedSources ? '❌ YES' : '✅ NO'}`);
    console.log(`   - Response length: ${responseText.length} chars`);
    
    if (sources.length > 0) {
      console.log('\n📄 Source Details:');
      sources.forEach((source, i) => {
        console.log(`   ${i + 1}. ${source.title}`);
        console.log(`      - Ticker: ${source.ticker}`);
        console.log(`      - Filing: ${source.filingType}`);
        console.log(`      - Period: ${source.fiscalPeriod || 'N/A'}`);
      });
    }
    
    // Step 6: Cleanup
    console.log('\n6️⃣ Cleaning up...');
    await fetch(`${API_BASE_URL}/research/conversations/${conversation.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('✅ Conversation deleted\n');
    
    // Final verdict
    if (hasUndefinedSources) {
      console.log('❌ TEST FAILED: Found sources with undefined values');
      process.exit(1);
    } else {
      console.log('✅ TEST PASSED: All sources have valid data');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testResearchSources();
