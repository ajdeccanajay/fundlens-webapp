#!/usr/bin/env node

/**
 * Check SEC Filing Metadata Compliance
 * 
 * This script checks existing data_sources records with type='sec_filing'
 * to identify which ones don't conform to the new validation rules.
 * 
 * Usage: node scripts/check-sec-filing-metadata-compliance.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Required fields according to the spec
const REQUIRED_FIELDS = [
  'ticker',
  'filingType',
  'accessionNumber',
  'filingDate',
  'reportDate',
  'processed',
  'downloadedAt',
];

// Valid filing types
const VALID_FILING_TYPES = ['10-K', '10-Q', '8-K'];

/**
 * Validate a single metadata object
 */
function validateMetadata(metadata, recordId) {
  const issues = [];

  // Check for missing required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in metadata)) {
      issues.push(`Missing required field: ${field}`);
    }
  }

  // If missing required fields, return early
  if (issues.length > 0) {
    return { valid: false, issues };
  }

  // Validate ticker format (1-5 uppercase letters)
  if (!/^[A-Z]{1,5}$/.test(metadata.ticker)) {
    issues.push(`Invalid ticker format: ${metadata.ticker} (must be 1-5 uppercase letters)`);
  }

  // Validate filing type
  if (!VALID_FILING_TYPES.includes(metadata.filingType)) {
    issues.push(`Invalid filing type: ${metadata.filingType} (must be one of: ${VALID_FILING_TYPES.join(', ')})`);
  }

  // Validate accession number format (XXXXXXXXXX-XX-XXXXXX)
  if (!/^\d{10}-\d{2}-\d{6}$/.test(metadata.accessionNumber)) {
    issues.push(`Invalid accession number format: ${metadata.accessionNumber} (must match XXXXXXXXXX-XX-XXXXXX)`);
  }

  // Validate filing date
  if (isNaN(Date.parse(metadata.filingDate))) {
    issues.push(`Invalid filing date: ${metadata.filingDate}`);
  }

  // Validate report date
  if (isNaN(Date.parse(metadata.reportDate))) {
    issues.push(`Invalid report date: ${metadata.reportDate}`);
  }

  // Validate report date is before or equal to filing date
  if (!isNaN(Date.parse(metadata.filingDate)) && !isNaN(Date.parse(metadata.reportDate))) {
    const reportTime = new Date(metadata.reportDate).getTime();
    const filingTime = new Date(metadata.filingDate).getTime();
    if (reportTime > filingTime) {
      issues.push(`Report date (${metadata.reportDate}) cannot be after filing date (${metadata.filingDate})`);
    }
  }

  // Validate processed is boolean
  if (typeof metadata.processed !== 'boolean') {
    issues.push(`Invalid processed value: ${metadata.processed} (must be boolean)`);
  }

  // Validate downloadedAt timestamp
  if (isNaN(Date.parse(metadata.downloadedAt))) {
    issues.push(`Invalid downloadedAt timestamp: ${metadata.downloadedAt}`);
  }

  // Validate optional processedAt timestamp if present
  if (metadata.processedAt !== undefined && isNaN(Date.parse(metadata.processedAt))) {
    issues.push(`Invalid processedAt timestamp: ${metadata.processedAt}`);
  }

  // Validate processedAt is after downloadedAt if both present
  if (metadata.processedAt && !isNaN(Date.parse(metadata.downloadedAt))) {
    const downloadedTime = new Date(metadata.downloadedAt).getTime();
    const processedTime = new Date(metadata.processedAt).getTime();
    if (processedTime < downloadedTime) {
      issues.push(`processedAt (${metadata.processedAt}) must be after downloadedAt (${metadata.downloadedAt})`);
    }
  }

  // Validate optional size field
  if (metadata.size !== undefined) {
    if (typeof metadata.size !== 'number' || metadata.size < 0) {
      issues.push(`Invalid size value: ${metadata.size} (must be non-negative number)`);
    }
  }

  // Validate optional cik field
  if (metadata.cik !== undefined) {
    if (typeof metadata.cik !== 'string' || !/^\d{10}$/.test(metadata.cik)) {
      issues.push(`Invalid CIK format: ${metadata.cik} (must be 10-digit string)`);
    }
  }

  // Validate optional url field
  if (metadata.url !== undefined) {
    if (typeof metadata.url !== 'string') {
      issues.push(`Invalid URL: ${metadata.url} (must be string)`);
    } else {
      try {
        new URL(metadata.url);
      } catch {
        issues.push(`Invalid URL format: ${metadata.url}`);
      }
    }
  }

  // Validate optional primaryDocument field
  if (metadata.primaryDocument !== undefined) {
    if (typeof metadata.primaryDocument !== 'string' || metadata.primaryDocument.length === 0) {
      issues.push(`Invalid primaryDocument value: ${metadata.primaryDocument} (must be non-empty string)`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Main function
 */
async function main() {
  console.log('Checking SEC filing metadata compliance...\n');

  try {
    // Get all data_sources records with type='sec_filing'
    const secFilings = await prisma.dataSource.findMany({
      where: {
        type: 'sec_filing',
      },
      select: {
        id: true,
        sourceId: true,
        metadata: true,
        createdAt: true,
      },
    });

    console.log(`Found ${secFilings.length} SEC filing records\n`);

    if (secFilings.length === 0) {
      console.log('✅ No SEC filing records found. Nothing to check.');
      return;
    }

    // Validate each record
    const results = {
      total: secFilings.length,
      valid: 0,
      invalid: 0,
      records: [],
    };

    for (const filing of secFilings) {
      const validation = validateMetadata(filing.metadata, filing.id);

      if (validation.valid) {
        results.valid++;
      } else {
        results.invalid++;
        results.records.push({
          id: filing.id,
          sourceId: filing.sourceId,
          createdAt: filing.createdAt,
          metadata: filing.metadata,
          issues: validation.issues,
        });
      }
    }

    // Print summary
    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total records:   ${results.total}`);
    console.log(`Valid records:   ${results.valid} (${((results.valid / results.total) * 100).toFixed(1)}%)`);
    console.log(`Invalid records: ${results.invalid} (${((results.invalid / results.total) * 100).toFixed(1)}%)`);
    console.log('='.repeat(80));
    console.log();

    // Print details of invalid records
    if (results.invalid > 0) {
      console.log('INVALID RECORDS:');
      console.log('='.repeat(80));

      for (const record of results.records) {
        console.log(`\nRecord ID: ${record.id}`);
        console.log(`Source ID: ${record.sourceId}`);
        console.log(`Created:   ${record.createdAt.toISOString()}`);
        console.log(`Issues:`);
        for (const issue of record.issues) {
          console.log(`  - ${issue}`);
        }
        console.log(`\nCurrent metadata:`);
        console.log(JSON.stringify(record.metadata, null, 2));
        console.log('-'.repeat(80));
      }

      console.log('\n⚠️  Migration required for non-compliant records.');
      console.log('Run: node scripts/migrate-sec-filing-metadata.js');
    } else {
      console.log('✅ All records are compliant with the new validation rules.');
      console.log('No migration needed.');
    }
  } catch (error) {
    console.error('Error checking metadata compliance:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
