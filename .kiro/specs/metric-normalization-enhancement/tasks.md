# Implementation Plan: Metric Normalization Enhancement

## Overview

This implementation plan breaks down the metric normalization enhancement into discrete, incremental tasks. The plan follows a 4-phase deployment strategy: (1) Enhanced YAML (tonight), (2) MetricMappingService (week 2), (3) Semantic Matcher (week 3), (4) Query Learning (week 4).

**Key Principles**:
- Each task builds on previous tasks
- Incremental validation through tests
- Zero data loss (preserve all existing metrics)
- Backward compatibility maintained throughout

---

## Tasks

- [ ] 1. Database Analysis and Synonym Extraction (COMPLETED)
  - Script created: `scripts/analyze-database-metrics.js`
  - Output: `database-metrics-analysis.json` with 25,255 normalized metrics
  - _Requirements: TR-3_

- [ ] 2. Merge and Enhance YAML Configuration
  - [ ] 2.1 Create backup of existing YAML files
    - Backup `metric_mapping.yaml` to `metric_mapping.yaml.backup`
    - Backup `metric_mapping_enhanced.yaml` to `metric_mapping_enhanced.yaml.backup`
    - _Requirements: BR-3.1_
  
  - [ ] 2.2 Merge existing YAML files
    - Load both `metric_mapping.yaml` (40 metrics) and `metric_mapping_enhanced.yaml` (50 metrics)
    - Deduplicate metrics by ID (keep enhanced version if duplicate)
    - Merge synonyms for duplicate metrics (union of all synonyms)
    - Validate: all 90 unique metrics preserved
    - _Requirements: BR-3.1_
  
  - [ ] 2.3 Add all 117 metrics from Excel (listed in requirements.md)
    - Extract metric list from requirements document
    - For each metric, create YAML entry with:
      - id, name, canonical_name, statement_type, period_type
      - synonyms (primary + industry_specific)
      - taxonomy_tags (us_gaap priority + company_specific)
      - semantic_hints, fuzzy_matches, related_metrics
    - Add company-specific XBRL tags for AAPL, MSFT, GOOGL, AMZN, META, TSLA, NVDA
    - _Requirements: BR-1.1, TR-1_
  
  - [ ] 2.4 Extract and add synonyms from database analysis
    - Parse `database-metrics-analysis.json`
    - For each normalized metric with >100 occurrences, extract raw labels as synonyms
    - Group by ticker to identify company-specific variations
    - Add to appropriate metric's synonyms section
    - Target: 500+ synonyms per major metric
    - _Requirements: BR-1.1, TR-1_
  
  - [ ] 2.5 Add industry-specific synonym variations
    - For each industry (tech, banking, insurance, healthcare, energy, media, telecom, real_estate, utilities, retail, manufacturing):
      - Add industry-specific synonyms to relevant metrics
      - Example: "claims paid" → cost_of_revenue (insurance)
      - Example: "net interest income" → revenue (banking)
    - _Requirements: BR-1.2, BR-1.4_
  
  - [ ] 2.6 Validate merged YAML
    - Check: no duplicate metric IDs
    - Check: all synonyms are unique per metric (case-insensitive)
    - Check: all XBRL tags follow valid format (namespace:ElementName)
    - Check: all industry names are valid
    - Check: all ticker symbols are valid
    - Check: at least 117 metrics present
    - _Requirements: BR-1.1, BR-3.1_
  
  - [ ] 2.7 Write unit tests for YAML validation
    - Test: all 117+ metrics from Excel are present
    - Test: all metrics from original YAMLs are preserved
    - Test: no duplicate metric IDs
    - Test: all synonyms are unique per metric
    - Test: all XBRL tags are valid format
    - **Property 6: Data Preservation**
    - **Validates: Requirements BR-3.1**
  
  - [ ] 2.8 Deploy enhanced YAML to production
    - Copy enhanced YAML to production path
    - Restart services to reload configuration
    - Monitor query success rate (should increase from 80% to 95%+)
    - _Requirements: BR-1.1, BR-3.1_

