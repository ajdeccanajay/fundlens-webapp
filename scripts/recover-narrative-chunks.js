#!/usr/bin/env node
/**
 * Narrative Chunks Recovery Script
 * 
 * Fixes the critical bug where chunks from different filings were overwriting each other
 * due to missing filing_date in the unique constraint.
 * 
 * Usage:
 *   node scripts/recover-narrative-chunks.js --phase=1  # Schema migration only
 *   node scripts/recover-narrative-chunks.js --phase=2  # Clear affected data
 *   node scripts/recover-narrative-chunks.js --phase=3  # Re-ingest (requires ECS)
 *   node scripts/recover-narrative-chunks.js --phase=all # Full recovery
 *   node scripts/recover-narrative-chunks.js --validate  # Validate current state
 */

const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 
  'postgresql://fundlens_admin:FundLens2025SecureDB@fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db?sslmode=no-verify';

const PRODUCTION_ALB = 'https://fundlens-production-alb-931926615.us-east-1.elb.amazonaws.com';
const ADMIN_KEY = process.env.ADMIN_KEY || 'c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06';

// Companies that need re-ingestion (>10% data loss)
const AFFECTED_COMPANIES = ['INTC', 'CMCSA', 'NFLX', 'T', 'BA', 'VZ', 'PEP', 'GS', 'WMT'];

async function getClient() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  return client;
}

async function validateCurrentState() {
  console.log('📊 Validating current database state...\n');
  const client = await getClient();
  
  try {
    // Check if filing_date column exists
    const columnCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'narrative_chunks' AND column_name = 'filing_date'
    `);
    const hasFilingDate = columnCheck.rows.length > 0;
    console.log(`✓ filing_date column exists: ${hasFilingDate ? 'YES' : 'NO'}`);
    
    // Check unique constraint
    const constraintCheck = await client.query(`
      SELECT indexname FROM pg_indexes 
      WHERE tablename = 'narrative_chunks' 
      AND indexdef LIKE '%filing_date%' 
      AND indexdef LIKE '%UNIQUE%'
    `);
    const hasConstraint = constraintCheck.rows.length > 0;
    console.log(`✓ Unique constraint with filing_date: ${hasConstraint ? 'YES' : 'NO'}`);
    
    // Get chunk stats
    const stats = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM narrative_chunks) as total_chunks,
        (SELECT SUM(chunks_count) FROM filing_metadata WHERE processed = true) as expected_chunks
    `);
    const { total_chunks, expected_chunks } = stats.rows[0];
    const missing = parseInt(expected_chunks) - parseInt(total_chunks);
    const pctComplete = ((parseInt(total_chunks) / parseInt(expected_chunks)) * 100).toFixed(1);
    
    console.log(`\n📈 Chunk Statistics:`);
    console.log(`   Total chunks: ${total_chunks}`);
    console.log(`   Expected chunks: ${expected_chunks}`);
    console.log(`   Missing chunks: ${missing}`);
    console.log(`   Completion: ${pctComplete}%`);
    
    // Per-company breakdown for affected companies
    const companyStats = await client.query(`
      SELECT 
        fm.ticker,
        SUM(fm.chunks_count) as expected,
        COALESCE(nc.actual, 0) as actual,
        SUM(fm.chunks_count) - COALESCE(nc.actual, 0) as missing
      FROM filing_metadata fm
      LEFT JOIN (SELECT ticker, COUNT(*) as actual FROM narrative_chunks GROUP BY ticker) nc 
        ON fm.ticker = nc.ticker
      WHERE fm.ticker = ANY($1) AND fm.processed = true
      GROUP BY fm.ticker, nc.actual
      ORDER BY missing DESC
    `, [AFFECTED_COMPANIES]);
    
    console.log(`\n📋 Affected Companies Status:`);
    console.table(companyStats.rows);
    
    return { hasFilingDate, hasConstraint, total_chunks, expected_chunks, missing };
  } finally {
    await client.end();
  }
}

