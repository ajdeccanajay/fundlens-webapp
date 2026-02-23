-- Instant RAG Document Processing Schema
-- Requirements: 1.1, 1.8, 1.9, 10.4, 11.1, 13.1, 13.2

-- ============================================================
-- INSTANT RAG SESSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS instant_rag_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  deal_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  ticker VARCHAR(10) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Model usage tracking
  sonnet_calls INTEGER DEFAULT 0,
  opus_calls INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  
  -- Processing status
  files_total INTEGER DEFAULT 0,
  files_processed INTEGER DEFAULT 0,
  files_failed INTEGER DEFAULT 0,
  
  -- Foreign keys
  CONSTRAINT fk_instant_rag_sessions_tenant FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_instant_rag_sessions_deal FOREIGN KEY (deal_id) 
    REFERENCES deals(id) ON DELETE CASCADE
);

-- Partial unique index for active sessions (only one active session per user+deal)
CREATE UNIQUE INDEX idx_instant_rag_active_session 
  ON instant_rag_sessions (tenant_id, deal_id, user_id) 
  WHERE status = 'active';

-- Indexes for lookups
CREATE INDEX idx_instant_rag_sessions_tenant ON instant_rag_sessions(tenant_id);
CREATE INDEX idx_instant_rag_sessions_deal ON instant_rag_sessions(deal_id);
CREATE INDEX idx_instant_rag_sessions_user ON instant_rag_sessions(user_id);
CREATE INDEX idx_instant_rag_sessions_status ON instant_rag_sessions(status);
CREATE INDEX idx_instant_rag_sessions_expires ON instant_rag_sessions(expires_at);

-- ============================================================
-- INSTANT RAG DOCUMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS instant_rag_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  tenant_id TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(20) NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  s3_key VARCHAR(500) NOT NULL,
  
  -- Extracted content
  extracted_text TEXT,
  extracted_tables JSONB DEFAULT '[]',
  page_count INTEGER,
  page_images JSONB DEFAULT '[]', -- base64 images for vision
  
  -- Processing status
  processing_status VARCHAR(20) DEFAULT 'pending',
  processing_error TEXT,
  processing_duration_ms INTEGER,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Foreign keys
  CONSTRAINT fk_instant_rag_documents_session FOREIGN KEY (session_id) 
    REFERENCES instant_rag_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_instant_rag_documents_tenant FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) ON DELETE CASCADE
);

-- Index for duplicate detection
CREATE INDEX idx_instant_rag_documents_content_hash 
  ON instant_rag_documents(tenant_id, content_hash);
CREATE INDEX idx_instant_rag_documents_session 
  ON instant_rag_documents(session_id);
CREATE INDEX idx_instant_rag_documents_status 
  ON instant_rag_documents(processing_status);

-- ============================================================
-- INSTANT RAG Q&A LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS instant_rag_qa_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  role VARCHAR(20) NOT NULL, -- 'user' | 'assistant'
  content TEXT NOT NULL,
  model_used VARCHAR(100),
  input_tokens INTEGER,
  output_tokens INTEGER,
  citations JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Foreign key
  CONSTRAINT fk_instant_rag_qa_log_session FOREIGN KEY (session_id) 
    REFERENCES instant_rag_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_instant_rag_qa_log_session 
  ON instant_rag_qa_log(session_id);
CREATE INDEX idx_instant_rag_qa_log_created 
  ON instant_rag_qa_log(created_at);

-- ============================================================
-- INSTANT RAG INTAKE SUMMARIES
-- ============================================================

CREATE TABLE IF NOT EXISTS instant_rag_intake_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  document_type VARCHAR(50),
  reporting_entity VARCHAR(255),
  period_covered VARCHAR(100),
  key_sections JSONB DEFAULT '[]',
  headline_metrics JSONB DEFAULT '[]',
  notable_items JSONB DEFAULT '[]',
  extraction_confidence VARCHAR(20),
  extraction_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Foreign key
  CONSTRAINT fk_instant_rag_intake_summaries_document FOREIGN KEY (document_id) 
    REFERENCES instant_rag_documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_instant_rag_intake_summaries_document 
  ON instant_rag_intake_summaries(document_id);

-- ============================================================
-- INSTANT RAG RATE LIMITS
-- ============================================================

CREATE TABLE IF NOT EXISTS instant_rag_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  deal_id UUID,
  limit_type VARCHAR(50) NOT NULL, -- 'tenant_sessions' | 'user_deal_session'
  current_count INTEGER DEFAULT 0,
  max_count INTEGER NOT NULL,
  window_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  window_duration_seconds INTEGER NOT NULL,
  
  -- Foreign key
  CONSTRAINT fk_instant_rag_rate_limits_tenant FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Unique constraint for rate limit tracking
  CONSTRAINT uq_instant_rag_rate_limits UNIQUE (tenant_id, user_id, deal_id, limit_type)
);

CREATE INDEX idx_instant_rag_rate_limits_tenant 
  ON instant_rag_rate_limits(tenant_id);
CREATE INDEX idx_instant_rag_rate_limits_lookup 
  ON instant_rag_rate_limits(tenant_id, user_id, deal_id, limit_type);

-- ============================================================
-- INSTANT RAG SYNC ENVELOPES
-- ============================================================

CREATE TABLE IF NOT EXISTS instant_rag_sync_envelopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  tenant_id TEXT NOT NULL,
  deal_id UUID NOT NULL,
  ticker VARCHAR(10) NOT NULL,
  
  -- Sync status
  status VARCHAR(20) DEFAULT 'pending', -- 'pending' | 'syncing' | 'completed' | 'failed'
  s3_upload_status VARCHAR(20) DEFAULT 'pending',
  kb_ingestion_status VARCHAR(20) DEFAULT 'pending',
  rds_sync_status VARCHAR(20) DEFAULT 'pending',
  
  -- Sync metadata
  s3_path VARCHAR(500),
  kb_data_source_id VARCHAR(100),
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  
  -- Envelope content (stored as JSONB for flexibility)
  envelope_data JSONB NOT NULL,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  
  -- Foreign keys
  CONSTRAINT fk_instant_rag_sync_envelopes_session FOREIGN KEY (session_id) 
    REFERENCES instant_rag_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_instant_rag_sync_envelopes_tenant FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_instant_rag_sync_envelopes_session 
  ON instant_rag_sync_envelopes(session_id);
CREATE INDEX idx_instant_rag_sync_envelopes_status 
  ON instant_rag_sync_envelopes(status);
CREATE INDEX idx_instant_rag_sync_envelopes_tenant 
  ON instant_rag_sync_envelopes(tenant_id);

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON TABLE instant_rag_sessions IS 'Tracks active instant RAG upload and Q&A sessions';
COMMENT ON TABLE instant_rag_documents IS 'Documents uploaded within an instant RAG session';
COMMENT ON TABLE instant_rag_qa_log IS 'Q&A conversation log for instant RAG sessions';
COMMENT ON TABLE instant_rag_intake_summaries IS 'Auto-generated summaries for uploaded documents';
COMMENT ON TABLE instant_rag_rate_limits IS 'Rate limiting for concurrent sessions per tenant/user';
COMMENT ON TABLE instant_rag_sync_envelopes IS 'Sync envelopes for persisting session data to S3/KB/RDS';