- [ ] 3. Checkpoint - Verify YAML Enhancement
  - Ensure all tests pass, verify query success rate increased, ask the user if questions arise.

- [ ] 4. Implement MetricMappingService (TypeScript)
  - [ ] 4.1 Create MetricMappingService class
    - Location: `src/rag/metric-mapping.service.ts`
    - Implement OnModuleInit to load YAML at startup
    - Define interfaces: MetricMatch, MetricConfig, MetricIndex
    - _Requirements: TR-2_
  
  - [ ] 4.2 Implement YAML loading and parsing
    - Load enhanced YAML using `js-yaml` library
    - Parse into MetricConfig objects
    - Validate schema (all required fields present)
    - Log metrics count and total synonyms
    - _Requirements: TR-2_
  
  - [ ] 4.3 Build hash table index for exact matching
    - Create Map<string, string> (normalized synonym → metricId)
    - Normalize all keys: lowercase, trim, remove special chars
    - Index all primary synonyms
    - Index all industry-specific synonyms
    - Index all fuzzy_matches
    - Target: O(1) lookup performance
    - _Requirements: TR-2, BR-4.1_
  
  - [ ] 4.4 Implement exact match resolution
    - Method: `resolveExact(query: string): MetricMatch | null`
    - Normalize query (lowercase, trim)
    - Lookup in hash table
    - Return: { metricId, confidence: 1.0, method: 'exact', matchedSynonym, canonicalName }
    - _Requirements: FR-1, BR-4.1_
  
  - [ ] 4.5 Implement LRU cache for learned queries
    - Use `lru-cache` library (1000 entries max)
    - Method: `resolveLearned(query: string): MetricMatch | null`
    - Cache key: normalized query
    - Cache value: MetricMatch
    - _Requirements: FR-1, BR-4.3_
  
  - [ ] 4.6 Implement main resolve method with fallback logic
    - Method: `resolve(query: string, ticker?: string): Promise<MetricMatch | null>`
    - Layer 1: Try exact match → return if found
    - Layer 2: Try learned cache → return if found
    - Layer 3: Try semantic matcher (placeholder for now) → return if found
    - Return null if no match
    - _Requirements: FR-1_
  
  - [ ] 4.7 Implement explainMatch method
    - Method: `explainMatch(query: string, metricId: string): Promise<ExplanationResult>`
    - Show: query, metricId, confidence, matchedSynonym, canonicalName, method
    - _Requirements: FR-4_
  
  - [ ] 4.8 Implement getSynonyms helper method
    - Method: `getSynonyms(metricId: string): string[]`
    - Return all synonyms for a metric (for debugging)
    - _Requirements: FR-4_
  
  - [ ] 4.9 Implement reloadConfig method
    - Method: `reloadConfig(): Promise<void>`
    - Reload YAML from disk
    - Rebuild hash table index
    - Clear learned cache
    - _Requirements: TR-2_
  
  - [ ] 4.10 Write unit tests for MetricMappingService
    - Test: load YAML configuration successfully
    - Test: build hash table with all synonyms
    - Test: exact match returns correct metric
    - Test: exact match is case-insensitive
    - Test: learned query cache hit returns cached result
    - Test: invalid input returns null
    - Test: explain match returns complete explanation
    - Test: reload config updates hash table
    - **Property 3: Abbreviation Resolution**
    - **Property 7: Backward Compatibility**
    - **Property 12: Explainability Completeness**
    - **Validates: Requirements BR-2.3, BR-3.2, FR-4**

