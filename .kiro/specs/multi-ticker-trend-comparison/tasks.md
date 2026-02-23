# Implementation Plan: RAG Query Robustness — Disclosure, Segment, and Multi-Ticker Trend Fixes

## Overview

Surgical fixes across 6 existing services to resolve 4 categories of broken analyst queries. No new services. All changes modify existing methods or add sibling methods in the same files. TypeScript/NestJS codebase with fast-check for property-based testing.

## Tasks

- [x] 1. Fix SectionType alignment and QueryRouter defaults
  - [x] 1.1 Update SectionType type definition and StructuredQuery interface
    - In `src/rag/types/query-intent.ts`, change `SectionType` from `'mda' | 'risk_factors' | 'business' | 'notes' | 'financial_statements'` to `'item_1' | 'item_1a' | 'item_2' | 'item_3' | 'item_7' | 'item_8'`
    - Add `periodStart?: string` and `periodEnd?: string` to `StructuredQuery` interface
    - Fix any TypeScript compile errors from the type change across the codebase
    - _Requirements: 1.1, 1.4_

  - [x] 1.2 Fix QueryRouter default sectionTypes in buildHybridPlan and buildConceptPlan
    - In `src/rag/query-router.service.ts`, change `buildHybridPlan()` default from `['mda']` to `['item_7']`
    - In `buildConceptPlan()`, change `sectionTypes: ['mda']` to `sectionTypes: ['item_7']`
    - _Requirements: 1.2, 1.3_

  - [ ]* 1.3 Write property tests for section type alignment
    - **Property 1: Hybrid and concept plan default section types are valid Bedrock KB values**
    - **Validates: Requirements 1.2, 1.3**
    - **Property 2: Section types flow unchanged from intent through router to Bedrock KB filter**
    - **Validates: Requirements 1.4, 2.2, 2.4, 3.4**

- [x] 2. Enhance extractSectionTypes for disclosure and segment queries
  - [x] 2.1 Add segment keyword detection to extractSectionTypes
    - In `src/rag/intent-detector.service.ts`, add regex pattern for segment/segments/business segment/operating segment/reportable segment that pushes `item_1`, `item_7`, and `item_8`
    - Ensure deduplication with existing keyword matches (e.g., "business" already adds `item_1`)
    - _Requirements: 3.1_

  - [x] 2.2 Add segment count query hybrid classification
    - In `determineQueryType()`, add check: when sectionTypes includes all three segment sections AND query has count keywords ("how many", "number of"), classify as `hybrid`
    - _Requirements: 3.2_

  - [ ]* 2.3 Write property tests for disclosure and segment section extraction
    - **Property 3: Disclosure keywords produce item_8 section type**
    - **Validates: Requirements 2.1**
    - **Property 4: Segment keywords produce multi-section routing**
    - **Validates: Requirements 3.1**
    - **Property 5: Segment count queries classified as hybrid**
    - **Validates: Requirements 3.2**

  - [ ]* 2.4 Write unit tests for the four failing query patterns (section routing)
    - Test "What is disclosed about stock-based compensation programs?" → sectionTypes includes `item_8`
    - Test "How does the company account for leases under ASC 842?" → sectionTypes includes `item_8`
    - Test "How many business segments does the company report?" → sectionTypes includes `item_1`, `item_7`, `item_8`, type is `hybrid`
    - _Requirements: 2.1, 3.1, 3.2_

- [x] 3. Checkpoint — Section type fixes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement multi-year period extraction and expanded trend detection
  - [x] 4.1 Refactor extractPeriod to return PeriodExtractionResult
    - Create `PeriodExtractionResult` interface in `src/rag/intent-detector.service.ts`
    - Add multi-year regex patterns: "past N years", "last N years", "over the past N years", "N-year", "N year", "decade", "yoy"
    - Cap N at 30 to prevent excessive DB queries
    - Ensure specific fiscal year takes precedence (check single-year patterns after multi-year)
    - Update `detectWithRegex()` to destructure the richer result and populate `periodStart`, `periodEnd`, `periodType` on QueryIntent
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 4.2 Expand needsTrend keyword list
    - Add keywords: "how has", "how have", "year over year", "yoy", "multi-year", "multi year", "over the past", "over the last"
    - Add regex patterns: `/\b(?:past|last)\s+\d+\s+years?\b/i`, `/\b\d+[\s-]year\b/i`, `/\bpast\s+decade\b/i`
    - _Requirements: 5.1, 5.2_

  - [ ]* 4.3 Write property tests for period extraction and trend detection
    - **Property 6: Multi-year phrases produce valid period ranges**
    - **Validates: Requirements 4.1, 4.2**
    - **Property 7: Specific fiscal year takes precedence over multi-year phrase**
    - **Validates: Requirements 4.5**
    - **Property 8: Expanded trend keywords trigger needsTrend**
    - **Validates: Requirements 5.1, 5.2**

