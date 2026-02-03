#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkRevenueMetricName() {
  console.log('Checking NVDA revenue metric names...\n');
  
  // Check all metrics with "revenue" in the name
  const revenueMetrics = await prisma.financialMetric.findMany({
    where: {
      ticker: 'NVDA',
      OR: [
        { normalizedMetric: { contains: 'revenue', mode: 'insensitive' } },
        { rawLabel: { contains: 'revenue', mode: 'insensitive' } },
      ]
    },
    select: {
      normalizedMetric: true,
      rawLabel: true,
      fiscalPeriod: true,
      value: true,
    },
    take: 10,
  });

  console.log('Revenue-related metrics found:');
  revenueMetrics.forEach(m => {
    console.log(`  normalizedMetric: "${m.normalizedMetric}"`);
    console.log(`  rawLabel: "${m.rawLabel}"`);
    console.log(`  fiscalPeriod: ${m.fiscalPeriod}`);
    console.log(`  value: $${(Number(m.value) / 1e9).toFixed(2)}B`);
    console.log('');
  });

  // Check distinct normalized metrics
  const distinctMetrics = await prisma.$queryRaw`
    SELECT DISTINCT normalized_metric 
    FROM financial_metrics 
    WHERE ticker = 'NVDA' 
    AND (normalized_metric ILIKE '%revenue%' OR raw_label ILIKE '%revenue%')
    ORDER BY normalized_metric
  `;

  console.log('\nDistinct normalized_metric values with "revenue":');
  distinctMetrics.forEach(m => console.log(`  - ${m.normalized_metric}`));

  await prisma.$disconnect();
}

checkRevenueMetricName().catch(console.error);
