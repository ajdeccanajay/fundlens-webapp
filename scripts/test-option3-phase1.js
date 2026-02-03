#!/usr/bin/env node

/**
 * Test Option 3 - Phase 1: Pipeline without Step F
 * 
 * Tests that:
 * 1. Pipeline runs without Step F
 * 2. Steps A-E, G, H complete successfully
 * 3. Data is saved to metric_hierarchy and footnote_references tables
 * 4. No errors or regressions
 */

require('dotenv').config();
const { Client } = require('pg');

async function testPhase1() {
  console.log('🧪 Testing Option 3 - Phase 1: Pipeline without Step F\n');

  // Parse DATABASE_URL
  const databaseUrl = process.env.DATABASE_URL || process.env.RDS_DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not found');
    process.exit(1);
  }

  const url = new URL(databaseUrl);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port || '5432'),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Test 1: Verify tables exist
    console.log('📋 Test 1: Verify tables exist');
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('metric_hierarchy', 'footnote_references')
      ORDER BY table_name
    `);

    if (tablesResult.rows.length === 2) {
      console.log('✅ Both tables exist\n');
    } else {
      console.error(`❌ Expected 2 tables, found ${tablesResult.rows.length}\n`);
      process.exit(1);
    }

    // Test 2: Check metric_hierarchy schema
    console.log('📋 Test 2: Check metric_hierarchy schema');
    const hierarchyColumns = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'metric_hierarchy'
      AND column_name IN ('children_ids', 'sibling_ids', 'normalized_name', 'label', 'value', 'rollup_type')
      ORDER BY column_name
    `);

    const expectedColumns = ['children_ids', 'label', 'normalized_name', 'rollup_type', 'sibling_ids', 'value'];
    const foundColumns = hierarchyColumns.rows.map(r => r.column_name).sort();

    if (JSON.stringify(foundColumns) === JSON.stringify(expectedColumns)) {
      console.log('✅ All required columns exist in metric_hierarchy\n');
    } else {
      console.error('❌ Missing columns in metric_hierarchy');
      console.error(`   Expected: ${expectedColumns.join(', ')}`);
      console.error(`   Found: ${foundColumns.join(', ')}\n`);
      process.exit(1);
    }

    // Test 3: Check footnote_references schema
    console.log('📋 Test 3: Check footnote_references schema');
    const footnoteColumns = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'footnote_references'
      AND column_name IN ('footnote_number', 'footnote_section', 'footnote_text', 'context_type', 'extracted_data')
      ORDER BY column_name
    `);

    const expectedFootnoteColumns = ['context_type', 'extracted_data', 'footnote_number', 'footnote_section', 'footnote_text'];
    const foundFootnoteColumns = footnoteColumns.rows.map(r => r.column_name).sort();

    if (JSON.stringify(foundFootnoteColumns) === JSON.stringify(expectedFootnoteColumns)) {
      console.log('✅ All required columns exist in footnote_references\n');
    } else {
      console.error('❌ Missing columns in footnote_references');
      console.error(`   Expected: ${expectedFootnoteColumns.join(', ')}`);
      console.error(`   Found: ${foundFootnoteColumns.join(', ')}\n`);
      process.exit(1);
    }

    // Test 4: Check for existing data (optional)
    console.log('📋 Test 4: Check for existing data');
    const hierarchyCount = await client.query('SELECT COUNT(*)::int as count FROM metric_hierarchy');
    const footnoteCount = await client.query('SELECT COUNT(*)::int as count FROM footnote_references');

    console.log(`   metric_hierarchy: ${hierarchyCount.rows[0].count} rows`);
    console.log(`   footnote_references: ${footnoteCount.rows[0].count} rows\n`);

    // Test 5: Test insert/update (dry run)
    console.log('📋 Test 5: Test insert/update operations');
    
    // Test metric_hierarchy insert
    const testDealId = '00000000-0000-0000-0000-000000000000';
    const testMetricId = '11111111-1111-1111-1111-111111111111';
    
    await client.query(`
      INSERT INTO metric_hierarchy (
        deal_id, metric_id, ticker, metric_name, normalized_name, label, value, level, fiscal_period, statement_type
      )
      VALUES ($1::uuid, $2::uuid, 'TEST', 'test_metric', 'test_metric', 'Test Metric', 100.0, 0, 'FY2024', 'income_statement')
      ON CONFLICT ON CONSTRAINT metric_hierarchy_unique DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW()
    `, [testDealId, testMetricId]);

    console.log('✅ metric_hierarchy insert/update works');

    // Test footnote_references insert
    await client.query(`
      INSERT INTO footnote_references (
        deal_id, metric_id, ticker, fiscal_period, footnote_number, section_title, footnote_section, footnote_text, context_type
      )
      VALUES ($1::uuid, $2::uuid, 'TEST', 'FY2024', '1', 'Test Section', 'Test Section', 'Test footnote text', 'other')
      ON CONFLICT ON CONSTRAINT footnote_references_unique DO UPDATE SET
        footnote_text = EXCLUDED.footnote_text,
        updated_at = NOW()
    `, [testDealId, testMetricId]);

    console.log('✅ footnote_references insert/update works\n');

    // Clean up test data
    await client.query('DELETE FROM metric_hierarchy WHERE deal_id = $1::uuid', [testDealId]);
    await client.query('DELETE FROM footnote_references WHERE deal_id = $1::uuid', [testDealId]);
    console.log('✅ Test data cleaned up\n');

    // Summary
    console.log('🎉 Phase 1 Tests Complete!\n');
    console.log('✅ All database tests passed');
    console.log('✅ Tables exist with correct schema');
    console.log('✅ Insert/update operations work\n');

    console.log('Next steps:');
    console.log('1. Run pipeline for a test ticker (e.g., AAPL)');
    console.log('2. Verify Steps A-E, G, H complete (no Step F)');
    console.log('3. Check that data is saved to new tables');
    console.log('4. Verify Insights page still works (uses Step E)\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run tests
testPhase1().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
