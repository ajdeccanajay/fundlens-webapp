-- Pipeline Supporting Tables — Spec §9.4
-- call_analysis: Earnings call structured analysis (one row per call)
-- document_flags: Red flags + notable items for provocation engine
-- model_formulas: Excel formula graph for transparency

-- ═══════════════════════════════════════════════════════════════
-- 1. call_analysis — Earnings call structured analysis
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS call_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  document_id UUID NOT NULL,
  ticker VARCHAR(16) NOT NULL,
  quarter VARCHAR(32) NOT NULL,
  call_date DATE,

  overall_confidence INTEGER,
  confidence_rationale TEXT,
  guidance_changed BOOLEAN,
  guidance_direction VARCHAR(32),
  guidance_items JSONB,
  tone_analysis JSONB,
  red_flags JSONB,
  topics_not_discussed JSONB,
  participant_count INTEGER,
  qa_exchange_count INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_analysis_tenant_ticker
  ON call_analysis(tenant_id, ticker);
CREATE INDEX IF NOT EXISTS idx_call_analysis_document
  ON call_analysis(document_id);

-- ═══════════════════════════════════════════════════════════════
-- 2. document_flags — Red flags + notable items
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS document_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  document_id UUID NOT NULL,
  ticker VARCHAR(16),

  flag_type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  description TEXT NOT NULL,
  evidence TEXT,
  source_page_number INTEGER,

  reviewed BOOLEAN DEFAULT FALSE,
  reviewed_by VARCHAR(128),
  reviewed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_flags_tenant
  ON document_flags(tenant_id, severity);
CREATE INDEX IF NOT EXISTS idx_document_flags_document
  ON document_flags(document_id);

-- ═══════════════════════════════════════════════════════════════
-- 3. model_formulas — Excel formula graph
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS model_formulas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  document_id UUID NOT NULL,

  sheet_name VARCHAR(128) NOT NULL,
  cell_reference VARCHAR(32) NOT NULL,
  formula_text TEXT,
  resolved_metric VARCHAR(128),
  dependencies JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_formulas_document
  ON model_formulas(document_id);

-- ═══════════════════════════════════════════════════════════════
-- 4. Add intake_summary + kb_sync_status to intel_documents
--    (if not already present)
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'intel_documents' AND column_name = 'intake_summary'
  ) THEN
    ALTER TABLE intel_documents ADD COLUMN intake_summary TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'intel_documents' AND column_name = 'kb_sync_status'
  ) THEN
    ALTER TABLE intel_documents ADD COLUMN kb_sync_status VARCHAR(32) DEFAULT 'pending';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'intel_documents' AND column_name = 'kb_ingestion_job_id'
  ) THEN
    ALTER TABLE intel_documents ADD COLUMN kb_ingestion_job_id VARCHAR(128);
  END IF;
END $$;
