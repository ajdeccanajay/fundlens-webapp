-- Pipeline Full Spec: Add extraction_mode and upload_method columns
-- Date: 2026-02-27

-- Track how the document was uploaded (presigned PUT vs old direct upload)
ALTER TABLE intel_documents
  ADD COLUMN IF NOT EXISTS upload_method VARCHAR(20) DEFAULT 'direct';
-- Values: 'direct' (old server-passthrough), 'presigned' (new S3-direct)

-- Track extraction mode on extractions (headline, pdf-native, text-only)
ALTER TABLE intel_document_extractions
  ADD COLUMN IF NOT EXISTS extraction_mode VARCHAR(20) DEFAULT 'unknown';
-- Values: 'headline', 'pdf-native', 'text-only'

-- Ensure page_number column exists on extractions (may already exist)
ALTER TABLE intel_document_extractions
  ADD COLUMN IF NOT EXISTS page_number INTEGER;
