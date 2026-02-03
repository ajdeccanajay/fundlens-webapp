#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

async function createDealsTables() {
  const prisma = new PrismaClient();

  try {
    console.log('🔄 Creating deals tables...');

    // Create deals table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS deals (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL,
          description TEXT,
          deal_type VARCHAR(20) NOT NULL CHECK (deal_type IN ('public', 'private')),
          ticker VARCHAR(10),
          company_name VARCHAR(255),
          report_type VARCHAR(20) CHECK (report_type IN ('quarterly', 'annual')),
          time_periods INTEGER DEFAULT 3,
          status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in-progress', 'review', 'closed')),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          created_by VARCHAR(255),
          metadata JSONB DEFAULT '{}'::jsonb
      )
    `;

    // Create analysis_sessions table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS analysis_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
          system_prompt TEXT DEFAULT 'You are a financial analyst assistant specializing in SEC filings analysis, financial metrics calculation, and investment research. Provide accurate, well-sourced analysis with proper citations.',
          session_name VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          is_active BOOLEAN DEFAULT true
      )
    `;

    // Create chat_messages table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS chat_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id UUID NOT NULL REFERENCES analysis_sessions(id) ON DELETE CASCADE,
          role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          sources JSONB DEFAULT '[]'::jsonb,
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          tokens_used INTEGER DEFAULT 0
      )
    `;

    // Create scratch_pads table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS scratch_pads (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
          title VARCHAR(255) DEFAULT 'Investment Analysis',
          content TEXT DEFAULT '',
          content_type VARCHAR(20) DEFAULT 'markdown' CHECK (content_type IN ('markdown', 'html', 'plain')),
          auto_saved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          manually_saved_at TIMESTAMP WITH TIME ZONE,
          version INTEGER DEFAULT 1
      )
    `;

    // Create indexes
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_deals_ticker ON deals(ticker)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_analysis_sessions_deal_id ON analysis_sessions(deal_id)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_scratch_pads_deal_id ON scratch_pads(deal_id)`;

    console.log('✅ Deals tables created successfully!');

    // Test the tables
    const dealCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM deals`;
    console.log(`📊 Deals table ready: ${dealCount[0].count} records`);

  } catch (error) {
    console.error('❌ Failed to create tables:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  createDealsTables();
}

module.exports = { createDealsTables };