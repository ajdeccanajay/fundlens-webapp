# ChatGPT-Like Research Assistant - Implementation Tasks

## Phase 1: Database & Schema (Week 1)

### Task 1.1: Add pgvector Extension
- [ ] Install pgvector extension in PostgreSQL
- [ ] Update Prisma schema with vector type
- [ ] Create migration for pgvector setup

### Task 1.2: Create Document Tables
- [ ] Add `DealDocument` model to Prisma schema
- [ ] Add `DealDocumentChunk` model with vector field
- [ ] Add `Citation` model
- [ ] Add `DocumentStatus` enum
- [ ] Create migration
- [ ] Run migration on dev database

### Task 1.3: Update Existing Models
- [ ] Add `citations` relation to `Message` model
- [ ] Add indexes for performance
- [ ] Update seed data with sample documents

**Deliverables**:
- `prisma/schema.prisma` updated
- `prisma/migrations/add_deal_documents.sql`
- Migration applied successfully

---

## Phase 2: Document Upload & Storage (Week 1-2)

### Task 2.1: S3 Storage Setup
- [ ] Create S3 bucket structure: `{tenant_id}/{deal_id}/{document_id}/`
- [ ] Implement signed URL generation for uploads
- [ ] Implement signed URL generation for downloads
- [ ] Add file validation (type, size)

### Task 2.2: Document Upload API
- [ ] Create `DealDocumentController`
- [ ] Implement `POST /api/deals/:dealId/documents/upload`
- [ ] Implement `GET /api/deals/:dealId/documents`
- [ ] Implement `DELETE /api/deals/:dealId/documents/:documentId`
- [ ] Implement `GET /api/deals/:dealId/documents/:documentId/status`
- [ ] Add tenant guard to all endpoints
- [ ] Add file size/type validation middleware

### Task 2.3: Frontend Upload UI
- [ ] Add document panel to workspace.html
- [ ] Implement file picker with drag-and-drop
- [ ] Add upload progress indicator
- [ ] Add document list with status badges
- [ ] Add delete confirmation modal
- [ ] Poll for document status updates

**Deliverables**:
- `src/deals/deal-document.controller.ts`
- `src/deals/deal-document.service.ts`
- Updated `public/app/deals/workspace.html`
- Working upload flow end-to-end

---

## Phase 3: Document Processing Pipeline (Week 2-3)

### Task 3.1: Text Extraction
- [ ] Install dependencies: `pdf-parse`, `mammoth`
- [ ] Implement PDF text extraction
- [ ] Implement DOCX text extraction
- [ ] Implement TXT text extraction
- [ ] Extract page numbers from PDFs
- [ ] Handle extraction errors gracefully

### Task 3.2: Chunking Service
- [ ] Create `ChunkingService`
- [ ] Implement sliding window chunking
- [ ] Implement paragraph-aware chunking
- [ ] Add configurable chunk size/overlap
- [ ] Add chunk metadata (page number, position)
- [ ] Write unit tests for chunking logic

### Task 3.3: Embedding Generation
- [ ] Update `BedrockService` with Titan Embeddings
- [ ] Implement batch embedding generation
- [ ] Add retry logic for API failures
- [ ] Add rate limiting
- [ ] Store embeddings in database

### Task 3.4: Background Job Queue
- [ ] Install Bull for job queue
- [ ] Create `DocumentProcessingQueue`
- [ ] Create `DocumentProcessingWorker`
- [ ] Implement job status tracking
- [ ] Add job retry logic
- [ ] Add job failure handling

### Task 3.5: Document Processing Service
- [ ] Create `DocumentProcessingService`
- [ ] Implement full processing pipeline
- [ ] Update document status at each step
- [ ] Handle errors and update status to FAILED
- [ ] Log processing metrics

**Deliverables**:
- `src/deals/document-processing.service.ts`
- `src/deals/chunking.service.ts`
- `src/deals/document-processing.queue.ts`
- Unit tests for chunking
- Working end-to-end processing

