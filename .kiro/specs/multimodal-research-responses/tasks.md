# Implementation Plan: Multimodal Research Responses

## Overview

Incrementally add the ResponseEnrichmentService (two-phase architecture), visualization generation, financial calculator integration, cache re-enablement, and quick response path to the research assistant. Each task builds on the previous, with property tests validating correctness at each stage.

## Tasks

- [x] 1. Create VisualizationPayload types and VisualizationGeneratorService
  - [x] 1.1 Create `src/rag/types/visualization.ts` with `ChartType`, `ChartDataset`, and `VisualizationPayload` interfaces
    - _Requirements: 1.3_
  - [x] 1.2 Create `src/rag/visualization-generator.service.ts` with `generateVisualization()`, `buildTrendChart()`, and `buildComparisonChart()` methods
    - Accept `QueryIntent`, `MetricResult[]`, and optional `MetricsSummary`
    - Return `VisualizationPayload | null`
    - Return null when fewer than 2 data points
    - For `needsTrend`: produce line chart with fiscal periods as labels, metric values as primary dataset
    - For `needsComparison` with multiple tickers: produce groupedBar chart with datasets per ticker
    - When `MetricsSummary` includes `yoyGrowth`, add secondary dataset with `yAxisID` for dual-axis
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 2.3_
  - [x]* 1.3 Write property tests for VisualizationGenerator in `test/properties/visualization-generator.property.spec.ts`
    - **Property 1: Trend visualization generation**
    - **Validates: Requirements 1.1**
    - **Property 2: Comparison visualization generation**
    - **Validates: Requirements 1.2**
    - **Property 3: Visualization-metric value consistency**
    - **Validates: Requirements 1.5**
    - **Property 4: YoY growth secondary dataset inclusion**
    - **Validates: Requirements 2.3**
  - [x]* 1.4 Write unit tests for VisualizationGenerator edge cases in `test/unit/visualization-generator.service.spec.ts`
    - Test: empty metrics array returns null
    - Test: single data point returns null
    - Test: mixed period types handled correctly
    - _Requirements: 1.4_

