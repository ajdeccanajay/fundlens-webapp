# Implementation Plan

- [ ] 1. Write bug condition exploration test
  - **Property 1: Fault Condition** - FY Range Parsing, Retriever Range Filter, Decomposed Narratives, and Unifying Prompt Citation Rule
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bugs exist
  - **Scoped PBT Approach**: Scope properties to concrete failing cases for reproducibility
  - Test 1a: `extractPeriod("AAPL vs MSFT revenue FY 2023 - 2024")` — assert `periodType === 'range'`, `periodStart === 'FY2023'`, `periodEnd === 'FY2024'` (will fail — returns `{ period: 'FY2023' }`)
  - Test 1b: `extractPeriod("revenue FY 2020 to 2024")` — assert range with start FY2020, end FY2024 (will fail)
  - Test 1c: `retrieve()` with `{ periodType: 'range', periodStart: 'FY2023', periodEnd: 'FY2024' }` — assert Prisma WHERE includes `fiscalPeriod: { in: ['FY2023', 'FY2024'] }` (will fail — only uses `query.period`)
  - Test 1d: Decomposed query path — assert `synthesisContext.narratives.length > 0` when sub-queries have narratives (will fail — always `[]`)
  - Test 1e: `buildUnifyingPrompt()` with narratives in sub-query results — assert output contains "CITATION RULE" (will fail — never included)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct — it proves the bugs exist)
  - Document counterexamples found to understand root cause
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Single FY Queries, Relative Time Expressions, Single-Intent Citations
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: `extractPeriod("AAPL revenue FY 2024")` returns `{ period: 'FY2024' }` on unfixed code
  - Observe: `extractPeriod("past 5 years")` returns range result on unfixed code
  - Observe: `extractPeriod("latest revenue")` returns latest-type result on unfixed code
  - Observe: `retrieve()` with single `period` field uses exact match `where.fiscalPeriod = query.period`
  - Observe: `buildStructuredPrompt()` includes CITATION RULE when narratives present (single-intent path)
  - Write property-based test: for all single-FY query patterns, `extractPeriod()` returns `{ period: 'FY<year>' }` with no range fields (from Preservation Requirement 3.1)
  - Write property-based test: for all relative time expressions, `extractPeriod()` returns same range result (from Preservation Requirement 3.2)
  - Write property-based test: for all non-range `StructuredQuery` objects, `retrieve()` WHERE clause uses exact `fiscalPeriod` match (from Preservation Requirement 3.1)
  - Write property-based test: for non-decomposed queries with narratives, `buildStructuredPrompt()` includes CITATION RULE (from Preservation Requirement 3.7)
  - Verify all tests pass on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.7_

- [x] 3. Fix 1: FY Range Period Parsing in `extractPeriod()`

  - [x] 3.1 Add FY range regex before single FY match in `intent-detector.service.ts`
    - In `extractPeriod()`, add regex `/\b(?:fy|fiscal year)\s*(\d{4})\s*[-–to]+\s*(?:fy|fiscal year)?\s*(\d{4})\b/i` BEFORE the existing single-FY `fyMatch` regex
    - When matched, return `{ periodType: 'range', periodStart: 'FY<year1>', periodEnd: 'FY<year2>' }`
    - Must take precedence over single FY match so "FY 2023 - 2024" is not consumed as "FY 2023"
    - _Bug_Condition: isBugCondition(input) where query MATCHES FY range pattern AND extractPeriod returns single period instead of range_
    - _Expected_Behavior: extractPeriod returns { periodType: 'range', periodStart: 'FY<year1>', periodEnd: 'FY<year2>' }_
    - _Preservation: Single FY queries like "FY 2024" must still return { period: 'FY2024' } — the single-FY regex remains unchanged after the new range regex_
    - _Requirements: 2.1, 3.1, 3.2_

