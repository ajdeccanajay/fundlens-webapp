# FundLens Production Bugfix Specification

**Date:** February 28, 2026  
**Severity:** CRITICAL — 4 interrelated bugs affecting query accuracy, citations, charts, and response depth  
**Scope:** 5 files changed, 0 files added  

---

## Executive Summary

When a user asks **"What is the revenue for AMZN?"** from an **AAPL workspace**, the system returns AAPL data in the chart, AAPL documents in citations, a thin response with no growth data, and missing SEC filing citations. All four bugs trace to a single root cause in how tickers are prioritized.

This spec contains **exact find-and-replace patches** for each file. Apply them in order. Each fix is independent and additive — no existing code paths are removed.

---

## Root Cause

The bug originates at two points where the workspace ticker gets priority over the query ticker:

**Point 1 — `research-assistant.service.ts` line 470:**
```typescript
let tickers = this.extractTickers(dto.content, dto.context?.tickers);
const primaryTicker = tickers[0] || undefined;
```

`extractTickers` initializes a `Set` with `providedTickers` (workspace context = `["AAPL"]`) BEFORE extracting query tickers (`"AMZN"`). Since `Set` preserves insertion order, `tickers[0]` is always `"AAPL"`, not `"AMZN"`.

**Point 2 — `intent-detector.service.ts` line 404-406:**
```typescript
if (contextTicker) {
  const ctUpper = contextTicker.toUpperCase();
  const allTickers = new Set<string>([ctUpper, ...queryTickers]);
```

Same pattern: context ticker inserted first into the Set.

**Cascade:**
1. `primaryTicker = "AAPL"` → passed as `options.ticker` to `rag.service.ts`
2. `rag.service.ts` line 435: `ticker: options.ticker || null` → searches AAPL user docs
3. AAPL doc chunks merge into narratives via `mergeAndRerankResults`
4. Visualization generator sees 2 tickers → renders AAPL + AMZN comparison chart (**Bug 1**)
5. AAPL doc citations leak into response (**Bug 2**)
6. `periodType: "latest"` → `retrieveLatest()` returns only 2 data points → no growth calc possible (**Bug 3**)
7. No narrative chunks for structured query → LLM produces no `[N]` markers → `extractCitations` returns empty → no SEC citations. AAPL user doc citations are added instead (**Bug 4**)

---

## Fix 1: Ticker Priority — Query Tickers Before Workspace Tickers

**File:** `src/research/research-assistant.service.ts`  
**Method:** `extractTickers` (line ~768)

### FIND (exact match):
```typescript
  extractTickers(query: string, providedTickers?: string[]): string[] {
    const tickers = new Set<string>(providedTickers || []);

    // Common ticker pattern: 1-5 uppercase letters
    const tickerPattern = /\b[A-Z]{1,5}\b/g;
    const matches = query.match(tickerPattern) || [];

    for (const match of matches) {
      // Filter out common words that look like tickers
      if (!['I', 'A', 'US', 'CEO', 'CFO', 'SEC', 'GAAP', 'Q', 'FY'].includes(match)) {
        tickers.add(match);
      }
    }

    return Array.from(tickers);
  }
```