- [ ] 5. Integrate MetricMappingService with Intent Detector
  - [ ] 5.1 Update Intent Detector to use MetricMappingService
    - Location: `src/rag/intent-detector.service.ts`
    - Inject MetricMappingService via constructor
    - In `detectIntent()`, call `metricMappingService.resolve(metricQuery, ticker)`
    - Use returned metricId in Intent object
    - Include confidence and method in Intent object
    - _Requirements: FR-1_
  
  - [ ] 5.2 Update Intent interface to include metric match details
    - Add fields: metricId, confidence, method
    - Ensure backward compatibility (existing code still works)
    - _Requirements: BR-3.5_
  
  - [ ] 5.3 Write integration tests for Intent Detector
    - Test: user query → Intent Detector → MetricMappingService → correct metricId
    - Test: query with ticker → industry-aware matching
    - Test: typo query → semantic matcher → correct result (placeholder)
    - Test: backward compatibility with existing queries
    - **Property 7: Backward Compatibility**
    - **Validates: Requirements BR-3.2, BR-3.4**

- [ ] 6. Checkpoint - Verify MetricMappingService Integration
  - Ensure all tests pass, verify Intent Detector uses normalized metric IDs, ask the user if questions arise.

- [ ] 7. Implement Semantic Matcher (Python)
  - [ ] 7.1 Install required Python dependencies
    - Add to `requirements.txt`: sentence-transformers, numpy, pyyaml
    - Run: `pip install -r requirements.txt`
    - _Requirements: TR-4_
  
  - [ ] 7.2 Complete semantic matcher implementation
    - Location: `python_parser/xbrl_parsing/semantic_matcher.py` (skeleton exists)
    - Implement `_build_index()` method:
      - Load all metrics from YAML
      - Extract all synonyms (primary + industry_specific + semantic_hints + fuzzy_matches)
      - Encode all texts using SentenceTransformer('all-MiniLM-L6-v2')
      - Store embeddings in numpy array
      - Cache to disk: `metric_embeddings.pkl`
    - _Requirements: TR-4_
  
  - [ ] 7.3 Implement semantic matching with cosine similarity
    - Method: `match(query, top_k, threshold, industry)`
    - Encode query using model
    - Compute cosine similarity with all metric embeddings
    - Sort by similarity descending
    - Filter by threshold (default 0.7)
    - Return top-K unique metrics (avoid duplicates)
    - _Requirements: TR-4, BR-2.1, BR-2.2_
  
  - [ ] 7.4 Implement industry-aware boosting
    - If industry provided, boost matches with industry-specific synonyms by 1.2x
    - If ticker provided, boost matches with company-specific XBRL tags by 1.3x
    - Re-sort by boosted confidence
    - _Requirements: FR-2, BR-2.4_
  
  - [ ] 7.5 Implement query caching
    - Cache query results in memory (dict)
    - Cache key: f"{query.lower()}:{industry}"
    - Cache value: list of matches
    - _Requirements: BR-4.2_
  
  - [ ] 7.6 Implement CLI interface for testing
    - Accept command-line args: query, ticker (optional)
    - Output JSON: { query, ticker, matches: [{ metric_id, confidence, canonical_name, matched_via }] }
    - Handle errors gracefully (return JSON with error field)
    - _Requirements: TR-4_
  
  - [ ] 7.7 Pre-compute and cache embeddings
    - Run semantic matcher once to build embeddings
    - Verify `metric_embeddings.pkl` created
    - Verify cold start time <200ms
    - _Requirements: BR-4.4_
  
  - [ ] 7.8 Write unit tests for semantic matcher
    - Test: load model and embeddings successfully
    - Test: build embedding index from YAML
    - Test: match query returns top-K results
    - Test: confidence scores are between 0 and 1
    - Test: results are sorted by confidence descending
    - Test: industry boosting increases confidence
    - Test: company-specific tags boost confidence
    - Test: cache hit returns cached result
    - Test: explain match returns correct information
    - **Property 1: Typo Tolerance**
    - **Property 2: Paraphrase Recognition**
    - **Property 4: Industry-Specific Terminology**
    - **Property 10: Industry-Aware Boosting**
    - **Property 13: Semantic Matcher Output Format**
    - **Validates: Requirements BR-2.1, BR-2.2, BR-2.4, FR-2, TR-4**

