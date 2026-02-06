# Implementation Plan: Confidence Threshold Fix & Ambiguity Detection

## Overview

This implementation plan addresses two critical issues:
1. **Technical Bug Fix**: Fix boundary condition where queries with exactly 0.7 confidence fail (3 lines changed)
2. **UX Enhancement**: Add ambiguity detection and comprehensive clarification prompts for equity analyst queries

The implementation is divided into phases to minimize risk and allow for incremental validation.

**Note on Phase 6 & Phase 7**: These phases (Analytics and Monitoring, Backward Compatibility Testing) are marked as OPTIONAL and can be implemented later as part of this project. They are enhancements that provide additional monitoring capabilities and regression testing, but are not critical for the core functionality. The decision to defer these phases allows us to focus on delivering the critical bug fix and UX improvements first, with the option to add comprehensive analytics and backward compatibility validation in a future iteration.

## Tasks

- [x] 1. Phase 1: Fix Boundary Condition Bug (Immediate - P0)
  - [x] 1.1 Fix confidence threshold in IntentDetectorService
    - Change line 78 from `if (regexIntent.confidence > 0.7)` to `if (regexIntent.confidence >= 0.7)`
    - Add comment explaining the fix
    - _Requirements: 1.1, 1.2_
  
  - [x] 1.2 Fix failure tracking threshold in IntentAnalyticsService
    - Change line 91 from `if (!params.success || params.confidence < 0.6)` to `if (!params.success || params.confidence <= 0.6)`
    - Change line 172 SQL query from `confidence < 0.6` to `confidence <= 0.6`
    - _Requirements: 1.3, 1.4_
  
  - [x] 1.3 Write unit tests for boundary condition fix
    - Test query with exactly 0.7 confidence is accepted
    - Test query with 0.69 confidence falls back to LLM
    - Test query with 0.71 confidence uses regex
    - Test analytics tracks 0.6 confidence as failure
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [x] 1.4 Write property test for confidence threshold handling
    - **Property 1: Confidence Threshold Boundary Handling**
    - **Validates: Requirements 1.1, 1.2**
    - Generate random ticker-only queries
    - Verify all queries with confidence >= 0.7 are accepted
    - Verify all queries with confidence < 0.7 fall back to LLM
    - Run 100 iterations
    - _Requirements: 1.1, 1.2_
  
  - [x] 1.5 Write property test for failure tracking consistency
    - **Property 3: Failure Tracking Consistency**
    - **Validates: Requirements 1.3**
    - Generate random queries with various confidence scores
    - Verify queries with confidence <= 0.6 are tracked as failures
    - Run 100 iterations
    - _Requirements: 1.3_