### REPLACE WITH:
```typescript
  extractTickers(query: string, providedTickers?: string[]): string[] {
    // Stop words: common uppercase words that are NOT ticker symbols.
    // Includes financial acronyms, filing codes, and English stopwords.
    const STOP_WORDS = new Set([
      'I', 'A', 'US', 'CEO', 'CFO', 'SEC', 'GAAP', 'Q', 'FY',
      'VS', 'THE', 'FOR', 'AND', 'OR', 'IS', 'IN', 'OF', 'TO',
      'BY', 'AT', 'ON', 'IT', 'DO', 'IF', 'SO', 'NO', 'UP',
      'PE', 'EV', 'YOY', 'QOQ', 'LTM', 'TTM', 'ROE', 'ROA',
      'ROIC', 'EBITDA', 'CAGR', 'DCF', 'IPO', 'M', 'B', 'K',
      'DD', 'IC', 'MD', 'AI', 'ML', 'RE', 'AM', 'PM', 'NOT',
      'ALL', 'ANY', 'CAN', 'HAS', 'HOW', 'ITS', 'MAY', 'NEW',
      'NOW', 'OLD', 'OUR', 'OUT', 'OWN', 'SAY', 'SHE', 'TOO',
      'TWO', 'WAY', 'WHO', 'DID', 'GET', 'HIM', 'HIS', 'LET',
      'MY', 'NOR', 'WAS', 'RUN', 'USE', 'HER', 'BUT', 'WHAT',
    ]);

    // Step 1: Extract tickers mentioned explicitly in the query text.
    const queryTickers: string[] = [];
    const tickerPattern = /\b[A-Z]{1,5}\b/g;
    const matches = query.match(tickerPattern) || [];
    for (const match of matches) {
      if (!STOP_WORDS.has(match)) {
        queryTickers.push(match);
      }
    }

    // Step 2: PRIORITY RULE — Query tickers come FIRST.
    // If the user types "AMZN revenue" in an AAPL workspace,
    // AMZN must be primaryTicker (index 0), AAPL is secondary context.
    if (queryTickers.length > 0) {
      const result = new Set<string>(queryTickers);
      for (const t of (providedTickers || [])) {
        result.add(t);
      }
      return Array.from(result);
    }

    // Step 3: No tickers in query text → workspace tickers are the only source.
    // e.g., "What is the revenue?" in AAPL workspace → returns ["AAPL"]
    return [...(providedTickers || [])];
  }
```

### Why this works:
- "What is the revenue for AMZN?" in AAPL workspace → `queryTickers = ["AMZN"]` → returns `["AMZN", "AAPL"]` → `primaryTicker = "AMZN"` ✓
- "What is the revenue?" in AAPL workspace → `queryTickers = []` → returns `["AAPL"]` ✓
- "Compare AMZN vs MSFT" in AAPL workspace → `queryTickers = ["AMZN", "MSFT"]` → returns `["AMZN", "MSFT", "AAPL"]` ✓

---

## Fix 2: Intent Detector Ticker Priority

**File:** `src/rag/intent-detector.service.ts`  
**Method:** `extractTicker` (line ~401)

### FIND (exact match):
```typescript
  private extractTicker(query: string, contextTicker?: string): string | string[] | undefined {
    const queryTickers = this.extractTickersFromQuery(query);

    if (contextTicker) {
      const ctUpper = contextTicker.toUpperCase();
      const allTickers = new Set<string>([ctUpper, ...queryTickers]);
      const arr = Array.from(allTickers);
      this.logger.log(`🎯 Context ticker: ${ctUpper}, query tickers: [${queryTickers.join(', ')}], merged: [${arr.join(', ')}]`);
      return arr.length === 1 ? arr[0] : arr;
    }

    if (queryTickers.length === 0) {
      return undefined;
    }
    if (queryTickers.length === 1) {
      return queryTickers[0];
    }
    this.logger.log(`🔍 Multiple tickers detected: ${queryTickers.join(', ')}`);
    return queryTickers;
  }
```

### REPLACE WITH:
```typescript
  private extractTicker(query: string, contextTicker?: string): string | string[] | undefined {
    const queryTickers = this.extractTickersFromQuery(query);

    if (contextTicker) {
      const ctUpper = contextTicker.toUpperCase();

      // PRIORITY: Query tickers first, context ticker second.
      // "AMZN revenue" in AAPL workspace → ["AMZN", "AAPL"], not ["AAPL", "AMZN"]
      if (queryTickers.length > 0) {
        const allTickers = new Set<string>([...queryTickers, ctUpper]);
        const arr = Array.from(allTickers);
        this.logger.log(`🎯 Query tickers: [${queryTickers.join(', ')}], context: ${ctUpper}, merged: [${arr.join(', ')}]`);
        return arr.length === 1 ? arr[0] : arr;
      }

      // No tickers in query → use context ticker as sole source
      this.logger.log(`🎯 No query tickers, using context: ${ctUpper}`);
      return ctUpper;
    }

    if (queryTickers.length === 0) {
      return undefined;
    }
    if (queryTickers.length === 1) {
      return queryTickers[0];
    }
    this.logger.log(`🔍 Multiple tickers detected: ${queryTickers.join(', ')}`);
    return queryTickers;
  }
```

