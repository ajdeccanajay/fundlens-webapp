# FundLens Unified Implementation Spec v3
# RAG Pipeline + Narrative Intelligence + Computed Metrics

**Date:** March 4, 2026
**For:** Kiro (implementation)
**From:** Ajay + Claude architecture sessions (Sessions 1-7)

---

## CRITICAL DIRECTIVE FOR KIRO

**DO NOT overwrite any existing, working functionality.**

Before implementing ANY fix in this spec:

1. READ the existing code and understand what it does today
2. ASSESS whether the existing implementation already handles the case better than proposed
3. If the existing code works correctly for a case, PRESERVE IT
4. Only ADD or MODIFY code where the current behavior is demonstrably broken
5. Every change must be ADDITIVE or SURGICAL -- never wholesale replacement of working systems
6. Think LONG TERM -- a fix that solves today's bug but breaks tomorrow's feature is not a fix
7. When in doubt, add a safety net ALONGSIDE existing logic rather than replacing it
8. RUN the test cases in this spec BEFORE and AFTER changes to verify no regressions

The codebase has 259,000 lines of working functionality. This spec targets specific broken paths. Do not refactor what works.

---

## ARCHITECTURE OVERVIEW

```
Query
  |
  v
QUL Layer (Haiku 4.5) -- classifies intent, extracts entities, temporal scope
  |                       NOW ALSO: outputs canonical metric IDs via metric catalog
  v
buildIntentFromQUL -- maps QUL output to QueryIntent
  |                   Layer 1: reads subQueries[].metric (Haiku's output)
  |                   Layer 2: validates through MetricRegistryService
  |                   Layer 3: falls back to normalizedQuery token extraction
  v
buildPlanFromQUL -- creates RetrievalPlan
  |                 Routes to structured_db, semantic_kb, uploaded_doc_rag
  |                 NOW: intent-aware maxResults, section-type routing
  |                 NOW: needsComputation fires for computed metrics in ANY intent
  v
  +---> Structured Retriever (PostgreSQL) -- deterministic metrics
  |       NOW: case-insensitive ticker/filingType
  |       Uses MetricRegistryService synonyms for DB column expansion
  |
  +---> Semantic Retriever (Bedrock KB) -- narrative chunks
  |       NOW: 15 chunks for narrative queries (was 5)
  |       NOW: section-type filtering for targeted retrieval
  |       Uses MetricRegistryService (not hardcoded keyword map)
  |
  +---> Uploaded Doc Search (pgvector) -- analyst reports, CIMs
  |
  +---> Formula Engine (FinancialCalculatorService) -- computed metrics
          NOW: fires when ANY computed metric detected, regardless of intent
          EV, EV/EBITDA, margins, leverage ratios -- all deterministic
  |
  v
Hybrid Synthesis (Sonnet 4.6 / Opus 4.6)
  |   NOW: intent-specific synthesis instructions
  |   NOW: always-on Investment Committee Challenge
  |   NOW: sentiment and tone analysis for narrative queries
  |   NOW: increased max_tokens (4096) for narrative responses
  v
Response with citations
  NOW: rich citation titles ("NVDA 10-K FY2025 -- Item 7: MD&A")
  NOW: correct source type attribution (SEC_FILING vs UPLOADED_DOC)
```

---

## PART 1: QUL METRIC CATALOG -- Teach Haiku to Produce Canonical IDs

### Why This Matters

The QUL system prompt tells Haiku that `subQueries` is "optional" and for "multi-part or cross-domain queries." For simple queries like "What is the revenue for AMZN?", Haiku produces NO subQueries, so `intent.metrics` is always empty. For complex queries like "Compare enterprise values and multiples", Haiku produces compound strings like `"enterprise_value_valuation_multiples"` that no registry can resolve.

Haiku is an LLM. It understands that "top line" means revenue and "how expensive" means valuation. But it does not know our canonical metric IDs because we never told it what they are. The fix: give Haiku a metric catalog in its system prompt.

### Fix 1: Add metric catalog to QUL system prompt

**File:** `src/prompts/qul-system-prompt.txt` (or wherever the QUL system prompt is constructed)

**ADD the following section after the existing "Optional fields" section, BEFORE any few-shot examples:**

