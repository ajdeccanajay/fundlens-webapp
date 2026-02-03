#!/usr/bin/env node
/**
 * Check COGS/Cost of Sales mapping for AAPL
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Checking Cost of Goods Sold / Cost of Sales mapping for AAPL\n');

  // Check what cost-related metrics exist for AAPL
  const costMetrics = await prisma.$queryRaw`
    SELECT DISTINCT 
      normalized_metric,
      raw_label,
      COUNT(*) as count
    FROM financial_metrics
    WHERE ticker = 'AAPL'
      AND (
        normalized_metric ILIKE '%cost%'
        OR raw_label ILIKE '%cost%'
      )
    GROUP BY normalized_metric, raw_label
    ORDER BY normalized_metric, raw_label
  `;

  console.log('📊 Cost-related metrics in database:');
  console.log('=====================================\n');
  
  for (const metric of costMetrics) {
    console.log(`Normalized: ${metric.normalized_metric}`);
    console.log(`Raw Label:  ${metric.raw_label}`);
    console.log(`Count:      ${metric.count}`);
    console.log('---');
  }

  // Check specifically for "cost of sales" variations
  console.log('\n🔍 Searching for "cost of sales" variations:\n');
  
  const costOfSales = await prisma.$queryRaw`
    SELECT DISTINCT 
      normalized_metric,
      raw_label,
      fiscal_period,
      value,
      filing_type
    FROM financial_metrics
    WHERE ticker = 'AAPL'
      AND (
        normalized_metric ILIKE '%cost_of_sales%'
        OR normalized_metric ILIKE '%cost_of_revenue%'
        OR normalized_metric ILIKE '%cost_of_goods%'
        OR raw_label ILIKE '%cost of sales%'
        OR raw_label ILIKE '%cost of revenue%'
        OR raw_label ILIKE '%cost of goods%'
      )
    ORDER BY fiscal_period DESC, normalized_metric
    LIMIT 10
  `;

  if (costOfSales.length === 0) {
    console.log('❌ NO "cost of sales" metrics found for AAPL!');
    console.log('\nThis is the root cause of the issue.');
  } else {
    console.log('✅ Found cost of sales metrics:');
    for (const metric of costOfSales) {
      console.log(`\n  Period: ${metric.fiscal_period} (${metric.filing_type})`);
      console.log(`  Normalized: ${metric.normalized_metric}`);
      console.log(`  Raw Label:  ${metric.raw_label}`);
      console.log(`  Value:      $${(parseFloat(metric.value) / 1_000_000_000).toFixed(2)}B`);
    }
  }

  // Check intent detector mapping
  console.log('\n\n🧠 Intent Detector Mapping:');
  console.log('===========================\n');
  console.log('The intent detector does NOT have a mapping for "cost of goods sold"');
  console.log('It only maps these metrics:');
  console.log('  - Revenue');
  console.log('  - Net_Income');
  console.log('  - Gross_Profit');
  console.log('  - Operating_Income');
  console.log('  - Total_Assets');
  console.log('  - etc.');
  console.log('\n❌ "Cost of Goods Sold" is MISSING from intent detector!');

  // Check structured retriever mapping
  console.log('\n\n🔧 Structured Retriever Mapping:');
  console.log('=================================\n');
  console.log('The structured retriever has a semantic match for:');
  console.log('  "cost of revenue" → ["cost of revenue", "cost of goods sold", ...]');
  console.log('\nBut this only works AFTER the intent detector extracts the metric.');
  console.log('Since intent detector doesn\'t extract "cost of goods sold",');
  console.log('the structured retriever never gets a chance to use its mapping.');

  console.log('\n\n🎯 ROOT CAUSE:');
  console.log('===============\n');
  console.log('1. User asks: "What is cost of goods sold?"');
  console.log('2. Intent detector does NOT recognize "cost of goods sold" as a metric');
  console.log('3. Query is routed as SEMANTIC (not STRUCTURED)');
  console.log('4. Semantic search looks in narrative chunks, not financial_metrics table');
  console.log('5. No structured data is retrieved');
  console.log('\n💡 SOLUTION:');
  console.log('============\n');
  console.log('Add "cost of goods sold" mapping to intent detector:');
  console.log('  Cost_of_Revenue: ["cost of revenue", "cost of goods sold", "cost of sales", "cogs"]');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
