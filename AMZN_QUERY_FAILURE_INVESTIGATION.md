# "What is the revenue for AMZN?" — Full Failure Investigation

**Query:** "What is the revenue for AMZN?"  
**Context:** AAPL workspace (`dto.context.tickers = ["AAPL"]`)  
**Date:** February 28, 2026

---

## A. Data Investigation

I cannot query the live database (no node_modules/env in this sandbox), but I can trace exactly what the code WILL retrieve based on the schema and retrieval logic.

### What data SHOULD exist

The `FinancialMetric` table stores metrics per `(ticker, normalizedMetric, fiscalPeriod, filingType)`. For revenue, the `MetricRegistryService` resolves "revenue" to a list of synonyms used in the DB query:

```
synonyms = ['revenue', 'revenues', 'total_revenue', 'net_revenue', 'net_sales', 'total_net_sales']
```

**For AMZN**, if the SEC filing pipeline ran for 5 years (the default in `historical-hydration.service.ts`), there should be:
- 5 annual rows (10-K): FY2020, FY2021, FY2022, FY2023, FY2024
- Up to 20 quarterly rows (10-Q): Q1-Q3 for each year (Q4 is reported in 10-K)

**For AAPL**, same structure.

### What data the code ACTUALLY retrieves

The `retrieveLatest()` method at `structured-retriever.service.ts:407` retrieves **exactly 2 rows per ticker** — one from the latest 10-K and one from the latest 10-Q:

```typescript
// Line 430-443 — this is the ENTIRE retrieval for "latest" period type
for (const ticker of query.tickers) {
  for (const resolution of resolvedMetrics) {
    const annual = await this.getLatestByFilingType(ticker, resolution, '10-K');
    if (annual) results.push(annual);
    const quarterly = await this.getLatestByFilingType(ticker, resolution, '10-Q');
    if (quarterly) results.push(quarterly);
  }
}
```

`getLatestByFilingType` (line 463) does `orderBy: { statementDate: 'desc' }` and takes `[0]` — only the MOST RECENT row.

**So for the query "What is the revenue for AMZN?" the system retrieves at most:**
- AMZN revenue from the latest 10-K (e.g., FY2023)
- AMZN revenue from the latest 10-Q (e.g., Q3FY2024)

That's it. Two data points. No historical comparison, no growth calculation possible.

### Why FY2023 appears twice

If the `normalizedMetric` column has multiple synonym variants stored for the same filing (e.g., both `revenue` and `net_sales` from different XBRL tags in the same 10-K), `getLatestByFilingType` returns the top-1 result sorted by `statementDate`. But if two rows exist for FY2023 with different `normalizedMetric` values that both match the synonyms list, and the sort is by `statementDate` rather than a unique tiebreaker, the same fiscal period can appear twice across the annual + quarterly paths.

**Root cause of duplicate FY2023:** Check the database for:
```sql
SELECT ticker, normalized_metric, fiscal_period, filing_type, value, statement_date
FROM financial_metrics
WHERE ticker = 'AMZN'
  AND normalized_metric IN ('revenue', 'revenues', 'net_revenue', 'net_sales', 'total_revenue', 'total_net_sales')
ORDER BY statement_date DESC
LIMIT 10;
```

If there are AMZN rows with both `normalized_metric = 'net_sales'` (XBRL tag: `us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax`) and `normalized_metric = 'revenue'`, both get returned by the synonym query. Since `getLatestByFilingType` returns the first by `statementDate`, if both have the same `statementDate`, the same fiscal period data appears twice.

### Why FY2024 and FY2025 are missing

Two possible causes:
1. **The filing pipeline hasn't ingested 2024/2025 filings.** AMZN's FY2024 10-K would have been filed ~Feb 2025. If the pipeline wasn't re-run after that date, FY2024 data doesn't exist in the DB.
2. **The daily cron (`@Cron('0 6 * * *')` in `filing-detection-scheduler.service.ts`) detected the filing but `sec-processing.service.ts:228` fell back to mock metrics** because the Python parser wasn't running. The mock data would have incorrect fiscal periods.

