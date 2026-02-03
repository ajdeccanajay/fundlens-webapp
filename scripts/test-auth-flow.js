#!/usr/bin/env node

/**
 * Test Cognito Authentication Flow
 */

const https = require('https');

const BASE_URL = 'https://app.fundlens.ai';
const COGNITO_REGION = 'us-east-1';
const USER_POOL_ID = 'us-east-1_4OYqnpE18';
const CLIENT_ID = '4s4k1usimlqkr6sk55gbva183s';

console.log('🔐 Testing Authentication Flow');
console.log('================================\n');

// Test 1: Check Cognito Configuration
console.log('1️⃣  Checking Cognito User Pool...');
const AWS = require('child_process').execSync;

try {
  const users = AWS('aws cognito-idp list-users --user-pool-id us-east-1_4OYqnpE18 --region us-east-1 --query "Users[*].{Username:Username,Status:UserStatus}" --output json', {encoding: 'utf8'});
  const userList = JSON.parse(users);
  console.log(`   ✅ Found ${userList.length} users in Cognito`);
  userList.forEach(u => {
    console.log(`      - ${u.Username}: ${u.Status}`);
  });
} catch (error) {
  console.log('   ❌ Error checking Cognito:', error.message);
}

console.log('');

// Test 2: Check if login page loads
console.log('2️⃣  Testing Login Page...');
https.get(`${BASE_URL}/login.html`, (res) => {
  if (res.statusCode === 200) {
    console.log('   ✅ Login page accessible');
  } else {
    console.log(`   ⚠️  Login page returned status ${res.statusCode}`);
  }
}).on('error', (e) => {
  console.log('   ❌ Error:', e.message);
});

// Test 3: Check deal dashboard (requires auth)
setTimeout(() => {
  console.log('');
  console.log('3️⃣  Testing Deal Dashboard...');
  https.get(`${BASE_URL}/app/deals/index.html`, (res) => {
    if (res.statusCode === 200) {
      console.log('   ✅ Deal dashboard accessible');
    } else {
      console.log(`   ⚠️  Deal dashboard returned status ${res.statusCode}`);
    }
    
    console.log('');
    console.log('✅ Authentication flow test complete!');
    console.log('');
    console.log('📝 Manual Testing Required:');
    console.log('   1. Visit https://app.fundlens.ai/login.html');
    console.log('   2. Login with: ajay.swamy@fundlens.ai');
    console.log('   3. Verify redirect to deal dashboard');
    console.log('   4. Create a test deal');
    console.log('   5. Run a RAG query');
  }).on('error', (e) => {
    console.log('   ❌ Error:', e.message);
  });
}, 1000);
