# ChatGPT-Like Research Assistant - Requirements

## Overview
Upgrade the existing research assistant in the Deal Workspace to support document upload, RAG-based Q&A with citations, and a ChatGPT-like UX.

## Current Architecture (NestJS)
- **Backend**: NestJS + TypeScript + Prisma + PostgreSQL
- **Frontend**: Vanilla HTML/JS + Alpine.js + Tailwind CSS
- **RAG**: AWS Bedrock (Claude) + existing hybrid RAG system
- **Storage**: S3-compatible (LocalStack for dev, AWS S3 for prod)
- **Multi-tenancy**: Already implemented with tenant guards

## Core Requirements

### 1. Document Upload & Management
**User Story**: As an analyst, I want to upload documents (PDF, DOCX, TXT) to a deal so I can ask questions about them.

**Acceptance Criteria**:
- Upload documents via drag-and-drop or file picker
- Support PDF, DOCX, TXT formats (max 50MB configurable)
- Show upload progress with status indicators
- Display document list with metadata (name, size, upload date, status)
- Allow document deletion (soft delete)
- Show indexing status (pending, processing, indexed, failed)

### 2. Document Processing Pipeline
**User Story**: As the system, I need to process uploaded documents for RAG retrieval.

**Acceptance Criteria**:
- Extract text from PDF (using pdf-parse or similar)
- Extract text from DOCX (using mammoth or similar)
- Extract financial metrics from documents (leverage existing Python parser)
- Chunk text with configurable size (default: 1000 tokens) and overlap (default: 200 tokens)
- Generate embeddings using AWS Bedrock Titan Embeddings
- Store chunks with vectors in PostgreSQL (pgvector)
- Track processing status and errors
- Process documents asynchronously (background job)

### 3. RAG Query with Citations
**User Story**: As an analyst, I want to ask questions and get answers with source citations.

**Acceptance Criteria**:
- Retrieve relevant chunks using hybrid RAG (existing system)
- Filter by tenant_id + deal_id + document_id
- Generate answer with Claude via Bedrock
- Include citations in response with:
  - Document title
  - Page number (if PDF)
  - Snippet/quote
  - Chunk ID for preview
- Stream response token-by-token (SSE)
- Display citations as numbered chips [1], [2], etc.

### 4. Citation Preview Modal
**User Story**: As an analyst, I want to click a citation to see the source context.

**Acceptance Criteria**:
- Click citation chip to open modal
- Show document metadata (title, page, upload date)
- Show highlighted snippet with surrounding context
- Show full chunk text
- Provide "Open full doc" button (download/view)
- Provide "Copy quote" button
- Navigate between citations (prev/next)
- Keyboard navigation (ESC to close, arrows for prev/next)

### 5. Table Rendering
**User Story**: As an analyst, I want tables in answers to be properly formatted.

**Acceptance Criteria**:
- Detect table data in LLM response
- Render as HTML table (not monospace text)
- Support horizontal scroll for wide tables
- Support column sorting (optional)
- Maintain table formatting in markdown

### 6. ChatGPT-Like UX
**User Story**: As an analyst, I want a familiar, polished chat experience.

**Acceptance Criteria**:
- Clean, minimal design with ample whitespace
- User messages: right-aligned, blue gradient bubble
- Assistant messages: left-aligned, white bubble with border
- Streaming text appears token-by-token
- Message actions: copy, regenerate, save to scratchpad
- Empty states with helpful prompts
- Skeleton loaders during processing
- Smooth animations and transitions

### 7. Document Panel (Right Sidebar)
**User Story**: As an analyst, I want to manage documents without leaving the chat.

**Acceptance Criteria**:
- Collapsible right panel
- "Upload Documents" button with file picker
- Document list with:
  - Filename
  - Size
  - Upload date
  - Status badge (indexed, processing, failed)
  - Delete button
- Upload progress indicators
- Empty state when no documents

## Technical Requirements

### Database Schema Extensions

```prisma
model DealDocument {
  id            String   @id @default(uuid())
  tenantId      String   @map("tenant_id")
  dealId        String   @map("deal_id")
  userId        String   @map("user_id")
  filename      String
  mimeType      String   @map("mime_type")
  sizeBytes     Int      @map("size_bytes")
  storageUrl    String   @map("storage_url")
  status        DocumentStatus @default(PENDING)
  errorMessage  String?  @map("error_message")
  pageCount     Int?     @map("page_count")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  
  chunks        DealDocumentChunk[]
  citations     Citation[]
  
  @@map("deal_documents")
  @@index([tenantId, dealId])
  @@index([status])
}

model DealDocumentChunk {
  id            String   @id @default(uuid())
  tenantId      String   @map("tenant_id")
  dealId        String   @map("deal_id")
  documentId    String   @map("document_id")
  chunkIndex    Int      @map("chunk_index")
  content       String   @db.Text
  embedding     Unsupported("vector(1536)")?
  pageNumber    Int?     @map("page_number")
  metadata      Json?
  createdAt     DateTime @default(now()) @map("created_at")
  
  document      DealDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  citations     Citation[]
  
  @@map("deal_document_chunks")
  @@index([tenantId, dealId, documentId])
  @@index([embedding], type: Ivfflat)
}

model Citation {
  id            String   @id @default(uuid())
  tenantId      String   @map("tenant_id")
  dealId        String   @map("deal_id")
  messageId     String   @map("message_id")
  documentId    String   @map("document_id")
  chunkId       String   @map("chunk_id")
  quote         String   @db.Text
  pageNumber    Int?     @map("page_number")
  relevanceScore Float?  @map("relevance_score")
  createdAt     DateTime @default(now()) @map("created_at")
  
  message       Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)
  document      DealDocument @relation(fields: [documentId], references: [id])
  chunk         DealDocumentChunk @relation(fields: [chunkId], references: [id])
  
  @@map("citations")
  @@index([tenantId, dealId, messageId])
}

enum DocumentStatus {
  PENDING
  PROCESSING
  INDEXED
  FAILED
}
```

