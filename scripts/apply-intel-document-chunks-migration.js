#!/usr/bin/env node
/**
 * Apply intel_document_chunks migration to RDS
 */
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to RDS');

  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'prisma', 'migrations', '20260224_add_intel_document_chunks.sql'),
    'utf-8',
  );

  try {
    await client.query(sql);
    console.log('✅ intel_document_chunks table created');

    // Verify
    const res = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'intel_document_chunks'
      ORDER BY ordinal_position
    `);
    console.log('\nColumns:');
    for (const row of res.rows) {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    }
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
