#!/usr/bin/env node

/**
 * Apply Workspace Enhancement Migration
 * 
 * Creates three new tables:
 * 1. footnote_references - Link metrics to footnotes
 * 2. mda_insights - MD&A intelligence extraction
 * 3. metric_hierarchy - Hierarchical metric relationships
 * 
 * Usage:
 *   node scripts/apply-workspace-enhancement-migration.js
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function applyMigration() {
  console.log('🚀 Applying Workspace Enhancement Migration...\n');

  try {
    // Read migration SQL
    const migrationPath = path.join(
      __dirname,
      '../prisma/migrations/20260130_add_workspace_enhancement_tables.sql'
    );
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }

    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📄 Migration file loaded');
    console.log('📊 Creating tables...\n');

    // Remove comments and split by semicolon
    const cleanedSql = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');

    // Split SQL into individual statements
    const statements = cleanedSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 10); // Filter out empty or very short statements

    // Separate statements by type
    const createTableStatements = statements.filter(s => 
      s.toUpperCase().includes('CREATE TABLE')
    );
    
    const createIndexStatements = statements.filter(s => 
      s.toUpperCase().includes('CREATE INDEX')
    );
    
    const commentStatements = statements.filter(s => 
      s.toUpperCase().includes('COMMENT ON')
    );

    console.log(`Found ${createTableStatements.length} CREATE TABLE statements`);
    console.log(`Found ${createIndexStatements.length} CREATE INDEX statements`);
    console.log(`Found ${commentStatements.length} COMMENT statements\n`);

    // Execute in order: tables, indexes, comments
    console.log(`Creating ${createTableStatements.length} tables...`);
    for (let i = 0; i < createTableStatements.length; i++) {
      const statement = createTableStatements[i];
      const tableName = statement.match(/CREATE TABLE[^(]+?(\w+)\s*\(/i)?.[1] || 'unknown';
      console.log(`  [${i+1}/${createTableStatements.length}] Creating table: ${tableName}`);
      await prisma.$executeRawUnsafe(statement);
    }

    console.log(`\nCreating ${createIndexStatements.length} indexes...`);
    for (let i = 0; i < createIndexStatements.length; i++) {
      const statement = createIndexStatements[i];
      const indexName = statement.match(/CREATE INDEX[^(]+?(\w+)\s+ON/i)?.[1] || 'unknown';
      console.log(`  [${i+1}/${createIndexStatements.length}] Creating index: ${indexName}`);
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch (error) {
        console.error(`  ❌ Failed to create index: ${error.message}`);
        throw error;
      }
    }

    console.log(`\nAdding ${commentStatements.length} comments...`);
    for (const statement of commentStatements) {
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch (error) {
        // Comments are optional, continue if they fail
        console.warn(`Warning: Could not add comment: ${error.message}`);
      }
    }

    console.log('✅ Migration applied successfully!\n');

    // Verify tables exist
    console.log('🔍 Verifying tables...\n');

    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('footnote_references', 'mda_insights', 'metric_hierarchy')
      ORDER BY table_name;
    `;

    console.log('📋 Tables created:');
    tables.forEach(({ table_name }) => {
      console.log(`   ✓ ${table_name}`);
    });

    // Check indexes
    console.log('\n🔍 Verifying indexes...\n');

    const indexes = await prisma.$queryRaw`
      SELECT 
        tablename,
        indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND tablename IN ('footnote_references', 'mda_insights', 'metric_hierarchy')
      ORDER BY tablename, indexname;
    `;

    console.log('📋 Indexes created:');
    let currentTable = '';
    indexes.forEach(({ tablename, indexname }) => {
      if (tablename !== currentTable) {
        console.log(`\n   ${tablename}:`);
        currentTable = tablename;
      }
      console.log(`      ✓ ${indexname}`);
    });

    console.log('\n✨ Migration complete!\n');
    console.log('📊 Summary:');
    console.log(`   • Tables created: ${tables.length}`);
    console.log(`   • Indexes created: ${indexes.length}`);
    console.log('\n🎉 Ready for Workspace Enhancement features!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\nError details:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
applyMigration();
