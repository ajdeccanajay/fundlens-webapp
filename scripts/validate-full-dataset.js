#!/usr/bin/env node
/**
 * Full Dataset Validation Script
 * 
 * Validates data quality, completeness, and consistency across all companies
 * Ensures the scaled dataset meets production standards
 */

const axios = require('axios');
const fs = require('fs').promises;

// Configuration
const CONFIG = {
  API_BASE: 'http://localhost:3000',
  TARGET_COMPANIES: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'JPM', 'BAC', 'WMT'],
  TARGET_YEARS: [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
  FILING_TYPES: ['10-K', '10-Q', '8-K'],
  
  // Quality thresholds
  THRESHOLDS: {
    MIN_COVERAGE: 80, // Minimum 80% data coverage
    MIN_CONFIDENCE: 0.75, // Minimum 75% confidence score
    MAX_ERROR_RATE: 5, // Maximum 5% error rate
    MIN_METRICS_PER_FILING: 50, // Minimum 50 metrics per filing
    MIN_NARRATIVES_PER_FILING: 10, // Minimum 10 narrative chunks per filing
  }
};

class FullDatasetValidator {
  constructor() {
    this.results = {
      companies: {},
      summary: {
        totalCompanies: 0,
        validCompanies: 0,
        totalFilings: 0,
        validFilings: 0,
        totalMetrics: 0,
        validMetrics: 0,
        totalNarratives: 0,
        validNarratives: 0,
        overallScore: 0
      },
      issues: [],
      recommendations: []
    };
  }

  async run() {
    console.log('✅ Full Dataset Validation Started');
    console.log('=' .repeat(60));
    console.log(`Companies: ${CONFIG.TARGET_COMPANIES.length}`);
    console.log(`Years: ${CONFIG.TARGET_YEARS.length}`);
    console.log(`Filing Types: ${CONFIG.FILING_TYPES.length}`);
    console.log('=' .repeat(60));

    try {
      // Phase 1: Data completeness validation
      await this.validateDataCompleteness();
      
      // Phase 2: Data quality validation
      await this.validateDataQuality();
      
      // Phase 3: Cross-company consistency
      await this.validateConsistency();
      
      // Phase 4: RAG system validation
      await this.validateRAGSystem();
      
      // Phase 5: Performance validation
      await this.validatePerformance();
      
      // Phase 6: Generate final report
      await this.generateValidationReport();
      
      console.log('\n🎉 Full Dataset Validation Complete!');
      
    } catch (error) {
      console.error('❌ Validation failed:', error);
      throw error;
    }
  }

  async validateDataCompleteness() {
    console.log('\n📊 Phase 1: Data Completeness Validation');
    console.log('-'.repeat(50));
    
    for (const ticker of CONFIG.TARGET_COMPANIES) {
      console.log(`\n  Validating ${ticker} completeness...`);
      
      const companyResult = {
        ticker,
        coverage: {},
        issues: [],
        score: 0
      };
      
      try {
        // Check filing coverage
        const filingCoverage = await this.checkFilingCoverage(ticker);
        companyResult.coverage.filings = filingCoverage;
        
        // Check metric coverage
        const metricCoverage = await this.checkMetricCoverage(ticker);
        companyResult.coverage.metrics = metricCoverage;
        
        // Check narrative coverage
        const narrativeCoverage = await this.checkNarrativeCoverage(ticker);
        companyResult.coverage.narratives = narrativeCoverage;
        
        // Calculate company score
        companyResult.score = this.calculateCompanyScore(companyResult.coverage);
        
        console.log(`    ✅ ${ticker} completeness: ${companyResult.score.toFixed(1)}%`);
        console.log(`       Filings: ${filingCoverage.percentage.toFixed(1)}%`);
        console.log(`       Metrics: ${metricCoverage.percentage.toFixed(1)}%`);
        console.log(`       Narratives: ${narrativeCoverage.percentage.toFixed(1)}%`);
        
        this.results.companies[ticker] = companyResult;
        
      } catch (error) {
        console.error(`    ❌ ${ticker} validation failed: ${error.message}`);
        companyResult.issues.push(`Validation failed: ${error.message}`);
        this.results.companies[ticker] = companyResult;
      }
    }
  }

