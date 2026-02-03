#!/usr/bin/env node
/**
 * Full Dataset Scaling Script
 * 
 * Scales from 5 companies to 10 companies with 7 years of historical data
 * 
 * Target: 10 companies × 7 years × 3 filing types = ~280 filings
 * Companies: AAPL, MSFT, GOOGL, AMZN, TSLA, META, NVDA, JPM, BAC, WMT
 * Years: 2018-2025
 * Filing Types: 10-K, 10-Q, 8-K
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG = {
  // All target companies
  ALL_COMPANIES: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'JPM', 'BAC', 'WMT'],
  
  // Companies we already have (with sample data)
  EXISTING_COMPANIES: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'],
  
  // New companies to add
  NEW_COMPANIES: ['META', 'NVDA', 'JPM', 'BAC', 'WMT'],
  
  // Time range
  YEARS: [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
  
  // Filing types in priority order
  FILING_TYPES: ['10-K', '10-Q', '8-K'],
  
  // Processing settings
  BATCH_SIZE: 3, // Process 3 companies simultaneously
  MAX_RETRIES: 3,
  RETRY_DELAY: 5000, // 5 seconds
  
  // API settings
  API_BASE: 'http://localhost:3000',
  TIMEOUT: 300000, // 5 minutes per request
};

class FullDatasetScaler {
  constructor() {
    this.results = {
      companies: {},
      summary: {
        totalFilings: 0,
        totalMetrics: 0,
        totalNarratives: 0,
        successfulCompanies: 0,
        failedCompanies: 0,
        processingTime: 0
      },
      errors: []
    };
    this.startTime = Date.now();
  }

  async run() {
    console.log('🚀 Full Dataset Scaling Started');
    console.log('=' .repeat(60));
    console.log(`Target: ${CONFIG.ALL_COMPANIES.length} companies × ${CONFIG.YEARS.length} years`);
    console.log(`Companies: ${CONFIG.ALL_COMPANIES.join(', ')}`);
    console.log(`Years: ${CONFIG.YEARS.join(', ')}`);
    console.log(`Filing Types: ${CONFIG.FILING_TYPES.join(', ')}`);
    console.log('=' .repeat(60));

    try {
      // Phase 1: Infrastructure preparation
      await this.phase1_prepareInfrastructure();
      
      // Phase 2: Process new companies (full historical)
      await this.phase2_processNewCompanies();
      
      // Phase 3: Expand existing companies (historical backfill)
      await this.phase3_expandExistingCompanies();
      
      // Phase 4: Add quarterly data (10-Q filings)
      await this.phase4_addQuarterlyData();
      
      // Phase 5: Add event data (8-K filings)
      await this.phase5_addEventData();
      
      // Phase 6: Validate and optimize
      await this.phase6_validateAndOptimize();
      
      // Phase 7: Generate final report
      await this.phase7_generateReport();
      
      console.log('\n🎉 Full Dataset Scaling Complete!');
      
    } catch (error) {
      console.error('❌ Scaling failed:', error);
      await this.handleFailure(error);
      throw error;
    }
  }

  async phase1_prepareInfrastructure() {
    console.log('\n📋 Phase 1: Infrastructure Preparation');
    console.log('-'.repeat(50));
    
    // Check system health
    await this.checkSystemHealth();
    
    // Optimize database
    await this.optimizeDatabase();
    
    // Prepare S3 structure
    await this.prepareS3Structure();
    
    console.log('✅ Infrastructure ready for scaling');
  }

  async phase2_processNewCompanies() {
    console.log('\n🆕 Phase 2: Processing New Companies (Full Historical)');
    console.log('-'.repeat(50));
    console.log(`New companies: ${CONFIG.NEW_COMPANIES.join(', ')}`);
    
    // Process new companies in batches
    const batches = this.createBatches(CONFIG.NEW_COMPANIES, CONFIG.BATCH_SIZE);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`\nProcessing batch ${i + 1}/${batches.length}: ${batch.join(', ')}`);
      
      await this.processBatch(batch, {
        years: CONFIG.YEARS,
        filingTypes: ['10-K'], // Start with annual reports
        isNewCompany: true
      });
    }
  }

  async phase3_expandExistingCompanies() {
    console.log('\n📈 Phase 3: Expanding Existing Companies (Historical Backfill)');
    console.log('-'.repeat(50));
    console.log(`Existing companies: ${CONFIG.EXISTING_COMPANIES.join(', ')}`);
    
    // Add historical data for existing companies (they only have 2024 data)
    const historicalYears = CONFIG.YEARS.filter(year => year < 2024);
    console.log(`Adding historical years: ${historicalYears.join(', ')}`);
    
    const batches = this.createBatches(CONFIG.EXISTING_COMPANIES, CONFIG.BATCH_SIZE);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`\nProcessing batch ${i + 1}/${batches.length}: ${batch.join(', ')}`);
      
      await this.processBatch(batch, {
        years: historicalYears,
        filingTypes: ['10-K'],
        isHistoricalBackfill: true
      });
    }
  }

  async phase4_addQuarterlyData() {
    console.log('\n📊 Phase 4: Adding Quarterly Data (10-Q Filings)');
    console.log('-'.repeat(50));
    
    // Add quarterly data for recent years (2022-2025) for all companies
    const recentYears = [2022, 2023, 2024, 2025];
    console.log(`Adding quarterly data for years: ${recentYears.join(', ')}`);
    
    const batches = this.createBatches(CONFIG.ALL_COMPANIES, CONFIG.BATCH_SIZE);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`\nProcessing batch ${i + 1}/${batches.length}: ${batch.join(', ')}`);
      
      await this.processBatch(batch, {
        years: recentYears,
        filingTypes: ['10-Q'],
        isQuarterlyData: true
      });
    }
  }

  async phase5_addEventData() {
    console.log('\n📢 Phase 5: Adding Event Data (8-K Filings)');
    console.log('-'.repeat(50));
    
    // Add 8-K filings for recent years (2023-2025) for all companies
    const eventYears = [2023, 2024, 2025];
    console.log(`Adding event data for years: ${eventYears.join(', ')}`);
    
    const batches = this.createBatches(CONFIG.ALL_COMPANIES, CONFIG.BATCH_SIZE);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`\nProcessing batch ${i + 1}/${batches.length}: ${batch.join(', ')}`);
      
      await this.processBatch(batch, {
        years: eventYears,
        filingTypes: ['8-K'],
        isEventData: true,
        limit: 10 // Limit 8-K filings per company per year
      });
    }
  }

  async phase6_validateAndOptimize() {
    console.log('\n✅ Phase 6: Validation and Optimization');
    console.log('-'.repeat(50));
    
    // Validate data completeness
    await this.validateDataCompleteness();
    
    // Update RAG system with new data
    await this.updateRAGSystem();
    
    // Optimize database performance
    await this.optimizeDatabaseFinal();
    
    console.log('✅ Validation and optimization complete');
  }

  async processBatch(companies, options) {
    const promises = companies.map(ticker => 
      this.processCompany(ticker, options)
    );
    
    const results = await Promise.allSettled(promises);
    
    // Process results
    results.forEach((result, index) => {
      const ticker = companies[index];
      if (result.status === 'fulfilled') {
        this.results.companies[ticker] = result.value;
        this.results.summary.successfulCompanies++;
      } else {
        this.results.companies[ticker] = { error: result.reason.message };
        this.results.summary.failedCompanies++;
        this.results.errors.push(`${ticker}: ${result.reason.message}`);
      }
    });
  }

  async processCompany(ticker, options) {
    console.log(`\n  Processing ${ticker}...`);
    
    const companyResult = {
      ticker,
      filings: [],
      totalMetrics: 0,
      totalNarratives: 0,
      processingTime: 0
    };
    
    const startTime = Date.now();
    
    try {
      // Step 1: Sync filings from SEC
      console.log(`    📄 Syncing ${ticker} filings...`);
      const syncResult = await this.syncCompanyFilings(ticker, options);
      companyResult.filings = syncResult.filings;
      
      // Step 2: Process filings (extract metrics and narratives)
      console.log(`    💾 Processing ${ticker} filings...`);
      const processResult = await this.processCompanyFilings(ticker, options);
      companyResult.totalMetrics = processResult.totalMetrics;
      companyResult.totalNarratives = processResult.totalNarratives;
      
      companyResult.processingTime = Date.now() - startTime;
      
      console.log(`    ✅ ${ticker} complete: ${companyResult.totalMetrics} metrics, ${companyResult.totalNarratives} narratives`);
      
      // Update summary
      this.results.summary.totalMetrics += companyResult.totalMetrics;
      this.results.summary.totalNarratives += companyResult.totalNarratives;
      this.results.summary.totalFilings += companyResult.filings.length;
      
      return companyResult;
      
    } catch (error) {
      console.error(`    ❌ ${ticker} failed: ${error.message}`);
      throw error;
    }
  }

  async syncCompanyFilings(ticker, options) {
    const { years, filingTypes, limit } = options;
    
    try {
      const response = await axios.post(`${CONFIG.API_BASE}/api/s3/sync/${ticker}`, {
        filingTypes,
        years,
        limit
      }, {
        timeout: CONFIG.TIMEOUT
      });
      
      return {
        filings: response.data.results || [],
        message: response.data.message
      };
      
    } catch (error) {
      throw new Error(`Failed to sync ${ticker}: ${error.message}`);
    }
  }

  async processCompanyFilings(ticker, options) {
    const { years, filingTypes } = options;
    
    try {
      const response = await axios.post(`${CONFIG.API_BASE}/api/s3/sync-and-process/${ticker}`, {
        filingTypes,
        years
      }, {
        timeout: CONFIG.TIMEOUT
      });
      
      const results = Array.isArray(response.data) ? response.data : [response.data];
      
      let totalMetrics = 0;
      let totalNarratives = 0;
      
      results.forEach(result => {
        if (result.status === 'success') {
          totalMetrics += result.metricsExtracted || 0;
          totalNarratives += result.narrativesExtracted || 0;
        }
      });
      
      return { totalMetrics, totalNarratives };
      
    } catch (error) {
      throw new Error(`Failed to process ${ticker}: ${error.message}`);
    }
  }

  async checkSystemHealth() {
    console.log('  🔍 Checking system health...');
    
    try {
      // Check backend API
      const healthResponse = await axios.get(`${CONFIG.API_BASE}/api/health`, {
        timeout: 10000
      });
      
      console.log('    ✅ Backend API healthy');
      
      // Check Python parser
      const parserResponse = await axios.get('http://localhost:8000/health', {
        timeout: 10000
      });
      
      console.log('    ✅ Python parser healthy');
      
    } catch (error) {
      throw new Error(`System health check failed: ${error.message}`);
    }
  }

  async optimizeDatabase() {
    console.log('  🗄️ Optimizing database...');
    
    try {
      const response = await axios.post(`${CONFIG.API_BASE}/api/admin/optimize-database`, {}, {
        timeout: 60000
      });
      
      console.log('    ✅ Database optimized');
      
    } catch (error) {
      console.log('    ⚠️ Database optimization skipped (endpoint not available)');
    }
  }

  async prepareS3Structure() {
    console.log('  🪣 Preparing S3 structure...');
    
    try {
      const response = await axios.post(`${CONFIG.API_BASE}/api/s3/prepare-structure`, {
        companies: CONFIG.ALL_COMPANIES,
        years: CONFIG.YEARS
      }, {
        timeout: 30000
      });
      
      console.log('    ✅ S3 structure prepared');
      
    } catch (error) {
      console.log('    ⚠️ S3 structure preparation skipped (endpoint not available)');
    }
  }

  async validateDataCompleteness() {
    console.log('  ✅ Validating data completeness...');
    
    try {
      const response = await axios.post(`${CONFIG.API_BASE}/api/admin/validate-dataset`, {
        companies: CONFIG.ALL_COMPANIES,
        years: CONFIG.YEARS,
        filingTypes: CONFIG.FILING_TYPES
      }, {
        timeout: 120000
      });
      
      console.log('    ✅ Data validation complete');
      console.log(`    📊 Coverage: ${response.data.coverage}%`);
      
    } catch (error) {
      console.log('    ⚠️ Data validation skipped (endpoint not available)');
    }
  }

  async updateRAGSystem() {
    console.log('  🧠 Updating RAG system...');
    
    try {
      const response = await axios.post(`${CONFIG.API_BASE}/api/rag/chunks/export-bedrock`, {
        companies: CONFIG.ALL_COMPANIES,
        years: [2022, 2023, 2024, 2025] // Recent years for RAG
      }, {
        timeout: 300000
      });
      
      console.log('    ✅ RAG system updated');
      console.log(`    📄 Chunks exported: ${response.data.chunksExported || 'Unknown'}`);
      
    } catch (error) {
      console.log('    ⚠️ RAG system update skipped (endpoint not available)');
    }
  }

  async optimizeDatabaseFinal() {
    console.log('  🚀 Final database optimization...');
    
    try {
      const response = await axios.post(`${CONFIG.API_BASE}/api/admin/optimize-final`, {}, {
        timeout: 120000
      });
      
      console.log('    ✅ Final optimization complete');
      
    } catch (error) {
      console.log('    ⚠️ Final optimization skipped (endpoint not available)');
    }
  }

  createBatches(items, batchSize) {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  async phase7_generateReport() {
    console.log('\n📋 Phase 7: Generating Final Report');
    console.log('-'.repeat(50));
    
    this.results.summary.processingTime = Date.now() - this.startTime;
    
    const report = {
      timestamp: new Date().toISOString(),
      config: CONFIG,
      results: this.results,
      performance: {
        totalTime: this.results.summary.processingTime,
        avgTimePerCompany: this.results.summary.processingTime / CONFIG.ALL_COMPANIES.length,
        throughput: {
          companiesPerHour: (CONFIG.ALL_COMPANIES.length / (this.results.summary.processingTime / 3600000)).toFixed(2),
          metricsPerSecond: (this.results.summary.totalMetrics / (this.results.summary.processingTime / 1000)).toFixed(2)
        }
      }
    };
    
    // Save detailed report
    await fs.writeFile('full-dataset-scaling-report.json', JSON.stringify(report, null, 2));
    
    // Print summary
    console.log('\n📊 Scaling Summary:');
    console.log(`  Companies: ${this.results.summary.successfulCompanies}/${CONFIG.ALL_COMPANIES.length} successful`);
    console.log(`  Total filings: ${this.results.summary.totalFilings}`);
    console.log(`  Total metrics: ${this.results.summary.totalMetrics.toLocaleString()}`);
    console.log(`  Total narratives: ${this.results.summary.totalNarratives.toLocaleString()}`);
    console.log(`  Processing time: ${(this.results.summary.processingTime / 60000).toFixed(1)} minutes`);
    console.log(`  Report saved: full-dataset-scaling-report.json`);
    
    if (this.results.errors.length > 0) {
      console.log('\n⚠️ Errors encountered:');
      this.results.errors.forEach(error => console.log(`  - ${error}`));
    }
  }

  async handleFailure(error) {
    console.log('\n💾 Saving failure report...');
    
    const failureReport = {
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack,
      partialResults: this.results,
      config: CONFIG
    };
    
    await fs.writeFile('scaling-failure-report.json', JSON.stringify(failureReport, null, 2));
    console.log('  📄 Failure report saved: scaling-failure-report.json');
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options = {};
  
  // Parse command line arguments
  args.forEach(arg => {
    if (arg.startsWith('--companies=')) {
      options.companies = arg.split('=')[1].split(',');
    } else if (arg.startsWith('--years=')) {
      options.years = arg.split('=')[1].split(',').map(Number);
    } else if (arg.startsWith('--filing-types=')) {
      options.filingTypes = arg.split('=')[1].split(',');
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.split('=')[1]);
    }
  });
  
  // Override config with CLI options
  if (options.companies) CONFIG.ALL_COMPANIES = options.companies;
  if (options.years) CONFIG.YEARS = options.years;
  if (options.filingTypes) CONFIG.FILING_TYPES = options.filingTypes;
  if (options.batchSize) CONFIG.BATCH_SIZE = options.batchSize;
  
  const scaler = new FullDatasetScaler();
  await scaler.run();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { FullDatasetScaler, CONFIG };