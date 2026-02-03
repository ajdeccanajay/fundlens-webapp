-- Add pgvector extension for vector embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Add new fields to existing documents table
ALTER TABLE documents 
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) DEFAULT 'USER_UPLOAD',
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);

-- Add indexes for new document fields
CREATE INDEX IF NOT EXISTS idx_documents_tenant_source ON documents(tenant_id, source_type);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_ticker ON documents(tenant_id, ticker);

-- Add new fields to existing document_chunks table
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ticker VARCHAR(20),
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS page_number INTEGER;

-- Update content column to TEXT type if not already
ALTER TABLE document_chunks 
  ALTER COLUMN content TYPE TEXT;

-- Add indexes for document_chunks
CREATE INDEX IF NOT EXISTS idx_chunks_tenant_ticker ON document_chunks(tenant_id, ticker);

-- Create vector index for similarity search (using ivfflat for performance)
-- Note: This requires some data to be present for optimal performance
-- We'll create it as a basic index first, can be optimized later with ivfflat
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Add ticker field to research_messages table
ALTER TABLE research_messages
  ADD COLUMN IF NOT EXISTS ticker VARCHAR(20);

-- Create citations table
CREATE TABLE IF NOT EXISTS citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  message_id UUID NOT NULL,
  document_id VARCHAR(255) NOT NULL,
  chunk_id VARCHAR(255) NOT NULL,
  quote TEXT NOT NULL,
  page_number INTEGER,
  relevance_score DOUBLE PRECISION,
  created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_citations_message FOREIGN KEY (message_id) 
    REFERENCES research_messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_citations_document FOREIGN KEY (document_id) 
    REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_citations_chunk FOREIGN KEY (chunk_id) 
    REFERENCES document_chunks(id) ON DELETE CASCADE
);

-- Create indexes for citations
CREATE INDEX IF NOT EXISTS idx_citations_tenant_message ON citations(tenant_id, message_id);
CREATE INDEX IF NOT EXISTS idx_citations_document ON citations(document_id);
CREATE INDEX IF NOT EXISTS idx_citations_chunk ON citations(chunk_id);

-- Backfill tenant_id in document_chunks from documents table
UPDATE document_chunks dc
SET tenant_id = d.tenant_id,
    ticker = d.ticker
FROM documents d
WHERE dc.document_id = d.id
  AND dc.tenant_id IS NULL;

-- Make tenant_id NOT NULL after backfill
ALTER TABLE document_chunks
  ALTER COLUMN tenant_id SET NOT NULL;

-- Add comment to track migration
COMMENT ON TABLE citations IS 'Stores citations linking messages to document chunks for source attribution';
COMMENT ON COLUMN document_chunks.embedding IS 'Vector embedding (1536 dimensions) for semantic search using pgvector';
COMMENT ON COLUMN documents.source_type IS 'Source of document: USER_UPLOAD or SEC_FILING';
