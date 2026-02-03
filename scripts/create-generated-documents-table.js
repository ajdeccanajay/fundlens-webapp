#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createGeneratedDocumentsTable() {
  try {
    console.log('Creating generated_documents table...');
    
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS generated_documents (
        id VARCHAR(50) PRIMARY KEY,
        deal_id UUID NOT NULL,
        document_type VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        status VARCHAR(20) NOT NULL DEFAULT 'completed',
        file_path VARCHAR(500),
        file_size INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        
        FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE
      )
    `;
    
    console.log('Creating indexes...');
    
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS idx_generated_documents_deal_id 
      ON generated_documents(deal_id)
    `;
    
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS idx_generated_documents_type 
      ON generated_documents(document_type)
    `;
    
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS idx_generated_documents_created_at 
      ON generated_documents(created_at)
    `;
    
    console.log('✅ generated_documents table created successfully');
    
    // Test the table
    const count = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM generated_documents
    `;
    
    console.log(`Table has ${count[0].count} records`);
    
  } catch (error) {
    console.error('❌ Error creating table:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  createGeneratedDocumentsTable()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { createGeneratedDocumentsTable };