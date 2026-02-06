#!/usr/bin/env node

/**
 * Enterprise-Grade RAG Stress Test
 * 
 * Tests the RAG system with deep equity analyst questions that combine:
 * - Direct metrics retrieval
 * - Pre-calculated metrics (margins, ratios)
 * - Qualitative analysis
 * - Ambiguous and edge cases
 * - Multi-company comparisons
 * - Time-series analysis
 * 
 * This test suite ensures the system is production-ready for institutional investors.
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const TENANT_ID = '00000000-0000-0000-0000-000000000000';

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

/**
 * Enterprise-Grade Test Cases
 * Organized by complexity and query type
 */
const TEST_SUITES = {
  
  // SUITE 1: HYBRID QUERIES (Metrics + Narrative + Computation)
  hybrid_complex: {
    name: 'Hybrid Complex Queries',
    description: 'Queries requiring structured data, narrative context, and computation',
    tests: [
      {
        query: "What drove NVDA's gross margin expansion from 2023 to 2024, and how does their pricing power compare to competitive dynamics?",
        expectedTypes: ['hybrid'],
        expectedSections: ['item_7', 'item_1'],
        expectedMetrics: ['gross_margin', 'Revenue'],
        requiresComputation: true,
        requiresComparison: true,
        difficulty: 'hard',
        category: 'profitability_analysis'
      },
      {
        query: "Analyze NVDA's R&D intensity relative to revenue growth and explain their innovation strategy",
        expectedTypes: ['hybrid'],
        expectedSections: ['item_7', 'item_1'],
        expectedMetrics: ['Research_and_Development', 'Revenue'],
        requiresComputation: true,
        difficulty: 'hard',
        category: 'strategic_analysis'
      },
      {
        query: "How has NVDA's operating leverage improved, and what are the key operational risks that could impact margins?",
        expectedTypes: ['hybrid'],
        expectedSections: ['item_7', 'item_1a'],
        expectedMetrics: ['Operating_Income', 'Revenue', 'operating_margin'],
        requiresComputation: true,
        difficulty: 'hard',
        category: 'operational_efficiency'
      }
    ]
  },

  // SUITE 2: AMBIGUOUS QUERIES (Missing Context, Implied Information)
  ambiguous_queries: {
    name: 'Ambiguous & Contextual Queries',
    description: 'Queries with missing context that require intelligent inference',
    tests: [
      {
        query: "What's the margin trend?",
        expectedTypes: ['structured', 'semantic'],
        ambiguityType: 'missing_ticker',
        expectedBehavior: 'should_handle_gracefully',
        difficulty: 'medium',
        category: 'ambiguity_handling'
      },
      {
        query: "NVDA margins last year",
        expectedTypes: ['structured'],
        ambiguityType: 'incomplete_syntax',
        expectedMetrics: ['gross_margin', 'net_margin', 'operating_margin'],
        difficulty: 'medium',
        category: 'natural_language'
      },
      {
        query: "How profitable is the GPU business?",
        expectedTypes: ['hybrid'],
        ambiguityType: 'segment_inference',
        expectedSections: ['item_7', 'item_1'],
        difficulty: 'hard',
        category: 'segment_analysis'
      },
      {
        query: "Revenue recognition - is it conservative?",
        expectedTypes: ['semantic'],
        expectedSections: ['item_7', 'item_8'],
        ambiguityType: 'qualitative_judgment',
        difficulty: 'hard',
        category: 'accounting_quality'
      }
    ]
  },

  // SUITE 3: MULTI-COMPANY COMPARISONS
  comparative_analysis: {
    name: 'Multi-Company Comparative Analysis',
    description: 'Cross-company comparisons requiring data normalization',
    tests: [
      {
        query: "Compare NVDA and AMD gross margins in 2024 and explain the difference",
        expectedTypes: ['hybrid'],
        expectedTickers: ['NVDA', 'AMD'],
        expectedMetrics: ['gross_margin'],
        requiresComparison: true,
        difficulty: 'hard',
        category: 'peer_comparison'
      },
      {
        query: "Which company has better R&D efficiency: NVDA or INTC?",
        expectedTypes: ['hybrid'],
        expectedTickers: ['NVDA', 'INTC'],
        expectedMetrics: ['Research_and_Development', 'Revenue'],
        requiresComputation: true,
        requiresComparison: true,
        difficulty: 'hard',
        category: 'efficiency_analysis'
      },
      {
        query: "How do NVDA's competitive advantages compare to AMD's market positioning?",
        expectedTypes: ['semantic'],
        expectedTickers: ['NVDA', 'AMD'],
        expectedSections: ['item_1', 'item_7'],
        difficulty: 'very_hard',
        category: 'competitive_positioning'
      }
    ]
  },

  // SUITE 4: TIME-SERIES & TREND ANALYSIS
  temporal_analysis: {
    name: 'Time-Series & Trend Analysis',
    description: 'Queries requiring historical data and trend identification',
    tests: [
      {
        query: "Show NVDA's revenue growth trajectory from 2022 to 2024 and identify inflection points",
        expectedTypes: ['hybrid'],
        expectedMetrics: ['Revenue'],
        requiresTrend: true,
        requiresComputation: true,
        difficulty: 'hard',
        category: 'growth_analysis'
      },
      {
        query: "Has NVDA's cash conversion cycle improved over the past 3 years?",
        expectedTypes: ['hybrid'],
        expectedMetrics: ['Accounts_Receivable', 'Inventory', 'Accounts_Payable'],
        requiresTrend: true,
        requiresComputation: true,
        difficulty: 'very_hard',
        category: 'working_capital'
      },
      {
        query: "What's the historical volatility in NVDA's operating margins and what caused it?",
        expectedTypes: ['hybrid'],
        expectedMetrics: ['operating_margin', 'Operating_Income'],
        expectedSections: ['item_7'],
        requiresTrend: true,
        difficulty: 'hard',
        category: 'margin_stability'
      }
    ]
  },

  // SUITE 5: EDGE CASES & ERROR HANDLING
  edge_cases: {
    name: 'Edge Cases & Robustness',
    description: 'Unusual queries, typos, and boundary conditions',
    tests: [
      {
        query: "NVDIA revenue",  // Typo in ticker
        expectedTypes: ['structured'],
        edgeCase: 'ticker_typo',
        expectedBehavior: 'fuzzy_match_or_error',
        difficulty: 'medium',
        category: 'error_handling'
      },
      {
        query: "What's NVDA's EBITDA margin in Q17 2024?",  // Invalid quarter
        expectedTypes: ['structured'],
        edgeCase: 'invalid_period',
        expectedBehavior: 'graceful_error',
        difficulty: 'medium',
        category: 'validation'
      },
      {
        query: "",  // Empty query
        edgeCase: 'empty_query',
        expectedBehavior: 'validation_error',
        difficulty: 'easy',
        category: 'input_validation'
      },
      {
        query: "a".repeat(1000),  // Very long query
        edgeCase: 'excessive_length',
        expectedBehavior: 'handle_or_truncate',
        difficulty: 'medium',
        category: 'boundary_conditions'
      },
      {
        query: "What is the meaning of life and NVDA's revenue?",  // Mixed irrelevant content
        expectedTypes: ['structured', 'semantic'],
        edgeCase: 'noise_filtering',
        expectedMetrics: ['Revenue'],
        difficulty: 'medium',
        category: 'noise_handling'
      }
    ]
  },

  // SUITE 6: DEEP FINANCIAL ANALYSIS
  deep_financial: {
    name: 'Deep Financial Analysis',
    description: 'Complex financial analysis requiring multiple data sources',
    tests: [
      {
        query: "Calculate NVDA's return on invested capital and explain the key drivers",
        expectedTypes: ['hybrid'],
        expectedMetrics: ['Net_Income', 'Total_Assets', 'Total_Liabilities'],
        expectedSections: ['item_7'],
        requiresComputation: true,
        difficulty: 'very_hard',
        category: 'roic_analysis'
      },
      {
        query: "Analyze NVDA's free cash flow generation and capital allocation priorities",
        expectedTypes: ['hybrid'],
        expectedMetrics: ['Operating_Cash_Flow'],
        expectedSections: ['item_7'],
        requiresComputation: true,
        difficulty: 'hard',
        category: 'cash_flow_analysis'
      },
      {
        query: "What's NVDA's debt-to-equity ratio and how does their capital structure support growth?",
        expectedTypes: ['hybrid'],
        expectedMetrics: ['Total_Liabilities', 'Total_Equity'],
        expectedSections: ['item_7'],
        requiresComputation: true,
        difficulty: 'hard',
        category: 'capital_structure'
      },
      {
        query: "Evaluate NVDA's asset turnover efficiency and working capital management",
        expectedTypes: ['hybrid'],
        expectedMetrics: ['Revenue', 'Total_Assets', 'Accounts_Receivable', 'Inventory'],
        requiresComputation: true,
        difficulty: 'very_hard',
        category: 'asset_efficiency'
      }
    ]
  },

  // SUITE 7: QUALITATIVE DEEP DIVES
  qualitative_analysis: {
    name: 'Qualitative Deep Dives',
    description: 'Pure narrative queries requiring deep document understanding',
    tests: [
      {
        query: "What are NVDA's key competitive moats and how sustainable are they?",
        expectedTypes: ['semantic'],
        expectedSections: ['item_1', 'item_7'],
        difficulty: 'hard',
        category: 'competitive_advantage'
      },
      {
        query: "Describe NVDA's supply chain risks and mitigation strategies",
        expectedTypes: ['semantic'],
        expectedSections: ['item_1a', 'item_7'],
        difficulty: 'hard',
        category: 'risk_assessment'
      },
      {
        query: "How does NVDA's management discuss AI market opportunity and their positioning?",
        expectedTypes: ['semantic'],
        expectedSections: ['item_1', 'item_7'],
        difficulty: 'hard',
        category: 'market_opportunity'
      },
      {
        query: "What's NVDA's approach to talent retention and R&D culture?",
        expectedTypes: ['semantic'],
        expectedSections: ['item_1', 'item_7'],
        difficulty: 'hard',
        category: 'human_capital'
      }
    ]
  },

  // SUITE 8: ACCOUNTING & POLICY ANALYSIS
  accounting_analysis: {
    name: 'Accounting & Policy Analysis',
    description: 'Queries about accounting policies, estimates, and quality',
    tests: [
      {
        query: "Are there any red flags in NVDA's revenue recognition policies?",
        expectedTypes: ['semantic'],
        expectedSections: ['item_7', 'item_8'],
        difficulty: 'very_hard',
        category: 'accounting_quality'
      },
      {
        query: "What are NVDA's critical accounting estimates and how conservative are they?",
        expectedTypes: ['semantic'],
        expectedSections: ['item_7', 'item_8'],
        difficulty: 'hard',
        category: 'accounting_estimates'
      },
      {
        query: "Explain NVDA's inventory valuation method and potential write-down risks",
        expectedTypes: ['semantic'],
        expectedSections: ['item_7', 'item_8', 'item_1a'],
        difficulty: 'hard',
        category: 'inventory_accounting'
      }
    ]
  }
};

