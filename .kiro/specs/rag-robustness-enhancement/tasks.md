# Implementation Plan: RAG Robustness Enhancement

## Overview

This plan systematically improves the RAG system to achieve 80%+ score on the enterprise-grade test suite. The approach is iterative: run tests, identify failures, implement fixes, and re-test until the target is reached.

The implementation is organized into 6 phases:
1. **Baseline & Infrastructure** - Establish baseline score and testing infrastructure
2. **Intent Detection Enhancements** - Improve fuzzy matching, normalization, and fallback logic
3. **Retrieval Enhancements** - Multi-company comparison, time-series analysis, advanced techniques
4. **Response Quality** - Confidence scoring, citations, error handling
5. **Performance Optimization** - Caching, parallel execution, model selection
6. **Iterative Refinement** - Run tests, analyze failures, implement fixes until 80%+ achieved

## Tasks

- [ ] 1. Baseline and Testing Infrastructure
  - [x] 1.1 Run enterprise test suite and establish baseline score
    - Execute `node scripts/test-enterprise-grade-rag.js`
    - Document current score by category
    - Identify top 5 failing test categories
    - _Requirements: 13.1, 14.1_
  
  - [x] 1.2 Set up property-based testing framework
    - Install `fast-check` library: `npm install --save-dev fast-check @types/fast-check`
    - Create test file structure: `test/properties/rag-robustness.properties.spec.ts`
    - Configure test runner for property tests
    - _Requirements: 13.1_
  
  - [x] 1.3 Create performance monitoring infrastructure
    - Add latency tracking to RAG service
    - Implement p95 calculation utility
    - Add performance warning logs for queries >5s
    - Create performance dashboard data export
    - _Requirements: 9.1, 9.5, 14.1_

- [ ] 2. Checkpoint - Review baseline results
  - Ensure baseline score is documented
  - Ensure test infrastructure is working
  - Ask the user if questions arise

- [ ] 3. Intent Detection Enhancements
  - [ ] 3.1 Implement fuzzy ticker matching
    - Install fuzzy matching library: `npm install fuzzball`
    - Create `fuzzyMatchTicker()` method in `intent-detector.service.ts`
    - Implement Levenshtein distance matching (threshold ≤ 2)
    - Add confidence scoring for fuzzy matches
    - _Requirements: 5.1, 11.1_
  
  - [ ] 3.2 Write property test for fuzzy ticker matching
    - **Property 8: Ticker Fuzzy Matching**
    - **Validates: Requirements 5.1**
  
  - [ ] 3.3 Expand company name resolution map
    - Add comprehensive company name → ticker mapping
    - Include common variations and abbreviations
    - Add phonetic matching for sound-alike names
    - _Requirements: 2.1, 11.1_
  
  - [ ] 3.4 Implement metric normalization
    - Create `METRIC_ALIASES` map for informal metric names
    - Add `normalizeMetricName()` method
    - Integrate with `extractMetrics()` method
    - _Requirements: 2.2, 11.1_
  
  - [ ] 3.5 Write property test for metric normalization
    - **Property 2: Derived Metric Computation**
    - **Validates: Requirements 1.2**
  
  - [ ] 3.6 Enhance multi-ticker detection
    - Modify `extractTicker()` to return array for multiple tickers
    - Update intent type definitions to support `string | string[]`
    - Add comparison query detection logic
    - _Requirements: 3.1, 11.4_
  
  - [ ] 3.7 Write property test for multi-ticker detection
    - **Property 26: Multi-Ticker Array Format**
    - **Validates: Requirements 11.4**
  
  - [ ] 3.8 Improve LLM fallback prompt
    - Enhance LLM prompt with better examples
    - Add explicit instructions for ambiguous queries
    - Test with sample ambiguous queries
    - _Requirements: 2.2, 11.2_
  
  - [ ] 3.9 Write property test for intent detection fallback chain
    - **Property 25: Intent Detection Fallback Chain**
    - **Validates: Requirements 11.1, 11.2, 11.3**

