-- Migration: Add parsing review tables for human-in-the-loop workflow
-- Requirements: 8.4, 8.6, 12.2

-- Table: unmapped_xbrl_tags
-- Stores XBRL tags that couldn't be mapped to normalized metrics
CREATE TABLE IF NOT EXISTS unmapped_xbrl_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    xbrl_tag VARCHAR(255) NOT NULL UNIQUE,
    tickers TEXT[] NOT NULL DEFAULT '{}',
    filing_types TEXT[] NOT NULL DEFAULT '{}',
    statement_type VARCHAR(50),
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    first_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'mapped', 'ignored')),
    suggested_mapping VARCHAR(255),
    mapped_by VARCHAR(255),
    mapped_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unmapped_tags_status ON unmapped_xbrl_tags(status);
CREATE INDEX IF NOT EXISTS idx_unmapped_tags_occurrence ON unmapped_xbrl_tags(occurrence_count DESC);
CREATE INDEX IF NOT EXISTS idx_unmapped_tags_statement_type ON unmapped_xbrl_tags(statement_type);

-- Table: xbrl_tag_mappings
-- Stores manually added XBRL tag mappings with version tracking
CREATE TABLE IF NOT EXISTS xbrl_tag_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    xbrl_tag VARCHAR(255) NOT NULL,
    normalized_metric VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    statement_type VARCHAR(50) NOT NULL,
    source VARCHAR(50) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto', 'imported')),
    created_by VARCHAR(255),
    version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(xbrl_tag, version)
);

CREATE INDEX IF NOT EXISTS idx_tag_mappings_xbrl_tag ON xbrl_tag_mappings(xbrl_tag);
CREATE INDEX IF NOT EXISTS idx_tag_mappings_normalized ON xbrl_tag_mappings(normalized_metric);
CREATE INDEX IF NOT EXISTS idx_tag_mappings_active ON xbrl_tag_mappings(is_active);

-- Table: validation_failures
-- Stores validation check failures for review
CREATE TABLE IF NOT EXISTS validation_failures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker VARCHAR(20) NOT NULL,
    filing_type VARCHAR(10) NOT NULL,
    fiscal_period VARCHAR(20) NOT NULL,
    check_name VARCHAR(255) NOT NULL,
    check_type VARCHAR(50) NOT NULL,
    expected_value DECIMAL(20, 2) NOT NULL,
    actual_value DECIMAL(20, 2) NOT NULL,
    difference_pct DECIMAL(10, 4) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'overridden', 'acknowledged')),
    resolution TEXT,
    resolved_by VARCHAR(255),
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_validation_failures_status ON validation_failures(status);
CREATE INDEX IF NOT EXISTS idx_validation_failures_ticker ON validation_failures(ticker);
CREATE INDEX IF NOT EXISTS idx_validation_failures_check_type ON validation_failures(check_type);
CREATE INDEX IF NOT EXISTS idx_validation_failures_difference ON validation_failures(difference_pct DESC);

-- Table: reprocessing_queue
-- Queue for filings that need re-processing after mapping updates
CREATE TABLE IF NOT EXISTS reprocessing_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker VARCHAR(20) NOT NULL,
    filing_type VARCHAR(10) NOT NULL,
    fiscal_period VARCHAR(20),
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(ticker, filing_type, fiscal_period, status)
);

CREATE INDEX IF NOT EXISTS idx_reprocessing_queue_status ON reprocessing_queue(status);
CREATE INDEX IF NOT EXISTS idx_reprocessing_queue_ticker ON reprocessing_queue(ticker);

-- Table: audit_log
-- General audit log for compliance tracking
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_unmapped_xbrl_tags_updated_at ON unmapped_xbrl_tags;
CREATE TRIGGER update_unmapped_xbrl_tags_updated_at
    BEFORE UPDATE ON unmapped_xbrl_tags
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_xbrl_tag_mappings_updated_at ON xbrl_tag_mappings;
CREATE TRIGGER update_xbrl_tag_mappings_updated_at
    BEFORE UPDATE ON xbrl_tag_mappings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_validation_failures_updated_at ON validation_failures;
CREATE TRIGGER update_validation_failures_updated_at
    BEFORE UPDATE ON validation_failures
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
