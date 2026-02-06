#!/usr/bin/env node

/**
 * Test Script: Revenue Recognition Query Fix
 * 
 * Tests that the RAG system correctly routes "revenue recognition" queries
 * to BOTH Item 7 (MD&A) and Item 8 (Financial Statements) sections.
 * 
 * Usage: node scripts/test-revenue-recognition-fix.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const TENANT_ID = '00000000-0000-0000-0000-000000000000'; // Default tenant for testing

// Test queries that were previously failing
const TEST_QUERIES = [
  {
    query: "What is NVDA's revenue recognition policy?",
    expectedSections: ['item_7', 'item_8'],
    description: 'Revenue recognition policy query'
  },
  {
    query: "What is NVDA's revenue and what are their main risks?",
    expectedSections: ['item_7', 'item_1a'], // Revenue in Item 7, risks in Item 1A
    description: 'Hybrid query with revenue and risks'
  },
  {
    query: "Explain NVDA's accounting policies",
    expectedSections: ['item_7', 'item_8'],
    description: 'General accounting policies query'
  }
];

async function testQuery(testCase) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing: ${testCase.description}`);
  console.log(`Query: "${testCase.query}"`);
  console.log(`Expected sections: ${testCase.expectedSections.join(', ')}`);
  console.log(`${'='.repeat(80)}`);

  try {
    const response = await axios.post(
      `${BASE_URL}/api/rag/query`,
      {
        query: testCase.query,
        tenantId: TENANT_ID,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 second timeout
      }
    );

    const result = response.data;

    // Check if we got results
    if (!result.narratives || result.narratives.length === 0) {
      console.log('❌ FAILED: No narratives returned');
      return false;
    }

    console.log(`✅ Retrieved ${result.narratives.length} narratives`);

    // Check intent detection
    if (result.intent) {
      console.log(`\n📊 Intent Detection:`);
      console.log(`   Type: ${result.intent.type}`);
      console.log(`   Ticker: ${result.intent.ticker}`);
      console.log(`   Section Types: ${result.intent.sectionTypes?.join(', ') || 'none'}`);
      console.log(`   Subsection: ${result.intent.subsectionName || 'none'}`);
      console.log(`   Confidence: ${result.intent.confidence.toFixed(2)}`);

      // Verify expected sections are in the intent
      const intentSections = result.intent.sectionTypes || [];
      const hasExpectedSections = testCase.expectedSections.every(
        section => intentSections.includes(section)
      );

      if (!hasExpectedSections) {
        console.log(`\n⚠️  WARNING: Intent missing expected sections`);
        console.log(`   Expected: ${testCase.expectedSections.join(', ')}`);
        console.log(`   Got: ${intentSections.join(', ')}`);
      } else {
        console.log(`\n✅ Intent includes all expected sections`);
      }
    }

    // Check narrative sources
    const sectionCounts = {};
    result.narratives.forEach(narrative => {
      const section = narrative.metadata?.sectionType || 'unknown';
      sectionCounts[section] = (sectionCounts[section] || 0) + 1;
    });

    console.log(`\n📄 Narrative Sources:`);
    Object.entries(sectionCounts).forEach(([section, count]) => {
      console.log(`   ${section}: ${count} chunks`);
    });

    // Verify we got results from expected sections
    const retrievedSections = Object.keys(sectionCounts);
    const hasExpectedResults = testCase.expectedSections.some(
      section => retrievedSections.includes(section)
    );

    if (!hasExpectedResults) {
      console.log(`\n⚠️  WARNING: No results from expected sections`);
      console.log(`   Expected: ${testCase.expectedSections.join(', ')}`);
      console.log(`   Got: ${retrievedSections.join(', ')}`);
    } else {
      console.log(`\n✅ Retrieved results from expected sections`);
    }

    // Show sample content
    console.log(`\n📝 Sample Content (first narrative):`);
    const firstNarrative = result.narratives[0];
    const excerpt = firstNarrative.content.substring(0, 200);
    console.log(`   ${excerpt}...`);
    console.log(`   Score: ${firstNarrative.score.toFixed(3)}`);
    console.log(`   Source: ${firstNarrative.metadata.filingType} ${firstNarrative.metadata.fiscalPeriod}`);

    // Check processing info
    if (result.processingInfo) {
      console.log(`\n⚙️  Processing Info:`);
      console.log(`   Semantic Narratives: ${result.processingInfo.semanticNarratives}`);
      console.log(`   Used Bedrock KB: ${result.processingInfo.usedBedrockKB}`);
      console.log(`   Latency: ${result.latency}ms`);
    }

    return true;

  } catch (error) {
    console.log(`\n❌ FAILED: ${error.message}`);
    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Error: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return false;
  }
}

async function runTests() {
  console.log('\n🧪 Testing Revenue Recognition Query Fix');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Tenant: ${TENANT_ID}`);

  // Check if server is running
  try {
    await axios.get(`${BASE_URL}/`);
    console.log('✅ Server is running');
  } catch (error) {
    console.log('❌ Server is not running. Please start the server with: npm run start:dev');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const testCase of TEST_QUERIES) {
    const success = await testQuery(testCase);
    if (success) {
      passed++;
    } else {
      failed++;
    }
    
    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 Test Summary');
  console.log(`${'='.repeat(80)}`);
  console.log(`Total Tests: ${TEST_QUERIES.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed === 0) {
    console.log('\n✅ All tests passed! The fix is working correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Please review the output above.');
  }

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
