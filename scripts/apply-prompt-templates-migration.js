#!/usr/bin/env node

/**
 * Apply prompt_templates migration
 * Creates the prompt_templates table and inserts initial prompts
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function applyMigration() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Read migration file
    const migrationPath = path.join(
      __dirname,
      '../prisma/migrations/20260204_add_prompt_templates.sql',
    );
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📝 Applying migration: 20260204_add_prompt_templates.sql');

    // Execute migration
    await client.query(migrationSQL);

    console.log('✅ Migration applied successfully');

    // Verify table was created
    const result = await client.query(`
      SELECT COUNT(*) as count
      FROM prompt_templates
    `);

    console.log(`✅ Verified: ${result.rows[0].count} prompts inserted`);

    // Show inserted prompts
    const prompts = await client.query(`
      SELECT intent_type, version, active
      FROM prompt_templates
      ORDER BY intent_type, version
    `);

    console.log('\n📋 Inserted prompts:');
    prompts.rows.forEach((row) => {
      console.log(
        `  - ${row.intent_type} v${row.version} ${row.active ? '(active)' : ''}`,
      );
    });
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

// Run migration
applyMigration()
  .then(() => {
    console.log('\n✅ Prompt templates migration complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });
