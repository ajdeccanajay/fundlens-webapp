# ChatGPT-Like Research Assistant - Final Implementation Plan

## Requirements Summary

✅ **Use Case**: Due diligence (financial analysis)
✅ **Deal Scope**: One deal = one company (ticker)
✅ **RAG Scope**: Search across ALL deals for a tenant (cross-company insights)
✅ **Document Limit**: Max 25 documents per tenant
✅ **Budget**: Super cheap (minimize API costs)
✅ **Infrastructure**: Use existing PostgreSQL RDS, no new AWS services
✅ **Integration**: Must work with existing SEC filings

## Cost-Optimized Architecture

### Total Estimated Cost (25 docs, 1000 queries/month)
- **Embeddings**: $0.13 (one-time, 25 docs × 50 chunks × $0.0001)
- **Claude Queries**: $23/month (1000 queries)
- **Storage**: $0.01/month (125MB in S3)
- **Total**: ~$23/month (after initial $0.13)

### Infrastructure (Zero New Services)
```
✅ PostgreSQL RDS (existing) + pgvector extension
✅ S3 (existing) for document storage
✅ Bedrock (existing) for embeddings + Claude
✅ NestJS backend (existing)
❌ NO Redis (use in-memory queue for 25 docs)
❌ NO new databases
❌ NO new AWS services
```

## Simplified Data Model

### Extend Existing Tables (Not New Ones)

```prisma
// Add to existing schema.prisma

model Document {
  id            String   @id @default(uuid())
  tenantId      String   @map("tenant_id")
  ticker        String   // Company ticker (AAPL, MSFT, etc.)
  sourceType    DocumentSourceType @default(USER_UPLOAD)
  
  // File metadata
  filename      String
  mimeType      String   @map("mime_type")
  sizeBytes     Int      @map("size_bytes")
  storageUrl    String   @map("storage_url")
  
  // Processing status
  status        DocumentStatus @default(PENDING)
  errorMessage  String?  @map("error_message")
  
  // Audit
  createdBy     String   @map("created_by")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  
  chunks        DocumentChunk[]
  
  @@map("documents")
  @@index([tenantId, ticker])
  @@index([tenantId, sourceType])
}

model DocumentChunk {
  id            String   @id @default(uuid())
  tenantId      String   @map("tenant_id")
  ticker        String   // For cross-deal search
  documentId    String   @map("document_id")
  
  chunkIndex    Int      @map("chunk_index")
  content       String   @db.Text
  embedding     Unsupported("vector(1536)")?
  pageNumber    Int?     @map("page_number")
  
  createdAt     DateTime @default(now()) @map("created_at")
  
  document      Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  
  @@map("document_chunks")
  @@index([tenantId, ticker])
  @@index([embedding], type: Ivfflat)
}

// Extend existing Message model
model Message {
  // ... existing fields ...
  ticker        String?  // Add this field
  citations     Citation[]
}

model Citation {
  id            String   @id @default(uuid())
  tenantId      String   @map("tenant_id")
  messageId     String   @map("message_id")
  documentId    String   @map("document_id")
  chunkId       String   @map("chunk_id")
  
  quote         String   @db.Text
  pageNumber    Int?     @map("page_number")
  relevanceScore Float?  @map("relevance_score")
  
  createdAt     DateTime @default(now()) @map("created_at")
  
  message       Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)
  
  @@map("citations")
  @@index([tenantId, messageId])
}

enum DocumentSourceType {
  USER_UPLOAD
  SEC_FILING
}

enum DocumentStatus {
  PENDING
  PROCESSING
  INDEXED
  FAILED
}
```

## Simplified Implementation (2 Weeks)

### Week 1: Backend Foundation

**Day 1-2: Database Setup**
- [ ] Add pgvector extension to RDS
- [ ] Create Prisma models (Document, DocumentChunk, Citation)
- [ ] Generate and run migration
- [ ] Add ticker field to Message model

**Day 3-4: Document Upload**
- [ ] Create `DocumentController` with upload endpoint
- [ ] Implement file validation (PDF/DOCX/TXT, max 10MB)
- [ ] Upload to S3 with tenant/ticker path
- [ ] Store document metadata in DB

**Day 5: Document Processing**
- [ ] Install `pdf-parse` and `mammoth`
- [ ] Create `DocumentProcessingService`
- [ ] Extract text from PDF/DOCX/TXT
- [ ] Simple chunking (1000 chars, 200 overlap)
- [ ] Process synchronously (no queue needed for 25 docs)

