#!/usr/bin/env node

/**
 * Manual KB Sync Script for AMZN
 * 
 * CRITICAL FIX: Sync 283 AMZN narrative chunks to Bedrock KB
 * 
 * This script:
 * 1. Uploads all AMZN chunks to S3 (with metadata for filtering)
 * 2. Triggers Bedrock KB ingestion job
 * 3. Waits for ingestion to complete
 * 4. Updates bedrock_kb_id field in narrative_chunk table
 * 5. Verifies sync status
 * 
 * Usage: node scripts/manual-kb-sync-amzn.js
 */

const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { 
  BedrockAgentClient, 
  StartIngestionJobCommand, 
  GetIngestionJobCommand,
  ListIngestionJobsCommand,
} = require('@aws-sdk/client-bedrock-agent');

const prisma = new PrismaClient();
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const bedrockAgent = new BedrockAgentClient({ 
  region: process.env.AWS_REGION || 'us-east-1',
  maxAttempts: 10,
  retryMode: 'adaptive',
});

const TICKER = 'AMZN';
const S3_BUCKET = process.env.BEDROCK_CHUNKS_BUCKET || 'fundlens-bedrock-chunks';
const KB_ID = process.env.BEDROCK_KB_ID || 'NB5XNMHBQT';
const DATA_SOURCE_ID = process.env.BEDROCK_DATA_SOURCE_ID || 'OQMSFOE5SL';
const BATCH_SIZE = 50; // Upload 50 chunks at a time
const CONCURRENCY = 20; // 20 parallel uploads

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clean content for Bedrock ingestion
 */
function cleanContent(content) {
  if (!content) return '';

  return content
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/\b[a-z-]+:[A-Za-z0-9_]+/g, '') // Remove XBRL namespace references
    .replace(/https?:\/\/[^\s]+/g, '') // Remove URLs
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '') // Remove date patterns
    .replace(/\s+/g, ' ') // Remove excessive whitespace
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove special characters
    .replace(/\b\d{10,}\b/g, '') // Remove standalone numbers
    .replace(/\s+/g, ' ') // Clean up multiple spaces again
    .trim();
}

/**
 * Upload single chunk to S3 with retry
 */
async function uploadChunkWithRetry(chunk, chunkIndex, maxRetries = 3) {
  const contentKey = `chunks/${TICKER}/chunk-${chunkIndex}.txt`;
  const metadataKey = `${contentKey}.metadata.json`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const cleanedContent = cleanContent(chunk.content);
      
      // Prepare metadata - only use fields that exist in the model
      const metadata = {
        ticker: chunk.ticker,
        document_type: 'sec_filing', // Default for SEC data
        filing_type: chunk.filingType || '10-K',
        section_type: chunk.sectionType || 'unknown',
        filing_date: chunk.filingDate ? new Date(chunk.filingDate).toISOString().split('T')[0] : '',
        chunk_index: String(chunk.chunkIndex),
        visibility: 'public', // SEC data is public
      };
      
      // Upload content and metadata in parallel
      await Promise.all([
        s3Client.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: contentKey,
          Body: cleanedContent,
          ContentType: 'text/plain',
        })),
        s3Client.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: metadataKey,
          Body: JSON.stringify({
            metadataAttributes: metadata,
          }),
          ContentType: 'application/json',
        })),
      ]);

      return { success: true, key: contentKey };
    } catch (error) {
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 500;
        console.log(`  Retry ${attempt}/${maxRetries} for chunk ${chunkIndex} in ${delay}ms...`);
        await sleep(delay);
      } else {
        console.error(`  ❌ Failed to upload chunk ${chunkIndex}: ${error.message}`);
        return { success: false, key: contentKey };
      }
    }
  }
  
  return { success: false, key: contentKey };
}

/**
 * Upload chunks to S3 in batches
 */