---

## Phase 4: RAG Query with Citations (Week 3-4)

### Task 4.1: Vector Search
- [ ] Create `VectorSearchService`
- [ ] Implement pgvector similarity search
- [ ] Add tenant/deal filtering
- [ ] Add relevance score threshold
- [ ] Optimize query performance
- [ ] Add query caching (optional)

### Task 4.2: RAG Service
- [ ] Create `DealRAGService`
- [ ] Implement query embedding generation
- [ ] Implement vector search integration
- [ ] Implement prompt building with chunks
- [ ] Implement streaming response from Claude
- [ ] Parse citations from response
- [ ] Store message and citations

### Task 4.3: Citation Tracking
- [ ] Create `CitationService`
- [ ] Implement citation storage
- [ ] Implement citation retrieval
- [ ] Implement citation preview endpoint
- [ ] Add citation validation

### Task 4.4: Chat API with SSE
- [ ] Create `DealChatController`
- [ ] Implement `POST /api/deals/:dealId/chat/message` with SSE
- [ ] Implement `GET /api/deals/:dealId/chat/history`
- [ ] Implement `GET /api/deals/:dealId/citations/:citationId/preview`
- [ ] Add proper error handling for streaming
- [ ] Add timeout handling

**Deliverables**:
- `src/deals/deal-rag.service.ts`
- `src/deals/vector-search.service.ts`
- `src/deals/citation.service.ts`
- `src/deals/deal-chat.controller.ts`
- Working RAG query with citations

---

## Phase 5: Frontend Chat UI (Week 4-5)

### Task 5.1: Chat Message Display
- [ ] Update workspace.html with chat layout
- [ ] Implement message bubbles (user/assistant)
- [ ] Implement streaming text display
- [ ] Add typing indicator
- [ ] Add message timestamps
- [ ] Add message actions (copy, regenerate, save)

### Task 5.2: Citation Display
- [ ] Implement citation chips
- [ ] Add citation numbering
- [ ] Add citation hover preview
- [ ] Style citations section

### Task 5.3: Citation Modal
- [ ] Create citation preview modal
- [ ] Display document metadata
- [ ] Display highlighted snippet
- [ ] Display full chunk text
- [ ] Add "Open full doc" button
- [ ] Add "Copy quote" button
- [ ] Add prev/next navigation
- [ ] Add keyboard shortcuts (ESC, arrows)

### Task 5.4: Table Rendering
- [ ] Detect markdown tables in response
- [ ] Render as HTML tables
- [ ] Add horizontal scroll for wide tables
- [ ] Add column sorting (optional)
- [ ] Style tables consistently

### Task 5.5: Empty States & Loading
- [ ] Add empty state for no messages
- [ ] Add empty state for no documents
- [ ] Add skeleton loaders
- [ ] Add upload progress indicators
- [ ] Add processing status indicators

**Deliverables**:
- Updated `public/app/deals/workspace.html`
- Citation modal component
- Table renderer
- All empty states and loaders

---

## Phase 6: Polish & Testing (Week 5-6)

### Task 6.1: Error Handling
- [ ] Add user-friendly error messages
- [ ] Add retry mechanisms
- [ ] Add fallback states
- [ ] Add error logging
- [ ] Add error monitoring

### Task 6.2: Performance Optimization
- [ ] Add database indexes
- [ ] Optimize vector search queries
- [ ] Add response caching
- [ ] Add lazy loading for documents
- [ ] Add pagination for chat history

### Task 6.3: Accessibility
- [ ] Add ARIA labels
- [ ] Add keyboard navigation
- [ ] Add focus management
- [ ] Test with screen reader
- [ ] Fix color contrast issues

### Task 6.4: Unit Tests
- [ ] Test chunking service
- [ ] Test vector search
- [ ] Test RAG service
- [ ] Test citation service
- [ ] Test document processing