---

## Fix 3: LLM Resolver Ticker Priority

**File:** `src/rag/intent-detector.service.ts`  
**Method:** `resolveFromLlmResult` (line ~761)

### FIND (exact match):
```typescript
    // 1. Resolve tickers (merge with contextTicker if present)
    let tickers = llmResult.tickers;
    if (contextTicker) {
      const ctUpper = contextTicker.toUpperCase();
      tickers = [...new Set([ctUpper, ...tickers])];
    }
```

### REPLACE WITH:
```typescript
    // 1. Resolve tickers — query-extracted tickers take priority over context ticker.
    let tickers = llmResult.tickers;
    if (contextTicker) {
      const ctUpper = contextTicker.toUpperCase();
      // LLM tickers first (from query), context ticker appended as secondary
      tickers = [...new Set([...tickers, ctUpper])];
    }
```

---

## Fix 4: Document Search Uses Intent Ticker, Not Workspace Ticker

**File:** `src/rag/rag.service.ts`  
**Location:** Lines ~430-437 (USER DOCUMENTS PATH block)

### FIND (exact match):
```typescript
      // USER DOCUMENTS PATH: Search user-uploaded documents if tenant provided
      if (options?.tenantId && options?.includeCitations) {
        this.logger.log(`📄 Searching user documents for tenant ${options.tenantId}`);
        const userDocResult = await this.documentRAG.searchUserDocuments(query, {
          tenantId: options.tenantId,
          ticker: options.ticker || null,
          topK: 5,
          minScore: 0.7,
        });
```

### REPLACE WITH:
```typescript
      // USER DOCUMENTS PATH: Search user-uploaded documents if tenant provided
      if (options?.tenantId && options?.includeCitations) {
        // Use the PRIMARY ticker from intent detection (query-derived),
        // not options.ticker (which is workspace context and may be wrong).
        // Example: query="AMZN revenue" in AAPL workspace
        //   intent.ticker = ["AMZN", "AAPL"] or "AMZN" → use AMZN for doc search
        //   options.ticker = "AAPL" ← workspace, would search wrong company's docs
        const intentPrimaryTicker = Array.isArray(intent.ticker)
          ? intent.ticker[0]
          : intent.ticker;
        const docSearchTicker = intentPrimaryTicker || options.ticker || null;

        this.logger.log(`📄 Searching user documents for tenant ${options.tenantId} (intent ticker: ${intentPrimaryTicker}, workspace ticker: ${options.ticker}, using: ${docSearchTicker})`);
        const userDocResult = await this.documentRAG.searchUserDocuments(query, {
          tenantId: options.tenantId,
          ticker: docSearchTicker,
          topK: 5,
          minScore: 0.7,
        });
```

---

## Fix 5: Historical Data for Growth Computation

**File:** `src/rag/structured-retriever.service.ts`  
**Method:** `retrieveLatest` (line ~407)

When `periodType` is `"latest"`, only the most recent annual + quarterly values are returned (2 data points). This makes growth computation impossible. The fix supplements latest results with historical annual data for core financial metrics.

### FIND (exact match — the return statement at the end of `retrieveLatest`):
```typescript
    // Post-retrieval validation gate (Requirements 20.1-20.4)
    const validated = this.validateResults(results);

    return {
      metrics: validated,
      summary: this.buildSummary(validated),
    };
  }
```