- [ ] 4. Checkpoint - Test intent detection improvements
  - Run enterprise test suite
  - Compare score to baseline
  - Ensure intent detection accuracy improved
  - Ask the user if questions arise

- [ ] 5. Multi-Company Comparison Engine
  - [ ] 5.1 Create ComparisonEngine class
    - Create new file: `src/rag/comparison-engine.service.ts`
    - Define interfaces: `ComparisonQuery`, `ComparisonResult`, `CompanyMetric`
    - Implement basic comparison logic
    - _Requirements: 3.2, 3.3, 3.4_
  
  - [ ] 5.2 Implement fiscal year alignment
    - Add fiscal year-end detection from database
    - Implement period overlap calculation
    - Add alignment notes to comparison results
    - _Requirements: 3.2_
  
  - [ ] 5.3 Implement data normalization
    - Add revenue-based normalization method
    - Add asset-based normalization method
    - Include normalization metadata in results
    - _Requirements: 3.2_
  
  - [ ] 5.4 Enhance comparison response formatting
    - Implement side-by-side data presentation
    - Add leader/laggard analysis
    - Calculate spread and spread percentage
    - Add explicit gap indicators for missing data
    - _Requirements: 3.4, 3.5_
  
  - [ ] 5.5 Write property test for multi-company comparison
    - **Property 6: Multi-Company Comparison**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
  
  - [ ] 5.6 Integrate ComparisonEngine with StructuredRetriever
    - Add comparison detection in query router
    - Call ComparisonEngine for multi-ticker queries
    - Update response builder for comparison format
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 6. Time-Series and Trend Analysis
  - [ ] 6.1 Create TrendAnalyzer class
    - Create new file: `src/rag/trend-analyzer.service.ts`
    - Define interfaces: `TimeSeriesQuery`, `TimeSeriesResult`, `TrendAnalysis`
    - Implement basic trend detection
    - _Requirements: 4.1, 4.2, 4.3_
  
  - [ ] 6.2 Implement growth rate calculations
    - Add YoY (year-over-year) growth calculation
    - Add QoQ (quarter-over-quarter) growth calculation
    - Handle edge cases (zero values, negative values)
    - _Requirements: 4.2_
  
  - [ ] 6.3 Implement inflection point detection
    - Add algorithm to detect significant growth rate changes (>20%)
    - Classify inflections: acceleration, deceleration, reversal
    - Generate descriptions for inflection points
    - _Requirements: 4.2_
  
  - [ ] 6.4 Implement volatility calculation
    - Calculate standard deviation of growth rates
    - Classify trend direction based on volatility
    - Generate trend summary
    - _Requirements: 4.3_
  
  - [ ] 6.5 Write property test for time-series analysis
    - **Property 7: Time-Series Retrieval and Analysis**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
  
  - [ ] 6.6 Integrate TrendAnalyzer with StructuredRetriever
    - Add trend detection in query router
    - Call TrendAnalyzer for historical queries
    - Update response builder for trend format
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 7. Checkpoint - Test comparison and trend analysis
  - Run enterprise test suite
  - Compare score to previous checkpoint
  - Ensure comparison and trend tests improved
  - Ask the user if questions arise

