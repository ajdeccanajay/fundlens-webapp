#!/usr/bin/env node

/**
 * Apply Intent Analytics Migration
 * Creates tables for tracking intent detection performance
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function applyMigration() {
  console.log('🚀 Applying intent analytics migration...\n');

  try {
    // Read migration SQL
    const migrationPath = path.join(
      __dirname,
      '../prisma/migrations/20260204_add_intent_analytics.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Parse SQL statements properly
    // Split by semicolon but keep multi-line statements together
    const statements = [];
    let currentStatement = '';
    
    for (const line of sql.split('\n')) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('--')) {
        continue;
      }
      
      currentStatement += ' ' + trimmed;
      
      // If line ends with semicolon, we have a complete statement
      if (trimmed.endsWith(';')) {
        const stmt = currentStatement.trim();
        // Only keep CREATE statements (tables and indexes)
        if (stmt.startsWith('CREATE')) {
          statements.push(stmt);
        }
        currentStatement = '';
      }
    }

    console.log(`📝 Executing ${statements.length} SQL statements...\n`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const preview = statement.substring(0, 80).replace(/\s+/g, ' ');
      console.log(`[${i + 1}/${statements.length}] ${preview}...`);
      
      try {
        await prisma.$executeRawUnsafe(statement);
        console.log(`✅ Success\n`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`⚠️  Already exists, skipping\n`);
        } else {
          throw error;
        }
      }
    }

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
    console.log('   1. Update IntentDetectorService to use analytics');
    console.log('   2. Create IntentAnalyticsController');
    console.log('   3. Build admin dashboard UI');
    console.log('   4. Run tests');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

applyMigration();
