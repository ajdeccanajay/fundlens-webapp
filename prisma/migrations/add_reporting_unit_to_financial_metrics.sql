-- Migration: Add reporting_unit column to financial_metrics table
-- This column stores the original reporting scale from SEC filings
-- Values: 'units', 'thousands', 'millions', 'billions'

-- Add the column with a default value
ALTER TABLE financial_metrics 
ADD COLUMN IF NOT EXISTS reporting_unit VARCHAR(20) DEFAULT 'units';

-- Add index for efficient querying by reporting unit
CREATE INDEX IF NOT EXISTS idx_financial_metrics_reporting_unit 
ON financial_metrics(ticker, reporting_unit);

-- Add comment for documentation
COMMENT ON COLUMN financial_metrics.reporting_unit IS 
'Original reporting scale from SEC filing: units, thousands, millions, billions. Extracted from iXBRL scale attribute.';
