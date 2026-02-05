# Changelog - February 5, 2026

## Deployment Summary

**Docker Image**: `prod-88b34c1-20260205-haiku-fix`
**Git Commit**: `88b34c1`
**ECS Status**: 2 tasks running

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
| Phase 3 | 🔄 Not Started | Advanced retrieval techniques (HyDE, reranking) |
| Phase 4 | ⏳ Not Started | Dynamic calculations and multi-modal responses |

---

## Files Modified

```
src/rag/intent-detector.service.ts
src/rag/bedrock.service.ts
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

1. Proceed with Phase 3: Advanced Retrieval Techniques
   - Reranker Service (Mistral via Bedrock)
   - HyDE (Hypothetical Document Embeddings)
   - Query Decomposition
   - Contextual Chunk Expansion
   - Iterative Retrieval
