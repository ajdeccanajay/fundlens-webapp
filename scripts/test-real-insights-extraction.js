#!/usr/bin/env node

/**
 * Test Real Insights Extraction
 * 
 * Validates that insights are being extracted correctly:
 * 1. No mock data
 * 2. Real pattern-based extraction
 * 3. Valid fiscal periods only
 * 4. Proper data structure
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function isValidFiscalPeriod(fiscalPeriod) {
  if (!fiscalPeriod || fiscalPeriod.trim().length === 0) {
    return false;
  }

  const fyMatch = fiscalPeriod.match(/FY(\d{4})/);
  const qMatch = fiscalPeriod.match(/Q\d\s+(\d{4})/);
  const yearMatch = fiscalPeriod.match(/^(\d{4})$/);

  let year = null;

  if (fyMatch) {
    year = parseInt(fyMatch[1]);
  } else if (qMatch) {
    year = parseInt(qMatch[1]);
  } else if (yearMatch) {
    year = parseInt(yearMatch[1]);
  }

  return year !== null && year >= 1990 && year <= 2030;
}

async function testTicker(ticker) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${ticker}`);
  console.log('='.repeat(60));

  const results = {
    ticker,
    totalInsights: 0,
    validPeriods: 0,
    invalidPeriods: 0,
    withTrends: 0,
    withRisks: 0,
    withGuidance: 0,
    avgConfidence: 0,
    issues: []
  };

  // Get all insights for this ticker
  const insights = await prisma.mdaInsight.findMany({
    where: { ticker },
    orderBy: { fiscalPeriod: 'desc' }
  });

  results.totalInsights = insights.length;

  if (insights.length === 0) {
    results.issues.push('No insights found');
    return results;
  }

  console.log(`\nFound ${insights.length} insights\n`);

  let totalConfidence = 0;

  for (const insight of insights) {
    console.log(`\n📊 ${insight.fiscalPeriod}`);
    console.log('-'.repeat(40));

    // Validate fiscal period
    if (!isValidFiscalPeriod(insight.fiscalPeriod)) {
      console.log(`❌ INVALID FISCAL PERIOD: ${insight.fiscalPeriod}`);
      results.invalidPeriods++;
      results.issues.push(`Invalid fiscal period: ${insight.fiscalPeriod}`);
      continue;
    }

    results.validPeriods++;

    // Check trends
    const trends = Array.isArray(insight.trends) ? insight.trends : [];
    console.log(`   Trends: ${trends.length}`);
    if (trends.length > 0) {
      results.withTrends++;
      console.log(`   Sample trend: ${trends[0].metric} - ${trends[0].direction}`);
    }

    // Check risks
    const risks = Array.isArray(insight.risks) ? insight.risks : [];
    console.log(`   Risks: ${risks.length}`);
    if (risks.length > 0) {
      results.withRisks++;
      console.log(`   Sample risk: ${risks[0].title} (${risks[0].severity})`);
    }

    // Check guidance
    if (insight.guidance) {
      results.withGuidance++;
      const preview = insight.guidance.length > 80 
        ? insight.guidance.substring(0, 80) + '...' 
        : insight.guidance;
      console.log(`   Guidance: ${preview}`);
      console.log(`   Sentiment: ${insight.guidanceSentiment}`);
    }

    // Check confidence
    const confidence = insight.confidenceScore ? parseFloat(insight.confidenceScore.toString()) : 0;
    console.log(`   Confidence: ${confidence}%`);
    console.log(`   Method: ${insight.extractionMethod}`);
    
    totalConfidence += confidence;

    // Validate extraction method
    if (insight.extractionMethod !== 'pattern_based') {
      results.issues.push(`${insight.fiscalPeriod}: Wrong extraction method (${insight.extractionMethod})`);
    }

    // Check for mock data indicators
    if (insight.guidance && insight.guidance.includes('Management expects continued growth')) {
      results.issues.push(`${insight.fiscalPeriod}: Possible mock data detected in guidance`);
    }

    if (trends.some(t => t.metric === 'revenue_growth' && !t.context)) {
      results.issues.push(`${insight.fiscalPeriod}: Possible mock data detected in trends`);
    }
  }

  results.avgConfidence = results.validPeriods > 0 
    ? (totalConfidence / results.validPeriods).toFixed(1) 
    : 0;

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const ticker = args[0] ? args[0].toUpperCase() : 'META';

  console.log('🧪 Real Insights Extraction Test');
  console.log('=================================');
  console.log(`Testing ticker: ${ticker}\n`);

  try {
    const results = await testTicker(ticker);

    console.log('\n\n📊 TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Ticker: ${results.ticker}`);
    console.log(`Total Insights: ${results.totalInsights}`);
    console.log(`Valid Periods: ${results.validPeriods}`);
    console.log(`Invalid Periods: ${results.invalidPeriods}`);
    console.log(`With Trends: ${results.withTrends}`);
    console.log(`With Risks: ${results.withRisks}`);
    console.log(`With Guidance: ${results.withGuidance}`);
    console.log(`Avg Confidence: ${results.avgConfidence}%`);

    if (results.issues.length > 0) {
      console.log('\n⚠️  ISSUES FOUND:');
      results.issues.forEach(issue => console.log(`   - ${issue}`));
    }

    // Overall assessment
    console.log('\n\n🎯 ASSESSMENT');
    console.log('='.repeat(60));

    let passed = true;

    if (results.invalidPeriods > 0) {
      console.log('❌ FAIL: Invalid fiscal periods found');
      passed = false;
    } else {
      console.log('✅ PASS: All fiscal periods valid');
    }

    if (results.validPeriods === 0) {
      console.log('❌ FAIL: No valid insights found');
      passed = false;
    } else {
      console.log(`✅ PASS: ${results.validPeriods} valid insights found`);
    }

    if (results.withTrends === 0 && results.validPeriods > 0) {
      console.log('⚠️  WARNING: No trends extracted');
    } else if (results.withTrends > 0) {
      console.log(`✅ PASS: Trends extracted for ${results.withTrends} periods`);
    }

    if (results.withRisks === 0 && results.validPeriods > 0) {
      console.log('⚠️  WARNING: No risks extracted');
    } else if (results.withRisks > 0) {
      console.log(`✅ PASS: Risks extracted for ${results.withRisks} periods`);
    }

    if (results.avgConfidence < 30 && results.validPeriods > 0) {
      console.log(`⚠️  WARNING: Low average confidence (${results.avgConfidence}%)`);
    } else if (results.avgConfidence > 0) {
      console.log(`✅ PASS: Good average confidence (${results.avgConfidence}%)`);
    }

    if (results.issues.some(i => i.includes('mock data'))) {
      console.log('❌ FAIL: Mock data detected');
      passed = false;
    } else {
      console.log('✅ PASS: No mock data detected');
    }

    console.log('\n' + '='.repeat(60));
    if (passed) {
      console.log('✅ ALL TESTS PASSED');
    } else {
      console.log('❌ SOME TESTS FAILED');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
