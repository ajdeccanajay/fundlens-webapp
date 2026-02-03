-- Multi-Tenant Architecture Migration
-- This adds complete tenant isolation and data access control

-- ============================================
-- TENANT MANAGEMENT
-- ============================================

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  tier VARCHAR(50) NOT NULL DEFAULT 'free',
  status VARCHAR(50) DEFAULT 'active',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'viewer',
  permissions JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_user ON tenant_users(user_id);

-- ============================================
-- DATA ACCESS CONTROL
-- ============================================

CREATE TABLE IF NOT EXISTS data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,
  source_id VARCHAR(255) NOT NULL,
  visibility VARCHAR(50) NOT NULL DEFAULT 'public',
  owner_tenant_id UUID REFERENCES tenants(id),
  s3_path VARCHAR(500) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_data_sources_type ON data_sources(type, visibility);
CREATE INDEX IF NOT EXISTS idx_data_sources_owner ON data_sources(owner_tenant_id);

CREATE TABLE IF NOT EXISTS tenant_data_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  data_source_id UUID REFERENCES data_sources(id) ON DELETE CASCADE,
  access_type VARCHAR(50) NOT NULL DEFAULT 'read',
  granted_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  
  UNIQUE(tenant_id, data_source_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_access ON tenant_data_access(tenant_id, data_source_id);

-- ============================================
-- UPDATE EXISTING TABLES FOR MULTI-TENANCY
-- ============================================

-- Add data_source_id to financial_metrics table
ALTER TABLE financial_metrics ADD COLUMN IF NOT EXISTS data_source_id UUID REFERENCES data_sources(id);
CREATE INDEX IF NOT EXISTS idx_financial_metrics_source ON financial_metrics(data_source_id);

-- Add data_source_id to narrative_chunks table
ALTER TABLE narrative_chunks ADD COLUMN IF NOT EXISTS data_source_id UUID REFERENCES data_sources(id);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON narrative_chunks(data_source_id);

-- ============================================
-- USER UPLOADS
-- ============================================

CREATE TABLE IF NOT EXISTS uploaded_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  original_filename VARCHAR(500) NOT NULL,
  file_type VARCHAR(50) NOT NULL,
  file_size BIGINT NOT NULL,
  s3_path VARCHAR(500) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  processed_at TIMESTAMP,
  extracted_text TEXT,
  extracted_metrics JSONB,
  tags VARCHAR(100)[],
  description TEXT,
  metadata JSONB DEFAULT '{}',
  uploaded_by VARCHAR(255) NOT NULL,
  uploaded_at TIMESTAMP DEFAULT NOW(),
  data_source_id UUID REFERENCES data_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_uploads_tenant ON uploaded_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploaded_documents(status);

-- ============================================
-- NEWS ARTICLES
-- ============================================

CREATE TABLE IF NOT EXISTS news_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id VARCHAR(255) UNIQUE NOT NULL,
  source VARCHAR(100) NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  url VARCHAR(500),
  tickers VARCHAR(10)[],
  topics VARCHAR(100)[],
  sentiment VARCHAR(20),
  published_at TIMESTAMP NOT NULL,
  visibility VARCHAR(50) NOT NULL DEFAULT 'public',
  s3_path VARCHAR(500) NOT NULL,
  data_source_id UUID REFERENCES data_sources(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_tickers ON news_articles USING GIN(tickers);
CREATE INDEX IF NOT EXISTS idx_news_published ON news_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_source ON news_articles(source, visibility);

-- ============================================
-- SUBSCRIPTIONS
-- ============================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_type VARCHAR(100) NOT NULL,
  provider VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  started_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP,
  access_rules JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id, status);

-- ============================================
-- USAGE TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  query_type VARCHAR(50) NOT NULL,
  query_text TEXT,
  data_sources_accessed UUID[],
  metrics_retrieved INTEGER DEFAULT 0,
  chunks_retrieved INTEGER DEFAULT 0,
  cost NUMERIC(10,6) NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  model_used VARCHAR(100),
  latency_ms INTEGER,
  user_id VARCHAR(255),
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_tenant ON usage_logs(tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_logs(timestamp);

-- ============================================
-- S3 SYNC STATE
-- ============================================

CREATE TABLE IF NOT EXISTS s3_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker VARCHAR(10) NOT NULL,
  filing_type VARCHAR(10) NOT NULL,
  last_sync_at TIMESTAMP NOT NULL,
  last_filing_date DATE,
  files_synced INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'success',
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(ticker, filing_type)
);

CREATE INDEX IF NOT EXISTS idx_sync_state_ticker ON s3_sync_state(ticker);
CREATE INDEX IF NOT EXISTS idx_sync_state_updated ON s3_sync_state(updated_at DESC);

-- ============================================
-- VIEWS FOR EASY ACCESS
-- ============================================

-- View: Tenant's accessible data sources
CREATE OR REPLACE VIEW tenant_accessible_data AS
SELECT 
  t.id as tenant_id,
  t.name as tenant_name,
  ds.id as data_source_id,
  ds.type as data_type,
  ds.source_id,
  ds.visibility,
  ds.s3_path,
  ds.metadata,
  CASE 
    WHEN ds.visibility = 'public' THEN true
    WHEN ds.owner_tenant_id = t.id THEN true
    WHEN tda.tenant_id IS NOT NULL THEN true
    ELSE false
  END as has_access
FROM tenants t
CROSS JOIN data_sources ds
LEFT JOIN tenant_data_access tda ON tda.tenant_id = t.id AND tda.data_source_id = ds.id
WHERE 
  ds.visibility = 'public'
  OR ds.owner_tenant_id = t.id
  OR tda.tenant_id IS NOT NULL;

-- View: Tenant's metrics (with access control)
CREATE OR REPLACE VIEW tenant_metrics AS
SELECT 
  tad.tenant_id,
  m.*
FROM financial_metrics m
JOIN tenant_accessible_data tad ON tad.data_source_id = m.data_source_id
WHERE tad.has_access = true;

-- View: Tenant's narrative chunks (with access control)
CREATE OR REPLACE VIEW tenant_narratives AS
SELECT 
  tad.tenant_id,
  nc.*
FROM narrative_chunks nc
JOIN tenant_accessible_data tad ON tad.data_source_id = nc.data_source_id
WHERE tad.has_access = true;

-- ============================================
-- DEFAULT TENANT (for existing data)
-- ============================================

-- Create default tenant for existing data
INSERT INTO tenants (id, name, slug, tier, status)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'Default Tenant',
  'default',
  'enterprise',
  'active'
)
ON CONFLICT (slug) DO NOTHING;

