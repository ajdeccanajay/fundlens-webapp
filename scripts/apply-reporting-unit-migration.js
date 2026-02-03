#!/usr/bin/env node

/**
 * Apply the reporting_unit migration to the database
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Applying reporting_unit migration...\n');

  try {
    // Add the column if it doesn't exist
    await prisma.$executeRawUnsafe(`
      ALTER TABLE financial_metrics 
      ADD COLUMN IF NOT EXISTS reporting_unit VARCHAR(20) DEFAULT 'units'
    `);
    console.log('✅ Added reporting_unit column');

    // Create index if it doesn't exist
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_financial_metrics_reporting_unit 
      ON financial_metrics(ticker, reporting_unit)
    `);
    console.log('✅ Created index on reporting_unit');

    // Add comment
    await prisma.$executeRawUnsafe(`
      COMMENT ON COLUMN financial_metrics.reporting_unit IS 
      'Original reporting scale from SEC filing: units, thousands, millions, billions. Extracted from iXBRL scale attribute.'
    `);
    console.log('✅ Added column comment');

    // Verify the column exists
    const result = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'financial_metrics' AND column_name = 'reporting_unit'
    `);
    
    if (result.length > 0) {
      console.log('\n✅ Migration successful!');
      console.log('Column details:', result[0]);
    } else {
      console.log('\n❌ Column not found after migration');
    }

  } catch (error) {
    console.error('Migration error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
