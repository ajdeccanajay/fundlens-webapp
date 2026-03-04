# Fix: Kill the Regex, Upgrade All Models, Harden Fallback Chain

## Commit: 8ea0076

---

## Verified Bedrock Model IDs (March 2026)

| Model | Bedrock Inference Profile ID | Notes |
|-------|------------------------------|-------|
| **Sonnet 4.6** | `us.anthropic.claude-sonnet-4-6` | New simplified format, no date. GA. |
| **Opus 4.6** | `us.anthropic.claude-opus-4-6-v1` | Inference profile only. |
| **Haiku 4.5** | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | GA. |
| Sonnet 4.5 | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | Deprecated by Sonnet 4.6. |
| Opus 4.5 | `us.anthropic.claude-opus-4-5-20251101-v1:0` | Currently in codebase. |

**Before deploying:** Verify in AWS Console → Bedrock → Model Access that Sonnet 4.6 and Haiku 4.5 are enabled. Request access if not.

---

## Fix 1: Kill regex fast path in legacy intent detector

**File:** `src/rag/intent-detector.service.ts`

**Lines 151-157** — The regex intercepts queries at ≥ 0.9 confidence before the LLM ever runs. This causes:
- `needsNarrative: false` on every regex hit (line 741) → no MD&A context ever reaches synthesis
- Rigid pattern matching that misses synonyms, implicit metrics, conversational phrasing
- Every edge case requires a new regex rule — unscalable by definition

**FIND:**
```typescript
    // Layer 1: Regex Fast-Path (Req 1.2)
    const fastPathResult = this.regexFastPath(query, contextTicker);
    if (fastPathResult.confidence >= 0.9) {
      this.llmUsageStats.regexSuccess++;
      this.logger.log(`✅ Regex fast-path hit (confidence: ${fastPathResult.confidence.toFixed(2)}, latency: ${Date.now() - startTime}ms)`);
      await this.logDetection(fastPathResult, 'regex_fast_path', tenantId, startTime);
      return fastPathResult;
    }
```

**REPLACE WITH:**
```typescript
    // Regex pre-processing — provides seed data for fallback only, NEVER short-circuits.
    // Previously returned early at ≥0.9 confidence, bypassing LLM entirely.
    // Disabled because: regex hardcodes needsNarrative=false, misses synonyms,
    // and every edge case requires a new regex rule (unscalable).
    const fastPathResult = this.regexFastPath(query, contextTicker);
    this.logger.debug(`Regex pre-parse (seed only): ticker=${JSON.stringify(fastPathResult.ticker)}, metrics=${JSON.stringify(fastPathResult.metrics)}, confidence=${fastPathResult.confidence.toFixed(2)}`);
```

**Effect:** Regex still runs (its output seeds `buildFallbackIntent` if BOTH LLMs crash), but it never returns early. Every query flows: cache → Haiku 4.5 → Sonnet 4.6 fallback → regex last resort. Cost: ~$0.001/query for Haiku call. Latency: +200-500ms for queries that previously hit regex — irrelevant vs. the 2-5s synthesis step.

---

## Fix 2: Upgrade the entire QUL fallback chain

**File:** `src/rag/query-understanding.service.ts`

The QUL chain currently runs: Haiku 3.5 → Sonnet 3.5 → regex. Upgrade both LLM tiers so the regex tier almost never fires.

**Line 202 — Haiku primary:**

**FIND:**
```typescript
        modelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
```

**REPLACE WITH:**
```typescript
        modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
```

**Line 250 — Sonnet fallback:**

**FIND:**
```typescript
          modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
```

**REPLACE WITH:**
```typescript
          modelId: 'us.anthropic.claude-sonnet-4-6',
```

**Post-fix QUL chain:**
```
Tier 1: Cache hit → return
Tier 2: Haiku 4.5 (fast, cheap, much better instruction following than 3.5)
Tier 2b: Sonnet 4.6 (fires only when Haiku 4.5 fails — near-zero chance of regex)
Tier 3: Regex fallback (only if BOTH Haiku 4.5 AND Sonnet 4.6 are down)
```

