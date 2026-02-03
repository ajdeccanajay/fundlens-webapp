-- Migration: Add Metric Hierarchy and Footnote References Tables
-- Date: 2026-02-02
-- Purpose: Enable Steps G & H to persist data for Insights page features
-- Features: Interactive drill-down and footnote context

-- ============================================================
-- Table: metric_hierarchy
-- Purpose: Store parent-child relationships for metric drill-down
-- Used by: Step G (Build Metric Hierarchy)
-- NOTE: Table already exists, adding missing columns
-- ============================================================

-- Add missing columns to existing metric_hierarchy table
ALTER TABLE metric_hierarchy 
  ADD COLUMN IF NOT EXISTS children_ids UUID[],
  ADD COLUMN IF NOT EXISTS sibling_ids UUID[],
  ADD COLUMN IF NOT EXISTS normalized_name TEXT,
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS value DECIMAL,
  ADD COLUMN IF NOT EXISTS calculation_formula TEXT,
  ADD COLUMN IF NOT EXISTS rollup_type TEXT DEFAULT 'sum',
  ADD COLUMN IF NOT EXISTS calculated_value DECIMAL,
  ADD COLUMN IF NOT EXISTS variance DECIMAL,
  ADD COLUMN IF NOT EXISTS variance_percent DECIMAL,
  ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- Update normalized_name from metric_name if NULL
UPDATE metric_hierarchy 
SET normalized_name = metric_name 
WHERE normalized_name IS NULL AND metric_name IS NOT NULL;

-- Update label from metric_name if NULL
UPDATE metric_hierarchy 
SET label = metric_name 
WHERE label IS NULL AND metric_name IS NOT NULL;

-- Indexes for performance (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_metric_hierarchy_deal_id ON metric_hierarchy(deal_id);
CREATE INDEX IF NOT EXISTS idx_metric_hierarchy_parent_id ON metric_hierarchy(parent_id);
CREATE INDEX IF NOT EXISTS idx_metric_hierarchy_fiscal_period ON metric_hierarchy(fiscal_period);
CREATE INDEX IF NOT EXISTS idx_metric_hierarchy_statement_type ON metric_hierarchy(statement_type);

-- ============================================================
-- Table: footnote_references
-- Purpose: Link metrics to explanatory footnotes
-- Used by: Step H (Link Footnotes)
-- NOTE: Table already exists, adding missing column alias
-- ============================================================

-- Add footnote_section as alias for section_title if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'footnote_references' 
                 AND column_name = 'footnote_section') THEN
    ALTER TABLE footnote_references ADD COLUMN footnote_section TEXT;
    -- Copy data from section_title to footnote_section
    UPDATE footnote_references SET footnote_section = section_title WHERE section_title IS NOT NULL;
  END IF;
END $$;

-- Indexes for performance (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_footnote_references_deal_id ON footnote_references(deal_id);
CREATE INDEX IF NOT EXISTS idx_footnote_references_metric_id ON footnote_references(metric_id);
CREATE INDEX IF NOT EXISTS idx_footnote_references_context_type ON footnote_references(context_type);

-- ============================================================
-- Comments for documentation
-- ============================================================
COMMENT ON TABLE metric_hierarchy IS 'Stores hierarchical relationships between financial metrics for interactive drill-down';
COMMENT ON TABLE footnote_references IS 'Links financial metrics to their explanatory footnotes from SEC filings';

COMMENT ON COLUMN metric_hierarchy.parent_id IS 'UUID of parent metric (NULL for root metrics)';
COMMENT ON COLUMN metric_hierarchy.children_ids IS 'Array of child metric UUIDs';
COMMENT ON COLUMN metric_hierarchy.rollup_type IS 'How children roll up to parent: sum, difference, product, ratio';
COMMENT ON COLUMN metric_hierarchy.variance IS 'Difference between actual value and calculated value from children';

COMMENT ON COLUMN footnote_references.context_type IS 'Type of footnote: accounting_policy, segment_breakdown, reconciliation, other';
COMMENT ON COLUMN footnote_references.extracted_data IS 'Structured data extracted from footnote (tables, lists, etc.)';