- [x] 4. Fix 2: Structured Retriever Range Filter in `retrieve()`

  - [x] 4.1 Add period range handling in `structured-retriever.service.ts`
    - In `retrieve()`, add condition before/alongside `if (query.period)` block
    - When `query.periodType === 'range'` with `periodStart`/`periodEnd`, parse start/end years, generate all FY periods in range
    - Set `where.fiscalPeriod = { in: ['FY2020', 'FY2021', ..., 'FY2024'] }`
    - Range check should take precedence over single period exact match
    - _Bug_Condition: query.periodType === 'range' AND periodStart/periodEnd exist AND retrieve() only filters on query.period_
    - _Expected_Behavior: retrieve() builds fiscalPeriod IN filter with all years in range_
    - _Preservation: Non-range queries with single query.period must still use exact match where.fiscalPeriod = query.period_
    - _Requirements: 2.2, 3.1_

- [x] 5. Fix 3: Chart First-Load Rendering in `research.html`

  - [x] 5.1 Replace fixed retry loop with MutationObserver in `renderChart()`
    - Replace the 5×200ms `doRender()` retry loop with a MutationObserver pattern
    - First attempt immediate render (canvas may already be in DOM)
    - If canvas not found or has zero dimensions, create MutationObserver on message container
    - Observer watches `childList` and `subtree` changes for canvas element with non-zero dimensions
    - 5-second timeout as safety net — disconnect observer and log error if exceeded
    - Keep Chart.js availability check
    - _Bug_Condition: visualization SSE event arrives AND canvas NOT in DOM at doRender() time AND retryCount >= 5_
    - _Expected_Behavior: Chart renders on first load via MutationObserver waiting for canvas to appear_
    - _Preservation: renderExistingCharts() continues to work for stored visualization data on page reload_
    - _Requirements: 2.3, 3.4, 3.5_

- [x] 6. Fix 4: Decomposed Path Narrative Collection in `rag.service.ts`

  - [x] 6.1 Replace `narratives: []` with collected sub-query narratives
    - In the decomposed query path (~line 178 of `rag.service.ts`), replace `narratives: []` with `narratives: subQueryResults.flatMap(sq => sq.narratives)`
    - This collects all narratives from sub-query results onto `synthesisContext.narratives`
    - Enables `formatNarratives()` to label them and `extractCitations()` to map markers to sources
    - _Bug_Condition: decomposed query path AND synthesisContext.narratives.length === 0 AND subQueryResults have narratives_
    - _Expected_Behavior: synthesisContext.narratives populated from subQueryResults.flatMap(sq => sq.narratives)_
    - _Preservation: Single-intent path citation extraction unchanged — only affects decomposed path_
    - _Requirements: 2.5, 3.7_

- [x] 7. Fix 5: Unifying Prompt Citation Rule in `hybrid-synthesis.service.ts`

  - [x] 7.1 Add consolidated narrative section and CITATION RULE to `buildUnifyingPrompt()`
    - After sub-query blocks, add consolidated narrative section with global [N] numbering
    - Collect all narratives: `ctx.subQueryResults.flatMap(sq => sq.narratives)` plus `ctx.narratives`
    - If narratives exist, format with `formatNarratives()` and append CITATION RULE instruction
    - Use same CITATION RULE text as `buildStructuredPrompt()`: "CITATION RULE: Reference narrative sources using [1], [2], etc."
    - Global numbering must match what `extractCitations(response, ctx.narratives)` expects
    - _Bug_Condition: buildUnifyingPrompt() does NOT contain 'CITATION RULE' even when narratives exist_
    - _Expected_Behavior: buildUnifyingPrompt() includes CITATION RULE when narratives present_
    - _Preservation: buildStructuredPrompt() citation behavior unchanged for single-intent path_
    - _Requirements: 2.4, 2.5, 3.7_

  - [x] 7.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - All Five Fixes Validated
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior for all five bug conditions
    - When this test passes, it confirms all bugs are fixed
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 7.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Single FY, Relative Time, Single-Intent Citations
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 8. Checkpoint — Ensure all tests pass and manual smoke test
  - Run full test suite to ensure no regressions
  - Manual smoke test: query "AAPL vs MSFT revenue FY 2023 - 2024" and verify both years returned
  - Manual smoke test: query a chart-producing question and verify chart renders on first load
  - Manual smoke test: query a multi-ticker comparison and verify citations appear in response
  - Manual smoke test: query "AAPL revenue FY 2024" (single FY) and verify no regression
  - Ensure all tests pass, ask the user if questions arise