### REPLACE WITH:
```typescript
    // Supplement with historical annual data for core metrics.
    // When periodType=latest, the primary loop returns only the most recent
    // annual and quarterly values. For core metrics (revenue, net_income, etc.),
    // we fetch up to 5 prior annual periods so computeFinancials can calculate
    // YoY growth rates and the chart shows a meaningful trend.
    const TREND_WORTHY_METRICS = new Set([
      'revenue', 'net_income', 'gross_profit', 'operating_income',
      'ebitda', 'free_cash_flow', 'operating_cash_flow',
      'total_assets', 'total_liabilities', 'total_equity',
      'cost_of_revenue', 'net_sales',
    ]);

    const existingKeys = new Set(
      results.map(r => `${r.ticker}-${r.normalizedMetric}-${r.fiscalPeriod}`)
    );

    for (const ticker of query.tickers) {
      for (const resolution of resolvedMetrics) {
        if (!TREND_WORTHY_METRICS.has(resolution.canonical_id)) continue;

        try {
          const synonyms = this.metricRegistry.getSynonymsForDbColumn(resolution.canonical_id);
          const historicalAnnuals = await this.prisma.financialMetric.findMany({
            where: {
              ticker: { equals: ticker, mode: 'insensitive' },
              filingType: '10-K',
              normalizedMetric: { in: synonyms, mode: 'insensitive' },
            },
            orderBy: { statementDate: 'desc' },
            take: 5,
          });

          for (const h of historicalAnnuals) {
            const key = `${h.ticker}-${h.normalizedMetric}-${h.fiscalPeriod}`;
            if (!existingKeys.has(key)) {
              results.push(this.formatMetric(h));
              existingKeys.add(key);
            }
          }
        } catch (e) {
          this.logger.warn(`Historical fetch failed for ${ticker}/${resolution.canonical_id}: ${e.message}`);
        }
      }
    }

    // Post-retrieval validation gate (Requirements 20.1-20.4)
    const validated = this.validateResults(results);

    return {
      metrics: validated,
      summary: this.buildSummary(validated),
    };
  }
```

---

## Fix 6: Always Generate SEC Filing Citations from Metrics

**File:** `src/rag/rag.service.ts`  
**Location:** After line ~723 (synthesis result handling)

When the LLM produces no `[N]` markers (happens for all structured-only queries where no narrative context is provided), `extractCitations` returns an empty array. SEC filings are never cited. This fix adds a `buildMetricCitations` method that creates citations from structured metric results.

### Step 6a: Add the `buildMetricCitations` method

Add this new private method to the `RAGService` class (e.g., after the existing `extractSources` method around line ~1739):

```typescript
  /**
   * Build citations from structured metric results.
   * Fallback for when HybridSynthesis produces no [N]-based citations
   * (structured-only queries with no narrative chunks).
   */
  private buildMetricCitations(metrics: MetricResult[]): any[] {
    const citations: any[] = [];
    const seen = new Set<string>();
    let citationNum = 1;

    for (const m of metrics) {
      if (!m.ticker || !m.filingType || !m.fiscalPeriod) continue;

      const key = `${m.ticker}-${m.filingType}-${m.fiscalPeriod}`;
      if (seen.has(key)) continue;
      seen.add(key);

      citations.push({
        id: `metric-citation-${citationNum}`,
        number: citationNum,
        citationNumber: citationNum,
        type: 'sec_filing',
        sourceType: 'SEC_FILING',
        title: `${m.ticker.toUpperCase()} ${m.filingType} ${m.fiscalPeriod}`,
        content: `${m.displayName || m.normalizedMetric}: ${m.value} (${m.fiscalPeriod})`,
        excerpt: `${m.displayName || m.normalizedMetric}: ${m.value}`,
        metadata: {
          ticker: m.ticker,
          documentType: m.filingType,
          filingType: m.filingType,
          fiscalPeriod: m.fiscalPeriod,
          pageNumber: m.sourcePage,
        },
        ticker: m.ticker,
        filingType: m.filingType,
        fiscalPeriod: m.fiscalPeriod,
        pageNumber: m.sourcePage,
      });
      citationNum++;
    }

    return citations;
  }
```

### Step 6b: Wire into the synthesis result handling

