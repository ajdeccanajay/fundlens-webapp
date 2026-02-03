#!/usr/bin/env node

/**
 * Apply Research Assistant Migration (Fixed)
 * Properly handles multi-line SQL including functions and triggers
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function applyMigration() {
  console.log('🔧 Applying Research Assistant Migration (Fixed)...\n');

  try {
    // Read migration SQL
    const migrationPath = path.join(__dirname, '../prisma/migrations/add_research_assistant_schema_simple.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded');
    console.log('');

    // Execute the entire SQL as one transaction
    console.log('🚀 Executing migration...');
    await prisma.$executeRawUnsafe(sql);
    
    console.log('✅ Migration executed successfully');
    console.log('');

    // Verify tables exist
    console.log('🔍 Verifying tables...');
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
        AND table_name LIKE 'research_%'
      ORDER BY table_name
    `;

    if (tables.length > 0) {
      console.log(`✅ Found ${tables.length} research tables:`);
      tables.forEach(t => console.log(`   - ${t.table_name}`));
    } else {
      console.log('⚠️  No research tables found');
    }

    // Check for other related tables
    const otherTables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
        AND (table_name = 'ic_memos' 
          OR table_name = 'user_preferences'
          OR table_name = 'conversation_shares'
          OR table_name = 'conversation_templates')
      ORDER BY table_name
    `;

    if (otherTables.length > 0) {
      console.log(`\n✅ Found ${otherTables.length} related tables:`);
      otherTables.forEach(t => console.log(`   - ${t.table_name}`));
    }

    console.log('');
    console.log('✅ Migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

applyMigration();
