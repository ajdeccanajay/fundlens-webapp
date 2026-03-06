# FundLens Root Cause Analysis — Commit `617a1db`

**Repo:** `github.com/ajdeccanajay/fundlens-webapp` @ `617a1db`  
**Query:** "What is the revenue for AMZN?" — AAPL workspace  
**Date:** March 2, 2026

---

## Status of Previously Identified Fixes

| Fix | Status | File @ 617a1db | Line(s) |
|-----|--------|----------------|---------|
| Narrative budget 12K→20K | ✅ DONE | `src/rag/hybrid-synthesis.service.ts` | 73 |
| Force hybrid retrieval | ✅ DONE | `src/rag/query-router.service.ts` | No `useSemantic:false` anywhere |
| Dynamic word limits 700-1200 | ✅ DONE | `src/rag/hybrid-synthesis.service.ts` | 355-367 |
| Auto-trend revenue-class (QUL path) | ✅ DONE | `src/rag/rag.service.ts` | 1618-1620 |
| Filter invalid chart periods | ✅ DONE | `src/rag/visualization-generator.service.ts` | 59-63 |
| Chart metric deduplication | ✅ DONE | `src/rag/visualization-generator.service.ts` | 76-84 |
| Exclude uploaded-doc metrics from charts | ✅ DONE | `src/rag/visualization-generator.service.ts` | 51-57 |
| `extractCitations` source type | ❌ BROKEN | `src/rag/hybrid-synthesis.service.ts` | 661-662 |
| SEC metric citations always built | ❌ BROKEN | `src/rag/rag.service.ts` | 970, 1185 |
| Cross-source synthesis prompt | ❌ BROKEN | `src/rag/hybrid-synthesis.service.ts` | 278-282 |
| Narrative budget partitioning | ❌ NOT DONE | `src/rag/hybrid-synthesis.service.ts` | 524-554 |
| MAX_PROMPT_CHARS bump | ❌ NOT DONE | `src/rag/hybrid-synthesis.service.ts` | 74 |
| Disable mock parser | ❌ NOT DONE | `src/s3/sec-processing.service.ts` | 227-233 |
| Quick response bypass | ❌ NOT DONE | `src/rag/rag.service.ts` | 374-393 |
| Sonnet min for synthesis | ❌ NOT DONE | `src/rag/performance-optimizer.service.ts` | 389 |

---

## Issue 1: No SEC Filing Citations

### Root Cause

**File:** `src/rag/hybrid-synthesis.service.ts`, lines 661-662

```typescript
type: 'sec_filing',           // ← HARDCODED
sourceType: 'SEC_FILING',     // ← HARDCODED
```

Every citation extracted from the LLM response is labeled `SEC_FILING` regardless of whether the narrative chunk it references is from an uploaded document or an actual SEC filing. The chunk metadata HAS the correct source information (`source`, `sourceType`, `metadata.filingType`) but `extractCitations` ignores it.

### Why It Matters

The frontend renders citation badges based on `sourceType`. When the DBS analyst report gets labeled `SEC_FILING`, the user sees a misleading "SEC Filing" badge. And actual SEC filing data produces zero citations because the LLM didn't cite those narrative chunks — it cited the uploaded docs that dominated the narrative array.

### Fix

**File:** `src/rag/hybrid-synthesis.service.ts`, lines 655-662

FIND:
```typescript
      if (idx >= 0 && idx < narratives.length) {
        const chunk = narratives[idx];
        citations.push({
          id: `citation-${num}`,
          number: num,
          citationNumber: num,
          type: 'sec_filing',
          sourceType: 'SEC_FILING',
```

REPLACE WITH:
```typescript
      if (idx >= 0 && idx < narratives.length) {
        const chunk = narratives[idx];
        // Detect actual source type from chunk metadata
        const isUploadedDoc =
          chunk.source === 'user_document' ||
          chunk.sourceType === 'USER_UPLOAD' ||
          chunk.metadata?.filingType === 'uploaded-document' ||
          chunk.metadata?.sectionType === 'uploaded-document';
        const citationType = isUploadedDoc ? 'uploaded_document' : 'sec_filing';
        const citationSourceType = isUploadedDoc ? 'UPLOADED_DOC' : 'SEC_FILING';

        citations.push({
          id: `citation-${num}`,
          number: num,
          citationNumber: num,
          type: citationType,
          sourceType: citationSourceType,
```

---

## Issue 2: No Aggregated Inference from SEC + Uploaded Docs

### Root Cause A: Prompt tells LLM uploaded docs are "PRIMARY"

**File:** `src/rag/hybrid-synthesis.service.ts`, lines 278-282

```typescript
if (uploadedDocNarratives.length > 0 && secNarratives.length > 0) {
    sections.push(
      '=== UPLOADED DOCUMENT DATA (analyst reports, user-provided) ===',
      'IMPORTANT: Some of the narrative sources below come from documents uploaded by the analyst. These are PRIMARY, authoritative evidence. If they contain metric values (margins, revenue, etc.), use them directly and cite them.',
      '',
    );
```

