/**
 * Diagnostic Script: Check NVDA Workspace Status
 * Diagnoses why scratchpad endpoint returns 500 error for NVDA
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function diagnoseNVDAWorkspace() {
  console.log('🔍 Diagnosing NVDA Workspace...\n');

  try {
    // 1. Check if NVDA deal exists
    console.log('1️⃣  Checking if NVDA deal exists...');
    const nvdaDeal = await prisma.deal.findFirst({
      where: { ticker: 'NVDA' },
    });

    if (!nvdaDeal) {
      console.log('❌ NVDA deal NOT FOUND in database');
      console.log('   This is likely the cause of the 500 error');
      console.log('\n💡 Solution: Create NVDA deal first');
      console.log('   Visit: http://localhost:3000/app/deals/index.html');
      console.log('   Click "New Deal" and enter ticker: NVDA\n');
      return;
    }

    console.log('✅ NVDA deal found:');
    console.log(`   ID: ${nvdaDeal.id}`);
    console.log(`   Name: ${nvdaDeal.name}`);
    console.log(`   Ticker: ${nvdaDeal.ticker}`);
    console.log(`   Created: ${nvdaDeal.createdAt}\n`);

    // 2. Check scratchpad items for NVDA
    console.log('2️⃣  Checking scratchpad items...');
    const scratchpadItems = await prisma.scratchpadItem.findMany({
      where: { workspaceId: nvdaDeal.id },
    });

    console.log(`✅ Found ${scratchpadItems.length} scratchpad items for NVDA\n`);

    if (scratchpadItems.length > 0) {
      console.log('   Recent items:');
      scratchpadItems.slice(0, 3).forEach((item, idx) => {
        console.log(`   ${idx + 1}. ${item.type} - saved ${item.savedAt.toLocaleString()}`);
      });
      console.log('');
    }

    // 3. Check if there are any SEC filings for NVDA
    console.log('3️⃣  Checking SEC filings...');
    const filings = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM sec_filings
      WHERE ticker = 'NVDA'
    `;

    const filingCount = parseInt(filings[0]?.count || '0');
    console.log(`✅ Found ${filingCount} SEC filings for NVDA\n`);

    // 4. Check narrative chunks
    console.log('4️⃣  Checking narrative chunks...');
    const chunks = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM narrative_chunks
      WHERE ticker = 'NVDA'
    `;

    const chunkCount = parseInt(chunks[0]?.count || '0');
    console.log(`✅ Found ${chunkCount} narrative chunks for NVDA\n`);

    // 5. Test the scratchpad endpoint query
    console.log('5️⃣  Testing scratchpad query...');
    try {
      const testQuery = await prisma.scratchpadItem.findMany({
        where: { workspaceId: nvdaDeal.id },
        orderBy: { savedAt: 'desc' },
      });
      console.log(`✅ Scratchpad query successful - returned ${testQuery.length} items\n`);
    } catch (error) {
      console.log('❌ Scratchpad query FAILED:');
      console.log(`   Error: ${error.message}\n`);
    }

    // Summary
    console.log('📊 SUMMARY:');
    console.log('─'.repeat(50));
    console.log(`Deal exists: ✅`);
    console.log(`Scratchpad items: ${scratchpadItems.length}`);
    console.log(`SEC filings: ${filingCount}`);
    console.log(`Narrative chunks: ${chunkCount}`);
    console.log('─'.repeat(50));

    if (filingCount === 0) {
      console.log('\n⚠️  WARNING: No SEC filings found for NVDA');
      console.log('   You may need to ingest NVDA data first');
      console.log('   Run: node scripts/end-to-end-pipeline.js NVDA\n');
    }

    console.log('\n✅ Diagnosis complete - workspace should work');

  } catch (error) {
    console.error('\n❌ Error during diagnosis:');
    console.error(error);
    console.error('\nStack trace:');
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

// Run diagnosis
diagnoseNVDAWorkspace()
  .then(() => {
    console.log('\n✅ Diagnostic complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Diagnostic failed:', error);
    process.exit(1);
  });