```
## METRIC CATALOG

When the query references financial metrics, you MUST include subQueries
with the canonical metric ID from this catalog. ALWAYS produce subQueries
for ANY query that mentions metrics, even simple single-metric lookups.

Use these EXACT canonical IDs in the "metric" field of subQueries:

INCOME STATEMENT (metricType: atomic):
  revenue, cost_of_revenue, gross_profit, operating_income, net_income,
  ebitda, ebit, interest_expense, depreciation_amortization,
  research_and_development, selling_general_admin, earnings_per_share,
  diluted_eps, shares_outstanding, diluted_shares

BALANCE SHEET (metricType: atomic):
  total_assets, total_liabilities, total_equity, cash_and_cash_equivalents,
  short_term_investments, accounts_receivable, inventory, current_assets,
  current_liabilities, long_term_debt, short_term_debt, total_debt,
  retained_earnings, goodwill, intangible_assets, accounts_payable

CASH FLOW (metricType: atomic):
  net_cash_provided_by_operating_activities, capital_expenditures,
  free_cash_flow, dividends_paid_common, equity_repurchased,
  acquisitions_net, debt_issuance, debt_repayment

COMPUTED / VALUATION (metricType: computed):
  enterprise_value, ev_to_ebitda, ev_to_revenue, ev_to_ebit,
  price_to_earnings, price_to_book, price_to_sales,
  price_to_free_cash_flow, fcf_yield_pct, dividend_yield,
  gross_margin_pct, operating_margin_pct, net_margin_pct,
  ebitda_margin_pct, return_on_equity, return_on_assets,
  return_on_invested_capital, debt_to_equity, net_debt_to_ebitda,
  interest_coverage, current_ratio, quick_ratio,
  asset_turnover, inventory_turnover, revenue_per_employee

CONCEPTS (metricType: concept -- use when query is high-level):
  profitability, leverage, liquidity, valuation, growth, efficiency,
  capital_returns, working_capital

RULES:
- For "What is AMZN's revenue?" -> subQueries: [{ metric: "revenue", metricType: "atomic", path: "structured_db" }]
- For "enterprise value" or "EV" -> metric: "enterprise_value", metricType: "computed"
- For "multiples" or "valuation" -> metric: "valuation", metricType: "concept"
- For "top line" -> metric: "revenue" (you understand the synonym; output the canonical ID)
- For "bottom line" -> metric: "net_income"
- For "how profitable" -> metric: "profitability", metricType: "concept"
- For "how levered" or "leverage" -> metric: "leverage", metricType: "concept"
- For narrative queries with NO metrics (e.g. "Summarize MD&A") -> no metric field needed, just intent: NARRATIVE_SEARCH
- NEVER produce compound strings like "enterprise_value_valuation_multiples" -- split into separate subQueries
- When query mentions MULTIPLE metrics, produce MULTIPLE subQueries, one per metric
```

### Fix 2: Update QUL few-shot examples

**File:** `src/prompts/qul-examples.json`

**UPDATE existing examples at indices 1 and 4** to include subQueries with metric field.

**ADD these new examples:**

```json
{
  "query": "What is the revenue for AMZN?",
  "workspace": { "ticker": "AMZN", "domain": "public_equity" },
  "output": {
    "entities": [{ "name": "Amazon", "ticker": "AMZN", "entityType": "public_company", "source": "explicit" }],
    "intent": "METRIC_LOOKUP",
    "domain": "public_equity",
    "isValidQuery": true,
    "confidence": 0.95,
    "temporalScope": { "type": "latest" },
    "normalizedQuery": "AMZN revenue latest",
    "subQueries": [
      { "intent": "METRIC_LOOKUP", "entity": "AMZN", "metric": "revenue", "metricType": "atomic", "path": "structured_db" }
    ]
  }
}
```

```json
{
  "query": "Compare analyst forecasts, enterprise values and multiples on Amazon",
  "workspace": { "ticker": "AMZN", "domain": "public_equity" },
  "output": {
    "entities": [{ "name": "Amazon", "ticker": "AMZN", "entityType": "public_company", "source": "explicit" }],
    "intent": "HYBRID_ANALYSIS",
    "domain": "public_equity",
    "isValidQuery": true,
    "confidence": 0.9,
    "temporalScope": { "type": "latest" },
    "normalizedQuery": "AMZN analyst forecasts enterprise value multiples",
    "subQueries": [
      { "intent": "METRIC_LOOKUP", "entity": "AMZN", "metric": "enterprise_value", "metricType": "computed", "path": "structured_db" },
      { "intent": "METRIC_LOOKUP", "entity": "AMZN", "metric": "valuation", "metricType": "concept", "path": "structured_db" },
      { "intent": "NARRATIVE_SEARCH", "entity": "AMZN", "path": "uploaded_doc_rag" }
    ]
  }
}
```

```json
{
  "query": "Show me AAPL's net income and free cash flow",
  "workspace": { "ticker": "AAPL", "domain": "public_equity" },
  "output": {
    "entities": [{ "name": "Apple", "ticker": "AAPL", "entityType": "public_company", "source": "explicit" }],
    "intent": "METRIC_LOOKUP",
    "domain": "public_equity",
    "isValidQuery": true,
    "confidence": 0.95,
    "temporalScope": { "type": "latest" },
    "normalizedQuery": "AAPL net income free cash flow latest",
    "subQueries": [
      { "intent": "METRIC_LOOKUP", "entity": "AAPL", "metric": "net_income", "metricType": "atomic", "path": "structured_db" },
      { "intent": "METRIC_LOOKUP", "entity": "AAPL", "metric": "free_cash_flow", "metricType": "atomic", "path": "structured_db" }
    ]
  }
}
```

