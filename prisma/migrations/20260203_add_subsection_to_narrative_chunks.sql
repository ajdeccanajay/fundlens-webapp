-- Migration: Add subsection_name column to narrative_chunks
-- Phase 1: Core Subsection Extraction and Storage
-- Requirements: 15.1, 15.3
-- Date: 2026-02-03

-- Add subsection_name column (nullable for backward compatibility)
ALTER TABLE narrative_chunks 
ADD COLUMN IF NOT EXISTS subsection_name TEXT NULL;

-- Create index for efficient subsection filtering
CREATE INDEX IF NOT EXISTS idx_narrative_chunks_subsection 
ON narrative_chunks(ticker, section_type, subsection_name);

-- Add comment to document the column
COMMENT ON COLUMN narrative_chunks.subsection_name IS 
'Fine-grained subsection within major SEC sections (e.g., Competition within Item 1, Results of Operations within Item 7). NULL for sections without identified subsections.';

-- Verify migration
DO $$
BEGIN
    -- Check if column exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'narrative_chunks' 
        AND column_name = 'subsection_name'
    ) THEN
        RAISE NOTICE 'Migration successful: subsection_name column added to narrative_chunks';
    ELSE
        RAISE EXCEPTION 'Migration failed: subsection_name column not found';
    END IF;
    
    -- Check if index exists
    IF EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE tablename = 'narrative_chunks' 
        AND indexname = 'idx_narrative_chunks_subsection'
    ) THEN
        RAISE NOTICE 'Migration successful: idx_narrative_chunks_subsection index created';
    ELSE
        RAISE EXCEPTION 'Migration failed: idx_narrative_chunks_subsection index not found';
    END IF;
END $$;
