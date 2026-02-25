#!/usr/bin/env node
/**
 * Apply embedding dimension fix: vector(1536) -> vector(1024)
 * Titan V2 returns 1024 dims, not 1536.
 */
const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function main() {
  const dbUrl = process.env.DATABASE_URL.split('?')[0];
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to RDS');

  const sql = fs.readFileSync('prisma/migrations/20260225_fix_embedding_dimensions.sql', 'utf-8');
  const statements = sql.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'));

  for (const stmt of statements) {
    console.log(`Executing: ${stmt.substring(0, 80)}...`);
    await client.query(stmt);
    console.log('  ✅ Done');
  }

  // Verify
  const res = await client.query(`
    SELECT column_name, udt_name, character_maximum_length
    FROM information_schema.columns
    WHERE table_name = 'intel_document_chunks' AND column_name = 'embedding'
  `);
  console.log('\nColumn info:', res.rows[0]);

  // Also check current chunk count
  const chunks = await client.query('SELECT COUNT(*) FROM intel_document_chunks');
  console.log('Current chunks:', chunks.rows[0].count);

  // Clear any existing chunks (they have wrong dimensions)
  if (parseInt(chunks.rows[0].count) > 0) {
    await client.query('DELETE FROM intel_document_chunks');
    console.log('Cleared existing chunks (wrong dimensions)');
    await client.query('UPDATE intel_documents SET chunk_count = 0, processing_mode = \'long-context-fallback\' WHERE chunk_count > 0');
    console.log('Reset document chunk counts');
  }

  await client.end();
  console.log('\n✅ Migration complete');
}

main().catch(e => { console.error(e); process.exit(1); });
