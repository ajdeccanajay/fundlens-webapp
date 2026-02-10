-- Provocations Engine Schema Extensions
-- Requirements: 1.5, 10.2, 10.3

-- Add content_hash to narrative_chunks for change detection
ALTER TABLE narrative_chunks ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

-- Create index on content_hash for fast lookups
CREATE INDEX IF NOT EXISTS idx_narrative_chunks_content_hash ON narrative_chunks(content_hash);

-- Section diffs table (pre-computed comparisons between filing sections)
CREATE TABLE IF NOT EXISTS section_diffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_chunk_id TEXT NOT NULL,
  target_chunk_id TEXT NOT NULL,
  diff_data JSONB NOT NULL DEFAULT '{}',
  similarity_score FLOAT,
  computed_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_section_diffs_source FOREIGN KEY (source_chunk_id) REFERENCES narrative_chunks(id) ON DELETE CASCADE,
  CONSTRAINT fk_section_diffs_target FOREIGN KEY (target_chunk_id) REFERENCES narrative_chunks(id) ON DELETE CASCADE
);

CREATE INDEX idx_section_diffs_source ON section_diffs(source_chunk_id);
CREATE INDEX idx_section_diffs_target ON section_diffs(target_chunk_id);
CREATE UNIQUE INDEX idx_section_diffs_pair ON section_diffs(source_chunk_id, target_chunk_id);

-- Provocations table (generated findings)
CREATE TABLE IF NOT EXISTS provocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker VARCHAR(20) NOT NULL,
  analysis_mode VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL,
  category VARCHAR(50) NOT NULL,
  observation TEXT NOT NULL,
  filing_references JSONB NOT NULL DEFAULT '[]',
  cross_filing_delta TEXT,
  implication TEXT NOT NULL,
  challenge_question TEXT NOT NULL,
  source_classifications JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE INDEX idx_provocations_ticker ON provocations(ticker);
CREATE INDEX idx_provocations_ticker_mode ON provocations(ticker, analysis_mode);
CREATE INDEX idx_provocations_severity ON provocations(severity);

-- Provocations cache table (for fast retrieval)
CREATE TABLE IF NOT EXISTS provocations_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker VARCHAR(20) NOT NULL,
  analysis_mode VARCHAR(50) NOT NULL,
  provocations JSONB NOT NULL DEFAULT '[]',
  source_documents TEXT[] NOT NULL DEFAULT '{}',
  computed_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_provocations_cache_ticker_mode ON provocations_cache(ticker, analysis_mode);
CREATE INDEX idx_provocations_cache_expires ON provocations_cache(expires_at);

-- Research query counter (for auto-generation trigger)
CREATE TABLE IF NOT EXISTS research_query_counter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker VARCHAR(20) NOT NULL,
  query_count INTEGER DEFAULT 0,
  last_query_at TIMESTAMP,
  provocations_generated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_research_query_counter_ticker ON research_query_counter(ticker);
