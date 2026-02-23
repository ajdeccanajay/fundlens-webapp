# Implementation Plan: FundLens RAG ChatBot Master Engineering

## Overview

This plan implements the complete FundLens RAG ChatBot engineering initiative across 3 sprints. Tasks follow the sprint order: Foundation Fixes (Sprint 1) → Intelligence Layer (Sprint 2) → Query Complexity + Peer Comparison (Sprint 3). Each task builds on previous work. All code is TypeScript/NestJS with Prisma ORM, fast-check for property tests.

## Tasks

- [ ] 1. Sprint 1 — Foundation Fixes: Wire MetricResolution.db_column
  - [x] 1.1 Fix `getLatestByFilingType()` signature to accept `MetricResolution` instead of `string`, route computed metrics to `resolveComputedMetric()`, route unresolved to null return, and use `getSynonymsForDbColumn()` for synonym-based IN clause
    - Modify `src/rag/structured-retriever.service.ts`
    - Change parameter from `metric: string` to `resolution: MetricResolution`
    - Add computed/unresolved routing logic before DB query
    - Replace hardcoded `metricTranslation` map with `metricRegistry.getSynonymsForDbColumn(resolution.canonical_id)`
    - Use Prisma `{ in: synonyms, mode: 'insensitive' }` for the WHERE clause
    - _Requirements: 1.1, 1.4, 1.5_

  - [x] 1.2 Fix `retrieveLatest()` caller to pass `MetricResolution` objects instead of strings
    - Modify `src/rag/structured-retriever.service.ts` `retrieveLatest()` method
    - Update loop to iterate `query.metrics` as `MetricResolution[]`
    - Pass resolution objects to `getLatestByFilingType()`
    - _Requirements: 1.5_

  - [x] 1.3 Add `getSynonymsForDbColumn()` to MetricRegistryService
    - Modify `src/rag/metric-resolution/metric-registry.service.ts`
    - Implement method returning `canonical_id` + `db_column` + all YAML synonyms as raw strings
    - Return `[canonicalId]` when metric definition not found
    - Delete hardcoded `metricTranslation` map from structured-retriever
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x]* 1.4 Write property tests for synonym lookup (Properties 1, 2)
    - **Property 1: Synonym lookup completeness**
    - **Property 2: Unknown canonical ID fallback**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
    - Create `test/properties/synonym-lookup.property.spec.ts`

  - [x] 1.5 Fix `parseFiscalPeriodSortKey()` to correctly sort fiscal periods
    - Modify `src/rag/structured-retriever.service.ts`
    - FY2024 → 20240000, Q3FY2024 → 20240300, TTM → 99990000
    - Fix bug where `parseInt('Q3FY2024'.replace(/[^\d]/g,''))` = 32024
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x]* 1.6 Write property tests for fiscal period sort (Properties 5, 6)
    - **Property 5: Fiscal period sort key correctness**
    - **Property 6: Fiscal period sort ordering**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    - Create `test/properties/fiscal-period-sort.property.spec.ts`

  - [x] 1.7 Implement `resolveComputedMetric()` to delegate to FormulaResolutionService
    - Modify `src/rag/structured-retriever.service.ts`
    - Call `formulaResolver.resolveComputed(resolution, ticker, period)`
    - Return MetricResult with `statementType: 'computed'` and `displayName` from resolution
    - Handle errors gracefully: log warning, return null
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x]* 1.8 Write property tests for computed routing (Properties 3, 4)
    - **Property 3: Computed metric routing and result shape**
    - **Property 4: Unresolved metric returns null**
    - **Validates: Requirements 1.2, 1.3, 5.1, 5.2, 5.4**
    - Create `test/properties/computed-routing.property.spec.ts`

  - [x] 1.9 Add missing synonyms to `income_statement.yaml`
    - Modify `local-s3-storage/fundlens-documents-dev/metrics/universal/income_statement.yaml`
    - Add: net_sales, sales, total_net_revenue, us-gaap:Revenues, us-gaap:SalesRevenueNet, us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax
    - _Requirements: 3.1_

- [ ] 2. Checkpoint — Sprint 1a: Verify db_column wiring
  - Ensure all tests pass, ask the user if questions arise.
  - Verify T1.1: "What is the latest Revenue for ABNB?" returns actual dollar figure
  - Verify T1.5: Latest quarterly returns Q3FY2025 (not FY2024)
  - Verify T1.6: ABNB EBITDA margin routes to FormulaResolutionService

