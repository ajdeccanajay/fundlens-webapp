-- Pipeline State Tracking Migration
-- Adds database-backed pipeline execution tracking to survive backend restarts

-- Pipeline execution tracking table
CREATE TABLE IF NOT EXISTS pipeline_execution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  ticker VARCHAR(10) NOT NULL,
  overall_status VARCHAR(20) NOT NULL DEFAULT 'running',
  current_step VARCHAR(10) NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  last_heartbeat_at TIMESTAMP NOT NULL DEFAULT NOW(),
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Pipeline step tracking table
CREATE TABLE IF NOT EXISTS pipeline_step (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_execution_id UUID NOT NULL REFERENCES pipeline_execution(id) ON DELETE CASCADE,
  step_id VARCHAR(10) NOT NULL,
  step_name VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  message TEXT,
  progress INTEGER DEFAULT 0,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  details JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_pipeline_execution_deal_id ON pipeline_execution(deal_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_execution_ticker ON pipeline_execution(ticker);
CREATE INDEX IF NOT EXISTS idx_pipeline_execution_status ON pipeline_execution(overall_status);
CREATE INDEX IF NOT EXISTS idx_pipeline_execution_heartbeat ON pipeline_execution(last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_step_execution_id ON pipeline_step(pipeline_execution_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_step_status ON pipeline_step(status);

-- Add comments for documentation
COMMENT ON TABLE pipeline_execution IS 'Tracks pipeline execution state in database to survive backend restarts';
COMMENT ON COLUMN pipeline_execution.last_heartbeat_at IS 'Updated every 30s during execution. Used to detect stale/crashed pipelines (timeout: 15 minutes for large SEC filings)';
COMMENT ON TABLE pipeline_step IS 'Tracks individual pipeline step progress';
