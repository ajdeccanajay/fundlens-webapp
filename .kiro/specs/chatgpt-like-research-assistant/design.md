# ChatGPT-Like Research Assistant - Technical Design

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Deal Sidebar │  │  Chat View   │  │  Doc Panel   │      │
│  │              │  │              │  │              │      │
│  │ - Deal List  │  │ - Messages   │  │ - Upload     │      │
│  │ - Filters    │  │ - Input      │  │ - Doc List   │      │
│  │ - Create     │  │ - Citations  │  │ - Status     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/SSE
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      NestJS Backend                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Controllers & Guards                     │   │
│  │  - DealDocumentController (upload, list, delete)     │   │
│  │  - DealChatController (query with SSE)               │   │
│  │  - CitationController (preview)                      │   │
│  │  - TenantGuard (multi-tenancy enforcement)           │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    Services                           │   │
│  │  - DocumentProcessingService (extract, chunk, embed) │   │
│  │  - DealRAGService (retrieve, generate, cite)         │   │
│  │  - CitationService (track, preview)                  │   │
│  │  - S3Service (upload, download)                      │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                 Background Jobs                       │   │
│  │  - DocumentProcessingQueue (Bull)                    │   │
│  │  - EmbeddingGenerationWorker                         │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data & External Services                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ PostgreSQL   │  │  AWS S3      │  │ AWS Bedrock  │      │
│  │ + pgvector   │  │              │  │              │      │
│  │              │  │ - Raw files  │  │ - Claude     │      │
│  │ - Documents  │  │ - Tenant     │  │ - Titan      │      │
│  │ - Chunks     │  │   isolated   │  │   Embeddings │      │
│  │ - Vectors    │  │              │  │              │      │
│  │ - Citations  │  │              │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Component Design

### 1. Document Upload Flow

```typescript
// Frontend: workspace.html
async uploadDocument(file: File) {
  // Validate file
  if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'].includes(file.type)) {
    throw new Error('Unsupported file type');
  }
  if (file.size > 50 * 1024 * 1024) {
    throw new Error('File too large (max 50MB)');
  }
  
  // Upload with progress
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch(`/api/deals/${dealId}/documents/upload`, {
    method: 'POST',
    headers: this.getAuthHeaders(),
    body: formData
  });
  
  const { documentId } = await response.json();
  
  // Poll for processing status
  this.pollDocumentStatus(documentId);
}

// Backend: deal-document.controller.ts
@Post(':dealId/documents/upload')
@UseInterceptors(FileInterceptor('file'))
async uploadDocument(
  @Param('dealId') dealId: string,
  @UploadedFile() file: Express.Multer.File,
) {
  // 1. Validate file
  // 2. Upload to S3
  // 3. Create database record
  // 4. Queue processing job
  // 5. Return document ID
}
```

### 2. Document Processing Pipeline

```typescript
// document-processing.service.ts
@Injectable()
export class DocumentProcessingService {
  async processDocument(documentId: string) {
    try {
      // 1. Update status to PROCESSING
      await this.updateStatus(documentId, 'PROCESSING');
      
      // 2. Download from S3
      const fileBuffer = await this.s3Service.download(storageUrl);
      
      // 3. Extract text based on mime type
      const text = await this.extractText(fileBuffer, mimeType);
      
      // 4. Extract metrics (if financial document)
      const metrics = await this.extractMetrics(text, mimeType);
      
      // 5. Chunk text
      const chunks = await this.chunkText(text, {
        chunkSize: 1000,
        overlap: 200,
        preserveParagraphs: true
      });
      
      // 6. Generate embeddings (batch)
      const embeddings = await this.generateEmbeddings(chunks);
      
      // 7. Store chunks with vectors
      await this.storeChunks(documentId, chunks, embeddings);
      
      // 8. Update status to INDEXED
      await this.updateStatus(documentId, 'INDEXED');
      
    } catch (error) {
      await this.updateStatus(documentId, 'FAILED', error.message);
      throw error;
    }
  }
  
  private async extractText(buffer: Buffer, mimeType: string): Promise<string> {
    switch (mimeType) {
      case 'application/pdf':
        return this.extractPdfText(buffer);
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return this.extractDocxText(buffer);
      case 'text/plain':
        return buffer.toString('utf-8');
      default:
        throw new Error(`Unsupported mime type: ${mimeType}`);
    }
  }
  
  private async extractPdfText(buffer: Buffer): Promise<string> {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text;
  }
  
  private async chunkText(text: string, options: ChunkOptions): Promise<Chunk[]> {
    const { chunkSize, overlap } = options;
    const chunks: Chunk[] = [];
    
    // Simple sliding window chunking
    let start = 0;
    let chunkIndex = 0;
    
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      const content = text.slice(start, end);
      
      chunks.push({
        chunkIndex,
        content,
        startOffset: start,
        endOffset: end
      });
      
      start += chunkSize - overlap;
      chunkIndex++;
    }
    
    return chunks;
  }
  
  private async generateEmbeddings(chunks: Chunk[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    const batchSize = 100;
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchEmbeddings = await this.bedrockService.generateEmbeddings(
        batch.map(c => c.content)
      );
      embeddings.push(...batchEmbeddings);
    }
    
    return embeddings;
  }
}
```

