# Implementation Plan: Instant RAG Document Processing

## Overview

This implementation plan breaks down the Instant RAG feature into 4 phases, with each phase delivering incremental value. Tasks are organized to build on previous work, with property tests placed close to implementation for early error detection.

## Tasks

- [x] 1. Phase 1: Core Infrastructure and Batch Upload
  - [x] 1.1 Create database schema for instant RAG sessions
    - Create migration file `prisma/migrations/add_instant_rag_schema.sql`
    - Add tables: instant_rag_sessions, instant_rag_documents, instant_rag_qa_log, instant_rag_intake_summaries, instant_rag_rate_limits
    - Add indexes for tenant_id, session_id, content_hash lookups
    - _Requirements: 1.1, 1.8, 1.9, 10.4_

  - [x] 1.2 Implement SessionManager service
    - Create `src/instant-rag/session-manager.service.ts`
    - Implement createSession, getSession, updateSession, endSession methods
    - Implement enforceRateLimits with tenant (max 3) and user+deal (max 1) limits
    - Implement extendTimeout and cleanupExpiredSessions
    - Store session state in database with Redis cache for active sessions
    - _Requirements: 1.7, 1.8, 1.9, 11.1, 11.4, 13.1, 13.2_

  - [ ]* 1.3 Write property test for rate limit enforcement
    - **Property 6: Rate Limit Enforcement**
    - **Validates: Requirements 1.8, 1.9, 13.1, 13.2, 13.3**

  - [x] 1.4 Implement DocumentProcessor service with expanded file types
    - Create `src/instant-rag/document-processor.service.ts`
    - Implement extractPDF using existing pdf-parse
    - Implement extractDOCX using existing mammoth
    - Implement extractXLSX using xlsx library with sheet limit (10)
    - Implement extractCSV using csv-parse
    - Implement extractTXT for plain text
    - Implement computeContentHash using crypto SHA-256
    - Implement checkDuplicate for deduplication
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 10.1, 10.2_

  - [ ]* 1.5 Write property test for XLSX sheet extraction limit
    - **Property 7: XLSX Sheet Extraction Limit**
    - **Validates: Requirements 2.2**

  - [ ]* 1.6 Write property test for content hash duplicate detection
    - **Property 25: Content Hash Duplicate Detection Round-Trip**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4**

  - [x] 1.7 Implement file validation logic
    - Add validateBatch method checking file count (≤5), total size (≤150MB)
    - Add validateFile method checking individual size (≤50MB), file type
    - Return detailed error messages for each validation failure
    - Support partial success with error details for failed files
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 1.8 Write property tests for file validation
    - **Property 1: Batch Upload File Count Validation**
    - **Property 2: Individual File Size Validation**
    - **Property 3: Aggregate Batch Size Validation**
    - **Property 4: File Type Validation**
    - **Property 5: Partial Upload Success**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

  - [x] 1.9 Implement InstantRAGController with upload endpoint
    - Create `src/instant-rag/instant-rag.controller.ts`
    - Implement POST /instant-rag/upload with FilesInterceptor (max 5)
    - Implement GET /instant-rag/session/:sessionId
    - Implement POST /instant-rag/session/:sessionId/end
    - Add TenantGuard for authentication
    - Return SSE stream for upload progress
    - _Requirements: 1.1, 1.6, 12.1, 12.2_

  - [x] 1.10 Implement InstantRAGService orchestration
    - Create `src/instant-rag/instant-rag.service.ts`
    - Implement createSession calling SessionManager
    - Implement processDocuments with parallel file processing
    - Implement progress event emission via SSE
    - Handle partial failures gracefully
    - _Requirements: 1.5, 1.6, 12.1, 12.2, 12.3_

- [x] 2. Checkpoint - Verify batch upload works
  - Ensure all tests pass, ask the user if questions arise.

- [-] 3. Phase 1 Continued: Intake Summary and Instant Q&A
  - [x] 3.1 Implement intake summary generation
    - Add generateIntakeSummaries method to InstantRAGService
    - Call Claude Sonnet with document content to extract summary fields
    - Parse response into IntakeSummary structure
    - Store summaries in instant_rag_intake_summaries table
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [ ]* 3.2 Write property test for intake summary completeness
    - **Property 11: Intake Summary Completeness**
    - **Validates: Requirements 3.2-3.10**

  - [x] 3.3 Implement instant Q&A query method
    - Add query method to InstantRAGService
    - Build context from session documents (full text injection)
    - Call Claude with document context for immediate response
    - Stream response tokens via SSE
    - Store Q&A in instant_rag_qa_log
    - _Requirements: 4.1, 4.2, 4.3, 4.5_

  - [ ]* 3.4 Write property test for instant Q&A independence
    - **Property 12: Instant Q&A Independence from KB**
    - **Validates: Requirements 4.1, 4.2**

  - [x] 3.5 Implement citation extraction
    - Parse [Doc N, p.X] citations from Claude responses
    - Map citations to source documents
    - Include citations in response metadata
    - _Requirements: 4.5, 4.6_

  - [x] 3.6 Implement table extraction completeness
    - Enhance DocumentProcessor to extract full tables
    - Handle multi-page tables in PDFs
    - Preserve row/column structure
    - _Requirements: 4.11_

  - [ ]* 3.7 Write property test for table extraction
    - **Property 14: Table Extraction Completeness**
    - **Validates: Requirements 4.11**

