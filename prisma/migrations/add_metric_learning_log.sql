-- Metric Learning Log Table
-- Tracks unrecognized metrics and queries for the Learning Agent

CREATE TABLE IF NOT EXISTS metric_learning_log (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL,
  ticker VARCHAR(10) NOT NULL,
  query TEXT NOT NULL,
  requested_metric VARCHAR(255) NOT NULL,
  metric_category VARCHAR(50) DEFAULT 'financial',
  failure_reason TEXT NOT NULL,
  user_message TEXT NOT NULL,
  request_count INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMP,
  resolution_notes TEXT,
  
  -- Unique constraint to prevent duplicate entries
  CONSTRAINT unique_tenant_ticker_metric UNIQUE (tenant_id, ticker, requested_metric)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_metric_learning_tenant ON metric_learning_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_metric_learning_ticker ON metric_learning_log(ticker);
CREATE INDEX IF NOT EXISTS idx_metric_learning_metric ON metric_learning_log(requested_metric);
CREATE INDEX IF NOT EXISTS idx_metric_learning_count ON metric_learning_log(request_count DESC);
CREATE INDEX IF NOT EXISTS idx_metric_learning_unresolved ON metric_learning_log(resolved) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_metric_learning_last_requested ON metric_learning_log(last_requested_at DESC);

-- Comments
COMMENT ON TABLE metric_learning_log IS 'Tracks unrecognized metrics for the Learning Agent to prioritize and implement';
COMMENT ON COLUMN metric_learning_log.request_count IS 'Number of times this metric has been requested';
COMMENT ON COLUMN metric_learning_log.resolved IS 'Whether the learning agent has added support for this metric';
