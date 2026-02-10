#!/usr/bin/env node

/**
 * Migrate SEC Filing Metadata
 * 
 * This script updates existing data_sources records with type='sec_filing'
 * to conform to the new validation rules by adding missing required fields.
 * 
 * Usage: node scripts/migrate-sec-filing-metadata.js [--dry-run]
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Check if dry-run mode
const isDryRun = process.argv.includes('--dry-run');

/**
 * Format accession number to standard format (XXXXXXXXXX-XX-XXXXXX)
 */
function formatAccessionNumber(accessionNo) {
  if (!accessionNo) return null;
  
  // Remove any existing dashes
  const cleaned = accessionNo.replace(/-/g, '');
  
  // Check if it's the right length (18 digits)
  if (cleaned.length !== 18 || !/^\d+$/.test(cleaned)) {
    return null;
  }
  
  // Format as XXXXXXXXXX-XX-XXXXXX
  return `${cleaned.slice(0, 10)}-${cleaned.slice(10, 12)}-${cleaned.slice(12, 18)}`;
}

/**
 * Try to find filing metadata from filing_metadata table
 */
async function findFilingMetadata(ticker, filingType, fiscalPeriod) {
  if (!ticker || !filingType) return null;

  try {
    // Try to find matching filing in filing_metadata table
    const filing = await prisma.filingMetadata.findFirst({
      where: {
        ticker: ticker.toUpperCase(),
        filingType,
      },
      orderBy: {
        filingDate: 'desc',
      },
    });

    if (filing && filing.accessionNo) {
      // Format the accession number properly
      filing.accessionNo = formatAccessionNumber(filing.accessionNo) || filing.accessionNo;
    }

    return filing;
  } catch (error) {
    return null;
  }
}

/**
 * Migrate a single record
 */
async function migrateMetadata(metadata, recordId, sourceId, createdAt) {
  const updated = { ...metadata };
  let changes = [];
  let isLegacyRecord = false;

  // Normalize field names (handle both camelCase and snake_case)
  if (metadata.filing_type && !metadata.filingType) {
    updated.filingType = metadata.filing_type;
    delete updated.filing_type;
    changes.push('Normalized filing_type to filingType');
  }

  // Check if this is a legacy record with fiscal_period
  if (metadata.fiscal_period) {
    isLegacyRecord = true;
    
    // Try to find real filing data from filing_metadata table
    const filingMeta = await findFilingMetadata(
      metadata.ticker,
      updated.filingType || '10-K',
      metadata.fiscal_period
    );

    if (filingMeta) {
      // Use real filing data
      if (!updated.accessionNumber) {
        updated.accessionNumber = filingMeta.accessionNo;
        changes.push(`Added accessionNumber from filing_metadata: ${filingMeta.accessionNo}`);
      }
      if (!updated.filingDate) {
        updated.filingDate = filingMeta.filingDate.toISOString().split('T')[0];
        changes.push(`Added filingDate from filing_metadata: ${updated.filingDate}`);
      }
    } else {
      // No real filing data found - use placeholders
      if (!updated.accessionNumber) {
        updated.accessionNumber = '0000000000-00-000000';
        changes.push('Added placeholder accessionNumber (legacy record, no real filing data)');
      }
      if (!updated.filingDate) {
        updated.filingDate = createdAt.toISOString().split('T')[0];
        changes.push(`Added filingDate from createdAt (legacy record): ${updated.filingDate}`);
      }
    }

    if (!updated.filingType) {
      updated.filingType = '10-K';
      changes.push('Added default filingType: 10-K (legacy record)');
    }
  }

  // Add missing accessionNumber if we can derive it from sourceId
  if (!updated.accessionNumber) {
    // sourceId format: TICKER-FILING_TYPE-ACCESSION_NUMBER
    const parts = sourceId.split('-');
    if (parts.length >= 3 && parts[2].match(/^\d{10}-\d{2}-\d{6}$/)) {
      // Accession number is in sourceId
      updated.accessionNumber = parts.slice(2).join('-');
      changes.push(`Extracted accessionNumber from sourceId: ${updated.accessionNumber}`);
    } else {
      // Can't derive - use placeholder
      updated.accessionNumber = '0000000000-00-000000';
      changes.push('Added placeholder accessionNumber (could not derive from sourceId)');
    }
  } else {
    // Check if existing accession number needs formatting
    const formatted = formatAccessionNumber(updated.accessionNumber);
    if (formatted && formatted !== updated.accessionNumber) {
      updated.accessionNumber = formatted;
      changes.push(`Reformatted accessionNumber: ${updated.accessionNumber}`);
    } else if (!formatted && updated.accessionNumber !== '0000000000-00-000000') {
      // Invalid format and not a placeholder - try to fix or use placeholder
      const cleaned = updated.accessionNumber.replace(/-/g, '');
      if (cleaned.length === 18 && /^\d+$/.test(cleaned)) {
        updated.accessionNumber = `${cleaned.slice(0, 10)}-${cleaned.slice(10, 12)}-${cleaned.slice(12, 18)}`;
        changes.push(`Fixed accessionNumber format: ${updated.accessionNumber}`);
      } else {
        updated.accessionNumber = '0000000000-00-000000';
        changes.push('Replaced invalid accessionNumber with placeholder');
      }
    }
  }

  // Add missing filingDate - use createdAt as best guess
  if (!updated.filingDate) {
    updated.filingDate = createdAt.toISOString().split('T')[0];
    changes.push(`Added filingDate from createdAt: ${updated.filingDate}`);
  }

  // Add missing reportDate - use filingDate as best guess
  if (!updated.reportDate) {
    updated.reportDate = updated.filingDate;
    changes.push(`Added reportDate (same as filingDate): ${updated.reportDate}`);
  }

  // Add missing processed field
  if (typeof updated.processed !== 'boolean') {
    // If processedAt exists, assume it's processed
    // Otherwise, assume processed=true for records with data
    updated.processed = !!updated.processedAt || !isLegacyRecord;
    changes.push(`Added processed: ${updated.processed}`);
  }

  // Add missing downloadedAt field
  if (!updated.downloadedAt) {
    // Use createdAt as the download timestamp
    updated.downloadedAt = createdAt.toISOString();
    changes.push(`Added downloadedAt from createdAt: ${updated.downloadedAt}`);
  }

  // Ensure ticker is uppercase
  if (updated.ticker && updated.ticker !== updated.ticker.toUpperCase()) {
    updated.ticker = updated.ticker.toUpperCase();
    changes.push(`Normalized ticker to uppercase: ${updated.ticker}`);
  }

  return { updated, changes };
}

