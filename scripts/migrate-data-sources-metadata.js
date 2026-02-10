/**
 * Migration Script: Update data_sources metadata to conform to SEC Filing Metadata specification
 * 
 * This script:
 * 1. Finds all SEC filing records in data_sources table
 * 2. Validates their metadata against the SECFilingMetadata interface
 * 3. Updates records that are missing required fields or have invalid data
 * 4. Reports on the migration results
 * 
 * @see .kiro/specs/automatic-filing-detection/DATA_SOURCES_METADATA_SPEC.md
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Validates if metadata conforms to SECFilingMetadata interface
 */
function validateMetadata(metadata) {
  const errors = [];
  
  // Check required fields
  const requiredFields = [
    'ticker',
    'filingType',
    'accessionNumber',
    'filingDate',
    'reportDate',
    'processed',
    'downloadedAt',
  ];
  
  for (const field of requiredFields) {
    if (!(field in metadata)) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  // Validate ticker format (1-5 uppercase letters)
  if (metadata.ticker && !/^[A-Z]{1,5}$/.test(metadata.ticker)) {
    errors.push(`Invalid ticker format: ${metadata.ticker}`);
  }
  
  // Validate filing type
  const validFilingTypes = ['10-K', '10-Q', '8-K'];
  if (metadata.filingType && !validFilingTypes.includes(metadata.filingType)) {
    errors.push(`Invalid filing type: ${metadata.filingType}`);
  }
  
  // Validate accession number format
  if (metadata.accessionNumber && !/^\d{10}-\d{2}-\d{6}$/.test(metadata.accessionNumber)) {
    errors.push(`Invalid accession number format: ${metadata.accessionNumber}`);
  }
  
  // Validate dates
  if (metadata.filingDate && isNaN(Date.parse(metadata.filingDate))) {
    errors.push(`Invalid filing date: ${metadata.filingDate}`);
  }
  
  if (metadata.reportDate && isNaN(Date.parse(metadata.reportDate))) {
    errors.push(`Invalid report date: ${metadata.reportDate}`);
  }
  
  // Validate processed is boolean
  if ('processed' in metadata && typeof metadata.processed !== 'boolean') {
    errors.push(`Invalid processed value: ${metadata.processed} (must be boolean)`);
  }
  
  // Validate downloadedAt timestamp
  if (metadata.downloadedAt && isNaN(Date.parse(metadata.downloadedAt))) {
    errors.push(`Invalid downloadedAt timestamp: ${metadata.downloadedAt}`);
  }
  
  return errors;
}

/**
 * Attempts to fix metadata by adding missing fields with defaults
 */
function fixMetadata(metadata, dataSource) {
  const fixed = { ...metadata };
  
  // Normalize ticker to uppercase
  if (fixed.ticker) {
    fixed.ticker = fixed.ticker.toUpperCase();
  }
  
  // Add processed field if missing (default to false)
  if (!('processed' in fixed)) {
    fixed.processed = false;
    console.log(`  - Added processed=false`);
  }
  
  // Convert processed to boolean if it's a string
  if (typeof fixed.processed === 'string') {
    fixed.processed = fixed.processed === 'true';
    console.log(`  - Converted processed to boolean: ${fixed.processed}`);
  }
  
  // Add downloadedAt if missing (use createdAt as fallback)
  if (!fixed.downloadedAt) {
    fixed.downloadedAt = dataSource.createdAt.toISOString();
    console.log(`  - Added downloadedAt from createdAt: ${fixed.downloadedAt}`);
  }
  
  // Ensure dates are in ISO 8601 format
  if (fixed.filingDate && !fixed.filingDate.includes('T')) {
    // Already in YYYY-MM-DD format, keep it
  }
  
  if (fixed.reportDate && !fixed.reportDate.includes('T')) {
    // Already in YYYY-MM-DD format, keep it
  }
  
  // Normalize filingType to include dash (10K -> 10-K)
  if (fixed.filingType) {
    if (fixed.filingType === '10K') {
      fixed.filingType = '10-K';
      console.log(`  - Normalized filingType: 10K -> 10-K`);
    } else if (fixed.filingType === '10Q') {
      fixed.filingType = '10-Q';
      console.log(`  - Normalized filingType: 10Q -> 10-Q`);
    } else if (fixed.filingType === '8K') {
      fixed.filingType = '8-K';
      console.log(`  - Normalized filingType: 8K -> 8-K`);
    }
  }
  
  // Ensure form matches filingType if present
  if (fixed.form && fixed.filingType && fixed.form !== fixed.filingType) {
    fixed.form = fixed.filingType;
    console.log(`  - Updated form to match filingType: ${fixed.form}`);
  }
  
  return fixed;
}

/**
 * Main migration function
 */
async function migrateDataSources() {
  console.log('Starting data_sources metadata migration...\n');
  
  // Find all SEC filing records
  const secFilings = await prisma.dataSource.findMany({
    where: {
      type: 'sec_filing',
    },
    orderBy: {
      createdAt: 'asc',
    },
  });
  
  console.log(`Found ${secFilings.length} SEC filing records\n`);
  
  if (secFilings.length === 0) {
    console.log('No SEC filing records found. Migration complete.');
    return {
      total: 0,
      valid: 0,
      fixed: 0,
      unfixable: 0,
    };
  }
  
  const results = {
    total: secFilings.length,
    valid: 0,
    fixed: 0,
    unfixable: 0,
    errors: [],
  };
  
  for (const dataSource of secFilings) {
    const metadata = dataSource.metadata;
    
    console.log(`\nChecking: ${dataSource.sourceId}`);
    console.log(`  Type: ${dataSource.type}`);
    console.log(`  Created: ${dataSource.createdAt.toISOString()}`);
    
    // Validate current metadata
    const errors = validateMetadata(metadata);
    
    if (errors.length === 0) {
      console.log(`  ✓ Valid metadata`);
      results.valid++;
      continue;
    }
    
    console.log(`  ✗ Invalid metadata:`);
    errors.forEach(error => console.log(`    - ${error}`));
    
    // Attempt to fix metadata
    console.log(`  Attempting to fix...`);
    const fixedMetadata = fixMetadata(metadata, dataSource);
    
    // Validate fixed metadata
    const fixedErrors = validateMetadata(fixedMetadata);
    
    if (fixedErrors.length === 0) {
      console.log(`  ✓ Successfully fixed metadata`);
      
      // Update the record
      await prisma.dataSource.update({
        where: { id: dataSource.id },
        data: { metadata: fixedMetadata },
      });
      
      results.fixed++;
    } else {
      console.log(`  ✗ Could not fix metadata:`);
      fixedErrors.forEach(error => console.log(`    - ${error}`));
      results.unfixable++;
      results.errors.push({
        sourceId: dataSource.sourceId,
        errors: fixedErrors,
        metadata: metadata,
      });
    }
  }
  
  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total records:     ${results.total}`);
  console.log(`Valid records:     ${results.valid} (${((results.valid / results.total) * 100).toFixed(1)}%)`);
  console.log(`Fixed records:     ${results.fixed} (${((results.fixed / results.total) * 100).toFixed(1)}%)`);
  console.log(`Unfixable records: ${results.unfixable} (${((results.unfixable / results.total) * 100).toFixed(1)}%)`);
  
  if (results.unfixable > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('UNFIXABLE RECORDS');
    console.log('='.repeat(80));
    results.errors.forEach(({ sourceId, errors, metadata }) => {
      console.log(`\n${sourceId}:`);
      errors.forEach(error => console.log(`  - ${error}`));
      console.log(`  Metadata: ${JSON.stringify(metadata, null, 2)}`);
    });
    console.log('\nThese records require manual intervention.');
  }
  
  return results;
}

/**
 * Dry run mode - check without updating
 */
async function dryRun() {
  console.log('DRY RUN MODE - No changes will be made\n');
  
  const secFilings = await prisma.dataSource.findMany({
    where: {
      type: 'sec_filing',
    },
    orderBy: {
      createdAt: 'asc',
    },
  });
  
  console.log(`Found ${secFilings.length} SEC filing records\n`);
  
  if (secFilings.length === 0) {
    console.log('No SEC filing records found.');
    return;
  }
  
  const results = {
    valid: 0,
    needsFix: 0,
    unfixable: 0,
  };
  
  for (const dataSource of secFilings) {
    const metadata = dataSource.metadata;
    const errors = validateMetadata(metadata);
    
    if (errors.length === 0) {
      results.valid++;
      continue;
    }
    
    // Try to fix
    const fixedMetadata = fixMetadata(metadata, dataSource);
    const fixedErrors = validateMetadata(fixedMetadata);
    
    if (fixedErrors.length === 0) {
      results.needsFix++;
    } else {
      results.unfixable++;
      console.log(`\nUnfixable: ${dataSource.sourceId}`);
      fixedErrors.forEach(error => console.log(`  - ${error}`));
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('DRY RUN SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total records:     ${secFilings.length}`);
  console.log(`Valid records:     ${results.valid}`);
  console.log(`Needs fix:         ${results.needsFix}`);
  console.log(`Unfixable:         ${results.unfixable}`);
  console.log('\nRun without --dry-run to apply fixes.');
}

// Main execution
async function main() {
  try {
    const isDryRun = process.argv.includes('--dry-run');
    
    if (isDryRun) {
      await dryRun();
    } else {
      await migrateDataSources();
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
