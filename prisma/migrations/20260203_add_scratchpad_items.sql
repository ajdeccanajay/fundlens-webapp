-- Migration: Add scratchpad_items table for Research Scratchpad Redesign
-- Feature: research-scratchpad-redesign
-- Requirements: 2.1, 2.2

CREATE TABLE IF NOT EXISTS scratchpad_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('direct_answer', 'revenue_framework', 'trend_analysis', 'provocation')),
  content JSONB NOT NULL,
  sources JSONB DEFAULT '[]'::jsonb,
  saved_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT NOW(),
  saved_from JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_scratchpad_items_workspace ON scratchpad_items(workspace_id);
CREATE INDEX idx_scratchpad_items_saved_at ON scratchpad_items(workspace_id, saved_at DESC);
CREATE INDEX idx_scratchpad_items_type ON scratchpad_items(workspace_id, type);

-- Comments for documentation
COMMENT ON TABLE scratchpad_items IS 'Stores saved research items from the Research Assistant chatbot';
COMMENT ON COLUMN scratchpad_items.type IS 'Type of saved item: direct_answer, revenue_framework, trend_analysis, or provocation';
COMMENT ON COLUMN scratchpad_items.content IS 'Type-specific content structure (DirectAnswer, RevenueFramework, TrendAnalysis, or Provocation)';
COMMENT ON COLUMN scratchpad_items.sources IS 'Array of source citations with filing information';
COMMENT ON COLUMN scratchpad_items.saved_from IS 'Reference to original chat message and query';
COMMENT ON COLUMN scratchpad_items.metadata IS 'Additional metadata like ticker, filing period, tags';
