#!/usr/bin/env node
/**
 * Diagnostic Script: NVDA YoY Growth Issue
 * 
 * Investigates why YoY growth calculations are showing N/A for NVDA
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function diagnoseNVDAYoY() {
  console.log('='.repeat(80));
  console.log('NVDA YoY Growth Diagnostic');
  console.log('='.repeat(80));
  console.log('');

  try {
    // 1. Check what fiscal periods we have for NVDA
    console.log('1. Checking fiscal periods for NVDA...');
    const fiscalPeriods = await prisma.financialMetric.groupBy({
      by: ['fiscalPeriod'],
      where: { ticker: 'NVDA' },
      _count: true,
      orderBy: { fiscalPeriod: 'desc' },
    });
    
    console.log('   Fiscal Periods Found:');
    fiscalPeriods.forEach(fp => {
      console.log(`   - ${fp.fiscalPeriod}: ${fp._count} metrics`);
    });
    console.log('');

    // 2. Check Revenue data specifically
    console.log('2. Checking Revenue data...');
    const revenueData = await prisma.financialMetric.findMany({
      where: {
        ticker: 'NVDA',
        normalizedMetric: 'revenue',
      },
      select: {
        fiscalPeriod: true,
        value: true,
        filingDate: true,
      },
      orderBy: { fiscalPeriod: 'desc' },
    });

    console.log('   Revenue by Period:');
    revenueData.forEach(r => {
      console.log(`   - ${r.fiscalPeriod}: $${(Number(r.value) / 1e9).toFixed(2)}B (Filed: ${r.filingDate?.toISOString().split('T')[0] || 'N/A'})`);
    });
    console.log('');

    // 3. Check Net Income data
    console.log('3. Checking Net Income data...');
    const netIncomeData = await prisma.financialMetric.findMany({
      where: {
        ticker: 'NVDA',
        normalizedMetric: 'net_income',
      },
      select: {
        fiscalPeriod: true,
        value: true,
        filingDate: true,
      },
      orderBy: { fiscalPeriod: 'desc' },
    });

    console.log('   Net Income by Period:');
    netIncomeData.forEach(ni => {
      console.log(`   - ${ni.fiscalPeriod}: $${(Number(ni.value) / 1e9).toFixed(2)}B (Filed: ${ni.filingDate?.toISOString().split('T')[0] || 'N/A'})`);
    });
    console.log('');

    // 4. Check if we have prior year data for comparison
    console.log('4. Analyzing YoY comparison availability...');
    
    // Extract years from fiscal periods (e.g., "FY2024" -> 2024, "2024" -> 2024)
    const extractYear = (period) => {
      const match = period.match(/(\d{4})/);
      return match ? parseInt(match[1]) : null;
    };
    
    const periodsWithYears = revenueData.map(r => ({
      ...r,
      year: extractYear(r.fiscalPeriod),
    })).filter(r => r.year !== null);
    
    if (periodsWithYears.length === 0) {
      console.log('   ✗ Cannot extract years from fiscal periods');
      console.log('');
    } else {
      const currentYear = Math.max(...periodsWithYears.map(r => r.year));
      const priorYear = currentYear - 1;
      
      const currentRevenue = periodsWithYears.find(r => r.year === currentYear);
      const priorRevenue = periodsWithYears.find(r => r.year === priorYear);
      
      console.log(`   Current Year (${currentYear}):`);
      console.log(`     Period: ${currentRevenue?.fiscalPeriod || 'NOT FOUND'}`);
      console.log(`     Revenue: ${currentRevenue ? `$${(Number(currentRevenue.value) / 1e9).toFixed(2)}B` : 'NOT FOUND'}`);
      console.log(`   Prior Year (${priorYear}):`);
      console.log(`     Period: ${priorRevenue?.fiscalPeriod || 'NOT FOUND'}`);
      console.log(`     Revenue: ${priorRevenue ? `$${(Number(priorRevenue.value) / 1e9).toFixed(2)}B` : 'NOT FOUND'}`);
      
      if (currentRevenue && priorRevenue) {
        const yoyGrowth = ((Number(currentRevenue.value) - Number(priorRevenue.value)) / Number(priorRevenue.value) * 100).toFixed(1);
        console.log(`   ✓ YoY Growth Calculation: ${yoyGrowth}%`);
      } else {
        console.log(`   ✗ YoY Growth: CANNOT CALCULATE (missing ${!priorRevenue ? 'prior year' : 'current year'} data)`);
      }
    }
    console.log('');

    // 5. Check fiscal period format
    console.log('5. Checking fiscal period format...');
    const uniquePeriods = [...new Set(revenueData.map(r => r.fiscalPeriod))];
    console.log(`   Unique fiscal periods: ${uniquePeriods.join(', ')}`);
    console.log('');

    // 6. Check if there are multiple entries per year
    console.log('6. Checking for duplicate entries...');
    const yearCounts = {};
    revenueData.forEach(r => {
      const year = extractYear(r.fiscalPeriod);
      if (year) {
        const key = `FY${year}`;
        yearCounts[key] = (yearCounts[key] || 0) + 1;
      }
    });
    
    Object.entries(yearCounts).forEach(([year, count]) => {
      if (count > 1) {
        console.log(`   ⚠ ${year}: ${count} entries (DUPLICATE)`);
      } else {
        console.log(`   ✓ ${year}: ${count} entry`);
      }
    });
    console.log('');

    // 7. Root Cause Analysis
    console.log('='.repeat(80));
    console.log('ROOT CAUSE ANALYSIS');
    console.log('='.repeat(80));
    console.log('');

    const issues = [];

    // Check if we have less than 2 years of data
    if (revenueData.length < 2) {
      issues.push({
        issue: 'Insufficient Data',
        description: 'Only one fiscal year of data available',
        impact: 'Cannot calculate YoY growth without prior year comparison',
        fix: 'Ingest additional fiscal years of data',
      });
    }

    // Check fiscal period consistency
    if (uniquePeriods.length > 1) {
      issues.push({
        issue: 'Inconsistent Fiscal Periods',
        description: `Multiple fiscal period formats: ${uniquePeriods.join(', ')}`,
        impact: 'YoY comparison logic may not match periods correctly',
        fix: 'Standardize fiscal period format (e.g., always use "FY" prefix)',
      });
    }

    // Check for missing prior year
    if (!priorRevenue && currentRevenue) {
      issues.push({
        issue: 'Missing Prior Year Data',
        description: `Have FY${currentYear} but missing FY${priorYear}`,
        impact: 'YoY calculation returns N/A',
        fix: `Ingest FY${priorYear} data or adjust comparison logic`,
      });
    }

    // Check for duplicates
    const hasDuplicates = Object.values(yearCounts).some(count => count > 1);
    if (hasDuplicates) {
      issues.push({
        issue: 'Duplicate Fiscal Year Entries',
        description: 'Multiple metrics for the same fiscal year',
        impact: 'YoY calculation may use wrong comparison values',
        fix: 'Deduplicate data or use most recent filing date',
      });
    }

    if (issues.length === 0) {
      console.log('✓ No issues detected - YoY calculation should work');
      console.log('');
      console.log('Possible causes:');
      console.log('  1. Frontend is not passing correct fiscal period format');
      console.log('  2. Backend YoY calculation logic has a bug');
      console.log('  3. Caching issue - try clearing browser cache');
    } else {
      issues.forEach((issue, index) => {
        console.log(`Issue ${index + 1}: ${issue.issue}`);
        console.log(`  Description: ${issue.description}`);
        console.log(`  Impact: ${issue.impact}`);
        console.log(`  Fix: ${issue.fix}`);
        console.log('');
      });
    }

    // 8. Recommended Fix
    console.log('='.repeat(80));
    console.log('RECOMMENDED FIX');
    console.log('='.repeat(80));
    console.log('');

    if (revenueData.length < 2) {
      console.log('SOLUTION: Ingest additional fiscal years');
      console.log('');
      console.log('Run this command to ingest FY2023 data:');
      console.log(`  node scripts/end-to-end-pipeline.js NVDA 2023`);
      console.log('');
      console.log('Or trigger via API:');
      console.log(`  curl -X POST http://localhost:3000/api/simple/trigger-pipeline \\`);
      console.log(`    -H "Content-Type: application/json" \\`);
      console.log(`    -d '{"ticker":"NVDA","fiscalYear":2023}'`);
    } else if (uniquePeriods.length > 1 || hasDuplicates) {
      console.log('SOLUTION: Fix data quality issues');
      console.log('');
      console.log('1. Standardize fiscal periods:');
      console.log(`   UPDATE financial_metrics`);
      console.log(`   SET "fiscalPeriod" = 'FY' || "fiscalYear"`);
      console.log(`   WHERE ticker = 'NVDA' AND "fiscalPeriod" != 'FY' || "fiscalYear";`);
      console.log('');
      console.log('2. Remove duplicates (keep most recent):');
      console.log(`   DELETE FROM financial_metrics`);
      console.log(`   WHERE id NOT IN (`);
      console.log(`     SELECT DISTINCT ON (ticker, "fiscalYear", "normalizedMetric") id`);
      console.log(`     FROM financial_metrics`);
      console.log(`     WHERE ticker = 'NVDA'`);
      console.log(`     ORDER BY ticker, "fiscalYear", "normalizedMetric", "filingDate" DESC`);
      console.log(`   ) AND ticker = 'NVDA';`);
    } else {
      console.log('SOLUTION: Check frontend/backend YoY calculation logic');
      console.log('');
      console.log('Files to check:');
      console.log('  1. src/deals/deal.service.ts - getFinancialMetrics()');
      console.log('  2. public/app/deals/workspace.html - YoY calculation in Alpine.js');
      console.log('  3. src/deals/financial-calculator.service.ts - calculateYoYGrowth()');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

diagnoseNVDAYoY();
