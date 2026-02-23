# Requirements Document

## Introduction

FundLens Instant RAG is a real-time document processing and Q&A system that enables equity research analysts to upload financial documents (up to 5 files per session) and immediately ask questions about them without waiting for Bedrock Knowledge Base synchronization. The system provides multi-modal extraction (text, tables, charts, images), intelligent model routing (Sonnet for standard queries, Opus for complex cross-document analysis), and async persistence of session artifacts for long-term retrieval.

This feature builds on the existing document upload pipeline, RAG system, and Research Assistant while adding batch upload, expanded file type support, instant Q&A mode, multi-modal vision capabilities, and session sync envelopes.

## Glossary

- **Instant_RAG_Service**: The core service that processes uploaded documents and enables immediate Q&A by passing full document content directly to Claude, bypassing the Bedrock Knowledge Base for real-time responses.
- **Intake_Summary**: An auto-generated summary produced by Claude upon document upload that identifies document type, reporting entity, period covered, headline metrics, and notable items.
- **Sync_Envelope**: A structured JSON payload containing all session artifacts (metrics, chunks, Q&A logs, provocations) that is persisted to RDS and S3 after session completion.
- **Session**: A tenant+deal scoped upload and Q&A context with a unique session_id, limited to 5 files and 600 seconds timeout.
- **Document_Processor**: The service responsible for extracting text, tables, and images from uploaded files across all supported formats.
- **Vision_Pipeline**: The Python-based service that renders PDF pages and PPTX slides to images for multi-modal analysis via Claude's vision API.
- **Model_Router**: The component that routes queries to Sonnet (standard) or Opus (complex cross-document analysis) based on keyword triggers and cost guardrails.
- **Tenant_KB_Datasource**: A Bedrock Knowledge Base data source scoped to a specific tenant+deal combination for complete data isolation.
- **Upload_Zone**: The frontend drag-and-drop component in workspace.html that accepts batch file uploads.
- **Cost_Guardrail**: A per-session limit on expensive operations (max 5 Opus calls) to control costs.

## Requirements

### Requirement 1: Batch File Upload

**User Story:** As an equity research analyst, I want to upload up to 5 financial documents at once, so that I can analyze multiple related documents (10-K, earnings transcript, investor presentation) in a single research session.

#### Acceptance Criteria

1. WHEN a user initiates a batch upload THEN THE Upload_Zone SHALL accept up to 5 files in a single operation
2. WHEN a file exceeds 50MB THEN THE Document_Processor SHALL reject that file with a clear error message while continuing to process valid files
3. WHEN the total upload size exceeds 150MB THEN THE Upload_Zone SHALL reject the entire batch with an error message
4. WHEN a file type is not in the supported list (pdf, docx, xlsx, csv, pptx, txt, png, jpg, jpeg) THEN THE Document_Processor SHALL reject that file with a descriptive error
5. WHEN 3 of 5 files succeed but 2 fail THEN THE Instant_RAG_Service SHALL process the successful files and return a partial success response with error details for failed files
6. WHILE an upload is in progress THEN THE Upload_Zone SHALL display a progress indicator showing per-file status
7. WHEN a user attempts to start a new upload session while one is active THEN THE Instant_RAG_Service SHALL queue the request or return a "session in progress" error
8. THE Instant_RAG_Service SHALL enforce a maximum of 3 concurrent upload sessions per tenant
9. THE Instant_RAG_Service SHALL enforce a maximum of 1 active Instant RAG session per user per deal

### Requirement 2: Expanded File Type Support

**User Story:** As an equity research analyst, I want to upload Excel spreadsheets, PowerPoint presentations, and images, so that I can analyze financial models, investor decks, and chart screenshots alongside SEC filings.

#### Acceptance Criteria

