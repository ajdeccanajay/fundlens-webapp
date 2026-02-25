-- ============================================
-- Document Intelligence Engine — Layer 1 v2
-- Migration: intel_document_chunks
-- Spec Reference: §3.4 Step 4, §7.1 Source 2
-- Stores chunked + embedded document content for pgvector search
-- ============================================

-- Ensure pgvector extension exists
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS intel_document_chunks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       UUID NOT NULL REFERENCES intel_documents(document_id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL,
  deal_id           UUID NOT NULL,

  -- Chunk content
  chunk_index       INT NOT NULL,
  content           TEXT NOT NULL,
  section_type      VARCHAR(50) DEFAULT 'narrative',
  page_number       INT,
  token_estimate    INT,

  -- Titan V2 embedding (1024 dimensions — V2 max is 1024, V1 was 1536)
  embedding         vector(1024),

  created_at        TIMESTAMP DEFAULT NOW()
);

-- Tenant + deal scoped vector search (primary query pattern)
CREATE INDEX IF NOT EXISTS idx_ichunks_tenant_deal
  ON intel_document_chunks(tenant_id, deal_id);

-- Document-level chunk lookup (for re-indexing / deletion)
CREATE INDEX IF NOT EXISTS idx_ichunks_document
  ON intel_document_chunks(document_id);

-- pgvector IVFFlat index for approximate nearest neighbor search
-- Lists = 100 is good for up to ~100K chunks per tenant
CREATE INDEX IF NOT EXISTS idx_ichunks_embedding
  ON intel_document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
