#!/usr/bin/env node
/**
 * Apply the extracted_metrics table migration.
 * Uses the pg library directly since psql is not available.
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.RDS_DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL or RDS_DATABASE_URL not set');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Read migration SQL
    const sqlPath = path.join(__dirname, '..', 'prisma', 'migrations', '20260226_add_extracted_metrics_table.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    console.log('Applying extracted_metrics migration...');
    await client.query(sql);
    console.log('✅ Migration applied successfully');

    // Verify table exists
    const result = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'extracted_metrics'
      ORDER BY ordinal_position
    `);
    console.log(`\nTable columns (${result.rows.length}):`);
    for (const row of result.rows) {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    }

    // Check row count
    const countResult = await client.query('SELECT COUNT(*) FROM extracted_metrics');
    console.log(`\nRow count: ${countResult.rows[0].count}`);

  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