```json
{
  "query": "What's the top line?",
  "workspace": { "ticker": "NVDA", "domain": "public_equity" },
  "output": {
    "entities": [{ "name": "NVIDIA", "ticker": "NVDA", "entityType": "public_company", "source": "workspace_context" }],
    "intent": "METRIC_LOOKUP",
    "domain": "public_equity",
    "isValidQuery": true,
    "confidence": 0.9,
    "temporalScope": { "type": "latest" },
    "normalizedQuery": "NVDA revenue latest",
    "subQueries": [
      { "intent": "METRIC_LOOKUP", "entity": "NVDA", "metric": "revenue", "metricType": "atomic", "path": "structured_db" }
    ]
  }
}
```

---

## PART 2: METRIC EXTRACTION -- Three-Layer Defense

Even with the improved QUL prompt, Haiku may still produce imperfect output. The metric extraction in `buildIntentFromQUL` must be robust.

### Fix 3: Validated subQuery extraction with decomposition

**File:** `src/rag/rag.service.ts`
**Method:** `buildIntentFromQUL` (~line 1621)

**FIND the existing metric extraction block:**
```typescript
    // Extract metric hints from QUL subQueries
    const metrics: string[] = [];
    if (qul.subQueries && qul.subQueries.length > 0) {
      for (const sq of qul.subQueries) {
        if (sq.metric) metrics.push(sq.metric);
      }
    }
```

**REPLACE WITH the three-layer extraction:**
```typescript
    // ================================================================
    // METRIC EXTRACTION: Three-layer defense
    //
    // Layer 1 (primary): Haiku's subQueries[].metric -- validated through registry
    // Layer 2 (decomposition): Compound strings split and re-resolved
    // Layer 3 (fallback): Token extraction from normalizedQuery
    //
    // The goal: intent.metrics contains ONLY canonical metric IDs that
    // the MetricRegistryService recognizes. Nothing else reaches downstream.
    // ================================================================
    const metrics: string[] = [];
    const seenMetrics = new Set<string>();

    // --- Layer 1 + 2: Extract from subQueries with registry validation ---
    if (qul.subQueries && qul.subQueries.length > 0) {
      for (const sq of qul.subQueries) {
        if (!sq.metric) continue;

        // Layer 1: Try resolving the full metric string as-is
        let resolved = false;
        if (this.metricRegistry) {
          try {
            const resolution = this.metricRegistry.resolve(sq.metric);
            if (resolution && resolution.confidence !== 'unresolved') {
              if (!seenMetrics.has(resolution.canonical_id)) {
                metrics.push(resolution.canonical_id);
                seenMetrics.add(resolution.canonical_id);
                this.logger.log(
                  `📊 subQuery metric "${sq.metric}" -> resolved as "${resolution.canonical_id}" (${resolution.confidence})`,
                );
              }
              resolved = true;
            }
          } catch { /* skip */ }

          // Layer 2: If full string unresolved, decompose by underscores
          // "enterprise_value_valuation_multiples" ->
          //   try "enterprise_value" -> HIT (computed metric)
          //   try "valuation_multiples" -> miss
          if (!resolved) {
            const parts = sq.metric.split('_');
            for (let len = Math.min(parts.length - 1, 4); len >= 2; len--) {
              for (let start = 0; start <= parts.length - len; start++) {
                const candidate = parts.slice(start, start + len).join('_');
                try {
                  const partRes = this.metricRegistry.resolve(candidate);
                  if (partRes && partRes.confidence !== 'unresolved'
                      && !seenMetrics.has(partRes.canonical_id)) {
                    metrics.push(partRes.canonical_id);
                    seenMetrics.add(partRes.canonical_id);
                    this.logger.log(
                      `📊 Decomposed "${sq.metric}" -> found "${partRes.canonical_id}"`,
                    );
                  }
                } catch { /* skip */ }
              }
            }
          }
        } else {
          // Registry unavailable -- add raw as fallback
          metrics.push(sq.metric);
        }
      }
    }

    // --- Layer 3: Extract from normalizedQuery when subQueries yield nothing ---
    // This is the safety net for when Haiku produces no subQueries at all
    // (e.g., simple queries where Haiku omits the optional field).
    if (metrics.length === 0 && qul.normalizedQuery && this.metricRegistry) {
      const queryText = qul.normalizedQuery;
      // Tokenize: split on whitespace, build single tokens + bigrams + trigrams
      const tokens = queryText
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 0);

      const candidates: string[] = [];

      // Single tokens
      candidates.push(...tokens);

      // Bigrams
      for (let i = 0; i < tokens.length - 1; i++) {
        candidates.push(`${tokens[i]} ${tokens[i + 1]}`);
        candidates.push(`${tokens[i]}_${tokens[i + 1]}`);
      }

      // Trigrams
      for (let i = 0; i < tokens.length - 2; i++) {
        candidates.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
        candidates.push(`${tokens[i]}_${tokens[i + 1]}_${tokens[i + 2]}`);
      }

      for (const candidate of candidates) {
        try {
          const resolution = this.metricRegistry.resolve(candidate);
          if (resolution && resolution.confidence !== 'unresolved'
              && !seenMetrics.has(resolution.canonical_id)) {
            metrics.push(resolution.canonical_id);
            seenMetrics.add(resolution.canonical_id);
            this.logger.log(
              `📊 Extracted metric from normalizedQuery: "${candidate}" -> "${resolution.canonical_id}" (${resolution.confidence})`,
            );
          }
        } catch { /* skip */ }
      }

      if (metrics.length > 0) {
        this.logger.log(`📊 Extracted ${metrics.length} metric(s) from normalizedQuery: [${metrics.join(', ')}]`);
      }
    }
```