- [ ] 3. Sprint 1 — Ticker Resolution Hardening
  - [x] 3.1 Implement universal ticker regex + companies table validation
    - Modify `src/rag/intent-detector.service.ts`
    - Add `knownTickers: Set<string>` loaded from `companies` table at startup via `onModuleInit()`
    - Implement `extractTickersFromQuery()` with universal regex `(?:^|[\s,(.])([A-Z]{1,5})(?=[\s,.)!?\n]|$)`
    - Filter candidates against `knownTickers` Set
    - Add `@Cron('0 2 * * *') refreshTickerSet()` for daily refresh
    - _Requirements: 6.1, 6.2, 6.3, 6.6_

  - [x]* 3.2 Write property tests for ticker extraction (Property 7)
    - **Property 7: Ticker extraction pipeline**
    - **Validates: Requirements 6.2, 6.3**
    - Create `test/properties/ticker-extraction.property.spec.ts`

  - [x]* 3.3 Write unit tests for ticker edge cases (T1.2, T1.3, T1.4)
    - Test "COIN gross margin FY2024" → extracts COIN
    - Test "GAAP vs non-GAAP operating income for MSFT" → extracts only MSFT
    - Test "What did the 10-K say about risks?" → extracts no tickers
    - _Requirements: 6.4, 6.5_

- [ ] 4. Sprint 1 — VisualizationPayload Contract + Post-Retrieval Validation
  - [x] 4.1 Define `VisualizationPayload` type replacing stub
    - Modify `src/rag/visualization.ts` (or `src/rag/types/visualization.ts`)
    - Define `ChartType`, `VisualizationPayload` with data rows/columns and meta
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 4.2 Implement `buildVisualizationPayload()` in ResponseEnrichmentService
    - Modify `src/rag/response-enrichment.service.ts`
    - Merge metrics into rows by ticker+period, build columns from distinct metrics
    - Sort periods ascending, infer format and scale
    - Return undefined when no metrics or semantic intent
    - _Requirements: 7.4, 7.5_

  - [x]* 4.3 Write property tests for VisualizationPayload (Property 8)
    - **Property 8: VisualizationPayload population**
    - **Validates: Requirements 7.4**
    - Create `test/properties/visualization-payload.property.spec.ts`

  - [x] 4.4 Implement post-retrieval validation gate in StructuredRetriever
    - Add `validateResult()` method to `src/rag/structured-retriever.service.ts`
    - Exclude null values, confidence < 0.70, unparseable periods
    - Add 8-K warning label for income statement metrics
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

  - [x]* 4.5 Write property tests for post-retrieval validation (Properties 28, 29)
    - **Property 28: Post-retrieval confidence threshold**
    - **Property 29: 8-K warning label**
    - **Validates: Requirements 20.2, 20.4**
    - Create `test/properties/post-retrieval.property.spec.ts`

  - [x] 4.6 Implement context-aware degradation response builder
    - Modify `src/rag/response-enrichment.service.ts`
    - Add `buildDegradationResponse()` replacing `buildNoDataMessage()`
    - List found metrics, explain missing metrics, show suggestions for unresolved
    - _Requirements: 21.1, 21.2, 21.3_

  - [x]* 4.7 Write property tests for graceful degradation (Property 30)
    - **Property 30: Graceful degradation message**
    - **Validates: Requirements 21.1, 21.2, 21.3**
    - Create `test/properties/graceful-degradation.property.spec.ts`

- [ ] 5. Checkpoint — Sprint 1 Complete
  - Ensure all tests pass, ask the user if questions arise.
  - Verify all T1.1-T1.6 test cases pass
  - Verify visualization payload populated on structured queries
  - Verify degradation messages for missing/unresolved metrics

