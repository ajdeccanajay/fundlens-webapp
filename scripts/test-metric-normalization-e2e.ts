#!/usr/bin/env ts-node
/**
 * End-to-End Metric Normalization Test
 * 
 * Tests the complete 3-layer metric normalization system with:
 * - Complex companies with unique metric names
 * - Exact matching, semantic matching, and learning
 * - Performance benchmarks
 * - Real-world query scenarios
 * 
 * Usage: npx ts-node scripts/test-metric-normalization-e2e.ts
 */

import { MetricMappingService } from '../src/rag/metric-mapping.service';

interface TestResult {
  query: string;
  expected: string;
  actual: string | null;
  confidence: number;
  method: string;
  passed: boolean;
  latency: number;
}

interface CompanyTest {
  ticker: string;
  name: string;
  queries: Array<{
    query: string;
    expected: string;
    description: string;
  }>;
}

class MetricNormalizationE2ETester {
  private service: MetricMappingService;
  private results: TestResult[] = [];

  constructor() {
    this.service = new MetricMappingService();
  }

  async initialize() {
    console.log('🚀 Initializing Metric Normalization Service...\n');
    await this.service.onModuleInit();
    
    const stats = {
      metrics: this.service.getMetricsCount(),
      synonyms: this.service.getSynonymsCount(),
      semanticEnabled: this.service.getSemanticConfig().enabled,
    };
    
    console.log(`✅ Service initialized:`);
    console.log(`   - Metrics: ${stats.metrics}`);
    console.log(`   - Synonyms: ${stats.synonyms}`);
    console.log(`   - Semantic Matcher: ${stats.semanticEnabled ? 'Enabled' : 'Disabled'}`);
    console.log();
  }

  async runTest(query: string, expected: string): Promise<TestResult> {
    const start = Date.now();
    const result = await this.service.resolve(query);
    const latency = Date.now() - start;

    return {
      query,
      expected,
      actual: result?.metricId || null,
      confidence: result?.confidence || 0,
      method: result?.method || 'none',
      passed: result?.metricId === expected,
      latency,
    };
  }