- [x] 2. Phase 2: Add Ambiguity Detection
  - [x] 2.1 Add needsClarification field to QueryIntent interface
    - Update `src/rag/types/query-intent.ts`
    - Add `needsClarification?: boolean` field
    - Add `ambiguityReason?: string` field for debugging
    - _Requirements: 2.3_
  
  - [x] 2.2 Implement isAmbiguous() method in IntentDetectorService
    - Add method to check for ambiguous queries
    - Check for ticker-only queries (confidence 0.7)
    - Check for generic words (about, information, show me, tell me, etc.)
    - Check for no specific metrics or sections
    - Return true if all conditions met
    - _Requirements: 2.1, 2.2_
  
  - [x] 2.3 Integrate ambiguity check into detection flow
    - After threshold check (confidence >= 0.7), call isAmbiguous()
    - If ambiguous, force LLM detection and set needsClarification = true
    - If not ambiguous, use regex intent (fast path)
    - Log ambiguity detection for monitoring
    - _Requirements: 2.1, 2.2, 2.3_
  
  - [x] 2.4 Write unit tests for ambiguity detection
    - Test "Tell me about NVDA" is marked ambiguous
    - Test "Show me MSFT" is marked ambiguous
    - Test "AAPL information" is marked ambiguous
    - Test "NVDA revenue" is NOT marked ambiguous
    - Test "NVDA's risk factors" is NOT marked ambiguous
    - _Requirements: 2.1, 2.2, 2.3_
  
  - [x] 2.5 Write property test for ambiguity detection
    - **Property 4: Ambiguity Detection for Ticker-Only Queries**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - Generate random ticker-only queries with generic words
    - Verify all are marked as ambiguous
    - Generate random queries with specific metrics/sections
    - Verify none are marked as ambiguous
    - Run 100 iterations
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 3. Phase 3: Implement Clarification Prompt Generation
  - [x] 3.1 Add clarification check in RAGService.query()
    - Check if intent.needsClarification is true
    - If true, call generateClarificationPrompt() and return
    - If false, proceed with normal query processing
    - _Requirements: 2.4_
  
  - [x] 3.2 Implement generateClarificationPrompt() method
    - Extract ticker from intent
    - Build suggestion categories (Financial Performance, Business & Strategy, etc.)
    - Add industry-specific suggestions based on ticker
    - Format clarification message
    - Return RAGResponse with clarification prompt
    - _Requirements: 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
  
  - [x] 3.3 Implement getIndustrySpecificQueries() method
    - Map tickers to industries (tech, SaaS, retail, healthcare)
    - Return industry-specific query suggestions
    - For tech: R&D spending, chip architecture, process node, ASP trends
    - For SaaS: ARR growth, net retention, CAC, churn rate
    - For retail: same-store sales, e-commerce penetration, fulfillment costs
    - For healthcare: drug pipeline, patent expirations, clinical trials
    - _Requirements: 4.7_
  
  - [x] 3.4 Implement formatClarificationMessage() method
    - Format message with ticker and "What would you like to know?"
    - Add all 8 suggestion categories with icons
    - Add subcategories for Financial Performance
    - Add quick actions (dashboard, latest 10-K, key metrics)
    - Return formatted markdown string
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
  
  - [x] 3.5 Write unit tests for clarification prompt generation
    - Test clarification prompt is generated for ambiguous query
    - Test all 8 categories are present in prompt
    - Test Financial Performance has 3 subcategories
    - Test industry-specific queries for NVDA (tech)
    - Test industry-specific queries for CRM (SaaS)
    - Test industry-specific queries for AMZN (retail)
    - Test industry-specific queries for JNJ (healthcare)
    - _Requirements: 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.7_
  
  - [x] 3.6 Write property test for clarification prompt generation
    - **Property 5: Clarification Prompt Generation**
    - **Validates: Requirements 2.4, 3.1-3.8**
    - Generate random ambiguous queries for various tickers
    - Verify clarification prompt is generated
    - Verify all 8 categories are present
    - Run 100 iterations
    - _Requirements: 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Phase 4: Comprehensive Query Pattern Testing (MAXIMIZED)
  - [x] 5.1 Write property tests for financial performance queries
    - **Property 6: Financial Performance Query Support**
    - **Validates: Requirements 4.1**
    - Test revenue metrics (revenue, sales, top line)
    - Test profitability metrics (gross margin, operating margin, net margin, EBITDA)
    - Test balance sheet metrics (cash, debt, assets, liabilities, equity)
    - Test cash flow metrics (free cash flow, cash conversion, capex)
    - Generate random combinations of ticker + metric
    - Verify metrics are extracted correctly
    - Run 100 iterations
    - _Requirements: 4.1_
  
  - [x] 5.2 Write property tests for business understanding queries
    - **Property 7: Business Understanding Query Support**
    - **Validates: Requirements 4.2**
    - Test business model queries
    - Test competitor queries
    - Test strategy queries
    - Test product/service queries
    - Generate random combinations of ticker + business keyword
    - Verify section item_1 is identified
    - Run 100 iterations
    - _Requirements: 4.2_
  
  - [x] 5.3 Write property tests for comparative analysis queries
    - **Property 8: Comparative Analysis Query Support**
    - **Validates: Requirements 4.3**
    - Test peer comparison queries (NVDA vs AMD)
    - Test historical comparison queries (2024 vs 2023)
    - Test multi-ticker queries
    - Generate random ticker pairs and metrics
    - Verify multiple tickers are identified
    - Verify needsComparison flag is set
    - Run 100 iterations
    - _Requirements: 4.3_
  
  - [x] 5.4 Write property tests for risk assessment queries
    - **Property 9: Risk Assessment Query Support**
    - **Validates: Requirements 4.4**
    - Test risk factor queries
    - Test operational risk queries
    - Test financial risk queries
    - Test supply chain risk queries
    - Generate random combinations of ticker + risk keyword
    - Verify section item_1a is identified
    - Run 100 iterations
    - _Requirements: 4.4_
  
  - [x] 5.5 Write property tests for forward-looking queries
    - **Property 10: Forward-Looking Query Support**
    - **Validates: Requirements 4.5**
    - Test guidance queries
    - Test outlook queries
    - Test catalyst queries
    - Test expected trajectory queries
    - Generate random combinations of ticker + forward-looking keyword
    - Verify section item_7 is identified
    - Run 100 iterations
    - _Requirements: 4.5_
  
  - [x] 5.6 Write property tests for valuation queries
    - **Property 11: Valuation Query Support**
    - **Validates: Requirements 4.6**
    - Test P/E ratio queries
    - Test EV/EBITDA queries
    - Test PEG ratio queries
    - Test price to sales queries
    - Test FCF yield queries
    - Generate random combinations of ticker + valuation metric
    - Verify valuation metrics are extracted or computed
    - Run 100 iterations
    - _Requirements: 4.6_
  
  - [x] 5.7 Write property tests for industry-specific queries
    - **Property 12: Industry-Specific Query Support**
    - **Validates: Requirements 4.7**
    - Test semiconductor queries (NVDA, AMD, INTC)
      - wafer capacity, chip architecture, process node, ASP trends
    - Test SaaS queries (CRM, ORCL, ADBE)
      - ARR growth, net retention, CAC, churn rate
    - Test retail queries (AMZN, WMT, TGT)
      - same-store sales, e-commerce penetration, fulfillment costs
    - Test healthcare queries (JNJ, PFE, UNH)
      - drug pipeline, patent expirations, clinical trials
    - Generate random combinations of industry ticker + industry keyword
    - Verify appropriate suggestions in clarification prompts
    - Run 100 iterations per industry (400 total)
    - _Requirements: 4.7_
  
  - [x] 5.8 Write property tests for ESG queries
    - **Property 13: ESG Query Support**
    - **Validates: Requirements 4.8**
    - Test environmental queries (carbon emissions, renewable energy)
    - Test social queries (employee diversity, labor practices)
    - Test governance queries (board composition, executive compensation)
    - Generate random combinations of ticker + ESG keyword
    - Verify ESG category in clarification prompts
    - Run 100 iterations
    - _Requirements: 4.8_