/**
 * Main migration function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('SEC FILING METADATA MIGRATION');
  console.log('='.repeat(80));
  console.log();

  if (isDryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  } else {
    console.log('⚠️  LIVE MODE - Records will be updated\n');
  }

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
      console.log('✅ No records to migrate.');
      return;
    }

    const results = {
      total: secFilings.length,
      migrated: 0,
      skipped: 0,
      errors: 0,
      records: [],
    };

    // Process each record
    for (const filing of secFilings) {
      try {
        const { updated, changes } = await migrateMetadata(
          filing.metadata,
          filing.id,
          filing.sourceId,
          filing.createdAt
        );

        if (changes.length === 0) {
          results.skipped++;
          continue;
        }

        results.records.push({
          id: filing.id,
          sourceId: filing.sourceId,
          changes,
          before: filing.metadata,
          after: updated,
        });

        if (!isDryRun) {
          // Update the record
          await prisma.dataSource.update({
            where: { id: filing.id },
            data: { metadata: updated },
          });
        }

        results.migrated++;
      } catch (error) {
        console.error(`Error migrating record ${filing.id}:`, error.message);
        results.errors++;
      }
    }

    // Print summary
    console.log('='.repeat(80));
    console.log('MIGRATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total records:    ${results.total}`);
    console.log(`Migrated:         ${results.migrated} (${((results.migrated / results.total) * 100).toFixed(1)}%)`);
    console.log(`Skipped:          ${results.skipped} (${((results.skipped / results.total) * 100).toFixed(1)}%)`);
    console.log(`Errors:           ${results.errors}`);
    console.log('='.repeat(80));
    console.log();

    // Print details of migrated records (first 10)
    if (results.migrated > 0) {
      console.log('MIGRATED RECORDS (showing first 10):');
      console.log('='.repeat(80));

      const recordsToShow = results.records.slice(0, 10);

      for (const record of recordsToShow) {
        console.log(`\nRecord ID: ${record.id}`);
        console.log(`Source ID: ${record.sourceId}`);
        console.log(`Changes:`);
        for (const change of record.changes) {
          console.log(`  ✓ ${change}`);
        }
        console.log();
      }

      if (results.records.length > 10) {
        console.log(`... and ${results.records.length - 10} more records\n`);
      }

      if (isDryRun) {
        console.log('🔍 This was a DRY RUN. No changes were made.');
        console.log('Run without --dry-run to apply changes.');
      } else {
        console.log('✅ Migration complete! All records updated.');
        console.log('\nVerify the migration:');
        console.log('  node scripts/check-sec-filing-metadata-compliance.js');
      }
    } else {
      console.log('✅ All records are already compliant. No migration needed.');
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
