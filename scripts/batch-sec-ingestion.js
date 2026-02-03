#!/usr/bin/env node
/**
 * Batch SEC Ingestion Script
 * 
 * Downloads historical SEC filings for multiple companies and years
 * Handles SEC rate limits and implements smart retry logic
 */

const axios = require('axios');
const fs = require('fs').promises;

// Configuration
const CONFIG = {
  API_BASE: 'http://localhost:3000',
  SEC_RATE_LIMIT: 10, // requests per second
  MAX_RETRIES: 3,
  RETRY_DELAY: 5000,
  BATCH_SIZE: 3,
  TIMEOUT: 300000, // 5 minutes
};

class BatchSECIngestion {
  constructor(options = {}) {
    this.companies = options.companies || [];
    this.years = options.years || [];
    this.filingTypes = options.filingTypes || ['10-K'];
    this.results = {};
    this.requestQueue = [];
    this.isProcessing = false;
  }

  async run() {
    console.log('📄 Batch SEC Ingestion Started');
    console.log('=' .repeat(50));
    console.log(`Companies: ${this.companies.join(', ')}`);
    console.log(`Years: ${this.years.join(', ')}`);
    console.log(`Filing Types: ${this.filingTypes.join(', ')}`);
    console.log('=' .repeat(50));

    try {
      // Initialize results structure
      this.initializeResults();
      
      // Create download queue
      await this.createDownloadQueue();
      
      // Process queue with rate limiting
      await this.processQueue();
      
      // Generate summary report
      await this.generateReport();
      
      console.log('\n✅ Batch SEC Ingestion Complete!');
      
    } catch (error) {
      console.error('❌ Batch ingestion failed:', error);
      throw error;
    }
  }

  initializeResults() {
    this.companies.forEach(ticker => {
      this.results[ticker] = {
        requested: 0,
        downloaded: 0,
        skipped: 0,
        errors: 0,
        filings: []
      };
    });
  }

  async createDownloadQueue() {
    console.log('\n📋 Creating download queue...');
    
    for (const ticker of this.companies) {
      for (const year of this.years) {
        for (const filingType of this.filingTypes) {
          this.requestQueue.push({
            ticker,
            year,
            filingType,
            priority: this.calculatePriority(ticker, year, filingType)
          });
          
          this.results[ticker].requested++;
        }
      }
    }
    
    // Sort by priority (recent years and 10-K filings first)
    this.requestQueue.sort((a, b) => b.priority - a.priority);
    
    console.log(`  📊 Queue created: ${this.requestQueue.length} requests`);
    console.log(`  🎯 Priority order: Recent years and 10-K filings first`);
  }

  calculatePriority(ticker, year, filingType) {
    let priority = 0;
    
    // Recent years get higher priority
    priority += year * 10;
    
    // 10-K filings get highest priority
    if (filingType === '10-K') priority += 1000;
    else if (filingType === '10-Q') priority += 500;
    else if (filingType === '8-K') priority += 100;
    
    // Important companies get slight boost
    const importantCompanies = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'];
    if (importantCompanies.includes(ticker)) priority += 50;
    
    return priority;
  }

