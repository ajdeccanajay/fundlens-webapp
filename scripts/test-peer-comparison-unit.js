/**
 * Unit test for Multi-Ticker Peer Comparison feature
 * Tests the peer comparison intent detection logic directly
 */

// Test peer comparison keywords
const peerKeywords = [
  'peers',
  'peer group',
  'peer companies',
  'competitors',
  'competitor',
  'competition',
  'comparable',
  'comparables',
  'comps',
  'industry peers',
  'similar companies',
  'compare to peers',
  'compare with peers',
  'vs peers',
  'versus peers',
  'against peers',
  'relative to peers',
  'benchmark',
  'benchmarking',
];

function detectPeerComparisonIntent(query) {
  const lowerQuery = query.toLowerCase();
  
  // Check for exact keyword matches
  const hasKeyword = peerKeywords.some(kw => lowerQuery.includes(kw));
  
  // Also check for pattern "how does X compare"
  const hasComparePattern = /how does.*compare/i.test(query);

  return hasKeyword || hasComparePattern;
}

// Test cases
const testCases = [
  // Should detect peer comparison
  { query: 'How does NVDA compare to its peers?', expected: true },
  { query: 'What are the main competitors?', expected: true },
  { query: 'Compare AAPL to peer companies', expected: true },
  { query: 'Show me industry peers for MSFT', expected: true },
  { query: 'How does revenue compare vs peers?', expected: true },
  { query: 'Benchmark against similar companies', expected: true },
  { query: 'What are the comps for this company?', expected: true },
  { query: 'How does AMZN compare to competition?', expected: true },
  
  // Should NOT detect peer comparison
  { query: 'What is the revenue for AAPL?', expected: false },
  { query: 'Show me the balance sheet', expected: false },
  { query: 'What are the risk factors?', expected: false },
  { query: 'Explain the business model', expected: false },
  { query: 'What is the gross margin trend?', expected: false },
];

console.log('🧪 Testing Peer Comparison Intent Detection\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = detectPeerComparisonIntent(tc.query);
  const status = result === tc.expected ? '✅' : '❌';
  
  if (result === tc.expected) {
    passed++;
  } else {
    failed++;
  }
  
  console.log(`${status} "${tc.query}"`);
  console.log(`   Expected: ${tc.expected}, Got: ${result}`);
}

console.log('\n' + '='.repeat(60));
console.log(`📊 Results: ${passed} passed, ${failed} failed`);
console.log(`   Total: ${testCases.length} tests`);

if (failed === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log('\n❌ SOME TESTS FAILED');
  process.exit(1);
}