This explicitly tells the LLM to prefer uploaded docs over SEC filings. The LLM obeys — it cites the DBS report for revenue, margins, and segment data while ignoring the SEC 10-K narratives that sit lower in the array.

### Root Cause B: `formatNarratives` fills sequentially — uploaded docs consume budget first

**File:** `src/rag/hybrid-synthesis.service.ts`, lines 524-554

`formatNarratives` iterates `ctx.narratives` in order and fills until 20K is consumed. The `mergeAndRerankResults` at `document-rag.service.ts:147` sorts by score descending. Uploaded docs score ≥0.85. SEC narratives from Bedrock KB score 0.5-0.75. So uploaded docs are at the front of the array and consume 60-80% of the budget. SEC content gets 4-8K chars — often truncated mid-section.

### Root Cause C: No instruction to cross-reference sources

The synthesis guidance (line 309) says "Reconcile numbers with narrative" but doesn't say "Reconcile across SEC filings and uploaded documents." The LLM doesn't know it should compare DBS report figures against SEC filing figures.

### Fix

**A) Replace the prompt at lines 277-290:**

```typescript
      if (uploadedDocNarratives.length > 0 && secNarratives.length > 0) {
        sections.push(
          '=== MULTI-SOURCE DATA ===',
          'The narrative sources below include BOTH:',
          '  • SEC FILINGS (10-K, 10-Q) — official regulatory filings, ground truth for reported figures',
          '  • UPLOADED DOCUMENTS — analyst reports, research notes with estimates and interpretations',
          '',
          'CROSS-SOURCE RULES:',
          '1. For reported financial figures, ALWAYS cite SEC filings as the authoritative source.',
          '2. Use uploaded documents for forward estimates, peer comparisons, and qualitative analysis.',
          '3. When both sources discuss the same metric, cite BOTH and note any discrepancies.',
          '4. You MUST include at least one SEC filing citation if SEC narrative sources are available.',
          '',
        );
        sections.push('=== ALL NARRATIVE SOURCES ===', allNarrativeBlock!, '');
```

**B) Partition the narrative budget in `formatNarratives` (lines 524-554):**

Replace the method with a partitioned version that gives SEC filings 60% of budget and uploaded docs 40%, while preserving the `[N]` numbering that `extractCitations` depends on. See the detailed implementation in the companion spec file.

**C) Bump `MAX_PROMPT_CHARS` from 28K to 40K (line 74):**

With 20K narratives + metrics table (~3K) + computed metrics (~2K) + instructions (~3K) = 28K. The prompt is being truncated at exactly the budget limit, losing synthesis guidance.

```typescript
const MAX_PROMPT_CHARS = 40_000;
```

---

## Issue 3: No Combined Citations (SEC + Uploaded Docs)

### Root Cause: `buildMetricCitations` only fires when `citations.length === 0`

**File:** `src/rag/rag.service.ts`, line 970

```typescript
if (citations.length === 0 && metrics.length > 0) {
    const metricCitations = this.buildMetricCitations(metrics);
```

`extractCitations` returns 2 citations from the uploaded docs (mislabeled as SEC_FILING). `citations.length === 2`, so this guard blocks. `buildMetricCitations` never fires. The SEC-sourced metrics (AAPL FY2022-2024, AMZN from DB) get zero citations.

**File:** `src/rag/rag.service.ts`, line 1185 (second call site, same pattern)

```typescript
if ((!citations || citations.length === 0) && metrics.length > 0) {
```

### Fix

**File:** `src/rag/rag.service.ts`, replace lines 968-974

FIND:
```typescript
          // FALLBACK: If LLM produced no narrative citations but we have
          // structured metrics, generate SEC filing citations from them.
          if (citations.length === 0 && metrics.length > 0) {
            const metricCitations = this.buildMetricCitations(metrics);
            citations = [...metricCitations];
            this.logger.log(`📊 Built ${metricCitations.length} metric-based SEC citations (no [N] markers in LLM response)`);
          }
```

REPLACE WITH:
```typescript
          // ALWAYS build SEC metric citations from structured data.
          // These prove the numbers independently of which narrative chunks the LLM cited.
          if (metrics.length > 0) {
            const secMetrics = metrics.filter((m: any) =>
              m.filingType !== 'uploaded-document'
            );
            if (secMetrics.length > 0) {
              const metricCitations = this.buildMetricCitations(secMetrics);
              // Deduplicate against existing citations
              const existingKeys = new Set(
                citations.map((c: any) => `${c.ticker}-${c.filingType}-${c.fiscalPeriod}`)
              );
              const newCitations = metricCitations.filter((c: any) =>
                !existingKeys.has(`${c.ticker}-${c.filingType}-${c.fiscalPeriod}`)
              );
              if (newCitations.length > 0) {
                const nextNum = citations.length > 0
                  ? Math.max(...citations.map((c: any) => c.number || c.citationNumber || 0)) + 1
                  : 1;
                newCitations.forEach((c: any, i: number) => {
                  c.number = nextNum + i;
                  c.citationNumber = nextNum + i;
                });
                citations = [...citations, ...newCitations];
                this.logger.log(`📊 Added ${newCitations.length} SEC metric citations (total: ${citations.length})`);
              }
            }
          }
```

