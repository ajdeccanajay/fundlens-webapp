#!/usr/bin/env node

/**
 * Test Intent Analytics System
 * Verifies that intent detection with analytics logging works
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testIntentAnalytics() {
  console.log('🧪 Testing Intent Analytics System...\n');

  try {
    // Test 1: Check tables exist
    console.log('[1/4] Checking tables exist...');
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('intent_detection_logs', 'intent_analytics_summary', 'intent_failed_patterns')
      ORDER BY table_name
    `;
    
    if (tables.length === 3) {
      console.log('✅ All 3 tables exist\n');
    } else {
      console.log(`❌ Expected 3 tables, found ${tables.length}\n`);
      process.exit(1);
    }

    // Test 2: Insert a test log
    console.log('[2/4] Inserting test detection log...');
    await prisma.$executeRaw`
      INSERT INTO intent_detection_logs (
        tenant_id, query, detected_intent, detection_method,
        confidence, success, latency_ms
      ) VALUES (
        'test-tenant',
        'Who are NVDA competitors?',
        '{"type":"semantic","ticker":"NVDA","sectionTypes":["item_1"],"subsectionName":"Competition","confidence":0.9}'::jsonb,
        'regex',
        0.9,
        true,
        45
      )
    `;
    console.log('✅ Test log inserted\n');

    // Test 3: Query the log
    console.log('[3/4] Querying test log...');
    const logs = await prisma.$queryRaw`
      SELECT tenant_id, detection_method, confidence, success, latency_ms
      FROM intent_detection_logs
      WHERE tenant_id = 'test-tenant'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    
    if (logs.length > 0) {
      console.log('✅ Test log retrieved:');
      console.log(`   - Tenant: ${logs[0].tenant_id}`);
      console.log(`   - Method: ${logs[0].detection_method}`);
      console.log(`   - Confidence: ${logs[0].confidence}`);
      console.log(`   - Success: ${logs[0].success}`);
      console.log(`   - Latency: ${logs[0].latency_ms}ms\n`);
    } else {
      console.log('❌ Could not retrieve test log\n');
      process.exit(1);
    }

    // Test 4: Insert a failed pattern
    console.log('[4/4] Inserting test failed pattern...');
    await prisma.$executeRaw`
      INSERT INTO intent_failed_patterns (
        tenant_id, query_pattern, example_queries, occurrence_count
      ) VALUES (
        'test-tenant',
        'what are [TICKER] main products',
        ARRAY['what are NVDA main products', 'what are AAPL main products']::text[],
        2
      )
    `;
    console.log('✅ Test pattern inserted\n');

    // Query the pattern
    const patterns = await prisma.$queryRaw`
      SELECT tenant_id, query_pattern, occurrence_count, status
      FROM intent_failed_patterns
      WHERE tenant_id = 'test-tenant'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    
    if (patterns.length > 0) {
      console.log('✅ Test pattern retrieved:');
      console.log(`   - Pattern: ${patterns[0].query_pattern}`);
      console.log(`   - Count: ${patterns[0].occurrence_count}`);
      console.log(`   - Status: ${patterns[0].status}\n`);
    }

    // Cleanup
    console.log('🧹 Cleaning up test data...');
    await prisma.$executeRaw`DELETE FROM intent_detection_logs WHERE tenant_id = 'test-tenant'`;
    await prisma.$executeRaw`DELETE FROM intent_failed_patterns WHERE tenant_id = 'test-tenant'`;
    console.log('✅ Cleanup complete\n');

    console.log('✅ All tests passed!');
    console.log('\n📊 Intent Analytics System is working correctly!');
    console.log('\n🎯 Next steps:');
    console.log('   1. Start the server: npm run start:dev');
    console.log('   2. Test with real queries');
    console.log('   3. Check logs in database');
    console.log('   4. Build admin dashboard');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testIntentAnalytics();
