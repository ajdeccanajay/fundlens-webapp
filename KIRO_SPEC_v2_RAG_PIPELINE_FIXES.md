# RAG Pipeline Fix Spec v2 — Kiro Implementation Guide

**Date:** March 2, 2026  
**Commit:** 8ea0076  
**Priority:** CRITICAL — deploy all fixes together  
**Guiding principle:** The MetricRegistryService + ConceptRegistryService are the single source of truth for what constitutes a metric. Never hand-maintain word lists, stopword arrays, or hardcoded keyword→metric mappings. Let the existing resolution infrastructure do its job.

---

## Architecture Context

When a user asks "What is the revenue for AMZN?" in Research Assistant:

```
Query → QUL (Haiku) → buildIntentFromQUL() → buildPlanFromQUL()
  → Parallel:
      1. structuredRetriever.retrieveLatest() → PostgreSQL financial_metrics
      2. semanticRetriever.retrieveWithContext() → Bedrock KB narratives
      3. searchUploadedDocs() → pgvector uploaded docs
  → hybridSynthesis.synthesize() → citations
  → Response
```

**Currently broken:** Step 1 returns 0 rows because `intent.metrics` is never populated. QUL produces `normalizedQuery: "AMZN revenue latest"` but no structured `subQueries[].metric`. The metric name "revenue" is trapped in a string that nobody parses. The structured retriever receives an empty metrics array, loops over nothing, returns nothing. Six years of data in PostgreSQL, untouched.

---

## FIX 1: Metric Extraction from normalizedQuery

### The Design

When QUL provides no `subQueries` (which is the norm for METRIC_LOOKUP — Haiku's few-shot examples don't include them), extract metric terms from `normalizedQuery` by passing every token through `MetricRegistryService.resolve()`.

**No stopword arrays. No hardcoded keyword maps.** The registry already knows what IS and ISN'T a metric. `resolve('amzn')` → unresolved (discarded). `resolve('revenue')` → exact match (kept). `resolve('show')` → unresolved (discarded). `resolve('net income')` → exact match (kept). `resolve('revnue')` → fuzzy_auto at 0.88 (kept — handles typos).

The registry uses `normalizeForLookup()` which strips all non-alphanumeric characters and lowercases. So `net_income`, `Net Income`, `NET_INCOME`, `net-income` all normalize to `netincome` and match the same canonical metric. Underscores, capitalization, spaces, hyphens — all irrelevant. The normalization layer already handles this.

### Fix 1A: Extract metrics in buildIntentFromQUL

**File:** `src/rag/rag.service.ts`  
**Method:** `buildIntentFromQUL` (~line 1621)

**FIND:**
```typescript
    // Extract metric hints from QUL subQueries
    const metrics: string[] = [];
    if (qul.subQueries && qul.subQueries.length > 0) {
      for (const sq of qul.subQueries) {
        if (sq.metric) metrics.push(sq.metric);
      }
    }

    return {
      type,
      ticker,
      metrics: metrics.length > 0 ? metrics : undefined,
```

