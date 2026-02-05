# Changelog - February 5, 2026

## Deployment Summary

**Docker Image**: `prod-88b34c1-20260205-haiku-fix`
**Git Commit**: `88b34c1`
**ECS Status**: 2 tasks running

---

## Phase 3: Advanced Retrieval Techniques (NEW)

### Services Implemented

1. **Reranker Service** (`src/rag/reranker.service.ts`)
   - Integrates Cohere Rerank 3.5 via AWS Bedrock Rerank API
   - Re-scores retrieved chunks for improved relevance (0.0 to 1.0)
   - Sorts chunks by reranked scores descending
   - Fallback to original scores on failure
   - Feature flag: `ENABLE_RERANKING`

2. **HyDE Service** (`src/rag/hyde.service.ts`)
   - Hypothetical Document Embeddings for better retrieval
   - Generates hypothetical answer using Claude 3 Haiku
   - Retrieves using both hypothetical and original query embeddings
   - Merges and deduplicates results
   - Feature flag: `ENABLE_HYDE`

3. **Query Decomposition Service** (`src/rag/query-decomposition.service.ts`)
   - Breaks complex multi-faceted queries into sub-queries
   - Uses Claude to decompose queries intelligently
   - Executes each sub-query independently
   - Merges results with source tracking
   - Feature flag: `ENABLE_QUERY_DECOMPOSITION`

4. **Contextual Expansion Service** (`src/rag/contextual-expansion.service.ts`)
   - Expands retrieved chunks with adjacent context
   - Fetches chunks with chunk_index ± 1
   - Enforces token budget (default 4000 tokens)
   - Preserves chunk boundaries for citations
   - Feature flag: `ENABLE_CONTEXTUAL_EXPANSION`

5. **Iterative Retrieval Service** (`src/rag/iterative-retrieval.service.ts`)
   - Detects low-confidence results
   - Generates follow-up queries to fill gaps
   - Maximum 2 iterations
   - Tracks which iteration contributed to results
   - Feature flag: `ENABLE_ITERATIVE_RETRIEVAL`

6. **Advanced Retrieval Service** (`src/rag/advanced-retrieval.service.ts`)
   - Orchestrates all advanced techniques
   - Feature flags for each technique
   - Performance monitoring (p95 < 5s SLA)
   - Graceful fallback on failures

### Environment Variables

```bash
# Feature Flags (all default to true)
ENABLE_RERANKING=true
ENABLE_HYDE=true
ENABLE_QUERY_DECOMPOSITION=true
ENABLE_CONTEXTUAL_EXPANSION=true
ENABLE_ITERATIVE_RETRIEVAL=true

# Configuration
BEDROCK_RERANK_MODEL_ARN=arn:aws:bedrock:us-east-1::foundation-model/cohere.rerank-v3-5:0
CONTEXT_TOKEN_BUDGET=4000
MAX_RETRIEVAL_ITERATIONS=2
RETRIEVAL_CONFIDENCE_THRESHOLD=0.5
```

---

## Critical Fixes

### 1. Claude Opus 4.5 Model Access Restored
- **Issue**: Claude Opus 4.5 was not accessible in production
- **Root Cause**: AWS changed model access flow - models now require foundation model agreements
- **Fix**: Created agreement using `aws bedrock create-foundation-model-agreement` with offer token
- **Status**: ✅ Model authorized and working

### 2. Intent Detection Ticker Preservation Fix
- **Issue**: Research assistant queries failing with "Invalid input or configuration provided"
- **Root Cause**: When regex confidence was exactly 0.7 and LLM fallback failed, the ticker was lost
- **Fix**: Created `detectGenericWithRegexFallback()` method to preserve regex-detected values
- **Files Changed**: `src/rag/intent-detector.service.ts`
- **Commit**: `be7ae05`
- **Status**: ✅ Deployed and verified

### 3. Bedrock Model IDs Updated to Inference Profiles
- **Issue**: Claude 3.5 Haiku LLM fallback failing with "Invocation of model ID with on-demand throughput isn't supported"
- **Root Cause**: AWS now requires inference profile IDs instead of direct model IDs for on-demand invocation
- **Fix**: Updated model IDs to use inference profiles:
  - `anthropic.claude-3-5-haiku-20241022-v1:0` → `us.anthropic.claude-3-5-haiku-20241022-v1:0`
  - `anthropic.claude-3-haiku-20240307-v1:0` → `us.anthropic.claude-3-haiku-20240307-v1:0`
- **Files Changed**: 
  - `src/rag/intent-detector.service.ts`
  - `src/rag/bedrock.service.ts`
- **Commit**: `88b34c1`
- **Status**: ✅ Deployed and verified

---

## Verification Tests

### Intent Detection with LLM Fallback
```bash
# Test 1: Explicit ticker (regex detection)
Query: "What are the main competitive advantages of NVDA?"
Result: ✅ Regex detection succeeded (confidence: 0.7)
Ticker: NVDA

# Test 2: Ambiguous query (LLM fallback)
Query: "Tell me about the chip company that makes GPUs for AI"
Result: ✅ LLM detection succeeded (confidence: 0.8, latency: 1929ms)
Ticker: NVDA (correctly identified by Claude 3.5 Haiku)
```

### RAG Query End-to-End
- ✅ Knowledge Base retrieval working
- ✅ Ticker filtering applied correctly
- ✅ Claude Opus 4.5 response generation working
- ✅ Metrics and narratives retrieved successfully

---

## AWS Billing Note

**Important**: Bedrock Knowledge Base retrieval was failing due to unpaid AWS bill. After payment, all services resumed normal operation.

---

## RAG Competitive Intelligence Spec Status

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | ✅ Complete | Core subsection extraction and storage |
| Phase 2 | ✅ Complete | Intent detection and subsection-aware retrieval |
| Phase 3 | ✅ Complete | Advanced retrieval techniques (HyDE, reranking) |
| Phase 4 | ⏳ Not Started | Dynamic calculations and multi-modal responses |

### Phase 3 Git Tag
- **Tag**: `rag-extraction-phase3-v1.0.0`
- **Commit**: `2501f03`
- **Rollback**: `git checkout rag-extraction-phase2-v1.0.0` to revert to Phase 2

---

## Files Modified

```
src/rag/intent-detector.service.ts
src/rag/bedrock.service.ts
src/rag/rag.module.ts
```

## Files Created (Phase 3)

```
src/rag/reranker.service.ts
src/rag/hyde.service.ts
src/rag/query-decomposition.service.ts
src/rag/contextual-expansion.service.ts
src/rag/iterative-retrieval.service.ts
src/rag/advanced-retrieval.service.ts
```

## Deployment Commands

```bash
# Build and push
docker buildx build --platform linux/amd64 \
  -t 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-backend:prod-88b34c1-20260205-haiku-fix \
  -t 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-backend:latest \
  -f Dockerfile . --push

# Deploy to ECS
aws ecs update-service \
  --cluster fundlens-cluster \
  --service fundlens-backend-service \
  --force-new-deployment \
  --region us-east-1
```

---

## Next Steps

1. ~~Proceed with Phase 3: Advanced Retrieval Techniques~~ ✅ Complete
2. Deploy Phase 3 services to production
3. Test advanced retrieval with real queries
4. Phase 4: Dynamic Calculations and Multi-Modal Responses (future)
