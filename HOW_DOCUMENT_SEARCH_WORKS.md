# How Document Search Works in Research Assistant

## Quick Answer
**Your uploaded documents are automatically searchable!** Just ask questions in the research assistant and it will search both SEC filings AND your uploaded documents, returning results with citations.

---

## The Complete Flow

### 1. Upload & Indexing (Automatic)

```
You Upload PDF
    ↓
Saved to S3: {tenantId}/{ticker}/user_uploads/
    ↓
Text Extracted (PDF/DOCX/TXT)
    ↓
Split into Chunks (~1000 chars each)
    ↓
Embeddings Generated (Bedrock)
    ↓
Stored in PostgreSQL (document_chunks table)
    ↓
S3 Lambda Syncs to Bedrock KB (automatic)
    ↓
✅ Document is now searchable!
```

**Time**: ~30-60 seconds after upload

### 2. Asking Questions (Automatic Search)

When you type a question in the research assistant:

```javascript
// You type: "What does the pitch deck say about revenue?"

// Backend automatically:
1. Detects query intent
2. Searches SEC filings (10-K, 10-Q)
3. Searches YOUR uploaded documents  ← AUTOMATIC
4. Merges and re-ranks results
5. Generates answer with citations
6. Returns response with [1], [2], [3] citations
```

### 3. Code Flow

**Frontend** (`workspace.html`):
```javascript
// You just type and send - no special action needed
sendResearchMessage() {
  // Sends to: POST /api/research/conversations/{id}/messages
  // With: { content: "your question", context: { tickers: ["AAPL"] } }
}
```

**Backend** (`research-assistant.service.ts`):
```typescript
async sendMessage(conversationId, dto) {
  // Automatically includes user documents in search
  const ragResult = await this.ragService.query(query, {
    includeNarrative: true,
    includeCitations: true,
    tenantId: tenantId,        // ← Enables user doc search
    ticker: dto.context.tickers[0]  // ← Scopes to ticker
  });
  
  // Returns answer with citations from both SEC + user docs
}
```

**RAG Service** (`rag.service.ts`):
```typescript
async query(query, options) {
  // 1. Search SEC filings
  const secNarratives = await this.semanticRetriever.retrieve(query);
  
  // 2. Search USER documents (if tenantId provided)
  if (options.tenantId && options.includeCitations) {
    const userDocs = await this.documentRAG.searchUserDocuments(query, {
      tenantId: options.tenantId,
      ticker: options.ticker,
      topK: 5,
      minScore: 0.7
    });
    
    // 3. MERGE results (SEC + user docs)
    const merged = this.documentRAG.mergeAndRerankResults(
      userDocs.chunks,
      secNarratives,
      10  // Top 10 combined
    );
  }
  
  // 4. Generate answer with citations
  const answer = await this.bedrock.generate(query, {
    narratives: merged,
    includeCitations: true
  });
  
  return { answer, citations };
}
```

---

## What You See

### Before Upload
```
You: "What does the pitch deck say about revenue?"
AI: "I don't have access to a pitch deck for AAPL. I can provide 
     information from SEC filings..."
```

### After Upload (Automatic!)
```
You: "What does the pitch deck say about revenue?"
AI: "According to the pitch deck [1], revenue grew 25% YoY to $2.5B 
     in Q4 2023. This aligns with the 10-K filing [2] which shows..."

Citations:
[1] pitch-deck.pdf • Page 3
    "Revenue increased from $2B to $2.5B, representing 25% growth..."
    
[2] AAPL 10-K 2023 • Revenue Section
    "Total net sales increased 25% to $2.5 billion..."
```

---

## Key Features

### 1. **Automatic Integration**
- No special commands needed
- Just upload and ask questions
- System automatically searches both sources

### 2. **Hybrid Search**
- Searches SEC filings (structured data)
- Searches user documents (unstructured data)
- Merges and re-ranks by relevance

### 3. **Smart Scoping**
- Scoped by `tenantId` (you only see your docs)
- Scoped by `ticker` (if provided in context)
- Respects document permissions

### 4. **Citations**
- Every answer includes citations
- Click citation to preview document
- Shows exact page/section referenced

---

## Example Queries

### Query 1: Direct Document Question
```
You: "What does the investor presentation say about market size?"

System searches:
✓ Your uploaded "investor-presentation.pdf"
✓ SEC filings mentioning market size
✓ Returns merged results with citations
```