### 3. RAG Query with Citations

```typescript
// deal-rag.service.ts
@Injectable()
export class DealRAGService {
  async queryWithCitations(
    tenantId: string,
    dealId: string,
    question: string,
    conversationId: string
  ): AsyncGenerator<ChatChunk> {
    // 1. Generate query embedding
    const queryEmbedding = await this.bedrockService.generateEmbedding(question);
    
    // 2. Vector search with tenant/deal filtering
    const relevantChunks = await this.vectorSearch(
      tenantId,
      dealId,
      queryEmbedding,
      { topK: 5 }
    );
    
    // 3. Build prompt with chunks
    const prompt = this.buildPromptWithCitations(question, relevantChunks);
    
    // 4. Stream response from Claude
    const stream = await this.bedrockService.streamChat(prompt);
    
    // 5. Parse and yield chunks with citations
    const citations: Citation[] = [];
    let fullResponse = '';
    
    for await (const chunk of stream) {
      fullResponse += chunk.text;
      
      // Detect citation markers [1], [2], etc.
      const citationMatches = chunk.text.match(/\[(\d+)\]/g);
      if (citationMatches) {
        for (const match of citationMatches) {
          const index = parseInt(match.slice(1, -1)) - 1;
          if (relevantChunks[index] && !citations.find(c => c.chunkId === relevantChunks[index].id)) {
            citations.push({
              chunkId: relevantChunks[index].id,
              documentId: relevantChunks[index].documentId,
              quote: relevantChunks[index].content.slice(0, 200),
              pageNumber: relevantChunks[index].pageNumber,
              relevanceScore: relevantChunks[index].score
            });
          }
        }
      }
      
      yield {
        type: 'content',
        content: chunk.text
      };
    }
    
    // 6. Store message and citations
    const message = await this.storeMessage(
      tenantId,
      dealId,
      conversationId,
      'assistant',
      fullResponse
    );
    
    await this.storeCitations(message.id, citations);
    
    // 7. Yield final citations
    yield {
      type: 'citations',
      citations: citations.map((c, i) => ({ ...c, index: i + 1 }))
    };
  }
  
  private async vectorSearch(
    tenantId: string,
    dealId: string,
    embedding: number[],
    options: { topK: number }
  ): Promise<ChunkWithScore[]> {
    // Use pgvector for similarity search
    const query = `
      SELECT 
        c.id,
        c.document_id,
        c.content,
        c.page_number,
        c.metadata,
        d.filename,
        1 - (c.embedding <=> $1::vector) as score
      FROM deal_document_chunks c
      JOIN deal_documents d ON c.document_id = d.id
      WHERE c.tenant_id = $2
        AND c.deal_id = $3
        AND d.status = 'INDEXED'
      ORDER BY c.embedding <=> $1::vector
      LIMIT $4
    `;
    
    return this.prisma.$queryRaw(query, embedding, tenantId, dealId, options.topK);
  }
  
  private buildPromptWithCitations(question: string, chunks: ChunkWithScore[]): string {
    const chunksText = chunks
      .map((chunk, i) => `[${i + 1}] ${chunk.filename} (Page ${chunk.pageNumber || 'N/A'}):\n${chunk.content}`)
      .join('\n\n---\n\n');
    
    return `You are a financial research assistant. Answer the question using ONLY the provided documents. Always cite your sources using [1], [2], etc.