-- Create data sources for existing SEC filings
INSERT INTO data_sources (type, source_id, visibility, owner_tenant_id, s3_path, metadata)
SELECT 
  'sec_filing',
  ticker || '-' || filing_type || '-' || fiscal_period,
  'public',
  NULL,
  'public/sec-filings/processed/' || ticker || '/' || filing_type || '/' || fiscal_period,
  jsonb_build_object(
    'ticker', ticker,
    'filing_type', filing_type,
    'fiscal_period', fiscal_period
  )
FROM (
  SELECT DISTINCT ticker, filing_type, fiscal_period
  FROM financial_metrics
  WHERE data_source_id IS NULL
) AS distinct_filings
ON CONFLICT (type, source_id) DO NOTHING;

-- Link existing metrics to data sources
UPDATE financial_metrics m
SET data_source_id = ds.id
FROM data_sources ds
WHERE m.data_source_id IS NULL
  AND ds.type = 'sec_filing'
  AND ds.source_id = m.ticker || '-' || m.filing_type || '-' || m.fiscal_period;

-- Link existing narrative chunks to data sources (if fiscal_period exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'narrative_chunks' AND column_name = 'fiscal_period') THEN
    UPDATE narrative_chunks nc
    SET data_source_id = ds.id
    FROM data_sources ds
    WHERE nc.data_source_id IS NULL
      AND ds.type = 'sec_filing'
      AND ds.source_id = nc.ticker || '-' || nc.filing_type || '-' || COALESCE(nc.fiscal_period, 'unknown');
  END IF;
END $$;