- [ ] 6. Sprint 2 — HybridSynthesisService
  - [x] 6.1 Create `HybridSynthesisService` with 5-step structured prompt
    - Create `src/rag/hybrid-synthesis.service.ts`
    - Implement `FinancialAnalysisContext` interface
    - Implement `SynthesisResult` interface
    - Implement `synthesize()` method: build prompt → invoke Bedrock → parse response
    - Implement `buildStructuredPrompt()` with 5 reasoning steps
    - Implement `formatMetricsTable()` and narrative formatting
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6, 8.7_

  - [x]* 6.2 Write property tests for structured prompt (Properties 9, 10)
    - **Property 9: Structured prompt completeness**
    - **Property 10: Peer data inclusion in prompt**
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5**
    - Create `test/properties/structured-prompt.property.spec.ts`

  - [x] 6.3 Add `ResponseType` enum and classification logic
    - Add `ResponseType` type to `src/rag/types/query-intent.ts`
    - Implement classification logic based on intent, metrics, narratives, decomposition state
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [x]* 6.4 Write property tests for ResponseType classification (Property 11)
    - **Property 11: ResponseType classification invariant**
    - **Validates: Requirements 9.1**
    - Create `test/properties/response-type.property.spec.ts`

  - [x] 6.5 Wire HybridSynthesisService into RAGService
    - Modify `src/rag/rag.service.ts`
    - Construct `FinancialAnalysisContext` from retrieval results
    - Replace `bedrock.generate()` and `buildAnswer()` calls with `hybridSynthesis.synthesize(context)`
    - Use `SynthesisResult` for answer, usage, citations in RAGResponse
    - _Requirements: 10.1, 10.2, 10.3_

  - [x]* 6.6 Write unit tests for hybrid synthesis (T2.1, T2.2)
    - Test hybrid query → responseType HYBRID_SYNTHESIS, answer contains all 5 steps
    - Test "How levered is ABNB?" → responseType CONCEPT_ANALYSIS
    - _Requirements: 8.2, 9.4, 9.6_

  - [x] 6.7 Implement PE tenant overlay
    - Add tenant overlay loading to `HybridSynthesisService`
    - Create `yaml-registries/third_avenue.yaml` with synthesis_instructions
    - Inject PE context into prompt when `asset_class === 'private_equity'`
    - _Requirements: 11.1, 11.2, 11.3_

  - [x]* 6.8 Write property tests for tenant overlay (Property 12)
    - **Property 12: Tenant overlay injection**
    - **Validates: Requirements 11.1, 11.2**
    - Create `test/properties/tenant-overlay.property.spec.ts`

- [ ] 7. Sprint 2 — Pre-Write Ingestion Validation
  - [x] 7.1 Implement ingestion validation rules
    - Modify `src/s3/sec-processing.service.ts` and `src/dataSources/sec/metrics.service.ts`
    - Add `normalizeForStorage()` before every `financialMetric.create()`
    - Add range check (>5σ from historical mean of last 8 periods)
    - Add sign convention verification from YAML registry
    - Add cross-statement reconciliation (IS net income vs CF net income)
    - Add XBRL tag → canonical_id mapping
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

  - [x]* 7.2 Write property tests for ingestion validation (Properties 24, 25, 26, 27)
    - **Property 24: Range check validation**
    - **Property 25: Sign convention correction**
    - **Property 26: Cross-statement reconciliation**
    - **Property 27: XBRL tag mapping**
    - **Validates: Requirements 19.2, 19.3, 19.4, 19.5**
    - Create `test/properties/ingestion-validation.property.spec.ts`

- [ ] 8. Checkpoint — Sprint 2 Complete
  - Ensure all tests pass, ask the user if questions arise.
  - Verify T2.1: Hybrid query contains all 5 reasoning steps
  - Verify T2.2: Concept analysis returns multi-metric dashboard
  - Verify T2.3: Third Avenue PE overlay applied

- [ ] 9. Sprint 3 — QueryDecomposerService
  - [x] 9.1 Create `QueryDecomposerService` with single-intent fast-path
    - Create `src/rag/query-decomposer.service.ts`
    - Implement `DecomposedQuery` interface
    - Implement `isSingleIntent()` — check compound markers + mixed intent types
    - Implement `decompose()` — fast-path for single intent, LLM call for multi-part
    - Implement `buildDecompositionPrompt()` with JSON response format
    - Implement `parseDecomposition()` with max 3 sub-queries enforcement
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x]* 9.2 Write property tests for query decomposer (Properties 13, 14)
    - **Property 13: Single-intent fast-path**
    - **Property 14: Decomposition invariants**
    - **Validates: Requirements 12.1, 12.3, 12.6**
    - Create `test/properties/query-decomposer.property.spec.ts`

  - [x]* 9.3 Write unit tests for query decomposition (T3.1, T3.2)
    - Test "ABNB margins AND management drivers" → 2 sub-queries
    - Test "Model ABNB path to 30% EBITDA" → 3 sub-queries
    - _Requirements: 12.2, 12.3_