**REPLACE WITH:**
```typescript
    // Extract metric hints from QUL subQueries
    const metrics: string[] = [];
    if (qul.subQueries && qul.subQueries.length > 0) {
      for (const sq of qul.subQueries) {
        if (sq.metric) metrics.push(sq.metric);
      }
    }

    // When QUL provides no subQueries (standard for METRIC_LOOKUP — the few-shot
    // examples intentionally omit them for simple queries), extract metric terms
    // from normalizedQuery by resolving every token through MetricRegistryService.
    //
    // No stopword arrays or hardcoded keyword maps. The registry IS the filter:
    //   resolve('amzn') → unresolved → skip
    //   resolve('revenue') → exact → keep
    //   resolve('net income') → exact → keep
    //   resolve('revnue') → fuzzy_auto (0.88) → keep (handles typos)
    //
    // normalizeForLookup() inside resolve() strips all non-alphanumeric chars and
    // lowercases, so net_income / "Net Income" / NET_INCOME all match identically.
    if (metrics.length === 0 && qul.normalizedQuery && this['metricRegistry']) {
      const tokens = qul.normalizedQuery.toLowerCase().split(/\s+/).filter(t => t.length > 1);

      // Build candidate list: single tokens + bigrams + underscore-joined bigrams
      // Bigrams catch multi-word metrics: "net income" → "net income", "net_income"
      const candidates: string[] = [...tokens];
      for (let i = 0; i < tokens.length - 1; i++) {
        candidates.push(`${tokens[i]} ${tokens[i + 1]}`);
        candidates.push(`${tokens[i]}_${tokens[i + 1]}`);
      }
      // Trigrams for three-word metrics: "cost of revenue", "cash from operations"
      for (let i = 0; i < tokens.length - 2; i++) {
        candidates.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
        candidates.push(`${tokens[i]}_${tokens[i + 1]}_${tokens[i + 2]}`);
      }

      const seen = new Set<string>();
      for (const candidate of candidates) {
        try {
          const resolution = this['metricRegistry'].resolve(candidate);
          // Accept exact matches and high-confidence fuzzy (handles typos like "revnue")
          if (resolution && resolution.confidence !== 'unresolved' && !seen.has(resolution.canonical_id)) {
            metrics.push(resolution.canonical_id);
            seen.add(resolution.canonical_id);
          }
        } catch { /* resolve() threw — skip this candidate */ }
      }

      if (metrics.length > 0) {
        this.logger.log(`📊 Extracted ${metrics.length} metric(s) from normalizedQuery: [${metrics.join(', ')}]`);
      }
    }

    return {
      type,
      ticker,
      metrics: metrics.length > 0 ? metrics : undefined,
```

### Fix 1B: Safety net in buildPlanFromQUL

**File:** `src/rag/rag.service.ts`  
**Method:** `buildPlanFromQUL` (~line 1715)

Same approach — let the registry filter, no word lists.

**FIND:**
```typescript
    // Resolve metrics through MetricRegistryService (same as queryRouter does)
    const metricHints = intent.metrics || [];
    let resolvedMetrics: any[] = [];
```

**REPLACE WITH:**
```typescript
    // Resolve metrics through MetricRegistryService (same as queryRouter does)
    let metricHints = intent.metrics || [];

    // Safety net: if buildIntentFromQUL didn't extract metrics (unusual phrasing,
    // or metric appears only as trigram), try once more from normalizedQuery.
    // Uses the same registry-as-filter pattern — no stopword arrays.
    if (metricHints.length === 0 && qul.normalizedQuery && this.metricRegistry) {
      const tokens = (qul.normalizedQuery || '').toLowerCase().split(/\s+/).filter((t: string) => t.length > 1);
      const candidates = [...tokens];
      for (let i = 0; i < tokens.length - 1; i++) {
        candidates.push(`${tokens[i]} ${tokens[i + 1]}`);
        candidates.push(`${tokens[i]}_${tokens[i + 1]}`);
      }
      const seen = new Set<string>();
      for (const candidate of candidates) {
        try {
          const res = this.metricRegistry.resolve(candidate);
          if (res && res.confidence !== 'unresolved' && !seen.has(res.canonical_id)) {
            metricHints.push(res.canonical_id);
            seen.add(res.canonical_id);
          }
        } catch { /* skip */ }
      }
      if (metricHints.length > 0) {
        intent.metrics = metricHints;
        this.logger.log(`📊 buildPlanFromQUL safety net: extracted [${metricHints.join(', ')}] from normalizedQuery`);
      }
    }

    let resolvedMetrics: any[] = [];
```

### Fix 1C: Update QUL few-shot examples

**File:** `src/prompts/qul-examples.json`

**CRITICAL CONTEXT FOR KIRO:** These are few-shot examples shown to Haiku to guide its JSON output format. They are NOT hard-coded logic — they are teaching examples. Haiku learns from them by analogy. The current METRIC_LOOKUP examples omit the `subQueries` field, which teaches Haiku to omit it too. By adding `subQueries` with a `metric` field to these examples, Haiku will learn to produce them. This is a training signal, not a rule.

