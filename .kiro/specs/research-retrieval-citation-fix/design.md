# Research Retrieval & Citation Fix — Bugfix Design

## Overview

Three interrelated bugs degrade the FundLens Research Assistant: (1) `extractPeriod()` matches the first `FY \d{4}` token and returns immediately, so "FY 2023 - 2024" yields only `FY2023`; (2) `renderChart()` uses a fixed 5×200ms retry loop that exhausts before Alpine.js flushes the canvas into the DOM; (3) the decomposed query path sets `synthesisContext.narratives = []`, which cascades into no CITATION RULE in the prompt and no citation extraction. Additionally, `StructuredRetrieverService.retrieve()` ignores `periodStart`/`periodEnd` fields, and `buildUnifyingPrompt()` omits the CITATION RULE instruction entirely.

The fix strategy is surgical: add a range regex before the single-FY match, add period range handling in `retrieve()`, replace the fixed retry with a MutationObserver in `renderChart()`, collect narratives from sub-query results onto `synthesisContext`, and inject the CITATION RULE into `buildUnifyingPrompt()`.

## Glossary

- **Bug_Condition (C)**: The set of inputs/states that trigger one of the three bugs — range period queries, first-load chart renders, or decomposed query citation paths
- **Property (P)**: The desired correct behavior for each bug condition — full range data returned, chart rendered on first load, citations present in decomposed responses
- **Preservation**: Existing behaviors that must remain unchanged — single FY queries, chart re-renders on refresh, single-intent citation extraction, quick response path, mouse interactions
- **`extractPeriod()`**: Private method in `IntentDetectorService` (`src/rag/intent-detector.service.ts`, line 481) that parses time period expressions from natural language queries into `PeriodExtractionResult`
- **`retrieve()`**: Method in `StructuredRetrieverService` (`src/rag/structured-retriever.service.ts`, line 36) that builds Prisma WHERE clauses and fetches financial metrics from PostgreSQL
- **`renderChart()`**: Method in the Alpine.js research component (`public/app/deals/research.html`, line 476) that locates a canvas element and renders a Chart.js chart
- **`buildUnifyingPrompt()`**: Method in `HybridSynthesisService` (`src/rag/hybrid-synthesis.service.ts`, line 281) that constructs the LLM prompt for decomposed multi-sub-query synthesis
- **`synthesisContext`**: The `FinancialAnalysisContext` object built in `RAGService.query()` for the decomposed path (~line 178 of `rag.service.ts`)
- **`PeriodExtractionResult`**: Interface with fields `period`, `periodType`, `periodStart`, `periodEnd` — already supports ranges but `extractPeriod()` never produces them for explicit FY ranges

## Bug Details

### Fault Condition

The bugs manifest across three independent code paths that share a common theme: data/state that exists upstream is silently dropped before it reaches the consumer.

**Bug 1 — Period Range Dropping**: When a query contains an explicit FY range like "FY 2023 - 2024" or "FY 2023 to 2024", `extractPeriod()` matches the first `FY \d{4}` pattern on line 486 and returns `{ period: 'FY2023' }` immediately. The range endpoint is never parsed. Even if the range were parsed, `retrieve()` only uses `query.period` for exact match (`where.fiscalPeriod = query.period`) and completely ignores `periodStart`/`periodEnd`.

**Bug 2 — Chart First-Load Failure**: When a `visualization` SSE event arrives, `renderChart()` is called via `$nextTick` → `requestAnimationFrame` → `doRender()`. The canvas element is conditionally rendered by Alpine.js (e.g., `x-show="msg.visualization"`). Alpine's reactive flush may not complete within the 5×200ms = 1 second retry window, especially on slower connections or complex DOM trees.