async function uploadChunksToS3(chunks) {
  console.log(`\n📤 Uploading ${chunks.length} chunks to S3...`);
  console.log(`   Bucket: ${S3_BUCKET}`);
  console.log(`   Batch size: ${BATCH_SIZE}, Concurrency: ${CONCURRENCY}\n`);

  let uploadedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    
    const uploadPromises = batch.map((chunk, batchIndex) => {
      const chunkIndex = i + batchIndex;
      return uploadChunkWithRetry(chunk, chunkIndex);
    });

    const results = await Promise.all(uploadPromises);
    
    for (const result of results) {
      if (result.success) {
        uploadedCount++;
      } else {
        failedCount++;
      }
    }

    // Log progress every 50 chunks
    if ((i + CONCURRENCY) % 50 === 0 || i + CONCURRENCY >= chunks.length) {
      console.log(`  Uploaded ${Math.min(i + CONCURRENCY, chunks.length)}/${chunks.length} chunks (${failedCount} failed)`);
    }
  }

  console.log(`\n✅ S3 upload complete: ${uploadedCount}/${chunks.length} chunks uploaded`);
  if (failedCount > 0) {
    console.log(`⚠️  ${failedCount} chunks failed to upload`);
  }

  return { uploadedCount, failedCount };
}

/**
 * Check for ongoing ingestion jobs
 */
async function checkForOngoingJob() {
  try {
    const command = new ListIngestionJobsCommand({
      knowledgeBaseId: KB_ID,
      dataSourceId: DATA_SOURCE_ID,
      maxResults: 5,
    });

    const response = await bedrockAgent.send(command);
    const jobs = response.ingestionJobSummaries || [];

    const runningJob = jobs.find(job => 
      job.status === 'STARTING' || job.status === 'IN_PROGRESS'
    );

    if (runningJob && runningJob.ingestionJobId) {
      return {
        jobId: runningJob.ingestionJobId,
        status: runningJob.status || 'UNKNOWN',
      };
    }

    return null;
  } catch (error) {
    console.warn(`Failed to check for ongoing jobs: ${error.message}`);
    return null;
  }
}

/**
 * Start KB ingestion job with retry
 */
