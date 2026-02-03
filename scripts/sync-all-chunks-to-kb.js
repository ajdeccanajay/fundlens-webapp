#!/usr/bin/env node
/**
 * Sync ALL narrative chunks from RDS to S3 and trigger KB ingestion
 * This ensures 100% of chunks are available in Bedrock KB for semantic retrieval
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
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
  console.log('🔄 Starting full KB sync...\n');

  // Step 1: Get current status
  console.log('📊 Step 1: Checking current sync status...');
  const statusRes = await request('GET', '/api/rag/kb/status');
  const { rdsChunks, s3Chunks, kbDocuments, delta } = statusRes.data.data || statusRes.data;
  
  console.log(`   RDS Chunks: ${rdsChunks}`);
  console.log(`   S3 Chunks: ${s3Chunks}`);
  console.log(`   KB Documents: ${kbDocuments}`);
  console.log(`   Delta: ${delta}\n`);

  if (delta === 0) {
    console.log('✅ All chunks are already synced!');
    return;
  }

  // Step 2: Get all tickers with chunks
  console.log('📋 Step 2: Getting tickers with chunks...');
  const statsRes = await request('GET', '/api/rag/chunks/stats');
  const byTicker = statsRes.data.byTicker || {};
  const tickers = Object.keys(byTicker);
  console.log(`   Found ${tickers.length} tickers: ${tickers.join(', ')}\n`);

  // Step 3: Upload chunks for each ticker
  console.log('☁️  Step 3: Uploading chunks to S3...');
  let totalUploaded = 0;
  
  for (const ticker of tickers) {
    const tickerChunks = byTicker[ticker];
    console.log(`\n   Processing ${ticker} (${tickerChunks} chunks)...`);
    
    // Upload in batches
    let offset = 0;
    while (offset < tickerChunks) {
      const batchNum = Math.floor(offset / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(tickerChunks / BATCH_SIZE);
      
      console.log(`     Batch ${batchNum}/${totalBatches} (offset: ${offset})...`);
      
      try {
        const uploadRes = await request('POST', '/api/rag/chunks/upload-s3', {
          bucket: 'fundlens-bedrock-chunks',
          ticker,
          keyPrefix: 'chunks',
          dryRun: false,
          batchSize: BATCH_SIZE,
          offset,
        }, 600000);
        
        if (uploadRes.data.success !== false) {
          const uploaded = uploadRes.data.result?.uploadedCount || uploadRes.data.uploadedCount || 0;
          totalUploaded += uploaded;
          console.log(`     ✓ Uploaded ${uploaded} chunks`);
        } else {
          console.log(`     ✗ Failed: ${uploadRes.data.message}`);
        }
      } catch (error) {
        console.log(`     ✗ Error: ${error.message}`);
      }
      
      offset += BATCH_SIZE;
    }
  }

  console.log(`\n   Total uploaded: ${totalUploaded} chunks\n`);

  // Step 4: Trigger KB ingestion
  console.log('🧠 Step 4: Triggering Bedrock KB ingestion...');
  try {
    const syncRes = await request('POST', '/api/rag/kb/sync', {}, 60000);
    
    if (syncRes.data.success || syncRes.data.data?.success) {
      const jobId = syncRes.data.jobId || syncRes.data.data?.jobId;
      console.log(`   ✓ Ingestion job started: ${jobId || 'triggered'}`);
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

  // Step 5: Final status check
  console.log('\n📊 Step 5: Final sync status...');
  const finalStatus = await request('GET', '/api/rag/kb/status');
  const final = finalStatus.data.data || finalStatus.data;
  
  console.log(`   RDS Chunks: ${final.rdsChunks}`);
  console.log(`   S3 Chunks: ${final.s3Chunks}`);
  console.log(`   KB Documents: ${final.kbDocuments}`);
  console.log(`   Delta: ${final.delta}`);
  
  if (final.delta === 0) {
    console.log('\n✅ Full sync complete! All chunks are now in Bedrock KB.');
  } else {
    console.log(`\n⚠ ${final.delta} chunks still need to be synced.`);
    console.log('   The Lambda will automatically trigger KB ingestion when S3 uploads complete.');
  }
}

main().catch(console.error);
