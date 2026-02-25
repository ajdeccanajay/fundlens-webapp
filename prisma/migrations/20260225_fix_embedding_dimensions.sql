-- ============================================
-- Fix embedding dimension mismatch
-- Titan V2 returns 1024 dims (not 1536 like V1)
-- ============================================

-- Drop the IVFFlat index first (depends on column type)
DROP INDEX IF EXISTS idx_ichunks_embedding;

-- Alter column from vector(1536) to vector(1024)
ALTER TABLE intel_document_chunks
  ALTER COLUMN embedding TYPE vector(1024);

-- Recreate IVFFlat index
CREATE INDEX IF NOT EXISTS idx_ichunks_embedding
  ON intel_document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