  async processQueue() {
    console.log('\n🔄 Processing download queue...');
    console.log(`  ⏱️ Rate limit: ${CONFIG.SEC_RATE_LIMIT} requests/second`);
    
    this.isProcessing = true;
    const startTime = Date.now();
    let processed = 0;
    
    // Process requests with rate limiting
    for (const request of this.requestQueue) {
      if (!this.isProcessing) break;
      
      try {
        await this.processRequest(request);
        processed++;
        
        // Progress update every 10 requests
        if (processed % 10 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = processed / elapsed;
          const remaining = this.requestQueue.length - processed;
          const eta = remaining / rate;
          
          console.log(`    📊 Progress: ${processed}/${this.requestQueue.length} (${(processed/this.requestQueue.length*100).toFixed(1)}%)`);
          console.log(`    ⏱️ Rate: ${rate.toFixed(1)} req/s, ETA: ${(eta/60).toFixed(1)} minutes`);
        }
        
        // Rate limiting delay
        await this.delay(1000 / CONFIG.SEC_RATE_LIMIT);
        
      } catch (error) {
        console.error(`    ❌ Request failed: ${request.ticker} ${request.year} ${request.filingType} - ${error.message}`);
        this.results[request.ticker].errors++;
      }
    }
    
    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`\n  ✅ Queue processing complete in ${(totalTime/60).toFixed(1)} minutes`);
  }

  async processRequest(request) {
    const { ticker, year, filingType } = request;
    
    try {
      // Download filing for specific year
      const response = await axios.post(`${CONFIG.API_BASE}/api/s3/sync/${ticker}`, {
        filingTypes: [filingType],
        years: [year],
        limit: filingType === '8-K' ? 5 : undefined // Limit 8-K filings
      }, {
        timeout: CONFIG.TIMEOUT,
        retry: CONFIG.MAX_RETRIES
      });
      
      const result = response.data;
      
      if (result.results && result.results.length > 0) {
        const filingResult = result.results[0];
        
        if (filingResult.newFilings > 0) {
          this.results[ticker].downloaded += filingResult.newFilings;
          this.results[ticker].filings.push({
            year,
            filingType,
            count: filingResult.newFilings,
            status: 'downloaded'
          });
        } else {
          this.results[ticker].skipped++;
          this.results[ticker].filings.push({
            year,
            filingType,
            count: 0,
            status: 'skipped'
          });
        }
      }
      
    } catch (error) {
      // Retry logic
      if (error.response?.status === 429) {
        // Rate limited - wait longer and retry
        console.log(`    ⏳ Rate limited for ${ticker} ${year} ${filingType}, waiting...`);
        await this.delay(CONFIG.RETRY_DELAY * 2);
        return this.processRequest(request);
      }
      
      throw error;
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async generateReport() {
    console.log('\n📋 Generating ingestion report...');
    
    const report = {
      timestamp: new Date().toISOString(),
      config: {
        companies: this.companies,
        years: this.years,
        filingTypes: this.filingTypes
      },
      summary: {
        totalRequested: 0,
        totalDownloaded: 0,
        totalSkipped: 0,
        totalErrors: 0,
        successRate: 0
      },
      companies: this.results
    };
    
    // Calculate summary
    Object.values(this.results).forEach(result => {
      report.summary.totalRequested += result.requested;
      report.summary.totalDownloaded += result.downloaded;
      report.summary.totalSkipped += result.skipped;
      report.summary.totalErrors += result.errors;
    });
    
    report.summary.successRate = (
      (report.summary.totalDownloaded / report.summary.totalRequested) * 100
    ).toFixed(1);
    
    // Save report
    await fs.writeFile('batch-sec-ingestion-report.json', JSON.stringify(report, null, 2));
    
    // Print summary
    console.log('\n📊 Ingestion Summary:');
    console.log(`  Total requested: ${report.summary.totalRequested}`);
    console.log(`  Downloaded: ${report.summary.totalDownloaded}`);
    console.log(`  Skipped: ${report.summary.totalSkipped}`);
    console.log(`  Errors: ${report.summary.totalErrors}`);
    console.log(`  Success rate: ${report.summary.successRate}%`);
    
    // Company breakdown
    console.log('\n📈 Company Breakdown:');
    Object.entries(this.results).forEach(([ticker, result]) => {
      console.log(`  ${ticker}: ${result.downloaded}/${result.requested} downloaded (${((result.downloaded/result.requested)*100).toFixed(1)}%)`);
    });
    
    console.log(`\n  📄 Report saved: batch-sec-ingestion-report.json`);
  }

  // Graceful shutdown
  stop() {
    console.log('\n⏹️ Stopping batch ingestion...');
    this.isProcessing = false;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  // Default options
  const options = {
    companies: ['META', 'NVDA', 'JPM', 'BAC', 'WMT'],
    years: [2018, 2019, 2020, 2021, 2022, 2023, 2024],
    filingTypes: ['10-K']
  };
  
  // Parse command line arguments
  args.forEach(arg => {
    if (arg.startsWith('--companies=')) {
      options.companies = arg.split('=')[1].split(',');
    } else if (arg.startsWith('--years=')) {
      options.years = arg.split('=')[1].split(',').map(Number);
    } else if (arg.startsWith('--filing-types=')) {
      options.filingTypes = arg.split('=')[1].split(',');
    } else if (arg === '--help') {
      console.log(`
Usage: node batch-sec-ingestion.js [options]

Options:
  --companies=TICKER1,TICKER2    Companies to process (default: META,NVDA,JPM,BAC,WMT)
  --years=YEAR1,YEAR2           Years to download (default: 2018-2024)
  --filing-types=TYPE1,TYPE2    Filing types (default: 10-K)
  --help                        Show this help

Examples:
  node batch-sec-ingestion.js --companies=AAPL,MSFT --years=2022,2023,2024
  node batch-sec-ingestion.js --filing-types=10-K,10-Q --years=2024
      `);
      return;
    }
  });
  
  console.log('🚀 Starting batch SEC ingestion with options:');
  console.log(`  Companies: ${options.companies.join(', ')}`);
  console.log(`  Years: ${options.years.join(', ')}`);
  console.log(`  Filing Types: ${options.filingTypes.join(', ')}`);
  
  const ingestion = new BatchSECIngestion(options);
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    ingestion.stop();
    process.exit(0);
  });
  
  await ingestion.run();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { BatchSECIngestion };