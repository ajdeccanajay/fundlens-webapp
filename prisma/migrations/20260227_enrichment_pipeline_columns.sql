-- 20260227_enrichment_pipeline_columns.sql
-- Addendum: Serial Pipeline Architecture for Background Enrichment

ALTER TABLE intel_document_extractions
  ADD COLUMN IF NOT EXISTS extraction_mode VARCHAR(20) DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS page_number INTEGER;

ALTER TABLE intel_documents
  ADD COLUMN IF NOT EXISTS upload_method VARCHAR(20) DEFAULT 'direct';

COMMENT ON COLUMN intel_document_extractions.extraction_mode IS 'How this extraction was produced: headline, pdf-native, text-only';
COMMENT ON COLUMN intel_documents.upload_method IS 'How the file was uploaded: direct (server passthrough) or presigned (S3 direct)';
