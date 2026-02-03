#!/usr/bin/env node

/**
 * Apply scratchpad_items migration directly to database
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function applyMigration() {
  try {
    console.log('📦 Applying scratchpad_items migration...');
    
    // Read the migration SQL
    const migrationPath = path.join(__dirname, '../prisma/migrations/20260203_add_scratchpad_items.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split into individual statements (remove comments and split by semicolon)
    const statements = migrationSQL
      .split('\n')
      .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
      .join('\n')
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);
    
    console.log(`📝 Executing ${statements.length} SQL statements...`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      console.log(`  ${i + 1}/${statements.length}: ${stmt.substring(0, 50)}...`);
      await prisma.$executeRawUnsafe(stmt);
    }
    
    console.log('✅ Migration applied successfully!');
    
    // Verify the table exists
    const result = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'scratchpad_items'
      );
    `;
    
    console.log('✅ Table verification:', result);
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

applyMigration();
