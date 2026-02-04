-- Migration: Add generated_documents table for IC Memo generation
-- Date: 2026-02-03

CREATE TABLE IF NOT EXISTS generated_documents (
    id VARCHAR(255) PRIMARY KEY,
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_generated_documents_deal_id ON generated_documents(deal_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_type ON generated_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_generated_documents_created_at ON generated_documents(created_at DESC);

-- Add comment
COMMENT ON TABLE generated_documents IS 'Stores AI-generated investment memos and presentations';
