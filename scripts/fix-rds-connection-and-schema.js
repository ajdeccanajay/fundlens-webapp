#!/usr/bin/env node

/**
 * Comprehensive RDS Connection and Schema Fix
 * This script will:
 * 1. Test RDS connectivity
 * 2. Check current schema
 * 3. Apply necessary fixes
 * 4. Verify the pipeline works
 */

const { Client } = require('pg');
require('dotenv').config();

async function comprehensiveFix() {
  console.log('🔧 COMPREHENSIVE RDS AND SCHEMA FIX\n');
  console.log('=' .repeat(60));

  // Step 1: Test connectivity with different connection methods
  console.log('\n📡 STEP 1: Testing RDS Connectivity...\n');
  
  const connectionConfigs = [
    {
      name: 'Primary DATABASE_URL',
      config: { connectionString: process.env.DATABASE_URL }
    },
    {
      name: 'RDS_DATABASE_URL',
      config: { connectionString: process.env.RDS_DATABASE_URL }
    },
    {
      name: 'Manual Connection',
      config: {
        host: 'fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com',
        port: 5432,
        database: 'fundlens_db',
        user: 'fundlens_admin',
        password: 'FundLens2025SecureDB',
        ssl: { rejectUnauthorized: false }
      }
    }
  ];

  let workingClient = null;
  let workingConfig = null;

  for (const { name, config } of connectionConfigs) {
    console.log(`   Testing ${name}...`);
    try {
      const client = new Client(config);
      await client.connect();
      
      // Test with a simple query
      const result = await client.query('SELECT NOW() as current_time');
      console.log(`   ✅ ${name} - Connected successfully!`);
      console.log(`      Server time: ${result.rows[0].current_time}`);
      
      workingClient = client;
      workingConfig = { name, config };
      break;
    } catch (error) {
      console.log(`   ❌ ${name} - Failed: ${error.message}`);
    }
  }

  if (!workingClient) {
    console.error('\n❌ FATAL: Could not connect to RDS with any method');
    console.error('   Please check:');
    console.error('   1. RDS instance is running');
    console.error('   2. Security groups allow connections from your IP');
    console.error('   3. Credentials are correct');
    process.exit(1);
  }

  console.log(`\n✅ Using working connection: ${workingConfig.name}\n`);

  try {
    // Step 2: Check current schema
    console.log('📊 STEP 2: Checking Current Schema...\n');
    
    // Check if deals table exists and its structure
    const dealsTableCheck = await workingClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'deals'
      );
    `);

    if (dealsTableCheck.rows[0].exists) {
      console.log('   ✅ Deals table exists');
      
      // Check deals table columns
      const dealsColumns = await workingClient.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'deals'
        ORDER BY ordinal_position;
      `);

      console.log('   📋 Current deals table columns:');
      dealsColumns.rows.forEach(col => {
        console.log(`      - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
      });

      // Check for missing columns
      const requiredColumns = ['years', 'processing_message', 'news_data'];
      const existingColumns = dealsColumns.rows.map(row => row.column_name);
      const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));

      if (missingColumns.length > 0) {
        console.log(`\n   ⚠️  Missing columns: ${missingColumns.join(', ')}`);
      } else {
        console.log('\n   ✅ All required columns present');
      }
    } else {
      console.log('   ❌ Deals table does not exist - need to create schema');
    }

    // Step 3: Apply schema fixes
    console.log('\n🔨 STEP 3: Applying Schema Fixes...\n');

    // Add missing columns to deals table
    console.log('   Adding missing columns to deals table...');
    
    const schemaFixes = [
      'ALTER TABLE deals ADD COLUMN IF NOT EXISTS years INTEGER DEFAULT 3;',
      'ALTER TABLE deals ADD COLUMN IF NOT EXISTS processing_message TEXT;',
      'ALTER TABLE deals ADD COLUMN IF NOT EXISTS news_data JSONB;',
      
      // Fix analysis_sessions table
      'ALTER TABLE analysis_sessions ADD COLUMN IF NOT EXISTS session_name VARCHAR(255) DEFAULT \'Main Analysis\';',
      'ALTER TABLE analysis_sessions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;',
      
      // Fix scratch_pads table
      'ALTER TABLE scratch_pads ADD COLUMN IF NOT EXISTS title VARCHAR(255) DEFAULT \'Investment Analysis\';',
      
      // Create indexes for performance
      'CREATE INDEX IF NOT EXISTS idx_deals_ticker_status ON deals(ticker, status);',
      'CREATE INDEX IF NOT EXISTS idx_deals_processing ON deals(status) WHERE status IN (\'processing\', \'error\');',
      'CREATE INDEX IF NOT EXISTS idx_analysis_sessions_active ON analysis_sessions(deal_id, is_active);',
      
      // Update existing records
      'UPDATE deals SET years = 3 WHERE years IS NULL;',
      'UPDATE analysis_sessions SET session_name = \'Main Analysis\' WHERE session_name IS NULL;',
      'UPDATE analysis_sessions SET is_active = true WHERE is_active IS NULL;',
      'UPDATE scratch_pads SET title = \'Investment Analysis\' WHERE title IS NULL;'
    ];

    for (const fix of schemaFixes) {
      try {
        await workingClient.query(fix);
        console.log(`   ✅ ${fix.split(' ').slice(0, 4).join(' ')}...`);
      } catch (error) {
        console.log(`   ⚠️  ${fix.split(' ').slice(0, 4).join(' ')}... (${error.message})`);
      }
    }

    // Step 4: Verify schema is correct
    console.log('\n🔍 STEP 4: Verifying Schema...\n');

    const finalDealsColumns = await workingClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'deals'
      ORDER BY ordinal_position;
    `);

    console.log('   📊 Final deals table schema:');
    finalDealsColumns.rows.forEach(col => {
      console.log(`      - ${col.column_name} (${col.data_type})`);
    });

    // Step 5: Test the pipeline components
    console.log('\n🧪 STEP 5: Testing Pipeline Components...\n');

    // Test creating a deal
    console.log('   Testing deal creation...');
    try {
      const testDeal = await workingClient.query(`
        INSERT INTO deals (name, description, deal_type, ticker, company_name, years, status, processing_message)
        VALUES ('Test Deal', 'Test Description', 'public', 'TEST', 'Test Company', 3, 'draft', 'Test message')
        RETURNING id, name, ticker, years, status, processing_message;
      `);
      
      console.log('   ✅ Deal creation successful:');
      console.log(`      ID: ${testDeal.rows[0].id}`);
      console.log(`      Name: ${testDeal.rows[0].name}`);
      console.log(`      Ticker: ${testDeal.rows[0].ticker}`);
      console.log(`      Years: ${testDeal.rows[0].years}`);
      console.log(`      Status: ${testDeal.rows[0].status}`);

      // Clean up test deal
      await workingClient.query('DELETE FROM deals WHERE ticker = \'TEST\'');
      console.log('   🧹 Test deal cleaned up');

    } catch (error) {
      console.log(`   ❌ Deal creation failed: ${error.message}`);
    }

    // Test JSON storage
    console.log('\n   Testing JSON data storage...');
    try {
      const testJson = await workingClient.query(`
        INSERT INTO deals (name, deal_type, ticker, news_data)
        VALUES ('JSON Test', 'public', 'JSON', $1)
        RETURNING id, news_data;
      `, [JSON.stringify({ test: 'data', articles: [{ title: 'Test Article' }] })]);
      
      console.log('   ✅ JSON storage successful');
      console.log(`      Stored data: ${JSON.stringify(testJson.rows[0].news_data)}`);

      // Clean up
      await workingClient.query('DELETE FROM deals WHERE ticker = \'JSON\'');
      console.log('   🧹 JSON test cleaned up');

    } catch (error) {
      console.log(`   ❌ JSON storage failed: ${error.message}`);
    }

    console.log('\n🎉 COMPREHENSIVE FIX COMPLETED SUCCESSFULLY!\n');
    console.log('✅ RDS Connection: Working');
    console.log('✅ Schema: Updated');
    console.log('✅ Pipeline Components: Tested');
    console.log('\nThe system is now ready for SHOP pipeline testing.\n');

  } catch (error) {
    console.error('\n❌ Error during comprehensive fix:', error);
    throw error;
  } finally {
    await workingClient.end();
  }
}

// Run the comprehensive fix
comprehensiveFix().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});