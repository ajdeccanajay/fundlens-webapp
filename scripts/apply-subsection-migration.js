#!/usr/bin/env node
/**
 * Apply subsection_name migration to narrative_chunks table
 * Phase 1: Core Subsection Extraction and Storage
 * Requirements: 15.1, 15.3
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function applyMigration() {
  console.log('🚀 Applying subsection_name migration to narrative_chunks...');
  
  try {
    // Add subsection_name column
    console.log('📄 Adding subsection_name column...');
    await prisma.$executeRaw`
      ALTER TABLE narrative_chunks 
      ADD COLUMN IF NOT EXISTS subsection_name TEXT NULL
    `;
    console.log('✅ Column added');
    
    // Create index
    console.log('📄 Creating index...');
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS idx_narrative_chunks_subsection 
      ON narrative_chunks(ticker, section_type, subsection_name)
    `;
    console.log('✅ Index created');
    
    // Add comment
    console.log('📄 Adding column comment...');
    await prisma.$executeRaw`
      COMMENT ON COLUMN narrative_chunks.subsection_name IS 
      'Fine-grained subsection within major SEC sections (e.g., Competition within Item 1, Results of Operations within Item 7). NULL for sections without identified subsections.'
    `;
    console.log('✅ Comment added');
    
    // Verify migration
    const result = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'narrative_chunks'
      AND column_name = 'subsection_name'
    `;
    
    if (result.length > 0) {
      console.log('✅ Verification successful: subsection_name column exists');
      console.log('   Column details:', result[0]);
    } else {
      throw new Error('Verification failed: subsection_name column not found');
    }
    
    // Check index
    const indexResult = await prisma.$queryRaw`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'narrative_chunks'
      AND indexname = 'idx_narrative_chunks_subsection'
    `;
    
    if (indexResult.length > 0) {
      console.log('✅ Verification successful: idx_narrative_chunks_subsection index exists');
    } else {
      throw new Error('Verification failed: idx_narrative_chunks_subsection index not found');
    }
    
    // Count existing chunks
    const chunkCount = await prisma.narrativeChunk.count();
    console.log(`📊 Total narrative chunks: ${chunkCount}`);
    console.log('   All existing chunks will have subsection_name = NULL (backward compatible)');
    
    console.log('\n🎉 Migration complete!');
    console.log('   Next steps:');
    console.log('   1. Run: npx prisma generate');
    console.log('   2. Update chunk creation code to populate subsection_name');
    console.log('   3. Backfill existing chunks with subsection metadata (optional)');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
applyMigration()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