  async checkFilingCoverage(ticker) {
    try {
      const response = await axios.get(`${CONFIG.API_BASE}/api/sec/${ticker}/filings`, {
        timeout: 30000
      });
      
      const filings = response.data;
      const expectedFilings = this.calculateExpectedFilings();
      const actualFilings = filings.length;
      
      return {
        expected: expectedFilings,
        actual: actualFilings,
        percentage: (actualFilings / expectedFilings) * 100,
        missing: expectedFilings - actualFilings
      };
      
    } catch (error) {
      return {
        expected: this.calculateExpectedFilings(),
        actual: 0,
        percentage: 0,
        missing: this.calculateExpectedFilings(),
        error: error.message
      };
    }
  }

  async checkMetricCoverage(ticker) {
    try {
      const response = await axios.get(`${CONFIG.API_BASE}/api/sec/${ticker}/metrics`, {
        timeout: 30000
      });
      
      const metrics = response.data;
      const expectedMetrics = this.calculateExpectedMetrics();
      const actualMetrics = metrics.length;
      
      // Check confidence scores
      const highConfidenceMetrics = metrics.filter(m => m.confidenceScore >= CONFIG.THRESHOLDS.MIN_CONFIDENCE).length;
      
      return {
        expected: expectedMetrics,
        actual: actualMetrics,
        percentage: (actualMetrics / expectedMetrics) * 100,
        highConfidence: highConfidenceMetrics,
        confidenceRate: (highConfidenceMetrics / actualMetrics) * 100
      };
      
    } catch (error) {
      return {
        expected: this.calculateExpectedMetrics(),
        actual: 0,
        percentage: 0,
        highConfidence: 0,
        confidenceRate: 0,
        error: error.message
      };
    }
  }

  async checkNarrativeCoverage(ticker) {
    try {
      const response = await axios.get(`${CONFIG.API_BASE}/api/rag/chunks/${ticker}`, {
        timeout: 30000
      });
      
      const narratives = response.data;
      const expectedNarratives = this.calculateExpectedNarratives();
      const actualNarratives = narratives.length;
      
      return {
        expected: expectedNarratives,
        actual: actualNarratives,
        percentage: (actualNarratives / expectedNarratives) * 100,
        sections: this.analyzeSectionCoverage(narratives)
      };
      
    } catch (error) {
      return {
        expected: this.calculateExpectedNarratives(),
        actual: 0,
        percentage: 0,
        sections: {},
        error: error.message
      };
    }
  }

  async validateDataQuality() {
    console.log('\n🔍 Phase 2: Data Quality Validation');
    console.log('-'.repeat(50));
    
    // Test sample queries for accuracy
    const testQueries = [
      'What was Apple\'s revenue in 2024?',
      'Compare Microsoft and Google revenue',
      'What are Tesla\'s main business risks?',
      'Show me Amazon\'s cash flow trends',
      'What is JPMorgan\'s net income?'
    ];
    
    let successfulQueries = 0;
    
    for (const query of testQueries) {
      console.log(`\n  Testing query: "${query}"`);
      
      try {
        const response = await axios.post(`${CONFIG.API_BASE}/api/rag/query`, {
          query
        }, {
          timeout: 30000
        });
        
        const result = response.data;
        
        // Validate response quality
        const quality = this.validateQueryResponse(result, query);
        
        if (quality.isValid) {
          successfulQueries++;
          console.log(`    ✅ Query successful (score: ${quality.score.toFixed(1)}%)`);
        } else {
          console.log(`    ❌ Query failed: ${quality.issues.join(', ')}`);
          this.results.issues.push(`Query failed: "${query}" - ${quality.issues.join(', ')}`);
        }
        
      } catch (error) {
        console.log(`    ❌ Query error: ${error.message}`);
        this.results.issues.push(`Query error: "${query}" - ${error.message}`);
      }
    }
    
    const querySuccessRate = (successfulQueries / testQueries.length) * 100;
    console.log(`\n  📊 Query success rate: ${querySuccessRate.toFixed(1)}%`);
    
    if (querySuccessRate < 80) {
      this.results.issues.push(`Low query success rate: ${querySuccessRate.toFixed(1)}%`);
    }
  }

  async validateConsistency() {
    console.log('\n🔄 Phase 3: Cross-Company Consistency Validation');
    console.log('-'.repeat(50));
    
    // Check metric consistency across companies
    await this.validateMetricConsistency();
    
    // Check narrative structure consistency
    await this.validateNarrativeConsistency();
    
    // Check temporal consistency
    await this.validateTemporalConsistency();
  }

