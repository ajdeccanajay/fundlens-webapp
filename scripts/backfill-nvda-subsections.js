#!/usr/bin/env node

/**
 * Backfill script for NVDA subsection extraction
 * 
 * This script:
 * 1. Reads existing NVDA chunks from database
 * 2. Re-runs subsection identification logic on chunk content
 * 3. Updates subsection_name field in database
 * 
 * Requirements: Phase 1 - Subsection Extraction (1.2, 1.3, 1.4, 1.5, 1.10)
 */

const { PrismaClient } = require('@prisma/client');

// Subsection patterns (matching Python parser logic)
const ITEM_1_SUBSECTIONS = {
  'Competition': /\b(competition|competitive\s+landscape|competitive\s+position|competitors)\b/i,
  'Products': /\b(products|product\s+lines|product\s+offerings|services)\b/i,
  'Customers': /\b(customers|customer\s+base|client\s+relationships)\b/i,
  'Markets': /\b(markets|market\s+segments|geographic\s+markets|target\s+markets)\b/i,
  'Operations': /\b(operations|business\s+operations|operational\s+structure)\b/i,
  'Strategy': /\b(strategy|business\s+strategy|strategic\s+initiatives|growth\s+strategy)\b/i,
  'Intellectual Property': /\b(intellectual\s+property|patents|trademarks|copyrights|ip\s+rights)\b/i,
  'Human Capital': /\b(human\s+capital|employees|workforce|talent|human\s+resources)\b/i,
};

const ITEM_7_SUBSECTIONS = {
  'Results of Operations': /\b(results\s+of\s+operations|operating\s+results|financial\s+results)\b/i,
  'Liquidity and Capital Resources': /\b(liquidity|capital\s+resources|cash\s+flows|financing\s+activities)\b/i,
  'Critical Accounting Policies': /\b(critical\s+accounting|accounting\s+policies|accounting\s+estimates)\b/i,
  'Market Risk': /\b(market\s+risk|interest\s+rate\s+risk|foreign\s+exchange\s+risk|commodity\s+risk)\b/i,
  'Contractual Obligations': /\b(contractual\s+obligations|commitments|off-balance\s+sheet)\b/i,
};

const ITEM_8_SUBSECTIONS = {
  'Revenue Recognition': /\b(revenue\s+recognition|revenue\s+policy)\b/i,
  'Leases': /\b(leases|lease\s+accounting|operating\s+leases|finance\s+leases)\b/i,
  'Stock-Based Compensation': /\b(stock-based\s+compensation|share-based\s+compensation|equity\s+compensation)\b/i,
  'Income Taxes': /\b(income\s+taxes|tax\s+provision|deferred\s+taxes)\b/i,
  'Debt': /\b(debt|borrowings|credit\s+facilities|notes\s+payable)\b/i,
  'Fair Value': /\b(fair\s+value|fair\s+value\s+measurements)\b/i,
};

const ITEM_1A_SUBSECTIONS = {
  'Operational Risks': /\b(operational\s+risk|business\s+risk|execution\s+risk)\b/i,
  'Financial Risks': /\b(financial\s+risk|credit\s+risk|liquidity\s+risk)\b/i,
  'Market Risks': /\b(market\s+risk|economic\s+risk|demand\s+risk)\b/i,
  'Regulatory Risks': /\b(regulatory\s+risk|compliance\s+risk|legal\s+risk)\b/i,
  'Technology Risks': /\b(technology\s+risk|cybersecurity\s+risk|data\s+security)\b/i,
};

/**
 * Identify subsection from chunk content based on section type
 */
function identifySubsection(content, sectionType) {
  let patterns;
  
  switch (sectionType) {
    case 'item_1':
      patterns = ITEM_1_SUBSECTIONS;
      break;
    case 'item_7':
      patterns = ITEM_7_SUBSECTIONS;
      break;
    case 'item_8':
      patterns = ITEM_8_SUBSECTIONS;
      break;
    case 'item_1a':
      patterns = ITEM_1A_SUBSECTIONS;
      break;
    default:
      return null;
  }
  
  // Find all matching subsections
  const matches = [];
  for (const [subsectionName, pattern] of Object.entries(patterns)) {
    const match = content.match(pattern);
    if (match) {
      matches.push({
        name: subsectionName,
        position: match.index,
      });
    }
  }
  
  // If no matches, return null
  if (matches.length === 0) {
    return null;
  }
  
  // Return the first (earliest) match
  matches.sort((a, b) => a.position - b.position);
  return matches[0].name;
}