  async testCompany(company: CompanyTest) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 Testing ${company.name} (${company.ticker})`);
    console.log(`${'='.repeat(80)}\n`);

    for (const test of company.queries) {
      console.log(`Query: "${test.query}"`);
      console.log(`Description: ${test.description}`);
      
      const result = await this.runTest(test.query, test.expected);
      this.results.push(result);

      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} → ${result.actual || 'null'} (${result.method}, ${result.confidence.toFixed(2)}, ${result.latency}ms)`);
      
      if (!result.passed) {
        console.log(`   Expected: ${test.expected}`);
      }
      console.log();
    }
  }

  async testExactMatching() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🎯 Test Suite 1: Exact Matching (Layer 1)`);
    console.log(`${'='.repeat(80)}\n`);

    const tests = [
      { query: 'revenue', expected: 'revenue', description: 'Standard metric' },
      { query: 'Revenue', expected: 'revenue', description: 'Case insensitive' },
      { query: 'REVENUE', expected: 'revenue', description: 'All caps' },
      { query: '  revenue  ', expected: 'revenue', description: 'Extra whitespace' },
      { query: 'cost of goods sold', expected: 'cost_of_revenue', description: 'Multi-word metric' },
      { query: 'cogs', expected: 'cost_of_revenue', description: 'Abbreviation' },
      { query: 'net income', expected: 'net_income', description: 'Standard metric' },
      { query: 'cash', expected: 'cash', description: 'Simple metric' },
      { query: 'cash and cash equivalents', expected: 'cash', description: 'Full phrase' },
    ];

    for (const test of tests) {
      console.log(`Query: "${test.query}"`);
      console.log(`Description: ${test.description}`);
      
      const result = await this.runTest(test.query, test.expected);
      this.results.push(result);

      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} → ${result.actual || 'null'} (${result.method}, ${result.latency}ms)`);
      console.log();
    }
  }

  async testSemanticMatching() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🧠 Test Suite 2: Semantic Matching (Layer 3)`);
    console.log(`${'='.repeat(80)}\n`);

    const tests = [
      { query: 'revenu', expected: 'revenue', description: 'Typo (missing e)' },
      { query: 'reveneu', expected: 'revenue', description: 'Typo (transposed letters)' },
      { query: 'cost of good sold', expected: 'cost_of_revenue', description: 'Typo (missing s)' },
      { query: 'total sales', expected: 'revenue', description: 'Paraphrase' },
      { query: 'bottom line', expected: 'net_income', description: 'Natural language' },
      { query: 'money owed', expected: 'total_liabilities', description: 'Natural language' },
    ];

    for (const test of tests) {
      console.log(`Query: "${test.query}"`);
      console.log(`Description: ${test.description}`);
      
      const result = await this.runTest(test.query, test.expected);
      this.results.push(result);

      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} → ${result.actual || 'null'} (${result.method}, ${result.confidence.toFixed(2)}, ${result.latency}ms)`);
      
      if (result.method === 'semantic') {
        console.log(`   ℹ️  First semantic query - will be learned for future`);
      }
      console.log();
    }
  }

  async testLearning() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📚 Test Suite 3: Query Learning (Layer 2)`);
    console.log(`${'='.repeat(80)}\n`);

    const learningQuery = 'bottom line profit';
    const expected = 'net_income';

    console.log(`Testing learning with query: "${learningQuery}"\n`);

    // First query (should use semantic matcher)
    console.log('First query (semantic matching):');
    const result1 = await this.runTest(learningQuery, expected);
    this.results.push(result1);
    console.log(`${result1.passed ? '✅' : '❌'} → ${result1.actual} (${result1.method}, ${result1.latency}ms)`);
    console.log();

    // Wait a bit for learning to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Second query (should use learned cache)
    console.log('Second query (should be learned):');
    const result2 = await this.runTest(learningQuery, expected);
    this.results.push(result2);
    console.log(`${result2.passed ? '✅' : '❌'} → ${result2.actual} (${result2.method}, ${result2.latency}ms)`);
    console.log();

    const learned = result1.method === 'semantic' && result2.method === 'learned';
    console.log(`Learning test: ${learned ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Expected: First=semantic, Second=learned`);
    console.log(`Actual: First=${result1.method}, Second=${result2.method}`);
    console.log();
  }

  async testPerformance() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`⚡ Test Suite 4: Performance Benchmarks`);
    console.log(`${'='.repeat(80)}\n`);

    // Benchmark exact matches
    console.log('Benchmarking exact matches (1000 queries)...');
    const exactQueries = ['revenue', 'net income', 'total assets', 'cash', 'cogs'];
    const exactStart = Date.now();
    
    for (let i = 0; i < 200; i++) {
      for (const query of exactQueries) {
        await this.service.resolve(query);
      }
    }
    
    const exactDuration = Date.now() - exactStart;
    const exactAvg = exactDuration / 1000;
    console.log(`✅ 1000 exact queries: ${exactDuration}ms (avg: ${exactAvg.toFixed(2)}ms)`);
    console.log(`   Target: <1ms per query`);
    console.log(`   Status: ${exactAvg < 1 ? '✅ PASS' : '❌ FAIL'}\n`);

    // Benchmark learned cache
    console.log('Benchmarking learned cache (100 queries)...');
    const learnedQuery = 'total sales';
    
    // Prime the cache
    await this.service.resolve(learnedQuery);
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const learnedStart = Date.now();
    for (let i = 0; i < 100; i++) {
      await this.service.resolve(learnedQuery);
    }
    const learnedDuration = Date.now() - learnedStart;
    const learnedAvg = learnedDuration / 100;
    console.log(`✅ 100 learned queries: ${learnedDuration}ms (avg: ${learnedAvg.toFixed(2)}ms)`);
    console.log(`   Target: <1ms per query`);
    console.log(`   Status: ${learnedAvg < 1 ? '✅ PASS' : '❌ FAIL'}\n`);
  }

  async testComplexCompanies() {
    const companies: CompanyTest[] = [
      {
        ticker: 'AAPL',
        name: 'Apple Inc.',
        queries: [
          {
            query: 'cost of sales',
            expected: 'cost_of_revenue',
            description: 'Apple uses "cost of sales" instead of COGS',
          },
          {
            query: 'cost of goods sold',
            expected: 'cost_of_revenue',
            description: 'Standard COGS query should map to cost_of_revenue',
          },
          {
            query: 'products revenue',
            expected: 'revenue',
            description: 'Apple-specific revenue breakdown',
          },
          {
            query: 'services revenue',
            expected: 'revenue',
            description: 'Apple-specific revenue breakdown',
          },
        ],
      },
      {
        ticker: 'JPM',
        name: 'JPMorgan Chase',
        queries: [
          {
            query: 'net interest income',
            expected: 'net_interest_income',
            description: 'Banking-specific metric',
          },
          {
            query: 'noninterest revenue',
            expected: 'noninterest_revenue',
            description: 'Banking-specific metric',
          },
          {
            query: 'provision for credit losses',
            expected: 'provision_for_credit_losses',
            description: 'Banking-specific metric',
          },
        ],
      },
      {
        ticker: 'T',
        name: 'AT&T',
        queries: [
          {
            query: 'operating revenues',
            expected: 'revenue',
            description: 'Telecom uses "operating revenues"',
          },
          {
            query: 'equipment revenues',
            expected: 'revenue',
            description: 'Telecom-specific revenue breakdown',
          },
        ],
      },
    ];

    for (const company of companies) {
      await this.testCompany(company);
    }
  }

  printSummary() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 TEST SUMMARY`);
    console.log(`${'='.repeat(80)}\n`);

    const total = this.results.length;
    const passed = this.results.filter(r => r.passed).length;
    const failed = total - passed;
    const passRate = ((passed / total) * 100).toFixed(1);

    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed} (${passRate}%)`);
    console.log(`Failed: ${failed}`);
    console.log();

    // Method distribution
    const byMethod = {
      exact: this.results.filter(r => r.method === 'exact').length,
      learned: this.results.filter(r => r.method === 'learned').length,
      semantic: this.results.filter(r => r.method === 'semantic').length,
      none: this.results.filter(r => r.method === 'none').length,
    };

    console.log('Resolution Methods:');
    console.log(`  Exact Match: ${byMethod.exact} (${((byMethod.exact / total) * 100).toFixed(1)}%)`);
    console.log(`  Learned Cache: ${byMethod.learned} (${((byMethod.learned / total) * 100).toFixed(1)}%)`);
    console.log(`  Semantic Match: ${byMethod.semantic} (${((byMethod.semantic / total) * 100).toFixed(1)}%)`);
    console.log(`  No Match: ${byMethod.none} (${((byMethod.none / total) * 100).toFixed(1)}%)`);
    console.log();

    // Performance stats
    const latencies = this.results.map(r => r.latency);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);
    const minLatency = Math.min(...latencies);

    console.log('Performance:');
    console.log(`  Average Latency: ${avgLatency.toFixed(2)}ms`);
    console.log(`  Min Latency: ${minLatency}ms`);
    console.log(`  Max Latency: ${maxLatency}ms`);
    console.log();

    // Service stats
    console.log('Service Statistics:');
    console.log(`  Metrics: ${this.service.getMetricsCount()}`);
    console.log(`  Synonyms: ${this.service.getSynonymsCount()}`);
    console.log(`  Learned Cache Size: ${this.service.getLearnedCacheSize()}`);
    console.log();

    // Failed tests
    if (failed > 0) {
      console.log('❌ Failed Tests:');
      this.results
        .filter(r => !r.passed)
        .forEach(r => {
          console.log(`  - "${r.query}"`);
          console.log(`    Expected: ${r.expected}`);
          console.log(`    Got: ${r.actual || 'null'}`);
        });
      console.log();
    }

    // Overall status
    const overallStatus = failed === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED';
    console.log(`${'='.repeat(80)}`);
    console.log(overallStatus);
    console.log(`${'='.repeat(80)}\n`);

    return failed === 0;
  }
}

// Main execution
async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║              METRIC NORMALIZATION END-TO-END TEST SUITE                       ║
║                                                                               ║
║  Tests the complete 3-layer metric normalization system:                     ║
║  - Layer 1: Exact matching (hash table, <1ms)                                ║
║  - Layer 2: Learned cache (LRU, <1ms)                                        ║
║  - Layer 3: Semantic matcher (Python, <10ms)                                 ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  const tester = new MetricNormalizationE2ETester();

  try {
    await tester.initialize();
    await tester.testExactMatching();
    await tester.testSemanticMatching();
    await tester.testLearning();
    await tester.testComplexCompanies();
    await tester.testPerformance();

    const success = tester.printSummary();
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Test suite failed with error:');
    console.error(error);
    process.exit(1);
  }
}

main();