With Haiku 4.5 + Sonnet 4.6, the regex tier 3 should fire approximately never — only during a simultaneous Bedrock outage of both model families. That's the correct architecture: regex exists as a circuit-breaker safety net, not as a processing path.

---

## Fix 3: Upgrade the legacy intent detector LLM

**File:** `src/rag/intent-detection/llm-detection-engine.ts`

**Line 82:**

**FIND:**
```typescript
  private static readonly MODEL_ID = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';
```

**REPLACE WITH:**
```typescript
  private static readonly MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
```

**Effect:** The legacy path (deals/chat, direct API) also gets Haiku 4.5 for intent detection. Combined with Fix 1 (killing regex early return), this means all legacy queries flow: cache → Haiku 4.5 → regex fallback.

---

## Fix 4: Upgrade synthesis to Sonnet 4.6

**File:** `src/rag/performance-optimizer.service.ts`

**Lines 391-395:**

**FIND:**
```typescript
    const models = {
      haiku: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
      sonnet: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      opus: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
    };
```

**REPLACE WITH:**
```typescript
    const models = {
      haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      sonnet: 'us.anthropic.claude-sonnet-4-6',
      opus: 'us.anthropic.claude-opus-4-6-v1',
    };
```

**Effect:** Every RAG synthesis runs on Sonnet 4.6. Complex queries get Opus 4.6. The `haiku` tier isn't used for synthesis anymore (min is Sonnet), but updated for consistency.

---

## Fix 5: Upgrade 3 stale Claude 3 Haiku references

These services still use the original Claude 3 Haiku from March 2024 — nearly 2 years old.

| File | Line | Find | Replace |
|------|------|------|---------|
| `src/rag/hyde.service.ts` | 146 | `'us.anthropic.claude-3-haiku-20240307-v1:0'` | `'us.anthropic.claude-haiku-4-5-20251001-v1:0'` |
| `src/rag/query-decomposer.service.ts` | 64 | `'us.anthropic.claude-3-haiku-20240307-v1:0'` | `'us.anthropic.claude-haiku-4-5-20251001-v1:0'` |
| `src/rag/iterative-retrieval.service.ts` | 283 | `'us.anthropic.claude-3-haiku-20240307-v1:0'` | `'us.anthropic.claude-haiku-4-5-20251001-v1:0'` |

Also update the Haiku intent parser:

| File | Line | Find | Replace |
|------|------|------|---------|
| `src/rag/haiku-intent-parser.service.ts` | 12 | `'us.anthropic.claude-3-5-haiku-20241022-v1:0'` | `'us.anthropic.claude-haiku-4-5-20251001-v1:0'` |

And the document metric extractor:

| File | Line | Find | Replace |
|------|------|------|---------|
| `src/rag/document-metric-extractor.service.ts` | 133 | `'us.anthropic.claude-3-5-haiku-20241022-v1:0'` | `'us.anthropic.claude-haiku-4-5-20251001-v1:0'` |

---

## Fix 6: Kill mock parser error fallback

**File:** `src/s3/sec-processing.service.ts`

**Lines 273-276:**

**FIND:**
```typescript
    } catch (error) {
      this.logger.error(`Error extracting metrics (falling back to mock): ${error.message}`);
      // Fall back to mock metrics
      return this.extractMetricsMock(ticker, filingType, content, accessionNumber);
    }
```

**REPLACE WITH:**
```typescript
    } catch (error) {
      this.logger.error(`Python parser failed for ${ticker} ${filingType}: ${error.message}. Returning empty — filing will need reprocessing.`);
      return [];
    }
```

---

## Post-Fix Architecture: The Complete Model Map

