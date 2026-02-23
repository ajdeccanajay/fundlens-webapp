/**
 * Invalidate old qualitative cache entries
 * 
 * The qualitative questions were overhauled from the old 8-section format
 * (companyDescription, revenueBreakdown, growthDrivers, etc.) to the new
 * 5-section deep-value format (managementCredibility, balanceSheetProtection, etc.)
 * 
 * This script deletes all old cached entries so the next load triggers
 * fresh generation with the new questions.
 * 
 * Usage: node scripts/invalidate-qualitative-cache.js [ticker]
 *   - With ticker: only invalidate for that ticker
 *   - Without ticker: invalidate ALL tickers
 */

const { Client } = require('pg');
require('dotenv').config();

const NEW_CATEGORIES = [
  'managementCredibility',
  'balanceSheetProtection', 
  'capitalAllocation',
  'earningsQuality',
  'competitiveRisk',
];

async function main() {
  const ticker = process.argv[2]?.toUpperCase();
  
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  try {
    // Count existing entries
    const countResult = ticker
      ? await client.query('SELECT COUNT(*) as cnt FROM qualitative_cache WHERE ticker = $1', [ticker])
      : await client.query('SELECT COUNT(*) as cnt FROM qualitative_cache');
    
    const totalEntries = parseInt(countResult.rows[0].cnt);
    console.log(`📊 Total cached entries${ticker ? ` for ${ticker}` : ''}: ${totalEntries}`);
    
    if (totalEntries === 0) {
      console.log('✅ No cached entries to invalidate.');
      return;
    }
    
    // Count entries with OLD categories (not in new list)
    const oldQuery = ticker
      ? `SELECT category, COUNT(*) as cnt FROM qualitative_cache WHERE ticker = $1 AND category NOT IN (${NEW_CATEGORIES.map((_, i) => `$${i + 2}`).join(',')}) GROUP BY category`
      : `SELECT category, COUNT(*) as cnt FROM qualitative_cache WHERE category NOT IN (${NEW_CATEGORIES.map((_, i) => `$${i + 1}`).join(',')}) GROUP BY category`;
    
    const params = ticker ? [ticker, ...NEW_CATEGORIES] : [...NEW_CATEGORIES];
    const oldResult = await client.query(oldQuery, params);
    
    if (oldResult.rows.length > 0) {
      console.log('\n🗑️  Old categories found (will be deleted):');
      oldResult.rows.forEach(r => console.log(`   - ${r.category}: ${r.cnt} entries`));
    }
    
    // Delete ALL entries (old + new) to force fresh generation
    const deleteQuery = ticker
      ? 'DELETE FROM qualitative_cache WHERE ticker = $1'
      : 'DELETE FROM qualitative_cache';
    
    const deleteParams = ticker ? [ticker] : [];
    const deleteResult = await client.query(deleteQuery, deleteParams);
    
    console.log(`\n✅ Deleted ${deleteResult.rowCount} cached entries${ticker ? ` for ${ticker}` : ' for ALL tickers'}.`);
    console.log('💡 Next time you view the Qualitative tab, click "Refresh" to regenerate with the new deep-value questions.');
    
    // Show remaining entries per ticker
    const remaining = await client.query('SELECT ticker, COUNT(*) as cnt FROM qualitative_cache GROUP BY ticker ORDER BY ticker');
    if (remaining.rows.length > 0) {
      console.log('\n📋 Remaining cached entries by ticker:');
      remaining.rows.forEach(r => console.log(`   ${r.ticker}: ${r.cnt} entries`));
    } else {
      console.log('\n📋 Cache is now empty for all tickers.');
    }
    
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