- [ ] 8. Edge Case Handling
  - [ ] 8.1 Create EdgeCaseHandler class
    - Create new file: `src/rag/edge-case-handler.service.ts`
    - Define interfaces: `TickerValidation`, `PeriodValidation`, `LengthValidation`
    - Implement validation methods
    - _Requirements: 5.1, 5.2, 5.5_
  
  - [ ] 8.2 Implement ticker validation
    - Add database lookup for exact match
    - Integrate fuzzy matching for typos
    - Generate suggestions for invalid tickers
    - _Requirements: 5.1_
  
  - [ ] 8.3 Implement period validation
    - Add regex patterns for valid periods
    - Validate year ranges (2000 to current+1)
    - Generate suggestions for invalid periods
    - _Requirements: 5.2_
  
  - [ ] 8.4 Write property test for period validation
    - **Property 9: Period Validation**
    - **Validates: Requirements 5.2**
  
  - [ ] 8.5 Implement query sanitization
    - Add whitespace normalization
    - Remove special characters
    - Handle encoding issues
    - _Requirements: 5.5_
  
  - [ ] 8.6 Implement length validation
    - Add max length check (1000 chars)
    - Implement truncation logic
    - Add warning for truncated queries
    - _Requirements: 5.5_
  
  - [ ] 8.7 Write property test for noise filtering
    - **Property 10: Noise Filtering**
    - **Validates: Requirements 5.5**
  
  - [ ] 8.8 Integrate EdgeCaseHandler with IntentDetector
    - Add validation before intent detection
    - Return validation errors early
    - Integrate fuzzy matching with ticker extraction
    - _Requirements: 5.1, 5.2, 5.5_

- [ ] 9. Deep Financial Analysis
  - [ ] 9.1 Implement ROIC calculation
    - Add ROIC formula: Net_Income / (Total_Assets - Total_Liabilities)
    - Retrieve required metrics from database
    - Include formula attribution in response
    - _Requirements: 6.1_
  
  - [ ] 9.2 Write property test for ROIC calculation
    - **Property 11: ROIC Calculation**
    - **Validates: Requirements 6.1**
  
  - [ ] 9.3 Implement FCF calculation
    - Add FCF formula: Operating_Cash_Flow - Capital_Expenditures
    - Retrieve required metrics from database
    - Handle missing Capital_Expenditures gracefully
    - _Requirements: 6.2_
  
  - [ ] 9.4 Write property test for FCF calculation
    - **Property 12: Free Cash Flow Calculation**
    - **Validates: Requirements 6.2**
  
  - [ ] 9.5 Implement leverage ratio calculations
    - Add debt-to-equity: Total_Liabilities / Total_Equity
    - Add debt-to-assets: Total_Liabilities / Total_Assets
    - Add interest coverage if available
    - _Requirements: 6.3_
  
  - [ ] 9.6 Write property test for leverage calculations
    - **Property 13: Leverage Ratio Calculation**
    - **Validates: Requirements 6.3**
  
  - [ ] 9.7 Implement asset efficiency calculations
    - Add asset turnover: Revenue / Total_Assets
    - Add working capital metrics
    - Add inventory turnover if available
    - _Requirements: 6.4_
  
  - [ ] 9.8 Write property test for asset efficiency
    - **Property 14: Asset Efficiency Calculation**
    - **Validates: Requirements 6.4**
  
  - [ ] 9.9 Integrate financial analysis with narrative context
    - Detect financial analysis queries in router
    - Retrieve both metrics and MD&A sections
    - Combine in response with clear attribution
    - _Requirements: 6.5_
  
  - [ ] 9.10 Write property test for financial analysis with narrative
    - **Property 15: Financial Analysis with Narrative Context**
    - **Validates: Requirements 6.5**

- [ ] 10. Checkpoint - Test financial analysis
  - Run enterprise test suite
  - Compare score to previous checkpoint
  - Ensure deep financial analysis tests improved
  - Ask the user if questions arise

- [ ] 11. Qualitative and Accounting Analysis
  - [ ] 11.1 Enhance section routing for qualitative queries
    - Add keyword patterns for competitive advantage queries
    - Add keyword patterns for risk queries
    - Add keyword patterns for market opportunity queries
    - Add keyword patterns for human capital queries
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  
  - [ ] 11.2 Implement multi-section retrieval for accounting queries
    - Detect accounting policy keywords
    - Retrieve BOTH Item 7 AND Item 8 sections
    - Merge results with section attribution
    - _Requirements: 8.1, 8.2, 8.3_
  
  - [ ] 11.3 Write property test for qualitative section retrieval
    - **Property 16: Qualitative Section Retrieval**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
  
  - [ ] 11.4 Write property test for accounting policy retrieval
    - **Property 17: Accounting Policy Multi-Section Retrieval**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5**
  
  - [ ] 11.5 Enhance citation generation for narratives
    - Include section type in citations
    - Include page numbers if available
    - Include filing type and period
    - Add excerpt highlighting
    - _Requirements: 7.5, 8.5_