### Fix 4: Safety net in buildPlanFromQUL

**File:** `src/rag/rag.service.ts`
**Method:** `buildPlanFromQUL` (~line 1715)

After the existing `metricHints` resolution, add:

```typescript
    // Safety net: if metricHints is still empty after QUL extraction,
    // try the same three-layer extraction here as a last resort
    if (metricHints.length === 0 && qul.normalizedQuery && this.metricRegistry) {
      // [Same token extraction logic as Layer 3 above]
      // This catches the case where buildIntentFromQUL returned metrics: undefined
      // but buildPlanFromQUL still needs metrics for the structured query
    }
```

**NOTE FOR KIRO:** Check if `intent.metrics` is already populated by the time `buildPlanFromQUL` runs. If it is, this safety net may be redundant. Only add it if `metricHints` can still be empty at this point. Do not add duplicate logic if the upstream fix already works.

---

## PART 3: COMPUTED METRIC ROUTING

### Problem

`enterprise_value` is a computed metric with formula `market_cap + total_debt - cash`. But `needsComputation` only fires for METRIC_LOOKUP, METRIC_TREND, METRIC_COMPARISON intents. A query classified as HYBRID_ANALYSIS that contains `enterprise_value` in its metrics never triggers the formula engine.

### Fix 5: needsComputation fires for computed metrics in ANY intent

**File:** `src/rag/rag.service.ts`
**Method:** `buildIntentFromQUL`, return statement

**FIND:**
```typescript
      needsComputation: ['METRIC_LOOKUP', 'METRIC_TREND', 'METRIC_COMPARISON'].includes(qul.intent) ||
        this.isRevenueClassMetric(metrics),
```

**REPLACE WITH:**
```typescript
      needsComputation: ['METRIC_LOOKUP', 'METRIC_TREND', 'METRIC_COMPARISON'].includes(qul.intent) ||
        this.isRevenueClassMetric(metrics) ||
        this.hasComputedMetrics(metrics),
```

**ADD method:**
```typescript
/**
 * Check if any resolved metrics are computed type (have formulas).
 * Computed metrics require the FinancialCalculatorService regardless
 * of query intent. "Compare enterprise values" in a HYBRID_ANALYSIS
 * still needs EV calculated deterministically.
 */
private hasComputedMetrics(metrics: string[]): boolean {
  if (!metrics || metrics.length === 0 || !this.metricRegistry) return false;
  return metrics.some(m => {
    try {
      const def = this.metricRegistry.getMetricById?.(m);
      return def && def.type === 'computed';
    } catch {
      return false;
    }
  });
}
```

---

## PART 4: CONCEPT REGISTRY EXPANSION

### Fix 6: Add valuation, capital_returns, efficiency, growth concepts

**File:** `.kiro/specs/metric-resolution-architecture/analytical_concepts.yaml`

**ADD (do not replace existing concepts):**