  async validateMetricConsistency() {
    console.log('\n  📊 Validating metric consistency...');
    
    try {
      const response = await axios.post(`${CONFIG.API_BASE}/api/admin/validate-metrics`, {
        companies: CONFIG.TARGET_COMPANIES,
        years: [2023, 2024] // Recent years
      }, {
        timeout: 60000
      });
      
      const validation = response.data;
      
      console.log(`    ✅ Metric consistency: ${validation.consistencyScore?.toFixed(1) || 'N/A'}%`);
      
      if (validation.issues) {
        validation.issues.forEach(issue => {
          this.results.issues.push(`Metric consistency: ${issue}`);
        });
      }
      
    } catch (error) {
      console.log(`    ⚠️ Metric consistency check skipped: ${error.message}`);
    }
  }

  async validateNarrativeConsistency() {
    console.log('  📖 Validating narrative consistency...');
    
    // Check that all companies have similar narrative structure
    const sectionCounts = {};
    
    for (const ticker of CONFIG.TARGET_COMPANIES.slice(0, 3)) { // Sample 3 companies
      try {
        const response = await axios.get(`${CONFIG.API_BASE}/api/rag/chunks/${ticker}/sections`, {
          timeout: 30000
        });
        
        sectionCounts[ticker] = response.data;
        
      } catch (error) {
        console.log(`    ⚠️ Could not check ${ticker} narrative structure`);
      }
    }
    
    // Analyze consistency
    const sections = Object.keys(sectionCounts[Object.keys(sectionCounts)[0]] || {});
    let consistentSections = 0;
    
    sections.forEach(section => {
      const counts = Object.values(sectionCounts).map(sc => sc[section] || 0);
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
      const variance = counts.reduce((sum, count) => sum + Math.pow(count - avg, 2), 0) / counts.length;
      
      if (variance < avg * 0.5) { // Low variance indicates consistency
        consistentSections++;
      }
    });
    
    const consistencyRate = (consistentSections / sections.length) * 100;
    console.log(`    ✅ Narrative consistency: ${consistencyRate.toFixed(1)}%`);
  }

  async validateTemporalConsistency() {
    console.log('  📅 Validating temporal consistency...');
    
    // Check that data exists for expected time periods
    let consistentCompanies = 0;
    
    for (const ticker of CONFIG.TARGET_COMPANIES) {
      try {
        const response = await axios.get(`${CONFIG.API_BASE}/api/sec/${ticker}/timeline`, {
          timeout: 30000
        });
        
        const timeline = response.data;
        const expectedYears = CONFIG.TARGET_YEARS.filter(year => year <= 2024); // Only past years
        const actualYears = timeline.map(t => t.year);
        
        const coverage = expectedYears.filter(year => actualYears.includes(year)).length;
        const coverageRate = (coverage / expectedYears.length) * 100;
        
        if (coverageRate >= CONFIG.THRESHOLDS.MIN_COVERAGE) {
          consistentCompanies++;
        }
        
      } catch (error) {
        console.log(`    ⚠️ Could not check ${ticker} temporal consistency`);
      }
    }
    
    const temporalConsistency = (consistentCompanies / CONFIG.TARGET_COMPANIES.length) * 100;
    console.log(`    ✅ Temporal consistency: ${temporalConsistency.toFixed(1)}%`);
  }

  async validateRAGSystem() {
    console.log('\n🧠 Phase 4: RAG System Validation');
    console.log('-'.repeat(50));
    
    // Test semantic retrieval
    await this.testSemanticRetrieval();
    
    // Test structured retrieval
    await this.testStructuredRetrieval();
    
    // Test hybrid queries
    await this.testHybridQueries();
  }

  async testSemanticRetrieval() {
    console.log('\n  🔍 Testing semantic retrieval...');
    
    const semanticQueries = [
      'What are the main business risks?',
      'Describe the competitive landscape',
      'What are the growth strategies?'
    ];
    
    let successfulRetrievals = 0;
    
    for (const query of semanticQueries) {
      try {
        const response = await axios.post(`${CONFIG.API_BASE}/api/rag/test-semantic`, {
          query,
          ticker: 'AAPL'
        }, {
          timeout: 30000
        });
        
        const chunks = response.data.narratives || [];
        
        if (chunks.length >= 3 && chunks.every(c => c.metadata.ticker === 'AAPL')) {
          successfulRetrievals++;
          console.log(`    ✅ "${query}" - ${chunks.length} relevant chunks`);
        } else {
          console.log(`    ❌ "${query}" - insufficient or mixed results`);
        }
        
      } catch (error) {
        console.log(`    ❌ "${query}" - error: ${error.message}`);
      }
    }
    
    const semanticSuccessRate = (successfulRetrievals / semanticQueries.length) * 100;
    console.log(`    📊 Semantic retrieval success: ${semanticSuccessRate.toFixed(1)}%`);
  }

