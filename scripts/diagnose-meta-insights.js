#!/usr/bin/env node
/**
 * Diagnose META Insights Issue
 * Simulates what the frontend is doing
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('\n🔍 META Insights Diagnostic\n');
  console.log('='.repeat(60));

  // 1. Get META deal
  const deal = await prisma.deal.findFirst({
    where: { ticker: 'META' },
    orderBy: { createdAt: 'desc' },
  });

  console.log('\n1. META Deal:');
  console.log(`   ID: ${deal.id}`);
  console.log(`   Name: ${deal.name}`);
  console.log(`   Status: ${deal.status}`);

  // 2. Get available fiscal periods from financial metrics
  const annualPeriods = await prisma.financialMetric.findMany({
    where: {
      ticker: 'META',
      fiscalPeriod: { startsWith: 'FY' },
    },
    select: { fiscalPeriod: true },
    distinct: ['fiscalPeriod'],
    orderBy: { fiscalPeriod: 'desc' },
    take: 5,
  });

  console.log('\n2. Available Annual Periods (from financial_metrics):');
  annualPeriods.forEach(p => console.log(`   - ${p.fiscalPeriod}`));

  // 3. Get insights fiscal periods
  const insights = await prisma.mdaInsight.findMany({
    where: { ticker: 'META' },
    select: { fiscalPeriod: true, dealId: true },
    orderBy: { fiscalPeriod: 'desc' },
  });

  console.log('\n3. Insights Fiscal Periods (from mda_insights):');
  insights.forEach(i => console.log(`   - ${i.fiscalPeriod} (dealId: ${i.dealId})`));

  // 4. Simulate frontend request
  const requestedPeriod = annualPeriods[0]?.fiscalPeriod || 'FY2024';
  console.log(`\n4. Frontend would request: ${requestedPeriod}`);

  // 5. Try to find insight
  const insight = await prisma.mdaInsight.findUnique({
    where: {
      dealId_fiscalPeriod: {
        dealId: deal.id,
        fiscalPeriod: requestedPeriod,
      },
    },
  });

  console.log(`\n5. Lookup Result:`);
  if (insight) {
    console.log(`   ✅ Found insight for ${requestedPeriod}`);
    console.log(`   Trends: ${JSON.parse(insight.trends).length}`);
    console.log(`   Risks: ${JSON.parse(insight.risks).length}`);
  } else {
    console.log(`   ❌ No insight found for ${requestedPeriod}`);
    console.log(`   This is why the frontend shows "No insights available"`);
  }

  // 6. Check all combinations
  console.log(`\n6. Checking all period combinations:`);
  for (const period of annualPeriods.slice(0, 3)) {
    const found = await prisma.mdaInsight.findUnique({
      where: {
        dealId_fiscalPeriod: {
          dealId: deal.id,
          fiscalPeriod: period.fiscalPeriod,
        },
      },
    });
    console.log(`   ${period.fiscalPeriod}: ${found ? '✅ Found' : '❌ Not found'}`);
  }

  // 7. Recommendations
  console.log(`\n7. Recommendations:`);
  if (!insight) {
    console.log(`   The frontend is requesting: ${requestedPeriod}`);
    console.log(`   But insights exist for: ${insights.map(i => i.fiscalPeriod).join(', ')}`);
    console.log(`   \n   Solution: Recreate insights for the periods that financial metrics use`);
  }

  console.log('\n' + '='.repeat(60) + '\n');

  await prisma.$disconnect();
}

main().catch(console.error);
