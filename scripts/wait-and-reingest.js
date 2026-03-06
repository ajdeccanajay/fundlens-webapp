#!/usr/bin/env node
/**
 * Wait for old ingestion job to complete, then start a new one
 * to pick up the 1,254 sections we just uploaded.
 */
const { BedrockAgentClient, StartIngestionJobCommand, GetIngestionJobCommand } = require('@aws-sdk/client-bedrock-agent');

const KB_ID = 'NB5XNMHBQT';
const DATA_SOURCE_ID = 'OQMSFOE5SL';
const OLD_JOB_ID = '7X3VS3KKCW';

const bedrock = new BedrockAgentClient({ region: 'us-east-1', maxAttempts: 10, retryMode: 'adaptive' });

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getJobStatus(jobId) {
  const resp = await bedrock.send(new GetIngestionJobCommand({
    knowledgeBaseId: KB_ID,
    dataSourceId: DATA_SOURCE_ID,
    ingestionJobId: jobId,
  }));
  return resp.ingestionJob;
}

async function main() {
  // Step 1: Check old job status
  log(`Checking old job ${OLD_JOB_ID}...`);
  const oldJob = await getJobStatus(OLD_JOB_ID);
  const stats = oldJob.statistics;
  log(`Old job status: ${oldJob.status} | Scanned: ${stats?.numberOfDocumentsScanned} | Indexed: ${stats?.numberOfNewDocumentsIndexed} | Deleted: ${stats?.numberOfDocumentsDeleted}`);

  if (oldJob.status === 'IN_PROGRESS' || oldJob.status === 'STARTING') {
    log('Old job still running. Waiting for completion...');
    while (true) {
      await sleep(30000);
      const job = await getJobStatus(OLD_JOB_ID);
      const s = job.statistics;
      log(`  ${job.status} | Deleted: ${s?.numberOfDocumentsDeleted}`);
      if (job.status !== 'IN_PROGRESS' && job.status !== 'STARTING') {
        log(`Old job finished with status: ${job.status}`);
        break;
      }
    }
  } else {
    log(`Old job already finished: ${oldJob.status}`);
  }

  // Step 2: Start new ingestion
  log('Starting NEW ingestion job for 1,254 sections...');
  const resp = await bedrock.send(new StartIngestionJobCommand({
    knowledgeBaseId: KB_ID,
    dataSourceId: DATA_SOURCE_ID,
    description: `Fixed section-based sync: 1254 sections with correct fiscal_period at ${new Date().toISOString()}`,
  }));

  const newJobId = resp.ingestionJob?.ingestionJobId;
  log(`New ingestion job started: ${newJobId}`);

  // Step 3: Monitor new job
  log('Monitoring new job...');
  while (true) {
    await sleep(15000);
    try {
      const job = await getJobStatus(newJobId);
      const s = job.statistics;
      log(`  ${job.status} | Scanned: ${s?.numberOfDocumentsScanned} | Indexed: ${s?.numberOfNewDocumentsIndexed} | Modified: ${s?.numberOfModifiedDocumentsIndexed} | Failed: ${s?.numberOfDocumentsFailed} | Deleted: ${s?.numberOfDocumentsDeleted}`);
      
      if (job.status === 'COMPLETE') {
        log('NEW INGESTION COMPLETE!');
        log(`  Scanned: ${s?.numberOfDocumentsScanned}`);
        log(`  Indexed: ${s?.numberOfNewDocumentsIndexed}`);
        log(`  Modified: ${s?.numberOfModifiedDocumentsIndexed}`);
        log(`  Failed: ${s?.numberOfDocumentsFailed}`);
        log(`  Deleted: ${s?.numberOfDocumentsDeleted}`);
        break;
      }
      if (job.status === 'FAILED') {
        log('INGESTION FAILED!');
        break;
      }
    } catch (e) {
      log(`Poll error: ${e.message}`);
    }
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
