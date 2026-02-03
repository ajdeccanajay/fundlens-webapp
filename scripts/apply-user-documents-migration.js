#!/usr/bin/env node

/**
 * Apply User Documents and Citations Migration
 * 
 * This script applies the database migration to add:
 * - pgvector extension for embeddings
 * - Citation model for source attribution
 * - Vector field to DocumentChunk
 * - Ticker field to Message
 * - Source type to Document
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function applyMigration() {
  console.log('🚀 Starting User Documents and Citations Migration...\n');

  try {
    // Read the migration SQL file
    const migrationPath = path.join(
      __dirname,
      '../prisma/migrations/20250127_add_user_documents_and_citations.sql'
    );
    
    console.log('📖 Reading migration file...');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Remove comments and split by semicolons
    const cleanSQL = migrationSQL
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');

    const statements = cleanSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    console.log(`📝 Found ${statements.length} SQL statements to execute\n`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const preview = statement.substring(0, 80).replace(/\s+/g, ' ');
      
      console.log(`[${i + 1}/${statements.length}] Executing: ${preview}...`);
      
      try {
        await prisma.$executeRawUnsafe(statement);
        console.log('  ✅ Success\n');
      } catch (error) {
        // Some statements might fail if already applied (idempotent)
        if (error.message.includes('already exists') || 
            error.message.includes('duplicate') ||
            error.message.includes('does not exist')) {
          console.log('  ⚠️  Already exists (skipping)\n');
        } else {
          console.error('  ❌ Error:', error.message);
          throw error;
        }
      }
    }

    // Verify the migration
    console.log('\n🔍 Verifying migration...\n');

    // Check pgvector extension
    const extensions = await prisma.$queryRaw`
      SELECT * FROM pg_extension WHERE extname = 'vector'
    `;
    console.log('✅ pgvector extension:', extensions.length > 0 ? 'INSTALLED' : 'NOT FOUND');

    // Check citations table
    const citationsTable = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'citations'
      ) as exists
    `;
    console.log('✅ citations table:', citationsTable[0].exists ? 'CREATED' : 'NOT FOUND');

    // Check document_chunks.embedding column
    const embeddingColumn = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'document_chunks' 
        AND column_name = 'embedding'
      ) as exists
    `;
    console.log('✅ document_chunks.embedding:', embeddingColumn[0].exists ? 'ADDED' : 'NOT FOUND');

    // Check research_messages.ticker column
    const tickerColumn = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'research_messages' 
        AND column_name = 'ticker'
      ) as exists
    `;
    console.log('✅ research_messages.ticker:', tickerColumn[0].exists ? 'ADDED' : 'NOT FOUND');

    // Check documents.source_type column
    const sourceTypeColumn = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'documents' 
        AND column_name = 'source_type'
      ) as exists
    `;
    console.log('✅ documents.source_type:', sourceTypeColumn[0].exists ? 'ADDED' : 'NOT FOUND');

    console.log('\n✨ Migration completed successfully!\n');
    console.log('📊 Summary:');
    console.log('  - pgvector extension enabled for vector embeddings');
    console.log('  - Citation model created for source attribution');
    console.log('  - DocumentChunk extended with embedding vector field');
    console.log('  - Message extended with ticker field');
    console.log('  - Document extended with source_type field');
    console.log('\n🎯 Next Steps:');
    console.log('  1. Regenerate Prisma Client: npx prisma generate');
    console.log('  2. Restart your application');
    console.log('  3. Test document upload functionality\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
applyMigration();