- [x] 4. Checkpoint - Verify intake summaries and Q&A work
  - Ensure all tests pass, ask the user if questions arise.

- [-] 5. Phase 2: Multi-Modal Vision and Model Routing
  - [x] 5.1 Implement VisionPipeline Python service
    - Add /vision/render-pdf endpoint to python_parser/api_server.py
    - Use pdf2image to render pages at 150 DPI
    - Return base64-encoded images
    - Add /vision/render-pptx endpoint using python-pptx + Pillow
    - Handle slide limit (100 max)
    - _Requirements: 5.1, 5.6, 2.5, 2.6_

  - [ ]* 5.2 Write property test for PDF vision rendering
    - **Property 15: PDF Vision Rendering**
    - **Validates: Requirements 5.1**

  - [ ]* 5.3 Write property test for PPTX slide limit
    - **Property 9: PPTX Slide Limit**
    - **Validates: Requirements 2.6**

  - [x] 5.4 Integrate vision pipeline with DocumentProcessor
    - Call VisionPipeline for PDF and PPTX files
    - Store rendered images in session state
    - Pass images to Claude vision API for analysis
    - _Requirements: 5.1, 5.6, 5.7_

  - [x] 5.5 Implement image file handling
    - Add extractImage method for PNG/JPG/JPEG
    - Pass images directly to Claude vision API
    - Handle JPEG/JPG equivalence
    - _Requirements: 2.7, 2.8_

  - [ ]* 5.6 Write property test for JPEG/JPG equivalence
    - **Property 10: JPEG/JPG Equivalence**
    - **Validates: Requirements 2.8**

  - [x] 5.7 Implement ModelRouter service
    - Create `src/instant-rag/model-router.service.ts`
    - Implement routeQuery with trigger keyword detection
    - Implement checkOpusBudget with 5-call limit
    - Implement trackUsage for token counting
    - Log routing decisions
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 5.8 Write property tests for model routing
    - **Property 16: Model Routing Default**
    - **Property 17: Model Routing Triggers**
    - **Property 18: Opus Budget Enforcement**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  - [x] 5.9 Integrate ModelRouter with InstantRAGService
    - Route queries through ModelRouter
    - Use selected model for Claude calls
    - Notify user when falling back to Sonnet
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 5.10 Implement hybrid retrieval (session + KB combined)
    - Add hybridQuery method to InstantRAGService
    - For queries during active session: combine session documents (direct context) + KB retrieval results (semantic search) into single Claude prompt
    - Session docs get priority (freshest, most relevant context)
    - KB results fill in historical context (prior filings, older research)
    - Use existing BedrockService.retrieve() for KB semantic search with tenant+deal filters
    - Distinguish citation sources: [Session Doc N, p.X] vs [KB: TICKER FILING PERIOD, p.X]
    - Fall back to session-only mode if KB is unavailable
    - _Requirements: 4.1, 4.2, 4.5, 4.6, 9.2_

- [x] 6. Checkpoint - Verify vision and model routing work
  - Ensure all tests pass, ask the user if questions arise.