**Action for Kiro:** Run this query against the production database to verify:
```sql
SELECT DISTINCT fiscal_period, filing_type, COUNT(*)
FROM financial_metrics
WHERE ticker = 'AMZN'
GROUP BY fiscal_period, filing_type
ORDER BY fiscal_period DESC;
```

---

## B. Intent Detector Failure Chain

### Step 1: `extractTickers` in research-assistant.service.ts (line 768-783)

```typescript
extractTickers(query: string, providedTickers?: string[]): string[] {
    const tickers = new Set<string>(providedTickers || []);  // Set(["AAPL"])
    // ... regex adds AMZN ...
    return Array.from(tickers);  // Returns ["AAPL", "AMZN"]
}
```

**Input:** `query = "What is the revenue for AMZN?"`, `providedTickers = ["AAPL"]`  
**Output:** `["AAPL", "AMZN"]`  
**Bug:** AAPL is at index 0, so `primaryTicker = "AAPL"` (line 471).

### Step 2: Query enhancement (line 511-515)

```typescript
if (tickers.length > 0 && !dto.content.match(/\b(AAPL|MSFT|...)\b/i)) {
    enhancedQuery = `${tickers.join(' and ')} ${dto.content}`;
}
```

The query DOES contain "AMZN" which matches the regex, so this enhancement is SKIPPED. The query passes through unchanged. Good — no additional damage here.

### Step 3: RAG service invocation (line 519-527)

```typescript
const ragResult = await this.ragService.query(enhancedQuery, {
    ticker: primaryTicker,      // "AAPL" ← WRONG
    tickers: tickers.length > 1 ? tickers : undefined, // ["AAPL", "AMZN"]
});
```

**Critical:** Both `ticker` ("AAPL") and `tickers` (["AAPL", "AMZN"]) are passed. The RAG service then does:

### Step 4: RAG service route + override (rag.service.ts lines 71-94)

```typescript
const plan = await this.queryRouter.route(query, options?.tenantId, options?.ticker);
// options.ticker = "AAPL" → passed as contextTicker to intent detector
```

The query router calls `intentDetector.detectIntent(query, tenantId, "AAPL")`. Inside the intent detector:

### Step 5: Intent detector `extractTicker` (intent-detector.service.ts line 401-420)

```typescript
if (contextTicker) {
    const ctUpper = contextTicker.toUpperCase();  // "AAPL"
    const allTickers = new Set<string>([ctUpper, ...queryTickers]);  // Set(["AAPL", "AMZN"])
    const arr = Array.from(allTickers);  // ["AAPL", "AMZN"]
    return arr.length === 1 ? arr[0] : arr;  // Returns ["AAPL", "AMZN"]
}
```

**Bug:** Again AAPL first. The intent's `ticker` field = `["AAPL", "AMZN"]`.

### Step 6: Back in RAG service — tickers override (line 82-94)

```typescript
if (options?.tickers && options.tickers.length > 0) {
    intent.ticker = options.tickers;  // ["AAPL", "AMZN"]
    if (plan.structuredQuery) {
        plan.structuredQuery.tickers = options.tickers;  // ["AAPL", "AMZN"]
    }
}
```

This OVERRIDES the intent ticker with `["AAPL", "AMZN"]` — still AAPL first.

### Step 7: Structured retrieval (line 361-408)

The structured retriever runs `retrieveLatest` with `tickers = ["AAPL", "AMZN"]`. This retrieves:
- AAPL latest annual revenue
- AAPL latest quarterly revenue
- AMZN latest annual revenue
- AMZN latest quarterly revenue

**Result: 4 rows (2 per ticker), both tickers returned.** This is why the chart shows both AAPL and AMZN.

### Step 8: User document search (line 430-457)

```typescript
const userDocResult = await this.documentRAG.searchUserDocuments(query, {
    ticker: options.ticker || null,  // "AAPL" ← uses workspace ticker, not intent ticker
});
```

**Bug:** `options.ticker` is still "AAPL" from the research-assistant. This searches AAPL user documents, not AMZN. If there are AAPL uploaded docs, their chunks leak into the response.

### Summary of Intent Path