- [ ] 12. Response Quality Enhancement
  - [ ] 12.1 Create ResponseQualityEnhancer class
    - Create new file: `src/rag/response-quality.service.ts`
    - Define interfaces: `ConfidenceScore`, `ReasoningExplanation`, `DataQualityIndicators`
    - Implement confidence calculation
    - _Requirements: 2.5, 12.1, 12.2_
  
  - [ ] 12.2 Implement confidence scoring
    - Calculate data availability score
    - Calculate retrieval quality score
    - Calculate generation quality score
    - Compute weighted overall confidence
    - _Requirements: 2.5_
  
  - [ ] 12.3 Implement reasoning explanation
    - Document approach taken for query
    - List data sources used
    - List assumptions made
    - List limitations identified
    - _Requirements: 12.1, 12.2_
  
  - [ ] 12.4 Implement data quality indicators
    - Track metrics quality (high/medium/low confidence)
    - Track narratives quality (avg relevance score)
    - Identify data gaps
    - _Requirements: 12.2_
  
  - [ ] 12.5 Implement graceful "no data found" handling
    - Build helpful message explaining what was searched
    - Generate suggestions for alternative queries
    - Include available periods/tickers
    - _Requirements: 12.2_
  
  - [ ] 12.6 Write property test for error messages
    - **Property 28: Specific Error Messages**
    - **Property 29: Helpful Not Found Messages**
    - **Validates: Requirements 12.1, 12.2**
  
  - [ ] 12.7 Implement error handling and fallbacks
    - Add LLM generation fallback to structured answer
    - Add error logging with details
    - Ensure system stability under errors
    - _Requirements: 12.3, 12.4, 12.5_
  
  - [ ] 12.8 Write property test for system stability
    - **Property 30: LLM Generation Fallback**
    - **Property 32: System Stability Under Errors**
    - **Validates: Requirements 12.3, 12.5**
  
  - [ ] 12.9 Integrate ResponseQualityEnhancer with RAGService
    - Add confidence scoring to all responses
    - Add reasoning explanation to responses
    - Add data quality indicators to responses
    - _Requirements: 2.5, 12.1, 12.2_

- [ ] 13. Checkpoint - Test response quality
  - Run enterprise test suite
  - Compare score to previous checkpoint
  - Ensure error handling and quality improved
  - Ask the user if questions arise