Fix 1A/1B are the deterministic safety nets that work regardless of what Haiku produces. Fix 1C improves Haiku's output quality so the safety nets fire less often.

**Update example at index 1** (description: "Workspace context correctly applied"):

Replace its `output` with:
```json
{
  "entities": [{"name": "Airbnb", "ticker": "ABNB", "entityType": "public_company", "source": "workspace_context"}],
  "intent": "METRIC_LOOKUP",
  "domain": "public_equity",
  "isValidQuery": true,
  "confidence": 0.92,
  "temporalScope": {"type": "latest"},
  "normalizedQuery": "ABNB revenue latest",
  "suggestedChart": "metric_card",
  "subQueries": [
    {"intent": "METRIC_LOOKUP", "entity": "ABNB", "metric": "revenue", "temporal": "latest", "path": "structured_db", "metricType": "atomic"}
  ]
}
```

**Update example at index 4** (description: "Coreference follow-up..."):

Replace its `output` with:
```json
{
  "entities": [{"name": "NVIDIA", "ticker": "NVDA", "entityType": "public_company", "source": "coreference"}],
  "intent": "METRIC_LOOKUP",
  "domain": "public_equity",
  "isValidQuery": true,
  "confidence": 0.9,
  "useWorkspaceContext": false,
  "temporalScope": {"type": "latest"},
  "normalizedQuery": "NVDA operating margin latest",
  "subQueries": [
    {"intent": "METRIC_LOOKUP", "entity": "NVDA", "metric": "operating_margin", "temporal": "latest", "path": "structured_db", "metricType": "computed"}
  ]
}
```

**Add new example at end of array** (teaches Haiku with multi-word metric and explicit ticker):
```json
{
  "description": "Simple revenue query with explicit ticker in workspace",
  "input": {
    "query": "What is the revenue for AMZN?",
    "workspace": {"ticker": "AMZN", "company_name": "Amazon", "domain": "public_equity"},
    "uploaded_documents": [],
    "conversation_history": []
  },
  "output": {
    "entities": [{"name": "Amazon", "ticker": "AMZN", "entityType": "public_company", "source": "explicit"}],
    "intent": "METRIC_LOOKUP",
    "domain": "public_equity",
    "isValidQuery": true,
    "confidence": 0.95,
    "temporalScope": {"type": "latest"},
    "normalizedQuery": "AMZN revenue latest",
    "subQueries": [
      {"intent": "METRIC_LOOKUP", "entity": "AMZN", "metric": "revenue", "temporal": "latest", "path": "structured_db", "metricType": "atomic"}
    ]
  }
}
```

**Add another example** (teaches multi-word metric extraction):
```json
{
  "description": "Multi-word metric query: net income",
  "input": {
    "query": "Show me AAPL's net income for last year",
    "workspace": {"ticker": "AAPL", "company_name": "Apple", "domain": "public_equity"},
    "uploaded_documents": [],
    "conversation_history": []
  },
  "output": {
    "entities": [{"name": "Apple", "ticker": "AAPL", "entityType": "public_company", "source": "workspace_context"}],
    "intent": "METRIC_LOOKUP",
    "domain": "public_equity",
    "isValidQuery": true,
    "confidence": 0.93,
    "temporalScope": {"type": "specific_period", "periods": ["FY2025"]},
    "normalizedQuery": "AAPL net income FY2025",
    "subQueries": [
      {"intent": "METRIC_LOOKUP", "entity": "AAPL", "metric": "net_income", "temporal": "FY2025", "path": "structured_db", "metricType": "atomic"}
    ]
  }
}
```

---

## FIX 2: AMZN Metric Name Mismatch in PostgreSQL

### Problem