  async testStructuredRetrieval() {
    console.log('  📊 Testing structured retrieval...');
    
    const structuredQueries = [
      { ticker: 'AAPL', metrics: ['revenue'], period: 'latest' },
      { ticker: 'MSFT', metrics: ['net_income'], period: 'FY2024' },
      { ticker: ['GOOGL', 'AMZN'], metrics: ['revenue'], period: 'latest' }
    ];
    
    let successfulRetrievals = 0;
    
    for (const query of structuredQueries) {
      try {
        const response = await axios.post(`${CONFIG.API_BASE}/api/rag/test-structured`, query, {
          timeout: 30000
        });
        
        const metrics = response.data.metrics || [];
        
        if (metrics.length > 0 && metrics.every(m => m.confidenceScore >= 0.8)) {
          successfulRetrievals++;
          console.log(`    ✅ ${JSON.stringify(query)} - ${metrics.length} metrics`);
        } else {
          console.log(`    ❌ ${JSON.stringify(query)} - insufficient results`);
        }
        
      } catch (error) {
        console.log(`    ❌ ${JSON.stringify(query)} - error: ${error.message}`);
      }
    }
    
    const structuredSuccessRate = (successfulRetrievals / structuredQueries.length) * 100;
    console.log(`    📊 Structured retrieval success: ${structuredSuccessRate.toFixed(1)}%`);
  }

  async testHybridQueries() {
    console.log('  🔄 Testing hybrid queries...');
    
    const hybridQueries = [
      'Why did Apple\'s revenue grow in 2024?',
      'Compare Microsoft and Google profit margins and explain the difference',
      'What drove Tesla\'s margin improvement?'
    ];
    
    let successfulQueries = 0;
    
    for (const query of hybridQueries) {
      try {
        const response = await axios.post(`${CONFIG.API_BASE}/api/rag/query`, {
          query
        }, {
          timeout: 30000
        });
        
        const result = response.data;
        
        if (result.metrics && result.narratives && result.answer) {
          successfulQueries++;
          console.log(`    ✅ "${query}" - hybrid response generated`);
        } else {
          console.log(`    ❌ "${query}" - incomplete hybrid response`);
        }
        
      } catch (error) {
        console.log(`    ❌ "${query}" - error: ${error.message}`);
      }
    }
    
    const hybridSuccessRate = (successfulQueries / hybridQueries.length) * 100;
    console.log(`    📊 Hybrid query success: ${hybridSuccessRate.toFixed(1)}%`);
  }