DOCUMENTS:
${chunksText}

QUESTION: ${question}

ANSWER:`;
  }
}
```

### 4. Frontend Chat Component

```html
<!-- workspace.html - Research Assistant Section -->
<div x-show="currentView === 'research'" class="flex h-full">
  <!-- Chat Area -->
  <div class="flex-1 flex flex-col">
    <!-- Messages -->
    <div class="flex-1 overflow-y-auto p-6 space-y-4">
      <template x-for="message in researchMessages" :key="message.id">
        <div>
          <!-- User Message -->
          <div x-show="message.role === 'user'" class="flex justify-end">
            <div class="message-user" x-text="message.content"></div>
          </div>
          
          <!-- Assistant Message -->
          <div x-show="message.role === 'assistant'" class="flex justify-start">
            <div class="message-assistant">
              <!-- Markdown Content -->
              <div x-html="renderMarkdown(message.content)"></div>
              
              <!-- Tables -->
              <template x-if="message.tables && message.tables.length > 0">
                <div class="mt-4 space-y-4">
                  <template x-for="table in message.tables" :key="table.title">
                    <div>
                      <h4 class="font-semibold mb-2" x-text="table.title"></h4>
                      <div class="overflow-x-auto">
                        <table class="min-w-full border">
                          <thead>
                            <tr>
                              <template x-for="col in table.columns" :key="col">
                                <th class="border px-4 py-2" x-text="col"></th>
                              </template>
                            </tr>
                          </thead>
                          <tbody>
                            <template x-for="row in table.rows" :key="row">
                              <tr>
                                <template x-for="cell in row" :key="cell">
                                  <td class="border px-4 py-2" x-text="cell"></td>
                                </template>
                              </tr>
                            </template>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </template>
                </div>
              </template>
              
              <!-- Citations -->
              <template x-if="message.citations && message.citations.length > 0">
                <div class="mt-4 pt-4 border-t">
                  <p class="text-xs text-gray-500 mb-2">Sources:</p>
                  <div class="flex flex-wrap gap-2">
                    <template x-for="citation in message.citations" :key="citation.id">
                      <button 
                        @click="openCitationModal(citation)"
                        class="citation-chip"
                        x-text="`[${citation.index}] ${citation.docTitle}`">
                      </button>
                    </template>
                  </div>
                </div>
              </template>
              
              <!-- Message Actions -->
              <div class="mt-3 flex gap-2">
                <button @click="copyMessage(message)" class="text-xs text-gray-500 hover:text-gray-700">
                  <i class="fas fa-copy mr-1"></i>Copy
                </button>
                <button @click="regenerateMessage(message)" class="text-xs text-gray-500 hover:text-gray-700">
                  <i class="fas fa-redo mr-1"></i>Regenerate
                </button>
                <button @click="saveToScratchpad(message)" class="text-xs text-gray-500 hover:text-gray-700">
                  <i class="fas fa-bookmark mr-1"></i>Save
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
      
      <!-- Typing Indicator -->
      <div x-show="researchTyping" class="flex justify-start">
        <div class="message-assistant">
          <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Input Area -->
    <div class="border-t p-6">
      <textarea 
        x-model="researchInput"
        @keydown.enter.prevent="sendResearchMessage()"
        placeholder="Ask about your documents..."
        rows="3"
        class="w-full border-2 rounded-xl px-4 py-3"></textarea>
      <button 
        @click="sendResearchMessage()"
        class="mt-2 px-6 py-3 rounded-xl bg-blue-600 text-white">
        Send
      </button>
    </div>
  </div>
  
  <!-- Document Panel (Right Sidebar) -->
  <div class="w-80 border-l bg-gray-50 flex flex-col">
    <div class="p-4 border-b">
      <h3 class="font-semibold mb-3">Documents</h3>
      <button 
        @click="$refs.fileInput.click()"
        class="w-full px-4 py-2 bg-blue-600 text-white rounded-lg">
        <i class="fas fa-upload mr-2"></i>Upload Document
      </button>
      <input 
        type="file"
        x-ref="fileInput"
        @change="handleFileUpload($event)"
        accept=".pdf,.docx,.txt"
        class="hidden">
    </div>
    
    <!-- Document List -->
    <div class="flex-1 overflow-y-auto p-4 space-y-2">
      <template x-if="documents.length === 0">
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-file-upload text-4xl mb-2"></i>
          <p class="text-sm">No documents yet</p>
        </div>
      </template>
      
      <template x-for="doc in documents" :key="doc.id">
        <div class="bg-white rounded-lg p-3 border">
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate" x-text="doc.filename"></p>
              <p class="text-xs text-gray-500" x-text="formatFileSize(doc.sizeBytes)"></p>
            </div>
            <button 
              @click="deleteDocument(doc.id)"
              class="text-red-500 hover:text-red-700">
              <i class="fas fa-trash text-sm"></i>
            </button>
          </div>
          <div class="mt-2">
            <span 
              class="status-badge"
              :class="{
                'bg-green-100 text-green-800': doc.status === 'INDEXED',
                'bg-yellow-100 text-yellow-800': doc.status === 'PROCESSING',
                'bg-red-100 text-red-800': doc.status === 'FAILED'
              }"
              x-text="doc.status">
            </span>
          </div>
        </div>
      </template>
    </div>
  </div>
</div>

<!-- Citation Modal -->
<div x-show="showCitationModal" 
     x-cloak
     class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
     @click.self="showCitationModal = false"
     @keydown.escape.window="showCitationModal = false">
  <div class="bg-white rounded-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden">
    <div class="p-6 border-b flex justify-between items-start">
      <div>
        <h3 class="font-semibold text-lg" x-text="currentCitation?.docTitle"></h3>
        <p class="text-sm text-gray-500">
          Page <span x-text="currentCitation?.pageNumber || 'N/A'"></span>
        </p>
      </div>
      <button @click="showCitationModal = false" class="text-gray-400 hover:text-gray-600">
        <i class="fas fa-times"></i>
      </button>
    </div>
    
    <div class="p-6 overflow-y-auto max-h-96">
      <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
        <p class="text-sm" x-text="currentCitation?.quote"></p>
      </div>
      
      <div class="prose prose-sm">
        <p x-text="currentCitation?.fullText"></p>
      </div>
    </div>
    
    <div class="p-6 border-t flex justify-between">
      <div class="flex gap-2">
        <button 
          @click="downloadDocument(currentCitation?.documentId)"
          class="px-4 py-2 bg-blue-600 text-white rounded-lg">
          <i class="fas fa-download mr-2"></i>Open Full Doc
        </button>
        <button 
          @click="copyQuote(currentCitation?.quote)"
          class="px-4 py-2 border rounded-lg">
          <i class="fas fa-copy mr-2"></i>Copy Quote
        </button>
      </div>
      
      <div class="flex gap-2">
        <button 
          @click="navigateCitation('prev')"
          :disabled="citationIndex === 0"
          class="px-3 py-2 border rounded-lg disabled:opacity-50">
          <i class="fas fa-chevron-left"></i>
        </button>
        <button 
          @click="navigateCitation('next')"
          :disabled="citationIndex === currentMessage.citations.length - 1"
          class="px-3 py-2 border rounded-lg disabled:opacity-50">
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>
    </div>
  </div>
</div>
```

## Configuration Files

### Chunking Config
```typescript
// src/config/chunking.config.ts
export const CHUNKING_CONFIG = {
  chunkSize: 1000, // tokens
  overlap: 200, // tokens
  preserveParagraphs: true,
  minChunkSize: 100,
  maxChunkSize: 2000
};
```

### Embedding Config
```typescript
// src/config/embedding.config.ts
export const EMBEDDING_CONFIG = {
  model: 'amazon.titan-embed-text-v1',
  dimensions: 1536,
  batchSize: 100,
  maxRetries: 3,
  retryDelay: 1000
};
```

### RAG Prompt Template
```typescript
// src/config/rag-prompt.config.ts
export const RAG_SYSTEM_PROMPT = `You are a financial research assistant...`;
```

## Key Editing Points

1. **RAG Prompt**: `src/config/rag-prompt.config.ts`
2. **Chunking Config**: `src/config/chunking.config.ts`
3. **Embedding Provider**: `src/rag/bedrock.service.ts`
4. **Table Renderer**: `public/app/deals/workspace.html` (renderMarkdown function)
5. **Citation Format**: `src/deals/deal-rag.service.ts` (buildPromptWithCitations)

## Next Steps

See `tasks.md` for implementation phases and task breakdown.