async function phase1_schemaMigration() {
  console.log('\n🔧 Phase 1: Schema Migration\n');
  const client = await getClient();
  
  try {
    // Step 1: Add filing_date column if not exists
    console.log('1. Adding filing_date column...');
    await client.query(`
      ALTER TABLE narrative_chunks 
      ADD COLUMN IF NOT EXISTS filing_date TIMESTAMP
    `);
    console.log('   ✓ Column added');
    
    // Step 2: Backfill from filing_metadata
    console.log('2. Backfilling filing_date from filing_metadata...');
    const backfillResult = await client.query(`
      UPDATE narrative_chunks nc
      SET filing_date = fm.filing_date
      FROM filing_metadata fm
      WHERE nc.ticker = fm.ticker 
        AND nc.filing_type = fm.filing_type
        AND nc.filing_date IS NULL
    `);
    console.log(`   ✓ Updated ${backfillResult.rowCount} rows`);
    
    // Step 3: Set default for remaining
    console.log('3. Setting default for remaining rows...');
    const defaultResult = await client.query(`
      UPDATE narrative_chunks
      SET filing_date = created_at
      WHERE filing_date IS NULL
    `);
    console.log(`   ✓ Updated ${defaultResult.rowCount} rows with default`);
    
    // Step 4: Make NOT NULL
    console.log('4. Making filing_date NOT NULL...');
    await client.query(`
      ALTER TABLE narrative_chunks 
      ALTER COLUMN filing_date SET NOT NULL
    `);
    console.log('   ✓ Column is now NOT NULL');
    
    // Step 5: Create unique constraint
    console.log('5. Creating unique constraint...');
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS 
        narrative_chunks_ticker_filing_type_filing_date_section_type_chunk_index_key
      ON narrative_chunks (ticker, filing_type, filing_date, section_type, chunk_index)
    `);
    console.log('   ✓ Unique constraint created');
    
    // Step 6: Add index for efficient queries
    console.log('6. Adding index for ticker + filing_date...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS narrative_chunks_ticker_filing_date_idx
      ON narrative_chunks (ticker, filing_date)
    `);
    console.log('   ✓ Index created');
    
    console.log('\n✅ Phase 1 Complete: Schema migration successful');
  } catch (error) {
    console.error('❌ Phase 1 Failed:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

async function phase2_clearAffectedData() {
  console.log('\n🗑️  Phase 2: Clear Affected Data\n');
  const client = await getClient();
  
  try {
    // Step 1: Delete chunks for affected companies
    console.log(`1. Deleting chunks for affected companies: ${AFFECTED_COMPANIES.join(', ')}...`);
    const deleteResult = await client.query(`
      DELETE FROM narrative_chunks 
      WHERE ticker = ANY($1)
    `, [AFFECTED_COMPANIES]);
    console.log(`   ✓ Deleted ${deleteResult.rowCount} chunks`);
    
    // Step 2: Reset filing_metadata processed flag
    console.log('2. Resetting filing_metadata for affected companies...');
    const resetResult = await client.query(`
      UPDATE filing_metadata 
      SET processed = false, chunks_count = 0 
      WHERE ticker = ANY($1)
    `, [AFFECTED_COMPANIES]);
    console.log(`   ✓ Reset ${resetResult.rowCount} filing records`);
    
    // Step 3: Clear qualitative cache for affected companies
    console.log('3. Clearing qualitative cache for affected companies...');
    const cacheResult = await client.query(`
      DELETE FROM qualitative_cache 
      WHERE ticker = ANY($1)
    `, [AFFECTED_COMPANIES]);
    console.log(`   ✓ Cleared ${cacheResult.rowCount} cache entries`);
    
    console.log('\n✅ Phase 2 Complete: Affected data cleared');
  } catch (error) {
    console.error('❌ Phase 2 Failed:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

async function phase3_reingest() {
  console.log('\n🔄 Phase 3: Re-ingest Affected Companies\n');
  console.log('This phase requires the updated code to be deployed to ECS first.');
  console.log('Run the following commands to deploy:\n');
  console.log('  docker build --platform linux/amd64 -t fundlens-backend .');
  console.log('  docker tag fundlens-backend:latest 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-backend:latest');
  console.log('  aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 588082972864.dkr.ecr.us-east-1.amazonaws.com');
  console.log('  docker push 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-backend:latest');
  console.log('  aws ecs update-service --cluster fundlens-production --service fundlens-production-service --force-new-deployment\n');
  
  console.log('Then trigger re-ingestion via the API:');
  
  // Split into batches of 3
  const batches = [];
  for (let i = 0; i < AFFECTED_COMPANIES.length; i += 3) {
    batches.push(AFFECTED_COMPANIES.slice(i, i + 3));
  }
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`\n# Batch ${i + 1}: ${batch.join(', ')}`);
    console.log(`curl -X POST "${PRODUCTION_ALB}/api/sec/pipeline/batch" \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -H "x-admin-key: ${ADMIN_KEY}" \\`);
    console.log(`  -d '{`);
    console.log(`    "companies": ${JSON.stringify(batch)},`);
    console.log(`    "years": [2020, 2021, 2022, 2023, 2024, 2025],`);
    console.log(`    "filingTypes": ["10-K", "10-Q", "8-K"],`);
    console.log(`    "skipExisting": false,`);
    console.log(`    "syncToKnowledgeBase": true`);
    console.log(`  }'`);
  }
  
  console.log('\n# After all batches complete, sync to Bedrock KB:');
  console.log(`curl -X POST "${PRODUCTION_ALB}/api/kb-sync/full-sync-all" \\`);
  console.log(`  -H "x-admin-key: ${ADMIN_KEY}"`);
}

async function main() {
  const args = process.argv.slice(2);
  const phase = args.find(a => a.startsWith('--phase='))?.split('=')[1];
  const validate = args.includes('--validate');
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('       NARRATIVE CHUNKS RECOVERY SCRIPT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);
  console.log(`Affected Companies: ${AFFECTED_COMPANIES.join(', ')}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (validate || !phase) {
    await validateCurrentState();
  }
  
  if (phase === '1' || phase === 'all') {
    await phase1_schemaMigration();
  }
  
  if (phase === '2' || phase === 'all') {
    await phase2_clearAffectedData();
  }
  
  if (phase === '3' || phase === 'all') {
    await phase3_reingest();
  }
  
  if (!phase && !validate) {
    console.log('\nUsage:');
    console.log('  node scripts/recover-narrative-chunks.js --validate     # Check current state');
    console.log('  node scripts/recover-narrative-chunks.js --phase=1      # Schema migration');
    console.log('  node scripts/recover-narrative-chunks.js --phase=2      # Clear affected data');
    console.log('  node scripts/recover-narrative-chunks.js --phase=3      # Show re-ingest commands');
    console.log('  node scripts/recover-narrative-chunks.js --phase=all    # Run all phases');
  }
}

main().catch(console.error);
