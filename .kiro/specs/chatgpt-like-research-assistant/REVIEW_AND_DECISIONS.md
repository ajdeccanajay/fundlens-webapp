# Specification Review & Key Decisions

## Executive Summary

This document outlines critical decisions, trade-offs, and questions for review before implementation begins.

## 🎯 Scope Clarifications Needed

### 1. Deal vs. Ticker Relationship
**Current Assumption**: Each deal is associated with a ticker (e.g., AAPL)
**Question**: 
- Is a "Deal" a specific M&A transaction, investment opportunity, or just a workspace for analyzing a company?
- Can one deal have multiple tickers (e.g., merger analysis)?
- Should documents be scoped to ticker OR deal?

**Recommendation**: Clarify the Deal entity definition before proceeding.

---

### 2. Document Scope
**Current Spec**: Documents uploaded to a specific deal
**Questions**:
- Should documents be shareable across deals within a tenant?
- Should we support document libraries/folders?
- Should we version documents (upload new version of same doc)?

**Recommendation**: Start with deal-scoped documents, add sharing later if needed.

---

### 3. Existing vs. New Documents
**Current System**: You already have SEC filings (10-K, 10-Q) ingested
**Questions**:
- Should user-uploaded documents integrate with existing SEC documents?
- Should RAG search across BOTH user docs AND SEC filings?
- Should citations distinguish between user docs and SEC filings?

**Recommendation**: 
- Phase 1: User docs only (isolated system)
- Phase 2: Unified search across all documents


---

## 🏗️ Architecture Decisions

### 1. Vector Database Choice
**Proposed**: PostgreSQL + pgvector
**Pros**:
- Single database (no additional infrastructure)
- ACID compliance
- Tenant isolation built-in
- Good for <1M vectors

**Cons**:
- Performance degrades at scale (>10M vectors)
- Limited vector indexing options vs. specialized DBs

**Alternatives**:
- Pinecone (managed, scales well, costs $$)
- Weaviate (self-hosted, feature-rich)
- AWS OpenSearch (already in AWS ecosystem)

**Question**: What's your expected scale? (documents per tenant, total vectors)

**Recommendation**: Start with pgvector, migrate to specialized DB if needed.

---

### 2. Embedding Model
**Proposed**: AWS Bedrock Titan Embeddings (1536 dimensions)
**Pros**:
- Already using Bedrock for Claude
- No additional API keys
- Good quality embeddings

**Cons**:
- Vendor lock-in
- Cost per embedding
- Rate limits

**Alternatives**:
- OpenAI text-embedding-3-small (cheaper, 1536d)
- Cohere embed-english-v3.0 (4096d, better quality)
- Self-hosted (sentence-transformers, free but requires GPU)

**Question**: What's your budget for embeddings? (estimate: $0.0001 per 1K tokens)

**Recommendation**: Stick with Titan for consistency, easy to swap later.

---

### 3. Background Job Queue
**Proposed**: Bull (Redis-based)
**Pros**:
- Battle-tested
- Good monitoring (Bull Board)
- Retry logic built-in

**Cons**:
- Requires Redis
- Another service to manage

**Alternatives**:
- AWS SQS (managed, no Redis needed)
- BullMQ (newer, better TypeScript support)
- pg-boss (PostgreSQL-based, no Redis)

**Question**: Do you already have Redis in your stack?

**Recommendation**: 
- If Redis exists: Use Bull
- If not: Use pg-boss (PostgreSQL-based, simpler)


---

## 💰 Cost Implications

### Embedding Generation Costs
**Titan Embeddings**: $0.0001 per 1K tokens

**Example Calculation**:
- 100-page PDF = ~50K tokens
- Chunked into 50 chunks (1K tokens each)
- Cost: 50 chunks × $0.0001 = $0.005 per document
- 1000 documents = $5
- 10,000 documents = $50

**Question**: What's your expected document volume?

---

### Claude API Costs
**Claude 3 Sonnet**: $0.003/1K input tokens, $0.015/1K output tokens

