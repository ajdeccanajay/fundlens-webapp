-- KB Sync Tracking Table
-- Tracks which tickers have been synced to Bedrock KB to avoid redundant full scans
-- 
-- PROBLEM: Bedrock KB scans ALL 87K+ documents on every ingestion job, even for incremental updates
-- SOLUTION: Track sync status per ticker, only trigger KB ingestion for truly new tickers

CREATE TABLE IF NOT EXISTS kb_sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker VARCHAR(20) NOT NULL,
  chunks_in_s3 INTEGER NOT NULL DEFAULT 0,
  chunks_in_rds INTEGER NOT NULL DEFAULT 0,
  last_s3_upload_at TIMESTAMP WITH TIME ZONE,
  last_kb_sync_at TIMESTAMP WITH TIME ZONE,
  kb_sync_job_id VARCHAR(100),
  kb_sync_status VARCHAR(50) DEFAULT 'pending', -- pending, synced, failed
  needs_kb_sync BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(ticker)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_kb_sync_status_ticker ON kb_sync_status(ticker);
CREATE INDEX IF NOT EXISTS idx_kb_sync_status_needs_sync ON kb_sync_status(needs_kb_sync);

-- Batch sync tracking table
-- Tracks batched KB sync jobs that cover multiple tickers
CREATE TABLE IF NOT EXISTS kb_batch_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(100) NOT NULL,
  tickers TEXT[] NOT NULL,
  status VARCHAR(50) DEFAULT 'in_progress', -- in_progress, complete, failed
  documents_scanned INTEGER DEFAULT 0,
  documents_indexed INTEGER DEFAULT 0,
  documents_failed INTEGER DEFAULT 0,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_batch_sync_job_id ON kb_batch_sync(job_id);
CREATE INDEX IF NOT EXISTS idx_kb_batch_sync_status ON kb_batch_sync(status);