```yaml
valuation:
  display_name: Valuation Analysis
  description: Enterprise value, trading multiples, and relative valuation
  triggers:
  - valuation
  - multiples
  - trading multiples
  - how expensive
  - how cheap
  - is it overvalued
  - is it undervalued
  - enterprise value
  - EV
  - what multiple
  - what is it trading at
  - comps
  - comparable companies
  - price target
  - multiple expansion
  - multiple compression
  primary_metrics:
    all:
    - enterprise_value
    - ev_to_ebitda
    - ev_to_revenue
    - ev_to_ebit
    - price_to_earnings
    - price_to_book
  secondary_metrics:
    all:
    - price_to_sales
    - price_to_free_cash_flow
    - fcf_yield_pct
    - dividend_yield

capital_returns:
  display_name: Capital Returns Analysis
  description: Shareholder returns including dividends, buybacks, total yield
  triggers:
  - capital returns
  - shareholder returns
  - capital allocation
  - buyback
  - dividend policy
  - payout
  - returning cash
  primary_metrics:
    all:
    - dividend_yield
    - dividends_paid_common
    - equity_repurchased
    - payout_ratio
  secondary_metrics:
    all:
    - free_cash_flow
    - fcf_yield_pct

efficiency:
  display_name: Operating Efficiency
  description: Asset utilization and working capital management
  triggers:
  - efficiency
  - working capital
  - cash conversion
  - asset utilization
  - capital efficiency
  - asset turns
  primary_metrics:
    all:
    - asset_turnover
    - inventory_turnover
    - days_sales_outstanding
    - days_payable_outstanding
    - cash_conversion_cycle
  secondary_metrics:
    all:
    - working_capital
    - accounts_receivable
    - inventory

growth:
  display_name: Growth Analysis
  description: Revenue, earnings, and cash flow growth trajectory
  triggers:
  - growth
  - growth rate
  - how fast is it growing
  - growth trajectory
  - is it growing
  - organic growth
  - acceleration
  - deceleration
  primary_metrics:
    all:
    - revenue
    - net_income
    - ebitda
    - free_cash_flow
    - earnings_per_share
  secondary_metrics:
    all:
    - gross_profit
    - operating_income
```

---

## PART 5: TICKER PRIORITIZATION

### Fix 7: primaryTicker always included in tickers array

**Root cause from Kiro:** QUL detects METRIC_COMPARISON -> needsPeerComparison = true -> ResearchAssistantService expands peers -> AMZN gets peers GOOGL, MSFT, ABNB. But primaryTicker (AMZN) is NOT in explicitTickers (it came from entity detection, not explicit comparison). So tickers = [GOOGL, MSFT, ABNB] -- AMZN is dropped.

**File:** `src/rag/research-assistant.service.ts`

**In the peer expansion logic, after building the tickers array, ADD:**

```typescript
// CRITICAL: primaryTicker MUST always be in the tickers array.
// It was detected as the primary entity, not an explicit comparison entity,
// so it may not be in explicitTickers. Prepend it if missing.
if (primaryTicker && !tickers.includes(primaryTicker)) {
  tickers.unshift(primaryTicker);
  this.logger.log(`📊 Added primaryTicker ${primaryTicker} to tickers array (was missing after peer expansion)`);
}
```

### Fix 8: Qualitative keyword suppression

**File:** `src/rag/rag.service.ts`, graceful degradation section

**ADD these terms to the qualitativeKeywords array:**

```typescript
'analyst', 'estimate', 'forecast', 'consensus', 'guidance', 'target',
'thesis', 'rationale', 'outlook', 'recommendation', 'rating',
'upside', 'downside', 'bull_case', 'bear_case', 'catalyst',
'commentary', 'narrative', 'discussion', 'overview', 'summary',
'assessment', 'evaluation', 'scenario', 'assumptions',
```

---

## PART 6: CASE-INSENSITIVE MATCHING

### Fix 9: getLatestByFilingType case-insensitive

**File:** `src/rag/structured-retriever.service.ts`
**Method:** `getLatestByFilingType` (~line 570)

The main `retrieve()` method already uses `mode: 'insensitive'`. But `getLatestByFilingType` does raw string comparison for ticker and filingType.

**FIND the Prisma query and ensure:**
```typescript
where: {
  ticker: { equals: ticker, mode: 'insensitive' },
  filingType: { equals: filingType, mode: 'insensitive' },
  // ... rest of conditions
}
```

---

## PART 7: CITATION FIXES

### Fix 10A: Robust uploaded doc detection

**File:** `src/rag/rag.service.ts`
**Method:** `buildMetricCitations` (~line 2917)

**Uploaded document detection must check ALL signals:**
```typescript
const isUploadedDoc =
  metric.filingType === 'uploaded-document' ||
  metric.source === 'user_document' ||
  metric.sourceType === 'USER_UPLOAD' ||
  metric._fromUploadedDoc === true;
```

### Fix 10B: Source-aware dedup key

**FIND the SEC citation dedup key:**
```typescript
`${ticker}-${filingType}-${fiscalPeriod}`
```

**REPLACE WITH:**
```typescript
`sec-${ticker}-${filingType}-${fiscalPeriod}-${normalizedMetric}`
```

### Fix 10C: Pre-filter robustness

**In the secMetrics filter (~lines 955, 1193), exclude ALL uploaded doc signals:**
```typescript
const secMetrics = allMetrics.filter(m =>
  m.filingType !== 'uploaded-document' &&
  m.source !== 'user_document' &&
  m.sourceType !== 'USER_UPLOAD' &&
  m._fromUploadedDoc !== true
);
```

