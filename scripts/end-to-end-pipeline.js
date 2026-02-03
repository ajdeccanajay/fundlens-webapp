#!/usr/bin/env node
/**
 * End-to-End Pipeline Test
 * 
 * Complete pipeline from SEC filing ingestion to RAG queries
 * Tests: AAPL, AMZN, GOOGL latest 10-Ks
 * 
 * Uses existing tested NestJS services:
 * 1. S3 Sync Service - Download and store SEC filings
 * 2. S3 Processing Service - Extract metrics and narratives
 * 3. RAG Services - Vectorize and query narratives
 * 4. Metrics Service - Query structured data
 */

const axios = require('axios');
const fs = require('fs').promises;

// Test companies
const TEST_COMPANIES = ['AAPL', 'AMZN', 'GOOGL'];
const API_BASE = 'http://localhost:3000';

class EndToEndPipeline {
  constructor() {
    this.results = {};
  }

  async run() {
    console.log('🚀 Starting End-to-End Pipeline Test');
    console.log('Using existing tested NestJS services');
    console.log('=' .repeat(60));
    
    try {
      // Step 1: Sync SEC filings to S3
      await this.step1_syncFilings();
      
      // Step 2: Process filings (extract metrics and narratives)
      await this.step2_processFilings();
      
      // Step 3: Vectorize narratives for RAG
      await this.step3_vectorizeNarratives();
      
      // Step 4: Test queries
      await this.step4_testQueries();
      
      // Step 5: Generate report
      await this.step5_generateReport();
      
      console.log('\n✅ End-to-End Pipeline Complete!');
      
    } catch (error) {
      console.error('❌ Pipeline failed:', error);
      throw error;
    }
  }

  async step1_syncFilings() {
    console.log('\n📄 Step 1: Syncing SEC Filings to S3');
    console.log('-'.repeat(40));
    
    for (const ticker of TEST_COMPANIES) {
      console.log(`\nSyncing ${ticker} filings...`);
      
      try {
        // Use the existing S3 sync service to download latest 10-K filings
        const response = await axios.post(`${API_BASE}/api/s3/sync/${ticker}`, {
          filingTypes: ['10-K']
        }, {
          timeout: 120000
        });
        
        const syncData = response.data;
        console.log(`  ✅ Sync complete:`);
        console.log(`     ${syncData.message}`);
        
        if (syncData.results) {
          for (const result of syncData.results) {
            console.log(`     ${result.filingType}: ${result.newFilings} new, ${result.skipped} skipped, ${result.errors} errors`);
          }
        }
        
        this.results[ticker] = {
          syncResults: syncData.results,
          status: 'synced'
        };
        
      } catch (error) {
        console.error(`  ❌ Failed to sync ${ticker}:`, error.message);
        this.results[ticker] = { error: error.message, status: 'failed' };
      }
    }
  }

  async step2_processFilings() {
    console.log('\n💾 Step 2: Processing Filings (Extract Metrics & Narratives)');
    console.log('-'.repeat(40));
    
    for (const ticker of TEST_COMPANIES) {
      if (this.results[ticker]?.error) continue;
      
      console.log(`\nProcessing ${ticker} filings...`);
      
      try {
        // Use the existing S3 processing service to extract metrics and narratives
        const response = await axios.post(`${API_BASE}/api/s3/sync-and-process/${ticker}`, {
          filingTypes: ['10-K']
        }, {
          timeout: 300000 // 5 minutes for processing
        });
        
        const processingResults = response.data;
        console.log(`  ✅ Processing complete:`);
        
        let totalMetrics = 0;
        let totalNarratives = 0;
        
        if (Array.isArray(processingResults)) {
          for (const result of processingResults) {
            if (result.status === 'success') {
              totalMetrics += result.metricsExtracted || 0;
              totalNarratives += result.narrativesExtracted || 0;
              console.log(`     ${result.filingType} ${result.accessionNumber}: ${result.metricsExtracted} metrics, ${result.narrativesExtracted} narratives`);
            } else {
              console.log(`     ${result.filingType} ${result.accessionNumber}: Failed - ${result.errors?.join(', ')}`);
            }
          }
        }
        
        console.log(`  📊 Total: ${totalMetrics} metrics, ${totalNarratives} narrative chunks`);
        
        this.results[ticker] = {
          ...this.results[ticker],
          processingResults,
          totalMetrics,
          totalNarratives,
          status: 'processed'
        };
        
      } catch (error) {
        console.error(`  ❌ Failed to process ${ticker}:`, error.message);
        this.results[ticker] = { ...this.results[ticker], error: error.message };
      }
    }
  }