**Example Calculation**:
- Query with 5 chunks (5K tokens context) + 100 token question = 5.1K input
- Response: 500 tokens output
- Cost per query: (5.1 × $0.003) + (0.5 × $0.015) = $0.0228
- 1000 queries/month = $22.80

**Question**: What's your expected query volume?

---

### Storage Costs
**S3 Standard**: $0.023 per GB/month
**PostgreSQL**: Depends on RDS instance size

**Example**:
- 1000 documents × 5MB avg = 5GB
- S3: $0.12/month
- Vectors in DB: ~500MB (negligible)

**Total Estimated Monthly Cost** (1000 docs, 1000 queries):
- Embeddings: $5 (one-time)
- Claude: $23
- Storage: $0.12
- **Total: ~$28/month** (excluding infrastructure)

---

## 🔒 Security Considerations

### 1. Document Access Control
**Current Spec**: Tenant-scoped only
**Questions**:
- Should we add user-level permissions? (owner, editor, viewer)
- Should we add deal-level permissions? (who can access which deals)
- Should we track document access logs?

**Recommendation**: Start with tenant-scoped, add RBAC in Phase 2.

---

### 2. Citation Validation
**Risk**: LLM might hallucinate citations
**Mitigation Options**:
1. Post-process citations to verify they exist in retrieved chunks
2. Use structured output format (JSON) for citations
3. Add confidence scores to citations

**Question**: How critical is citation accuracy? (financial/legal use case?)

**Recommendation**: Implement post-processing validation (Option 1).

---

### 3. Data Retention
**Questions**:
- How long should we keep documents?
- Should we soft-delete or hard-delete?
- Should we keep document history/versions?
- GDPR/compliance requirements?

**Recommendation**: Soft delete with 30-day retention, add hard delete script.


---

## 🎨 UX/UI Decisions

### 1. Document Panel Location
**Proposed**: Right sidebar (collapsible)
**Alternatives**:
- Modal/overlay (like ChatGPT)
- Separate tab
- Bottom drawer

**Question**: What's your preference? Right sidebar keeps docs visible while chatting.

**Recommendation**: Right sidebar for quick access, collapsible to maximize chat space.

---

### 2. Citation Display Style
**Proposed**: Numbered chips [1], [2] at end of answer
**Alternatives**:
- Inline footnotes (superscript numbers)
- Hover tooltips on cited text
- Sidebar with citations

**Question**: Do you want citations inline or at the end?

**Recommendation**: End-of-answer chips (cleaner, less cluttered).

---

### 3. Table Rendering
**Proposed**: HTML tables with horizontal scroll
**Questions**:
- Should we support table editing/export?
- Should we add charting (convert tables to charts)?
- Should we support Excel-like features (sorting, filtering)?

**Recommendation**: Start with basic HTML tables, add features based on user feedback.

---

### 4. Empty States
**Questions**:
- Should we show suggested questions when no messages?
- Should we show sample documents to upload?
- Should we have onboarding tooltips?

**Recommendation**: Add suggested questions + upload prompt for better UX.

---

## ⚡ Performance Considerations

### 1. Document Processing Time
**Target**: < 2 minutes for 100-page PDF
**Bottlenecks**:
- Text extraction: ~30s
- Chunking: ~5s
- Embedding generation: ~60s (50 chunks × 1.2s each)
- Database writes: ~5s

**Optimization Options**:
- Parallel embedding generation (batch API)
- Stream processing (show progress)
- Pre-warm embedding model

**Question**: What's acceptable processing time for users?

**Recommendation**: Show progress bar, process in background, notify when done.

---

### 2. Query Response Time
**Target**: First token < 2s, full response < 10s
**Bottlenecks**:
- Vector search: ~500ms
- Prompt building: ~100ms
- Claude streaming: ~8s (500 tokens @ 60 tokens/s)

**Optimization Options**:
- Cache frequent queries
- Pre-compute embeddings for common questions
- Use Claude 3 Haiku (faster, cheaper)

**Question**: Is speed or quality more important?

