-- Migration: Add Performance Indexes for Insights Tab
-- Date: 2026-02-02
-- Purpose: Optimize query performance for anomaly detection, comp table, and change tracker

-- ============================================================
-- METRIC HIERARCHY INDEXES
-- ============================================================

-- Note: idx_metric_hierarchy_deal and idx_metric_hierarchy_ticker_period already exist
-- Adding additional indexes for performance

-- Index for parent lookups (used in tree traversal)
CREATE INDEX IF NOT EXISTS idx_metric_hierarchy_parent_lookup 
  ON metric_hierarchy(parent_id) 
  WHERE parent_id IS NOT NULL;

-- Index for metric name lookups
CREATE INDEX IF NOT EXISTS idx_metric_hierarchy_metric_name 
  ON metric_hierarchy(metric_name);

-- ============================================================
-- FOOTNOTE REFERENCES INDEXES
-- ============================================================

-- Note: idx_footnote_references_metric and idx_footnote_references_deal already exist
-- No additional indexes needed

-- ============================================================
-- FINANCIAL METRICS - ADDITIONAL INDEXES
-- ============================================================

-- Composite index for comp table queries (ticker + period + metric)
-- Covers: SELECT * FROM financial_metrics WHERE ticker IN (...) AND fiscal_period = ... AND normalized_metric IN (...)
CREATE INDEX IF NOT EXISTS idx_financial_metrics_comp_table 
  ON financial_metrics(ticker, fiscal_period, normalized_metric) 
  WHERE filing_type = '10-K';

-- Composite index for change tracker queries (ticker + metric + period + date)
-- Covers: SELECT * FROM financial_metrics WHERE ticker = ... AND normalized_metric = ... AND fiscal_period IN (...)
CREATE INDEX IF NOT EXISTS idx_financial_metrics_change_tracker 
  ON financial_metrics(ticker, normalized_metric, fiscal_period, filing_date);

-- Index for anomaly detection (historical data queries)
-- Covers: SELECT * FROM financial_metrics WHERE ticker = ... AND fiscal_period >= ... ORDER BY fiscal_period
CREATE INDEX IF NOT EXISTS idx_financial_metrics_anomaly_detection 
  ON financial_metrics(ticker, fiscal_period, normalized_metric, value) 
  WHERE filing_type = '10-K';

-- ============================================================
-- NARRATIVE CHUNKS - ADDITIONAL INDEXES
-- ============================================================

-- Index for MD&A queries (change tracker language analysis)
-- Covers: SELECT * FROM narrative_chunks WHERE ticker = ... AND section_type LIKE '%MD&A%'
CREATE INDEX IF NOT EXISTS idx_narrative_chunks_mda 
  ON narrative_chunks(ticker, filing_date, section_type) 
  WHERE section_type LIKE '%MD&A%';

-- Index for risk factor queries (change tracker new disclosures)
-- Covers: SELECT * FROM narrative_chunks WHERE ticker = ... AND section_type LIKE '%Risk%'
CREATE INDEX IF NOT EXISTS idx_narrative_chunks_risks 
  ON narrative_chunks(ticker, filing_date, section_type) 
  WHERE section_type LIKE '%Risk%';

-- Composite index for period-based narrative queries
-- Covers: SELECT * FROM narrative_chunks WHERE ticker = ... AND filing_date IN (...)
CREATE INDEX IF NOT EXISTS idx_narrative_chunks_period_comparison 
  ON narrative_chunks(ticker, filing_date, section_type, chunk_index);

-- ============================================================
-- DEALS - ADDITIONAL INDEXES
-- ============================================================

-- Index for ticker-based deal lookups (used in all insights queries)
-- Note: Already exists as idx_deals_ticker, but adding composite for better performance
CREATE INDEX IF NOT EXISTS idx_deals_ticker_tenant 
  ON deals(ticker, tenant_id) 
  WHERE status = 'active';

-- ============================================================
-- ANALYSIS
-- ============================================================

-- Run ANALYZE to update query planner statistics
ANALYZE financial_metrics;
ANALYZE narrative_chunks;
ANALYZE metric_hierarchy;
ANALYZE footnote_references;
ANALYZE deals;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Verify indexes were created
-- SELECT indexname, tablename FROM pg_indexes WHERE indexname LIKE 'idx_%insights%' OR indexname LIKE 'idx_metric_hierarchy%' OR indexname LIKE 'idx_footnote%';

-- Check index usage (run after some queries)
-- SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch FROM pg_stat_user_indexes WHERE indexname LIKE 'idx_%' ORDER BY idx_scan DESC;

-- ============================================================
-- ROLLBACK (if needed)
-- ============================================================

-- DROP INDEX IF EXISTS idx_metric_hierarchy_deal_period;
-- DROP INDEX IF EXISTS idx_metric_hierarchy_parent;
-- DROP INDEX IF EXISTS idx_metric_hierarchy_metric_name;
-- DROP INDEX IF EXISTS idx_footnote_refs_metric;
-- DROP INDEX IF EXISTS idx_footnote_refs_deal;
-- DROP INDEX IF EXISTS idx_financial_metrics_comp_table;
-- DROP INDEX IF EXISTS idx_financial_metrics_change_tracker;
-- DROP INDEX IF EXISTS idx_financial_metrics_anomaly_detection;
-- DROP INDEX IF EXISTS idx_narrative_chunks_mda;
-- DROP INDEX IF EXISTS idx_narrative_chunks_risks;
-- DROP INDEX IF EXISTS idx_narrative_chunks_period_comparison;
-- DROP INDEX IF EXISTS idx_deals_ticker_tenant;
