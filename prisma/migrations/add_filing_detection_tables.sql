-- Migration: Add Filing Detection Tables
-- Date: 2026-02-09
-- Description: Add tables for automatic filing detection system

-- Filing detection state (tracks last check per ticker)
CREATE TABLE IF NOT EXISTS filing_detection_state (
  ticker VARCHAR(20) PRIMARY KEY,
  last_check_date TIMESTAMP NOT NULL DEFAULT NOW(),
  last_filing_date TIMESTAMP,
  check_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_filing_detection_last_check ON filing_detection_state(last_check_date);

-- Filing notifications (tenant-scoped)
CREATE TABLE IF NOT EXISTS filing_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(255) NOT NULL,
  ticker VARCHAR(20) NOT NULL,
  filing_type VARCHAR(10) NOT NULL,
  filing_date DATE NOT NULL,
  report_date DATE,
  accession_number VARCHAR(50) NOT NULL,
  dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_filing_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_filing_notifs_tenant ON filing_notifications(tenant_id, dismissed);
CREATE INDEX IF NOT EXISTS idx_filing_notifs_ticker ON filing_notifications(ticker);
CREATE INDEX IF NOT EXISTS idx_filing_notifs_created ON filing_notifications(created_at);

-- Add comment for documentation
COMMENT ON TABLE filing_detection_state IS 'Tracks the last detection check for each ticker to enable incremental detection';
COMMENT ON TABLE filing_notifications IS 'Tenant-scoped notifications for new SEC filings';