- [ ] 6. Phase 5: Cross-Industry and Cross-Pattern Testing
  - [x] 6.1 Write comprehensive E2E test for technology sector
    - Test NVDA, AMD, INTC across all query patterns
    - Financial performance, business understanding, comparative analysis
    - Risk assessment, forward-looking, valuation
    - Industry-specific (semiconductor metrics)
    - ESG queries
    - Verify correct handling for each pattern
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  
  - [x] 6.2 Write comprehensive E2E test for SaaS sector
    - Test CRM, ORCL, ADBE across all query patterns
    - Financial performance, business understanding, comparative analysis
    - Risk assessment, forward-looking, valuation
    - Industry-specific (SaaS metrics)
    - ESG queries
    - Verify correct handling for each pattern
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  
  - [x] 6.3 Write comprehensive E2E test for retail sector
    - Test AMZN, WMT, TGT across all query patterns
    - Financial performance, business understanding, comparative analysis
    - Risk assessment, forward-looking, valuation
    - Industry-specific (retail metrics)
    - ESG queries
    - Verify correct handling for each pattern
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  
  - [x] 6.4 Write comprehensive E2E test for healthcare sector
    - Test JNJ, PFE, UNH across all query patterns
    - Financial performance, business understanding, comparative analysis
    - Risk assessment, forward-looking, valuation
    - Industry-specific (healthcare metrics)
    - ESG queries
    - Verify correct handling for each pattern
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  
  - [x] 6.5 Write E2E test for analyst workflow with query refinement
    - Step 1: Submit ambiguous query "Tell me about NVDA"
    - Verify clarification prompt is returned
    - Step 2: Submit refined query "NVDA revenue and growth rate"
    - Verify actual data is returned
    - Step 3: Submit another refined query "NVDA vs AMD margins"
    - Verify comparative data is returned
    - _Requirements: 2.4, 4.1, 4.3_

