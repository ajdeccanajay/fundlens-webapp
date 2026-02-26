#!/usr/bin/env node
/**
 * Apply pipeline supporting tables migration.
 * Creates: call_analysis, document_flags, model_formulas
 * Adds: intake_summary, kb_sync_status columns to intel_documents
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  require('dotenv').config();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to database');

  const sql = fs.readFileSync(
    path.join(__dirname, '../prisma/migrations/20260226_add_pipeline_supporting_tables.sql'),
    'utf-8',
  );

  try {
    await client.query(sql);
    console.log('Migration applied successfully');

    // Verify tables exist
    const tables = ['call_analysis', 'document_flags', 'model_formulas'];
    for (const t of tables) {
      const res = await client.query(
        `SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_name = $1`,
        [t],
      );
      console.log(`  ${t}: ${res.rows[0].cnt > 0 ? '✅ exists' : '❌ missing'}`);
    }

    // Verify new columns on intel_documents
    const cols = ['intake_summary', 'kb_sync_status', 'kb_ingestion_job_id'];
    for (const c of cols) {
      const res = await client.query(
        `SELECT COUNT(*) as cnt FROM information_schema.columns
         WHERE table_name = 'intel_documents' AND column_name = $1`,
        [c],
      );
      console.log(`  intel_documents.${c}: ${res.rows[0].cnt > 0 ? '✅ exists' : '❌ missing'}`);
    }
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