1. WHEN a user uploads an XLSX file THEN THE Document_Processor SHALL extract all sheets as structured tables with headers and data rows
2. WHEN an XLSX file contains more than 10 sheets THEN THE Document_Processor SHALL extract the first 10 sheets and log a warning
3. WHEN an XLSX cell contains a formula THEN THE Document_Processor SHALL extract the calculated value, not the formula text
4. WHEN a user uploads a CSV file THEN THE Document_Processor SHALL parse it using pandas and extract as a single table
5. WHEN a user uploads a PPTX file THEN THE Vision_Pipeline SHALL render each slide to an image at 150 DPI and extract text content
6. WHEN a PPTX file contains more than 100 slides THEN THE Document_Processor SHALL process the first 100 slides and log a warning
7. WHEN a user uploads a PNG or JPG image THEN THE Document_Processor SHALL pass it directly to Claude's vision API for analysis
8. WHEN a user uploads a JPEG file THEN THE Document_Processor SHALL treat it identically to JPG
9. IF a PDF is password-protected THEN THE Document_Processor SHALL return an error indicating the file cannot be processed
10. IF a DOCX file is encrypted THEN THE Document_Processor SHALL return an error indicating the file cannot be processed

### Requirement 3: Intake Summary Generation

**User Story:** As an equity research analyst, I want to see an automatic summary of each uploaded document, so that I can quickly understand what I'm working with before asking questions.

#### Acceptance Criteria

1. WHEN documents are uploaded and the user has not asked a question THEN THE Instant_RAG_Service SHALL generate an intake summary for each document
2. THE Intake_Summary SHALL include document_type (10-K, 10-Q, 8-K, earnings_transcript, investor_presentation, CIM, pitch_deck, due_diligence_report, financial_model, other)
3. THE Intake_Summary SHALL include reporting_entity (company name as it appears in the document)
4. THE Intake_Summary SHALL include period_covered (e.g., "Fiscal Year Ended December 31, 2024")
5. THE Intake_Summary SHALL include page_count
6. THE Intake_Summary SHALL include key_sections_identified as an array
7. THE Intake_Summary SHALL include headline_metrics as an array of {metric, value, period} objects
8. THE Intake_Summary SHALL include notable_items (restatements, material weaknesses, going concern language)
9. THE Intake_Summary SHALL include extraction_confidence (high, medium, low)
10. THE Intake_Summary SHALL include extraction_notes for any issues (poor scan quality, redacted sections)
11. WHEN intake summaries are generated THEN THE Upload_Zone SHALL display them as cards in the workspace

### Requirement 4: Instant Q&A Mode

**User Story:** As an equity research analyst, I want to ask questions about uploaded documents immediately, so that I don't have to wait for Bedrock Knowledge Base synchronization.

#### Acceptance Criteria

1. WHEN a user asks a question in an active session THEN THE Instant_RAG_Service SHALL pass full document content directly to Claude for immediate response
2. THE Instant_RAG_Service SHALL NOT require Bedrock KB sync for session Q&A
3. WHEN answering a deterministic metric query THEN THE Instant_RAG_Service SHALL extract exact figures with value, period, source document, and page number
4. WHEN a metric appears in multiple documents THEN THE Instant_RAG_Service SHALL show all instances and flag discrepancies
5. WHEN answering a narrative query THEN THE Instant_RAG_Service SHALL synthesize across relevant sections with citations [Doc N, p.X]
6. WHEN answering a cross-document query THEN THE Instant_RAG_Service SHALL pull relevant sections from each document and present side-by-side comparison
7. WHEN performing calculations THEN THE Instant_RAG_Service SHALL show work step-by-step with input sources
8. IF inputs are ambiguous (GAAP vs Non-GAAP) THEN THE Instant_RAG_Service SHALL calculate both and note the difference
9. THE Instant_RAG_Service SHALL preserve numeric precision from source documents unless user requests rounding
10. THE Instant_RAG_Service SHALL check footnotes when answering metric queries
11. WHEN extracting tables THEN THE Instant_RAG_Service SHALL extract ALL rows and columns, reconstructing multi-page tables

### Requirement 5: Multi-Modal Vision Analysis

**User Story:** As an equity research analyst, I want the system to analyze charts, graphs, and images in my documents, so that I can ask questions about visual content.

#### Acceptance Criteria

