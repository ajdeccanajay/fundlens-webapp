# Implementation Plan: Intelligent Intent Detection System

## Overview

Refactor IntentDetectorService from a 1,306-line regex-based system to a three-layer detection architecture (regex fast-path → LRU cache → Claude 3.5 Haiku LLM). The LLM classifies intent, existing registries (MetricRegistryService, ConceptRegistryService) handle resolution. The RAG chatbot lives at workspace.html / research assistant.

## Tasks

- [x] 1. Create FastPathCache and CompanyTickerMapService
  - [x] 1.1 Create FastPathCache class with LRU cache, pattern normalization, and template substitution
    - Create `src/rag/intent-detection/fast-path-cache.ts`
    - Use `lru-cache` npm package (already in project or install)
    - Implement `normalizeToPattern()`, `lookup()`, `store()`, `invalidate()`, `getStats()`
    - Pattern normalization: replace tickers with {TICKER}, periods with {PERIOD}
    - Template substitution: inject actual values from current query into cached template
    - Max 5,000 entries
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 1.2 Write property tests for FastPathCache
    - **Property 3: Cache Pattern Normalization Idempotence**
    - **Property 4: Cache Template Substitution Correctness**
    - **Property 5: Cache Size Invariant**
    - **Validates: Requirements 4.3, 4.4, 4.5**

  - [x] 1.3 Create CompanyTickerMapService
    - Create `src/rag/intent-detection/company-ticker-map.service.ts`
    - NestJS injectable service, loads from database (tenant tracked tickers) + base reference JSON
    - `resolve(companyName)` → ticker, `resolveAll(query)` → ticker[]
    - Auto-refresh every hour
    - Base reference list: ~100 major public companies with common name variants (stored as JSON in the service, loaded from S3 in future)
    - _Requirements: 10.2, 10.4, 11.4_

  - [x] 1.4 Write unit tests for CompanyTickerMapService
    - Test resolve() with known company names
    - Test resolveAll() with queries containing multiple company names
    - Test that hardcoded companyMap is not used
    - _Requirements: 10.2, 10.4_

- [x] 2. Create LlmDetectionEngine
  - [x] 2.1 Create LlmDetectionEngine class with system prompt construction and response parsing
    - Create `src/rag/intent-detection/llm-detection-engine.ts`
    - `classify(query, contextTicker?)` → `LlmClassificationResult`
    - Build system prompt with metric display names from MetricRegistryService and concept triggers from ConceptRegistryService
    - Cache the system prompt, invalidate when registry rebuilds
    - Parse JSON response, validate schema, handle malformed responses
    - Use Claude 3.5 Haiku (us.anthropic.claude-3-5-haiku-20241022-v1:0), max_tokens: 500, temperature: 0.1
    - 3-second timeout
    - _Requirements: 1.2, 1.3, 1.5, 1.6, 5.1, 5.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 2.2 Write property test for LLM response schema validation
    - **Property 12: LLM Response Schema Validation**
    - Generate random JSON strings, verify parser produces valid result or throws
    - **Validates: Requirements 9.3**

  - [x] 2.3 Write unit tests for LlmDetectionEngine
    - Test system prompt contains metric display names and concept triggers
    - Test response parsing for each query type (metric, comparison, trend, qualitative, concept, ambiguous)
    - Test malformed JSON handling
    - Test timeout handling
    - _Requirements: 9.1, 9.3, 9.4_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Refactor IntentDetectorService with three-layer detection
  - [x] 4.1 Implement regexFastPath() method
    - Replace `detectWithRegex()` with `regexFastPath()`
    - Use preserved `extractTicker()`, `extractPeriod()`, `determinePeriodType()`
    - Resolve metrics via `MetricRegistryService.resolve()` — only accept "exact" confidence
    - Return confidence >= 0.9 only when single ticker + exact metric + explicit period
    - Multi-ticker → return confidence 0.5 immediately
    - Determine boolean flags from components (metrics present = structured, etc.) not keyword lists
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 6.6_

  - [x] 4.2 Implement post-LLM resolution pipeline
    - Create `resolveFromLlmResult()` method
    - Resolve raw metric phrases through MetricRegistryService.resolve()
    - Match concepts through ConceptRegistryService.matchConcept()
    - Set needsComputation = true when any resolved metric has type "computed"
    - Structural comparison detection: multiple tickers → needsComparison = true
    - Merge contextTicker with LLM-detected tickers
    - Use extractPeriod() as fallback for period extraction
    - Log unresolved metrics to MetricLearningService
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.2, 5.3, 5.4, 5.5_

  - [x] 4.3 Rewrite detectIntent() with three-layer flow
    - Layer 1: regexFastPath() — if confidence >= 0.9, return immediately
    - Layer 2: FastPathCache.lookup() — if cache hit, return with substituted values
    - Layer 3: LlmDetectionEngine.classify() → resolveFromLlmResult() — cache if confidence >= 0.8
    - Fallback: if LLM fails, use regex result with degraded confidence
    - Set needsClarification when confidence < 0.7
    - Log every detection to IntentAnalyticsService with new method types
    - Preserve method signature: detectIntent(query, tenantId?, contextTicker?)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 11.1, 11.2, 11.3, 11.5, 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 4.4 Write property tests for detection flow
    - **Property 1: Detection Layer Ordering**
    - **Property 2: Fast-Path Confidence Correctness**
    - **Property 6: Multi-Ticker Implies Comparison**
    - **Property 7: Peer Comparison Detection**
    - **Property 9: QueryIntent Output Invariants**
    - **Property 10: Low Confidence Triggers Clarification**
    - **Property 11: Graceful Degradation on Total Failure**
    - **Property 15: ContextTicker Merging**
    - **Property 17: Confidence Selection Between LLM and Regex**
    - **Validates: Requirements 1.1, 2.1, 3.1, 3.2, 8.3, 8.4, 8.5, 12.1, 12.2, 12.3, 12.5**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Create IntentFeedbackService and extend analytics
  - [x] 6.1 Create IntentFeedbackService
    - Create `src/rag/intent-detection/intent-feedback.service.ts`
    - NestJS injectable service
    - `logLowConfidence()` — logs to IntentAnalyticsService when confidence < 0.7
    - `logCorrection()` — logs correction pair, invalidates cache entry
    - `logMetricSuggestionSelected()` — logs to MetricLearningService, invalidates cache
    - `logUnresolvedMetric()` — forwards to MetricLearningService
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 6.2 Extend IntentAnalyticsService with new detection methods
    - Update `detectionMethod` type to include 'regex_fast_path' | 'cache_hit' | 'llm' | 'fallback'
    - Add `detectionPath` field to log full detection path (e.g., "fast_path_miss → cache_miss → llm")
    - Extend `getRealtimeMetrics()` to include: fast-path hit rate, cache hit rate, LLM invocation rate, correction rate, estimated monthly LLM cost
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 6.3 Write property tests for feedback and analytics
    - **Property 8: Metric Resolution Delegation** (unresolved metrics logged to MetricLearningService)
    - **Property 13: Cache Invalidation on Correction**
    - **Property 14: Analytics Logging Completeness**
    - **Validates: Requirements 5.2, 5.4, 4.6, 7.4, 10.1**

