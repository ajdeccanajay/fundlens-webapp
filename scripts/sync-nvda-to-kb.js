#!/usr/bin/env node
/**
 * Sync NVDA narrative chunks to S3 and trigger KB ingestion
 * Used after backfilling subsection_name to ensure Bedrock KB has updated metadata
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const TICKER = 'NVDA';
const BATCH_SIZE = 5000;

async function request(method, path, body = null, timeout = 600000) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log(`🔄 Starting ${TICKER} KB sync...\n`);

  // Step 1: Get NVDA chunk count
  console.log('📊 Step 1: Checking NVDA chunks...');
  const statsRes = await request('GET', '/api/rag/chunks/stats');
  const byTicker = statsRes.data.byTicker || {};
  const nvdaChunks = byTicker[TICKER] || 0;
  
  console.log(`   ${TICKER} Chunks in RDS: ${nvdaChunks}\n`);

  if (nvdaChunks === 0) {
    console.log('❌ No NVDA chunks found in database!');
    return;
  }

  // Step 2: Upload chunks to S3
  console.log('☁️  Step 2: Uploading NVDA chunks to S3...');
  let totalUploaded = 0;
  let offset = 0;
  
  while (offset < nvdaChunks) {
    const batchNum = Math.floor(offset / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(nvdaChunks / BATCH_SIZE);
    
    console.log(`   Batch ${batchNum}/${totalBatches} (offset: ${offset})...`);
    
    try {
      const uploadRes = await request('POST', '/api/rag/chunks/upload-s3', {
        bucket: 'fundlens-bedrock-chunks',
        ticker: TICKER,
        keyPrefix: 'chunks',
        dryRun: false,
        batchSize: BATCH_SIZE,
        offset,
      }, 600000);
      
      if (uploadRes.data.success !== false) {
        const uploaded = uploadRes.data.result?.uploadedCount || uploadRes.data.uploadedCount || 0;
        totalUploaded += uploaded;
        console.log(`   ✓ Uploaded ${uploaded} chunks`);
      } else {
        console.log(`   ✗ Failed: ${uploadRes.data.message}`);
      }
    } catch (error) {
      console.log(`   ✗ Error: ${error.message}`);
    }
    
    offset += BATCH_SIZE;
  }

  console.log(`\n   Total uploaded: ${totalUploaded} chunks\n`);

  // Step 3: Trigger KB ingestion
  console.log('🧠 Step 3: Triggering Bedrock KB ingestion...');
  try {
    const syncRes = await request('POST', '/api/rag/kb/sync', {}, 60000);
    
    if (syncRes.data.success || syncRes.data.data?.success) {
      const jobId = syncRes.data.jobId || syncRes.data.data?.jobId;
      console.log(`   ✓ Ingestion job started: ${jobId || 'triggered'}`);
      console.log('   ⏳ KB ingestion typically takes 5-10 minutes...');
    } else {
      const error = syncRes.data.error || syncRes.data.data?.error || 'Unknown error';
      if (error.includes('Rate limit') || error.includes('throttled')) {
        console.log('   ⚠ Rate limited - ingestion will be triggered by Lambda on S3 upload');
      } else {
        console.log(`   ✗ Failed: ${error}`);
      }
    }
  } catch (error) {
    console.log(`   ✗ Error: ${error.message}`);
  }

  console.log('\n✅ NVDA sync complete!');
  console.log('\n=== NEXT STEPS ===');
  console.log('1. Wait 5-10 minutes for KB ingestion to complete');
  console.log('2. Test subsection-aware retrieval:');
  console.log('   Query: "Who are NVDA\'s competitors?"');
  console.log('   Expected: Returns chunks from Item 1 - Competition subsection');
  console.log('\n3. Monitor KB sync status:');
  console.log('   node scripts/monitor-kb-sync-status.js');
}

main().catch(console.error);