Kiro's logs: AAPL returns 3 rows with `normalizedMetric: "revenue"`, `rawLabel: "Net sales"`. AMZN returns 0 rows for the same query. The data exists (Metrics page shows FY2020-FY2025). The `normalized_metric` column value for AMZN doesn't match any synonym in the expansion.

### Diagnosis (run first)

```sql
SELECT DISTINCT normalized_metric, raw_label, COUNT(*), MIN(fiscal_period), MAX(fiscal_period)
FROM financial_metrics
WHERE ticker = 'AMZN'
GROUP BY normalized_metric, raw_label
ORDER BY COUNT(*) DESC;
```

### Understanding the normalization chain

When the structured retriever queries, `getSynonymsForDbColumn('revenue')` produces:
```
revenue, Revenue, Revenues, Net Revenue, Net Revenues, Sales, Net Sales,
revenues, net_revenue, net_revenues, sales, net_sales
```

These are queried with Prisma `mode: 'insensitive'`, so case is irrelevant. `normalizeForStorage()` converts spaces to underscores, so `Net Sales` → `net_sales`.

If AMZN's data is stored as something outside this list (e.g., `total_net_sales`, `net_product_sales`, `Total Revenue`), the query misses.

### Fix

Based on the DB query results:

**If the stored value is a reasonable synonym** (e.g., `net_product_sales`, `Total net sales`) → add it to the YAML:

**File:** `.kiro/specs/metric-resolution-architecture/income_statement.yaml`

```yaml
revenue:
  display_name: Revenue
  type: atomic
  statement: income_statement
  synonyms:
  - Revenue
  - Revenues
  - Net Revenue
  - Net Revenues
  - Sales
  - Net Sales
  - Total Net Sales          # ← Add if found
  - Net Product Sales        # ← Add if found
  - Total Revenue            # ← Add if found
  # ... whatever the DB query reveals
```

After adding to the YAML, `getSynonymsForDbColumn` will automatically generate the storage-normalized forms (`net_product_sales`, `total_net_sales`, etc.) and include them in the DB query. No other code changes needed — the normalization chain handles it.

**If the data was ingested with a completely wrong value** (e.g., raw HTML text, garbage from mock parser) → clean the data:

```sql
-- Check what it actually is first
SELECT normalized_metric, value, fiscal_period, raw_label, confidence_score
FROM financial_metrics
WHERE ticker = 'AMZN' AND filing_type = '10-K'
ORDER BY fiscal_period DESC
LIMIT 20;

-- If it's fixable with an update:
UPDATE financial_metrics
SET normalized_metric = 'revenue'
WHERE ticker = 'AMZN'
AND raw_label ILIKE '%revenue%' OR raw_label ILIKE '%net sales%'
AND normalized_metric NOT IN ('revenue');
```

---

## FIX 3: Case-Insensitive Matching in getLatestByFilingType

### Problem

The main `retrieve()` method uses `{ equals: ticker, mode: 'insensitive' }` for ticker matching, but `getLatestByFilingType()` does raw string comparison: `where: { ticker, filingType }`. If QUL passes `'amzn'` (lowercase) but the DB stores `'AMZN'`, the query silently returns 0 rows.

### Fix

**File:** `src/rag/structured-retriever.service.ts`  
**Method:** `getLatestByFilingType` (~line 570)

**FIND:**
```typescript
    const results = await this.prisma.financialMetric.findMany({
      where: {
        ticker,
        normalizedMetric: { in: synonyms, mode: 'insensitive' },
        filingType,
      },
      orderBy: { statementDate: 'desc' },
    });
```

**REPLACE WITH:**
```typescript
    const results = await this.prisma.financialMetric.findMany({
      where: {
        ticker: { equals: ticker, mode: 'insensitive' },
        normalizedMetric: { in: synonyms, mode: 'insensitive' },
        filingType: { equals: filingType, mode: 'insensitive' },
      },
      orderBy: { statementDate: 'desc' },
    });
```

---

## FIX 4: Citation Source Type Misclassification

### Problem

