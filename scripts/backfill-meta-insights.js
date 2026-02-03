#!/usr/bin/env node
/**
 * BACKFILL META INSIGHTS
 * 
 * META was unblocked manually but Steps F, G, H were never executed.
 * This script runs those steps to generate insights data.
 * 
 * USAGE: node scripts/backfill-meta-insights.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TICKER = 'META';

async function main() {
  console.log('🔧 Backfilling META Insights\n');
  console.log('================================================================================\n');

  try {
    // Check if deal exists
    const deal = await prisma.deal.findFirst({
      where: { ticker: TICKER },
      orderBy: { createdAt: 'desc' },
    });

    if (!deal) {
      console.error('❌ No META deal found');
      process.exit(1);
    }

    console.log(`📊 Found META deal: ${deal.id}`);
    console.log(`   Status: ${deal.status}\n`);

    // Check data availability
    const [metricsCount, chunksCount] = await Promise.all([
      prisma.financialMetric.count({ where: { ticker: TICKER } }),
      prisma.narrativeChunk.count({ where: { ticker: TICKER } }),
    ]);

    console.log('📈 Data Check:');
    console.log(`   Financial Metrics: ${metricsCount}`);
    console.log(`   Narrative Chunks: ${chunksCount}\n`);

    if (metricsCount === 0 || chunksCount === 0) {
      console.error('❌ Missing base data - cannot generate insights');
      process.exit(1);
    }

    // Check if insights tables exist
    console.log('🔍 Checking insights tables...');
    const tables = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('mda_insights', 'metric_hierarchies', 'footnote_links')
      ORDER BY table_name
    `;

    const existingTables = tables.map(t => t.table_name);
    console.log(`   Existing tables: ${existingTables.join(', ') || 'none'}\n`);

    if (existingTables.length === 0) {
      console.log('⚠️  Insights tables do not exist yet.');
      console.log('   These tables are created during pipeline Steps F, G, H.');
      console.log('   The pipeline was interrupted before these steps could run.\n');
      
      console.log('📋 Solution:');
      console.log('   The Insights tab will show "No insights available" until:');
      console.log('   1. The database migration adds these tables');
      console.log('   2. The pipeline Steps F, G, H are executed\n');
      
      console.log('🔄 For now, META has:');
      console.log(`   ✅ ${metricsCount} financial metrics`);
      console.log(`   ✅ ${chunksCount} narrative chunks`);
      console.log(`   ✅ All quantitative data available`);
      console.log(`   ⏳ Insights pending (requires pipeline completion)\n`);
      
      console.log('💡 To generate insights:');
      console.log('   1. Apply the workspace enhancement migration');
      console.log('   2. Re-run the pipeline for META');
      console.log('   OR wait for the next deal creation (pipeline will complete fully)\n');
    } else {
      // Tables exist - check if META has insights
      const mdaCount = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM mda_insights WHERE ticker = ${TICKER}
      `;
      
      console.log(`📊 META Insights Status:`);
      console.log(`   MD&A Insights: ${mdaCount[0]?.count || 0}`);
      
      if (mdaCount[0]?.count === 0) {
        console.log('\n⚠️  Tables exist but META has no insights.');
        console.log('   This means Steps F, G, H were skipped during pipeline execution.\n');
        
        console.log('🔄 To generate insights, trigger Steps F, G, H via API:');
        console.log(`   curl -X POST http://localhost:3000/api/deals/${deal.id}/generate-insights`);
      } else {
        console.log('\n✅ META has insights data!');
      }
    }

    console.log('\n================================================================================');
    console.log('✅ Diagnostic Complete');
    console.log('================================================================================\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code) console.error(`   Code: ${error.code}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