**Bug 3 — Decomposed Citation Absence**: When the decomposed query path is taken (multi-ticker comparisons), `synthesisContext.narratives` is set to `[]` on line ~178 of `rag.service.ts`. This causes: (a) `formatNarratives([])` returns `null`, (b) the CITATION RULE instruction is never appended in `buildStructuredPrompt`, (c) `extractCitations(response, [])` returns `[]`. Additionally, `buildUnifyingPrompt()` never includes the CITATION RULE instruction at all, even when narratives exist in sub-query results.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { query: string, sseEvent: string, queryPath: string }
  OUTPUT: boolean

  // Bug 1: Period range query
  LET hasFYRange = input.query MATCHES /\bFY\s*\d{4}\s*[-–to]+\s*(?:FY\s*)?\d{4}\b/i
  LET periodResult = extractPeriod(input.query)
  LET rangeDropped = hasFYRange AND periodResult.periodType !== 'range'

  // Bug 1b: retrieve() ignores range fields
  LET retrieveIgnoresRange = periodResult.periodType === 'range'
    AND periodResult.periodStart EXISTS
    AND periodResult.periodEnd EXISTS
    AND retrieve() only filters on query.period (not periodStart/periodEnd)

  // Bug 2: Chart first-load failure
  LET isFirstChartRender = input.sseEvent === 'visualization'
    AND canvasElement NOT IN DOM at time of doRender()
    AND retryCount >= 5

  // Bug 3: Decomposed citation absence
  LET isDecomposedPath = input.queryPath === 'decomposed'
  LET narrativesEmpty = synthesisContext.narratives.length === 0
    AND subQueryResults.some(sq => sq.narratives.length > 0)
  LET noCitationRule = buildUnifyingPrompt() does NOT contain 'CITATION RULE'

  RETURN rangeDropped
    OR retrieveIgnoresRange
    OR isFirstChartRender
    OR (isDecomposedPath AND (narrativesEmpty OR noCitationRule))
