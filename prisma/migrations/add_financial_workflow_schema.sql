-- Financial Analyst Workflow Schema
-- Migration: Add tables for deal management, analysis sessions, and chat functionality

-- Deals table for managing financial analysis projects
CREATE TABLE deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    deal_type VARCHAR(20) NOT NULL CHECK (deal_type IN ('public', 'private')),
    ticker VARCHAR(10),
    company_name VARCHAR(255),
    report_type VARCHAR(20) CHECK (report_type IN ('quarterly', 'annual')),
    time_periods INTEGER DEFAULT 3,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in-progress', 'review', 'closed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(255), -- For future multi-user support
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Analysis sessions for each deal
CREATE TABLE analysis_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    system_prompt TEXT DEFAULT 'You are a financial analyst assistant specializing in SEC filings analysis, financial metrics calculation, and investment research. Provide accurate, well-sourced analysis with proper citations.',
    session_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true
);

-- Chat messages for AI conversations
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES analysis_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    sources JSONB DEFAULT '[]'::jsonb, -- Array of source citations
    metadata JSONB DEFAULT '{}'::jsonb, -- Additional context, tokens, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    tokens_used INTEGER DEFAULT 0
);

-- Scratch pad content for investment memos
CREATE TABLE scratch_pads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    title VARCHAR(255) DEFAULT 'Investment Analysis',
    content TEXT DEFAULT '',
    content_type VARCHAR(20) DEFAULT 'markdown' CHECK (content_type IN ('markdown', 'html', 'plain')),
    auto_saved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    manually_saved_at TIMESTAMP WITH TIME ZONE,
    version INTEGER DEFAULT 1
);

-- Financial metrics cache for quick access
CREATE TABLE deal_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    ticker VARCHAR(10) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(20,4),
    period VARCHAR(20), -- Q1_2024, FY_2023, etc.
    filing_type VARCHAR(10), -- 10-K, 10-Q, 8-K
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source_filing_id UUID, -- Reference to filing metadata if available
    UNIQUE(deal_id, ticker, metric_name, period)
);

-- Market data cache (Yahoo Finance integration)
CREATE TABLE market_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker VARCHAR(10) NOT NULL,
    data_type VARCHAR(50) NOT NULL, -- 'price', 'news', 'fundamentals'
    data_value JSONB NOT NULL,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(ticker, data_type)
);

-- Indexes for performance
CREATE INDEX idx_deals_ticker ON deals(ticker);
CREATE INDEX idx_deals_status ON deals(status);
CREATE INDEX idx_deals_created_at ON deals(created_at DESC);
CREATE INDEX idx_analysis_sessions_deal_id ON analysis_sessions(deal_id);
CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at DESC);
CREATE INDEX idx_scratch_pads_deal_id ON scratch_pads(deal_id);
CREATE INDEX idx_deal_metrics_deal_ticker ON deal_metrics(deal_id, ticker);
CREATE INDEX idx_market_data_ticker_type ON market_data(ticker, data_type);

-- Update trigger for deals table
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON deals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_analysis_sessions_updated_at BEFORE UPDATE ON analysis_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE deals IS 'Financial analysis deals/projects for both public and private companies';
COMMENT ON TABLE analysis_sessions IS 'AI analysis sessions within each deal';
COMMENT ON TABLE chat_messages IS 'Chat conversation history with AI assistant';
COMMENT ON TABLE scratch_pads IS 'Investment memo drafts and notes';
COMMENT ON TABLE deal_metrics IS 'Cached financial metrics for quick access';
COMMENT ON TABLE market_data IS 'Cached market data from Yahoo Finance and other sources';