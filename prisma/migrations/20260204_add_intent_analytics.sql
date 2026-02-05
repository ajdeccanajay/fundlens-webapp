-- Intent Analytics Schema
-- Tracks intent detection performance per tenant for learning and optimization

CREATE TABLE intent_detection_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(255) NOT NULL,
  query TEXT NOT NULL,
  detected_intent JSONB NOT NULL,
  detection_method VARCHAR(50) NOT NULL, -- 'regex', 'llm', 'generic'
  confidence DECIMAL(3,2) NOT NULL,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  latency_ms INTEGER NOT NULL,
  llm_cost_usd DECIMAL(10,6), -- Track LLM costs
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_intent_logs_tenant ON intent_detection_logs(tenant_id);
CREATE INDEX idx_intent_logs_method ON intent_detection_logs(detection_method);
CREATE INDEX idx_intent_logs_created ON intent_detection_logs(created_at DESC);
CREATE INDEX idx_intent_logs_success ON intent_detection_logs(success);

-- Aggregated metrics per tenant (updated periodically)
CREATE TABLE intent_analytics_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(255) NOT NULL,
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  total_queries INTEGER NOT NULL DEFAULT 0,
  regex_success_count INTEGER NOT NULL DEFAULT 0,
  llm_fallback_count INTEGER NOT NULL DEFAULT 0,
  generic_fallback_count INTEGER NOT NULL DEFAULT 0,
  failed_queries_count INTEGER NOT NULL DEFAULT 0,
  avg_confidence DECIMAL(3,2),
  avg_latency_ms INTEGER,
  total_llm_cost_usd DECIMAL(10,4),
  top_failed_patterns JSONB, -- Array of {query, count}
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, period_start, period_end)
);

CREATE INDEX idx_analytics_summary_tenant ON intent_analytics_summary(tenant_id);
CREATE INDEX idx_analytics_summary_period ON intent_analytics_summary(period_start DESC);

-- Failed query patterns for learning
CREATE TABLE intent_failed_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(255) NOT NULL,
  query_pattern TEXT NOT NULL, -- Normalized query pattern
  example_queries TEXT[] NOT NULL, -- Array of actual queries
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  suggested_regex TEXT, -- AI-suggested regex pattern
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'reviewed', 'implemented', 'rejected'
  reviewed_by VARCHAR(255),
  reviewed_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_failed_patterns_tenant ON intent_failed_patterns(tenant_id);
CREATE INDEX idx_failed_patterns_status ON intent_failed_patterns(status);
CREATE INDEX idx_failed_patterns_count ON intent_failed_patterns(occurrence_count DESC);

COMMENT ON TABLE intent_detection_logs IS 'Logs every intent detection attempt for analysis and learning';
COMMENT ON TABLE intent_analytics_summary IS 'Aggregated metrics per tenant for dashboard display';
COMMENT ON TABLE intent_failed_patterns IS 'Tracks failed query patterns for regex improvement suggestions';