**FIND (exact match — around line 723):**
```typescript
          citations = synthesisResult.citations || [];
          
          // Also extract citations from user document chunks if present
          if (userDocChunks.length > 0 && options?.includeCitations) {
            const userDocCitations = this.documentRAG.extractCitationsFromChunks(userDocChunks);
            citations = [...citations, ...userDocCitations];
            this.logger.log(`📎 Extracted ${userDocCitations.length} citations from user documents`);
          }
```

**REPLACE WITH:**
```typescript
          citations = synthesisResult.citations || [];

          // FALLBACK: If LLM produced no narrative citations but we have
          // structured metrics, generate SEC filing citations from them.
          if (citations.length === 0 && metrics.length > 0) {
            const metricCitations = this.buildMetricCitations(metrics);
            citations = [...metricCitations];
            this.logger.log(`📊 Built ${metricCitations.length} metric-based SEC citations (no [N] markers in LLM response)`);
          }
          
          // Also extract citations from user document chunks if present.
          // Renumber to follow existing citations.
          if (userDocChunks.length > 0 && options?.includeCitations) {
            const userDocCitations = this.documentRAG.extractCitationsFromChunks(userDocChunks);
            const offset = citations.length;
            const renumbered = userDocCitations.map((c: any, i: number) => ({
              ...c,
              number: offset + i + 1,
              citationNumber: offset + i + 1,
            }));
            citations = [...citations, ...renumbered];
            this.logger.log(`📎 Extracted ${renumbered.length} user document citations (offset: ${offset})`);
          }
```

---

## Fix 7: Increase Word Limit for Data-Rich Responses

**File:** `src/rag/hybrid-synthesis.service.ts`  
**Method:** `buildStructuredPrompt` (line ~205)

### FIND (exact match):
```typescript
        '- Keep the total response under 400 words.',
```

### REPLACE WITH:
```typescript
        '- Keep the total response under 600 words.',
        '- Include year-over-year growth rates when historical data is available.',
        '- Always cite the specific fiscal period for each number you quote.',
```

Also update the unifying prompt word limit:

### FIND (exact match — in `buildUnifyingPrompt`, line ~296):
```typescript
        '- Keep the total response under 500 words.',
```

### REPLACE WITH:
```typescript
        '- Keep the total response under 700 words.',
        '- Include year-over-year growth rates when historical data is available.',
        '- Always cite the specific fiscal period for each number you quote.',
```

---

## Fix 8: Document Search — Defensive NULL Ticker Handling

**File:** `src/rag/document-rag.service.ts`  
**Method:** `searchUserDocuments` (line ~65)