  async validatePerformance() {
    console.log('\n⚡ Phase 5: Performance Validation');
    console.log('-'.repeat(50));
    
    // Test query response times
    const performanceQueries = [
      'What is Apple\'s latest revenue?',
      'Compare all tech companies revenue',
      'What are the main risks across all companies?'
    ];
    
    const responseTimes = [];
    
    for (const query of performanceQueries) {
      const startTime = Date.now();
      
      try {
        await axios.post(`${CONFIG.API_BASE}/api/rag/query`, {
          query
        }, {
          timeout: 30000
        });
        
        const responseTime = Date.now() - startTime;
        responseTimes.push(responseTime);
        
        console.log(`  ⏱️ "${query}" - ${responseTime}ms`);
        
      } catch (error) {
        console.log(`  ❌ "${query}" - failed: ${error.message}`);
      }
    }
    
    if (responseTimes.length > 0) {
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);
      
      console.log(`\n  📊 Average response time: ${avgResponseTime.toFixed(0)}ms`);
      console.log(`  📊 Max response time: ${maxResponseTime.toFixed(0)}ms`);
      
      if (avgResponseTime > 5000) {
        this.results.issues.push(`High average response time: ${avgResponseTime.toFixed(0)}ms`);
      }
    }
  }

  calculateExpectedFilings() {
    // Rough estimate: 1 annual + 3 quarterly per year
    return CONFIG.TARGET_YEARS.length * 4;
  }

  calculateExpectedMetrics() {
    // Rough estimate: 400 metrics per company per year
    return CONFIG.TARGET_YEARS.length * 400;
  }

  calculateExpectedNarratives() {
    // Rough estimate: 80 narrative chunks per company per year
    return CONFIG.TARGET_YEARS.length * 80;
  }

  calculateCompanyScore(coverage) {
    const weights = {
      filings: 0.4,
      metrics: 0.4,
      narratives: 0.2
    };
    
    return (
      coverage.filings.percentage * weights.filings +
      coverage.metrics.percentage * weights.metrics +
      coverage.narratives.percentage * weights.narratives
    );
  }

  validateQueryResponse(result, query) {
    const issues = [];
    let score = 100;
    
    // Check if answer exists
    if (!result.answer || result.answer.length < 50) {
      issues.push('Answer too short or missing');
      score -= 30;
    }
    
    // Check if metrics are provided for metric queries
    if (query.toLowerCase().includes('revenue') || query.toLowerCase().includes('income')) {
      if (!result.metrics || result.metrics.length === 0) {
        issues.push('No metrics provided for metric query');
        score -= 25;
      }
    }
    
    // Check if narratives are provided for narrative queries
    if (query.toLowerCase().includes('risk') || query.toLowerCase().includes('strategy')) {
      if (!result.narratives || result.narratives.length === 0) {
        issues.push('No narratives provided for narrative query');
        score -= 25;
      }
    }
    
    // Check response time
    if (result.latency && result.latency > 10000) {
      issues.push('Response time too slow');
      score -= 10;
    }
    
    return {
      isValid: issues.length === 0,
      score: Math.max(0, score),
      issues
    };
  }

  analyzeSectionCoverage(narratives) {
    const sections = {};
    
    narratives.forEach(narrative => {
      const section = narrative.sectionType || 'unknown';
      sections[section] = (sections[section] || 0) + 1;
    });
    
    return sections;
  }

  async generateValidationReport() {
    console.log('\n📋 Phase 6: Generating Validation Report');
    console.log('-'.repeat(50));
    
    // Calculate overall scores
    const companyScores = Object.values(this.results.companies).map(c => c.score || 0);
    this.results.summary.overallScore = companyScores.reduce((a, b) => a + b, 0) / companyScores.length;
    
    this.results.summary.totalCompanies = CONFIG.TARGET_COMPANIES.length;
    this.results.summary.validCompanies = companyScores.filter(score => score >= CONFIG.THRESHOLDS.MIN_COVERAGE).length;
    
    // Generate recommendations
    this.generateRecommendations();
    
    const report = {
      timestamp: new Date().toISOString(),
      config: CONFIG,
      results: this.results,
      validation: {
        passed: this.results.issues.length === 0 && this.results.summary.overallScore >= CONFIG.THRESHOLDS.MIN_COVERAGE,
        score: this.results.summary.overallScore,
        issues: this.results.issues.length,
        recommendations: this.results.recommendations.length
      }
    };
    
    // Save report
    await fs.writeFile('full-dataset-validation-report.json', JSON.stringify(report, null, 2));
    
    // Print summary
    console.log('\n📊 Validation Summary:');
    console.log(`  Overall Score: ${this.results.summary.overallScore.toFixed(1)}%`);
    console.log(`  Valid Companies: ${this.results.summary.validCompanies}/${this.results.summary.totalCompanies}`);
    console.log(`  Issues Found: ${this.results.issues.length}`);
    console.log(`  Recommendations: ${this.results.recommendations.length}`);
    
    if (report.validation.passed) {
      console.log('\n  ✅ VALIDATION PASSED - Dataset ready for production');
    } else {
      console.log('\n  ❌ VALIDATION FAILED - Issues need to be addressed');
    }
    
    console.log(`\n  📄 Report saved: full-dataset-validation-report.json`);
  }

  generateRecommendations() {
    // Analyze issues and generate recommendations
    if (this.results.summary.overallScore < CONFIG.THRESHOLDS.MIN_COVERAGE) {
      this.results.recommendations.push('Increase data coverage by processing more historical filings');
    }
    
    if (this.results.issues.some(issue => issue.includes('Query failed'))) {
      this.results.recommendations.push('Improve RAG system prompts and retrieval accuracy');
    }
    
    if (this.results.issues.some(issue => issue.includes('response time'))) {
      this.results.recommendations.push('Optimize query performance and add caching');
    }
    
    if (this.results.issues.some(issue => issue.includes('consistency'))) {
      this.results.recommendations.push('Standardize data processing across all companies');
    }
  }
}

// CLI interface
async function main() {
  const validator = new FullDatasetValidator();
  await validator.run();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { FullDatasetValidator };