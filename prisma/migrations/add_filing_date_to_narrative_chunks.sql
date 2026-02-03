-- Migration: Add filing_date to narrative_chunks table
-- This fixes the critical bug where chunks from different filings were being overwritten
-- because the unique identification didn't include the filing date.

-- Step 1: Add the filing_date column (nullable initially)
ALTER TABLE narrative_chunks 
ADD COLUMN IF NOT EXISTS filing_date TIMESTAMP;

-- Step 2: Backfill filing_date from filing_metadata for existing chunks
-- This uses the filing_metadata table to get the correct filing date
UPDATE narrative_chunks nc
SET filing_date = fm.filing_date
FROM filing_metadata fm
WHERE nc.ticker = fm.ticker 
  AND nc.filing_type = fm.filing_type
  AND nc.filing_date IS NULL;

-- Step 3: For any remaining chunks without a filing date, set to a default
-- (This handles edge cases where filing_metadata might not exist)
UPDATE narrative_chunks
SET filing_date = created_at
WHERE filing_date IS NULL;

-- Step 4: Make filing_date NOT NULL now that all rows have values
ALTER TABLE narrative_chunks 
ALTER COLUMN filing_date SET NOT NULL;

-- Step 5: Create the new unique constraint
-- This ensures chunks from different filings are stored separately
CREATE UNIQUE INDEX IF NOT EXISTS narrative_chunks_ticker_filing_type_filing_date_section_type_chunk_index_key
ON narrative_chunks (ticker, filing_type, filing_date, section_type, chunk_index);

-- Step 6: Add index for efficient queries by ticker and filing_date
CREATE INDEX IF NOT EXISTS narrative_chunks_ticker_filing_date_idx
ON narrative_chunks (ticker, filing_date);

-- Verify the migration
SELECT 
  'narrative_chunks' as table_name,
  COUNT(*) as total_rows,
  COUNT(filing_date) as rows_with_filing_date,
  COUNT(*) - COUNT(filing_date) as rows_without_filing_date
FROM narrative_chunks;