END FUNCTION
```

### Examples

- **Bug 1a**: Query "AAPL vs MSFT revenue FY 2023 - 2024" → `extractPeriod()` returns `{ period: 'FY2023' }` → only FY2023 data returned. Expected: `{ periodType: 'range', periodStart: 'FY2023', periodEnd: 'FY2024' }` → both years returned.
- **Bug 1b**: Query "AAPL revenue FY 2020 to 2024" → even if range were parsed, `retrieve()` sets `where.fiscalPeriod = 'FY2020'` (single value) instead of `{ in: ['FY2020', 'FY2021', 'FY2022', 'FY2023', 'FY2024'] }`.
- **Bug 2**: User asks "AAPL revenue trend" → SSE sends `visualization` event → `$nextTick` fires → `doRender(0)` → canvas not in DOM → retries 5 times at 200ms intervals → gives up after 1s → chart never appears. User refreshes → `renderExistingCharts()` finds canvas (now in DOM) → chart renders.
- **Bug 3**: Query "AAPL vs MSFT revenue FY 2024" → decomposed into 2 sub-queries → each sub-query retrieves narratives → `synthesisContext.narratives = []` → `formatNarratives(null)` → no CITATION RULE in prompt → LLM doesn't cite → `extractCitations(response, [])` → 0 citations.
- **Edge case**: Query "AAPL revenue FY 2024" (single FY, non-decomposed) → should continue working exactly as before with single period match and existing citation logic.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Single FY queries like "AAPL revenue FY 2024" must continue to return `{ period: 'FY2024' }` and filter on exact match
- Relative time expressions like "past 5 years" must continue to produce range results via the existing `multiYearMatch` regex
- "latest" / "most recent" queries must continue to use the `retrieveLatest` path
- `renderExistingCharts()` must continue to re-render charts from stored visualization data on page reload
- Non-chart (text-only) SSE responses must continue to render correctly with markdown formatting
- User-uploaded document citations (green styling, modal display) must continue to work
- Single-intent (non-decomposed) path citation extraction must continue to work — `buildStructuredPrompt()` already includes CITATION RULE when narratives are present
- Quick response path must continue to skip LLM synthesis and return data directly
- Mouse clicks, touch inputs, and non-number keyboard inputs must be unaffected by chart rendering changes

**Scope:**
All inputs that do NOT involve (a) explicit FY range patterns, (b) first-load chart rendering timing, or (c) decomposed query narrative collection should be completely unaffected by this fix. This includes:
- All existing regex patterns in `extractPeriod()` that come AFTER the new range regex
- All `retrieve()` calls where `periodType !== 'range'` (the existing `query.period` exact-match path)
- Chart re-renders triggered by `renderExistingCharts()` (canvas already in DOM)
- Single-intent synthesis via `buildStructuredPrompt()` (already has CITATION RULE)

## Hypothesized Root Cause

Based on code analysis, the root causes are confirmed (not hypothesized):

1. **`extractPeriod()` — Greedy First Match**: The regex `\b(?:fy|fiscal year)\s*(\d{4})\b` on line 486 matches the FIRST occurrence of "FY YYYY" in the query and returns immediately. It is checked BEFORE any range-aware pattern. For "FY 2023 - 2024", it matches "FY 2023" and returns `{ period: 'FY2023' }`, never seeing "- 2024". The fix is to add a range-aware regex BEFORE this single-FY match.

2. **`retrieve()` — Missing Range Filter**: Lines 108-110 of `structured-retriever.service.ts` only check `if (query.period) { where.fiscalPeriod = query.period; }`. There is no code path that checks `query.periodType === 'range'` or uses `query.periodStart`/`query.periodEnd` to build an `IN` filter. The `StructuredQuery` interface already has these fields — they're just never consumed.

3. **`renderChart()` — Insufficient Retry Budget**: The retry loop uses 5 attempts × 200ms = 1 second total. Alpine.js template flushing (especially with `x-show` or `x-if` conditionals on nested elements) can take longer than 1 second on initial render. The `$nextTick` + `requestAnimationFrame` wrapper helps but doesn't guarantee the canvas is in the DOM. A MutationObserver is the correct pattern — it reacts to DOM changes rather than polling.

4. **`synthesisContext.narratives = []` — Decomposed Path Data Loss**: On line ~178 of `rag.service.ts`, the decomposed path builds `synthesisContext` with `narratives: []` even though `subQueryResults` contains narratives. The narratives are available in `subQueryResults[i].narratives` but are never collected onto the top-level `synthesisContext.narratives`. This cascades through `formatNarratives()` → `null` → no CITATION RULE → no citation extraction.

5. **`buildUnifyingPrompt()` — Missing CITATION RULE**: Unlike `buildStructuredPrompt()` which conditionally appends the CITATION RULE after the narrative block, `buildUnifyingPrompt()` never includes this instruction. It does call `formatNarratives()` for each sub-query's narratives, but never tells the LLM to use `[N]` citation markers. Even if narratives were collected, the LLM wouldn't be instructed to cite them.

## Correctness Properties

Property 1: Fault Condition — FY Range Period Parsing

_For any_ query string containing an explicit fiscal year range pattern (e.g., "FY 2023 - 2024", "FY 2020 to FY 2024", "fiscal year 2022-2024"), the fixed `extractPeriod()` function SHALL return a `PeriodExtractionResult` with `periodType: 'range'`, `periodStart` set to the first FY year, and `periodEnd` set to the second FY year, rather than returning a single `period` value.

**Validates: Requirements 2.1**

Property 2: Fault Condition — Structured Retriever Range Filter

_For any_ `StructuredQuery` where `periodType === 'range'` and `periodStart`/`periodEnd` are defined, the fixed `retrieve()` method SHALL build a `fiscalPeriod: { in: [...] }` filter containing all FY periods in the range (inclusive), rather than filtering on a single `query.period` value.

**Validates: Requirements 2.2**

Property 3: Fault Condition — Chart First-Load Rendering

_For any_ `visualization` SSE event received during a conversation, the fixed `renderChart()` function SHALL render the chart on the first page load without requiring a refresh, by using a MutationObserver (or equivalent DOM-ready mechanism) that waits for the canvas element to appear with non-zero dimensions, with a reasonable timeout (5 seconds).

**Validates: Requirements 2.3**

Property 4: Fault Condition — Decomposed Path Narrative Collection

_For any_ decomposed query where sub-query results contain narratives, the fixed `synthesisContext` SHALL include all collected narratives from `subQueryResults` on its `narratives` field (not an empty array), enabling `formatNarratives()` to label them and `extractCitations()` to map response markers to sources.

**Validates: Requirements 2.5**

Property 5: Fault Condition — Unifying Prompt Citation Rule

_For any_ decomposed query where narratives are present (either top-level or in sub-query results), the fixed `buildUnifyingPrompt()` SHALL include the CITATION RULE instruction telling the LLM to use `[N]` markers corresponding to numbered narrative sources.

**Validates: Requirements 2.4, 2.5**

Property 6: Preservation — Single FY Period Queries

_For any_ query containing a single fiscal year reference (e.g., "FY 2024") without a range pattern, the fixed `extractPeriod()` SHALL produce the same result as the original function: `{ period: 'FY2024' }`.

**Validates: Requirements 3.1**

Property 7: Preservation — Relative Time Expressions

_For any_ query containing relative time expressions (e.g., "past 5 years", "last 3 years", "decade"), the fixed `extractPeriod()` SHALL produce the same range result as the original function.

**Validates: Requirements 3.2**

Property 8: Preservation — Single-Intent Citation Path

_For any_ non-decomposed query with narratives, the fixed code SHALL produce the same citation behavior as the original — `buildStructuredPrompt()` includes CITATION RULE, `parseSynthesisResponse()` extracts citations from `ctx.narratives`.

**Validates: Requirements 3.7**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/rag/intent-detector.service.ts`

