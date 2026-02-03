#!/usr/bin/env node

/**
 * Sync All Chunks to Knowledge Base (Batched Approach)
 * 
 * This script syncs all narrative chunks in small batches
 * to avoid timeouts and ensure complete coverage.
 */

const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const prisma = new PrismaClient();
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const BUCKET = 'fundlens-data-lake';
const KEY_PREFIX = 'bedrock-kb/sec-filings';
const BATCH_SIZE = 500; // Smaller batches for reliability

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanContent(content) {
  if (!content) return '';
  
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/\b[a-z-]+:[A-Za-z0-9_]+/g, '')
    .replace(/https?:\/\/[^\s]+/g, '')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\b\d{10,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatChunkForBedrock(chunk) {
  return {
    content: cleanContent(chunk.content),
    metadata: {
      ticker: chunk.ticker,
      document_type: 'sec_filing',
      filing_type: chunk.filingType || '10-K',
      section_type: chunk.sectionType,
      fiscal_period: chunk.fiscalPeriod,
      filing_date: chunk.filingDate ? new Date(chunk.filingDate).toISOString().split('T')[0] : undefined,
      chunk_index: chunk.chunkIndex,
      page_number: chunk.sourcePage,
    },
  };
}

async function uploadChunkToS3(chunk) {
  const bedrockChunk = formatChunkForBedrock(chunk);
  // Use database ID to ensure unique keys
  const key = `${KEY_PREFIX}/${chunk.ticker}/chunk-${chunk.id}.json`;
  
  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(bedrockChunk),
      ContentType: 'application/json',
      Metadata: {
        ticker: chunk.ticker,
        section_type: chunk.sectionType,
        filing_type: chunk.filingType || '10-K',
        chunk_id: chunk.id.toString(),
      },
    }));
    return { success: true, key };
  } catch (error) {
    return { success: false, key, error: error.message };
  }
}

async function syncCompanyChunks(ticker) {
  console.log(`\n🔄 Syncing ${ticker} chunks...`);
  
  // Get total count for this company
  const totalCount = await prisma.narrativeChunk.count({
    where: { ticker }
  });
  
  console.log(`📊 ${ticker}: ${totalCount} total chunks to sync`);
  
  let offset = 0;
  let totalUploaded = 0;
  let totalFailed = 0;
  
  while (offset < totalCount) {
    const chunks = await prisma.narrativeChunk.findMany({
      where: { ticker },
      take: BATCH_SIZE,
      skip: offset,
      orderBy: { chunkIndex: 'asc' },
    });
    
    if (chunks.length === 0) break;
    
    console.log(`  📦 Processing batch ${Math.floor(offset / BATCH_SIZE) + 1}: chunks ${offset}-${offset + chunks.length}`);
    
    // Upload chunks in this batch
    const uploadPromises = chunks.map(chunk => uploadChunkToS3(chunk));
    const results = await Promise.all(uploadPromises);
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    totalUploaded += successful;
    totalFailed += failed;
    
    console.log(`  ✅ Uploaded: ${successful}, ❌ Failed: ${failed}`);
    
    offset += BATCH_SIZE;
    
    // Small delay between batches
    await sleep(1000);
  }
  
  console.log(`✅ ${ticker} complete: ${totalUploaded} uploaded, ${totalFailed} failed`);
  
  return {
    ticker,
    totalCount,
    uploaded: totalUploaded,
    failed: totalFailed,
  };
}

async function main() {
  console.log('🚀 Starting batched Knowledge Base sync...');
  console.log(`📦 Batch size: ${BATCH_SIZE} chunks`);
  console.log(`🪣 Target bucket: ${BUCKET}`);
  
  const companies = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'JPM', 'BAC', 'WMT'];
  const results = [];
  
  for (const ticker of companies) {
    try {
      const result = await syncCompanyChunks(ticker);
      results.push(result);
    } catch (error) {
      console.error(`❌ ${ticker} failed: ${error.message}`);
      results.push({
        ticker,
        totalCount: 0,
        uploaded: 0,
        failed: 0,
        error: error.message,
      });
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('🎉 SYNC COMPLETE!');
  console.log('='.repeat(60));
  
  console.log('\n📋 Results by Company:');
  results.forEach(r => {
    const status = r.uploaded > 0 ? '✅' : '❌';
    console.log(`${status} ${r.ticker}: ${r.uploaded}/${r.totalCount} chunks uploaded`);
  });
  
  const totalChunks = results.reduce((sum, r) => sum + r.totalCount, 0);
  const totalUploaded = results.reduce((sum, r) => sum + r.uploaded, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  
  console.log('\n📊 Overall Statistics:');
  console.log(`   Total chunks: ${totalChunks}`);
  console.log(`   Uploaded: ${totalUploaded}`);
  console.log(`   Failed: ${totalFailed}`);
  console.log(`   Success rate: ${((totalUploaded / totalChunks) * 100).toFixed(1)}%`);
  
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    prisma.$disconnect();
    process.exit(1);
  });
}

module.exports = { syncCompanyChunks, uploadChunkToS3 };
