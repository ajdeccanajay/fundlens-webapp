#!/usr/bin/env node

/**
 * Apply Hierarchy and Footnotes Migration
 * 
 * Creates metric_hierarchy and footnote_references tables
 * for Steps G & H of the pipeline.
 */

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function applyMigration() {
  console.log('🔄 Applying hierarchy and footnotes migration...\n');

  // Parse DATABASE_URL
  const databaseUrl = process.env.DATABASE_URL || process.env.RDS_DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL or RDS_DATABASE_URL not found in environment');
    process.exit(1);
  }

  // Extract connection details from URL
  const url = new URL(databaseUrl);
  
  // Database connection
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port || '5432'),
    database: url.pathname.slice(1), // Remove leading /
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false }, // Always use SSL for RDS
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Read migration file
    const migrationPath = path.join(__dirname, '../prisma/migrations/20260202_add_hierarchy_and_footnotes_tables.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Executing migration SQL...\n');
    await client.query(migrationSQL);

    console.log('✅ Migration applied successfully!\n');

    // Verify tables exist
    console.log('🔍 Verifying tables...\n');

    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('metric_hierarchy', 'footnote_references')
      ORDER BY table_name
    `);

    if (tablesResult.rows.length === 2) {
      console.log('✅ Tables verified:');
      tablesResult.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
      console.log();
    } else {
      console.error('❌ Table verification failed');
      console.error(`   Expected 2 tables, found ${tablesResult.rows.length}`);
      process.exit(1);
    }

    // Check indexes
    console.log('🔍 Checking indexes...\n');

    const indexesResult = await client.query(`
      SELECT 
        tablename,
        indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND tablename IN ('metric_hierarchy', 'footnote_references')
      ORDER BY tablename, indexname
    `);

    console.log(`✅ Found ${indexesResult.rows.length} indexes:`);
    indexesResult.rows.forEach(row => {
      console.log(`   - ${row.tablename}.${row.indexname}`);
    });
    console.log();

    console.log('🎉 Migration complete!\n');
    console.log('Next steps:');
    console.log('1. Run pipeline for a test ticker (e.g., AAPL)');
    console.log('2. Verify data is saved to new tables');
    console.log('3. Test API endpoints for hierarchy and footnotes\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run migration
applyMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
