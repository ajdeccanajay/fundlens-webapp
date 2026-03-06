#!/usr/bin/env node
/**
 * Clean-Slate KB Sync Script
 * 
 * 1. Delete ALL old chunk files from s3://fundlens-bedrock-chunks/chunks/
 * 2. Delete any existing section files from s3://fundlens-bedrock-chunks/sections/
 * 3. Export ALL ticker sections from RDS → S3 sections/ prefix
 * 4. Trigger Bedrock KB ingestion
 * 5. Monitor ingestion job to completion
 */

const { S3Client, ListObjectsV2Command, DeleteObjectsCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { BedrockAgentClient, StartIngestionJobCommand, GetIngestionJobCommand, ListIngestionJobsCommand } = require('@aws-sdk/client-bedrock-agent');
const { Client } = require('pg');

// ─── Config ───────────────────────────────────────────────────────────────────
const BUCKET = 'fundlens-bedrock-chunks';
const KB_ID = 'NB5XNMHBQT';
const DATA_SOURCE_ID = 'OQMSFOE5SL';
const REGION = 'us-east-1';

const DB_URL = 'postgresql://fundlens_admin:FundLens2025SecureDB@fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db';

const s3 = new S3Client({ region: REGION });
const bedrock = new BedrockAgentClient({ region: REGION, maxAttempts: 10, retryMode: 'adaptive' });

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function deleteAllWithPrefix(prefix) {
  log(`Deleting all objects under s3://${BUCKET}/${prefix} ...`);
  let deleted = 0;
  let continuationToken;

  do {
    const list = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    const objects = list.Contents || [];
    if (objects.length === 0) break;

    // Delete in batches of 1000 (S3 limit)
    for (let i = 0; i < objects.length; i += 1000) {
      const batch = objects.slice(i, i + 1000);
      await s3.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: batch.map(o => ({ Key: o.Key })) },
      }));
      deleted += batch.length;
    }

    log(`  Deleted ${deleted} objects so far...`);
    continuationToken = list.NextContinuationToken;
  } while (continuationToken);

  log(`✅ Deleted ${deleted} total objects under ${prefix}`);
  return deleted;
}

async function countS3Objects(prefix) {
  let count = 0;
  let continuationToken;
  do {
    const list = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    count += (list.Contents || []).length;
    continuationToken = list.NextContinuationToken;
  } while (continuationToken);
  return count;
}

// ─── Section Export Logic ─────────────────────────────────────────────────────
// Replicates SectionExporterService logic in pure Node.js