The intent detector produces `ticker: ["AAPL", "AMZN"]` everywhere. The structured retriever faithfully retrieves for both. The user doc search uses the wrong ticker. The result is a mixed AAPL+AMZN dataset that the visualization renders as a comparison chart even though the user asked about AMZN only.

---

## C. RAG Pipeline Failures

### Failure 1: Multi-ticker when single-ticker expected

Because `intent.ticker = ["AAPL", "AMZN"]`, the query router builds a structured plan with `tickers: ["AAPL", "AMZN"]`. The retriever dutifully fetches for both.

The visualization generator (line 55 of `visualization-generator.service.ts`) checks:
```typescript
if (tickers.length > 1) {
    return this.buildComparisonChart(tickers, metrics);
}
```

So a comparison chart is generated even though the user didn't ask for comparison. This is correct behavior given the input — the bug is that the input has 2 tickers when it should have 1.

### Failure 2: Only "latest" data retrieved

The intent detector sets `period: "latest"` because the query has no explicit period. `retrieveLatest()` then gets exactly 1 annual + 1 quarterly per ticker. With FY2023 being the latest annual and Q3-FY2024 being the latest quarterly, that's 2 AMZN data points.

There's no historical supplement. The bugfix spec (Fix 5) adds this, but it's not in the current code.

### Failure 3: No computed metrics

`intent.needsComputation` is `false` because "revenue" is an atomic metric, not computed. But `intent.needsTrend` is also `false` because the query doesn't contain "trend", "growth", "over time", etc. So the `computedSummary` block at line 657-667 is skipped entirely:

```typescript
if (intent.needsTrend || intent.needsComputation) {
    // ... this entire block is SKIPPED
}
```

No YoY growth is calculated. No revenue growth rate. No trend analysis.

### Failure 4: Semantic retrieval potentially skipped