**Recommendation**: Use Sonnet for quality, add caching for speed.

---

### 3. Scalability Limits
**pgvector Performance**:
- Good: < 1M vectors
- Degraded: 1M - 10M vectors
- Poor: > 10M vectors

**Calculation**:
- 1000 documents × 50 chunks = 50K vectors ✅
- 10,000 documents × 50 chunks = 500K vectors ✅
- 100,000 documents × 50 chunks = 5M vectors ⚠️

**Question**: What's your growth projection?

**Recommendation**: Monitor performance, plan migration to specialized vector DB at 1M vectors.


---

## 🔄 Integration with Existing System

### 1. Hybrid RAG System
**Current System**: You have a sophisticated hybrid RAG with:
- Intent detection
- Query routing
- Structured retrieval (SQL)
- Semantic retrieval (Bedrock KB)

**Questions**:
- Should user-uploaded docs use the SAME hybrid RAG?
- Should we add a new retrieval path for user docs?
- Should we merge results from SEC filings + user docs?

**Recommendation**: 
- **Option A** (Simpler): Separate system for user docs initially
- **Option B** (Better UX): Integrate into existing hybrid RAG
  - Add "user_documents" as a new data source
  - Query router decides: SEC data vs user docs vs both
  - Merge and rerank results

**My Recommendation**: Option B for unified experience, but requires more work.

---

### 2. Existing Document Processing
**Current System**: You already process SEC filings with Python parser
**Questions**:
- Should user docs use the SAME processing pipeline?
- Should we extract financial metrics from user docs?
- Should we use the same chunking strategy?

**Recommendation**: 
- Reuse Python parser for financial metric extraction
- Use separate chunking for user docs (more flexible)
- Store both in same `chunks` table with `source_type` field

---

### 3. Conversation History
**Current System**: You have `research_conversations` and `research_messages`
**Questions**:
- Should we reuse existing conversation tables?
- Should we add `deal_id` to existing tables?
- Should we keep separate conversation systems?

**Recommendation**: Reuse existing tables, add `deal_id` field (nullable for backward compatibility).

---

## 📊 Data Model Refinements

### Suggested Schema Changes

```prisma
// Option 1: Separate tables (cleaner separation)
model DealDocument { ... }
model DealDocumentChunk { ... }
model Citation { ... }

// Option 2: Unified tables (better integration)
model Document {
  id String @id
  tenantId String
  dealId String? // nullable for SEC docs
  ticker String? // for SEC docs
  sourceType DocumentSourceType // USER_UPLOAD | SEC_FILING
  // ... rest of fields
}

enum DocumentSourceType {
  USER_UPLOAD
  SEC_FILING
  EXTERNAL_API
}
```

**Question**: Separate or unified tables?

**Recommendation**: Unified tables for easier querying across all documents.

---

## 🧪 Testing Strategy

### What to Test First
1. **Unit Tests** (Week 2-3):
   - Chunking logic
   - Citation parsing
   - Vector search

2. **Integration Tests** (Week 4):
   - Document upload → processing → indexing
   - Query → retrieval → response

3. **E2E Tests** (Week 5):
   - Full user flow
   - Error scenarios

**Question**: Do you have existing test infrastructure?

**Recommendation**: Follow existing test patterns, add new test files.

---

## 🚀 Deployment Considerations

### Infrastructure Needs
**New Requirements**:
- pgvector extension (PostgreSQL)
- Redis (if using Bull) OR pg-boss tables
- Increased S3 storage
- Increased RDS storage (for vectors)

**Questions**:
- Do you have staging environment?
- How do you handle database migrations in production?
- Do you have monitoring/alerting set up?

**Recommendation**: 
- Test pgvector on staging first
- Use blue-green deployment for schema changes
- Add CloudWatch alarms for processing failures

---

## 📝 Documentation Needs

### What to Document
1. **User Guide**:
   - How to upload documents
   - How to ask questions
   - How to interpret citations

2. **Developer Guide**:
   - How to modify chunking logic
   - How to change embedding model
   - How to customize prompts