If document chunks were uploaded without a ticker set (e.g., from a bulk upload), they have `c.ticker IS NULL`. These should only appear when no ticker filter is applied. When a specific ticker IS requested, NULL-ticker chunks should still be included (they're tenant-level general docs), but wrong-ticker chunks must be excluded.

### FIND (exact match):
```typescript
      // Build SQL query with tenant filtering
      const tickerFilter = ticker ? `AND c.ticker = $3` : '';
```

### REPLACE WITH:
```typescript
      // Build SQL query with tenant filtering.
      // When a ticker is specified: return chunks matching that ticker
      // OR chunks with NULL ticker (tenant-level docs, not company-specific).
      // This ensures company-specific docs for OTHER tickers are excluded
      // while general docs (e.g., fund guidelines) are still searchable.
      const tickerFilter = ticker ? `AND (c.ticker = $3 OR c.ticker IS NULL)` : '';
```

---

## Implementation Order

| Step | Fix | File | Bugs Fixed | Risk |
|------|-----|------|------------|------|
| 1 | Fix 1: extractTickers priority | research-assistant.service.ts | 1, 2, 3, 4 | LOW |
| 2 | Fix 2: extractTicker priority | intent-detector.service.ts | 1, 2 | LOW |
| 3 | Fix 3: resolveFromLlmResult priority | intent-detector.service.ts | 1, 2 | LOW |
| 4 | Fix 4: intent-ticker doc search | rag.service.ts | 1, 2 | LOW |
| 5 | Fix 5: historical data supplement | structured-retriever.service.ts | 3 | MED |
| 6 | Fix 6: metric-based citations | rag.service.ts | 4 | LOW |
| 7 | Fix 7: word limit + growth prompt | hybrid-synthesis.service.ts | 3 | LOW |
| 8 | Fix 8: NULL ticker handling | document-rag.service.ts | 1, 2 | LOW |

**Apply in this order.** Fix 1 alone resolves most symptoms. Fixes 2-4 are defensive depth. Fixes 5-8 are independent improvements.

---

## Regression Test Cases

Run each test AFTER applying all fixes. These verify both the bug fixes and that existing functionality is preserved.

### Test 1: Cross-ticker isolation (Bugs 1 + 2)
```
Context: User is in AAPL workspace
Query: "What is the revenue for AMZN?"
Expected:
  ✓ primaryTicker = "AMZN"
  ✓ Chart shows ONLY AMZN data (no AAPL)
  ✓ Citations reference AMZN filings only
  ✓ User document search scoped to AMZN, not AAPL
  ✓ Response discusses AMZN revenue, not AAPL
```

### Test 2: Workspace fallback (no regression)
```
Context: User is in AAPL workspace
Query: "What is the revenue?"
Expected:
  ✓ primaryTicker = "AAPL" (falls back to workspace)
  ✓ Response shows AAPL revenue data
```

### Test 3: Multi-ticker comparison (no regression)
```
Context: User is in AAPL workspace
Query: "Compare AMZN vs MSFT revenue"
Expected:
  ✓ tickers = ["AMZN", "MSFT", "AAPL"] (query tickers first)
  ✓ Peer comparison chart shows AMZN vs MSFT
  ✓ AAPL may appear as additional context but not in comparison
```

### Test 4: Revenue growth data (Bug 3)
```
Query: "What is the revenue for AMZN?"
Expected:
  ✓ response.metrics.length >= 3 (multiple annual periods)
  ✓ Response text includes YoY growth rate
  ✓ Chart shows trend line (not single bar)
  ✓ Response exceeds 200 words with analytical depth
```

### Test 5: SEC filing citations (Bug 4)
```
Query: "What is the revenue for AMZN?"
Expected:
  ✓ response.citations.length >= 1
  ✓ response.citations.some(c => c.sourceType === "SEC_FILING")
  ✓ Each citation has ticker, filingType, fiscalPeriod
  ✓ SEC citations appear BEFORE any user doc citations
```

### Test 6: Workspace upload query (no regression)
```
Context: User has uploaded docs for AAPL
Query: "What does the uploaded 10-K say about revenue?"
Expected:
  ✓ User document chunks are searched and returned
  ✓ Citations include USER_UPLOAD type entries
```

### Test 7: Gibberish detection (no regression)
```
Query: "asdf jkl;"
Expected:
  ✓ isGibberish returns true
  ✓ needsClarification = true
  ✓ No data returned, helpful prompt shown
```

### Test 8: Peer comparison from workspace (no regression)
```
Context: User is in NVDA workspace
Query: "Compare with peers"
Expected:
  ✓ Peer universe lookup fires for NVDA
  ✓ Peer tickers expanded from yaml registry
  ✓ Grouped bar chart comparing NVDA vs peers
```

---

## Files Changed Summary

| File | Lines Changed | What Changed |
|------|--------------|--------------|
| `src/research/research-assistant.service.ts` | ~25 | `extractTickers` rewritten for query-first priority |
| `src/rag/intent-detector.service.ts` | ~15 | `extractTicker` and `resolveFromLlmResult` ticker ordering |
| `src/rag/rag.service.ts` | ~40 | Intent-ticker doc search + `buildMetricCitations` method |
| `src/rag/structured-retriever.service.ts` | ~35 | Historical data supplement in `retrieveLatest` |
| `src/rag/hybrid-synthesis.service.ts` | ~6 | Word limit increase + growth prompt instructions |
| `src/rag/document-rag.service.ts` | ~3 | NULL ticker handling in SQL filter |

**Total: ~124 lines changed across 6 files. No new files. No dependency changes.**