**Function**: `extractPeriod()`

**Specific Changes**:
1. **Add FY Range Regex BEFORE Single FY Match**: Insert a new regex pattern before line 486 that matches explicit FY ranges:
   - Pattern: `/\b(?:fy|fiscal year)\s*(\d{4})\s*[-–to]+\s*(?:fy|fiscal year)?\s*(\d{4})\b/i`
   - Matches: "FY 2023 - 2024", "FY 2023 to 2024", "FY2023-FY2024", "fiscal year 2022 – 2024"
   - Returns: `{ periodType: 'range', periodStart: 'FY<year1>', periodEnd: 'FY<year2>' }`
   - Must come BEFORE the single `fyMatch` regex so it takes precedence

---

**File**: `src/rag/structured-retriever.service.ts`

**Function**: `retrieve()`

**Specific Changes**:
2. **Add Period Range Handling**: After the existing `if (query.period)` block (line ~108), add a new condition:
   - When `query.periodType === 'range'` and `query.periodStart` and `query.periodEnd` exist
   - Generate all FY periods in the range: parse start/end years, create array `['FY2023', 'FY2024']`
   - Set `where.fiscalPeriod = { in: generatedPeriods }`
   - This should be checked BEFORE the `if (query.period)` block, or as an `else if`, so range takes precedence over single period

---

**File**: `public/app/deals/research.html`

**Function**: `renderChart()`

**Specific Changes**:
3. **Replace Fixed Retry Loop with MutationObserver**: Replace the `doRender()` retry loop with:
   - First, attempt immediate render (canvas may already be in DOM)
   - If canvas not found or has zero dimensions, create a `MutationObserver` on the message container
   - Observer watches for `childList` and `subtree` changes
   - When canvas appears with non-zero dimensions, render and disconnect observer
   - Set a 5-second timeout as a safety net — disconnect observer and log error if exceeded
   - Keep the Chart.js availability check (it loads asynchronously)

---

**File**: `src/rag/rag.service.ts`

**Function**: `query()` — decomposed path (~line 178)

**Specific Changes**:
4. **Collect Narratives from Sub-Query Results**: Replace `narratives: []` with:
   - `narratives: subQueryResults.flatMap(sq => sq.narratives)`
   - This collects all narratives from all sub-query results onto the top-level `synthesisContext`
   - `formatNarratives()` will then label them `[1]`, `[2]`, etc.
   - `extractCitations()` will have the narratives array to map `[N]` markers to sources

---

**File**: `src/rag/hybrid-synthesis.service.ts`

**Function**: `buildUnifyingPrompt()`

**Specific Changes**:
5. **Add CITATION RULE After Narrative Sections**: After the sub-query loop that includes narratives (line ~320), add:
   - Collect all narratives from sub-query results: `ctx.subQueryResults.flatMap(sq => sq.narratives)`
   - Also include `ctx.narratives` (which will now be populated)
   - If any narratives exist, format them with `formatNarratives()` and append the CITATION RULE instruction
   - Use the same CITATION RULE text as `buildStructuredPrompt()`: "CITATION RULE: Reference narrative sources using [1], [2], etc. notation..."
   - The numbering in the CITATION RULE must match the `[N]` labels produced by `formatNarratives()` in the sub-query sections

**Alternative approach for citation numbering consistency**: Since `buildUnifyingPrompt()` already calls `formatNarratives()` per sub-query (producing local `[1]`, `[2]` numbering within each sub-query block), the CITATION RULE should reference these local numbers. Or, add a unified narrative section after all sub-queries with global numbering. The simpler approach: add a consolidated narrative section with global `[N]` numbering after the sub-query blocks, and add the CITATION RULE referencing those global numbers. This matches how `parseSynthesisResponse()` calls `extractCitations(response, ctx.narratives)` — it uses `ctx.narratives` for the mapping.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm the root cause analysis.

**Test Plan**: Write unit tests that exercise each bug condition on the UNFIXED code to observe failures.

