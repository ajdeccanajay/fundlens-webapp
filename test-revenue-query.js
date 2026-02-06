#!/usr/bin/env node

/**
 * Test script to trace the "revenue" query flow
 * This will help us see exactly what's happening at each step
 */

const http = require('http');

const query = "What is NVDA's revenue and key risks?";

console.log(`\n🔍 Testing query: "${query}"\n`);

const postData = JSON.stringify({
  query: query,
  tenantId: 'test-tenant'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/rag/query',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers: ${JSON.stringify(res.headers)}\n`);

  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      console.log('\n📊 Response:');
      console.log(JSON.stringify(response, null, 2));
      
      // Check if we got revenue or net income
      if (response.structuredData && response.structuredData.metrics) {
        console.log('\n🔍 Metrics returned:');
        response.structuredData.metrics.forEach(m => {
          console.log(`  - ${m.normalizedMetric}: ${m.value} (${m.fiscalPeriod})`);
        });
      }
    } catch (error) {
      console.error('Failed to parse response:', error.message);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('Request failed:', error.message);
});

req.write(postData);
req.end();
