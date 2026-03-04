-- ============================================
-- Add vision_text_s3_key to intel_documents
-- Stores S3 key for vision-extracted text (financial tables from PDF pages)
-- that pdfplumber cannot extract (positioned graphics, charts).
-- ============================================

ALTER TABLE intel_documents
  ADD COLUMN IF NOT EXISTS vision_text_s3_key TEXT;

COMMENT ON COLUMN intel_documents.vision_text_s3_key IS 'S3 key for vision-extracted text (financial tables from PDF page images)';