- [ ] 8. Integrate Semantic Matcher with MetricMappingService
  - [ ] 8.1 Implement subprocess pool for semantic matcher
    - Use Node.js `child_process.spawn()` to create Python subprocess
    - Pool size: 2-4 processes (reuse for multiple queries)
    - Timeout: 5 seconds per query
    - _Requirements: TR-4_
  
  - [ ] 8.2 Implement semantic match resolution in MetricMappingService
    - Method: `resolveSemantic(query: string, ticker?: string): Promise<MetricMatch | null>`
    - Call Python subprocess: `python semantic_matcher.py "${query}" "${ticker}"`
    - Parse JSON output
    - Return top match if confidence ≥ 0.7
    - _Requirements: FR-1, BR-2.1, BR-2.2_
  
  - [ ] 8.3 Update main resolve method to use semantic matcher
    - Layer 3: Call `resolveSemantic()` if exact and learned fail
    - Return semantic match if found
    - _Requirements: FR-1_
  
  - [ ] 8.4 Implement error handling and fallback
    - Catch subprocess errors (crash, timeout, invalid JSON)
    - Log error with query details
    - Fall back to returning null (graceful degradation)
    - _Requirements: NFR-2_
  
  - [ ] 8.5 Write integration tests for semantic matching
    - Test: typo query → semantic matcher → correct metric
    - Test: paraphrase query → semantic matcher → correct metric
    - Test: industry-specific query with ticker → boosted confidence
    - Test: subprocess error → graceful fallback
    - Test: subprocess timeout → graceful fallback
    - **Property 1: Typo Tolerance**
    - **Property 2: Paraphrase Recognition**
    - **Property 4: Industry-Specific Terminology**
    - **Property 14: Graceful Degradation**
    - **Validates: Requirements BR-2.1, BR-2.2, BR-2.4, NFR-2**

- [ ] 9. Checkpoint - Verify Semantic Matching Integration
  - Ensure all tests pass, verify typo and paraphrase queries work, ask the user if questions arise.