- [x] 7. Delete legacy code
  - [x] 7.1 Remove hardcoded keyword lists and regex classification methods
    - Delete `needsComparison()` method
    - Delete `needsPeerComparison()` method
    - Delete `needsTrend()` method
    - Delete `needsComputation()` method
    - Delete `needsNarrative()` and `hasNarrativeKeywords()` methods
    - Delete `identifyItem1Subsection()`, `identifyItem7Subsection()`, `identifyItem8Subsection()`, `identifyItem1ASubsection()` methods
    - Delete `detectWithRegex()` method (replaced by regexFastPath)
    - Delete `detectWithLLM()` method (replaced by LlmDetectionEngine)
    - Delete `detectGenericWithRegexFallback()` method
    - Delete `determineQueryType()` method
    - Delete `extractMetrics()` and `extractMetricCandidates()` methods
    - Delete `isAmbiguous()` method
    - Delete `calculateConfidence()` method
    - Delete hardcoded `companyMap` from `extractTickersFromQuery()`
    - Preserve: `extractTicker()`, `extractTickersFromQuery()`, `extractPeriod()`, `determinePeriodType()`
    - Preserve: `detectIntent()` method signature
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_

- [x] 8. Wire everything together and register modules
  - [x] 8.1 Create IntentDetectionModule and wire dependencies
    - Create `src/rag/intent-detection/intent-detection.module.ts` if needed, or register new services in existing RAG module
    - Register FastPathCache, CompanyTickerMapService, IntentFeedbackService
    - Inject LlmDetectionEngine into IntentDetectorService
    - Ensure IntentDetectorService constructor accepts new dependencies
    - Update any module imports/exports
    - _Requirements: 8.1, 8.2_

  - [x] 8.2 Write integration tests for full detection flow
    - Test simple query → regex fast-path (no LLM call)
    - Test complex query → LLM classification → metric resolution
    - Test cache warming: first query invokes LLM, second hits cache
    - Test multi-ticker comparison detection
    - Test concept query → ConceptRegistryService delegation
    - Test graceful degradation when LLM fails
    - Test computed metric detection (needsComputation set correctly)
    - _Requirements: 1.1, 3.1, 4.1, 5.2, 5.3, 6.1, 12.1_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The LLM is a classifier only — metric resolution always goes through MetricRegistryService
- Concept matching always goes through ConceptRegistryService
- The RAG chatbot is at workspace.html / research assistant
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases using Vitest
