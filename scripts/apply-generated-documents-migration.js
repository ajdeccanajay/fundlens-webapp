#!/usr/bin/env node

/**
 * Apply Generated Documents Migration
 * Creates the generated_documents table for IC Memo generation
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function applyMigration() {
  const databaseUrl = process.env.DATABASE_URL || process.env.RDS_DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL or RDS_DATABASE_URL not found in environment');
    process.exit(1);
  }

  console.log('🔗 Connecting to database...');
  const client = new Client({
    connectionString: databaseUrl,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Read migration file
    const migrationPath = path.join(__dirname, '../prisma/migrations/20260203_add_generated_documents.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📝 Applying generated_documents migration...');
    await client.query(migrationSQL);
    console.log('✅ Migration applied successfully');

    // Verify table exists
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'generated_documents'
    `);

    if (result.rows.length > 0) {
      console.log('✅ Table generated_documents created successfully');
      
      // Show table structure
      const columns = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'generated_documents'
        ORDER BY ordinal_position
      `);
      
      console.log('\n📋 Table structure:');
      columns.rows.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : ''}`);
      });
    } else {
      console.error('❌ Table generated_documents not found after migration');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration();
