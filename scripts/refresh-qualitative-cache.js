#!/usr/bin/env node

/**
 * Refresh Qualitative Cache
 * 
 * Hits the precompute endpoint for key tickers to restore instant qualitative answers
 * after cache was cleared during Feb 6 2026 deployment.
 */

const tickers = ['COST', 'AMGN', 'INTU', 'AAPL', 'GOOG', 'INTC'];
const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';

async function precomputeTicker(ticker) {
  const url = `${baseUrl}/api/financial-calculator/qualitative/precompute/${ticker}`;
  
  console.log(`\n🔄 Precomputing ${ticker}...`);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ ${ticker} complete:`, data);
    return { ticker, success: true, data };
  } catch (error) {
    console.error(`❌ ${ticker} failed:`, error.message);
    return { ticker, success: false, error: error.message };
  }
}

async function main() {
  console.log('🚀 Starting qualitative cache refresh...');
  console.log(`📍 Target: ${baseUrl}`);
  console.log(`📊 Tickers: ${tickers.join(', ')}`);
  
  const results = [];
  
  // Run sequentially to avoid overwhelming the system
  for (const ticker of tickers) {
    const result = await precomputeTicker(ticker);
    results.push(result);
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📈 SUMMARY');
  console.log('='.repeat(60));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\n✅ Successful: ${successful.length}/${tickers.length}`);
  successful.forEach(r => console.log(`   - ${r.ticker}`));
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed: ${failed.length}/${tickers.length}`);
    failed.forEach(r => console.log(`   - ${r.ticker}: ${r.error}`));
  }
  
  console.log('\n✨ Cache refresh complete!\n');
  
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