- [-] 7. Phase 3: Sync Envelope and KB Persistence
  - [x] 7.1 Implement SyncEnvelopeGenerator service
    - Create `src/instant-rag/sync-envelope-generator.service.ts`
    - Implement generateEnvelope with all required fields
    - Generate structured_metrics artifact from extracted metrics
    - Generate document_chunks artifact with embeddings
    - Generate session_qa_log artifact with summary
    - Generate provocations artifact if any generated
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [ ]* 7.2 Write property test for sync envelope completeness
    - **Property 19: Sync Envelope Completeness**
    - **Validates: Requirements 7.1-7.8**

  - [x] 7.3 Implement S3 upload for sync envelope
    - Add uploadToS3 method to SyncEnvelopeGenerator
    - Use path structure s3://fundlens-{env}/kb-ready/{tenant_id}/{deal_id}/{session_id}/
    - Upload chunks as individual files with metadata
    - _Requirements: 7.9, 9.3_

  - [ ]* 7.4 Write property test for S3 path structure
    - **Property 20: S3 Path Structure**
    - **Validates: Requirements 7.9, 9.3**

  - [x] 7.5 Implement KB ingestion trigger
    - Add triggerKBIngestion method
    - Use existing BedrockService for KB operations
    - Use amazon.titan-embed-text-v2:0 for embeddings
    - Implement retry logic (3 attempts)
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

  - [ ]* 7.6 Write property tests for KB sync
    - **Property 21: Embedding Model Consistency**
    - **Property 22: KB Ingestion Retry**
    - **Validates: Requirements 8.3, 8.5**

  - [x] 7.7 Implement async sync on session end
    - Trigger sync envelope generation on endSession
    - Run S3 upload and KB ingestion asynchronously
    - Return response to user before sync completes
    - _Requirements: 8.6_

  - [ ]* 7.8 Write property test for async non-blocking
    - **Property 23: Async Sync Non-Blocking**
    - **Validates: Requirements 8.6**

  - [x] 7.9 Implement session timeout handling
    - Add scheduled job for cleanupExpiredSessions
    - Generate sync envelope on timeout
    - Release session resources
    - Send timeout warning 60 seconds before expiration
    - _Requirements: 11.1, 11.2, 11.3, 11.5_

  - [ ]* 7.10 Write property tests for session timeout
    - **Property 26: Session Timeout Enforcement**
    - **Property 27: Session Timeout Extension**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4**

- [x] 8. Checkpoint - Verify sync envelope and KB persistence work
  - Ensure all tests pass, ask the user if questions arise.

- [-] 9. Phase 4: Tenant Isolation and Polish
  - [x] 9.1 Implement per-tenant KB data source management
    - Add getOrCreateDataSource method
    - Create data source per tenant+deal combination
    - Store data source ID in session/deal record
    - _Requirements: 9.1_

  - [x] 9.2 Implement tenant isolation in KB queries
    - Add tenant_id and deal_id filters to all KB queries
    - Validate tenant ownership on all operations
    - Return empty results for cross-tenant queries
    - _Requirements: 9.2, 9.4, 9.5_

  - [ ]* 9.3 Write property test for tenant isolation
    - **Property 24: Tenant Isolation**
    - **Validates: Requirements 9.4, 9.5**

  - [x] 9.4 Implement progress indicators via SSE
    - Add SSE endpoint for session status
    - Emit events for each processing phase
    - Include per-file status in events
    - _Requirements: 12.1, 12.2_

  - [ ]* 9.5 Write property test for progress events
    - **Property 28: Progress Event Streaming**
    - **Validates: Requirements 12.1, 12.2**

  - [x] 9.6 Implement error recovery and retry
    - Add retry endpoint for failed files
    - Implement partial session recovery
    - Store recovery state in database
    - _Requirements: 12.3, 12.4, 12.5_

  - [x] 9.7 Implement cost monitoring
    - Track token usage per session
    - Track model usage (Sonnet vs Opus)
    - Track S3 storage per tenant
    - Add admin endpoint for cost metrics
    - Log warnings for high-cost sessions
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [ ]* 9.8 Write property test for usage tracking
    - **Property 29: Usage Tracking Completeness**
    - **Validates: Requirements 14.1, 14.2, 6.5, 6.6**

  - [x] 9.9 Implement rate limit response handling
    - Return 429 status with retry-after header
    - Log rate limit violations
    - _Requirements: 13.3, 13.4_

- [x] 10. Checkpoint - Verify tenant isolation and monitoring work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Phase 4 Continued: Frontend Integration
  - [x] 11.1 Implement Upload Zone component in workspace.html
    - Add drag-and-drop zone using Alpine.js
    - Add click-to-browse file selection
    - Display file type icons, names, sizes
    - Allow removal of files before upload
    - Use Tailwind CSS consistent with design system
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.8_

  - [x] 11.2 Implement upload progress display
    - Connect to SSE endpoint for progress
    - Display per-file extraction status
    - Show extraction phases
    - Handle errors with retry option
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 11.3 Implement intake summary cards
    - Display summary cards after upload completes
    - Show document type, entity, period, metrics
    - Highlight notable items
    - _Requirements: 3.11, 15.6_

  - [x] 11.4 Implement session timeout warning
    - Display warning 60 seconds before expiration
    - Allow session extension on activity
    - _Requirements: 11.5_

  - [x] 11.5 Implement duplicate detection notification
    - Display notification when duplicate detected
    - Show reference to existing document
    - _Requirements: 10.3_

- [x] 12. Final Checkpoint - Full integration testing
  - Ensure all tests pass, ask the user if questions arise.
  - Run E2E tests for complete upload → Q&A → sync flow
  - Verify frontend integration works correctly

## Notes

- Tasks marked with `*` are optional property-based tests that can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each phase
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases
- The implementation builds on existing services: DocumentProcessingService, BedrockService, RAGService
- Python VisionPipeline extends the existing api_server.py
