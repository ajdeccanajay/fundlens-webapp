-- ============================================
-- Document Intelligence Engine — Layer 1 v2
-- Migration: documents + document_extractions
-- Spec Reference: §9.1, §9.2
-- ============================================

-- ============================================
-- TABLE 1: documents
-- Central registry for all uploaded documents
-- (chat uploads + deal library uploads)
-- ============================================

CREATE TABLE IF NOT EXISTS documents (
  document_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  deal_id           UUID NOT NULL,
  chat_session_id   UUID,                    -- NULL for Deal Library uploads
  deal_library_id   UUID,                    -- NULL for chat-only uploads

  -- File metadata
  file_name         VARCHAR(500) NOT NULL,
  file_type         VARCHAR(100) NOT NULL,
  file_size         BIGINT NOT NULL,
  s3_key            VARCHAR(1000) NOT NULL,
  raw_text_s3_key   VARCHAR(1000),           -- Parsed raw text for long-context fallback

  -- Classification (populated by instant intelligence)
  document_type     VARCHAR(50),             -- sell-side-report, ic-memo, pe-cim, etc.
  company_ticker    VARCHAR(20),
  company_name      VARCHAR(200),

  -- Processing state
  status            VARCHAR(20) NOT NULL DEFAULT 'uploading',
                    -- uploading | queryable | fully-indexed | error
  processing_mode   VARCHAR(30),
                    -- long-context-fallback | fully-indexed
  upload_source     VARCHAR(20) NOT NULL,
                    -- 'chat' | 'deal-library'

  -- Counts (updated as background enrichment progresses)
  page_count        INT,
  chunk_count       INT,
  metric_count      INT,

  -- KB sync state
  kb_sync_status    VARCHAR(20) DEFAULT 'pending',
                    -- pending | prepared | syncing | synced | failed
  kb_ingestion_job_id VARCHAR(200),

  -- Error handling
  error             TEXT,
  retry_count       INT DEFAULT 0,

  -- Timestamps
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

-- Indexes for common query patterns (Spec §9.1)
CREATE INDEX IF NOT EXISTS idx_docs_tenant_deal ON documents(tenant_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_docs_session ON documents(chat_session_id);
CREATE INDEX IF NOT EXISTS idx_docs_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_docs_kb_sync ON documents(kb_sync_status);
CREATE INDEX IF NOT EXISTS idx_docs_upload_source ON documents(upload_source);
CREATE INDEX IF NOT EXISTS idx_docs_tenant_status ON documents(tenant_id, status);


-- ============================================
-- TABLE 2: document_extractions
-- All structured data extracted from documents
-- Uses JSONB for flexible extraction payloads
-- ============================================

CREATE TABLE IF NOT EXISTS document_extractions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       UUID NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL,
  deal_id           UUID NOT NULL,

  -- What was extracted
  extraction_type   VARCHAR(30) NOT NULL,
                    -- 'headline' | 'metric' | 'table' | 'narrative' | 'footnote' | 'entity' | 'chart'
  data              JSONB NOT NULL,          -- The actual extraction payload

  -- Location in document
  page_number       INT,
  section           VARCHAR(100),            -- 'financial-statements', 'comp-table', etc.

  -- Quality
  confidence        DECIMAL(3,2),            -- 0.00 to 1.00
  verified          BOOLEAN DEFAULT false,   -- Passed deterministic verification
  source_layer      VARCHAR(20),             -- 'headline' | 'vision' | 'text'

  created_at        TIMESTAMP DEFAULT NOW()
);

-- Fast lookup: "give me the price target for this document" (Spec §9.2)
CREATE INDEX IF NOT EXISTS idx_extr_doc_type ON document_extractions(document_id, extraction_type);

-- Fast lookup: "give me all price targets across all documents for AAPL" (Spec §9.2)
CREATE INDEX IF NOT EXISTS idx_extr_tenant_deal ON document_extractions(tenant_id, deal_id, extraction_type);

-- Search within JSONB: data->>'metric_key' = 'price_target' (Spec §9.2)
-- This GIN index is critical for fast JSONB metric queries
CREATE INDEX IF NOT EXISTS idx_extr_data ON document_extractions USING GIN(data);

-- Cross-document comparison queries (Spec §9.2)
CREATE INDEX IF NOT EXISTS idx_extr_metric_key ON document_extractions(tenant_id, deal_id)
  WHERE extraction_type = 'metric';

-- ============================================
-- TRIGGER: auto-update updated_at on documents
-- ============================================

CREATE OR REPLACE FUNCTION update_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_documents_updated_at ON documents;
CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION update_documents_updated_at();