`buildMetricCitations()` detects uploaded docs by checking `filingType === 'uploaded-document' && fileName`. If `fileName` is missing (undefined), the metric falls through to the SEC_FILING block. Kiro's logs confirm: `{"type":"sec_filing","sourceType":"SEC_FILING","ticker":"AMZN","filingType":"uploaded-document","excerpt":"DBS Group Research..."}`.

Additionally, the dedup key `${ticker}-${filingType}-${fiscalPeriod}` doesn't include source type or metric name, so different metrics from the same filing collapse into one citation, and uploaded doc citations can shadow SEC citations.

### Fix 4A: Robust source detection in buildMetricCitations

**File:** `src/rag/rag.service.ts`  
**Method:** `buildMetricCitations` (~line 2917)

**FIND:**
```typescript
  private buildMetricCitations(metrics: MetricResult[]): any[] {
      const seen = new Set<string>();
      const citations: any[] = [];
      let num = 1;

      for (const metric of metrics) {
        // Handle uploaded document metrics — generate UPLOADED_DOC citations
        if ((metric as any).filingType === 'uploaded-document' && (metric as any).fileName) {
          const key = `upload-${(metric as any).fileName}-${metric.normalizedMetric}`;
          if (seen.has(key)) continue;
          seen.add(key);
```