1. WHEN a PDF is uploaded THEN THE Vision_Pipeline SHALL render pages to images at 150 DPI for vision analysis
2. WHEN a user asks about a chart or graph THEN THE Instant_RAG_Service SHALL describe the visual content in detail
3. WHEN analyzing a chart THEN THE Instant_RAG_Service SHALL extract all visible data points
4. WHEN analyzing a chart THEN THE Instant_RAG_Service SHALL provide trend narrative
5. IF a user asks to reproduce a chart THEN THE Instant_RAG_Service SHALL describe the data and reference the original location [Doc N, p.X]
6. WHEN a PPTX is uploaded THEN THE Vision_Pipeline SHALL render slides to images for visual analysis
7. THE Vision_Pipeline SHALL use Claude's vision API with use_vision=true for image analysis
8. IF image quality is poor THEN THE Instant_RAG_Service SHALL flag this in extraction_notes

### Requirement 6: Sonnet/Opus Model Routing

**User Story:** As a platform operator, I want the system to use cost-effective models for simple queries and powerful models for complex analysis, so that I can balance quality and cost.

#### Acceptance Criteria

1. THE Model_Router SHALL use Claude Sonnet for standard extraction and Q&A by default
2. WHEN a query contains trigger keywords (cross-reference, compare, contradict, provocation, why would, doesn't match, inconsistent, what's missing, devil's advocate) THEN THE Model_Router SHALL route to Claude Opus
3. THE Model_Router SHALL enforce a maximum of 5 Opus calls per session
4. WHEN the Opus call limit is reached THEN THE Model_Router SHALL fall back to Sonnet with a notification to the user
5. THE Model_Router SHALL log model selection decisions for cost monitoring
6. THE Model_Router SHALL track per-session token usage for both Sonnet and Opus

### Requirement 7: Sync Envelope Generation

**User Story:** As an equity research analyst, I want my session work to be persisted for future retrieval, so that I can continue research across sessions and share findings with colleagues.

#### Acceptance Criteria

1. WHEN a session ends THEN THE Instant_RAG_Service SHALL generate a sync envelope containing all session artifacts
2. THE Sync_Envelope SHALL include structured_metrics with sync_target=rds
3. THE Sync_Envelope SHALL include document_chunks with sync_target=s3_then_kb
4. THE Sync_Envelope SHALL include session_qa_log with questions_asked count, duration_minutes, and auto-generated summary
5. THE Sync_Envelope SHALL include provocations generated during the session
6. THE Sync_Envelope SHALL use upsert_strategy=merge_on_composite_key for RDS sync
7. THE Sync_Envelope SHALL use conflict_resolution=latest_session_wins
8. THE Sync_Envelope SHALL include tenant_id, workspace_id, deal_id, ticker, session_id, user_id, and created_at
9. WHEN syncing to S3 THEN THE Instant_RAG_Service SHALL use path s3://fundlens-{env}/kb-ready/{tenant_id}/{deal_id}/{session_id}/

### Requirement 8: Async KB Persistence

**User Story:** As a platform operator, I want session documents to be synced to Bedrock Knowledge Base asynchronously, so that they become available for future semantic search without blocking the user.

#### Acceptance Criteria

1. WHEN a session ends THEN THE Instant_RAG_Service SHALL trigger async S3 upload of document chunks
2. WHEN chunks are uploaded to S3 THEN THE Instant_RAG_Service SHALL trigger Bedrock KB ingestion for the tenant+deal data source
3. THE Instant_RAG_Service SHALL use embedding model amazon.titan-embed-text-v2:0 for consistency with existing KB
4. THE Instant_RAG_Service SHALL include chunk metadata (ticker, filing_type, filing_period, section_type, page_numbers, metrics_referenced)
5. IF KB ingestion fails THEN THE Instant_RAG_Service SHALL log the error and retry up to 3 times
6. THE Instant_RAG_Service SHALL NOT block user operations during async sync

### Requirement 9: Per-Tenant KB Isolation

**User Story:** As a platform operator, I want each tenant's documents to be isolated in the Knowledge Base, so that one tenant cannot access another tenant's data.

#### Acceptance Criteria

1. THE Instant_RAG_Service SHALL create or use a dedicated Bedrock KB data source per tenant+deal combination
2. WHEN querying Bedrock KB THEN THE Instant_RAG_Service SHALL filter by tenant_id and deal_id metadata
3. THE Instant_RAG_Service SHALL use S3 path structure s3://fundlens-{env}/kb-ready/{tenant_id}/deal_{deal_id}/ for isolation
4. IF a tenant attempts to query another tenant's data THEN THE Instant_RAG_Service SHALL return empty results
5. THE Instant_RAG_Service SHALL validate tenant_id on all KB operations

### Requirement 10: Duplicate Detection

**User Story:** As an equity research analyst, I want the system to detect duplicate uploads, so that I don't waste processing time on files I've already uploaded.

#### Acceptance Criteria

1. WHEN a file is uploaded THEN THE Document_Processor SHALL compute a content hash (SHA-256)
2. IF a file with the same content hash exists for the tenant+deal THEN THE Document_Processor SHALL return the existing document reference instead of reprocessing
3. WHEN a duplicate is detected THEN THE Upload_Zone SHALL display a notification indicating the file was already uploaded
4. THE Document_Processor SHALL store content_hash in the document record for future comparison

### Requirement 11: Session Timeout and Cleanup

**User Story:** As a platform operator, I want inactive sessions to be cleaned up automatically, so that system resources are not wasted on abandoned sessions.

#### Acceptance Criteria

1. THE Instant_RAG_Service SHALL enforce a 600-second (10-minute) session timeout
2. WHEN a session times out THEN THE Instant_RAG_Service SHALL generate and persist the sync envelope
3. WHEN a session times out THEN THE Instant_RAG_Service SHALL release session resources
4. THE Instant_RAG_Service SHALL extend session timeout on user activity (query, upload)
5. WHEN a session is about to timeout THEN THE Upload_Zone SHALL display a warning 60 seconds before expiration

### Requirement 12: Progress Indicators and Error Recovery

**User Story:** As an equity research analyst, I want to see real-time progress during document processing, so that I know the system is working and can understand any issues.

#### Acceptance Criteria

1. WHEN document extraction is in progress THEN THE Upload_Zone SHALL display per-file extraction status via SSE
2. THE Upload_Zone SHALL show extraction phases (uploading, extracting text, extracting tables, generating embeddings, complete)
3. IF extraction fails for a file THEN THE Upload_Zone SHALL display the error message and allow retry
4. WHEN a retry is requested THEN THE Document_Processor SHALL attempt to reprocess the failed file
5. THE Instant_RAG_Service SHALL support partial session recovery if the browser is refreshed

### Requirement 13: Rate Limiting

**User Story:** As a platform operator, I want to limit concurrent sessions and API calls, so that the system remains stable under load.

#### Acceptance Criteria

1. THE Instant_RAG_Service SHALL enforce a maximum of 3 concurrent upload sessions per tenant
2. THE Instant_RAG_Service SHALL enforce a maximum of 1 active Instant RAG session per user per deal
3. IF rate limits are exceeded THEN THE Instant_RAG_Service SHALL return a 429 status with retry-after header
4. THE Instant_RAG_Service SHALL log rate limit violations for monitoring

### Requirement 14: Cost Monitoring

**User Story:** As a platform operator, I want to track costs per session and per tenant, so that I can monitor usage and identify cost optimization opportunities.

#### Acceptance Criteria

1. THE Instant_RAG_Service SHALL track token usage per session (input and output tokens)
2. THE Instant_RAG_Service SHALL track model usage per session (Sonnet vs Opus calls)
3. THE Instant_RAG_Service SHALL track S3 storage usage per tenant
4. THE Instant_RAG_Service SHALL expose cost metrics via an admin endpoint
5. WHEN a session exceeds cost thresholds THEN THE Instant_RAG_Service SHALL log a warning

### Requirement 15: Frontend Upload Zone

**User Story:** As an equity research analyst, I want a drag-and-drop upload interface in my workspace, so that I can easily add documents to my research session.

#### Acceptance Criteria

1. THE Upload_Zone SHALL support drag-and-drop file upload
2. THE Upload_Zone SHALL support click-to-browse file selection
3. THE Upload_Zone SHALL display file type icons for each supported format
4. THE Upload_Zone SHALL display file size and name for each queued file
5. THE Upload_Zone SHALL allow removal of files from the queue before upload
6. WHEN upload completes THEN THE Upload_Zone SHALL display intake summary cards
7. THE Upload_Zone SHALL integrate with the existing workspace.html Alpine.js architecture
8. THE Upload_Zone SHALL use Tailwind CSS consistent with the existing design system
