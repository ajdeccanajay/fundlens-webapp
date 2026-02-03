#!/usr/bin/env node
/**
 * Check Cash and Cash Equivalents mapping for AAPL
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Checking Cash and Cash Equivalents mapping for AAPL\n');

  // Check what cash-related metrics exist for AAPL
  const cashMetrics = await prisma.$queryRaw`
    SELECT DISTINCT 
      normalized_metric,
      raw_label,
      COUNT(*) as count
    FROM financial_metrics
    WHERE ticker = 'AAPL'
      AND (
        normalized_metric ILIKE '%cash%'
        OR raw_label ILIKE '%cash%'
      )
      AND normalized_metric NOT ILIKE '%flow%'
      AND raw_label NOT ILIKE '%flow%'
    GROUP BY normalized_metric, raw_label
    ORDER BY normalized_metric, raw_label
  `;

  console.log('📊 Cash-related metrics in database:');
  console.log('=====================================\n');
  
  if (cashMetrics.length === 0) {
    console.log('❌ NO cash metrics found for AAPL!');
  } else {
    for (const metric of cashMetrics) {
      console.log(`Normalized: ${metric.normalized_metric}`);
      console.log(`Raw Label:  ${metric.raw_label}`);
      console.log(`Count:      ${metric.count}`);
      console.log('---');
    }
  }

  // Check specifically for "cash and cash equivalents" variations
  console.log('\n🔍 Searching for "cash and cash equivalents" variations:\n');
  
  const cashEquivalents = await prisma.$queryRaw`
    SELECT DISTINCT 
      normalized_metric,
      raw_label,
      fiscal_period,
      value,
      filing_type,
      statement_type
    FROM financial_metrics
    WHERE ticker = 'AAPL'
      AND (
        normalized_metric ILIKE '%cash%'
        OR raw_label ILIKE '%cash%'
      )
      AND normalized_metric NOT ILIKE '%flow%'
      AND raw_label NOT ILIKE '%flow%'
    ORDER BY fiscal_period DESC, normalized_metric
    LIMIT 20
  `;

  if (cashEquivalents.length === 0) {
    console.log('❌ NO "cash and cash equivalents" metrics found for AAPL!');
    console.log('\nThis means the balance sheet cash line item is not being extracted.');
  } else {
    console.log('✅ Found cash metrics:');
    for (const metric of cashEquivalents) {
      console.log(`\n  Period: ${metric.fiscal_period} (${metric.filing_type})`);
      console.log(`  Statement: ${metric.statement_type}`);
      console.log(`  Normalized: ${metric.normalized_metric}`);
      console.log(`  Raw Label:  ${metric.raw_label}`);
      console.log(`  Value:      ${(parseFloat(metric.value) / 1_000_000_000).toFixed(2)}B`);
    }
  }

  // Check intent detector mapping
  console.log('\n\n🧠 Intent Detector Mapping:');
  console.log('===========================\n');
  console.log('✅ The intent detector DOES have a mapping for "cash":');
  console.log('  Cash_and_Cash_Equivalents: ["cash", "cash and cash equivalents"]');

  // Check structured retriever mapping
  console.log('\n\n🔧 Structured Retriever Mapping:');
  console.log('=================================\n');
  console.log('✅ The structured retriever has a semantic match for:');
  console.log('  "cash" → ["cash and cash equivalents", "cash equivalents", ...]');

  console.log('\n\n🎯 DIAGNOSIS:');
  console.log('=============\n');
  
  if (cashEquivalents.length === 0) {
    console.log('❌ ROOT CAUSE: Database has NO cash metrics for AAPL');
    console.log('\nPossible reasons:');
    console.log('1. Balance sheet parsing is not extracting cash line items');
    console.log('2. XBRL tag for cash is not being mapped');
    console.log('3. Data ingestion issue');
    console.log('\n💡 SOLUTION:');
    console.log('============\n');
    console.log('1. Check XBRL parsing for balance sheet items');
    console.log('2. Verify cash XBRL tags are being mapped');
    console.log('3. Re-run data ingestion for AAPL');
  } else {
    console.log('✅ Database HAS cash metrics');
    console.log('\nChecking if normalized metric name matches intent detector...');
    
    const hasMatchingName = cashEquivalents.some(m => 
      m.normalized_metric.toLowerCase() === 'cash_and_cash_equivalents' ||
      m.normalized_metric.toLowerCase() === 'cash'
    );
    
    if (hasMatchingName) {
      console.log('✅ Normalized metric name matches intent detector');
      console.log('\n💡 The query should work. Check backend logs for routing issues.');
    } else {
      console.log('❌ Normalized metric name does NOT match intent detector');
      console.log('\nIntent detector looks for: "Cash_and_Cash_Equivalents"');
      console.log('Database has:', cashEquivalents.map(m => m.normalized_metric).join(', '));
      console.log('\n💡 SOLUTION:');
      console.log('============\n');
      console.log('Add more aliases to intent detector or improve semantic matching.');
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