  async step3_vectorizeNarratives() {
    console.log('\n🔍 Step 3: Vectorizing Narratives for RAG');
    console.log('-'.repeat(40));
    
    try {
      // Use the existing chunk exporter service to vectorize narratives
      const response = await axios.post(`${API_BASE}/api/rag/chunks/export-local`, {
        tickers: TEST_COMPANIES,
        filingTypes: ['10-K']
      }, {
        timeout: 300000 // 5 minutes
      });
      
      console.log('  ✅ Narratives vectorized and stored');
      console.log(`     Chunks processed: ${response.data.chunksProcessed || 'Unknown'}`);
      console.log(`     Export method: ${response.data.exportMethod || 'Local'}`);
      
    } catch (error) {
      console.error('  ❌ Failed to vectorize narratives:', error.message);
      console.log('  ℹ️  Continuing without vectorization...');
    }
  }

  async step4_testQueries() {
    console.log('\n🔍 Step 4: Testing Queries');
    console.log('-'.repeat(40));
    
    await this.testDeterministicQueries();
    await this.testNarrativeQueries();
    await this.testCrossCompanyQueries();
  }

  async testDeterministicQueries() {
    console.log('\n  📊 Testing Deterministic Metric Queries');
    
    const testQueries = [
      'What was Apple\'s revenue in the latest year?',
      'Compare revenue for AAPL, AMZN, and GOOGL',
      'What is Amazon\'s latest net income?',
      'Show me Google\'s total assets'
    ];
    
    for (const query of testQueries) {
      console.log(`\n    Query: "${query}"`);
      
      try {
        const response = await axios.post(`${API_BASE}/api/rag/query`, {
          query: query
        }, {
          timeout: 30000
        });
        
        console.log(`      ✅ Response: ${response.data.answer?.substring(0, 100)}...`);
        console.log(`      Intent: ${response.data.intent?.type}`);
        console.log(`      Metrics: ${response.data.metrics?.length || 0}`);
        
      } catch (error) {
        console.log(`      ❌ Failed: ${error.message}`);
      }
    }
  }

  async testNarrativeQueries() {
    console.log('\n  📖 Testing Narrative RAG Queries');
    
    const testQueries = [
      'What are the main business segments for each company?',
      'What are the key risk factors mentioned?',
      'How do companies describe their competitive advantages?'
    ];
    
    for (const query of testQueries) {
      console.log(`\n    Query: "${query}"`);
      
      try {
        const response = await axios.post(`${API_BASE}/api/rag/query`, {
          query: query,
          tickers: TEST_COMPANIES
        }, {
          timeout: 30000
        });
        
        console.log(`      ✅ Response: ${response.data.answer?.substring(0, 100)}...`);
        console.log(`      Sources: ${response.data.sources?.length || 0} chunks`);
        
      } catch (error) {
        console.log(`      ❌ Failed: ${error.message}`);
      }
    }
  }

  async testCrossCompanyQueries() {
    console.log('\n  🔄 Testing Cross-Company Comparisons');
    
    const testQueries = [
      'Compare the revenue growth of AAPL, AMZN, and GOOGL',
      'Which company has the highest profit margins?',
      'How do the business models of these companies differ?'
    ];
    
    for (const query of testQueries) {
      console.log(`\n    Query: "${query}"`);
      
      try {
        const response = await axios.post(`${API_BASE}/api/rag/query`, {
          query: query,
          tickers: TEST_COMPANIES
        }, {
          timeout: 30000
        });
        
        console.log(`      ✅ Response: ${response.data.answer?.substring(0, 100)}...`);
        console.log(`      Intent: ${response.data.intent?.type}`);
        console.log(`      Sources: ${response.data.sources?.length || 0} chunks`);
        
      } catch (error) {
        console.log(`      ❌ Failed: ${error.message}`);
      }
    }
  }

  async step5_generateReport() {
    console.log('\n📋 Step 5: Generating Pipeline Report');
    console.log('-'.repeat(40));
    
    const report = {
      timestamp: new Date().toISOString(),
      companies: TEST_COMPANIES,
      results: {}
    };
    
    for (const ticker of TEST_COMPANIES) {
      const result = this.results[ticker];
      if (result?.error) {
        report.results[ticker] = { status: 'failed', error: result.error };
      } else {
        report.results[ticker] = {
          status: result?.status || 'unknown',
          totalMetrics: result?.totalMetrics || 0,
          totalNarratives: result?.totalNarratives || 0
        };
      }
    }
    
    // Save report
    await fs.writeFile('end-to-end-pipeline-report.json', JSON.stringify(report, null, 2));
    
    console.log('\n📊 Pipeline Summary:');
    console.log(`  Companies processed: ${TEST_COMPANIES.length}`);
    console.log(`  Successful: ${Object.values(report.results).filter(r => r.status === 'processed').length}`);
    console.log(`  Failed: ${Object.values(report.results).filter(r => r.status === 'failed').length}`);
    console.log(`  Report saved: end-to-end-pipeline-report.json`);
  }
}

// Run the pipeline
async function main() {
  const pipeline = new EndToEndPipeline();
  await pipeline.run();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { EndToEndPipeline };