---

## PART 8: MODEL UPGRADES

### Fix 11A: QUL fallback chain
```
claude-3-5-haiku-20241022 -> claude-haiku-4-5-20251001
claude-3-5-sonnet-20241022-v2 -> claude-sonnet-4-6
```

### Fix 11B: Synthesis models
```
sonnet: claude-sonnet-4-6
opus: claude-opus-4-6-v1
```

### Fix 11C: All stale Claude 3 Haiku references (5 files)
```
claude-3-haiku-20240307 -> claude-haiku-4-5-20251001
```

### Fix 11D: Remove regex fast path
**File:** `src/rag/intent-detector.service.ts` (~lines 151-157)
Remove the early return when regex confidence >= 0.9.

**NOTE FOR KIRO:** Before removing the regex fast path, verify that the QUL path (Haiku) produces correct intent classification for the queries the regex was catching. If the regex handles specific patterns better than Haiku, keep it as a fast path but ensure the QUL path is the authority.

---

## PART 9: SEMANTIC RETRIEVER CLEANUP

### Fix 12: Kill hardcoded keyword-to-metric map in getContextualMetrics

**File:** `src/rag/semantic-retriever.service.ts`
**Method:** `getContextualMetrics` (~line 762)

**FIND the hardcoded block:**
```typescript
if (queryLower.includes('revenue')) metrics.push('revenue', 'total_revenue');
if (queryLower.includes('income')) metrics.push('net_income', 'operating_income');
// ... etc
```

**REPLACE WITH registry-based resolution** using the same tokenize-and-resolve pattern from Fix 3. This ensures one approach everywhere -- no parallel keyword maps that drift out of sync.

**NOTE FOR KIRO:** Verify that MetricRegistryService is injectable into SemanticRetrieverService before making this change. If dependency injection is not currently set up, add it.

---

## PART 10: NARRATIVE INTELLIGENCE

### Fix 13: Intent-aware maxResults scaling

**File:** `src/rag/rag.service.ts`
**Method:** `buildPlanFromQUL`, semantic query construction

**FIND:**
```typescript
maxResults: intent.needsComparison || intent.needsTrend ? 10 : (hasUploadedEntity ? 8 : 5),
```

**REPLACE WITH:**
```typescript
maxResults: this.computeSemanticMaxResults(qul.intent, intent, hasUploadedEntity),
```

**ADD method:**
```typescript
private computeSemanticMaxResults(
  qulIntent: string,
  intent: QueryIntent,
  hasUploadedEntity: boolean,
): number {
  // Narrative-heavy: breadth across filing sections
  if (['NARRATIVE_SEARCH', 'SEGMENT_ANALYSIS', 'CROSS_TRANSCRIPT',
       'MANAGEMENT_ASSESSMENT'].includes(qulIntent)) {
    return 15;
  }
  // Provocation and red flag: depth for non-obvious patterns
  if (['PROVOCATION', 'RED_FLAG_DETECTION'].includes(qulIntent)) {
    return 15;
  }
  // IC memo and hybrid: balanced
  if (['HYBRID_ANALYSIS', 'IC_MEMO_GENERATION'].includes(qulIntent)) {
    return 12;
  }
  // Comparison/trend
  if (intent.needsComparison || intent.needsTrend || intent.needsPeerComparison) {
    return 10;
  }
  // Deal analysis / uploaded docs
  if (['DEAL_ANALYSIS', 'DEAL_COMPARISON'].includes(qulIntent) || hasUploadedEntity) {
    return 10;
  }
  if (qulIntent === 'UPLOADED_DOC_QUERY') return 8;
  // Data lookup: lightweight context
  return 5;
}
```

### Fix 14: Section-type routing

**File:** `src/rag/rag.service.ts`
**Method:** `buildPlanFromQUL`

Update semantic query to include section types:
```typescript
sectionTypes: this.deriveSectionTypes(qul, intent),
```

**ADD method:**
```typescript
private deriveSectionTypes(
  qul: QueryUnderstanding,
  intent: QueryIntent,
): string[] | undefined {
  const query = (qul.normalizedQuery || qul.rawQuery || '').toLowerCase();

  if (query.includes('md&a') || query.includes('management discussion') ||
      query.includes("management's discussion") || query.includes('item 7')) {
    return ['mdna', 'management_discussion', 'item_7', 'item_7a'];
  }
  if ((query.includes('risk') && query.includes('factor')) ||
      query.includes('item 1a')) {
    return ['risk_factors', 'item_1a'];
  }
  if (query.includes('business overview') || query.includes('business description') ||
      query.includes('company overview')) {
    return ['business', 'item_1', 'business_overview'];
  }
  if (query.includes('legal') || query.includes('litigation')) {
    return ['legal_proceedings', 'item_3'];
  }
  if (qul.intent === 'SEGMENT_ANALYSIS') {
    return ['mdna', 'segment_information', 'notes_to_financial_statements'];
  }
  if (qul.intent === 'MANAGEMENT_ASSESSMENT') {
    return ['management_discussion', 'executive_compensation', 'corporate_governance'];
  }
  return undefined;  // No filter -- let vector similarity decide
}
```

