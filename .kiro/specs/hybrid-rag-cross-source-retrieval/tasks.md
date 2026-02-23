# Implementation Plan: Hybrid RAG Cross-Source Retrieval

## Overview

Three surgical changes to bridge Instant RAG session documents into the main RAG pipeline: (1) frontend stops forking queries, (2) Research Assistant passes session ID through, (3) RAG Service retrieves and merges session docs. No new services, endpoints, or database tables.

## Tasks

- [x] 1. Extend backend interfaces and inject dependencies
  - [x] 1.1 Add `instantRagSessionId` to `SendMessageDto.context` interface in `src/research/research-assistant.service.ts`
    - Add `instantRagSessionId?: string` to the context type
    - _Requirements: 1.2, 2.1_
  - [x] 1.2 Add `instantRagSessionId` to `RAGService.query()` options in `src/rag/rag.service.ts`
    - Add `instantRagSessionId?: string` to the options parameter type
    - _Requirements: 2.2_
  - [x] 1.3 Inject `InstantRAGService` into `RAGService` constructor in `src/rag/rag.service.ts`
    - Add `private readonly instantRAGService: InstantRAGService` to constructor
    - Update the RAG module imports to include `InstantRAGModule` (use `forwardRef()` if circular dependency)
    - _Requirements: 2.2_

- [x] 2. Implement session document retrieval and merge in RAG Service
  - [x] 2.1 Add session document retrieval and merge logic in `RAGService.query()` after the existing user documents merge block (~line 270 in `src/rag/rag.service.ts`)
    - Retrieve session documents via `this.instantRAGService.getSessionDocuments(sessionId)`
    - Filter to docs with non-empty `extractedText`
    - Convert `SessionDocument[]` to `UserDocumentChunk[]` format (id, documentId, content, pageNumber, ticker, filename, score)
    - Truncate content to 2000 chars per chunk to stay within token budget
    - Assign default score of 0.85 for session docs (user explicitly uploaded = high relevance)
    - Call `this.documentRAG.mergeAndRerankResults(sessionChunks, narratives, 10)`
    - Wrap in try/catch for graceful degradation — log warning and continue on error
    - Set metadata flag `sessionDocsUnavailable: true` when degradation occurs
    - _Requirements: 2.2, 2.3, 2.4, 4.1, 4.2, 4.3, 4.4_
  - [ ]* 2.2 Write property test: Cross-source merge completeness (Property 3)
    - **Property 3: Cross-source merge completeness**
    - Generate random session chunks and KB chunks with random scores, verify merged output contains both sources, is sorted by score descending, and respects topK
    - **Validates: Requirements 2.3, 3.1, 3.2**
  - [ ]* 2.3 Write property test: Source type labeling correctness (Property 4)
    - **Property 4: Source type labeling correctness**
    - Generate random chunks, run through mergeAndRerankResults, verify every chunk has correct source/sourceType labels
    - **Validates: Requirements 3.1, 3.2**
  - [ ]* 2.4 Write property test: Graceful degradation preserves pipeline output (Property 5)
    - **Property 5: Graceful degradation preserves pipeline output**
    - Generate invalid session IDs, mock thrown errors, empty docs — verify RAG query returns valid response with degradation flag
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [x] 3. Wire session ID through Research Assistant
  - [x] 3.1 Pass `instantRagSessionId` from `dto.context` to `ragService.query()` options in `sendMessage()` method of `src/research/research-assistant.service.ts`
    - Add `instantRagSessionId: dto.context?.instantRagSessionId` to the ragService.query() options object
    - _Requirements: 2.1_
  - [ ]* 3.2 Write property test: Session ID pass-through (Property 2)
    - **Property 2: Session ID pass-through to RAG Service**
    - Generate random SendMessageDto with/without instantRagSessionId, mock ragService.query, verify options match
    - **Validates: Requirements 2.1**

- [x] 4. Checkpoint - Backend integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update frontend to pass session ID through Research Assistant
  - [x] 5.1 Modify `sendResearchMessage()` in `public/app/deals/workspace.html` to remove the Instant RAG fork and pass session ID in context
    - Remove the early return block that checks `this.instantRagSession` and calls `sendInstantRagQuery()`
    - Add `instantRagSessionId` to the context object in the fetch body: `instantRagSessionId: this.instantRagSession?.status === 'active' ? this.instantRagSession.sessionId : undefined`
    - _Requirements: 1.1, 1.2, 1.3_
  - [ ]* 5.2 Write property test: Session ID context propagation (Property 1)
    - **Property 1: Session ID context propagation**
    - Generate random session states (active, expired, ended, null), verify context object includes/excludes sessionId correctly
    - **Validates: Requirements 1.2, 1.3**

- [x] 6. Add source type labels to LLM prompt context
  - [x] 6.1 Update narrative formatting in `buildHybridAnswer()` and `buildSemanticAnswer()` in `src/rag/rag.service.ts` to include source type labels
    - For chunks with `sourceType === 'USER_UPLOAD'`, prefix with `[Uploaded Document: {filename}]`
    - For chunks with `sourceType === 'SEC_FILING'`, prefix with `[SEC Filing: {ticker} {filingType}]`
    - Ensure citation metadata streamed to frontend includes `sourceType` and `filename`
    - _Requirements: 3.1, 3.2, 3.3_
  - [ ]* 6.2 Write unit tests for source label formatting
    - Test that session doc chunks get "Uploaded Document" label with filename
    - Test that SEC filing chunks get "SEC Filing" label with ticker and filing type
    - Test citation metadata includes sourceType field
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 7. Final checkpoint - Full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The `sendInstantRagQuery()` function in workspace.html is NOT deleted — it remains available for the dedicated Instant RAG chat panel
- No new database tables, migrations, or endpoints are needed
- The only new dependency injection is `InstantRAGService` into `RAGService`
- Property tests use `fast-check` with minimum 100 iterations per property
