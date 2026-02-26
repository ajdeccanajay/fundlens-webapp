-- ============================================
-- Document Intelligence Pipeline v2 — Phase 4
-- Migration: extracted_metrics table
-- 
-- Stores structured metrics extracted from uploaded documents
-- using MetricRegistry canonical IDs so the existing structured
-- retriever finds them via synonym lookup.
--
-- CRITICAL: normalized_metric MUST use canonical IDs from the
-- MetricRegistry YAML, NOT raw document labels.
-- ============================================

CREATE TABLE IF NOT EXISTS extracted_metrics (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           VARCHAR(64) NOT NULL,
  document_id         UUID NOT NULL,
  ticker              VARCHAR(16),

  -- Metric identification (CANONICAL from MetricRegistry)
  normalized_metric   VARCHAR(128) NOT NULL,
  raw_label           VARCHAR(256),
  display_name        VARCHAR(256),

  -- Value
  value               NUMERIC NOT NULL,
  unit                VARCHAR(32),
  period              VARCHAR(32),
  period_end_date     DATE,
  context             VARCHAR(64) DEFAULT 'as-reported',
  output_format       VARCHAR(32) DEFAULT 'currency',
  is_estimate         BOOLEAN DEFAULT FALSE,

  -- YoY changes (if available from extraction)
  yoy_change          NUMERIC,
  yoy_change_pct      NUMERIC,

  -- Source traceability
  source_page_number  INTEGER,
  source_table_id     VARCHAR(64),
  source_section      VARCHAR(128),
  source_file_name    VARCHAR(512),
  extraction_confidence VARCHAR(16) DEFAULT 'high',

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary lookup: structured retriever queries by ticker + metric
CREATE INDEX IF NOT EXISTS idx_extracted_metrics_ticker_metric
  ON extracted_metrics(ticker, normalized_metric);

-- Tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_extracted_metrics_tenant_ticker
  ON extracted_metrics(tenant_id, ticker);

-- Document-level queries (for deletion/re-extraction)
CREATE INDEX IF NOT EXISTS idx_extracted_metrics_document
  ON extracted_metrics(document_id);

-- Period-based queries
CREATE INDEX IF NOT EXISTS idx_extracted_metrics_ticker_period
  ON extracted_metrics(ticker, normalized_metric, period);