### Query 2: Cross-Reference
```
You: "Compare the revenue forecast in the pitch deck with actual 10-K results"

System searches:
✓ Your uploaded "pitch-deck.pdf" for forecast
✓ SEC 10-K for actual results
✓ Returns comparison with citations from both
```

### Query 3: Ticker-Scoped
```
You: "What are the risks?" (with ticker=AAPL in context)

System searches:
✓ AAPL SEC filings
✓ Your uploaded docs tagged with AAPL
✓ Ignores docs for other tickers
```

---

## Behind the Scenes

### Database Schema
```sql
-- Your uploaded documents
CREATE TABLE documents (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  ticker VARCHAR(10),
  title TEXT,
  file_type VARCHAR(10),
  source_type VARCHAR(20) DEFAULT 'USER_UPLOAD',
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMP
);

-- Searchable chunks
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY,
  document_id UUID REFERENCES documents(id),
  tenant_id UUID NOT NULL,
  ticker VARCHAR(10),
  chunk_index INTEGER,
  content TEXT,
  embedding vector(1536),  -- For semantic search
  token_count INTEGER,
  created_at TIMESTAMP
);
```

### Search Query
```sql
-- Semantic search using embeddings
SELECT 
  dc.id,
  dc.content,
  d.title as filename,
  d.ticker,
  1 - (dc.embedding <=> $1::vector) as similarity_score
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE 
  dc.tenant_id = $2  -- Your tenant only
  AND dc.ticker = $3  -- Scoped to ticker
  AND 1 - (dc.embedding <=> $1::vector) > 0.7  -- Min 70% relevance
ORDER BY similarity_score DESC
LIMIT 5;
```

---

## Configuration

### Required Environment Variables
```bash
# Already configured in your .env
BEDROCK_KB_ID=your-kb-id
AWS_REGION=us-east-1
S3_BUCKET_NAME=fundlens-documents-dev
DATABASE_URL=postgresql://...
```

### Automatic Features
- ✅ S3 Lambda sync (automatic)
- ✅ Embedding generation (automatic)
- ✅ Bedrock KB indexing (automatic)
- ✅ Search integration (automatic)
- ✅ Citation extraction (automatic)

---

## Testing

### 1. Upload a Document
```
1. Go to: http://localhost:3000/app/deals/workspace.html?ticker=AAPL#research
2. Click "Upload Document"
3. Select a PDF with known content
4. Wait for "✅ Document uploaded successfully!"
```

### 2. Verify Indexing
```
1. Click "Documents (1)"
2. Check status changes from "Processing" to "Indexed"
3. Wait ~30 seconds for full indexing
```

### 3. Ask a Question
```
1. Type: "What does [your document] say about [topic]?"
2. Send message
3. Watch for citations [1], [2], etc.
4. Click citation to preview document
```

### 4. Check Console Logs
```javascript
// Backend logs show:
📄 Searching user documents for tenant xxx
📄 Found 3 relevant user document chunks (avg score: 0.85)
🔀 Merged results: 8 total narratives
📎 Extracted 3 citations from user documents
```

---

## Troubleshooting

### Document not appearing in search?

**Check 1: Is it indexed?**
```
Click "Documents" → Check status is "Indexed" (not "Processing")
```

**Check 2: Is it relevant?**
```
Minimum relevance score: 0.7 (70%)
Try asking more specific questions
```

**Check 3: Is ticker correct?**
```
Document must be tagged with same ticker as query context
```

**Check 4: Backend logs**
```bash
# Look for:
📄 Searching user documents for tenant xxx
📄 Found X relevant user document chunks

# If you see:
📄 Found 0 relevant user document chunks
# → Document not relevant to query OR not indexed yet
```

---

## Performance

### Search Speed
- **SEC filings**: ~500ms
- **User documents**: ~300ms
- **Merge & rerank**: ~100ms
- **Total**: ~1 second

### Relevance
- **Minimum score**: 0.7 (70% similarity)
- **Top K results**: 5 per source
- **Combined results**: Top 10 merged

### Limits
- **Max documents**: 25 per tenant
- **Max file size**: 10MB
- **Max chunks per doc**: ~100 (for 100-page PDF)

---

## Summary

**You don't need to do anything special!**

1. ✅ Upload document
2. ✅ Wait for "Indexed" status
3. ✅ Ask questions normally
4. ✅ Get answers with citations from both SEC + your docs

The system **automatically**:
- Searches your documents
- Merges with SEC filings
- Ranks by relevance
- Generates citations
- Returns combined answer

**It just works!** 🎉