### Task 6.5: E2E Tests
- [ ] Test document upload flow
- [ ] Test document processing
- [ ] Test chat query with citations
- [ ] Test citation modal
- [ ] Test error scenarios

### Task 6.6: Documentation
- [ ] Update README with setup instructions
- [ ] Document environment variables
- [ ] Document API endpoints
- [ ] Create user guide
- [ ] Create troubleshooting guide

**Deliverables**:
- Comprehensive test suite
- Updated documentation
- Performance benchmarks
- Accessibility audit report

---

## Phase 7: Demo & Seed Data (Week 6)

### Task 7.1: Sample Documents
- [ ] Create 3 sample financial documents (PDF, DOCX, TXT)
- [ ] Add realistic financial data
- [ ] Add tables and charts
- [ ] Add multi-page content

### Task 7.2: Seed Script
- [ ] Create seed script for sample deal
- [ ] Upload sample documents
- [ ] Process documents
- [ ] Create sample conversation
- [ ] Add sample citations

### Task 7.3: Demo Preparation
- [ ] Create demo video
- [ ] Create demo script
- [ ] Prepare demo environment
- [ ] Test all features

**Deliverables**:
- Sample documents in `test/fixtures/`
- Seed script in `scripts/seed-demo-deal.ts`
- Demo video and script

---

## Priority Order

### Must Have (MVP)
1. Document upload (Phase 2)
2. Text extraction & chunking (Phase 3.1, 3.2)
3. Embedding generation (Phase 3.3)
4. Vector search (Phase 4.1)
5. RAG query with citations (Phase 4.2, 4.3)
6. Basic chat UI (Phase 5.1, 5.2)
7. Citation modal (Phase 5.3)

### Should Have
1. Background job queue (Phase 3.4)
2. Table rendering (Phase 5.4)
3. Document panel UI (Phase 2.3)
4. Error handling (Phase 6.1)
5. Basic tests (Phase 6.4)

### Nice to Have
1. Advanced chunking (paragraph-aware)
2. Column sorting in tables
3. Citation hover preview
4. Response caching
5. Comprehensive E2E tests

---

## Estimated Timeline

- **Phase 1**: 3 days
- **Phase 2**: 5 days
- **Phase 3**: 7 days
- **Phase 4**: 7 days
- **Phase 5**: 7 days
- **Phase 6**: 7 days
- **Phase 7**: 2 days

**Total**: ~6 weeks (38 days)

---

## Dependencies

### NPM Packages
```json
{
  "dependencies": {
    "pdf-parse": "^1.1.1",
    "mammoth": "^1.6.0",
    "bull": "^4.12.0",
    "@bull-board/express": "^5.10.0"
  }
}
```

### PostgreSQL Extensions
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Environment Variables
```env
# Document Processing
MAX_DOCUMENT_SIZE_MB=50
CHUNK_SIZE=1000
CHUNK_OVERLAP=200

# AWS Bedrock
BEDROCK_EMBEDDING_MODEL=amazon.titan-embed-text-v1
BEDROCK_CHAT_MODEL=anthropic.claude-3-sonnet-20240229-v1:0

# Job Queue
REDIS_URL=redis://localhost:6379
QUEUE_CONCURRENCY=5
```

---

## Success Criteria

- [ ] Users can upload PDF, DOCX, TXT documents
- [ ] Documents are processed and indexed within 2 minutes
- [ ] Users can ask questions and get answers with citations
- [ ] Citations link to source documents
- [ ] Citation modal shows document preview
- [ ] Tables are rendered properly
- [ ] No cross-tenant data leakage
- [ ] All tests pass
- [ ] Demo works end-to-end

---

## Next Steps

1. Review and approve this plan
2. Set up development environment
3. Start with Phase 1 (Database & Schema)
4. Implement incrementally, testing each phase
5. Demo after each phase completion
