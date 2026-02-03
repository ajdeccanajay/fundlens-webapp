#!/usr/bin/env node
/**
 * EMERGENCY UNBLOCK SCRIPT FOR META
 * 
 * META deal is stuck in "processing" status due to in-memory pipeline state loss.
 * This script manually sets the deal status to 'ready' since all data exists in DB.
 * 
 * USAGE: node scripts/unblock-meta.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function unblockMeta() {
  console.log('🔧 EMERGENCY UNBLOCK: META Deal');
  console.log('================================\n');

  try {
    // Find META deal
    const metaDeal = await prisma.deal.findFirst({
      where: { ticker: 'META' },
      orderBy: { createdAt: 'desc' },
    });

    if (!metaDeal) {
      console.error('❌ No META deal found in database');
      process.exit(1);
    }

    console.log(`📊 Found META deal: ${metaDeal.id}`);
    console.log(`   Current Status: ${metaDeal.status}`);
    console.log(`   Created: ${metaDeal.createdAt}`);
    console.log(`   Updated: ${metaDeal.updatedAt}`);
    console.log(`   Message: ${metaDeal.processingMessage || 'N/A'}\n`);

    // Check data availability
    const [metricsCount, chunksCount, calculatedCount] = await Promise.all([
      prisma.financialMetric.count({ where: { ticker: 'META' } }),
      prisma.narrativeChunk.count({ where: { ticker: 'META' } }),
      prisma.calculatedMetric.count({ where: { ticker: 'META' } }),
    ]);

    console.log('📈 Data Availability Check:');
    console.log(`   Financial Metrics: ${metricsCount}`);
    console.log(`   Calculated Metrics: ${calculatedCount}`);
    console.log(`   Narrative Chunks: ${chunksCount}\n`);

    if (metricsCount === 0) {
      console.error('❌ No financial metrics found - cannot unblock');
      process.exit(1);
    }

    // Update deal status to 'ready'
    console.log('🔄 Updating deal status to "ready"...');
    
    await prisma.deal.update({
      where: { id: metaDeal.id },
      data: {
        status: 'ready',
        processingMessage: 'Analysis ready! All data processed successfully.',
        updatedAt: new Date(),
      },
    });

    console.log('✅ META deal unblocked successfully!');
    console.log('\n📋 Summary:');
    console.log(`   Deal ID: ${metaDeal.id}`);
    console.log(`   Ticker: META`);
    console.log(`   New Status: ready`);
    console.log(`   Metrics: ${metricsCount} raw, ${calculatedCount} calculated`);
    console.log(`   Narratives: ${chunksCount} chunks`);
    console.log('\n🎉 Users can now access META analysis at:');
    console.log(`   http://localhost:3000/app/deals/workspace.html?ticker=META\n`);

  } catch (error) {
    console.error('❌ Error unblocking META:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

unblockMeta();
