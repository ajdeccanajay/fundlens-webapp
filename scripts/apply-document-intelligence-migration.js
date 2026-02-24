#!/usr/bin/env node

/**
 * Apply Document Intelligence Engine Migration
 *
 * Creates two tables per Layer 1 v2 spec §9:
 *   1. documents — central registry for all uploaded documents
 *   2. document_extractions — JSONB-based structured extraction storage
 *
 * Usage:
 *   node scripts/apply-document-intelligence-migration.js
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function applyMigration() {
  console.log('🚀 Applying Document Intelligence Engine Migration...\n');

  try {
    const migrationPath = path.join(
      __dirname,
      '../prisma/migrations/20260224_add_document_intelligence_tables.sql'
    );

    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }

    const sql = fs.readFileSync(migrationPath, 'utf8');
    console.log('📄 Migration file loaded');

    // Remove comments and split by semicolon
    const cleanedSql = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');

    const statements = cleanedSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 10);

    // Categorize statements
    const createTableStmts = statements.filter(s =>
      s.toUpperCase().includes('CREATE TABLE')
    );
    const createIndexStmts = statements.filter(s =>
      s.toUpperCase().includes('CREATE INDEX')
    );
    const functionStmts = statements.filter(s =>
      s.toUpperCase().includes('CREATE OR REPLACE FUNCTION') ||
      s.toUpperCase().includes('CREATE TRIGGER') ||
      s.toUpperCase().includes('DROP TRIGGER')
    );

    console.log(`Found ${createTableStmts.length} CREATE TABLE statements`);
    console.log(`Found ${createIndexStmts.length} CREATE INDEX statements`);
    console.log(`Found ${functionStmts.length} function/trigger statements\n`);

    // Execute tables
    console.log('📊 Creating tables...');
    for (const stmt of createTableStmts) {
      const tableName = stmt.match(/CREATE TABLE[^(]+?(\w+)\s*\(/i)?.[1] || 'unknown';
      console.log(`  ✓ ${tableName}`);
      await prisma.$executeRawUnsafe(stmt);
    }

    // Execute indexes
    console.log('\n📇 Creating indexes...');
    for (const stmt of createIndexStmts) {
      const indexName = stmt.match(/CREATE INDEX[^(]+?(\w+)\s+/i)?.[1] || 'unknown';
      console.log(`  ✓ ${indexName}`);
      await prisma.$executeRawUnsafe(stmt);
    }

    // Execute functions/triggers
    console.log('\n⚡ Creating functions & triggers...');
    for (const stmt of functionStmts) {
      try {
        await prisma.$executeRawUnsafe(stmt);
        console.log('  ✓ applied');
      } catch (err) {
        console.warn(`  ⚠ ${err.message}`);
      }
    }

    // Verify
    console.log('\n🔍 Verifying...\n');
    const tables = await prisma.$queryRaw`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('documents', 'document_extractions')
      ORDER BY table_name;
    `;

    console.log('Tables:');
    for (const { table_name } of tables) {
      console.log(`  ✓ ${table_name}`);
    }

    const indexes = await prisma.$queryRaw`
      SELECT tablename, indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('documents', 'document_extractions')
      ORDER BY tablename, indexname;
    `;

    console.log('\nIndexes:');
    for (const { tablename, indexname } of indexes) {
      console.log(`  ✓ ${tablename}.${indexname}`);
    }

    console.log(`\n✅ Migration complete — ${tables.length} tables, ${indexes.length} indexes`);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

applyMigration();
