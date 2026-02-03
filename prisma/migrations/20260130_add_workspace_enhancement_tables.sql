-- Migration: Add Workspace Enhancement Tables
-- Date: 2026-01-30
-- Purpose: Add tables for Footnote Linking, MD&A Intelligence, and Metric Hierarchy
-- Related: WORKSPACE_ENHANCEMENT_KICKOFF.md, WEEK3_PYTHON_PARSER_COMPLETE.md

-- ============================================================
-- FOOTNOTE REFERENCES TABLE
-- Purpose: Link metrics to explanatory footnotes from SEC filings
-- Features: Extract structured data (tables, lists), classify by type
-- ============================================================

CREATE TABLE IF NOT EXISTS footnote_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  metric_id UUID NOT NULL,
  ticker VARCHAR(20) NOT NULL,
  fiscal_period VARCHAR(50) NOT NULL,
  footnote_number VARCHAR(10) NOT NULL,
  section_title VARCHAR(500) NOT NULL,
  footnote_text TEXT NOT NULL,
  context_type VARCHAR(50) NOT NULL, -- 'accounting_policy', 'segment_breakdown', 'reconciliation', 'other'
  extracted_data JSONB, -- Structured data: {tables: [], lists: []}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT footnote_references_unique UNIQUE (deal_id, metric_id, footnote_number)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_footnote_references_deal ON footnote_references(deal_id);
CREATE INDEX IF NOT EXISTS idx_footnote_references_metric ON footnote_references(metric_id);
CREATE INDEX IF NOT EXISTS idx_footnote_references_ticker_period ON footnote_references(ticker, fiscal_period);

-- ============================================================
-- MD&A INSIGHTS TABLE
-- Purpose: Store AI-extracted insights from MD&A sections
-- Features: Trends, risks, guidance, sentiment analysis
-- ============================================================

CREATE TABLE IF NOT EXISTS mda_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  ticker VARCHAR(20) NOT NULL,
  fiscal_period VARCHAR(50) NOT NULL,
  
  -- Trends: [{metric, direction, magnitude, drivers[], context}]
  trends JSONB NOT NULL DEFAULT '[]',
  
  -- Risks: [{title, severity, description, mentions, category}]
  risks JSONB NOT NULL DEFAULT '[]',
  
  -- Forward guidance
  guidance TEXT,
  guidance_sentiment VARCHAR(20), -- 'positive', 'negative', 'neutral'
  
  -- Metadata
  extraction_method VARCHAR(50) NOT NULL DEFAULT 'pattern_based', -- 'pattern_based', 'llm_based'
  confidence_score DECIMAL(5, 2),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT mda_insights_unique UNIQUE (deal_id, fiscal_period)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_mda_insights_deal ON mda_insights(deal_id);
CREATE INDEX IF NOT EXISTS idx_mda_insights_ticker ON mda_insights(ticker);
CREATE INDEX IF NOT EXISTS idx_mda_insights_ticker_period ON mda_insights(ticker, fiscal_period);

-- ============================================================
-- METRIC HIERARCHY TABLE
-- Purpose: Store hierarchical relationships between metrics
-- Features: Parent-child relationships, formulas, key drivers
-- ============================================================

CREATE TABLE IF NOT EXISTS metric_hierarchy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  ticker VARCHAR(20) NOT NULL,
  fiscal_period VARCHAR(50) NOT NULL,
  metric_id UUID NOT NULL,
  metric_name VARCHAR(255) NOT NULL,
  parent_id UUID, -- NULL for root metrics
  level INT NOT NULL DEFAULT 0, -- 0 = root, 1 = child, 2 = grandchild, etc.
  statement_type VARCHAR(50) NOT NULL, -- 'income_statement', 'balance_sheet', 'cash_flow'
  calculation_path VARCHAR(255)[], -- Path from root to this metric
  formula VARCHAR(500), -- e.g., 'Revenue - COGS'
  is_key_driver BOOLEAN NOT NULL DEFAULT FALSE,
  contribution DECIMAL(10, 4), -- Contribution percentage to parent
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT metric_hierarchy_unique UNIQUE (deal_id, metric_id, fiscal_period)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_metric_hierarchy_deal ON metric_hierarchy(deal_id);
CREATE INDEX IF NOT EXISTS idx_metric_hierarchy_parent ON metric_hierarchy(deal_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_metric_hierarchy_ticker_period ON metric_hierarchy(ticker, fiscal_period);
CREATE INDEX IF NOT EXISTS idx_metric_hierarchy_statement ON metric_hierarchy(deal_id, statement_type);

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON TABLE footnote_references IS 'Links financial metrics to explanatory footnotes from SEC filings';
COMMENT ON COLUMN footnote_references.context_type IS 'Type of footnote: accounting_policy, segment_breakdown, reconciliation, other';
COMMENT ON COLUMN footnote_references.extracted_data IS 'Structured data extracted from footnote: {tables: [{headers: [], rows: []}], lists: []}';

COMMENT ON TABLE mda_insights IS 'AI-extracted insights from MD&A sections of SEC filings';
COMMENT ON COLUMN mda_insights.trends IS 'Array of trend objects: {metric, direction, magnitude, drivers[], context}';
COMMENT ON COLUMN mda_insights.risks IS 'Array of risk objects: {title, severity, description, mentions, category}';
COMMENT ON COLUMN mda_insights.extraction_method IS 'Method used: pattern_based (deterministic) or llm_based (AI)';

COMMENT ON TABLE metric_hierarchy IS 'Hierarchical relationships between financial metrics for drill-down analysis';
COMMENT ON COLUMN metric_hierarchy.level IS 'Depth in hierarchy: 0=root, 1=child, 2=grandchild, etc.';
COMMENT ON COLUMN metric_hierarchy.calculation_path IS 'Array of metric names from root to this metric';
COMMENT ON COLUMN metric_hierarchy.formula IS 'Calculation formula if applicable, e.g., "Revenue - COGS"';
COMMENT ON COLUMN metric_hierarchy.is_key_driver IS 'Whether this metric is a key driver of parent metric';
COMMENT ON COLUMN metric_hierarchy.contribution IS 'Percentage contribution to parent metric';
