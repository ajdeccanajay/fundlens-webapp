#!/usr/bin/env node

/**
 * Calculate AT&T Calculated Metrics
 * This script generates calculated metrics (growth rates, margins, ratios) for AT&T
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function calculateATTMetrics() {
  console.log('🔄 Calculating AT&T metrics...\n');

  try {
    const ticker = 'T';
    
    // Get all financial metrics for AT&T
    const metrics = await prisma.financialMetric.findMany({
      where: { ticker },
      orderBy: [
        { fiscalYear: 'desc' },
        { fiscalPeriod: 'desc' }
      ]
    });

    console.log(`Found ${metrics.length} raw metrics for ${ticker}`);

    if (metrics.length === 0) {
      console.log('❌ No metrics found for AT&T');
      return;
    }

    // Group by fiscal year
    const metricsByYear = {};
    metrics.forEach(m => {
      const year = m.fiscalYear;
      if (!metricsByYear[year]) {
        metricsByYear[year] = {};
      }
      metricsByYear[year][m.metricName] = parseFloat(m.value) || 0;
    });

    const years = Object.keys(metricsByYear).sort((a, b) => b - a);
    console.log(`Years available: ${years.join(', ')}\n`);

    // Calculate derived metrics for each year
    const calculatedMetrics = [];
    
    for (const year of years) {
      const yearMetrics = metricsByYear[year];
      const prevYear = (parseInt(year) - 1).toString();
      const prevYearMetrics = metricsByYear[prevYear] || {};

      console.log(`Processing ${year}...`);

      // Revenue Growth
      if (yearMetrics.revenue && prevYearMetrics.revenue) {
        const growth = ((yearMetrics.revenue - prevYearMetrics.revenue) / prevYearMetrics.revenue) * 100;
        calculatedMetrics.push({
          ticker,
          metricName: 'revenue_growth',
          value: growth.toFixed(2),
          fiscalYear: parseInt(year),
          fiscalPeriod: 'FY',
          unit: 'percent',
          calculationType: 'yoy_growth'
        });
        console.log(`  Revenue Growth: ${growth.toFixed(2)}%`);
      }

      // Gross Margin
      if (yearMetrics.revenue && yearMetrics.gross_profit) {
        const margin = (yearMetrics.gross_profit / yearMetrics.revenue) * 100;
        calculatedMetrics.push({
          ticker,
          metricName: 'gross_margin',
          value: margin.toFixed(2),
          fiscalYear: parseInt(year),
          fiscalPeriod: 'FY',
          unit: 'percent',
          calculationType: 'margin'
        });
        console.log(`  Gross Margin: ${margin.toFixed(2)}%`);
      }

      // Operating Margin
      if (yearMetrics.revenue && yearMetrics.operating_income) {
        const margin = (yearMetrics.operating_income / yearMetrics.revenue) * 100;
        calculatedMetrics.push({
          ticker,
          metricName: 'operating_margin',
          value: margin.toFixed(2),
          fiscalYear: parseInt(year),
          fiscalPeriod: 'FY',
          unit: 'percent',
          calculationType: 'margin'
        });
        console.log(`  Operating Margin: ${margin.toFixed(2)}%`);
      }

      // Net Margin
      if (yearMetrics.revenue && yearMetrics.net_income) {
        const margin = (yearMetrics.net_income / yearMetrics.revenue) * 100;
        calculatedMetrics.push({
          ticker,
          metricName: 'net_margin',
          value: margin.toFixed(2),
          fiscalYear: parseInt(year),
          fiscalPeriod: 'FY',
          unit: 'percent',
          calculationType: 'margin'
        });
        console.log(`  Net Margin: ${margin.toFixed(2)}%`);
      }

      // ROE (Return on Equity)
      if (yearMetrics.net_income && yearMetrics.stockholders_equity) {
        const roe = (yearMetrics.net_income / yearMetrics.stockholders_equity) * 100;
        calculatedMetrics.push({
          ticker,
          metricName: 'return_on_equity',
          value: roe.toFixed(2),
          fiscalYear: parseInt(year),
          fiscalPeriod: 'FY',
          unit: 'percent',
          calculationType: 'ratio'
        });
        console.log(`  ROE: ${roe.toFixed(2)}%`);
      }

      // ROA (Return on Assets)
      if (yearMetrics.net_income && yearMetrics.total_assets) {
        const roa = (yearMetrics.net_income / yearMetrics.total_assets) * 100;
        calculatedMetrics.push({
          ticker,
          metricName: 'return_on_assets',
          value: roa.toFixed(2),
          fiscalYear: parseInt(year),
          fiscalPeriod: 'FY',
          unit: 'percent',
          calculationType: 'ratio'
        });
        console.log(`  ROA: ${roa.toFixed(2)}%`);
      }

      // Debt to Equity Ratio
      if (yearMetrics.total_debt && yearMetrics.stockholders_equity) {
        const ratio = yearMetrics.total_debt / yearMetrics.stockholders_equity;
        calculatedMetrics.push({
          ticker,
          metricName: 'debt_to_equity',
          value: ratio.toFixed(2),
          fiscalYear: parseInt(year),
          fiscalPeriod: 'FY',
          unit: 'ratio',
          calculationType: 'ratio'
        });
        console.log(`  Debt/Equity: ${ratio.toFixed(2)}`);
      }

      console.log('');
    }

    // Save calculated metrics
    console.log(`\n💾 Saving ${calculatedMetrics.length} calculated metrics...`);
    
    for (const metric of calculatedMetrics) {
      await prisma.calculatedMetric.upsert({
        where: {
          ticker_metricName_fiscalYear_fiscalPeriod: {
            ticker: metric.ticker,
            metricName: metric.metricName,
            fiscalYear: metric.fiscalYear,
            fiscalPeriod: metric.fiscalPeriod
          }
        },
        update: {
          value: metric.value,
          unit: metric.unit,
          calculationType: metric.calculationType
        },
        create: metric
      });
    }

    console.log('✅ Calculated metrics saved successfully!\n');

    // Verify
    const count = await prisma.calculatedMetric.count({ where: { ticker } });
    console.log(`Total calculated metrics for ${ticker}: ${count}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

calculateATTMetrics().catch(console.error);
