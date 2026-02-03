-- Fix Deal Pipeline Schema Issues
-- Add missing columns to deals table

-- Add missing columns to deals table
ALTER TABLE deals ADD COLUMN IF NOT EXISTS years INTEGER DEFAULT 3;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS processing_message TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS news_data JSONB;

-- Add missing columns to analysis_sessions table
ALTER TABLE analysis_sessions ADD COLUMN IF NOT EXISTS session_name VARCHAR(255) DEFAULT 'Main Analysis';
ALTER TABLE analysis_sessions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Add missing columns to scratch_pads table
ALTER TABLE scratch_pads ADD COLUMN IF NOT EXISTS title VARCHAR(255) DEFAULT 'Investment Analysis';

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_deals_ticker_status ON deals(ticker, status);
CREATE INDEX IF NOT EXISTS idx_deals_processing ON deals(status) WHERE status IN ('processing', 'error');
CREATE INDEX IF NOT EXISTS idx_analysis_sessions_active ON analysis_sessions(deal_id, is_active);

-- Update existing records to have default values
UPDATE deals SET years = 3 WHERE years IS NULL;
UPDATE analysis_sessions SET session_name = 'Main Analysis' WHERE session_name IS NULL;
UPDATE analysis_sessions SET is_active = true WHERE is_active IS NULL;
UPDATE scratch_pads SET title = 'Investment Analysis' WHERE title IS NULL;