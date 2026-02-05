#!/usr/bin/env node

/**
 * Apply Intent Analytics Migration - Simple Version
 * Executes each CREATE statement individually
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function applyMigration() {
  console.log('🚀 Applying intent analytics migration...\n');

  try {
    // Create tables
    console.log('[1/12] Creating intent_detection_logs table...');
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS intent_detection_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id VARCHAR(255) NOT NULL,
        query TEXT NOT NULL,
        detected_intent JSONB NOT NULL,
        detection_method VARCHAR(50) NOT NULL,
        confidence DECIMAL(3,2) NOT NULL,
        success BOOLEAN NOT NULL DEFAULT true,
        error_message TEXT,
        latency_ms INTEGER NOT NULL,
        llm_cost_usd DECIMAL(10,6),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    console.log('✅ Success\n');

    console.log('[2/12] Creating indexes for intent_detection_logs...');
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_intent_logs_tenant ON intent_detection_logs(tenant_id)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_intent_logs_method ON intent_detection_logs(detection_method)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_intent_logs_created ON intent_detection_logs(created_at DESC)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_intent_logs_success ON intent_detection_logs(success)`;
    console.log('✅ Success\n');

    console.log('[3/12] Creating intent_analytics_summary table...');
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS intent_analytics_summary (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id VARCHAR(255) NOT NULL,
        period_start TIMESTAMP NOT NULL,
        period_end TIMESTAMP NOT NULL,
        total_queries INTEGER NOT NULL DEFAULT 0,
        regex_success_count INTEGER NOT NULL DEFAULT 0,
        llm_fallback_count INTEGER NOT NULL DEFAULT 0,
        generic_fallback_count INTEGER NOT NULL DEFAULT 0,
        failed_queries_count INTEGER NOT NULL DEFAULT 0,
        avg_confidence DECIMAL(3,2),
        avg_latency_ms INTEGER,
        total_llm_cost_usd DECIMAL(10,4),
        top_failed_patterns JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(tenant_id, period_start, period_end)
      )
    `;
    console.log('✅ Success\n');

    console.log('[4/12] Creating indexes for intent_analytics_summary...');
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_analytics_summary_tenant ON intent_analytics_summary(tenant_id)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_analytics_summary_period ON intent_analytics_summary(period_start DESC)`;
    console.log('✅ Success\n');

    console.log('[5/12] Creating intent_failed_patterns table...');
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS intent_failed_patterns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id VARCHAR(255) NOT NULL,
        query_pattern TEXT NOT NULL,
        example_queries TEXT[] NOT NULL,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        suggested_regex TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        reviewed_by VARCHAR(255),
        reviewed_at TIMESTAMP,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    console.log('✅ Success\n');

    console.log('[6/12] Creating indexes for intent_failed_patterns...');
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_failed_patterns_tenant ON intent_failed_patterns(tenant_id)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_failed_patterns_status ON intent_failed_patterns(status)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_failed_patterns_count ON intent_failed_patterns(occurrence_count DESC)`;
    console.log('✅ Success\n');

    // Verify tables were created
    console.log('🔍 Verifying tables...\n');

    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('intent_detection_logs', 'intent_analytics_summary', 'intent_failed_patterns')
      ORDER BY table_name
    `;

    console.log('✅ Tables created:');
    tables.forEach(t => console.log(`   - ${t.table_name}`));

    // Check indexes
    const indexes = await prisma.$queryRaw`
      SELECT indexname 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
        AND tablename IN ('intent_detection_logs', 'intent_analytics_summary', 'intent_failed_patterns')
      ORDER BY indexname
    `;

    console.log(`\n✅ Indexes created: ${indexes.length}`);
    indexes.forEach(i => console.log(`   - ${i.indexname}`));

    console.log('\n✅ Migration applied successfully!');
    console.log('\n📊 Intent Analytics Schema:');
    console.log('   - intent_detection_logs: Logs every intent detection');
    console.log('   - intent_analytics_summary: Aggregated metrics per tenant');
    console.log('   - intent_failed_patterns: Failed query patterns for learning');
    console.log('\n🎯 Next steps:');
    console.log('   1. ✅ IntentDetectorService updated with LLM fallback');
    console.log('   2. ✅ IntentAnalyticsService integrated');
    console.log('   3. ⏳ Create IntentAnalyticsController');
    console.log('   4. ⏳ Build admin dashboard UI');
    console.log('   5. ⏳ Run tests');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

applyMigration();