**REPLACE WITH:**
```typescript
  private buildMetricCitations(metrics: MetricResult[]): any[] {
      const seen = new Set<string>();
      const citations: any[] = [];
      let num = 1;

      for (const metric of metrics) {
        // Detect uploaded document source — check ALL available signals.
        // Previously checked only filingType + fileName. If fileName was undefined,
        // uploaded doc metrics fell through and were labeled SEC_FILING.
        const isUploadedDoc =
          (metric as any).filingType === 'uploaded-document' ||
          (metric as any).source === 'user_document' ||
          (metric as any).sourceType === 'USER_UPLOAD' ||
          (metric as any)._fromUploadedDoc === true;

        if (isUploadedDoc) {
          const key = `upload-${(metric as any).fileName || metric.ticker}-${metric.normalizedMetric}-${metric.fiscalPeriod || ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
```

### Fix 4B: Source-aware dedup key for SEC citations

In the same method, the SEC citation block:

**FIND:**
```typescript
        // SEC filing metrics
        const key = `${metric.ticker}-${metric.filingType}-${metric.fiscalPeriod}`;
        if (seen.has(key)) continue;
        seen.add(key);
```

**REPLACE WITH:**
```typescript
        // SEC filing metrics — include normalizedMetric in dedup key so each metric
        // gets its own citation (revenue and net_income from the same 10-K are separate).
        // Prefix with 'sec-' to prevent any collision with uploaded doc keys.
        const key = `sec-${metric.ticker}-${metric.filingType}-${metric.fiscalPeriod}-${metric.normalizedMetric}`;
        if (seen.has(key)) continue;
        seen.add(key);
```

### Fix 4C: Robust pre-filter for SEC vs uploaded doc separation

The pre-filter that separates SEC metrics from uploaded doc metrics also needs all signals:

**FIND (appears at ~line 955 AND ~line 1193 — fix both):**
```typescript
            const secMetrics = metrics.filter((m: any) =>
              m.filingType !== 'uploaded-document'
            );
```

**REPLACE BOTH OCCURRENCES WITH:**
```typescript
            const secMetrics = metrics.filter((m: any) =>
              m.filingType !== 'uploaded-document' &&
              (m as any).source !== 'user_document' &&
              (m as any).sourceType !== 'USER_UPLOAD' &&
              !(m as any)._fromUploadedDoc
            );
```

---

## FIX 5: Eliminate Hardcoded Keyword→Metric Map in getContextualMetrics

### Problem

The `getContextualMetrics()` side-channel in semantic-retriever.service.ts uses a hand-maintained keyword→metric map:

```typescript
if (queryLower.includes('revenue') || queryLower.includes('sales')) {
    metrics.push('revenue', 'total_revenue');
}
```

This is the same brittle pattern. It hardcodes `['revenue', 'total_revenue']` instead of using MetricRegistryService's synonym expansion. If AMZN's data is stored as `'net_sales'`, this misses it. It also requires manual updates whenever a new metric or synonym is added to the YAML.

### Fix

**File:** `src/rag/semantic-retriever.service.ts`  
**Method:** `getContextualMetrics` (~line 762)

Replace the entire hardcoded keyword mapping block with registry-based resolution. The approach: extract metric candidates from the query text the same way Fix 1A does, then resolve through MetricRegistryService.

**FIND the block from ~line 771 to ~line 825** (the entire `const queryLower = ...` through to `const metricResolutions: MetricResolution[] = metrics.map(m => ({`):

**REPLACE WITH:**
```typescript
      // Extract metrics from query using MetricRegistryService — no hardcoded keyword maps.
      // Same approach as buildIntentFromQUL: tokenize, build candidates, resolve through registry.
      const queryTokens = query.query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
      const candidates: string[] = [...queryTokens];
      for (let i = 0; i < queryTokens.length - 1; i++) {
        candidates.push(`${queryTokens[i]} ${queryTokens[i + 1]}`);
        candidates.push(`${queryTokens[i]}_${queryTokens[i + 1]}`);
      }
      for (let i = 0; i < queryTokens.length - 2; i++) {
        candidates.push(`${queryTokens[i]} ${queryTokens[i + 1]} ${queryTokens[i + 2]}`);
      }

      const metrics: string[] = [];
      const seen = new Set<string>();
      const registry = this['metricRegistry'] || this['structuredRetriever']?.['metricRegistry'];

      if (registry) {
        for (const candidate of candidates) {
          try {
            const resolution = registry.resolve(candidate);
            if (resolution && resolution.confidence !== 'unresolved' && !seen.has(resolution.canonical_id)) {
              metrics.push(resolution.canonical_id);
              seen.add(resolution.canonical_id);
            }
          } catch { /* skip */ }
        }
      }

      // Fallback: if no metrics identified (registry unavailable or query has no metric terms),
      // use core financial metrics for general context
      if (metrics.length === 0) {
        metrics.push('revenue', 'net_income', 'total_assets', 'operating_cash_flow');
      }

      // Build MetricResolution objects with full synonym expansion from registry.
      // getSynonymsForDbColumn produces ALL variant forms (original + storage-normalized),
      // ensuring we match regardless of how the data was ingested.
      const metricResolutions: MetricResolution[] = metrics.map(m => ({
```

**IMPORTANT:** Also inject MetricRegistryService into SemanticRetrieverService if it's not already injected. Check the constructor:

```typescript
// If MetricRegistryService is not already injected:
constructor(
    private readonly structuredRetriever: StructuredRetrieverService,
    private readonly metricRegistry: MetricRegistryService,  // ← Add if missing
    // ... other deps
) {}
```

---

## FIX 6: Model Upgrades + Regex Fast Path Removal

### Fix 6A: QUL fallback chain

**File:** `src/rag/query-understanding.service.ts`

```
Line ~202:  claude-3-5-haiku-20241022        → claude-haiku-4-5-20251001
Line ~250:  claude-3-5-sonnet-20241022-v2    → claude-sonnet-4-6
```

### Fix 6B: Synthesis models

**File:** `src/rag/performance-optimizer.service.ts` (~line 391)

```
sonnet: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'  → 'us.anthropic.claude-sonnet-4-6'
opus: 'us.anthropic.claude-opus-4-5-20251101-v1:0'      → 'us.anthropic.claude-opus-4-6-v1'
```

### Fix 6C: Stale Claude 3 Haiku references (5 files)

All `claude-3-haiku-20240307` → `claude-haiku-4-5-20251001`:
- `src/rag/hyde.service.ts:146`
- `src/rag/query-decomposer.service.ts:64`
- `src/rag/iterative-retrieval.service.ts:283`
- `src/rag/haiku-intent-parser.service.ts:12`
- `src/rag/document-metric-extractor.service.ts:133`

### Fix 6D: Kill regex fast path

**File:** `src/rag/intent-detector.service.ts` (~lines 151-157)

Remove the early return when regex confidence ≥ 0.9. Keep regex logic as fallback seed, but delete:
```typescript
if (regexResult.confidence >= 0.9) {
    return regexResult;  // ← DELETE this early return
}
```

---

## DEPLOYMENT CHECKLIST

### Pre-deploy
- [ ] Run AMZN DB diagnosis query from Fix 2 → determine exact `normalized_metric` values
- [ ] Apply YAML synonym addition or DB data fix based on results
- [ ] Verify Bedrock access for new model IDs (Haiku 4.5, Sonnet 4.6, Opus 4.6)
- [ ] Ensure `MetricRegistryService` is injectable into `SemanticRetrieverService` (Fix 5)

### Code changes
1. **Fix 1A** — `rag.service.ts` — metric extraction in `buildIntentFromQUL`
2. **Fix 1B** — `rag.service.ts` — safety net in `buildPlanFromQUL`
3. **Fix 1C** — `qul-examples.json` — updated METRIC_LOOKUP examples (4 examples: update 2, add 2)
4. **Fix 3** — `structured-retriever.service.ts` — case-insensitive ticker/filingType
5. **Fix 4A/B/C** — `rag.service.ts` — citation source detection + dedup keys (3 locations)
6. **Fix 5** — `semantic-retriever.service.ts` — registry-based metric extraction replaces hardcoded map
7. **Fix 6A-D** — model upgrades + regex removal (8 files)

### Post-deploy verification

**Test 1:** "What is the revenue for AMZN?" in AMZN workspace
```
Expected logs:
  📊 Extracted 1 metric(s) from normalizedQuery: [revenue]
  🔍 STRUCTURED RETRIEVER: Metric Query Conditions:
     Searching for metrics: ["revenue"]
     Total synonyms in IN clause: 12+
  📊 Retrieved N structured metrics    ← N > 0

Expected response:
  Multi-year revenue (FY2020-FY2025: $386.1B → $716.9B)
  SEC filing citations (sourceType: SEC_FILING)
  Uploaded doc citations (sourceType: UPLOADED_DOC) — correctly separated
  Cross-source narrative synthesis
```

**Test 2:** "What is AAPL's net income?" in AAPL workspace
```
Expected: net_income extracted → structured metrics returned → SEC citations
```

**Test 3:** Citation source types
```
Expected: DBS Group Research → UPLOADED_DOC, never SEC_FILING
Expected: 10-K data → SEC_FILING, never UPLOADED_DOC
```

**Test 4:** Edge cases
```
"Show me revnue for AMZN" → fuzzy_auto catches typo → revenue resolved
"What's the gross profit margin?" → bigram "gross profit" resolved, or
    trigram "gross profit margin" → concept registry → metric bundle
"How much cash does AAPL have?" → "cash" might not resolve as exact metric →
    concept registry fallback in buildPlanFromQUL catches it via "cash" trigger
```

---

## FIX 7: Comprehensive Synonym Expansion (YAML Audit)

### Why This Matters

The resolution chain has three layers:

1. **Exact match** (synonym index) -- O(1) lookup after normalization. Catches anything in the YAML.
2. **Fuzzy match** (>=0.85 string similarity) -- Catches typos like "revnue" -> "revenue" (0.88).
3. **Concept match** -- Catches high-level queries like "how profitable" -> metric bundle.

Fuzzy matching is a **typo safety net**, not the reliability strategy. It fails for semantic equivalence: "top line" vs "revenue" scores ~0.15 (miss). "bottom line" vs "net income" scores ~0.20 (miss). An analyst asking "what's the top line?" gets nothing if "top line" isn't in the YAML.

**The reliability strategy is comprehensive synonyms.** Every natural language variant an analyst would use -- across public equity, private equity, credit, and sector contexts -- must be in the YAML. This is a one-time investment per metric that compounds forever. Once "top line" is a synonym for revenue, it works through the exact-match path with zero ambiguity.

### Implementation

Apply the synonym additions from the companion file `COMPREHENSIVE_SYNONYM_EXPANSION.yaml`. That file contains ~450 new synonyms across:

- **Analyst colloquial** -- "top line", "bottom line", "burn rate", "cash pile"
- **SEC filing raw labels** -- "Net product sales" (Amazon), "Revenue from Contracts with Customers" (ASC 606)
- **IFRS** -- "Profit for the Period", "Revenue from Ordinary Activities"
- **PE / LBO** -- "Adjusted EBITDA", "Covenant EBITDA", "turns of leverage", "equity check"
- **Credit / leveraged finance** -- "CFADS", "FCCR", "DSCR", "Bank EBITDA"
- **Abbreviations** -- "Rev", "NI", "GP", "EPS", "OCF", "FCF", "ARR", "NRR"
- **Company-specific** -- Amazon's "Net Product Sales", "Technology and Content"
- **Concept triggers** -- "how much debt", "what are the margins", "cash runway"

**Key principle:** Do NOT add storage-normalized forms. `getSynonymsForDbColumn()` auto-generates them. Adding `"Net Product Sales"` to the YAML automatically produces `"net_product_sales"` for DB queries. Only add semantically distinct synonyms in their most human-readable form.

---

## DEPLOYMENT CHECKLIST (Updated)

### Pre-deploy
- [ ] Run AMZN DB diagnosis query from Fix 2 -- determine exact `normalized_metric` values
- [ ] Apply YAML synonym addition or DB data fix based on results
- [ ] Apply comprehensive synonym expansion from `COMPREHENSIVE_SYNONYM_EXPANSION.yaml` (Fix 7)
- [ ] Verify Bedrock access for new model IDs (Haiku 4.5, Sonnet 4.6, Opus 4.6)
- [ ] Ensure `MetricRegistryService` is injectable into `SemanticRetrieverService` (Fix 5)

### Code changes
1. **Fix 1A** -- `rag.service.ts` -- metric extraction in `buildIntentFromQUL`
2. **Fix 1B** -- `rag.service.ts` -- safety net in `buildPlanFromQUL`
3. **Fix 1C** -- `qul-examples.json` -- updated METRIC_LOOKUP examples (4 examples: update 2, add 2)
4. **Fix 3** -- `structured-retriever.service.ts` -- case-insensitive ticker/filingType
5. **Fix 4A/B/C** -- `rag.service.ts` -- citation source detection + dedup keys (3 locations)
6. **Fix 5** -- `semantic-retriever.service.ts` -- registry-based metric extraction replaces hardcoded map
7. **Fix 6A-D** -- model upgrades + regex removal (8 files)
8. **Fix 7** -- YAML synonym expansion across all metric definition files

---

## Design Principles Applied

| Principle | How it's applied |
|-----------|------------------|
| Registry as single source of truth | Fixes 1A, 1B, 5 all resolve through MetricRegistryService -- no parallel keyword maps |
| Comprehensive synonyms over fuzzy matching | Fix 7 adds ~450 synonyms so exact-match handles semantic equivalence; fuzzy is only a typo net |
| normalizeForLookup handles all format variants | Underscores, spaces, caps, hyphens all collapse. No case/format-specific code needed |
| Concept registry for high-level queries | "profitability", "leverage", "how much cash" -> concept match -> metric bundle expansion |
| Few-shot examples guide, not dictate | Fix 1C teaches Haiku to produce subQueries. Fixes 1A/1B work regardless of what Haiku returns |
| Every DB query case-insensitive | Fix 3 ensures ticker/filingType matching can never fail on capitalization |
| Source attribution checks all signals | Fix 4 checks filingType, source, sourceType, _fromUploadedDoc -- no single point of failure |
| MetricLearningService closes gaps over time | Unresolved queries logged with YAML suggestions -- synonym list grows from real usage |
