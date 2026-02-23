-- Instant RAG Sync Log Table
-- Tracks KB ingestion triggers and sync completions for audit trail
-- Requirements: 8.1, 8.5, 8.6

CREATE TABLE IF NOT EXISTS instant_rag_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  deal_id UUID NOT NULL,
  
  -- Event tracking
  event_type VARCHAR(50) NOT NULL, -- 'kb_ingestion_trigger' | 'sync_complete'
  status VARCHAR(20) NOT NULL, -- 'triggered' | 'failed' | 'success' | 'partial'
  
  -- Retry tracking (for kb_ingestion_trigger)
  attempts INTEGER DEFAULT 0,
  error_message TEXT,
  
  -- Sync metrics (for sync_complete)
  chunks_uploaded INTEGER,
  duration_ms INTEGER,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Foreign keys
  CONSTRAINT fk_instant_rag_sync_log_session FOREIGN KEY (session_id) 
    REFERENCES instant_rag_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_instant_rag_sync_log_tenant FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) ON DELETE CASCADE
);

-- Indexes for lookups
CREATE INDEX idx_instant_rag_sync_log_session ON instant_rag_sync_log(session_id);
CREATE INDEX idx_instant_rag_sync_log_tenant ON instant_rag_sync_log(tenant_id);
CREATE INDEX idx_instant_rag_sync_log_event_type ON instant_rag_sync_log(event_type);
CREATE INDEX idx_instant_rag_sync_log_created ON instant_rag_sync_log(created_at);

COMMENT ON TABLE instant_rag_sync_log IS 'Audit log for KB ingestion triggers and sync completions';
