-- Migration: Add MetricResolutionLog table
-- Feature: metric-resolution-architecture
-- Requirements: 12.1, 12.2
-- Tracks all metric resolution attempts for the learning loop

CREATE TABLE IF NOT EXISTS "metric_resolution_log" (
  "id"          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"   TEXT         NOT NULL,
  "raw_query"   TEXT         NOT NULL,
  "confidence"  VARCHAR(20)  NOT NULL,
  "resolved_to" VARCHAR(255),
  "suggestions" TEXT[]       DEFAULT '{}',
  "user_choice" VARCHAR(255),
  "timestamp"   TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

-- Index for querying resolution logs by tenant and time range
CREATE INDEX IF NOT EXISTS "idx_metric_resolution_log_tenant_ts"
  ON "metric_resolution_log" ("tenant_id", "timestamp");

-- Index for filtering by confidence level (e.g., finding all "unresolved" queries)
CREATE INDEX IF NOT EXISTS "idx_metric_resolution_log_confidence_ts"
  ON "metric_resolution_log" ("confidence", "timestamp");
