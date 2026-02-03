#!/usr/bin/env node

/**
 * Manually run Step F (MD&A Insights Extraction) for COST
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function runStepF() {
  try {
    const dealId = '25f05044-25a0-4c97-b904-8f5fc23b7028';
    const ticker = 'COST';
    
    console.log(`🔄 Running Step F for ${ticker}...`);
    console.log(`   Deal ID: ${dealId}\n`);
    
    // Get MD&A narrative chunks from database (item_7 = MD&A)
    const mdaChunks = await prisma.narrativeChunk.findMany({
      where: {
        ticker,
        sectionType: 'item_7',
      },
      orderBy: { filingDate: 'desc' },
    });
    
    console.log(`✅ Found ${mdaChunks.length} MD&A chunks\n`);
    
    if (mdaChunks.length === 0) {
      console.log('❌ No MD&A chunks found - cannot extract insights');
      return;
    }
    
    // Group by filing date (convert to fiscal period format)
    const periodMap = new Map();
    for (const chunk of mdaChunks) {
      const filingDate = new Date(chunk.filingDate);
      const year = filingDate.getFullYear();
      const month = filingDate.getMonth() + 1;
      const quarter = Math.ceil(month / 3);
      const fiscalPeriod = `FY${year}Q${quarter}`;
      
      const existing = periodMap.get(fiscalPeriod) || '';
      periodMap.set(fiscalPeriod, existing + '\\n\\n' + chunk.content);
    }
    
    console.log(`📊 Found ${periodMap.size} fiscal periods with MD&A content:\n`);
    for (const [period, text] of periodMap.entries()) {
      console.log(`   - ${period}: ${text.length} characters`);
    }
    
    console.log(`\\n✅ Step F data ready - insights can be extracted`);
    console.log(`\\n💡 To extract insights, the MDAIntelligenceService needs to be called`);
    console.log(`   This requires the backend service to be running.`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runStepF();