**CRITICAL:** Verify these section type strings match what the Python parser stores in Bedrock KB metadata. Query the KB directly first:
```bash
aws bedrock-agent retrieve \
  --knowledge-base-id <KB_ID> \
  --retrieval-query "management discussion analysis" \
  --region us-east-1 | jq '.retrievalResults[].metadata'
```

If the parser uses different keys, update this mapping. DO NOT deploy this fix until metadata is verified.

### Fix 15: Semantic retriever applies sectionTypes filter

**File:** `src/rag/semantic-retriever.service.ts`

Verify that `retrieveWithContext` passes `sectionTypes` to the Bedrock KB query as metadata filter. If it currently ignores this field:

```typescript
if (query.sectionTypes && query.sectionTypes.length > 0) {
  // Implementation depends on Bedrock KB API being used
  // Add metadata filter: sectionType IN query.sectionTypes
}
```

### Fix 16: Intent-aware synthesis instructions

**File:** `src/rag/hybrid-synthesis.service.ts`

**ADD method `getNarrativeSynthesisInstruction(intent: string): string`** that returns intent-specific instructions:

- NARRATIVE_SEARCH: 600-800 word comprehensive analysis covering themes, segments, tone, forward-looking indicators, red flags, sentiment
- SEGMENT_ANALYSIS: Per-segment breakdown with revenue, margins, KPIs, outlook
- MANAGEMENT_ASSESSMENT: Capital allocation, compensation, insider ownership, strategic consistency
- RED_FLAG_DETECTION: Systematic scan of 11 red flag categories with quantification
- PROVOCATION: 5-7 specific, data-driven uncomfortable questions
- CROSS_TRANSCRIPT: Multi-period narrative comparison with tone shift analysis

**Inject into synthesis system prompt:**
```typescript
const narrativeInstruction = this.getNarrativeSynthesisInstruction(ctx.intent || '');
if (narrativeInstruction) {
  systemPrompt += narrativeInstruction;
}
```

See NARRATIVE_INTELLIGENCE_SPEC.md Fix 4 for the complete instruction text for each intent.

### Fix 17: Increase max_tokens for narrative responses

**File:** `src/rag/hybrid-synthesis.service.ts`

```typescript
const narrativeHeavyIntents = new Set([
  'NARRATIVE_SEARCH', 'SEGMENT_ANALYSIS', 'MANAGEMENT_ASSESSMENT',
  'RED_FLAG_DETECTION', 'PROVOCATION', 'IC_MEMO_GENERATION',
  'HYBRID_ANALYSIS', 'CROSS_TRANSCRIPT',
]);
const maxTokens = narrativeHeavyIntents.has(ctx.intent || '') ? 4096 : 2048;
```

### Fix 18: Budget partitioning for narrative queries

**File:** `src/rag/hybrid-synthesis.service.ts`

```typescript
const isNarrativeHeavy = ['NARRATIVE_SEARCH', 'SEGMENT_ANALYSIS',
  'MANAGEMENT_ASSESSMENT', 'RED_FLAG_DETECTION', 'PROVOCATION',
  'CROSS_TRANSCRIPT'].includes(ctx.intent || '');

const MAX_NARRATIVE_CHARS = isNarrativeHeavy ? 30000 : 20000;
const secBudget = isNarrativeHeavy
  ? Math.floor(MAX_NARRATIVE_CHARS * 0.80)
  : Math.floor(MAX_NARRATIVE_CHARS * 0.60);
const uploadedBudget = MAX_NARRATIVE_CHARS - secBudget;
```

### Fix 19: Always-on Investment Committee Challenge

**ADD to ALL narrative synthesis instructions:**

```
## INVESTMENT COMMITTEE CHALLENGE (ALWAYS INCLUDE)

Conclude with 2-3 pointed questions that an investment committee would ask.
Requirements:
- GROUNDED in specific data from the filings (cite the numbers)
- NON-OBVIOUS (not "will competition increase?")
- ACTIONABLE (the analyst can investigate further)
- UNCOMFORTABLE (challenges the consensus view or bull case)

Frame as: "Given that [specific data point], how do you reconcile
[apparent contradiction or concerning trend]?"
```

### Fix 20: Rich citation titles

**File:** `src/rag/hybrid-synthesis.service.ts`