**Also fix the second call site at line 1185** — apply the same logic (always build, don't guard on `citations.length === 0`).

---

## Issue 4: No AAPL Data Despite AAPL Workspace

### Root Cause: Correct LLM behavior, not a bug

Kiro's logs show AAPL data IS retrieved (3 metrics: revenue FY2022-FY2024) and passed to synthesis. The LLM doesn't surface it because the query is "What is the revenue for AMZN?" — focusing on AMZN is correct.

### Actual Issue: AMZN `net_sales` Resolution Gap

Kiro's logs state: "AMZN revenue in the DB uses normalizedMetric = 'net_sales' not 'revenue', and the metric resolution isn't mapping it."

The YAML registry (`income_statement.yaml`) lists "Net Sales" as a synonym for `revenue`. The `getSynonymsForDbColumn('revenue')` method (line 490 of `metric-registry.service.ts`) generates storage-normalized forms including `net_sales`. The Prisma query uses `mode: 'insensitive'`.

**Possible root causes for the miss:**
1. The S3-deployed YAML file is out of sync with the `.kiro/specs` source of truth
2. The DB column value is something unexpected (e.g., `Net_Sales` with capital N and S, or `NetSales` without underscore)
3. The metric resolution returns a canonical_id other than `revenue` that doesn't have `net_sales` in its synonym set

**Diagnostic query:**
```sql
SELECT DISTINCT normalized_metric 
FROM financial_metrics 
WHERE ticker = 'AMZN' 
  AND (normalized_metric ILIKE '%revenue%' OR normalized_metric ILIKE '%sales%');
```

**Belt-and-suspenders fix** — add to `getSynonymsForDbColumn` in `metric-registry.service.ts` after line 515:
```typescript
// Hardcoded fallbacks for critical cross-company metric variants
if (canonicalId === 'revenue') {
    for (const v of ['net_sales', 'Net Sales', 'total_revenue', 'Total Revenue', 'net_revenue']) {
        synonymSet.add(v);
    }
}
```

---

## Remaining Unfixed Issues (Not Addressed by Kiro's Recent Deploy)

### Critical — Fix Today

| # | Issue | File @ 617a1db | Lines | Impact |
|---|-------|----------------|-------|--------|
| **C1** | `extractCitations` hardcodes SEC_FILING | `hybrid-synthesis.service.ts` | 661-662 | Wrong citation types |
| **C2** | `buildMetricCitations` guarded by `citations.length===0` | `rag.service.ts` | 970, 1185 | No SEC citations when uploaded docs cited |
| **C3** | Prompt says uploaded docs are "PRIMARY" | `hybrid-synthesis.service.ts` | 278-282 | LLM ignores SEC narratives |
| **C4** | `formatNarratives` no budget partitioning | `hybrid-synthesis.service.ts` | 524-554 | Uploaded docs consume 80% of budget |
| **C5** | `MAX_PROMPT_CHARS` still 28K with 20K narrative budget | `hybrid-synthesis.service.ts` | 74 | Prompt truncated |

### High — Fix This Week

| # | Issue | File @ 617a1db | Lines | Impact |
|---|-------|----------------|-------|--------|
| **H1** | Quick response bypass skips LLM entirely | `rag.service.ts` | 374-393 | "Simple" queries get raw table, no analysis |
| **H2** | Haiku used for synthesis on simple queries | `performance-optimizer.service.ts` | 389 | Thin responses when LLM does run |
| **H3** | Mock parser still active ingestion path | `sec-processing.service.ts` | 227-233 | Wrong values, wrong periods in DB |
| **H4** | `mergeAndRerankResults` score-sorts without source preference | `document-rag.service.ts` | 147-151 | Uploaded docs always outrank SEC |

### Implementation Order

```
Day 1:  C1 (extractCitations) + C2 (always build SEC citations)  → 15 lines changed
Day 1:  C3 (fix prompt) + C5 (bump MAX_PROMPT_CHARS)             → 20 lines changed
Day 2:  C4 (budget partitioning in formatNarratives)              → 50 lines changed
Day 2:  H1 (remove/narrow quick response bypass)                  → 5 lines changed
Day 2:  H2 (Sonnet minimum for synthesis)                         → 1 line changed
Day 3:  H4 (merge with SEC boost)                                 → 10 lines changed
Day 3:  H3 (disable mock parser)                                  → 5 lines changed
```

Total: ~106 lines across 5 files. No new files. No dependency changes.
