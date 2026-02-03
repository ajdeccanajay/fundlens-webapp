#!/usr/bin/env node

/**
 * Database Metric Analysis Script
 * 
 * Purpose: Analyze the financial_metrics table to discover:
 * 1. All unique normalizedMetric values
 * 2. All unique rawLabel values (actual XBRL labels from SEC filings)
 * 3. Industry-specific patterns (group by ticker)
 * 4. Frequency analysis (most common metrics)
 * 5. Gap analysis (metrics not in current YAML)
 * 
 * Output: JSON file with comprehensive metric analysis
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Industry mapping (GICS sectors) - simplified for common tickers
const INDUSTRY_MAP = {
  // Technology
  AAPL: 'technology',
  MSFT: 'technology',
  GOOGL: 'technology',
  GOOG: 'technology',
  META: 'technology',
  NVDA: 'technology',
  TSLA: 'technology',
  
  // Banking
  JPM: 'banking',
  BAC: 'banking',
  WFC: 'banking',
  C: 'banking',
  GS: 'banking',
  MS: 'banking',
  
  // Insurance
  BRK: 'insurance',
  UNH: 'insurance',
  CVS: 'insurance',
  
  // Healthcare
  JNJ: 'healthcare',
  PFE: 'healthcare',
  ABBV: 'healthcare',
  
  // Energy
  XOM: 'energy',
  CVX: 'energy',
  COP: 'energy',
  
  // Media
  DIS: 'media',
  CMCSA: 'media',
  NFLX: 'media',
  
  // Telecom
  T: 'telecom',
  VZ: 'telecom',
  TMUS: 'telecom',
  
  // Retail
  WMT: 'retail',
  AMZN: 'retail',
  HD: 'retail',
  
  // Manufacturing
  BA: 'manufacturing',
  CAT: 'manufacturing',
  GE: 'manufacturing',
};

async function analyzeMetrics() {
  console.log('🔍 Starting database metric analysis...\n');

  try {
    // 1. Get all unique normalized metrics
    console.log('📊 Analyzing normalized metrics...');
    const normalizedMetrics = await prisma.$queryRaw`
      SELECT 
        "normalized_metric" as metric,
        COUNT(*) as occurrence_count,
        COUNT(DISTINCT ticker) as ticker_count,
        ARRAY_AGG(DISTINCT ticker) as tickers
      FROM financial_metrics
      GROUP BY "normalized_metric"
      ORDER BY occurrence_count DESC
    `;
    
    console.log(`   Found ${normalizedMetrics.length} unique normalized metrics\n`);

    // 2. Get all unique raw labels (actual XBRL labels)
    console.log('📊 Analyzing raw XBRL labels...');
    const rawLabels = await prisma.$queryRaw`
      SELECT 
        "raw_label" as label,
        "normalized_metric" as normalized_to,
        COUNT(*) as occurrence_count,
        COUNT(DISTINCT ticker) as ticker_count,
        ARRAY_AGG(DISTINCT ticker) as tickers
      FROM financial_metrics
      WHERE "raw_label" IS NOT NULL
      GROUP BY "raw_label", "normalized_metric"
      ORDER BY occurrence_count DESC
    `;
    
    console.log(`   Found ${rawLabels.length} unique raw labels\n`);

    // 3. Get all unique XBRL tags
    console.log('📊 Analyzing XBRL tags...');
    const xbrlTags = await prisma.$queryRaw`
      SELECT 
        "xbrl_tag" as tag,
        "normalized_metric" as normalized_to,
        COUNT(*) as occurrence_count,
        COUNT(DISTINCT ticker) as ticker_count,
        ARRAY_AGG(DISTINCT ticker) as tickers
      FROM financial_metrics
      WHERE "xbrl_tag" IS NOT NULL
      GROUP BY "xbrl_tag", "normalized_metric"
      ORDER BY occurrence_count DESC
    `;
    
    console.log(`   Found ${xbrlTags.length} unique XBRL tags\n`);

    // 4. Industry-specific analysis
    console.log('📊 Analyzing industry-specific patterns...');
    const industryMetrics = {};
    
    for (const [ticker, industry] of Object.entries(INDUSTRY_MAP)) {
      const metrics = await prisma.financialMetric.findMany({
        where: { ticker },
        select: {
          normalizedMetric: true,
          rawLabel: true,
          xbrlTag: true,
        },
        distinct: ['normalizedMetric'],
      });
      
      if (!industryMetrics[industry]) {
        industryMetrics[industry] = {
          tickers: [],
          metrics: new Set(),
          rawLabels: new Set(),
          xbrlTags: new Set(),
        };
      }
      
      industryMetrics[industry].tickers.push(ticker);
      metrics.forEach(m => {
        industryMetrics[industry].metrics.add(m.normalizedMetric);
        if (m.rawLabel) industryMetrics[industry].rawLabels.add(m.rawLabel);
        if (m.xbrlTag) industryMetrics[industry].xbrlTags.add(m.xbrlTag);
      });
    }
    
    // Convert Sets to Arrays for JSON serialization
    Object.keys(industryMetrics).forEach(industry => {
      industryMetrics[industry].metrics = Array.from(industryMetrics[industry].metrics);
      industryMetrics[industry].rawLabels = Array.from(industryMetrics[industry].rawLabels);
      industryMetrics[industry].xbrlTags = Array.from(industryMetrics[industry].xbrlTags);
    });
    
    console.log(`   Analyzed ${Object.keys(industryMetrics).length} industries\n`);

    // 5. Statement type analysis
    console.log('📊 Analyzing by statement type...');
    const statementTypes = await prisma.$queryRaw`
      SELECT 
        "statement_type" as type,
        COUNT(DISTINCT "normalized_metric") as metric_count,
        ARRAY_AGG(DISTINCT "normalized_metric") as metrics
      FROM financial_metrics
      GROUP BY "statement_type"
      ORDER BY metric_count DESC
    `;
    
    console.log(`   Found ${statementTypes.length} statement types\n`);

    // 6. Get sample data for top metrics
    console.log('📊 Getting sample data for top metrics...');
    const topMetrics = normalizedMetrics.slice(0, 20);
    const metricSamples = {};
    
    for (const metric of topMetrics) {
      const samples = await prisma.financialMetric.findMany({
        where: { normalizedMetric: metric.metric },
        select: {
          ticker: true,
          rawLabel: true,
          xbrlTag: true,
          statementType: true,
        },
        take: 5,
        distinct: ['ticker'],
      });
      
      metricSamples[metric.metric] = samples;
    }

    // 7. Compile results
    const results = {
      metadata: {
        analyzedAt: new Date().toISOString(),
        totalMetrics: normalizedMetrics.length,
        totalRawLabels: rawLabels.length,
        totalXbrlTags: xbrlTags.length,
        industries: Object.keys(industryMetrics).length,
      },
      normalizedMetrics: normalizedMetrics.map(m => ({
        metric: m.metric,
        occurrenceCount: Number(m.occurrence_count),
        tickerCount: Number(m.ticker_count),
        tickers: m.tickers,
      })),
      rawLabels: rawLabels.map(l => ({
        label: l.label,
        normalizedTo: l.normalized_to,
        occurrenceCount: Number(l.occurrence_count),
        tickerCount: Number(l.ticker_count),
        tickers: l.tickers,
      })),
      xbrlTags: xbrlTags.map(t => ({
        tag: t.tag,
        normalizedTo: t.normalized_to,
        occurrenceCount: Number(t.occurrence_count),
        tickerCount: Number(t.ticker_count),
        tickers: t.tickers,
      })),
      industryMetrics,
      statementTypes: statementTypes.map(s => ({
        type: s.type,
        metricCount: Number(s.metric_count),
        metrics: s.metrics,
      })),
      metricSamples,
    };

    // 8. Save results
    const outputPath = path.join(__dirname, '..', 'database-metrics-analysis.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    
    console.log('✅ Analysis complete!\n');
    console.log('📄 Results saved to:', outputPath);
    console.log('\n📊 Summary:');
    console.log(`   - Normalized Metrics: ${results.normalizedMetrics.length}`);
    console.log(`   - Raw Labels: ${results.rawLabels.length}`);
    console.log(`   - XBRL Tags: ${results.xbrlTags.length}`);
    console.log(`   - Industries: ${Object.keys(industryMetrics).length}`);
    console.log(`   - Statement Types: ${results.statementTypes.length}`);
    
    // 9. Print top 10 metrics
    console.log('\n🔝 Top 10 Most Common Metrics:');
    results.normalizedMetrics.slice(0, 10).forEach((m, i) => {
      console.log(`   ${i + 1}. ${m.metric} (${m.occurrenceCount} occurrences, ${m.tickerCount} tickers)`);
    });
    
    // 10. Print industry summary
    console.log('\n🏢 Industry Summary:');
    Object.entries(industryMetrics).forEach(([industry, data]) => {
      console.log(`   ${industry}: ${data.metrics.length} metrics, ${data.tickers.length} tickers`);
    });

  } catch (error) {
    console.error('❌ Error analyzing metrics:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run analysis
analyzeMetrics()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