- [x] 5. Implement query router period range propagation and structured range retrieval
  - [x] 5.1 Propagate periodStart/periodEnd in QueryRouter
    - In `buildStructuredPlan()`, add `periodStart: intent.periodStart`, `periodEnd: intent.periodEnd`, and set `filingTypes: ['10-K']` when `periodType === 'range'`
    - In `buildHybridPlan()`, same propagation for StructuredQuery, and set SemanticQuery `period` to `${intent.periodStart}-${intent.periodEnd}` for range queries
    - _Requirements: 6.3, 10.1, 10.2, 10.3_

  - [x] 5.2 Add retrieveRange method to StructuredRetrieverService
    - In `src/rag/structured-retriever.service.ts`, add `retrieveRange()` method that queries PostgreSQL with `fiscalPeriod BETWEEN periodStart AND periodEnd` and `filingType = '10-K'`
    - In `retrieve()`, add early check: if `query.periodType === 'range'`, delegate to `retrieveRange()`
    - _Requirements: 6.1, 6.2_

  - [ ]* 5.3 Write property tests for range propagation and retrieval
    - **Property 9: Range retrieval returns only in-range annual metrics**
    - **Validates: Requirements 6.1, 6.2**
    - **Property 10: Query router propagates range fields correctly**
    - **Validates: Requirements 6.3, 10.1, 10.2, 10.3**

- [x] 6. Checkpoint — Period and retrieval fixes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement multi-ticker visualization and financial computation
  - [x] 7.1 Add buildMultiTickerTrendChart to VisualizationGeneratorService
    - In `src/rag/visualization-generator.service.ts`, add `buildMultiTickerTrendChart()` method that creates one dataset per ticker on a shared time axis
    - Update `generateVisualization()` priority: `needsTrend && tickers.length > 1` → multi-series trend, `needsTrend` → single-ticker trend, `needsComparison && tickers.length > 1` → comparison
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 7.2 Add computeFinancialsMulti to ResponseEnrichmentService
    - In `src/rag/response-enrichment.service.ts`, add `computeFinancialsMulti()` that iterates all tickers, catches per-ticker errors, returns partial results
    - Update `enrichResponse()` to call `computeFinancialsMulti()` instead of `computeFinancials()` when multiple tickers present
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 7.3 Write property tests for multi-ticker visualization and computation
    - **Property 11: Multi-ticker trend chart includes all tickers with labels**
    - **Validates: Requirements 7.1, 7.2, 7.4**
    - **Property 12: Single-ticker trend chart backward compatibility**
    - **Validates: Requirements 7.3**
    - **Property 13: Multi-ticker financial computation covers all tickers**
    - **Validates: Requirements 8.1, 8.2**
    - **Property 14: Financial computation resilience on partial failure**
    - **Validates: Requirements 8.3**

- [x] 8. Implement context ticker fix and missing data handling
  - [x] 8.1 Fix extractTicker to merge contextTicker with query tickers
    - In `src/rag/intent-detector.service.ts`, refactor `extractTicker()` to always run query ticker extraction, then merge with contextTicker
    - Extract existing ticker extraction logic into `extractTickersFromQuery()` private method
    - Deduplicate when contextTicker appears in query
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 8.2 Add missing ticker data handling to RAGService
    - In `src/rag/rag.service.ts`, after structured retrieval, partition metrics by ticker
    - Identify tickers with zero results, build per-ticker availability message
    - Continue analysis/visualization for tickers that have data
    - Handle all-tickers-missing edge case
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ]* 8.3 Write property tests for context ticker and missing data
    - **Property 15: Missing ticker identification and partial analysis**
    - **Validates: Requirements 9.1, 9.2, 9.3**
    - **Property 16: Context ticker merges with query tickers**
    - **Validates: Requirements 11.1, 11.2, 11.3**

- [x] 9. Final checkpoint — Full regression
  - Ensure all tests pass, ask the user if questions arise.
  - Run existing test suites to verify no regressions in single-ticker queries, comparison queries, and semantic retrieval

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check with minimum 100 iterations
- Unit tests validate specific examples and edge cases for the four failing query patterns
- No new services are created — all changes are to existing service methods