**Test Cases**:
1. **FY Range Parsing Test**: Call `extractPeriod("AAPL vs MSFT revenue FY 2023 - 2024")` and assert `periodType === 'range'` (will fail on unfixed code — returns `{ period: 'FY2023' }`)
2. **FY Range with "to" Test**: Call `extractPeriod("revenue FY 2020 to 2024")` and assert range (will fail on unfixed code)
3. **Retrieve Range Filter Test**: Call `retrieve()` with `{ periodType: 'range', periodStart: 'FY2023', periodEnd: 'FY2024' }` and assert Prisma WHERE includes `fiscalPeriod: { in: ['FY2023', 'FY2024'] }` (will fail — only uses `query.period`)
4. **Decomposed Narratives Test**: Execute a decomposed query path and assert `synthesisContext.narratives.length > 0` when sub-queries have narratives (will fail — always `[]`)
5. **Unifying Prompt Citation Rule Test**: Call `buildUnifyingPrompt()` with narratives in sub-query results and assert output contains "CITATION RULE" (will fail — never included)

**Expected Counterexamples**:
- `extractPeriod("FY 2023 - 2024")` returns `{ period: 'FY2023' }` instead of range
- `retrieve()` WHERE clause has `fiscalPeriod: 'FY2023'` instead of `{ in: ['FY2023', 'FY2024'] }`
- `synthesisContext.narratives` is `[]` despite sub-queries having narratives
- `buildUnifyingPrompt()` output does not contain "CITATION RULE"

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed functions produce the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedFunction(input)
  ASSERT expectedBehavior(result)
END FOR
```

Specifically:
- For all FY range queries: `extractPeriod(query).periodType === 'range'` AND `periodStart`/`periodEnd` are correct
- For all range StructuredQueries: `retrieve()` WHERE clause includes all FY periods in range
- For all decomposed queries with sub-query narratives: `synthesisContext.narratives.length > 0`
- For all unifying prompts with narratives: output contains "CITATION RULE"

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed functions produce the same result as the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many random query strings to verify `extractPeriod()` produces identical results for non-range inputs
- It generates random `StructuredQuery` objects without range fields to verify `retrieve()` WHERE clause is unchanged
- It catches edge cases like "FY 2024 - something" that shouldn't be treated as ranges

**Test Plan**: Observe behavior on UNFIXED code first for non-bug inputs, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Single FY Preservation**: For random single-FY queries (e.g., "FY 2024", "fiscal year 2023"), verify `extractPeriod()` returns same result before and after fix
2. **Relative Time Preservation**: For "past N years", "last N years", "decade" queries, verify identical range results
3. **Latest Query Preservation**: For "latest", "most recent" queries, verify identical results
4. **Non-Range Retrieve Preservation**: For `StructuredQuery` with `period` set (no range fields), verify identical WHERE clause
5. **Single-Intent Citation Preservation**: For non-decomposed queries with narratives, verify `buildStructuredPrompt()` still includes CITATION RULE and `parseSynthesisResponse()` extracts citations identically
6. **Chart Re-render Preservation**: Verify `renderExistingCharts()` continues to work for stored visualization data

### Unit Tests

- Test `extractPeriod()` with various FY range formats: "FY 2023 - 2024", "FY2023-FY2024", "FY 2020 to 2024", "fiscal year 2022 – 2024"
- Test `extractPeriod()` edge cases: "FY 2024 - 2024" (same year), "FY 2024 - 2020" (reversed), "FY 2024" (single, no range)
- Test `retrieve()` with `periodType: 'range'` generates correct `IN` filter with all intermediate years
- Test `retrieve()` with single `period` still uses exact match (no regression)
- Test `synthesisContext.narratives` population from sub-query results
- Test `buildUnifyingPrompt()` includes CITATION RULE when narratives present
- Test `buildUnifyingPrompt()` omits CITATION RULE when no narratives (no false positives)
- Test `extractCitations()` correctly maps `[N]` markers to collected narratives

### Property-Based Tests

- Generate random query strings with single FY references and verify `extractPeriod()` returns identical results to original
- Generate random FY range pairs (startYear, endYear where start <= end) and verify `extractPeriod()` returns correct range
- Generate random `StructuredQuery` objects with range fields and verify `retrieve()` generates correct `IN` filter with all years
- Generate random non-range `StructuredQuery` objects and verify `retrieve()` WHERE clause is unchanged
- Generate random narrative arrays and verify `formatNarratives()` + `extractCitations()` round-trip correctly

### Integration Tests

- End-to-end test: "AAPL vs MSFT revenue FY 2023 - 2024" → verify response contains data for both years
- End-to-end test: decomposed multi-ticker query → verify citations array is non-empty in SSE response
- End-to-end test: chart-producing query → verify `visualization` SSE event is followed by successful chart render (requires browser/DOM testing)
- End-to-end test: single FY query → verify no regression in data retrieval
- End-to-end test: "past 5 years" query → verify range still works correctly
