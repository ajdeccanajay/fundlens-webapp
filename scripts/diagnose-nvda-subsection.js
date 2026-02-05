#!/usr/bin/env node

/**
 * Diagnostic script to check NVDA subsection data
 * Helps diagnose why subsection-aware retrieval isn't working
 */

const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();

  console.log('=== NVDA Subsection Diagnostic ===\n');

  // 1. Check total NVDA chunks
  const totalChunks = await prisma.narrativeChunk.count({
    where: { ticker: 'NVDA' }
  });
  console.log(`1. Total NVDA chunks: ${totalChunks}`);

  // 2. Check Item 1 chunks
  const item1Chunks = await prisma.narrativeChunk.count({
    where: { ticker: 'NVDA', sectionType: 'item_1' }
  });
  console.log(`2. Item 1 (Business) chunks: ${item1Chunks}`);

  // 3. Check chunks with subsection_name populated
  const chunksWithSubsection = await prisma.narrativeChunk.count({
    where: { 
      ticker: 'NVDA',
      subsectionName: { not: null }
    }
  });
  console.log(`3. Chunks with subsection_name: ${chunksWithSubsection}`);

  // 4. Check chunks with NULL subsection_name
  const chunksWithoutSubsection = await prisma.narrativeChunk.count({
    where: { 
      ticker: 'NVDA',
      subsectionName: null
    }
  });
  console.log(`4. Chunks with NULL subsection_name: ${chunksWithoutSubsection}`);

  // 5. Check competition-related chunks
  const competitionChunks = await prisma.narrativeChunk.findMany({
    where: {
      ticker: 'NVDA',
      sectionType: 'item_1',
      content: {
        contains: 'compet',
        mode: 'insensitive'
      }
    },
    select: {
      id: true,
      subsectionName: true,
      content: true
    },
    take: 3
  });

  console.log(`\n5. Competition-related chunks (sample of ${competitionChunks.length}):`);
  competitionChunks.forEach((chunk, i) => {
    console.log(`   Chunk ${i + 1}:`);
    console.log(`   - Subsection: ${chunk.subsectionName || 'NULL'}`);
    console.log(`   - Content preview: ${chunk.content.substring(0, 150)}...`);
    console.log('');
  });

  // 6. Check if any other tickers have subsection_name populated
  const tickersWithSubsections = await prisma.narrativeChunk.groupBy({
    by: ['ticker'],
    where: {
      subsectionName: { not: null }
    },
    _count: true
  });

  console.log(`6. Tickers with subsection_name populated:`);
  if (tickersWithSubsections.length === 0) {
    console.log('   NONE - No tickers have subsection_name populated!');
  } else {
    tickersWithSubsections.forEach(t => {
      console.log(`   - ${t.ticker}: ${t._count} chunks`);
    });
  }

  // 7. Check filing dates for NVDA
  const nvdaFilings = await prisma.narrativeChunk.groupBy({
    by: ['filingDate'],
    where: { ticker: 'NVDA' },
    _count: true,
    orderBy: { filingDate: 'desc' }
  });

  console.log(`\n7. NVDA filing dates in database:`);
  nvdaFilings.slice(0, 5).forEach(f => {
    console.log(`   - ${f.filingDate}: ${f._count} chunks`);
  });

  console.log('\n=== DIAGNOSIS ===');
  if (chunksWithSubsection === 0) {
    console.log('❌ PROBLEM: No NVDA chunks have subsection_name populated');
    console.log('   This means Phase 1 (subsection extraction) was never run for NVDA');
    console.log('   or the chunks were created before the subsection_name column was added.');
    console.log('\n   SOLUTION: Re-run the parsing pipeline for NVDA to populate subsection_name');
    console.log('   Command: npm run parse:nvda (or equivalent)');
  } else {
    console.log('✅ Some NVDA chunks have subsection_name populated');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