- [ ] 10. Sprint 3 — Bounded Agentic Retrieval Loop
  - [x] 10.1 Implement bounded retrieval loop in RAGService
    - Modify `src/rag/rag.service.ts`
    - Add retrieval loop with MAX_RETRIEVAL_ITERATIONS = 3
    - Implement `isRetrievalComplete()` — check all tickers have metrics, narrative needs met
    - Implement `buildReplanPrompt()` — ask LLM what additional data is needed
    - Implement `parseReplanResult()` — extract additional metrics/tickers/sections
    - Merge additional retrieval results with existing data
    - Log iteration count on completion
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [x]* 10.2 Write property tests for retrieval loop (Properties 15, 16, 17)
    - **Property 15: Retrieval loop bound**
    - **Property 16: Completeness evaluation**
    - **Property 17: Retrieval result merging**
    - **Validates: Requirements 13.1, 13.2, 13.5**
    - Create `test/properties/retrieval-loop.property.spec.ts`

  - [x] 10.3 Wire QueryDecomposer into RAGService with sub-query execution
    - Modify `src/rag/rag.service.ts`
    - Call `queryDecomposer.decompose()` between intent detection and retrieval
    - When decomposed: execute sub-queries, collect results, pass to HybridSynthesisService
    - Implement unifying synthesis prompt in HybridSynthesisService
    - _Requirements: 14.1, 14.2, 14.3_

  - [x]* 10.4 Write property tests for synthesis routing (Property 18)
    - **Property 18: Unifying synthesis for sub-queries**
    - **Validates: Requirements 14.3**
    - Create `test/properties/synthesis-routing.property.spec.ts`

- [ ] 11. Sprint 3 — Peer Comparison Engine
  - [x] 11.1 Create peer universe registry YAML
    - Create `yaml-registries/peer_universes.yaml`
    - Define online_travel, us_mega_cap_tech, third_avenue_portfolio peer groups
    - Include display_name, members, primary_metrics, normalization_basis
    - _Requirements: 15.1, 15.2, 15.3_

  - [x] 11.2 Create `PeerComparisonService`
    - Create `src/rag/peer-comparison.service.ts`
    - Implement `PeerComparisonResult` interface
    - Implement `compare()` — parallel fetch all tickers × metrics via Promise.all
    - Implement `normalizePeriods()` — FY passthrough, LTM sum trailing 4 quarters
    - Implement `buildComparisonResult()` — compute median, mean, rank, subject-vs-median
    - Flag FY mismatch when fiscal year-ends differ by > 60 days
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [x]* 11.3 Write property tests for peer comparison (Properties 19, 20, 21)
    - **Property 19: Peer comparison parallel fetch completeness**
    - **Property 20: LTM normalization**
    - **Property 21: Peer statistics correctness**
    - **Validates: Requirements 16.1, 16.2, 16.3**
    - Create `test/properties/peer-comparison.property.spec.ts`

  - [x] 11.4 Wire peer universe resolution into QueryRouter
    - Modify QueryRouterService (or `src/rag/rag.service.ts` routing logic)
    - When `needsPeerComparison` and single ticker: look up peer universe, expand tickers
    - Log universe name and member tickers
    - _Requirements: 17.1, 17.2, 17.3_

  - [x]* 11.5 Write property tests for peer universe resolution (Property 22)
    - **Property 22: Peer universe resolution**
    - **Validates: Requirements 17.1**
    - Create `test/properties/peer-universe.property.spec.ts`

  - [x] 11.6 Implement grounded provocation (peer-aware Step 5)
    - Modify `src/rag/hybrid-synthesis.service.ts`
    - When peerData present: replace standard Step 5 with peer-grounded template
    - Reference specific divergence between subject and named peer
    - _Requirements: 18.1, 18.2, 18.3_

  - [x]* 11.7 Write property tests for provocation (Property 23)
    - **Property 23: Peer-grounded provocation trigger**
    - **Validates: Requirements 18.1**
    - Create `test/properties/provocation.property.spec.ts`

- [ ] 12. Sprint 3 — Observability Signals
  - [x] 12.1 Add observability logging across services
    - StructuredRetriever: log metric misses to `metric_misses`, trigger MetricLearningService
    - MetricRegistryService: log unresolved queries with YAML synonym suggestions
    - RAGService: log retrieval loop iteration count
    - QueryDecomposerService: log sub-query count and unifying instruction
    - IntentDetectorService: log ticker candidates not in companies table to `ticker_miss_log`
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5_

- [ ] 13. Final Checkpoint — All Sprints Complete
  - Ensure all tests pass, ask the user if questions arise.
  - Verify all T1.1-T1.6 Sprint 1 tests
  - Verify all T2.1-T2.3 Sprint 2 tests
  - Verify all T3.1-T3.3 Sprint 3 tests
  - Verify latency targets: p50 < 800ms simple, p50 < 2500ms hybrid, p50 < 4000ms decomposed

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each sprint
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples from the Definition of Done (T1.1-T3.3)
- Sprint 1 is a prerequisite for Sprints 2 and 3
- Sprint 3 tasks 9-10 (Query Complexity) and 11 (Peer Comparison) can run concurrently