async function startIngestionWithRetry(maxRetries = 5) {
  console.log(`\n🔄 Starting Bedrock KB ingestion...`);
  console.log(`   KB ID: ${KB_ID}`);
  console.log(`   Data Source ID: ${DATA_SOURCE_ID}\n`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Check for ongoing jobs first
      const ongoingJob = await checkForOngoingJob();
      if (ongoingJob) {
        console.log(`Found ongoing ingestion job: ${ongoingJob.jobId} (${ongoingJob.status})`);
        console.log(`Waiting for ongoing job to complete...\n`);
        return ongoingJob.jobId;
      }

      // Start new ingestion job
      const command = new StartIngestionJobCommand({
        knowledgeBaseId: KB_ID,
        dataSourceId: DATA_SOURCE_ID,
        description: `Manual sync for ${TICKER} - ${new Date().toISOString()}`,
      });

      const response = await bedrockAgent.send(command);
      const jobId = response.ingestionJob?.ingestionJobId;

      if (jobId) {
        console.log(`✅ KB ingestion started: ${jobId}\n`);
        return jobId;
      }
    } catch (error) {
      // Check if error is due to ongoing job
      const ongoingJobMatch = error.message?.match(/ongoing ingestion job.*ID\s+(\w+)/i);
      if (ongoingJobMatch) {
        const existingJobId = ongoingJobMatch[1];
        console.log(`Detected ongoing job from error: ${existingJobId}\n`);
        return existingJobId;
      }

      if (attempt < maxRetries) {
        const delay = Math.min(Math.pow(2, attempt) * 1000 + Math.random() * 1000, 60000);
        console.log(`Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        console.log(`Retrying in ${Math.round(delay/1000)}s...\n`);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }

  throw new Error('Failed to start ingestion after max retries');
}

/**
 * Wait for KB ingestion to complete
 */
async function waitForIngestion(jobId, maxWaitMs = 15 * 60 * 1000) {
  console.log(`⏳ Waiting for KB ingestion to complete (max ${maxWaitMs/60000} minutes)...\n`);

  const pollInterval = 15 * 1000; // 15 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const command = new GetIngestionJobCommand({
        knowledgeBaseId: KB_ID,
        dataSourceId: DATA_SOURCE_ID,
        ingestionJobId: jobId,
      });

      const response = await bedrockAgent.send(command);
      const status = response.ingestionJob?.status;
      const stats = response.ingestionJob?.statistics;

      const scanned = stats?.numberOfDocumentsScanned || 0;
      const indexed = stats?.numberOfNewDocumentsIndexed || 0;
      const failed = stats?.numberOfDocumentsFailed || 0;
      const elapsedMin = Math.round((Date.now() - startTime) / 60000);

      console.log(`  Status: ${status} - ${scanned} scanned, ${indexed} indexed, ${failed} failed (${elapsedMin}min elapsed)`);

      if (status === 'COMPLETE') {
        console.log(`\n✅ KB ingestion complete!`);
        console.log(`   Documents scanned: ${scanned}`);
        console.log(`   Documents indexed: ${indexed}`);
        console.log(`   Documents failed: ${failed}\n`);
        return { success: true, scanned, indexed, failed };
      }

      if (status === 'FAILED') {
        throw new Error(`KB ingestion failed: ${failed} documents failed`);
      }

      await sleep(pollInterval);
    } catch (error) {
      console.warn(`  Error polling job: ${error.message}`);
      await sleep(pollInterval);
    }
  }

  throw new Error(`KB ingestion timeout after ${maxWaitMs/60000} minutes`);
}

/**
 * Update bedrock_kb_id field in narrative_chunk table
 */
async function updateBedrockKbIds(chunks, jobId) {
  console.log(`\n📝 Updating bedrock_kb_id field for ${chunks.length} chunks...`);

  try {
    // Update all chunks for this ticker with the KB job ID
    const result = await prisma.$executeRawUnsafe(`
      UPDATE narrative_chunks
      SET bedrock_kb_id = $1, updated_at = NOW()
      WHERE ticker = $2
    `, jobId, TICKER);

    console.log(`✅ Updated ${chunks.length} chunks with bedrock_kb_id: ${jobId}\n`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to update bedrock_kb_id: ${error.message}\n`);
    return false;
  }
}

/**
 * Verify sync status
 */
async function verifySyncStatus() {
  console.log(`\n🔍 Verifying sync status...\n`);

  const totalChunks = await prisma.narrativeChunk.count({
    where: { ticker: TICKER },
  });

  const syncedChunks = await prisma.narrativeChunk.count({
    where: {
      ticker: TICKER,
      bedrockKbId: { not: null },
    },
  });

  console.log(`Total chunks: ${totalChunks}`);
  console.log(`Synced to KB: ${syncedChunks}`);
  console.log(`Pending sync: ${totalChunks - syncedChunks}\n`);

  if (syncedChunks === totalChunks) {
    console.log(`✅ All chunks synced successfully!\n`);
    return true;
  } else {
    console.log(`⚠️  ${totalChunks - syncedChunks} chunks not synced\n`);
    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Manual KB Sync for AMZN                                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Get all AMZN chunks
    console.log(`📊 Fetching narrative chunks for ${TICKER}...\n`);
    const chunks = await prisma.narrativeChunk.findMany({
      where: { ticker: TICKER },
      orderBy: { chunkIndex: 'asc' },
    });

    if (chunks.length === 0) {
      console.log(`❌ No narrative chunks found for ${TICKER}\n`);
      process.exit(1);
    }

    console.log(`Found ${chunks.length} narrative chunks\n`);

    // Step 2: Upload chunks to S3
    const uploadResult = await uploadChunksToS3(chunks);
    
    if (uploadResult.uploadedCount === 0) {
      console.log(`❌ No chunks uploaded to S3. Aborting.\n`);
      process.exit(1);
    }

    // Step 3: Start KB ingestion
    const jobId = await startIngestionWithRetry();

    // Step 4: Wait for ingestion to complete
    const ingestionResult = await waitForIngestion(jobId);

    if (!ingestionResult.success) {
      console.log(`❌ KB ingestion did not complete successfully\n`);
      process.exit(1);
    }

    // Step 5: Update bedrock_kb_id field
    await updateBedrockKbIds(chunks, jobId);

    // Step 6: Verify sync status
    const verified = await verifySyncStatus();

    if (verified) {
      console.log('╔════════════════════════════════════════════════════════════╗');
      console.log('║  ✅ KB Sync Complete!                                      ║');
      console.log('╚════════════════════════════════════════════════════════════╝\n');
      console.log(`All ${chunks.length} chunks for ${TICKER} are now synced to Bedrock KB.`);
      console.log(`RAG queries will now have access to narrative content.\n`);
    } else {
      console.log('╔════════════════════════════════════════════════════════════╗');
      console.log('║  ⚠️  KB Sync Incomplete                                    ║');
      console.log('╚════════════════════════════════════════════════════════════╝\n');
      console.log(`Some chunks may not be synced. Check logs for errors.\n`);
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
