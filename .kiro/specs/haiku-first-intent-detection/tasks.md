# Implementation Plan: Haiku-First Intent Detection

## Overview

This plan implements the Haiku-first intent detection pipeline in 4 sessions following the spec's session order. Session 0.5a creates the QIO types and HaikuIntentParserService. Session 0.5b creates IntentValidatorService and rewires IntentDetectorService. Session 0.5c adds LRU cache and Bedrock fallback. Session 0.5d runs the eval dataset, tunes the system prompt, and adds an integration test with a real Bedrock call. Each session builds on the previous one with no orphaned code.

## Tasks

- [x] 1. Session 0.5a: QIO Types and HaikuIntentParserService
  - [x] 1.1 Create QueryIntentObject type definitions
    - Create `src/rag/types/query-intent-object.ts`
    - Define QueryIntentEntity, QueryIntentMetric, QueryIntentTimePeriod, QueryType, and QueryIntentObject interfaces
    - Define the 10 QueryType union values: single_metric, multi_metric, comparative, peer_benchmark, trend_analysis, concept_analysis, narrative_only, modeling, sentiment, screening
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 1.2 Create HaikuIntentParserService with system prompt and JSON parser
    - Create `src/rag/haiku-intent-parser.service.ts`
    - Implement `parse(query: string): Promise<QueryIntentObject | null>` method
    - Implement `buildExtractionPrompt(query: string): string` with the versioned 5-category system prompt (TICKERS, METRICS, TIME PERIODS, QUERY TYPE, FLAGS) from FUNDLENS_HAIKU_INTENT_SPEC.md Section 0.2
    - Implement `parseResponse(response: string, originalQuery: string): QueryIntentObject | null` with JSON validation, markdown fence stripping, field normalization (tickers uppercase, canonical_guess lowercase), and null return on any parse failure
    - Configure: model=`anthropic.claude-3-5-haiku-20241022-v1:0`, max_tokens=500, temperature=0, timeout=3000ms
    - Add prompt version constant and log it with every Bedrock API call
    - Inject BedrockService via constructor
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

  - [x] 1.3 Write property tests for QIO parsing (Properties 1 and 2)
    - Create `test/properties/qio-parsing.property.spec.ts`
    - **Property 1: QIO JSON Parsing Preserves All Fields With Correct Normalization**
    - Generate random valid QIO JSON objects with fast-check, verify parseResponse preserves all fields with tickers uppercased and canonical_guess lowercased
    - **Property 2: Invalid JSON Always Returns Null**
    - Generate random invalid JSON strings and malformed objects, verify parseResponse returns null
    - Minimum 100 iterations per property
    - **Validates: Requirements 1.2, 1.5, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

  - [x] 1.4 Write unit tests for HaikuIntentParserService
    - Create `test/unit/haiku-intent-parser.spec.ts`
    - Test T0.1: "What is ABNB's latest revenue?" → ticker ABNB, metric revenue, single_metric, latest
    - Test T0.7: "abnb revenue" → ABNB uppercase normalization
    - Test T0.12: Invalid JSON from Haiku → parseResponse returns null
    - Test prompt version is logged with API calls
    - Test markdown fence stripping (```json wrapped response)
    - _Requirements: 1.1, 1.2, 1.7, 1.8, 1.9_

- [x] 2. Checkpoint — Session 0.5a gate
  - Ensure all tests pass, ask the user if questions arise.
  - Gate: Unit test passes for parse("What is C's revenue?") → ticker: C, company: Citigroup, metric: revenue

- [x] 3. Session 0.5b: IntentValidatorService and Rewire IntentDetectorService
  - [x] 3.1 Create ValidatedQueryIntent types and IntentValidatorService
    - Create `src/rag/intent-validator.service.ts`
    - Define ValidatedEntity, MappedTimePeriod, and ValidatedQueryIntent interfaces
    - Implement `onModuleInit()` to load ticker data from Postgres companies table into in-memory Set
    - Implement `@Cron('0 2 * * *') refreshTickerData()` for daily refresh
    - Implement `validate(qio: QueryIntentObject): Promise<ValidatedQueryIntent>` with:
      - Ticker validation: exact match against knownTickers set
      - Fuzzy match by company name (case-insensitive substring) when ticker not found, confidence reduced by 20%
      - Entity deduplication by ticker keeping highest confidence
      - Ticker miss logging for observability
      - Metric resolution via MetricRegistryService (canonical_guess first, then raw_name)
      - needs_computation correction: force true if any resolved MetricResolution has type='computed'
      - Time period mapping: latest→LATEST_BOTH, specific_year→SPECIFIC_YEAR, specific_quarter→SPECIFIC_QUARTER, range→RANGE, ttm→TTM, ytd→YTD
    - Inject PrismaService and MetricRegistryService
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 14.1, 14.2_

  - [x] 3.2 Write property tests for ticker validation (Property 3)
    - Create `test/properties/ticker-validation.property.spec.ts`
    - **Property 3: Ticker Validation Produces Correct Outcome For All Entity Types**
    - Generate random entities with random tickers and company names against a known ticker/company set
    - Verify exact matches get source "exact_match" with original confidence
    - Verify fuzzy matches get source "fuzzy_match" with confidence * 0.8
    - Verify unknown entities are excluded
    - Verify deduplication keeps highest confidence per ticker
    - Minimum 100 iterations
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.9, 14.1**

  - [x] 3.3 Write property tests for metric resolution and time period mapping (Properties 4 and 5)
    - Add to `test/properties/ticker-validation.property.spec.ts`
    - **Property 4: Metric Resolution Tries Canonical Guess Then Raw Name**
    - Generate random metrics, mock MetricRegistryService to resolve some canonical_guesses and some raw_names
    - Verify resolution order and that output count equals input count
    - **Property 5: Time Period Mapping Covers All 6 Types Correctly**
    - Generate all 6 time_period types with random values, verify correct PeriodType mapping
    - Minimum 100 iterations per property
    - **Validates: Requirements 6.6, 6.7**

  - [x] 3.4 Write unit tests for IntentValidatorService
    - Create `test/unit/intent-validator.spec.ts`
    - Test exact ticker match (AMZN in companies table)
    - Test fuzzy match by company name ("Amazon" → AMZN with 80% confidence)
    - Test ticker miss (unknown ticker and company)
    - Test entity deduplication
    - Test metric resolution fallback from canonical_guess to raw_name
    - Test all 6 time period mappings
    - Test needs_computation correction when MetricResolution type is 'computed'
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9_

  - [x] 3.5 Rewire IntentDetectorService to use Haiku pipeline
    - [x] 3.5a Implement normalizeQuery() and regexFallback() as standalone private methods
      - Modify `src/rag/intent-detector.service.ts`
      - Implement `normalizeQuery(query: string): string` — trim, collapse whitespace, lowercase
      - Implement simplified `regexFallback(query: string): Promise<ValidatedQueryIntent>` using pattern `/(?:^|[\s,(.])([A-Z]{1,5})(?=[\s,.)!?\n]|$)/g` filtered against knownTickers set
      - Fallback defaults: timePeriod=LATEST_BOTH, queryType=single_metric, all boolean flags=false
      - These are standalone private methods — no wiring into detect() yet
      - _Requirements: 8.2, 8.3, 8.4_
    - [x] 3.5b Rewire detect() happy path: Haiku → validate → return
      - Replace existing `detectIntent()` internals with new `detect()` method
      - Inject HaikuIntentParserService and IntentValidatorService via constructor
      - Happy path only: normalize query → call Haiku parse → call validator → return ValidatedQueryIntent
      - No cache wiring yet (that's Session 0.5c), no fallback wiring yet (that's 3.5c)
      - Preserve backward compatibility: the detect() return type (ValidatedQueryIntent) must map to existing QueryIntent interface consumed by QueryRouter
      - _Requirements: 10.1, 10.2, 10.4_
    - [x] 3.5c Wire fallback activation on Haiku null return
      - In detect(), add conditional: if Haiku parse returns null, invoke regexFallback()
      - Log warning indicating Haiku failure and fallback activation
      - _Requirements: 8.1, 8.6_

  - [x] 3.6 Implement QueryIntent mapping layer
    - Add mapping function in IntentDetectorService or as a utility
    - Single ticker → string, multiple tickers → string array
    - Map queryType to QueryType enum (structured/semantic/hybrid) per design mapping table
    - Pass through needsNarrative, needsComputation, needsPeerComparison, originalQuery, timePeriod
    - When queryType is concept_analysis, ensure QueryRouterService still invokes ConceptRegistryService (no changes needed — just verify the mapping triggers existing behavior)
    - _Requirements: 10.1, 10.2, 15.1, 15.2, 15.3, 15.4, 15.5_

  - [x] 3.7 Register new services in RagModule
    - Modify `src/rag/rag.module.ts`
    - Add HaikuIntentParserService and IntentValidatorService as providers
    - _Requirements: 10.3_

  - [x] 3.8 Write property tests for regex fallback and QueryIntent mapping (Properties 8 and 9)
    - Create `test/properties/intent-fallback.property.spec.ts`
    - **Property 8: Regex Fallback Extracts Only Known Uppercase Tickers**
    - Generate random query strings with mixed-case words, verify fallback only extracts uppercase tokens in known tickers set
    - Verify fallback always sets timePeriod.periodType to "LATEST_BOTH" and queryType to "single_metric"
    - Create `test/properties/intent-mapping.property.spec.ts`
    - **Property 9: ValidatedQueryIntent Maps Correctly To QueryIntent**
    - Generate random ValidatedQueryIntent objects, verify mapping produces valid QueryIntent with correct ticker field type (string vs array), correct QueryType enum, and all pass-through fields preserved
    - Minimum 100 iterations per property
    - **Validates: Requirements 8.2, 8.4, 10.1, 10.2, 15.1, 15.2, 15.3, 15.4, 15.5**

  - [x] 3.9 Write unit tests for rewired IntentDetectorService
    - Create `test/unit/intent-detector-haiku.spec.ts`
    - Test T0.1-T0.8 (core extraction tests) with mocked Haiku responses
    - Test T0.2: "what is c's growth over past five years?" → C, Citigroup, range/5/years
    - Test T0.3: "compare amazon and nvidia roic and net sales over 5 years" → AMZN, NVDA, comparative
    - Test T0.4: "GAAP vs non-GAAP operating income for MSFT" → MSFT only
    - Test T0.5: "What did the 10-K say about risks?" → no tickers, narrative_only
    - Test T0.6: "How does ABNB compare to peers on margins?" → peer_benchmark
    - Test T0.8: "What is V's PE ratio?" → V (Visa), PE as metric
    - Test T0.11: Bedrock failure → regex fallback fires
    - Test fallback caching (fallback result is cached)
    - Test concept_analysis mapping: "how levered is ABNB?" produces ValidatedQueryIntent with queryType=concept_analysis that, when mapped to QueryIntent, produces type='hybrid' — verify this triggers ConceptRegistryService expansion in QueryRouter (mock QueryRouter to assert ConceptRegistryService.expand() is called)
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 3.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 8.1, 8.5, 8.6_

- [x] 4. Checkpoint — Session 0.5b gate
  - Ensure all tests pass, ask the user if questions arise.
  - Gate: T0.1-T0.8 all pass

- [x] 5. Session 0.5c: LRU Cache and Bedrock Fallback Hardening
  - [x] 5.1 Add LRU cache to IntentDetectorService (happy path caching)
    - Ensure `lru-cache` npm package is installed
    - Configure LRU cache: max=5000 entries, ttl=86400000ms (24 hours)
    - Implement `computeCacheKey(normalizedQuery: string): string` using SHA-256 hash (first 16 chars)
    - Wire cache check before Haiku call in detect() method
    - Wire cache set after successful Haiku + validation
    - Log "Cache HIT" on cache hits, log extracted tickers/metrics/queryType on cache misses
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 11.1, 11.2_

  - [x] 5.2 Add fallback result caching with shorter TTL
    - Wire cache set after fallback result to prevent re-calling Haiku for the same failing query
    - **Design decision**: Fallback-cached results use a shorter TTL of 5 minutes (300,000ms) instead of 24 hours. Rationale: if Bedrock comes back online after an outage, queries stuck with degraded regex results should recover quickly rather than being locked into the fallback for 24 hours. Implementation: use a separate LRU cache instance for fallback results, or tag entries with a `isFallback` flag and check TTL accordingly.
    - Log when a fallback result is served from cache vs a fresh fallback execution
    - _Requirements: 8.5, 11.4_

  - [x] 5.3 Write property tests for cache and normalization (Properties 6 and 7)
    - Create `test/properties/intent-cache.property.spec.ts`
    - **Property 6: Query Normalization Produces Same Key For Whitespace and Casing Variants**
    - Generate random query strings, create whitespace/casing variants, verify all produce same normalized form and cache key
    - **Property 7: Cache Returns Identical Result On Second Call**
    - Generate random queries, process through pipeline with mocked Haiku, verify second call returns identical result from cache
    - Minimum 100 iterations per property
    - **Validates: Requirements 7.1, 7.2, 7.5**

  - [x] 5.4 Write unit tests for cache behavior
    - Add to `test/unit/intent-detector-haiku.spec.ts`
    - Test T0.9: Run T0.1 twice, second call returns from cache, "Cache HIT" logged, identical result
    - Test T0.10: "ABNB revenue", "abnb revenue", "  ABNB  revenue  " all produce same cache key, only one Haiku call
    - Test cache TTL expiration (mock time advancement)
    - Test fallback result is cached with shorter TTL (5 min)
    - Test that after fallback TTL expires, a new Haiku call is attempted (Bedrock recovery scenario)
    - _Requirements: 7.2, 7.4, 7.5, 8.5, 11.1_

- [x] 6. Checkpoint — Session 0.5c gate
  - Ensure all tests pass, ask the user if questions arise.
  - Gate: Cache hit returns same QIO; Bedrock failure returns fallback result; fallback cache expires after 5 minutes

- [x] 7. Session 0.5d: Eval Dataset, Prompt Tuning, Integration Test, and Cost Monitoring
  - [x] 7.1 Create eval dataset test harness
    - Create `test/eval/haiku-intent-eval.spec.ts`
    - Load test cases from `FUNDLENS_EVAL_DATASET.md` covering 10 categories and 225 queries: company name resolution, lowercase tickers, single-letter tickers, metric/ticker ambiguity, natural language time periods, all 10 query types, peer comparison, narrative queries, concept analysis, multi-entity comparative queries
    - Each eval entry specifies: query string, expected tickers, expected metrics, expected query_type, expected time_period, expected boolean flags
    - Run each query through HaikuIntentParserService.parse() and compare against expected output
    - Report accuracy percentage and list failures grouped by category
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 7.2 Tune system prompt based on eval results
    - Run eval dataset, identify systematic failure patterns
    - Adjust system prompt rules, examples, and default interpretations
    - Re-run eval dataset after each prompt change
    - Iterate until accuracy >= 95% on the eval dataset
    - Update prompt version constant
    - _Requirements: 12.2, 12.3_

  - [ ] 7.3 ~~Add cost monitoring instrumentation via CloudWatch custom metrics~~ **DEFERRED** — Moved to a separate spec for centralized Bedrock cost monitoring across all model invocations (Haiku, Sonnet, Opus, KB retrieval) with per-tenant attribution.
    - _Requirements: 13.1, 13.2_

  - [x] 7.4 Write integration test with real Bedrock call
    - Create `test/integration/haiku-intent-e2e.spec.ts`
    - This test makes a REAL Bedrock API call (not mocked) to validate the end-to-end pipeline
    - Test with a known query: "What is AMZN's revenue?" — verify the full pipeline: Haiku extraction → validation → caching
    - Verify: correct model ID is used, Bedrock permissions work, prompt formatting produces valid JSON, validation layer enriches correctly, result is cached on second call
    - Mark test with `@slow` or equivalent tag so it's excluded from fast CI runs but included in pre-deployment validation
    - This catches configuration issues (wrong model ID, missing Bedrock permissions, prompt formatting issues) that unit tests with mocks will never find
    - _Requirements: 9.2, 10.1, 12.1_

- [x] 8. Final checkpoint — Ensure all tests pass (excluding deferred CloudWatch instrumentation)
  - Ensure all tests pass, ask the user if questions arise.
  - Gate: >= 95% accuracy on eval dataset, T0.1-T0.15 all pass, all property tests pass, integration test with real Bedrock call passes

## Notes

- Property tests are REQUIRED, not optional. The deterministic validation layer is the safety net that catches LLM non-determinism — skipping property tests on this layer defeats the architecture's purpose.
- Task 3.5 is split into 3 sub-tasks (3.5a, 3.5b, 3.5c) so each change to IntentDetectorService is independently testable and debuggable.
- Task 5.1 (happy path caching) and 5.2 (fallback caching) are separate because they have different TTL requirements: 24h for validated results, 5min for fallback results. This prevents queries from being stuck with degraded regex results after a Bedrock outage resolves.
- Task 7.1 references `FUNDLENS_EVAL_DATASET.md` as the source for the 225-query eval dataset — do not create a new dataset from scratch.
- Task 7.3 specifies CloudWatch custom metrics as the instrumentation approach, not just an in-memory counter that resets on restart.
- Task 7.4 is a real Bedrock integration test that catches configuration issues mocks will never find. Tag it for slow CI runs.
- Task 3.9 includes a concept_analysis → ConceptRegistryService test to verify the mapping triggers the existing expansion path in QueryRouter.
- Sessions follow the spec's implementation order: 0.5a → 0.5b → 0.5c → 0.5d
- Property tests use `fast-check` library with minimum 100 iterations
- Unit tests cover the Definition of Done test cases T0.1-T0.15
- The eval dataset (Session 0.5d) is the final deployment gate
