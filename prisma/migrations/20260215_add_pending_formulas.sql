-- Migration: Add pending_formulas table for admin formula management workflow
-- Feature: metric-resolution-architecture (Phase 6)
-- Requirements: 17.8

CREATE TABLE IF NOT EXISTS "pending_formulas" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "canonical_id"      VARCHAR(255) NOT NULL,
  "display_name"      VARCHAR(255) NOT NULL,
  "formula"           TEXT NOT NULL,
  "dependencies"      JSONB NOT NULL DEFAULT '[]',
  "output_format"     VARCHAR(50) NOT NULL,
  "category"          VARCHAR(100) NOT NULL,
  "industry"          VARCHAR(100) NOT NULL DEFAULT 'all',
  "asset_class"       JSONB NOT NULL DEFAULT '["public_equity"]',
  "interpretation"    JSONB,
  "synonyms"          JSONB,
  "calculation_notes" TEXT,
  "submitted_by"      VARCHAR(255) NOT NULL,
  "reviewed_by"       VARCHAR(255),
  "status"            VARCHAR(30) NOT NULL DEFAULT 'pending_review',
  "rejection_reason"  TEXT,
  "submitted_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "reviewed_at"       TIMESTAMPTZ(6)
);

-- Index on status for filtering pending/approved/rejected formulas
CREATE INDEX IF NOT EXISTS "idx_pending_formulas_status"
  ON "pending_formulas" ("status");

-- Index on submitted_at for chronological listing
CREATE INDEX IF NOT EXISTS "idx_pending_formulas_submitted_at"
  ON "pending_formulas" ("submitted_at");
