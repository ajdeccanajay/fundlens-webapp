#!/usr/bin/env node

/**
 * Check KB Ingestion Failures
 * 
 * This script checks the latest KB ingestion job to see why documents failed
 */

const { 
  BedrockAgentClient, 
  ListIngestionJobsCommand,
  GetIngestionJobCommand,
} = require('@aws-sdk/client-bedrock-agent');

const bedrockAgent = new BedrockAgentClient({ 
  region: process.env.AWS_REGION || 'us-east-1',
  maxAttempts: 10,
  retryMode: 'adaptive',
});

const KB_ID = process.env.BEDROCK_KB_ID || 'NB5XNMHBQT';
const DATA_SOURCE_ID = process.env.BEDROCK_DATA_SOURCE_ID || 'OQMSFOE5SL';

async function main() {
  console.log('Checking latest KB ingestion job...\n');

  try {
    // Get latest ingestion jobs
    const listCommand = new ListIngestionJobsCommand({
      knowledgeBaseId: KB_ID,
      dataSourceId: DATA_SOURCE_ID,
      maxResults: 5,
    });

    const listResponse = await bedrockAgent.send(listCommand);
    const jobs = listResponse.ingestionJobSummaries || [];

    if (jobs.length === 0) {
      console.log('No ingestion jobs found\n');
      return;
    }

    console.log(`Found ${jobs.length} recent jobs:\n`);

    for (const job of jobs) {
      console.log(`Job ID: ${job.ingestionJobId}`);
      console.log(`Status: ${job.status}`);
      console.log(`Started: ${job.startedAt}`);
      console.log(`Updated: ${job.updatedAt}`);
      
      if (job.statistics) {
        console.log(`Statistics:`);
        console.log(`  - Scanned: ${job.statistics.numberOfDocumentsScanned || 0}`);
        console.log(`  - Indexed: ${job.statistics.numberOfNewDocumentsIndexed || 0}`);
        console.log(`  - Modified: ${job.statistics.numberOfModifiedDocumentsIndexed || 0}`);
        console.log(`  - Deleted: ${job.statistics.numberOfDocumentsDeleted || 0}`);
        console.log(`  - Failed: ${job.statistics.numberOfDocumentsFailed || 0}`);
      }
      console.log('');

      // Get detailed job info
      const getCommand = new GetIngestionJobCommand({
        knowledgeBaseId: KB_ID,
        dataSourceId: DATA_SOURCE_ID,
        ingestionJobId: job.ingestionJobId,
      });

      const detailResponse = await bedrockAgent.send(getCommand);
      const detail = detailResponse.ingestionJob;

      if (detail) {
        console.log(`Detailed Info:`);
        console.log(`  Description: ${detail.description || 'N/A'}`);
        console.log(`  Failure Reasons: ${detail.failureReasons?.join(', ') || 'None'}`);
        console.log('');
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

main();