```
┌──────────────────────────────────────────────────────────┐
│                  QUERY ARRIVES                            │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  INTENT DETECTION                                        │
│  ┌─ QUL Path (research-assistant) ───────────────────┐   │
│  │  Cache → Haiku 4.5 → Sonnet 4.6 → regex fallback │   │
│  └───────────────────────────────────────────────────┘   │
│  ┌─ Legacy Path (deals/chat, API) ───────────────────┐   │
│  │  Cache → Haiku 4.5 → regex fallback               │   │
│  │  (regex NEVER short-circuits, only last resort)    │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  SUPPORTING LLM CALLS                                    │
│  ┌───────────────────────────────────────────────────┐   │
│  │  HyDE:                Haiku 4.5                    │   │
│  │  Query decomposition: Haiku 4.5                    │   │
│  │  Iterative retrieval: Haiku 4.5                    │   │
│  │  Doc metric extract:  Haiku 4.5                    │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  SYNTHESIS (response generation)                         │
│  ┌───────────────────────────────────────────────────┐   │
│  │  Standard:  Sonnet 4.6                             │   │
│  │  Complex:   Opus 4.6                               │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  NO MORE:                                                │
│  ✗ Claude 3 Haiku (March 2024)                           │
│  ✗ Claude 3.5 Haiku (Oct 2024)                           │
│  ✗ Claude 3.5 Sonnet v2 (Oct 2024)                       │
│  ✗ Regex fast path returning at ≥0.9 confidence          │
│  ✗ Mock parser fallback                                  │
└──────────────────────────────────────────────────────────┘
```

---

## Deployment Checklist

```
PRE-DEPLOY:
[ ] Verify in Bedrock console: Sonnet 4.6 enabled (model: anthropic.claude-sonnet-4-6)
[ ] Verify in Bedrock console: Opus 4.6 enabled (model: anthropic.claude-opus-4-6-v1)
[ ] Verify in Bedrock console: Haiku 4.5 enabled (model: anthropic.claude-haiku-4-5-20251001-v1:0)
[ ] Update IAM policy to allow inference on the new model ARNs

CODE CHANGES (6 fixes, 10 files):
[ ] Fix 1: Kill regex early return — intent-detector.service.ts:151-157
[ ] Fix 2: Upgrade QUL chain — query-understanding.service.ts:202, 250
[ ] Fix 3: Upgrade legacy LLM engine — llm-detection-engine.ts:82
[ ] Fix 4: Upgrade synthesis models — performance-optimizer.service.ts:391-395
[ ] Fix 5: Upgrade stale Haiku refs — hyde.service.ts:146, query-decomposer.service.ts:64,
           iterative-retrieval.service.ts:283, haiku-intent-parser.service.ts:12,
           document-metric-extractor.service.ts:133
[ ] Fix 6: Kill mock parser fallback — sec-processing.service.ts:273-276

POST-DEPLOY VERIFICATION:
[ ] Test: "What is the revenue for AMZN?" — verify logs show Haiku 4.5 intent detection (NOT regex fast-path)
[ ] Test: Verify synthesis log shows Sonnet 4.6 model ID
[ ] Test: Response quality — answer should be 700+ words with cross-source citations
[ ] Test: Latency — expect <8s total (intent <500ms + synthesis <5s + overhead)
[ ] Monitor: Watch for any Bedrock 4xx errors on new model IDs
```

---

## Summary

| What | Before | After |
|------|--------|-------|
| Regex fast path | Returns early at ≥0.9, skips LLM | Never returns early. Seed data only. |
| QUL intent: primary | Haiku 3.5 | **Haiku 4.5** |
| QUL intent: fallback | Sonnet 3.5 v2 | **Sonnet 4.6** |
| QUL intent: last resort | Regex | Regex (unchanged — fires only if both LLMs down) |
| Legacy intent | Regex → Cache → Haiku 3.5 | Cache → **Haiku 4.5** → regex last resort |
| Synthesis: standard | Sonnet 3.5 v2 | **Sonnet 4.6** |
| Synthesis: complex | Opus 4.5 | **Opus 4.6** |
| Supporting LLM calls | Claude 3 Haiku (Mar 2024) | **Haiku 4.5** |
| Mock parser | Falls back to regex extraction | Returns empty (no garbage data) |