- [ ] 14. Performance Optimization
  - [x] 14.1 Create PerformanceOptimizer class
    - Create new file: `src/rag/performance-optimizer.service.ts`
    - Define interfaces for caching, parallel execution, model selection
    - Implement basic optimization logic
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  
  - [x] 14.2 Implement query result caching
    - Set up Redis connection (or in-memory cache)
    - Implement cache key generation
    - Implement TTL-based caching (1h for latest, 24h for historical)
    - Add cache hit/miss metrics
    - _Requirements: 9.2_
  
  - [ ] 14.3 Implement parallel execution for hybrid retrieval
    - Use Promise.all for structured + semantic retrieval
    - Measure latency improvement
    - Handle partial failures gracefully
    - _Requirements: 9.2_
  
  - [ ] 14.4 Implement smart LLM usage
    - Add logic to skip LLM for simple metric lookups
    - Add logic to skip LLM when no data found
    - Measure cost savings
    - _Requirements: 9.2, 9.4_
  
  - [ ] 14.5 Implement model tier selection
    - Add complexity assessment for queries
    - Select Haiku for simple, Sonnet for medium, Opus for complex
    - Measure latency and cost impact
    - _Requirements: 9.4_
  
  - [ ] 14.6 Write property test for model selection
    - **Property 18: Model Selection Optimization**
    - **Validates: Requirements 9.2, 9.4**
  
  - [ ] 14.7 Implement token budget management
    - Add token estimation for chunks
    - Enforce max token budget (e.g., 8000 tokens)
    - Sort chunks by relevance before truncation
    - _Requirements: 9.2_
  
  - [ ] 14.8 Optimize reranking for latency
    - Limit reranking to top N candidates (e.g., 20)
    - Set reranking timeout (1000ms)
    - Fallback to original scores on timeout
    - _Requirements: 9.3_
  
  - [ ] 14.9 Write property test for reranking latency
    - **Property 19: Reranking Latency Budget**
    - **Validates: Requirements 9.3**
  
  - [x] 14.10 Integrate PerformanceOptimizer with RAGService
    - Add caching layer
    - Enable parallel execution
    - Add smart LLM usage logic
    - Add model tier selection
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  
  - [ ] 14.11 Write property test for performance latency
    - **Property 3: Performance Latency Target**
    - **Validates: Requirements 1.5, 9.1, 9.5**

- [ ] 15. Checkpoint - Test performance optimization
  - Run enterprise test suite
  - Measure p95 latency
  - Ensure latency target met (<5s)
  - Ask the user if questions arise

- [ ] 16. Advanced Retrieval Optimization
  - [ ] 16.1 Optimize Query Decomposition
    - Add complexity threshold for decomposition
    - Limit sub-queries to 3-5
    - Measure latency impact
    - _Requirements: 10.1_
  
  - [ ] 16.2 Write property test for query decomposition
    - **Property 20: Query Decomposition for Complex Queries**
    - **Validates: Requirements 10.1**
  
  - [ ] 16.3 Optimize HyDE usage
    - Add confidence threshold for HyDE (< 0.7)
    - Measure retrieval quality improvement
    - Measure latency impact
    - _Requirements: 10.2_
  
  - [ ] 16.4 Write property test for HyDE
    - **Property 21: HyDE for Low Confidence Retrieval**
    - **Validates: Requirements 10.2**
  
  - [ ] 16.5 Optimize Contextual Expansion
    - Add token threshold for expansion (< 500 tokens)
    - Limit expansion to 2000 tokens max
    - Measure context quality improvement
    - _Requirements: 10.3_
  
  - [ ] 16.6 Write property test for contextual expansion
    - **Property 22: Contextual Expansion for Insufficient Context**
    - **Validates: Requirements 10.3**
  
  - [ ] 16.7 Optimize Iterative Retrieval
    - Add result count threshold (< 3 chunks)
    - Limit iterations to 2-3
    - Measure retrieval improvement
    - _Requirements: 10.4_
  
  - [ ] 16.8 Write property test for iterative retrieval
    - **Property 23: Iterative Retrieval for Insufficient Results**
    - **Validates: Requirements 10.4**
  
  - [ ] 16.9 Enable and test Reranking
    - Set ENABLE_RERANKING=true in environment
    - Test with sample queries
    - Measure relevance improvement
    - Measure latency impact
    - _Requirements: 10.5_
  
  - [ ] 16.10 Write property test for reranking
    - **Property 24: Reranking Integration**
    - **Validates: Requirements 10.5**

- [ ] 17. Checkpoint - Test advanced retrieval
  - Run enterprise test suite
  - Compare score to previous checkpoint
  - Ensure advanced retrieval improved results
  - Ask the user if questions arise