3. **Operations Guide**:
   - How to monitor processing queue
   - How to handle failed documents
   - How to scale vector search

**Question**: Who's your target audience for docs?

**Recommendation**: Start with developer guide, add user guide later.


---

## ✅ Recommended Adjustments to Spec

### 1. Integrate with Existing Hybrid RAG
**Change**: Instead of separate RAG system, extend existing one
**Benefit**: Unified search across SEC filings + user docs
**Impact**: More complex but better UX

### 2. Use Unified Document Tables
**Change**: Add `source_type` field to existing tables
**Benefit**: Easier to query all documents together
**Impact**: Schema migration needed

### 3. Reuse Existing Conversation Tables
**Change**: Add `deal_id` to `research_messages` table
**Benefit**: Consistent conversation experience
**Impact**: Backward compatible migration

### 4. Use pg-boss Instead of Bull
**Change**: PostgreSQL-based job queue
**Benefit**: No Redis dependency
**Impact**: Simpler infrastructure

### 5. Add Citation Validation
**Change**: Post-process citations to verify accuracy
**Benefit**: Prevent hallucinated citations
**Impact**: Slight performance overhead

---

## 🎯 Prioritization Recommendations

### Must Have for MVP (4 weeks)
1. ✅ Document upload UI
2. ✅ PDF/DOCX text extraction
3. ✅ Basic chunking (sliding window)
4. ✅ Embedding generation
5. ✅ Vector search with tenant/deal filtering
6. ✅ RAG query with streaming
7. ✅ Citation display (basic)
8. ✅ Citation modal

### Should Have (Week 5-6)
1. Background job queue
2. Processing status tracking
3. Table rendering
4. Citation validation
5. Error handling
6. Basic tests

### Nice to Have (Future)
1. Advanced chunking (semantic)
2. Document versioning
3. Collaborative annotations
4. Export to PDF
5. Analytics dashboard

---

## 🤔 Key Questions for You

### Business Questions
1. **What's the primary use case?** (M&A analysis, investment research, compliance?)
2. **Who are the users?** (Analysts, portfolio managers, compliance officers?)
3. **What's the expected document volume?** (per tenant, per deal)
4. **What's the expected query volume?** (per user, per day)
5. **What's the budget?** (for embeddings, LLM calls, infrastructure)

### Technical Questions
1. **Do you have Redis in your stack?** (affects job queue choice)
2. **What's your PostgreSQL version?** (pgvector requires 11+)
3. **Do you have staging environment?** (for testing)
4. **What's your deployment process?** (CI/CD, manual, blue-green?)
5. **What's your monitoring setup?** (CloudWatch, Datadog, custom?)

### Product Questions
1. **Should documents be shareable across deals?**
2. **Should we integrate with existing SEC document search?**
3. **Should we support document versioning?**
4. **Should we add user-level permissions?**
5. **Should we add document folders/organization?**

---

## 📋 Next Steps

### Option 1: Approve & Start Implementation
If you're happy with the spec:
1. I'll start with Phase 1 (Database & Schema)
2. Create Prisma models
3. Generate migrations
4. Set up pgvector

### Option 2: Refine Specific Areas
Tell me which areas need more detail:
- Architecture decisions
- Data model
- UI/UX design
- Integration approach
- Testing strategy

### Option 3: Prototype First
Build a minimal prototype to validate:
- Document upload
- Basic RAG query
- Simple citation display
Then iterate based on feedback.

---

## 💡 My Recommendation

**Start with a 2-week MVP**:

**Week 1**: Backend Foundation
- Add pgvector + document tables
- Implement upload API
- Implement text extraction + chunking
- Implement embedding generation

**Week 2**: Frontend + RAG
- Add document panel UI
- Implement vector search
- Integrate with existing RAG
- Add basic citation display

**Deliverable**: Working prototype with:
- Upload 1 PDF
- Ask question
- Get answer with citations
- Click citation to see source

Then iterate based on what you learn.

**What do you think?**