async function main() {
  const prisma = new PrismaClient();
  
  console.log('=== NVDA Subsection Backfill ===\n');
  
  // 1. Get all NVDA chunks that need subsection identification
  const targetSectionTypes = ['item_1', 'item_7', 'item_8', 'item_1a'];
  
  console.log('1. Fetching NVDA chunks...');
  const chunks = await prisma.narrativeChunk.findMany({
    where: {
      ticker: 'NVDA',
      sectionType: { in: targetSectionTypes },
      subsectionName: null, // Only process chunks without subsection
    },
    select: {
      id: true,
      sectionType: true,
      content: true,
      chunkIndex: true,
    },
  });
  
  console.log(`   Found ${chunks.length} chunks to process\n`);
  
  if (chunks.length === 0) {
    console.log('✅ No chunks need backfilling. All done!');
    await prisma.$disconnect();
    return;
  }
  
  // 2. Process chunks and identify subsections
  console.log('2. Identifying subsections...');
  const updates = [];
  const stats = {
    item_1: { total: 0, identified: 0, subsections: {} },
    item_7: { total: 0, identified: 0, subsections: {} },
    item_8: { total: 0, identified: 0, subsections: {} },
    item_1a: { total: 0, identified: 0, subsections: {} },
  };
  
  for (const chunk of chunks) {
    stats[chunk.sectionType].total++;
    
    const subsectionName = identifySubsection(chunk.content, chunk.sectionType);
    
    if (subsectionName) {
      updates.push({
        id: chunk.id,
        subsectionName,
      });
      
      stats[chunk.sectionType].identified++;
      stats[chunk.sectionType].subsections[subsectionName] = 
        (stats[chunk.sectionType].subsections[subsectionName] || 0) + 1;
    }
  }
  
  console.log(`   Identified subsections for ${updates.length} chunks\n`);
  
  // 3. Display statistics
  console.log('3. Statistics by section type:');
  for (const [sectionType, stat] of Object.entries(stats)) {
    if (stat.total > 0) {
      console.log(`\n   ${sectionType.toUpperCase()}:`);
      console.log(`   - Total chunks: ${stat.total}`);
      console.log(`   - Identified: ${stat.identified} (${((stat.identified / stat.total) * 100).toFixed(1)}%)`);
      
      if (Object.keys(stat.subsections).length > 0) {
        console.log('   - Subsections:');
        for (const [subsection, count] of Object.entries(stat.subsections)) {
          console.log(`     • ${subsection}: ${count} chunks`);
        }
      }
    }
  }
  
  // 4. Update database
  if (updates.length === 0) {
    console.log('\n❌ No subsections identified. Check pattern matching logic.');
    await prisma.$disconnect();
    return;
  }
  
  console.log(`\n4. Updating database (${updates.length} chunks)...`);
  
  let updated = 0;
  let failed = 0;
  
  for (const update of updates) {
    try {
      await prisma.narrativeChunk.update({
        where: { id: update.id },
        data: { subsectionName: update.subsectionName },
      });
      updated++;
      
      if (updated % 100 === 0) {
        console.log(`   Progress: ${updated}/${updates.length} chunks updated`);
      }
    } catch (error) {
      console.error(`   Error updating chunk ${update.id}:`, error.message);
      failed++;
    }
  }
  
  console.log(`\n✅ Backfill complete!`);
  console.log(`   - Updated: ${updated} chunks`);
  console.log(`   - Failed: ${failed} chunks`);
  
  // 5. Verify results
  console.log('\n5. Verification:');
  const verifyCount = await prisma.narrativeChunk.count({
    where: {
      ticker: 'NVDA',
      sectionType: { in: targetSectionTypes },
      subsectionName: { not: null },
    },
  });
  
  console.log(`   - NVDA chunks with subsection_name: ${verifyCount}`);
  
  // Show sample of Competition subsection
  const competitionSample = await prisma.narrativeChunk.findFirst({
    where: {
      ticker: 'NVDA',
      subsectionName: 'Competition',
    },
    select: {
      id: true,
      sectionType: true,
      subsectionName: true,
      content: true,
    },
  });
  
  if (competitionSample) {
    console.log('\n   Sample Competition chunk:');
    console.log(`   - ID: ${competitionSample.id}`);
    console.log(`   - Section: ${competitionSample.sectionType}`);
    console.log(`   - Subsection: ${competitionSample.subsectionName}`);
    console.log(`   - Content preview: ${competitionSample.content.substring(0, 150)}...`);
  }
  
  console.log('\n=== NEXT STEPS ===');
  console.log('1. Re-export NVDA chunks to Bedrock KB:');
  console.log('   node scripts/sync-all-chunks-to-kb.js --ticker NVDA');
  console.log('\n2. Test subsection-aware retrieval:');
  console.log('   Query: "Who are NVDA\'s competitors?"');
  console.log('   Expected: Returns chunks from Item 1 - Competition subsection');
  
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