**Day 6-7: Embeddings & Vector Search**
- [ ] Generate embeddings with Bedrock Titan
- [ ] Store chunks with vectors in PostgreSQL
- [ ] Implement vector search with tenant filtering
- [ ] Test cross-ticker search

### Week 2: Frontend & RAG Integration

**Day 8-9: Integrate with Existing RAG**
- [ ] Extend `RAGService` to include user documents
- [ ] Modify query router to search user docs + SEC filings
- [ ] Implement citation extraction
- [ ] Store citations in database

**Day 10-11: Frontend UI**
- [ ] Add document upload panel to workspace.html
- [ ] Add file picker with drag-and-drop
- [ ] Show document list with status
- [ ] Add upload progress indicator

**Day 12-13: Citation Display**
- [ ] Add citation chips to chat messages
- [ ] Create citation preview modal
- [ ] Show document snippet + metadata
- [ ] Add "Download" and "Copy" buttons

**Day 14: Testing & Polish**
- [ ] Test full flow: upload → process → query → citations
- [ ] Test cross-ticker search
- [ ] Add error handling
- [ ] Write basic tests

## Key Simplifications (Cost Savings)

### 1. No Job Queue (Saves Redis costs)
**Why**: 25 documents max = process synchronously
**Implementation**: Process in request, show progress bar
**Fallback**: If processing takes >30s, return 202 and poll status

### 2. Reuse Existing Hybrid RAG
**Why**: Already built, tested, and working
**Implementation**: Add "user_documents" as new data source
**Benefit**: Unified search across SEC + user docs

### 3. Simple Chunking (No fancy algorithms)
**Why**: Good enough for 25 documents
**Implementation**: Fixed-size sliding window (1000 chars, 200 overlap)
**Benefit**: Fast, predictable, no dependencies

### 4. In-Memory Processing (No workers)
**Why**: Low volume doesn't need distributed processing
**Implementation**: Process documents in API request
**Benefit**: Zero infrastructure overhead

## Integration with Existing System

### Extend Existing RAG Service

```typescript
// src/rag/rag.service.ts - ADD THIS

async queryWithUserDocuments(
  tenantId: string,
  ticker: string,
  question: string,
  conversationId: string
): AsyncGenerator<ChatChunk> {
  
  // 1. Generate query embedding
  const queryEmbedding = await this.bedrockService.generateEmbedding(question);
  
  // 2. Search user documents (vector search)
  const userDocChunks = await this.searchUserDocuments(
    tenantId,
    ticker, // Can be null for cross-ticker search
    queryEmbedding,
    { topK: 3 }
  );
  
  // 3. Search SEC filings (existing hybrid RAG)
  const secChunks = await this.existingHybridRAG(tenantId, ticker, question);
  
  // 4. Merge and rerank results
  const allChunks = [...userDocChunks, ...secChunks]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  
  // 5. Build prompt with citations
  const prompt = this.buildPromptWithCitations(question, allChunks);
  
  // 6. Stream response from Claude
  for await (const chunk of this.bedrockService.streamChat(prompt)) {
    yield chunk;
  }
  
  // 7. Extract and store citations
  const citations = this.extractCitations(allChunks, fullResponse);
  await this.storeCitations(messageId, citations);
}

private async searchUserDocuments(
  tenantId: string,
  ticker: string | null,
  embedding: number[],
  options: { topK: number }
) {
  const query = `
    SELECT 
      c.id,
      c.document_id,
      c.content,
      c.page_number,
      c.ticker,
      d.filename,
      d.source_type,
      1 - (c.embedding <=> $1::vector) as score
    FROM document_chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE c.tenant_id = $2
      ${ticker ? 'AND c.ticker = $3' : ''}
      AND d.status = 'INDEXED'
      AND d.source_type = 'USER_UPLOAD'
    ORDER BY c.embedding <=> $1::vector
    LIMIT $4
  `;
  
  return this.prisma.$queryRaw(query, embedding, tenantId, ticker, options.topK);
}
```

## API Endpoints (Minimal)

```typescript
// Document Management
POST   /api/documents/upload          // Upload document
GET    /api/documents?ticker=AAPL     // List documents for ticker
DELETE /api/documents/:id             // Delete document
GET    /api/documents/:id/status      // Check processing status

// Chat (extend existing)
POST   /api/research/conversations/:id/messages  // Already exists, just enhance

// Citations (new)
GET    /api/citations/:id/preview     // Get citation details
```

## Frontend Changes (Minimal)

### Add Document Panel to workspace.html

