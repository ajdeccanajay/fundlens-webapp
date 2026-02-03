#!/usr/bin/env node

/**
 * Apply Research Assistant Migration using pg client
 * Handles multi-statement SQL properly
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function applyMigration() {
  console.log('🔧 Applying Research Assistant Migration...\n');

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');
    console.log('');

    // Read migration SQL
    const migrationPath = path.join(__dirname, '../prisma/migrations/add_research_assistant_schema_simple.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded');
    console.log(`   Size: ${(sql.length / 1024).toFixed(2)} KB`);
    console.log('');

    // Execute the entire SQL
    console.log('🚀 Executing migration...');
    await client.query(sql);
    
    console.log('✅ Migration executed successfully');
    console.log('');

    // Verify tables exist
    console.log('🔍 Verifying tables...');
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
        AND (table_name LIKE 'research_%'
          OR table_name = 'ic_memos'
          OR table_name = 'user_preferences'
          OR table_name = 'conversation_shares'
          OR table_name = 'conversation_templates')
      ORDER BY table_name
    `);

    if (result.rows.length > 0) {
      console.log(`✅ Found ${result.rows.length} tables:`);
      result.rows.forEach(row => console.log(`   - ${row.table_name}`));
    } else {
      console.log('⚠️  No tables found');
    }

    console.log('');
    console.log('✅ Migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration();