- [ ] 18. Iterative Refinement Phase 1
  - [ ] 18.1 Run full enterprise test suite
    - Execute `node scripts/test-enterprise-grade-rag.js`
    - Document score by category
    - Identify failing tests
    - _Requirements: 13.1, 14.1_
  
  - [ ] 18.2 Analyze failure patterns
    - Group failures by category
    - Identify common failure modes
    - Prioritize by impact (number of tests affected)
    - _Requirements: 14.1_
  
  - [ ] 18.3 Implement targeted fixes for top 3 failure patterns
    - Fix highest-impact issues first
    - Test fixes in isolation
    - Document changes
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  
  - [ ] 18.4 Re-run test suite and measure improvement
    - Execute test suite again
    - Compare score to previous run
    - Document improvement percentage
    - _Requirements: 13.1, 14.1_

- [ ] 19. Checkpoint - Review refinement progress
  - Check if score is ≥ 80%
  - If yes, proceed to final validation
  - If no, continue to next refinement phase
  - Ask the user if questions arise

- [ ] 20. Iterative Refinement Phase 2 (if needed)
  - [ ] 20.1 Analyze remaining failures
    - Focus on next 3 highest-impact issues
    - Identify root causes
    - Plan fixes
    - _Requirements: 14.1_
  
  - [ ] 20.2 Implement targeted fixes
    - Implement fixes for identified issues
    - Test in isolation
    - Document changes
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  
  - [ ] 20.3 Re-run test suite and measure improvement
    - Execute test suite again
    - Compare score to previous run
    - Document improvement percentage
    - _Requirements: 13.1, 14.1_

- [ ] 21. Checkpoint - Review refinement progress
  - Check if score is ≥ 80%
  - If yes, proceed to final validation
  - If no, continue to next refinement phase
  - Ask the user if questions arise

- [ ] 22. Iterative Refinement Phase 3 (if needed)
  - [ ] 22.1 Deep dive on remaining failures
    - Analyze each failing test individually
    - Identify specific issues
    - Plan targeted fixes
    - _Requirements: 14.1_
  
  - [ ] 22.2 Implement remaining fixes
    - Fix remaining issues
    - Test thoroughly
    - Document all changes
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  
  - [ ] 22.3 Final test suite run
    - Execute test suite
    - Verify score ≥ 80%
    - Document final score
    - _Requirements: 13.1, 14.1_

- [ ] 23. Final Validation and Documentation
  - [ ] 23.1 Run all property tests
    - Execute `npm test -- rag-robustness.properties`
    - Verify all properties pass (100 iterations each)
    - Document any failures
    - _Requirements: 13.1_
  
  - [ ] 23.2 Run performance benchmarks
    - Measure p95 latency across 1000 queries
    - Verify p95 < 5000ms
    - Document performance metrics
    - _Requirements: 9.1, 9.5_
  
  - [ ] 23.3 Verify edge case handling
    - Test empty queries
    - Test invalid tickers
    - Test invalid periods
    - Test excessively long queries
    - Verify graceful handling
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  
  - [ ] 23.4 Document final configuration
    - Document enabled advanced retrieval techniques
    - Document model selection strategy
    - Document caching configuration
    - Document performance optimizations
    - _Requirements: 14.1_
  
  - [ ] 23.5 Create deployment checklist
    - List environment variables needed
    - List feature flags to enable
    - List monitoring alerts to configure
    - List performance targets to track
    - _Requirements: 9.1, 9.5, 14.1_

- [ ] 24. Final checkpoint - Ensure all tests pass
  - Ensure enterprise test suite score ≥ 80%
  - Ensure all property tests pass
  - Ensure p95 latency < 5s
  - Ask the user if questions arise

## Notes

- All property tests are required for comprehensive validation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation and allow for course correction
- The iterative refinement phases (18-22) are flexible and may require more or fewer iterations
- Property tests validate universal correctness properties across many inputs (minimum 100 iterations each)
- Unit tests validate specific examples and edge cases
- The enterprise test suite serves as the acceptance test for production readiness
- Target: 80%+ overall score (Grade B or better) on enterprise test suite
