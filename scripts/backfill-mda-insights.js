#!/usr/bin/env node

/**
 * Backfill MD&A Insights for Existing Deals
 * 
 * This script manually triggers Step F (MD&A Insights Extraction) for deals
 * that were processed before the section_type fix was applied.
 * 
 * Usage:
 *   node scripts/backfill-mda-insights.js [ticker]
 * 
 * Examples:
 *   node scripts/backfill-mda-insights.js COST    # Backfill COST only
 *   node scripts/backfill-mda-insights.js          # Backfill all ready deals
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function backfillInsights(ticker = null) {
  try {
    console.log('🔍 Finding deals to backfill...\n');

    // Get deals to process
    const where = { status: 'ready' };
    if (ticker) {
      where.ticker = ticker.toUpperCase();
    }

    const deals = await prisma.deal.findMany({ where });

    if (deals.length === 0) {
      console.log('❌ No deals found to backfill');
      return;
    }

    console.log(`📊 Found ${deals.length} deal(s) to process:\n`);
    deals.forEach(d => console.log(`   - ${d.ticker} (${d.id})`));
    console.log('');

    // Process each deal
    for (const deal of deals) {
      console.log(`\n🔄 Processing ${deal.ticker}...`);

      // Check if already has insights
      const existingInsights = await prisma.mdaInsight.count({
        where: { ticker: deal.ticker }
      });

      if (existingInsights > 0) {
        console.log(`   ℹ️  Already has ${existingInsights} insights - skipping`);
        continue;
      }

      // Check for MD&A chunks (item_7)
      const mdaChunks = await prisma.narrativeChunk.count({
        where: {
          ticker: deal.ticker,
          sectionType: 'item_7'
        }
      });

      if (mdaChunks === 0) {
        console.log(`   ⚠️  No MD&A chunks found - skipping`);
        continue;
      }

      console.log(`   ✅ Found ${mdaChunks} MD&A chunks`);

      // Trigger Step F via internal API
      try {
        const response = await fetch(`http://localhost:3000/api/internal/backfill-insights/${deal.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
          const result = await response.json();
          console.log(`   ✅ Insights extracted: ${result.insightsCount || 0} periods`);
        } else {
          console.log(`   ❌ API error: ${response.status} ${response.statusText}`);
        }
      } catch (apiError) {
        console.log(`   ⚠️  API not available - manual extraction needed`);
        console.log(`   💡 Run: curl -X POST http://localhost:3000/api/internal/backfill-insights/${deal.id}`);
      }
    }

    console.log('\n✅ Backfill complete!\n');

    // Show summary
    const totalInsights = await prisma.mdaInsight.count();
    console.log(`📊 Total insights in database: ${totalInsights}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Parse command line args
const ticker = process.argv[2];

if (ticker && ticker.startsWith('-')) {
  console.log('Usage: node scripts/backfill-mda-insights.js [ticker]');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/backfill-mda-insights.js COST    # Backfill COST only');
  console.log('  node scripts/backfill-mda-insights.js          # Backfill all ready deals');
  process.exit(0);
}

backfillInsights(ticker);
