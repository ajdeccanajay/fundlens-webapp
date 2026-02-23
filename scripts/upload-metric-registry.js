#!/usr/bin/env node

/**
 * Upload Metric Registry YAML Files
 * 
 * Reads pre-built YAML registry files from .kiro/specs/metric-resolution-architecture/
 * and copies them to local-s3-storage/fundlens-documents-dev/metrics/ for local dev.
 * Optionally uploads to real S3 with --upload-s3 flag.
 * 
 * Usage:
 *   node scripts/upload-metric-registry.js              # Local copy only
 *   node scripts/upload-metric-registry.js --upload-s3   # Local copy + S3 upload
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// File → subdirectory mapping
const FILE_MAPPING = {
  'income_statement.yaml': 'universal',
  'balance_sheet.yaml': 'universal',
  'cash_flow.yaml': 'universal',
  'equity_statement.yaml': 'universal',
  'revenue_by_industry.yaml': 'sector',
  'energy.yaml': 'sector',
  'materials.yaml': 'sector',
  'industrials.yaml': 'sector',
  'consumer_discretionary.yaml': 'sector',
  'consumer_staples.yaml': 'sector',
  'healthcare.yaml': 'sector',
  'financials.yaml': 'sector',
  'info_tech.yaml': 'sector',
  'communication_services.yaml': 'sector',
  'utilities.yaml': 'sector',
  'real_estate.yaml': 'sector',
  'return_and_fund_metrics.yaml': 'pe_specific',
  'all_computed_metrics.yaml': 'computed',
  'analytical_concepts.yaml': 'concepts',
  'third_avenue.yaml': 'clients',
};

const SOURCE_DIR = path.join(__dirname, '..', '.kiro', 'specs', 'metric-resolution-architecture');
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'fundlens-documents-dev';
const LOCAL_S3_DIR = path.join(__dirname, '..', 'local-s3-storage', BUCKET_NAME, 'metrics');
const S3_PREFIX = process.env.METRIC_REGISTRY_S3_PREFIX || 'metrics/';

async function main() {
  const uploadToS3 = process.argv.includes('--upload-s3');
  
  console.log('=== Metric Registry Upload ===\n');
  console.log(`Source: ${SOURCE_DIR}`);
  console.log(`Local target: ${LOCAL_S3_DIR}`);
  if (uploadToS3) {
    console.log(`S3 target: s3://${BUCKET_NAME}/${S3_PREFIX}`);
  }
  console.log('');

  let totalMetrics = 0;
  let totalSynonyms = 0;
  let filesCopied = 0;
  let filesUploaded = 0;
  const errors = [];

  // Initialize S3 client if uploading
  let s3Client = null;
  if (uploadToS3) {
    const { S3Client } = require('@aws-sdk/client-s3');
    s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
  }

  for (const [filename, subdirectory] of Object.entries(FILE_MAPPING)) {
    const sourcePath = path.join(SOURCE_DIR, filename);
    
    if (!fs.existsSync(sourcePath)) {
      errors.push(`Missing source file: ${filename}`);
      console.error(`  ✗ ${filename} — NOT FOUND`);
      continue;
    }

    const content = fs.readFileSync(sourcePath, 'utf8');
    
    // Parse YAML and count metrics/synonyms
    try {
      const parsed = yaml.load(content);
      if (parsed && typeof parsed === 'object') {
        // Client overlay files have a different structure (client, notes, overrides)
        if (subdirectory === 'clients') {
          // Client overlays don't add new metrics, they extend existing ones
          const overrides = parsed.overrides || {};
          const overrideCount = Object.keys(overrides).length;
          let overrideSynonyms = 0;
          for (const override of Object.values(overrides)) {
            if (override && override.additional_synonyms) {
              overrideSynonyms += override.additional_synonyms.length;
            }
          }
          console.log(`  ${filename} → ${subdirectory}/ (${overrideCount} overrides, ${overrideSynonyms} additional synonyms)`);
        } else if (subdirectory === 'concepts') {
          // Concept files have a different structure
          const conceptCount = Object.keys(parsed).length;
          let triggerCount = 0;
          for (const concept of Object.values(parsed)) {
            if (concept && concept.triggers) {
              triggerCount += concept.triggers.length;
            }
          }
          console.log(`  ${filename} → ${subdirectory}/ (${conceptCount} concepts, ${triggerCount} triggers)`);
        } else {
          // Standard metric files — count top-level keys as metrics
          const metricCount = Object.keys(parsed).length;
          let synonymCount = 0;
          for (const metric of Object.values(parsed)) {
            if (metric && metric.synonyms) {
              synonymCount += metric.synonyms.length;
            }
          }
          totalMetrics += metricCount;
          totalSynonyms += synonymCount;
          console.log(`  ${filename} → ${subdirectory}/ (${metricCount} metrics, ${synonymCount} synonyms)`);
        }
      }
    } catch (parseErr) {
      errors.push(`YAML parse error in ${filename}: ${parseErr.message}`);
    }

    // Copy to local filesystem
    const localDir = path.join(LOCAL_S3_DIR, subdirectory);
    fs.mkdirSync(localDir, { recursive: true });
    const localDest = path.join(localDir, filename);
    fs.copyFileSync(sourcePath, localDest);
    filesCopied++;

    // Upload to S3 if requested
    if (uploadToS3 && s3Client) {
      try {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        const s3Key = `${S3_PREFIX}${subdirectory}/${filename}`;
        await s3Client.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: s3Key,
          Body: content,
          ContentType: 'application/x-yaml',
        }));
        filesUploaded++;
      } catch (s3Err) {
        errors.push(`S3 upload failed for ${filename}: ${s3Err.message}`);
        console.error(`  ✗ S3 upload failed: ${filename} — ${s3Err.message}`);
      }
    }
  }

  // Print summary
  console.log('\n=== Summary ===');
  console.log(`Files copied to local: ${filesCopied}/${Object.keys(FILE_MAPPING).length}`);
  if (uploadToS3) {
    console.log(`Files uploaded to S3:  ${filesUploaded}/${Object.keys(FILE_MAPPING).length}`);
  }
  console.log(`Total metrics:         ${totalMetrics}`);
  console.log(`Total synonyms:        ${totalSynonyms}`);
  
  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    errors.forEach(e => console.log(`  - ${e}`));
  }

  // Validate expected counts
  const EXPECTED_METRICS = 252;
  if (totalMetrics !== EXPECTED_METRICS) {
    console.log(`\n⚠ WARNING: Expected ${EXPECTED_METRICS} metrics but found ${totalMetrics}`);
  } else {
    console.log(`\n✓ Metric count validated: ${totalMetrics} metrics (matches expected ${EXPECTED_METRICS})`);
  }

  if (filesCopied === Object.keys(FILE_MAPPING).length) {
    console.log(`✓ All ${filesCopied} files copied successfully`);
  } else {
    console.log(`✗ Only ${filesCopied}/${Object.keys(FILE_MAPPING).length} files copied`);
    process.exit(1);
  }

  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