/**
 * Test execution and scoring
 */
async function executeTest(testCase, suiteName) {
  const startTime = Date.now();
  
  console.log(`\n${colors.cyan}${'─'.repeat(100)}${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}Testing:${colors.reset} ${testCase.query}`);
  console.log(`${colors.yellow}Suite:${colors.reset} ${suiteName}`);
  console.log(`${colors.yellow}Category:${colors.reset} ${testCase.category}`);
  console.log(`${colors.yellow}Difficulty:${colors.reset} ${testCase.difficulty}`);
  console.log(`${colors.cyan}${'─'.repeat(100)}${colors.reset}`);

  try {
    const response = await axios.post(
      `${BASE_URL}/api/rag/query`,
      {
        query: testCase.query,
        tenantId: TENANT_ID,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000, // Increased to 120 seconds for slow queries
      }
    );

    const result = response.data;
    const latency = Date.now() - startTime;

    // Score the response
    const score = scoreResponse(result, testCase, latency);
    
    // Display results
    displayResults(result, testCase, score, latency);
    
    return { success: true, score, latency, testCase };

  } catch (error) {
    const latency = Date.now() - startTime;
    console.log(`\n${colors.red}❌ FAILED${colors.reset}`);
    console.log(`${colors.red}Error: ${error.message}${colors.reset}`);
    
    if (error.response) {
      console.log(`Status: ${error.response.status}`);
      console.log(`Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    
    return { success: false, score: 0, latency, testCase, error: error.message };
  }
}

/**
 * Score response based on multiple criteria
 */
function scoreResponse(result, testCase, latency) {
  let score = 0;
  const maxScore = 100;
  const breakdown = {};

  // 1. Response exists (20 points)
  if (result.answer && result.answer.length > 0) {
    score += 20;
    breakdown.hasAnswer = 20;
  }

  // 2. Intent detection accuracy (20 points)
  if (result.intent) {
    let intentScore = 0;
    
    // Check query type
    if (testCase.expectedTypes && testCase.expectedTypes.includes(result.intent.type)) {
      intentScore += 5;
    }
    
    // Check ticker extraction
    if (testCase.expectedTickers) {
      const detectedTickers = Array.isArray(result.intent.ticker) 
        ? result.intent.ticker 
        : result.intent.ticker ? [result.intent.ticker] : [];
      
      const matchedTickers = testCase.expectedTickers.filter(t => 
        detectedTickers.includes(t)
      );
      intentScore += (matchedTickers.length / testCase.expectedTickers.length) * 5;
    } else if (result.intent.ticker) {
      intentScore += 5;
    }
    
    // Check section detection
    if (testCase.expectedSections && result.intent.sectionTypes) {
      const matchedSections = testCase.expectedSections.filter(s => 
        result.intent.sectionTypes.includes(s)
      );
      intentScore += (matchedSections.length / testCase.expectedSections.length) * 5;
    }
    
    // Check metric detection
    if (testCase.expectedMetrics && result.intent.metrics) {
      const matchedMetrics = testCase.expectedMetrics.filter(m => 
        result.intent.metrics.includes(m)
      );
      intentScore += (matchedMetrics.length / testCase.expectedMetrics.length) * 5;
    }
    
    score += intentScore;
    breakdown.intentDetection = intentScore;
  }

  // 3. Data retrieval (30 points)
  let dataScore = 0;
  
  if (testCase.expectedMetrics && result.metrics && result.metrics.length > 0) {
    dataScore += 15;
  }
  
  if (testCase.expectedSections && result.narratives && result.narratives.length > 0) {
    dataScore += 15;
  }
  
  score += dataScore;
  breakdown.dataRetrieval = dataScore;

  // 4. Performance (15 points)
  let perfScore = 0;
  if (latency < 5000) perfScore = 15;
  else if (latency < 10000) perfScore = 10;
  else if (latency < 20000) perfScore = 5;
  
  score += perfScore;
  breakdown.performance = perfScore;

  // 5. Answer quality (15 points) - heuristic based on length and structure
  if (result.answer) {
    let qualityScore = 0;
    
    if (result.answer.length > 100) qualityScore += 5;
    if (result.answer.length > 500) qualityScore += 5;
    if (result.answer.includes('$') || result.answer.includes('%')) qualityScore += 5;
    
    score += qualityScore;
    breakdown.answerQuality = qualityScore;
  }

  return { total: score, maxScore, breakdown, percentage: (score / maxScore) * 100 };
}

/**
 * Display test results
 */
function displayResults(result, testCase, score, latency) {
  console.log(`\n${colors.bright}📊 RESULTS${colors.reset}`);
  console.log(`${colors.cyan}${'─'.repeat(100)}${colors.reset}`);
  
  // Score
  const scoreColor = score.percentage >= 80 ? colors.green : 
                     score.percentage >= 60 ? colors.yellow : colors.red;
  console.log(`${colors.bright}Score:${colors.reset} ${scoreColor}${score.total}/${score.maxScore} (${score.percentage.toFixed(1)}%)${colors.reset}`);
  
  // Breakdown
  console.log(`\n${colors.bright}Score Breakdown:${colors.reset}`);
  Object.entries(score.breakdown).forEach(([key, value]) => {
    console.log(`  ${key}: ${value} points`);
  });
  
  // Intent
  if (result.intent) {
    console.log(`\n${colors.bright}Intent Detection:${colors.reset}`);
    console.log(`  Type: ${result.intent.type}`);
    console.log(`  Ticker: ${result.intent.ticker || 'none'}`);
    console.log(`  Sections: ${result.intent.sectionTypes?.join(', ') || 'none'}`);
    console.log(`  Metrics: ${result.intent.metrics?.join(', ') || 'none'}`);
    console.log(`  Confidence: ${result.intent.confidence.toFixed(2)}`);
  }
  
  // Data retrieved
  console.log(`\n${colors.bright}Data Retrieved:${colors.reset}`);
  console.log(`  Metrics: ${result.metrics?.length || 0}`);
  console.log(`  Narratives: ${result.narratives?.length || 0}`);
  
  // Performance
  console.log(`\n${colors.bright}Performance:${colors.reset}`);
  console.log(`  Latency: ${latency}ms`);
  console.log(`  Cost: $${result.cost?.toFixed(6) || '0.000000'}`);
  
  // Answer preview
  if (result.answer) {
    const preview = result.answer.substring(0, 200);
    console.log(`\n${colors.bright}Answer Preview:${colors.reset}`);
    console.log(`  ${preview}${result.answer.length > 200 ? '...' : ''}`);
  }
}

/**
 * Run all test suites
 */
async function runAllTests() {
  console.log(`\n${colors.bright}${colors.magenta}${'═'.repeat(100)}${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}🚀 ENTERPRISE-GRADE RAG STRESS TEST${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}${'═'.repeat(100)}${colors.reset}\n`);
  
  console.log(`${colors.cyan}Target:${colors.reset} ${BASE_URL}`);
  console.log(`${colors.cyan}Tenant:${colors.reset} ${TENANT_ID}`);
  console.log(`${colors.cyan}Total Suites:${colors.reset} ${Object.keys(TEST_SUITES).length}`);
  
  // Count total tests
  const totalTests = Object.values(TEST_SUITES).reduce((sum, suite) => sum + suite.tests.length, 0);
  console.log(`${colors.cyan}Total Tests:${colors.reset} ${totalTests}\n`);

  // Check server
  try {
    await axios.get(`${BASE_URL}/`);
    console.log(`${colors.green}✅ Server is running${colors.reset}\n`);
  } catch (error) {
    console.log(`${colors.red}❌ Server is not running${colors.reset}`);
    process.exit(1);
  }

  const results = {
    suites: {},
    overall: {
      total: 0,
      passed: 0,
      failed: 0,
      totalScore: 0,
      maxScore: 0,
      avgLatency: 0,
      totalLatency: 0
    }
  };

  // Run each suite
  for (const [suiteKey, suite] of Object.entries(TEST_SUITES)) {
    console.log(`\n${colors.bright}${colors.magenta}${'═'.repeat(100)}${colors.reset}`);
    console.log(`${colors.bright}${colors.magenta}📦 SUITE: ${suite.name}${colors.reset}`);
    console.log(`${colors.magenta}${suite.description}${colors.reset}`);
    console.log(`${colors.bright}${colors.magenta}${'═'.repeat(100)}${colors.reset}`);

    const suiteResults = {
      name: suite.name,
      tests: [],
      passed: 0,
      failed: 0,
      totalScore: 0,
      maxScore: 0
    };

    for (const test of suite.tests) {
      const result = await executeTest(test, suite.name);
      suiteResults.tests.push(result);
      
      if (result.success) {
        suiteResults.passed++;
        results.overall.passed++;
      } else {
        suiteResults.failed++;
        results.overall.failed++;
      }
      
      suiteResults.totalScore += result.score.total;
      suiteResults.maxScore += result.score.maxScore;
      results.overall.totalScore += result.score.total;
      results.overall.maxScore += result.score.maxScore;
      results.overall.totalLatency += result.latency;
      results.overall.total++;
      
      // Wait between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    results.suites[suiteKey] = suiteResults;
    
    // Suite summary
    console.log(`\n${colors.bright}${colors.cyan}Suite Summary:${colors.reset}`);
    console.log(`  Passed: ${colors.green}${suiteResults.passed}${colors.reset}`);
    console.log(`  Failed: ${colors.red}${suiteResults.failed}${colors.reset}`);
    console.log(`  Score: ${suiteResults.totalScore}/${suiteResults.maxScore} (${((suiteResults.totalScore/suiteResults.maxScore)*100).toFixed(1)}%)`);
  }

  // Overall summary
  results.overall.avgLatency = results.overall.totalLatency / results.overall.total;
  displayOverallSummary(results);
  
  return results;
}

/**
 * Display overall summary
 */
function displayOverallSummary(results) {
  console.log(`\n${colors.bright}${colors.magenta}${'═'.repeat(100)}${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}📊 OVERALL SUMMARY${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}${'═'.repeat(100)}${colors.reset}\n`);
  
  const overallPercentage = (results.overall.totalScore / results.overall.maxScore) * 100;
  const gradeColor = overallPercentage >= 90 ? colors.green :
                     overallPercentage >= 80 ? colors.cyan :
                     overallPercentage >= 70 ? colors.yellow : colors.red;
  
  console.log(`${colors.bright}Total Tests:${colors.reset} ${results.overall.total}`);
  console.log(`${colors.green}Passed:${colors.reset} ${results.overall.passed}`);
  console.log(`${colors.red}Failed:${colors.reset} ${results.overall.failed}`);
  console.log(`${colors.bright}Overall Score:${colors.reset} ${gradeColor}${results.overall.totalScore}/${results.overall.maxScore} (${overallPercentage.toFixed(1)}%)${colors.reset}`);
  console.log(`${colors.bright}Avg Latency:${colors.reset} ${results.overall.avgLatency.toFixed(0)}ms`);
  
  // Grade
  let grade = 'F';
  if (overallPercentage >= 90) grade = 'A';
  else if (overallPercentage >= 80) grade = 'B';
  else if (overallPercentage >= 70) grade = 'C';
  else if (overallPercentage >= 60) grade = 'D';
  
  console.log(`\n${colors.bright}${gradeColor}GRADE: ${grade}${colors.reset}`);
  
  // Recommendations
  console.log(`\n${colors.bright}Recommendations:${colors.reset}`);
  if (overallPercentage >= 90) {
    console.log(`  ${colors.green}✅ System is enterprise-ready!${colors.reset}`);
  } else if (overallPercentage >= 80) {
    console.log(`  ${colors.cyan}⚠️  System is production-ready with minor improvements needed${colors.reset}`);
  } else if (overallPercentage >= 70) {
    console.log(`  ${colors.yellow}⚠️  System needs improvements before production deployment${colors.reset}`);
  } else {
    console.log(`  ${colors.red}❌ System requires significant improvements${colors.reset}`);
  }
  
  console.log(`\n${colors.bright}${colors.magenta}${'═'.repeat(100)}${colors.reset}\n`);
}

// Run tests
runAllTests()
  .then(results => {
    const overallPercentage = (results.overall.totalScore / results.overall.maxScore) * 100;
    process.exit(overallPercentage >= 70 ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