- [x] 2. Create ResponseEnrichmentService with two-phase architecture
  - [x] 2.1 Create `src/rag/response-enrichment.service.ts` with `ResponseEnrichmentService` class
    - Inject `FinancialCalculatorService` and `VisualizationGeneratorService` as dependencies
    - Implement `computeFinancials(intent, metrics)` — Phase 1 (pre-LLM): calls `FinancialCalculatorService.getMetricsSummary()` for the ticker, wraps in try/catch, returns `MetricsSummary | undefined`
    - Implement `enrichResponse(response, intent, metrics, computedSummary)` — Phase 2 (post-LLM): calls `VisualizationGeneratorService.generateVisualization()` and attaches result to response
    - Implement `isQuickResponseEligible(intent)` — returns true when `type === 'structured'`, `confidence > 0.85`, `needsNarrative === false`
    - Implement `buildQuickResponse(intent, metrics)` — formats metrics into markdown table, calls both compute and visualize, sets `usedClaudeGeneration: false`
    - _Requirements: 2.1, 2.2, 2.4, 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 2.2 Register `ResponseEnrichmentService`, `VisualizationGeneratorService`, and `FinancialCalculatorService` in `rag.module.ts`
    - Import `FinancialCalculatorService` from deals module (ensure it's exported)
    - _Requirements: 2.1_
  - [x]* 2.3 Write unit tests for ResponseEnrichmentService in `test/unit/response-enrichment.service.spec.ts`
    - Test: computeFinancials calls FinancialCalculatorService when needsTrend is true
    - Test: computeFinancials returns undefined when calculator fails
    - Test: enrichResponse attaches visualization to response
    - Test: isQuickResponseEligible returns correct boolean
    - Test: buildQuickResponse produces markdown table with no LLM
    - _Requirements: 2.1, 2.2, 2.4, 7.1_
  - [x]* 2.4 Write property test for Phase 1 context injection in `test/properties/response-enrichment.property.spec.ts`
    - **Property 14: Phase 1 computed summary injected into LLM context**
    - **Validates: Requirements 2.2**

- [x] 3. Integrate ResponseEnrichmentService into RAG pipeline and extend streaming
  - [x] 3.1 Inject `ResponseEnrichmentService` into `RAGService` constructor (ONE new dependency) and add import
    - _Requirements: 2.1_
  - [x] 3.2 Add Phase 1 call in `RAGService.query()`: call `responseEnrichment.computeFinancials(intent, metrics)` after retrieval but before LLM generation, when `intent.needsTrend || intent.needsComputation`
    - Pass computed summary into LLM context (add to bedrock.generate options)
    - _Requirements: 2.1, 2.2_
  - [x] 3.3 Add Phase 2 call in `RAGService.query()`: call `responseEnrichment.enrichResponse(response, intent, metrics, computedSummary)` after LLM generation
    - _Requirements: 1.1, 1.2_
  - [x] 3.4 Add quick response branch in `RAGService.query()`: call `responseEnrichment.isQuickResponseEligible(intent)` after structured retrieval, delegate to `responseEnrichment.buildQuickResponse()` if eligible
    - _Requirements: 7.1_
  - [x] 3.5 Add `VisualizationPayload` to `RAGResponse` interface in `src/rag/types/query-intent.ts` as optional `visualization` field
    - _Requirements: 1.3, 3.3_
  - [x] 3.6 Update `StreamChunk` type in `src/research/research-assistant.service.ts` to include `'visualization'` in the type union
    - _Requirements: 3.1_
  - [x] 3.7 Update `ResearchAssistantService.sendMessage()` to yield a `'visualization'` chunk before token chunks when `ragResult.visualization` is present
    - _Requirements: 3.2, 3.4_
  - [x]* 3.8 Write property test for stream chunk ordering in `test/properties/research-assistant-streaming.property.spec.ts`
    - **Property 5: Visualization stream chunk ordering**
    - **Validates: Requirements 3.2, 3.4**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Re-enable performance optimizer cache with invalidation
  - [x] 5.1 Uncomment the cache lookup block in `RAGService.query()` (around line ~94) and the cache storage block (around line ~382)
    - _Requirements: 5.1_
  - [x] 5.2 Add `invalidateByTicker(ticker: string): number` method to `PerformanceOptimizerService`
    - Iterate cache entries, remove those whose key contains the ticker
    - Increment eviction counter by number removed
    - Return count of removed entries
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 5.3 Wire cache invalidation into the SEC filing ingestion pipeline
    - Call `performanceOptimizer.invalidateByTicker(ticker)` after successful filing ingestion in the appropriate ingestion service
    - _Requirements: 6.1_
  - [x]* 5.4 Write property tests for cache in `test/properties/performance-optimizer-cache.property.spec.ts`
    - **Property 6: Cache hit returns equivalent response**
    - **Validates: Requirements 5.2, 5.3**
    - **Property 7: TTL selection by query type**
    - **Validates: Requirements 5.4**
    - **Property 8: LRU eviction on max size**
    - **Validates: Requirements 5.5**
    - **Property 9: Ticker-based cache invalidation**
    - **Validates: Requirements 6.1, 6.2**
    - **Property 10: TTL expiration**
    - **Validates: Requirements 6.4**
  - [x]* 5.5 Write unit test for cache invalidation in `test/unit/cache-invalidation.spec.ts`
    - Test: invalidateByTicker removes correct entries
    - Test: invalidateByTicker with unknown ticker returns 0
    - Test: integration with ingestion pipeline trigger
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Frontend chart rendering
  - [x] 7.1 Add Chart.js CDN script tag to `public/app/research/index.html`
    - _Requirements: 4.1_
  - [x] 7.2 Create chart renderer Alpine.js component in `public/app/research/index.html`
    - Handle `'visualization'` SSE event type
    - Create Chart.js instance from VisualizationPayload (line, bar, groupedBar)
    - Configure responsive canvas, tooltips with metric name/value/period
    - Apply FundLens design system color palette
    - Render chart inline in assistant message area before text content
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 7.3 Add Chart.js CDN and chart renderer to `public/app/deals/workspace.html`
    - Reuse same rendering logic and color scheme as research page
    - Fit chart within workspace message container
    - _Requirements: 8.1, 8.2, 8.3_
  - [x]* 7.4 Write E2E test for multimodal research flow in `test/e2e/multimodal-research.e2e-spec.ts`
    - Test: trend query produces visualization SSE event followed by token events
    - Test: non-trend query produces no visualization SSE event
    - _Requirements: 3.2, 3.4, 4.1_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The FinancialCalculatorService already exists at `src/deals/financial-calculator.service.ts` — it is NOT recreated, just wired into ResponseEnrichmentService
- The PerformanceOptimizerService cache code already exists — task 5 is about uncommenting and adding invalidation
- RAGService gets ONE new dependency (ResponseEnrichmentService) instead of two — keeping the god-service from growing further
- ResponseEnrichmentService owns both FinancialCalculatorService and VisualizationGeneratorService
- Two-phase flow: Phase 1 (computeFinancials) runs pre-LLM, Phase 2 (enrichResponse) runs post-LLM
- For production multi-instance deployment, the in-memory LRU cache should be migrated to Redis/ElastiCache