### API Endpoints

```typescript
// Document Management
POST   /api/deals/:dealId/documents/upload
GET    /api/deals/:dealId/documents
DELETE /api/deals/:dealId/documents/:documentId
GET    /api/deals/:dealId/documents/:documentId/status

// Chat with RAG
POST   /api/deals/:dealId/chat/message (SSE streaming)
GET    /api/deals/:dealId/chat/history

// Citations
GET    /api/deals/:dealId/citations/:citationId/preview
GET    /api/deals/:dealId/documents/:documentId/download
```

### RAG Pipeline Flow

```
1. User uploads document
   ↓
2. Store file in S3 (tenant_id/deal_id/document_id/filename)
   ↓
3. Extract text (PDF: pdf-parse, DOCX: mammoth)
   ↓
4. Extract metrics (Python parser for financial docs)
   ↓
5. Chunk text (1000 tokens, 200 overlap)
   ↓
6. Generate embeddings (Bedrock Titan)
   ↓
7. Store chunks + vectors in PostgreSQL
   ↓
8. Update document status to INDEXED

Query Flow:
1. User asks question
   ↓
2. Generate query embedding
   ↓
3. Vector search (pgvector) filtered by tenant_id + deal_id
   ↓
4. Retrieve top-k chunks (k=5)
   ↓
5. Build prompt with chunks + system instructions
   ↓
6. Stream response from Claude (Bedrock)
   ↓
7. Parse citations from response
   ↓
8. Store message + citations
   ↓
9. Return to frontend with SSE
```

### System Prompt Template

```typescript
const SYSTEM_PROMPT = `You are a financial research assistant helping analysts understand documents.

CRITICAL RULES:
1. ALWAYS cite your sources using [1], [2], etc. when making factual claims
2. ONLY use information from the provided documents
3. If information is not in the documents, say "I don't have that information in the uploaded documents"
4. When presenting financial data, use tables when appropriate
5. Be precise and professional

CITATION FORMAT:
- Use [1], [2] inline after each claim
- Each citation number corresponds to a source document chunk
- Multiple claims from the same source should reuse the same number

TABLE FORMAT:
When presenting tabular data, use markdown tables:
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |

CONTEXT DOCUMENTS:
{chunks}

USER QUESTION:
{question}`;
```

## Non-Functional Requirements

### Performance
- Document upload: < 5s for 10MB file
- Text extraction: < 30s for 100-page PDF
- Embedding generation: < 10s for 1000 chunks
- Query response: First token < 2s, full response < 10s
- Vector search: < 500ms for top-k retrieval

### Security
- All queries filtered by tenant_id + deal_id
- Document access controlled by tenant membership
- File uploads validated (type, size, content)
- S3 URLs signed with expiration
- No cross-tenant data leakage in vector search

### Scalability
- Support 1000+ documents per deal
- Support 100K+ chunks per tenant
- Background job queue for document processing
- Batch embedding generation (100 chunks at a time)

### Accessibility
- Keyboard navigation for all interactions
- ARIA labels for screen readers
- Focus management in modals
- Color contrast WCAG AA compliant

## Out of Scope (Future Phases)
- OCR for scanned PDFs
- Multi-language support
- Document versioning
- Collaborative annotations
- Advanced reranking algorithms
- Custom embedding models
- Real-time collaboration

## Success Metrics
- Document upload success rate > 95%
- Average query response time < 5s
- Citation accuracy > 90%
- User satisfaction score > 4/5
- Zero cross-tenant data leaks

## Dependencies
- Existing: NestJS, Prisma, PostgreSQL, AWS Bedrock, S3
- New: pgvector extension, pdf-parse, mammoth, bull (job queue)

## Risks & Mitigations
- **Risk**: Large PDF processing timeout
  - **Mitigation**: Async processing with status updates
- **Risk**: Embedding API rate limits
  - **Mitigation**: Batch processing with retry logic
- **Risk**: Vector search performance degradation
  - **Mitigation**: Proper indexing, query optimization
- **Risk**: Citation hallucination
  - **Mitigation**: Strict prompt engineering, post-processing validation
