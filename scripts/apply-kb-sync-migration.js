#!/usr/bin/env node
/**
 * Apply KB Sync Tracking Migration
 * Creates the kb_sync_status table for tracking which tickers have been synced to Bedrock KB
 */

const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 
  'postgresql://fundlens_admin:FundLens2025SecureDB@fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db?sslmode=no-verify';

async function applyMigration() {
  const client = new Client({ connectionString: DATABASE_URL });
  
  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Create kb_sync_status table
    console.log('Creating kb_sync_status table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS kb_sync_status (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticker VARCHAR(20) NOT NULL,
        chunks_in_s3 INTEGER NOT NULL DEFAULT 0,
        chunks_in_rds INTEGER NOT NULL DEFAULT 0,
        last_s3_upload_at TIMESTAMP WITH TIME ZONE,
        last_kb_sync_at TIMESTAMP WITH TIME ZONE,
        kb_sync_job_id VARCHAR(100),
        kb_sync_status VARCHAR(50) DEFAULT 'pending',
        needs_kb_sync BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(ticker)
      )
    `);
    console.log('✅ kb_sync_status table created');

    // Create indexes
    console.log('Creating indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_kb_sync_status_ticker ON kb_sync_status(ticker)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_kb_sync_status_needs_sync ON kb_sync_status(needs_kb_sync)
    `);
    console.log('✅ Indexes created');

    // Create kb_batch_sync table
    console.log('Creating kb_batch_sync table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS kb_batch_sync (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id VARCHAR(100) NOT NULL,
        tickers TEXT[] NOT NULL,
        status VARCHAR(50) DEFAULT 'in_progress',
        documents_scanned INTEGER DEFAULT 0,
        documents_indexed INTEGER DEFAULT 0,
        documents_failed INTEGER DEFAULT 0,
        started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE,
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    console.log('✅ kb_batch_sync table created');

    // Create indexes for kb_batch_sync
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_kb_batch_sync_job_id ON kb_batch_sync(job_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_kb_batch_sync_status ON kb_batch_sync(status)
    `);
    console.log('✅ kb_batch_sync indexes created');

    // Pre-populate with existing synced tickers (those that have chunks in S3)
    // We'll mark all existing tickers as synced since they're already in KB
    console.log('Pre-populating kb_sync_status with existing tickers...');
    const result = await client.query(`
      INSERT INTO kb_sync_status (ticker, chunks_in_s3, chunks_in_rds, kb_sync_status, needs_kb_sync, last_kb_sync_at)
      SELECT 
        ticker,
        COUNT(*) as chunks_in_s3,
        COUNT(*) as chunks_in_rds,
        'synced' as kb_sync_status,
        false as needs_kb_sync,
        NOW() as last_kb_sync_at
      FROM narrative_chunks
      GROUP BY ticker
      ON CONFLICT (ticker) DO NOTHING
    `);
    console.log(`✅ Pre-populated ${result.rowCount} tickers as already synced`);

    // Show summary
    const summary = await client.query(`
      SELECT 
        COUNT(*) as total_tickers,
        SUM(chunks_in_s3) as total_chunks,
        COUNT(*) FILTER (WHERE kb_sync_status = 'synced') as synced_tickers
      FROM kb_sync_status
    `);
    console.log('\n📊 Summary:');
    console.log(`   Total tickers tracked: ${summary.rows[0].total_tickers}`);
    console.log(`   Total chunks: ${summary.rows[0].total_chunks}`);
    console.log(`   Synced tickers: ${summary.rows[0].synced_tickers}`);

    console.log('\n✅ Migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration();