- [ ]* 6. Phase 6: Analytics and Monitoring (OPTIONAL - Can be implemented later)
  - [ ]* 6.1 Implement logAmbiguityDetection() in IntentAnalyticsService
    - Add method to log ambiguity detection events
    - Track: tenantId, query, wasAmbiguous, clarificationGenerated, userRefined
    - Store in intent_ambiguity_logs table
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  
  - [ ]* 6.2 Add ambiguity metrics to analytics dashboard
    - Add ambiguity detection rate metric
    - Add clarification prompt usage rate metric
    - Add user refinement rate metric
    - Display in real-time metrics
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  
  - [ ]* 6.3 Write property test for analytics tracking
    - **Property 14: Analytics Tracking for Ambiguity**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    - Generate random ambiguous queries
    - Verify analytics logs ambiguity detection
    - Verify clarification generation is tracked
    - Run 100 iterations
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ]* 7. Phase 7: Backward Compatibility Testing (OPTIONAL - Can be implemented later)
  - [ ]* 7.1 Write property test for backward compatibility
    - **Property 15: Backward Compatibility**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
    - Generate random queries with confidence > 0.7
    - Verify behavior is unchanged (uses regex)
    - Generate random queries with confidence < 0.6
    - Verify behavior is unchanged (uses LLM)
    - Generate random non-ambiguous queries with confidence 0.7
    - Verify behavior is unchanged (uses regex)
    - Run 100 iterations
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  
  - [ ]* 7.2 Write regression tests for existing functionality
    - Test existing metric extraction still works
    - Test existing section detection still works
    - Test existing period extraction still works
    - Test existing LLM fallback still works
    - Test existing generic fallback still works
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 8. Final Checkpoint - Comprehensive Test Run
  - Run all unit tests (target: 90%+ coverage)
  - Run all property tests (target: 100% of 15 properties)
  - Run all E2E tests (target: all workflows pass)
  - Verify test coverage across all industries
  - Verify test coverage across all query patterns
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Documentation and Deployment Preparation
  - [ ] 9.1 Update API documentation
    - Document needsClarification field in QueryIntent
    - Document clarification response format
    - Add examples of ambiguous vs non-ambiguous queries
    - _Requirements: 2.3, 2.4_
  
  - [ ] 9.2 Create deployment guide
    - Document phased rollout strategy
    - Document monitoring metrics to track
    - Document rollback procedure
    - Add troubleshooting guide
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  
  - [ ] 9.3 Create user guide for clarification prompts
    - Explain how clarification prompts work
    - Show examples of refining queries
    - Document all suggestion categories
    - Add tips for effective query formulation
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

## Notes

### Testing Strategy

This implementation follows a **MAXIMIZED testing approach** as requested:

- **15 correctness properties** implemented as property-based tests
- **100+ iterations per property test** for comprehensive coverage
- **4 industries tested**: Technology, SaaS, Retail, Healthcare
- **8 query categories tested**: Financial Performance, Business Understanding, Comparative Analysis, Risk Assessment, Forward-Looking, Valuation, Industry-Specific, ESG
- **Multiple tickers per industry**: 3-4 tickers per industry for diversity
- **E2E tests for complete workflows**: Including query refinement flows

### Property Test Distribution

- Boundary condition: 2 properties (Properties 1, 3)
- Ambiguity detection: 2 properties (Properties 4, 5)
- Query pattern support: 8 properties (Properties 6-13)
- Analytics tracking: 1 property (Property 14)
- Backward compatibility: 1 property (Property 15)

**Total: 15 properties × 100 iterations = 1,500+ test cases**

### Industry Coverage

- **Technology**: NVDA, AMD, INTC (semiconductor-specific metrics)
- **SaaS**: CRM, ORCL, ADBE (SaaS-specific metrics)
- **Retail**: AMZN, WMT, TGT (retail-specific metrics)
- **Healthcare**: JNJ, PFE, UNH (healthcare-specific metrics)

### Query Pattern Coverage

Each industry is tested across all 8 query categories:
1. Financial Performance (revenue, margins, cash flow)
2. Business Understanding (business model, competitors)
3. Comparative Analysis (vs peers, vs historical)
4. Risk Assessment (risk factors, operational risks)
5. Forward-Looking (guidance, catalysts)
6. Valuation (P/E, EV/EBITDA, FCF yield)
7. Industry-Specific (sector-specific metrics)
8. ESG & Sustainability (environmental, social, governance)

### Phased Rollout

- **Phase 1** (Day 1): Deploy boundary condition fix only
  - Low risk, immediate impact
  - Monitor success rate improvement
  
- **Phase 2** (Week 1): Deploy ambiguity detection
  - Monitor false positive/negative rates
  - Adjust ambiguous word list if needed
  
- **Phase 3** (Week 2): Deploy clarification prompts
  - A/B test with 10% of users
  - Gather feedback on suggestion quality
  - Roll out to 100% if positive

### Monitoring Metrics

Post-deployment, track:
- Success rate (target: 95%+)
- LLM fallback rate (target: <20%)
- Ambiguity detection rate
- Clarification prompt usage rate
- User refinement rate after clarification
- Average response time
- Cost per 100 queries

### Risk Mitigation

- Comprehensive testing before deployment
- Phased rollout with monitoring
- Easy rollback procedure (revert 5 lines)
- A/B testing for clarification prompts
- Continuous monitoring of metrics