**Replace generic citation title construction with:**
```typescript
title: this.buildCitationTitle(chunk.metadata),
```

**ADD methods `buildCitationTitle` and `humanizeSectionType`** that produce titles like:
- "NVDA 10-K FY2025 -- Item 7: Management's Discussion & Analysis"
- "AAPL 10-K FY2024 -- Item 1A: Risk Factors"
- "Uploaded Document: DBS Group Research"

See NARRATIVE_INTELLIGENCE_SPEC.md Fix 8 for complete implementation.

---

## DEPLOYMENT ORDER

| Phase | Fixes | Files | Impact |
|-------|-------|-------|--------|
| Phase 1 | 1, 2, 3, 5, 7 | qul-system-prompt.txt, qul-examples.json, rag.service.ts, research-assistant.service.ts | Unblocks metric extraction + ticker prioritization + computed metric routing. Biggest impact. |
| Phase 2 | 6, 8, 9 | analytical_concepts.yaml, rag.service.ts, structured-retriever.service.ts | Concept bundles + qualitative suppression + case-insensitive. YAML + small code changes. |
| Phase 3 | 13, 16, 17, 18, 19 | rag.service.ts, hybrid-synthesis.service.ts | Narrative intelligence. maxResults scaling + synthesis depth + provocations. |
| Phase 4 | 10A/B/C, 20 | rag.service.ts, hybrid-synthesis.service.ts | Citation accuracy and polish. |
| Phase 5 | 11A-D, 12 | Multiple files | Model upgrades + semantic retriever cleanup. |
| Phase 6 | 4, 14, 15 | rag.service.ts, semantic-retriever.service.ts | Safety nets + section routing (after verifying Bedrock KB metadata). |

---

## VERIFICATION TEST CASES

### Test 1: Simple metric lookup
Query: "What is the revenue for AMZN?" (AMZN workspace)
```
Expected logs:
  📊 subQuery metric "revenue" -> resolved as "revenue" (exact)
  or: 📊 Extracted metric from normalizedQuery: "revenue" -> "revenue" (exact)

Expected response:
  Multi-year revenue with SEC filing citations
  NO degradation warnings
```

### Test 2: Computed metric via concept
Query: "Compare enterprise values and multiples for Amazon"
```
Expected logs:
  📊 subQuery metric "enterprise_value" -> resolved as "enterprise_value" (exact)
  📊 subQuery metric "valuation" -> concept match -> bundle expanded
  📊 Computed metrics detected -> needsComputation = true
  🔧 FinancialCalculatorService: Computing enterprise_value

Expected response:
  Deterministic EV, EV/EBITDA, P/E calculations
  DBS narrative analysis from uploaded doc
  Cross-reference between analyst multiples and calculated multiples
  NO degradation warnings (no "enterprise_value_valuation_multiples" error)
```

### Test 3: Primary ticker preserved in peer comparison
Query: "How does AMZN's revenue compare to what the analyst expects?"
```
Expected logs:
  📊 Added primaryTicker AMZN to tickers array

Expected response:
  AMZN data (from PostgreSQL + uploaded DBS report)
  NOT: GOOGL/MSFT/ABNB data without AMZN
```

### Test 4: Narrative depth
Query: "Summarize NVDA's management discussion and analysis"
```
Expected:
  600+ words covering segments, tone, forward-looking indicators
  Citations: "NVDA 10-K FY2025 -- Item 7: Management's Discussion & Analysis"
  2-3 Investment Committee Challenge questions
  NOT: 200 words of surface observations
```

### Test 5: Analyst synonym
Query: "What's the top line?" (NVDA workspace)
```
Expected:
  Haiku produces subQuery with metric: "revenue" (from catalog)
  or: Layer 3 catches "top line" -> exact synonym match -> revenue
  Revenue data returned
```

### Test 6: Provocation
Query: "What should worry me about this investment?" (NVDA workspace)
```
Expected:
  5-7 specific, data-driven provocations
  Each grounded in filing data with citations
  Non-obvious, actionable, uncomfortable
```

---

## DESIGN PRINCIPLES

| Principle | Application |
|-----------|-------------|
| Haiku does NLU, registry does validation | QUL produces canonical IDs; MetricRegistryService confirms they exist |
| Registry as single source of truth | Fixes 3, 4, 12 all resolve through MetricRegistryService |
| Comprehensive synonyms for DB expansion | YAML synonyms handle DB column matching; NOT for query understanding |
| Deterministic when you can, intelligent when you must | Formula engine for EV/multiples; LLM for narrative synthesis |
| Every terminal has metrics; narratives are the moat | Fixes 13-20 transform narrative responses from thin to investment-grade |
| Provocations are the product | Fix 19: every narrative response ends with IC challenges |
| No short-term thinking | Every fix is additive; nothing replaces working functionality |