function cleanContent(content) {
  if (!content) return '';
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

function sanitize(s) { return s.replace(/[^a-zA-Z0-9_-]/g, '_'); }

function humanizeSectionType(sectionType) {
  const map = {
    'risk_factors': 'Risk Factors',
    'mda': "Management's Discussion and Analysis",
    'business': 'Business Overview',
    'financial_statements': 'Financial Statements',
    'notes': 'Notes to Financial Statements',
    'controls': 'Controls and Procedures',
    'legal': 'Legal Proceedings',
    'market_risk': 'Market Risk Disclosures',
    'executive_compensation': 'Executive Compensation',
    'properties': 'Properties',
    'unresolved_staff_comments': 'Unresolved Staff Comments',
    'other': 'Other',
    'proxy_executive_compensation': 'Proxy: Executive Compensation',
    'proxy_governance': 'Proxy: Corporate Governance',
    'proxy_proposals': 'Proxy: Shareholder Proposals',
    'insider_transaction': 'Insider Transaction (Form 4)',
    'earnings_transcript': 'Earnings Call Transcript',
    'foreign_annual_report': 'Foreign Annual Report (40-F)',
    'foreign_current_report': 'Foreign Current Report (6-K)',
  };
  return map[sectionType] || sectionType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function exportAllSections(db) {
  log('─── PHASE 3: Export sections from RDS to S3 ───');

  // Get all tickers
  const tickerResult = await db.query('SELECT DISTINCT ticker FROM narrative_chunks ORDER BY ticker');
  const tickers = tickerResult.rows.map(r => r.ticker);
  log(`Found ${tickers.length} tickers: ${tickers.join(', ')}`);

  let totalSections = 0;
  let totalChars = 0;

  for (const ticker of tickers) {
    const stats = await exportTickerSections(db, ticker);
    totalSections += stats.sections;
    totalChars += stats.chars;
    log(`  ${ticker}: ${stats.sections} sections, ${stats.chars.toLocaleString()} chars`);
  }

  log(`✅ Total: ${totalSections} sections, ${totalChars.toLocaleString()} chars across ${tickers.length} tickers`);
  return { totalSections, totalChars, tickers: tickers.length };
}

async function exportTickerSections(db, ticker) {
  // Get all chunks for this ticker, ordered
  const chunksResult = await db.query(`
    SELECT id, ticker, filing_type, section_type, chunk_index, content, filing_date
    FROM narrative_chunks
    WHERE ticker = $1
    ORDER BY filing_type ASC, filing_date ASC, section_type ASC, chunk_index ASC
  `, [ticker]);

  const chunks = chunksResult.rows;
  if (chunks.length === 0) return { sections: 0, chars: 0 };

  // Derive fiscal_period from each chunk's own filing_date
  function deriveFiscalPeriod(filingType, filingDate) {
    if (!filingDate) return 'unknown';
    const d = new Date(filingDate);
    const year = d.getFullYear();
    const quarter = Math.ceil((d.getMonth() + 1) / 3);
    if (filingType.includes('10-K') || filingType.includes('40-F')) return `FY${year}`;
    if (filingType.includes('10-Q')) return `Q${quarter}-${year}`;
    // For 8-K, DEF 14A, Form 4, 6-K, etc. — use date-based key to separate filings
    return `${year}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  // Group chunks by section using chunk's own filing_date for fiscal_period
  const sectionMap = new Map();
  for (const chunk of chunks) {
    const filingType = chunk.filing_type || '10-K';
    const fiscalPeriod = deriveFiscalPeriod(filingType, chunk.filing_date);
    const sectionKey = `${sanitize(ticker)}/${sanitize(filingType)}_${sanitize(fiscalPeriod)}_${sanitize(chunk.section_type)}`;

    if (!sectionMap.has(sectionKey)) {
      sectionMap.set(sectionKey, { chunks: [], filingType, sectionType: chunk.section_type, fiscalPeriod, filingDate: chunk.filing_date });
    }
    sectionMap.get(sectionKey).chunks.push(chunk);
  }

  // Upload each section
  let sectionsUploaded = 0;
  let totalChars = 0;
  const CONCURRENCY = 10;
  const entries = Array.from(sectionMap.entries());

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async ([sectionKey, data]) => {
      // Sort chunks by index
      data.chunks.sort((a, b) => a.chunk_index - b.chunk_index);

      // Concatenate content
      const parts = data.chunks.map(c => cleanContent(c.content)).filter(c => c.length > 0);
      const fullContent = parts.join('\n\n');

      if (fullContent.length < 100) return; // Skip tiny sections

      const s3Key = `sections/${sectionKey}.txt`;
      const metadataKey = `sections/${sectionKey}.txt.metadata.json`;

      // Upload content
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        Body: fullContent,
        ContentType: 'text/plain; charset=utf-8',
      }));

      // Upload metadata — filing_date comes from the chunk's own filing_date
      const filingDateStr = data.filingDate ? new Date(data.filingDate).toISOString().split('T')[0] : '';
      const metadata = {
        metadataAttributes: {
          ticker,
          filing_type: data.filingType,
          section_type: data.sectionType,
          section_title: humanizeSectionType(data.sectionType),
          fiscal_period: data.fiscalPeriod,
          ...(filingDateStr ? { filing_date: filingDateStr } : {}),
        },
      };

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: metadataKey,
        Body: JSON.stringify(metadata),
        ContentType: 'application/json',
      }));

      sectionsUploaded++;
      totalChars += fullContent.length;
    }));
  }

  return { sections: sectionsUploaded, chars: totalChars };
}

// ─── KB Ingestion ─────────────────────────────────────────────────────────────

async function checkForOngoingJob() {
  try {
    const resp = await bedrock.send(new ListIngestionJobsCommand({
      knowledgeBaseId: KB_ID,
      dataSourceId: DATA_SOURCE_ID,
      maxResults: 5,
    }));
    const jobs = resp.ingestionJobSummaries || [];
    const running = jobs.find(j => j.status === 'STARTING' || j.status === 'IN_PROGRESS');
    return running ? { jobId: running.ingestionJobId, status: running.status } : null;
  } catch (e) {
    log(`Warning: Could not check ongoing jobs: ${e.message}`);
    return null;
  }
}

async function startIngestion() {
  // Check for ongoing job first
  const ongoing = await checkForOngoingJob();
  if (ongoing) {
    log(`Found ongoing ingestion job: ${ongoing.jobId} (${ongoing.status}). Will monitor it.`);
    return ongoing.jobId;
  }

  const resp = await bedrock.send(new StartIngestionJobCommand({
    knowledgeBaseId: KB_ID,
    dataSourceId: DATA_SOURCE_ID,
    description: `Clean-slate section-based sync at ${new Date().toISOString()}`,
  }));

  const jobId = resp.ingestionJob?.ingestionJobId;
  if (!jobId) throw new Error('No job ID returned from StartIngestionJob');
  return jobId;
}

async function monitorIngestion(jobId) {
  const MAX_WAIT = 15 * 60 * 1000; // 15 minutes
  const POLL_INTERVAL = 15 * 1000; // 15 seconds
  const start = Date.now();

  log(`Monitoring ingestion job: ${jobId}`);

  while (Date.now() - start < MAX_WAIT) {
    try {
      const resp = await bedrock.send(new GetIngestionJobCommand({
        knowledgeBaseId: KB_ID,
        dataSourceId: DATA_SOURCE_ID,
        ingestionJobId: jobId,
      }));

      const job = resp.ingestionJob;
      const stats = job?.statistics;
      const scanned = stats?.numberOfDocumentsScanned || 0;
      const indexed = stats?.numberOfNewDocumentsIndexed || 0;
      const modified = stats?.numberOfModifiedDocumentsIndexed || 0;
      const failed = stats?.numberOfDocumentsFailed || 0;
      const deleted = stats?.numberOfDocumentsDeleted || 0;

      log(`  Status: ${job?.status} | Scanned: ${scanned} | Indexed: ${indexed} | Modified: ${modified} | Failed: ${failed} | Deleted: ${deleted}`);

      if (job?.status === 'COMPLETE') {
        log(`✅ Ingestion COMPLETE!`);
        log(`   Documents scanned: ${scanned}`);
        log(`   New documents indexed: ${indexed}`);
        log(`   Modified documents: ${modified}`);
        log(`   Failed documents: ${failed}`);
        log(`   Deleted documents: ${deleted}`);
        return { success: true, stats: { scanned, indexed, modified, failed, deleted } };
      }

      if (job?.status === 'FAILED') {
        log(`❌ Ingestion FAILED`);
        return { success: false, error: 'Ingestion job failed' };
      }
    } catch (e) {
      log(`  Warning: Poll error: ${e.message}`);
    }

    await sleep(POLL_INTERVAL);
  }

  log(`⚠️ Timed out after ${MAX_WAIT / 60000} minutes. Job may still be running.`);
  return { success: false, error: 'Timeout' };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  log('═══════════════════════════════════════════════════════════');
  log('  CLEAN-SLATE KB SYNC');
  log('═══════════════════════════════════════════════════════════');

  // Connect to RDS
  const db = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  log('Connected to RDS');

  // Check RDS data
  const chunkCount = await db.query('SELECT COUNT(*)::int as count FROM narrative_chunks');
  const tickerCounts = await db.query(`
    SELECT ticker, filing_type, COUNT(*)::int as count 
    FROM narrative_chunks 
    GROUP BY ticker, filing_type 
    ORDER BY ticker, filing_type
  `);
  log(`RDS has ${chunkCount.rows[0].count} total narrative chunks across ${tickerCounts.rows.length} ticker/filing_type combos:`);
  for (const row of tickerCounts.rows) {
    log(`  ${row.ticker} / ${row.filing_type}: ${row.count} chunks`);
  }

  // ─── PHASE 1: Delete old chunks/ prefix ───
  log('');
  log('─── PHASE 1: Delete old chunks/ prefix ───');
  const oldChunksBefore = await countS3Objects('chunks/');
  log(`Found ${oldChunksBefore} objects under chunks/ prefix`);
  if (oldChunksBefore > 0) {
    await deleteAllWithPrefix('chunks/');
  } else {
    log('No old chunk files to delete');
  }

  // ─── PHASE 2: Delete existing sections/ prefix (clean slate) ───
  log('');
  log('─── PHASE 2: Delete existing sections/ prefix ───');
  const oldSectionsBefore = await countS3Objects('sections/');
  log(`Found ${oldSectionsBefore} objects under sections/ prefix`);
  if (oldSectionsBefore > 0) {
    await deleteAllWithPrefix('sections/');
  } else {
    log('No existing section files to delete');
  }

  // ─── PHASE 3: Export all sections ───
  log('');
  const exportResult = await exportAllSections(db);

  // Verify S3 state
  log('');
  log('─── Verification ───');
  const chunksAfter = await countS3Objects('chunks/');
  const sectionsAfter = await countS3Objects('sections/');
  log(`S3 state after export:`);
  log(`  chunks/ prefix: ${chunksAfter} objects (should be 0)`);
  log(`  sections/ prefix: ${sectionsAfter} objects (content + metadata files)`);

  // ─── PHASE 4: Trigger KB ingestion ───
  log('');
  log('─── PHASE 4: Trigger KB ingestion ───');
  const jobId = await startIngestion();
  log(`Ingestion job started: ${jobId}`);

  // ─── PHASE 5: Monitor ingestion ───
  log('');
  log('─── PHASE 5: Monitor ingestion ───');
  const ingestionResult = await monitorIngestion(jobId);

  // ─── Summary ───
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('');
  log('═══════════════════════════════════════════════════════════');
  log('  SUMMARY');
  log('═══════════════════════════════════════════════════════════');
  log(`  Old chunks deleted: ${oldChunksBefore}`);
  log(`  Old sections deleted: ${oldSectionsBefore}`);
  log(`  New sections uploaded: ${exportResult.totalSections}`);
  log(`  Total characters: ${exportResult.totalChars.toLocaleString()}`);
  log(`  Tickers processed: ${exportResult.tickers}`);
  log(`  Ingestion job: ${jobId}`);
  log(`  Ingestion result: ${ingestionResult.success ? 'SUCCESS' : 'FAILED/TIMEOUT'}`);
  if (ingestionResult.stats) {
    log(`  Documents scanned: ${ingestionResult.stats.scanned}`);
    log(`  Documents indexed: ${ingestionResult.stats.indexed}`);
  }
  log(`  Total time: ${elapsed}s`);
  log('═══════════════════════════════════════════════════════════');

  await db.end();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
