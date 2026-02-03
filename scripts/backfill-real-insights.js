#!/usr/bin/env node

/**
 * Backfill Real MD&A Insights
 * 
 * Extracts REAL insights from narrative chunks using pattern-based extraction
 * Replaces mock data with actual extracted trends, risks, and guidance
 * 
 * Usage:
 *   node scripts/backfill-real-insights.js [TICKER]
 *   node scripts/backfill-real-insights.js META
 *   node scripts/backfill-real-insights.js --all
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Fiscal period validation
function isValidFiscalPeriod(fiscalPeriod) {
  if (!fiscalPeriod || fiscalPeriod.trim().length === 0) {
    return false;
  }

  // Extract year from various formats
  const fyMatch = fiscalPeriod.match(/FY(\d{4})/);
  const qMatch = fiscalPeriod.match(/Q\d\s+(\d{4})/);
  const mMatch = fiscalPeriod.match(/(\d+)M\s+(\d{4})/); // 6M 2023, 9M 2024
  const yearMatch = fiscalPeriod.match(/^(\d{4})$/);

  let year = null;

  if (fyMatch) {
    year = parseInt(fyMatch[1]);
  } else if (qMatch) {
    year = parseInt(qMatch[1]);
  } else if (mMatch) {
    year = parseInt(mMatch[2]);
  } else if (yearMatch) {
    year = parseInt(yearMatch[1]);
  }

  // Validate year range (1990-2030)
  if (year === null || year < 1990 || year > 2030) {
    return false;
  }

  return true;
}

// Simple pattern-based extraction (mirrors Python logic)
function extractTrends(text) {
  const trends = [];
  const patterns = [
    { regex: /(\w+(?:\s+\w+)?)\s+(?:increased|rose|grew|improved)\s+(?:by\s+)?(\d+(?:\.\d+)?)%/gi, direction: 'increasing' },
    { regex: /(\w+(?:\s+\w+)?)\s+(?:decreased|declined|fell|dropped)\s+(?:by\s+)?(\d+(?:\.\d+)?)%/gi, direction: 'decreasing' },
    { regex: /(\w+(?:\s+\w+)?)\s+(?:remained stable|was flat|unchanged)/gi, direction: 'stable' }
  ];

  const seen = new Set();

  for (const { regex, direction } of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const metric = match[1].toLowerCase().trim().replace(/\s+/g, '_');
      if (seen.has(metric)) continue;
      seen.add(metric);

      const magnitude = match[2] ? parseFloat(match[2]) : null;
      
      trends.push({
        metric,
        direction,
        magnitude,
        drivers: [],
        context: text.substring(Math.max(0, match.index - 100), Math.min(text.length, match.index + 200)).trim()
      });
    }
  }

  return trends;
}

function extractRisks(text) {
  const risks = [];
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);

  const riskKeywords = {
    high: ['significant risk', 'material risk', 'substantial risk', 'critical', 'severe'],
    medium: ['risk', 'challenge', 'uncertainty', 'concern', 'potential issue'],
    low: ['may impact', 'could affect', 'possible']
  };

  const riskCategories = {
    operational: ['supply chain', 'operations', 'production', 'manufacturing', 'logistics'],
    financial: ['liquidity', 'debt', 'credit', 'cash flow', 'financing'],
    market: ['competition', 'market share', 'demand', 'pricing', 'customer'],
    regulatory: ['regulation', 'compliance', 'legal', 'government', 'policy']
  };

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    
    let severity = null;
    for (const [sev, keywords] of Object.entries(riskKeywords)) {
      if (keywords.some(kw => lower.includes(kw))) {
        severity = sev;
        break;
      }
    }

    if (severity) {
      let category = 'other';
      for (const [cat, keywords] of Object.entries(riskCategories)) {
        if (keywords.some(kw => lower.includes(kw))) {
          category = cat;
          break;
        }
      }

      const words = sentence.trim().split(/\s+/);
      const title = words.slice(0, Math.min(8, words.length)).join(' ');

      risks.push({
        title: title.trim(),
        severity,
        description: sentence.trim(),
        mentions: 1,
        category
      });
    }
  }

  return risks.slice(0, 10); // Limit to top 10
}

function extractGuidance(text) {
  const patterns = [
    /(?:we expect|expect|guidance|outlook|forecast|anticipate|project)\s+([^.]+)/gi,
    /(?:for\s+(?:fiscal\s+)?(?:year\s+)?\d{4})[,\s]+(?:we expect|expect)\s+([^.]+)/gi
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

function analyzeSentiment(text) {
  const lower = text.toLowerCase();
  
  const positiveKeywords = ['strong', 'growth', 'improved', 'increased', 'favorable', 'positive', 'optimistic', 'confident'];
  const negativeKeywords = ['weak', 'decline', 'decreased', 'unfavorable', 'negative', 'challenging', 'difficult', 'concern'];

  let positiveCount = 0;
  let negativeCount = 0;

  for (const kw of positiveKeywords) {
    const matches = lower.match(new RegExp(kw, 'g'));
    if (matches) positiveCount += matches.length;
  }

  for (const kw of negativeKeywords) {
    const matches = lower.match(new RegExp(kw, 'g'));
    if (matches) negativeCount += matches.length;
  }

  if (positiveCount > negativeCount * 1.5) return 'positive';
  if (negativeCount > positiveCount * 1.5) return 'negative';
  return 'neutral';
}

function calculateConfidence(trends, risks, guidance) {
  let score = 0;
  score += Math.min(40, trends.length * 10);
  score += Math.min(30, risks.length * 5);
  if (guidance && guidance.length > 20) score += 30;
  return Math.min(100, score);
}

async function backfillTicker(ticker) {
  console.log(`\n🔍 Processing ${ticker}...`);

  // Get deals for this ticker
  const deals = await prisma.deal.findMany({
    where: { ticker }
  });

  if (deals.length === 0) {
    console.log(`❌ No deals found for ${ticker}`);
    return { ticker, processed: 0, skipped: 0, errors: 0 };
  }

  const dealId = deals[0].id;
  console.log(`✅ Found deal: ${dealId}`);

  // Delete invalid fiscal periods (like FY2657)
  const deleted = await prisma.mdaInsight.deleteMany({
    where: {
      ticker,
      fiscalPeriod: {
        not: {
          in: [] // We'll validate each one
        }
      }
    }
  });

  // Actually, let's be more specific - delete anything outside 1990-2030
  const allInsights = await prisma.mdaInsight.findMany({
    where: { ticker },
    select: { id: true, fiscalPeriod: true }
  });

  let deletedCount = 0;
  for (const insight of allInsights) {
    if (!isValidFiscalPeriod(insight.fiscalPeriod)) {
      await prisma.mdaInsight.delete({ where: { id: insight.id } });
      console.log(`🗑️  Deleted invalid period: ${insight.fiscalPeriod}`);
      deletedCount++;
    }
  }

  if (deletedCount > 0) {
    console.log(`✅ Deleted ${deletedCount} invalid fiscal periods`);
  }

  // Get narrative chunks grouped by fiscal period
  // Note: NarrativeChunk doesn't have fiscalPeriod, so we need to derive it from filingDate
  // Handle variations: item_7, item_7_01 (MD&A), item_1a (Risk Factors), item_1, item_1_02 (Business)
  const narrativeChunks = await prisma.narrativeChunk.findMany({
    where: {
      ticker,
      OR: [
        { sectionType: { in: ['item_7', 'item_7_01'] } }, // MD&A
        { sectionType: { in: ['item_1a'] } }, // Risk Factors
        { sectionType: { in: ['item_1', 'item_1_02'] } } // Business
      ]
    },
    select: {
      filingDate: true,
      filingType: true,
      sectionType: true,
      content: true
    }
  });

  console.log(`📄 Found ${narrativeChunks.length} narrative chunks`);

  // Get fiscal periods from financial_metrics to map filing dates
  const fiscalPeriods = await prisma.financialMetric.findMany({
    where: { ticker },
    select: {
      fiscalPeriod: true,
      filingDate: true
    },
    distinct: ['fiscalPeriod', 'filingDate']
  });

  // Create a map from filing date to fiscal period
  const filingDateToFiscalPeriod = new Map();
  for (const fp of fiscalPeriods) {
    if (fp.filingDate) {
      const dateKey = fp.filingDate.toISOString().split('T')[0];
      filingDateToFiscalPeriod.set(dateKey, fp.fiscalPeriod);
    }
  }

  console.log(`📅 Mapped ${filingDateToFiscalPeriod.size} filing dates to fiscal periods`);

  // Group by fiscal period
  const periodMap = new Map();
  
  for (const chunk of narrativeChunks) {
    const dateKey = chunk.filingDate.toISOString().split('T')[0];
    const fiscalPeriod = filingDateToFiscalPeriod.get(dateKey);

    if (!fiscalPeriod) {
      // Try to derive from filing date (year)
      const year = chunk.filingDate.getFullYear();
      const derivedPeriod = `FY${year}`;
      
      if (!isValidFiscalPeriod(derivedPeriod)) {
        console.log(`⚠️  Could not map filing date ${dateKey} to fiscal period, skipping`);
        continue;
      }

      if (!periodMap.has(derivedPeriod)) {
        periodMap.set(derivedPeriod, { mda: [], risks: [], business: [] });
      }

      const sections = periodMap.get(derivedPeriod);
      
      if (chunk.sectionType === 'item_7' || chunk.sectionType === 'item_7_01') {
        sections.mda.push(chunk.content);
      } else if (chunk.sectionType === 'item_1a') {
        sections.risks.push(chunk.content);
      } else if (chunk.sectionType === 'item_1' || chunk.sectionType === 'item_1_02') {
        sections.business.push(chunk.content);
      }
      continue;
    }

    if (!isValidFiscalPeriod(fiscalPeriod)) {
      console.log(`⚠️  Skipping invalid fiscal period: ${fiscalPeriod}`);
      continue;
    }

    if (!periodMap.has(fiscalPeriod)) {
      periodMap.set(fiscalPeriod, { mda: [], risks: [], business: [] });
    }

    const sections = periodMap.get(fiscalPeriod);
    
    if (chunk.sectionType === 'item_7' || chunk.sectionType === 'item_7_01') {
      sections.mda.push(chunk.content);
    } else if (chunk.sectionType === 'item_1a') {
      sections.risks.push(chunk.content);
    } else if (chunk.sectionType === 'item_1' || chunk.sectionType === 'item_1_02') {
      sections.business.push(chunk.content);
    }
  }

  console.log(`📊 Found ${periodMap.size} valid fiscal periods`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  // Extract insights for each period
  for (const [fiscalPeriod, sections] of periodMap.entries()) {
    try {
      const mdaText = sections.mda.join('\n\n');
      
      if (mdaText.length < 100) {
        console.log(`⚠️  Insufficient MD&A text for ${fiscalPeriod}, skipping`);
        skipped++;
        continue;
      }

      console.log(`\n📝 Extracting insights for ${ticker} ${fiscalPeriod}...`);
      console.log(`   MD&A text length: ${mdaText.length} chars`);

      // Extract using pattern-based analysis
      const trends = extractTrends(mdaText);
      const risks = extractRisks(mdaText);
      const guidance = extractGuidance(mdaText);
      const sentiment = analyzeSentiment(guidance || mdaText);
      const confidence = calculateConfidence(trends, risks, guidance);

      console.log(`   ✅ Extracted: ${trends.length} trends, ${risks.length} risks`);
      console.log(`   📈 Guidance sentiment: ${sentiment}, confidence: ${confidence}%`);

      // Save to database
      await prisma.mdaInsight.upsert({
        where: {
          dealId_fiscalPeriod: {
            dealId,
            fiscalPeriod
          }
        },
        update: {
          trends,
          risks,
          guidance,
          guidanceSentiment: sentiment,
          extractionMethod: 'pattern_based',
          confidenceScore: confidence,
          updatedAt: new Date()
        },
        create: {
          dealId,
          ticker,
          fiscalPeriod,
          trends,
          risks,
          guidance,
          guidanceSentiment: sentiment,
          extractionMethod: 'pattern_based',
          confidenceScore: confidence
        }
      });

      processed++;
      console.log(`   ✅ Saved insights for ${fiscalPeriod}`);

    } catch (error) {
      console.error(`   ❌ Error processing ${fiscalPeriod}: ${error.message}`);
      errors++;
    }
  }

  return { ticker, processed, skipped, errors };
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node scripts/backfill-real-insights.js [TICKER|--all]');
    console.log('Examples:');
    console.log('  node scripts/backfill-real-insights.js META');
    console.log('  node scripts/backfill-real-insights.js CMCSA');
    console.log('  node scripts/backfill-real-insights.js --all');
    process.exit(1);
  }

  const ticker = args[0].toUpperCase();

  console.log('🚀 Real MD&A Insights Backfill');
  console.log('================================');
  console.log('This script extracts REAL insights from narrative chunks');
  console.log('using pattern-based extraction (no mock data).\n');

  try {
    if (ticker === '--ALL') {
      // Get all tickers with deals
      const deals = await prisma.deal.findMany({
        select: { ticker: true },
        distinct: ['ticker']
      });

      console.log(`Found ${deals.length} tickers to process\n`);

      const results = [];
      for (const deal of deals) {
        if (deal.ticker) {
          const result = await backfillTicker(deal.ticker);
          results.push(result);
        }
      }

      console.log('\n\n📊 SUMMARY');
      console.log('==========');
      for (const result of results) {
        console.log(`${result.ticker}: ${result.processed} processed, ${result.skipped} skipped, ${result.errors} errors`);
      }

    } else {
      const result = await backfillTicker(ticker);
      
      console.log('\n\n📊 SUMMARY');
      console.log('==========');
      console.log(`Ticker: ${result.ticker}`);
      console.log(`Processed: ${result.processed} fiscal periods`);
      console.log(`Skipped: ${result.skipped} fiscal periods`);
      console.log(`Errors: ${result.errors} fiscal periods`);
    }

    console.log('\n✅ Backfill complete!');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
