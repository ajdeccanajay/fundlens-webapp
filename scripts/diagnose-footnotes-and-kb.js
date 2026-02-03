#!/usr/bin/env node

/**
 * Diagnostic Script: Footnote Extraction & KB Sync Verification
 * 
 * This script checks:
 * 1. Narrative chunks - Do they contain footnote markers?
 * 2. Metric labels - Do they have footnote references?
 * 3. Footnote extraction - Is the logic working?
 * 4. KB sync status - Are chunks synced to Bedrock?
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkNarrativeChunks(ticker) {
  console.log('\n📄 Checking Narrative Chunks...\n');
  
  const chunks = await prisma.narrativeChunk.findMany({
    where: { ticker },
    orderBy: { filingDate: 'desc' },
    take: 10,
  });

  console.log(`Found ${chunks.length} narrative chunks (showing first 10)\n`);

  for (const chunk of chunks) {
    const content = chunk.content || '';
    const hasFootnoteMarkers = /Note\s+\d+|^\s*\d+\.|<sup>\d+<\/sup>|\(\d+\)|\[\d+\]/im.test(content);
    const hasHTMLTags = /<[^>]+>/.test(content);
    
    console.log(`Chunk ID: ${chunk.id}`);
    console.log(`  Section Type: ${chunk.sectionType || 'undefined'}`);
    console.log(`  Filing Date: ${chunk.filingDate}`);
    console.log(`  Content Length: ${content.length} chars`);
    console.log(`  Has HTML Tags: ${hasHTMLTags ? '✅' : '❌'}`);
    console.log(`  Has Footnote Markers: ${hasFootnoteMarkers ? '✅' : '❌'}`);
    
    if (hasFootnoteMarkers) {
      // Show sample footnote markers
      const markers = content.match(/Note\s+\d+|^\s*\d+\.|<sup>\d+<\/sup>|\(\d+\)|\[\d+\]/gim);
      console.log(`  Sample Markers: ${markers?.slice(0, 3).join(', ')}`);
    }
    
    // Show first 200 chars
    console.log(`  Preview: ${content.substring(0, 200).replace(/\n/g, ' ')}...`);
    console.log('');
  }

  return chunks.length;
}

async function checkMetricLabels(ticker) {
  console.log('\n📊 Checking Metric Labels for Footnote References...\n');
  
  const metrics = await prisma.financialMetric.findMany({
    where: { ticker },
    orderBy: { fiscalPeriod: 'desc' },
    take: 100,
  });

  console.log(`Checking ${metrics.length} metrics (most recent 100)\n`);

  const metricsWithFootnotes = [];
  
  for (const metric of metrics) {
    const label = metric.label || metric.rawLabel || '';
    const hasFootnoteRef = /\(\d+(?:,\s*\d+)*\)|\[\d+(?:,\s*\d+)*\]|<sup>\d+<\/sup>/.test(label);
    
    if (hasFootnoteRef) {
      const refs = label.match(/\(\d+(?:,\s*\d+)*\)|\[\d+(?:,\s*\d+)*\]|<sup>\d+<\/sup>/g);
      metricsWithFootnotes.push({
        id: metric.id,
        label,
        refs,
        fiscalPeriod: metric.fiscalPeriod,
      });
    }
  }

  console.log(`Metrics with footnote references: ${metricsWithFootnotes.length}\n`);

  if (metricsWithFootnotes.length > 0) {
    console.log('Sample metrics with footnotes:');
    metricsWithFootnotes.slice(0, 10).forEach(m => {
      console.log(`  - ${m.label}`);
      console.log(`    Refs: ${m.refs.join(', ')}`);
      console.log(`    Period: ${m.fiscalPeriod}`);
      console.log('');
    });
  } else {
    console.log('⚠️  No metrics found with footnote references in labels');
    console.log('   This is EXPECTED for XBRL-based metrics');
    console.log('   Footnotes are typically in narrative sections, not metric labels\n');
  }

  return metricsWithFootnotes.length;
}

async function testFootnoteExtraction(ticker) {
  console.log('\n🔍 Testing Footnote Extraction Logic...\n');
  
  // Get a sample narrative chunk with "Note" in sectionType
  const chunk = await prisma.narrativeChunk.findFirst({
    where: { 
      ticker,
      sectionType: { contains: 'Note' },
    },
    orderBy: { filingDate: 'desc' },
  });

  if (!chunk) {
    console.log('⚠️  No narrative chunks with "Note" in sectionType found');
    console.log('   Trying any chunk...\n');
    
    const anyChunk = await prisma.narrativeChunk.findFirst({
      where: { ticker },
      orderBy: { filingDate: 'desc' },
    });

    if (!anyChunk) {
      console.log('❌ No narrative chunks found at all\n');
      return false;
    }

    return testExtractionOnChunk(anyChunk);
  }

  return testExtractionOnChunk(chunk);
}

function testExtractionOnChunk(chunk) {
  console.log(`Testing on chunk: ${chunk.sectionType || 'unknown'}`);
  console.log(`Content length: ${chunk.content?.length || 0} chars\n`);

  const content = chunk.content || '';
  
  // Test pattern matching
  const patterns = [
    { name: 'Note X - Title', regex: /Note\s+(\d+)[\s\-:]+([^\n]+)/gi },
    { name: '(X) Title', regex: /\((\d+)\)\s+([^\n]+)/gi },
    { name: 'X. Title', regex: /^\s*(\d+)\.\s+([^\n]+)/gim },
  ];

  let foundAny = false;

  for (const pattern of patterns) {
    const matches = [...content.matchAll(pattern.regex)];
    if (matches.length > 0) {
      console.log(`✅ Pattern "${pattern.name}" found ${matches.length} matches:`);
      matches.slice(0, 3).forEach(m => {
        console.log(`   - Footnote ${m[1]}: ${m[2]?.substring(0, 60)}...`);
      });
      console.log('');
      foundAny = true;
    }
  }

  if (!foundAny) {
    console.log('❌ No footnote patterns matched');
    console.log('   Content preview:');
    console.log(`   ${content.substring(0, 500).replace(/\n/g, ' ')}...\n`);
  }

  return foundAny;
}

async function checkKBSyncStatus(ticker) {
  console.log('\n☁️  Checking KB Sync Status...\n');
  
  // Check if narrative chunks have bedrock_kb_id populated
  const syncedChunks = await prisma.narrativeChunk.count({
    where: {
      ticker,
      bedrockKbId: { not: null },
    },
  });

  const totalChunks = await prisma.narrativeChunk.count({
    where: { ticker },
  });

  console.log(`Total chunks: ${totalChunks}`);
  console.log(`Synced to Bedrock KB: ${syncedChunks}`);
  console.log(`Pending sync: ${totalChunks - syncedChunks}\n`);

  if (syncedChunks === 0) {
    console.log('⚠️  No chunks synced to Bedrock KB');
    console.log('   Chunks need bedrock_kb_id to be synced');
    console.log('   Run Step D of pipeline to sync chunks\n');
    return false;
  }

  if (syncedChunks < totalChunks) {
    console.log(`⚠️  ${totalChunks - syncedChunks} chunks not yet synced`);
  }
  
  if (syncedChunks > 0) {
    console.log(`✅ ${syncedChunks} chunks synced to Bedrock KB`);
  }

  return syncedChunks > 0;
}

async function checkFootnoteReferences(dealId, ticker) {
  console.log('\n📎 Checking Footnote References Table...\n');
  
  const footnotes = await prisma.$queryRawUnsafe(`
    SELECT 
      footnote_number,
      footnote_section,
      context_type,
      LENGTH(footnote_text) as text_length
    FROM footnote_references
    WHERE deal_id = $1::uuid
    ORDER BY footnote_number
    LIMIT 10
  `, dealId);

  console.log(`Found ${footnotes.length} footnote references (showing first 10)\n`);

  if (footnotes.length > 0) {
    footnotes.forEach(fn => {
      console.log(`Footnote ${fn.footnote_number}:`);
      console.log(`  Section: ${fn.footnote_section}`);
      console.log(`  Type: ${fn.context_type}`);
      console.log(`  Text Length: ${fn.text_length} chars`);
      console.log('');
    });
  } else {
    console.log('❌ No footnote references found');
    console.log('   Possible reasons:');
    console.log('   1. Metrics don\'t have footnote markers in labels (common for XBRL)');
    console.log('   2. Narrative chunks don\'t contain footnote sections');
    console.log('   3. Footnote extraction patterns didn\'t match\n');
  }

  return footnotes.length;
}

async function main() {
  const ticker = process.argv[2];
  
  if (!ticker) {
    console.log('Usage: node scripts/diagnose-footnotes-and-kb.js <TICKER>');
    console.log('Example: node scripts/diagnose-footnotes-and-kb.js AMZN');
    process.exit(1);
  }

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Footnote & KB Sync Diagnostic                             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nTicker: ${ticker}\n`);

  try {
    // Get deal info
    const deal = await prisma.deal.findFirst({
      where: { ticker, status: 'ready' },
      orderBy: { createdAt: 'desc' },
    });

    if (!deal) {
      console.log(`❌ No ready deal found for ticker: ${ticker}\n`);
      process.exit(1);
    }

    console.log(`Deal ID: ${deal.id}`);
    console.log(`Deal Name: ${deal.name}`);
    console.log(`Status: ${deal.status}\n`);

    // Run diagnostics
    const chunksCount = await checkNarrativeChunks(ticker);
    const metricsWithFootnotes = await checkMetricLabels(ticker);
    const extractionWorks = await testFootnoteExtraction(ticker);
    const kbSynced = await checkKBSyncStatus(ticker);
    const footnoteRefsCount = await checkFootnoteReferences(deal.id, ticker);

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  Diagnostic Summary                                        ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`Narrative Chunks: ${chunksCount > 0 ? '✅' : '❌'} (${chunksCount} found)`);
    console.log(`Metrics with Footnote Refs: ${metricsWithFootnotes > 0 ? '✅' : '⚠️ '} (${metricsWithFootnotes} found)`);
    console.log(`Footnote Extraction: ${extractionWorks ? '✅' : '❌'}`);
    console.log(`KB Sync: ${kbSynced ? '✅' : '⚠️ '}`);
    console.log(`Footnote References Saved: ${footnoteRefsCount > 0 ? '✅' : '❌'} (${footnoteRefsCount} found)\n`);

    // Recommendations
    console.log('Recommendations:');
    console.log('===============\n');

    if (metricsWithFootnotes === 0) {
      console.log('📌 Metrics don\'t have footnote markers in labels');
      console.log('   This is EXPECTED for XBRL-based data');
      console.log('   Footnotes are in narrative sections, not metric labels\n');
    }

    if (!extractionWorks) {
      console.log('📌 Footnote extraction patterns need adjustment');
      console.log('   Check narrative chunk content format');
      console.log('   May need to update regex patterns in FootnoteLinkingService\n');
    }

    if (!kbSynced) {
      console.log('📌 Chunks not synced to Bedrock KB');
      console.log('   Run: Step D of pipeline to sync chunks');
      console.log('   Or manually trigger KB sync\n');
    }

    if (footnoteRefsCount === 0 && metricsWithFootnotes === 0) {
      console.log('📌 Zero footnote references is EXPECTED');
      console.log('   XBRL metrics typically don\'t reference footnotes');
      console.log('   Footnotes are more common in human-readable PDFs\n');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
