#!/usr/bin/env node

/**
 * Comprehensive Metric Accuracy Test Suite
 * Tests that the system returns the CORRECT metrics for various queries
 */

const http = require('http');

// Test cases covering different metrics and scenarios
const testCases = [
  {
    name: 'Single Metric - Revenue',
    query: "What is NVDA's revenue?",
    expectedMetrics: ['total_revenue'],
    unexpectedMetrics: ['net_income'],
  },
  {
    name: 'Single Metric - Net Income',
    query: "What is AAPL's net income?",
    expectedMetrics: ['net_income'],
    unexpectedMetrics: ['total_revenue'],
  },
  {
    name: 'Single Metric - Cash',
    query: "What is MSFT's cash position?",
    expectedMetrics: ['cash', 'cash_and_equivalents', 'cash_and_cash_equivalents'],
    unexpectedMetrics: ['net_income', 'total_revenue'],
  },
  {
    name: 'Single Metric - Total Assets',
    query: "What are AMZN's total assets?",
    expectedMetrics: ['total_assets'],
    unexpectedMetrics: ['net_income', 'total_revenue'],
  },
  {
    name: 'Multiple Metrics - Revenue and Net Income',
    query: "What is TSLA's revenue and net income?",
    expectedMetrics: ['total_revenue', 'net_income'],
    unexpectedMetrics: ['cash', 'total_assets'],
  },
  {
    name: 'Multiple Metrics - Revenue and Gross Profit',
    query: "Show me GOOGL's revenue and gross profit",
    expectedMetrics: ['total_revenue', 'gross_profit'],
    unexpectedMetrics: ['net_income'],
  },
  {
    name: 'Hybrid Query - Revenue with Narrative',
    query: "What is NVDA's revenue and key risks?",
    expectedMetrics: ['total_revenue'],
    unexpectedMetrics: ['net_income'],
  },
  {
    name: 'Comparison Query - Revenue',
    query: "Compare AAPL and MSFT revenue",
    expectedMetrics: ['total_revenue'],
    unexpectedMetrics: ['net_income'],
  },
];

let passedTests = 0;
let failedTests = 0;
const results = [];

async function runTest(testCase) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      query: testCase.query,
    });

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/rag/query',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          // Extract returned metrics
          const returnedMetrics = new Set();
          if (response.metrics) {
            response.metrics.forEach(m => {
              returnedMetrics.add(m.normalizedMetric.toLowerCase());
            });
          }

          // Check if expected metrics are present
          const hasExpectedMetrics = testCase.expectedMetrics.some(expected => 
            returnedMetrics.has(expected.toLowerCase())
          );

          // Check if unexpected metrics are absent
          const hasUnexpectedMetrics = testCase.unexpectedMetrics.some(unexpected => 
            returnedMetrics.has(unexpected.toLowerCase())
          );

          const passed = hasExpectedMetrics && !hasUnexpectedMetrics;

          const result = {
            name: testCase.name,
            query: testCase.query,
            passed,
            returnedMetrics: Array.from(returnedMetrics),
            expectedMetrics: testCase.expectedMetrics,
            unexpectedMetrics: testCase.unexpectedMetrics,
            hasExpectedMetrics,
            hasUnexpectedMetrics,
            metricsCount: response.metrics?.length || 0,
          };

          if (passed) {
            passedTests++;
            console.log(`✅ PASS: ${testCase.name}`);
          } else {
            failedTests++;
            console.log(`❌ FAIL: ${testCase.name}`);
            console.log(`   Expected: ${testCase.expectedMetrics.join(', ')}`);
            console.log(`   Got: ${Array.from(returnedMetrics).join(', ')}`);
            if (hasUnexpectedMetrics) {
              console.log(`   ⚠️  Contains unexpected metrics!`);
            }
          }

          results.push(result);
          resolve(result);
        } catch (error) {
          console.error(`❌ ERROR: ${testCase.name} - ${error.message}`);
          failedTests++;
          results.push({
            name: testCase.name,
            query: testCase.query,
            passed: false,
            error: error.message,
          });
          resolve(null);
        }
      });
    });

    req.on('error', (error) => {
      console.error(`❌ ERROR: ${testCase.name} - ${error.message}`);
      failedTests++;
      results.push({
        name: testCase.name,
        query: testCase.query,
        passed: false,
        error: error.message,
      });
      resolve(null);
    });

    req.write(postData);
    req.end();
  });
}

async function runAllTests() {
  console.log('\n🧪 Running Metric Accuracy Test Suite\n');
  console.log(`Total tests: ${testCases.length}\n`);

  for (const testCase of testCases) {
    await runTest(testCase);
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Results Summary');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${passedTests}/${testCases.length}`);
  console.log(`❌ Failed: ${failedTests}/${testCases.length}`);
  console.log(`Success Rate: ${((passedTests / testCases.length) * 100).toFixed(1)}%`);
  console.log('='.repeat(60) + '\n');

  // Show detailed failures
  if (failedTests > 0) {
    console.log('❌ Failed Tests Details:\n');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`Test: ${r.name}`);
      console.log(`Query: "${r.query}"`);
      console.log(`Expected: ${r.expectedMetrics?.join(', ') || 'N/A'}`);
      console.log(`Got: ${r.returnedMetrics?.join(', ') || 'ERROR'}`);
      if (r.error) {
        console.log(`Error: ${r.error}`);
      }
      console.log('');
    });
  }

  // Exit with appropriate code
  process.exit(failedTests > 0 ? 1 : 0);
}

runAllTests();
