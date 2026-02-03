#!/usr/bin/env node

/**
 * Apply Schema Fixes to AWS RDS
 * This script applies the necessary schema changes to fix the SHOP pipeline
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function applySchemaFixes() {
  console.log('🔧 Applying schema fixes to AWS RDS...\n');

  // Read connection string from environment
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error('❌ DATABASE_URL not found in environment');
    process.exit(1);
  }

  console.log('📡 Connecting to AWS RDS...');
  console.log(`   Database: ${connectionString.split('@')[1]?.split('/')[0]}\n`);

  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('✅ Connected to AWS RDS\n');

    // Read the migration SQL file
    const migrationPath = path.join(__dirname, '../prisma/migrations/20241221_fix_deal_pipeline_schema.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📝 Applying migration...\n');
    console.log('Migration SQL:');
    console.log('─'.repeat(80));
    console.log(migrationSQL);
    console.log('─'.repeat(80));
    console.log('');

    // Execute the migration
    await client.query(migrationSQL);

    console.log('✅ Migration applied successfully!\n');

    // Verify the changes
    console.log('🔍 Verifying schema changes...\n');

    // Check deals table columns
    const dealsColumns = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'deals'
      ORDER BY ordinal_position;
    `);

    console.log('📊 Deals table columns:');
    dealsColumns.rows.forEach(col => {
      console.log(`   - ${col.column_name} (${col.data_type})`);
    });
    console.log('');

    // Check analysis_sessions table columns
    const sessionsColumns = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'analysis_sessions'
      ORDER BY ordinal_position;
    `);

    console.log('📊 Analysis Sessions table columns:');
    sessionsColumns.rows.forEach(col => {
      console.log(`   - ${col.column_name} (${col.data_type})`);
    });
    console.log('');

    // Check scratch_pads table columns
    const scratchPadsColumns = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'scratch_pads'
      ORDER BY ordinal_position;
    `);

    console.log('📊 Scratch Pads table columns:');
    scratchPadsColumns.rows.forEach(col => {
      console.log(`   - ${col.column_name} (${col.data_type})`);
    });
    console.log('');

    console.log('✅ Schema verification complete!\n');
    console.log('🎉 All schema fixes have been successfully applied to AWS RDS!\n');

  } catch (error) {
    console.error('❌ Error applying schema fixes:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the script
applySchemaFixes().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