```html
<!-- Add to Research Assistant view -->
<div x-show="currentView === 'research'" class="flex h-full">
  <!-- Existing chat area -->
  <div class="flex-1">...</div>
  
  <!-- NEW: Document Panel -->
  <div class="w-80 border-l bg-gray-50 p-4" x-data="documentPanel()">
    <h3 class="font-semibold mb-3">Documents</h3>
    
    <!-- Upload Button -->
    <button @click="$refs.fileInput.click()" class="w-full btn-primary mb-4">
      <i class="fas fa-upload mr-2"></i>Upload Document
    </button>
    <input type="file" x-ref="fileInput" @change="uploadDocument($event)" 
           accept=".pdf,.docx,.txt" class="hidden">
    
    <!-- Document List -->
    <div class="space-y-2">
      <template x-for="doc in documents" :key="doc.id">
        <div class="bg-white rounded p-3 border">
          <div class="flex justify-between items-start">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate" x-text="doc.filename"></p>
              <p class="text-xs text-gray-500" x-text="formatSize(doc.sizeBytes)"></p>
            </div>
            <button @click="deleteDocument(doc.id)" class="text-red-500">
              <i class="fas fa-trash text-sm"></i>
            </button>
          </div>
          <span class="text-xs px-2 py-1 rounded mt-2 inline-block"
                :class="{
                  'bg-green-100 text-green-800': doc.status === 'INDEXED',
                  'bg-yellow-100 text-yellow-800': doc.status === 'PROCESSING',
                  'bg-red-100 text-red-800': doc.status === 'FAILED'
                }"
                x-text="doc.status"></span>
        </div>
      </template>
    </div>
  </div>
</div>
```

### Add Citation Display (Enhance existing messages)

```html
<!-- Add to assistant message template -->
<template x-if="message.citations && message.citations.length > 0">
  <div class="mt-4 pt-4 border-t">
    <p class="text-xs text-gray-500 mb-2">Sources:</p>
    <div class="flex flex-wrap gap-2">
      <template x-for="(citation, index) in message.citations" :key="citation.id">
        <button @click="openCitationModal(citation)" 
                class="text-xs px-3 py-1 bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100">
          [<span x-text="index + 1"></span>] <span x-text="citation.filename"></span>
        </button>
      </template>
    </div>
  </div>
</template>
```

## Cost Optimization Strategies

### 1. Batch Embeddings (Save 50% on API calls)
```typescript
// Instead of 1 call per chunk:
for (const chunk of chunks) {
  await generateEmbedding(chunk); // 50 API calls
}

// Batch them:
const embeddings = await generateEmbeddings(chunks); // 1 API call
```

### 2. Cache Embeddings (Save on repeated docs)
```typescript
// Check if document already processed
const existing = await prisma.document.findFirst({
  where: { tenantId, filename, sizeBytes }
});
if (existing) return existing; // Skip reprocessing
```

### 3. Use Smaller Context (Save on Claude costs)
```typescript
// Instead of 5 chunks (5K tokens):
const chunks = topResults.slice(0, 5); // $0.015 per query

// Use 3 chunks (3K tokens):
const chunks = topResults.slice(0, 3); // $0.009 per query (40% savings)
```

### 4. Compress Chunks (Save on storage + API costs)
```typescript
// Remove extra whitespace, deduplicate
const compressed = chunk
  .replace(/\s+/g, ' ')
  .trim();
```

## Migration Strategy

### Step 1: Add pgvector Extension
```sql
-- Run on RDS
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### Step 2: Run Prisma Migration
```bash
npx prisma migrate dev --name add_user_documents
```

### Step 3: Deploy Backend Changes
```bash
# No new services needed!
# Just deploy updated NestJS app
npm run build
# Deploy to existing ECS/EC2
```

### Step 4: Deploy Frontend Changes
```bash
# Update workspace.html
# Deploy to S3/CloudFront (existing)
```

## Success Metrics

- [ ] Users can upload PDF/DOCX/TXT documents
- [ ] Documents processed in < 60 seconds
- [ ] RAG searches across user docs + SEC filings
- [ ] Citations link to source documents
- [ ] Citation modal shows document preview
- [ ] Total cost < $30/month per tenant
- [ ] Zero new AWS services added

## Timeline

**Week 1**: Backend (upload, process, embed, search)
**Week 2**: Frontend (UI, citations, modal)
**Total**: 2 weeks to working prototype

## Next Steps

Ready to start implementation? I'll begin with:

1. **Prisma schema updates** (Document, DocumentChunk, Citation models)
2. **Migration file** (add pgvector, create tables)
3. **Document upload controller** (file validation, S3 upload)

Should I proceed?
