#!/usr/bin/env node

/**
 * Apply Research Assistant Migration
 * Applies the research assistant schema to the database
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function applyMigration() {
  console.log('🔧 Applying Research Assistant Migration...\n');

  try {
    // Read migration SQL
    const migrationPath = path.join(__dirname, '../prisma/migrations/add_research_assistant_schema_simple.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded');
    console.log(`   Size: ${(sql.length / 1024).toFixed(2)} KB`);
    console.log('');

    // Split into individual statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`📊 Found ${statements.length} SQL statements`);
    console.log('');

    // Execute each statement
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const preview = statement.substring(0, 60).replace(/\n/g, ' ');
      
      try {
        await prisma.$executeRawUnsafe(statement);
        successCount++;
        console.log(`✅ [${i + 1}/${statements.length}] ${preview}...`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('does not exist')) {
          skipCount++;
          console.log(`⏭️  [${i + 1}/${statements.length}] ${preview}... (already exists)`);
        } else {
          errorCount++;
          console.log(`❌ [${i + 1}/${statements.length}] ${preview}...`);
          console.log(`   Error: ${error.message}`);
        }
      }
    }

    console.log('');
    console.log('=' .repeat(60));
    console.log('📊 Migration Summary');
    console.log('=' .repeat(60));
    console.log(`✅ Success: ${successCount}`);
    console.log(`⏭️  Skipped: ${skipCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log('');

    // Verify tables exist
    console.log('🔍 Verifying tables...');
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name LIKE 'research_%'
      ORDER BY table_name
    `;

    if (tables.length > 0) {
      console.log(`✅ Found ${tables.length} research tables:`);
      tables.forEach(t => console.log(`   - ${t.table_name}`));
    } else {
      console.log('⚠️  No research tables found');
    }

    console.log('');
    console.log('✅ Migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

applyMigration();
