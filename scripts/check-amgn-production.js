#!/usr/bin/env node

/**
 * Check AMGN Progress in Production
 * 
 * Verifies:
 * 1. SEC filings exist
 * 2. Financial metrics parsed
 * 3. Narrative chunks extracted
 * 4. Data quality and completeness
 */

// Load environment variables
require('dotenv').config();

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkAMGNProgress() {
  console.log('🔍 Checking AMGN Progress in Production');
  console.log('==========================================\n');

  try {
    const ticker = 'AMGN';
    
    // 1. Check SEC Filings
    console.log('1. SEC Filings');
    console.log('---------------');
    
    const filings = await prisma.secFiling.findMany({
      where: { ticker },
      orderBy: { filingDate: 'desc' },
      take: 5
    });
    
    console.log(`Found ${filings.length} filings for ${ticker}`);
    
    if (filings.length > 0) {
      console.log('\nMost Recent Filings:');
      filings.forEach((filing, idx) => {
        console.log(`  ${idx + 1}. ${filing.formType} - ${filing.filingDate.toISOString().split('T')[0]} (${filing.fiscalYear})`);
        console.log(`     Accession: ${filing.accessionNumber}`);
        console.log(`     Status: ${filing.processingStatus || 'N/A'}`);
      });
    } else {
      console.log('❌ No filings found for AMGN');
      return;
    }
    
    // 2. Check Financial Metrics
    console.log('\n2. Financial Metrics');
    console.log('--------------------');
    
    const metrics = await prisma.financialMetric.findMany({
      where: { ticker },
      orderBy: { fiscalYear: 'desc' },
      take: 10
    });
    
    console.log(`Found ${metrics.length} financial metrics`);
    
    if (metrics.length > 0) {
      // Group by year and period
      const metricsByYear = {};
      metrics.forEach(m => {
        const key = `${m.fiscalYear}-${m.fiscalPeriod}`;
        if (!metricsByYear[key]) {
          metricsByYear[key] = [];
        }
        metricsByYear[key].push(m);
      });
      
      console.log('\nMetrics by Period:');
      Object.keys(metricsByYear).sort().reverse().forEach(key => {
        const periodMetrics = metricsByYear[key];
        console.log(`  ${key}: ${periodMetrics.length} metrics`);
        
        // Show key metrics
        const revenue = periodMetrics.find(m => m.metricName === 'Revenue');
        const netIncome = periodMetrics.find(m => m.metricName === 'Net Income');
        const totalAssets = periodMetrics.find(m => m.metricName === 'Total Assets');
        
        if (revenue) console.log(`    - Revenue: $${(revenue.value / 1000000).toFixed(0)}M`);
        if (netIncome) console.log(`    - Net Income: $${(netIncome.value / 1000000).toFixed(0)}M`);
        if (totalAssets) console.log(`    - Total Assets: $${(totalAssets.value / 1000000).toFixed(0)}M`);
      });
    } else {
      console.log('⚠️  No financial metrics found');
    }
    
    // 3. Check Narrative Chunks
    console.log('\n3. Narrative Chunks (RAG Data)');
    console.log('-------------------------------');
    
    const chunks = await prisma.narrativeChunk.findMany({
      where: { ticker },
      orderBy: { filingDate: 'desc' },
      take: 5
    });
    
    console.log(`Found ${chunks.length} narrative chunks (showing first 5)`);
    
    if (chunks.length > 0) {
      console.log('\nRecent Chunks:');
      chunks.forEach((chunk, idx) => {
        console.log(`  ${idx + 1}. ${chunk.sectionTitle || 'Untitled'}`);
        console.log(`     Filing: ${chunk.filingDate?.toISOString().split('T')[0] || 'N/A'}`);
        console.log(`     Length: ${chunk.content?.length || 0} chars`);
        console.log(`     Chunk ID: ${chunk.chunkId}`);
      });
      
      // Count total chunks
      const totalChunks = await prisma.narrativeChunk.count({
        where: { ticker }
      });
      console.log(`\nTotal narrative chunks: ${totalChunks}`);
    } else {
      console.log('⚠️  No narrative chunks found');
    }
    
    // 4. Check Data Quality
    console.log('\n4. Data Quality Check');
    console.log('---------------------');
    
    // Check for recent data (last 2 years)
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    
    const recentFilings = await prisma.secFiling.count({
      where: {
        ticker,
        filingDate: { gte: twoYearsAgo }
      }
    });
    
    const recentMetrics = await prisma.financialMetric.count({
      where: {
        ticker,
        fiscalYear: { gte: twoYearsAgo.getFullYear() - 2 }
      }
    });
    
    const recentChunks = await prisma.narrativeChunk.count({
      where: {
        ticker,
        filingDate: { gte: twoYearsAgo }
      }
    });
    
    console.log(`Recent data (last 2 years):`);
    console.log(`  - Filings: ${recentFilings}`);
    console.log(`  - Metrics: ${recentMetrics}`);
    console.log(`  - Chunks: ${recentChunks}`);
    
    // 5. Check Deals
    console.log('\n5. Deals Using AMGN');
    console.log('--------------------');
    
    const deals = await prisma.deal.findMany({
      where: { ticker },
      select: {
        id: true,
        name: true,
        createdAt: true,
        status: true
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    
    console.log(`Found ${deals.length} deals for ${ticker}`);
    
    if (deals.length > 0) {
      deals.forEach((deal, idx) => {
        console.log(`  ${idx + 1}. ${deal.name}`);
        console.log(`     Created: ${deal.createdAt.toISOString().split('T')[0]}`);
        console.log(`     Status: ${deal.status || 'N/A'}`);
      });
    }
    
    // 6. Summary
    console.log('\n==========================================');
    console.log('Summary');
    console.log('==========================================\n');
    
    const status = {
      filings: filings.length > 0 ? '✅' : '❌',
      metrics: metrics.length > 0 ? '✅' : '❌',
      chunks: chunks.length > 0 ? '✅' : '❌',
      recent: recentFilings > 0 && recentMetrics > 0 ? '✅' : '⚠️'
    };
    
    console.log(`${status.filings} SEC Filings: ${filings.length} total`);
    console.log(`${status.metrics} Financial Metrics: ${metrics.length} total`);
    console.log(`${status.chunks} Narrative Chunks: ${chunks.length} total`);
    console.log(`${status.recent} Recent Data: ${recentFilings} filings, ${recentMetrics} metrics`);
    console.log(`   Deals: ${deals.length}`);
    
    const allGood = Object.values(status).every(s => s === '✅');
    
    if (allGood) {
      console.log('\n✅ AMGN data is complete and ready for use!');
    } else if (status.filings === '✅' && status.metrics === '✅') {
      console.log('\n⚠️  AMGN data is mostly complete, but some components may be missing.');
    } else {
      console.log('\n❌ AMGN data is incomplete. Pipeline may need to be run.');
    }
    
  } catch (error) {
    console.error('Error checking AMGN progress:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the check
checkAMGNProgress()
  .then(() => {
    console.log('\n✓ Check complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Check failed:', error.message);
    process.exit(1);
  });