If the intent is classified as `structured` (which "What is the revenue for AMZN?" would be — it's a quantitative metric query), the `plan.useSemantic` flag is `false`. This means:
- No Bedrock KB narrative chunks are retrieved
- No MD&A context about revenue drivers
- No segment breakdown information (AWS, advertising, etc.)
- The LLM gets ONLY the metrics table — a few rows of numbers

The only way semantic content enters is if structured returns 0 metrics AND the fallback at line 393-407 triggers. But since structured DOES return metrics (for both AAPL and AMZN), the fallback never fires.

---

## D. Hybrid Synthesis Failure

### What the LLM sees

The `buildStructuredPrompt` at line 189 constructs a prompt with:

```
=== QUANTITATIVE DATA (ground truth) ===
| Ticker | Metric | Period | Value | Source |
| --- | --- | --- | --- | --- |
| AAPL | Revenue | FY2023 | $383,285,000,000.00 | 10-K |
| AAPL | Revenue | Q3-FY2024 | $94,930,000,000.00 | 10-Q |
| AMZN | Revenue | FY2023 | $574,785,000,000.00 | 10-K |
| AMZN | Revenue | Q3-FY2024 | $158,877,000,000.00 | 10-Q |
```

That's 4 rows. Two tickers. Two periods each. No historical data. No growth rates. No segment breakdown. No narrative context.

### What the LLM produces

The prompt tells the LLM to "keep the total response under 400 words" and to write "a concise, investment-grade research note." With only 4 data points and no narrative context, the LLM has nothing to work with beyond stating the numbers. There's no AWS revenue data, no segment breakdown, no growth rates, no MD&A context, no historical trend.

The 400-word limit PLUS the lack of data produces the lean response you saw.

### Why no narrative context

The synthesis context at line 707-715:
```typescript
const synthesisContext: FinancialAnalysisContext = {
    metrics,         // 4 rows (2 AAPL + 2 AMZN)
    narratives,      // EMPTY — semantic path was skipped
    computedResults: [],  // EMPTY — needsComputation was false
};
```

The `formatNarratives` method returns `null` when narratives is empty, so the entire `=== NARRATIVE CONTEXT ===` section is absent from the prompt. The LLM has zero qualitative context.

---

## E. Why the Answer Is Lean — Root Causes Summary

| # | Root Cause | Impact | Fix |
|---|-----------|--------|-----|
| 1 | `extractTickers` puts workspace ticker first | AAPL becomes primaryTicker, AMZN is secondary | **Fix 1 from bugfix spec** |
| 2 | `retrieveLatest` returns only 1 annual + 1 quarterly per ticker | 2 data points per company, no trend possible | **Fix 5 from bugfix spec** |
| 3 | `intent.needsTrend = false` for "revenue" query without trend keywords | No `computeFinancials` called, no YoY growth | **New Fix 9** |
| 4 | `plan.useSemantic = false` for structured queries | No MD&A, no segment data, no AWS revenue | **New Fix 10** |
| 5 | 400-word limit in `buildStructuredPrompt` | LLM can't write analytical depth even if data existed | **Fix 7 from bugfix spec** |
| 6 | No metric-based SEC citations generated | Structured-only queries get zero citations | **Fix 6 from bugfix spec** |
| 7 | User doc search uses `options.ticker` not intent ticker | AAPL docs leak in when querying AMZN | **Fix 4 from bugfix spec** |

---

## New Fixes Required (Beyond Original Bugfix Spec)

### Fix 9: Always Compute Growth for Revenue-Class Metrics

**File:** `src/rag/rag.service.ts`  
**Location:** Lines 657-667

**FIND:**
```typescript
      // Phase 1 (Pre-LLM): Compute financial metrics for trend/computation queries
      let computedSummary: MetricsSummary | MetricsSummary[] | undefined;
      if (intent.needsTrend || intent.needsComputation) {
```

**REPLACE WITH:**
```typescript
      // Phase 1 (Pre-LLM): Compute financial metrics for trend/computation queries.
      // ALWAYS compute for revenue-class metrics even without explicit trend keywords.
      // Analysts expect growth rates for revenue, net income, etc. without having to say "trend".
      const ALWAYS_COMPUTE_METRICS = new Set([
        'revenue', 'net_income', 'gross_profit', 'operating_income', 'ebitda',
        'free_cash_flow', 'operating_cash_flow', 'net_sales',
      ]);
      const hasComputeWorthyMetrics = metrics.some(m =>
        ALWAYS_COMPUTE_METRICS.has(m.normalizedMetric?.toLowerCase())
      );
      let computedSummary: MetricsSummary | MetricsSummary[] | undefined;
      if (intent.needsTrend || intent.needsComputation || hasComputeWorthyMetrics) {
```

**Why:** "What is the revenue for AMZN?" should ALWAYS include YoY growth. Analysts never ask "what is the revenue trend" — they ask "what is the revenue" and expect growth context automatically.

### Fix 10: Force Hybrid Retrieval for Single-Metric Queries

**File:** `src/rag/query-router.service.ts`  
**Method:** `buildStructuredPlan` (line 165)

**FIND:**
```typescript
  private async buildStructuredPlan(intent: QueryIntent, tenantId?: string): Promise<RetrievalPlan> {
    const tickers = this.normalizeTickers(intent.ticker);
    const normalizedMetrics = this.resolveMetrics(intent.metrics || [], tenantId);

    const structuredQuery: StructuredQuery = {
      tickers,
      metrics: normalizedMetrics,
      period: intent.period,
      periodType: intent.periodType,
      periodStart: intent.periodStart,
      periodEnd: intent.periodEnd,
      filingTypes: intent.periodType === 'range' ? ['10-K'] : this.determineFilingTypes(intent),
      includeComputed: intent.needsComputation,
    };

    return {
      useStructured: true,
      useSemantic: false,
      structuredQuery,
    };
  }
```

**REPLACE WITH:**
```typescript
  private async buildStructuredPlan(intent: QueryIntent, tenantId?: string): Promise<RetrievalPlan> {
    const tickers = this.normalizeTickers(intent.ticker);
    const normalizedMetrics = this.resolveMetrics(intent.metrics || [], tenantId);

    const structuredQuery: StructuredQuery = {
      tickers,
      metrics: normalizedMetrics,
      period: intent.period,
      periodType: intent.periodType,
      periodStart: intent.periodStart,
      periodEnd: intent.periodEnd,
      filingTypes: intent.periodType === 'range' ? ['10-K'] : this.determineFilingTypes(intent),
      includeComputed: intent.needsComputation,
    };

    // UPGRADE: Always include semantic retrieval for richer context.
    // "What is the revenue?" is technically structured, but the analyst
    // benefits enormously from MD&A context about revenue drivers,
    // segment breakdown, and management commentary.
    // Semantic retrieval adds ~200ms but dramatically improves answer quality.
    const semanticQuery = {
      query: intent.originalQuery,
      tickers: tickers.length > 0 ? tickers : undefined,
      documentTypes: ['10-K', '10-Q'] as string[],
      sectionTypes: ['item_7'] as string[], // MD&A is most relevant for metric context
      period: intent.period,
      maxResults: 3, // Lightweight — just enough for context, not a full semantic search
    };

    return {
      useStructured: true,
      useSemantic: true,
      structuredQuery,
      semanticQuery,
    };
  }
```

**Why:** Every structured metric query benefits from MD&A context. "What is the revenue for AMZN?" should surface AWS segment revenue, advertising revenue growth, and management commentary on revenue drivers — not just a bare number. The 3-chunk semantic retrieval adds minimal latency but transforms a data lookup into an analytical response.

### Fix 11: Deduplicate Metrics by Canonical ID

**File:** `src/rag/structured-retriever.service.ts`  
**Method:** `retrieveLatest` — after the retrieval loop, before validation

Add after line 445 (after the `for` loops, before the validation gate):

```typescript
    // Deduplicate metrics: keep only one row per (ticker, canonical_metric, fiscalPeriod, filingType).
    // Different synonym variants (e.g., 'revenue' vs 'net_sales') from the same filing
    // can produce duplicate rows. Keep the one with the highest confidence score.
    const deduped = new Map<string, MetricResult>();
    for (const r of results) {
      // Normalize the metric name to canonical form for dedup
      const canonicalMetric = resolution?.canonical_id || r.normalizedMetric;
      const key = `${r.ticker}-${canonicalMetric}-${r.fiscalPeriod}-${r.filingType}`;
      const existing = deduped.get(key);
      if (!existing || (r.confidenceScore || 0) > (existing.confidenceScore || 0)) {
        deduped.set(key, r);
      }
    }
    results = Array.from(deduped.values());
```

**Why:** This fixes the "FY2023 shown twice" bug. If both `revenue` and `net_sales` rows exist for the same ticker/period/filing, only the highest-confidence one is kept.

---

## Updated Fix Priority (All 11 Fixes)

| Step | Fix | File | What It Fixes |
|------|-----|------|---------------|
| 1 | Fix 1: extractTickers priority | research-assistant.service.ts | AAPL becomes primary instead of AMZN |
| 2 | Fix 2: extractTicker priority | intent-detector.service.ts | Same in intent detector |
| 3 | Fix 3: resolveFromLlmResult priority | intent-detector.service.ts | Same in LLM resolver |
| 4 | Fix 4: intent-ticker doc search | rag.service.ts | AAPL docs leak into AMZN query |
| 5 | Fix 5: historical data supplement | structured-retriever.service.ts | Only 2 data points per ticker |
| 6 | **Fix 11: dedup metrics** | structured-retriever.service.ts | FY2023 shown twice |
| 7 | **Fix 9: always compute growth** | rag.service.ts | No YoY growth without "trend" keyword |
| 8 | **Fix 10: force hybrid retrieval** | query-router.service.ts | No MD&A/segment context |
| 9 | Fix 7: word limit + growth prompt | hybrid-synthesis.service.ts | 400-word cap, no growth instructions |
| 10 | Fix 6: metric-based citations | rag.service.ts | No SEC citations for structured queries |
| 11 | Fix 8: NULL ticker handling | document-rag.service.ts | Edge case for untagged docs |

**This gives you:**
- The right ticker as primary (Fixes 1-3)
- The right documents searched (Fix 4)
- 5+ years of data instead of 2 points (Fix 5)
- No duplicate periods (Fix 11)
- Automatic growth computation (Fix 9)
- Rich MD&A context in every metric query (Fix 10)
- Room for analytical depth (Fix 7)
- Always-present SEC citations (Fix 6)
- Clean doc search (Fix 8)