- [ ] 10. Implement Query Learning System
  - [ ] 10.1 Create SQLite database schema
    - Location: `python_parser/xbrl_parsing/query_feedback.db`
    - Table: query_feedback (id, query, metric_id, ticker, confidence, user_accepted, timestamp)
    - Indexes: idx_query, idx_metric
    - _Requirements: FR-3_
  
  - [ ] 10.2 Implement query recording in MetricMappingService
    - Method: `recordQuery(query, metricId, ticker, confidence, accepted)`
    - Call Python script: `python record_query.py "${query}" "${metricId}" "${ticker}" ${confidence}`
    - Record after successful resolution with confidence ≥ 0.7
    - Non-blocking (don't wait for response)
    - _Requirements: FR-3_
  
  - [ ] 10.3 Implement learned query loading at startup
    - Query database for queries with ≥5 successful uses
    - Load into LRU cache
    - Log count of learned queries
    - _Requirements: FR-3_
  
  - [ ] 10.4 Create synonym suggestion tool
    - Script: `python_parser/xbrl_parsing/suggest_synonyms.py`
    - Query database for queries with ≥5 uses and confidence ≥0.8
    - Output: list of suggested synonyms to add to YAML
    - Format: { query, metric_id, confidence, occurrences, action: 'add_synonym' }
    - _Requirements: FR-3_
  
  - [ ] 10.5 Write unit tests for query learning
    - Test: successful query is recorded in database
    - Test: learned queries are loaded at startup
    - Test: synonym suggestions are generated correctly
    - Test: database errors don't crash service
    - **Property 11: Query Learning Persistence**
    - **Validates: Requirements FR-3**

- [ ] 11. End-to-End Testing and Validation
  - [ ] 11.1 Write E2E tests for complete query flow
    - Test: user query → Intent Detector → MetricMappingService → Structured Retriever → result
    - Test: AAPL "cost of goods sold" → "cost_of_revenue" → database result
    - Test: MSFT "revenue" → "revenue" → database result
    - Test: JPM "net interest income" → "revenue" (banking) → database result
    - Test: typo "cost of good sold" → semantic match → correct result
    - Test: successful query → recorded in learning database
    - Test: repeated query → served from learned cache
    - **Property 5: Overall Accuracy**
    - **Property 9: Fallback Order**
    - **Validates: Requirements BR-2.5, FR-1**
  
  - [ ] 11.2 Write property-based tests for performance
    - Generate 10,000 mixed queries (85% exact, 12% semantic, 3% learned)
    - Measure latency for each query
    - Calculate p50, p95, p99 latencies
    - Assert: p95 < 5ms
    - **Property 8: Performance P95 Latency**
    - **Validates: Requirements BR-4.5**
  
  - [ ] 11.3 Write property-based tests for accuracy
    - Load test set of 1000+ queries with known correct answers
    - Run each query through system
    - Calculate accuracy (correct metric ID as top result)
    - Assert: accuracy ≥ 99%
    - **Property 5: Overall Accuracy**
    - **Validates: Requirements BR-2.5**
  
  - [ ] 11.4 Write load tests
    - Simulate 1000 queries/second for 60 seconds
    - Measure p95 latency, error rate, memory usage
    - Assert: p95 < 5ms, error rate < 1%, memory < 200MB
    - **Property 15: Load Handling**
    - **Validates: Requirements NFR-4**
  
  - [ ] 11.5 Write backward compatibility tests
    - Load production query logs (last 30 days)
    - Run all queries through enhanced system
    - Compare results with original system
    - Assert: all queries that worked before still work
    - **Property 7: Backward Compatibility**
    - **Validates: Requirements BR-3.2, BR-3.4**

- [ ] 12. Checkpoint - Verify All Tests Pass
  - Ensure all unit, integration, property, and E2E tests pass, ask the user if questions arise.

- [ ] 13. Documentation and Deployment
  - [ ] 13.1 Update CHANGELOG.md
    - Add entry for metric normalization enhancement
    - List: 117+ metrics, 500+ synonyms, semantic matching, query learning
    - Note: backward compatible, no breaking changes
    - _Requirements: NFR-3_
  
  - [ ] 13.2 Create deployment runbook
    - Document: deployment steps, rollback procedure, monitoring
    - Include: feature flag configuration, subprocess pool sizing
    - _Requirements: Deployment Strategy_
  
  - [ ] 13.3 Deploy to production with feature flag
    - Enable MetricMappingService for 10% of traffic
    - Monitor: query success rate, latency, error rate
    - Ramp to 100% if metrics look good
    - _Requirements: Deployment Strategy_
  
  - [ ] 13.4 Monitor and validate production metrics
    - Track: query success rate (target: >99%)
    - Track: query latency p95 (target: <5ms)
    - Track: semantic matcher error rate (target: <1%)
    - Track: no-match rate (target: <2%)
    - Set up alerts for anomalies
    - _Requirements: Deployment Strategy_

- [ ] 14. Final Checkpoint - Production Validation
  - Ensure production metrics meet targets, verify no regressions, ask the user if questions arise.

---

## Notes

- All tasks are required for enterprise-grade quality
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The implementation follows the 4-phase deployment strategy from the design document

---

## Estimated Timeline

- **Phase 1 (Tonight)**: Tasks 1-3 (YAML enhancement) - 2-4 hours
- **Phase 2 (Week 2)**: Tasks 4-6 (MetricMappingService) - 2-3 days
- **Phase 3 (Week 3)**: Tasks 7-9 (Semantic Matcher) - 2-3 days
- **Phase 4 (Week 4)**: Tasks 10-14 (Query Learning + Testing) - 2-3 days

**Total**: ~2 weeks for full implementation and testing

