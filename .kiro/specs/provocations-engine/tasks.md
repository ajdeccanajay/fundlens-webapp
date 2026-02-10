# Implementation Plan: Provocations Engine

## Overview

This implementation plan builds the Provocations Engine as a reusable document intelligence system with two MVP modes: Provocations (adversarial analysis) and Sentiment (tone tracking). The approach leverages existing FundLens infrastructure to minimize development time and avoid over-engineering.

**Key Efficiency Principles**:
- Reuse existing document processing pipeline (hybrid_parser.py, ixbrl_parser.py)
- Extend existing document_sections table rather than creating new storage
- Leverage existing RAG system for semantic similarity
- Reuse existing Bedrock integration for LLM operations
- Build on existing workspace.html frontend patterns
- Minimal new code - maximum infrastructure reuse

## Tasks

- [x] 1. Database schema extensions for temporal diff tracking
  - Extend existing document_sections table with content_hash column
  - Create section_diffs table for pre-computed comparisons
  - Create provocations table for generated findings
  - Create provocations_cache table for performance
  - Create research_query_counter table for auto-generation trigger
  - _Requirements: 1.5, 10.2, 10.3_

- [x] 2. Core diff engine service
  - [x] 2.1 Create TemporalDiffEngine service
    - Implement compareDocuments() method using existing document_sections data
    - Implement alignSections() using section types
    - Implement classifyChanges() for paragraph-level detection
    - Leverage existing semantic-retriever.service.ts for similarity
    - _Requirements: 3.1, 3.2, 11.1, 11.2, 11.3_
  
  - [x]* 2.2 Write property test for section alignment
    - **Property 3: Section Alignment Consistency**
    - **Validates: Requirements 3.1, 11.1, 11.2**
  
  - [x]* 2.3 Write property test for change detection
    - **Property 4: Change Detection Completeness**
    - **Validates: Requirements 3.2, 3.4, 3.5, 11.3, 11.4**

- [x] 3. Semantic similarity integration
  - [x] 3.1 Create SemanticSimilarityEngine service
    - Wrap existing bedrock.service.ts embeddings
    - Implement calculateSimilarity() for text pairs
    - Implement detectConceptualChanges() for qualifier shifts
    - Implement measureQualifierIntensity() for confidence tracking
    - _Requirements: 3.3, 3.6_
  
  - [x]* 3.2 Write property test for semantic change detection
    - **Property 5: Semantic Similarity Beyond Text Matching**
    - **Validates: Requirements 3.3, 3.6**

- [x] 4. Provocation generator service
  - [x] 4.1 Create ProvocationGenerator service
    - Implement generateProvocations() using Bedrock for interpretation
    - Implement classifySeverity() with RED/AMBER/GREEN logic
    - Implement prioritizeProvocations() by severity
    - Ensure all provocations include filing references
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_
  
  - [x]* 4.2 Write property test for provocation structure
    - **Property 7: Provocation Structure Completeness**
    - **Validates: Requirements 4.1, 4.2, 4.6, 7.3, 9.2, 9.3**
  
  - [x]* 4.3 Write property test for materiality prioritization
    - **Property 9: Materiality-Based Prioritization**
    - **Validates: Requirements 4.4**
  
  - [x]* 4.4 Write unit tests for severity classification
    - Test RED FLAG for material risks
    - Test AMBER for noteworthy patterns
    - Test GREEN CHALLENGE for intellectual questions
    - _Requirements: 14.1, 14.2, 14.3_

- [x] 5. Sentiment analyzer service (MVP)
  - [x] 5.1 Create SentimentAnalyzer service
    - Implement calculateSentiment() for sections (-1 to +1 scale)
    - Implement detectSentimentDelta() for cross-filing comparison
    - Implement trackConfidenceLanguage() for commitment tracking
    - Implement detectDefensiveLanguage() for hedging patterns
    - Use Bedrock with sentiment-specific prompts
    - _Requirements: 13.1, 13.2_
  
  - [x]* 5.2 Write property test for sentiment calculation
    - **Property 33: Sentiment Score Calculation**
    - **Validates: Requirements 13.1, 13.2**
  
  - [x]* 5.3 Write property test for sentiment delta detection
    - **Property 34: Sentiment Delta Detection**
    - **Validates: Requirements 13.1, 13.2**

- [x] 6. Checkpoint - Core engine validation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Analysis mode framework
  - [x] 7.1 Create AnalysisModeRegistry service
    - Implement mode registration and retrieval
    - Define AnalysisMode interface
    - Register Provocations mode with system prompt and preset questions
    - Register Sentiment mode with system prompt and preset questions
    - _Requirements: 1.3, 13.1, 13.2, 13.5_
  
  - [x]* 7.2 Write property test for mode-specific processing
    - **Property 19: Mode-Specific Processing**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4**

- [x] 8. Pre-computation service
  - [x] 8.1 Create PreComputationService
    - Implement preComputeDiffs() triggered on filing ingestion
    - Implement preGenerateProvocations() for frequent tickers
    - Implement schedulePreComputation() for background jobs
    - Integrate with existing sec-processing.service.ts pipeline
    - Use Redis for caching (existing infrastructure)
    - _Requirements: 10.1, 10.4, 10.5_
  
  - [x]* 8.2 Write unit tests for pre-computation triggers
    - Test diff computation on new filing
    - Test provocation caching
    - Test cache expiration
    - _Requirements: 10.1, 10.4, 10.5_

- [x] 9. Contradiction detector service
  - [x] 9.1 Create ContradictionDetector service
    - Implement detectContradictions() for cross-filing analysis
    - Implement compareStatementsToResults() for credibility tracking
    - Implement detectNarrativeMisalignment() for segment vs consolidated
    - Ensure dual references for all contradictions
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  
  - [x]* 9.2 Write property test for contradiction detection
    - **Property 12: Statement vs Results Contradiction Detection**
    - **Validates: Requirements 5.1, 5.2, 16.2, 16.3**
  
  - [x]* 9.3 Write property test for dual reference provision
    - **Property 13: Dual Reference Provision for Contradictions**
    - **Validates: Requirements 5.5**

- [x] 10. Management credibility tracker
  - [x] 10.1 Create ManagementCredibilityTracker service
    - Implement extractForwardLookingStatements() from MD&A
    - Implement compareToResults() for accuracy tracking
    - Implement detectWalkBacks() for guidance changes
    - Implement calculateAccuracyMetrics() for historical performance
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_
  
  - [x]* 10.2 Write property test for statement extraction
    - **Property 30: Forward-Looking Statement Extraction**
    - **Validates: Requirements 16.1**
  
  - [x]* 10.3 Write property test for walk-back detection
    - **Property 31: Guidance Walk-Back Detection**
    - **Validates: Requirements 16.4**

- [x] 11. Checkpoint - Backend services complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Provocations API controller
  - [x] 12.1 Create ProvocationsController
    - POST /api/provocations/analyze - trigger analysis for ticker
    - GET /api/provocations/:companyId - get cached provocations
    - GET /api/provocations/:companyId/preset/:questionId - execute preset question
    - POST /api/provocations/mode - switch analysis mode
    - Integrate with existing authentication and tenant isolation
    - _Requirements: 6.1, 6.2, 8.1, 8.2, 8.3, 8.4_
  
  - [x]* 12.2 Write integration tests for API endpoints
    - Test analysis trigger
    - Test cached results retrieval
    - Test preset question execution
    - Test mode switching
    - _Requirements: 6.1, 6.2, 8.1, 8.2, 8.3, 8.4_

- [x] 13. Research Assistant mode toggle (Frontend)
  - [x] 13.1 Add Provocations mode toggle to workspace.html Research Assistant
    - Add toggle switch in Research Assistant header
    - Add visual indicator (border color) when mode active
    - Display preset question chips when mode activated
    - Filter chips based on available data (4-6 chips)
    - Format responses with provocation structure and severity badges
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 8.5_
  
  - [x] 13.2 Add Sentiment mode toggle
    - Add sentiment mode option to toggle
    - Display sentiment-specific preset questions
    - Format responses with sentiment scores and deltas
    - _Requirements: 13.1, 13.2_
  
  - [x]* 13.3 Write unit tests for mode toggle behavior
    - Test toggle state management
    - Test visual indicator display
    - Test preset chip filtering
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 14. Provocations Tab (Frontend)
  - [x] 14.1 Create Provocations tab in workspace.html
    - Add tab alongside Quantitative, Qualitative, Export
    - Display top 3-5 most material provocations
    - Include severity badges and challenge questions
    - Add link to activate Provocations mode in Research Assistant
    - Implement auto-generation trigger (3+ queries)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  
  - [x] 14.2 Add Sentiment sub-tab
    - Display sentiment trend chart over time
    - Show confidence language shifts
    - Highlight defensive language increases
    - _Requirements: 13.1, 13.2_
  
  - [x]* 14.3 Write unit tests for tab display
    - Test provocation count constraint (3-5)
    - Test auto-generation trigger
    - Test tab update on new filing
    - _Requirements: 7.1, 7.2, 7.5_

- [x] 15. Scratchpad integration
  - [x] 15.1 Add "Save to Scratchpad" action to provocations
    - Add save button to each provocation in Research Assistant
    - Store complete provocation structure in existing scratchpad
    - Maintain formatting and severity classification
    - Enable organization by ticker/category
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  
  - [x]* 15.2 Write property test for structure preservation
    - **Property 23: Scratchpad Structure Preservation**
    - **Validates: Requirements 9.2, 9.3**

- [x] 16. Query counter and auto-generation
  - [x] 16.1 Implement query counter service
    - Track research queries per ticker
    - Trigger auto-generation at 3+ queries
    - Update Provocations Tab when generated
    - _Requirements: 7.1, 7.5_
  
  - [x]* 16.2 Write unit tests for auto-generation trigger
    - Test query counting
    - Test threshold trigger
    - Test tab update
    - _Requirements: 7.1_

- [x] 17. Performance optimization
  - [x] 17.1 Implement performance requirements
    - Optimize preset question display (<500ms)
    - Optimize pre-computed query response (<3s)
    - Implement streaming for custom queries (<5s first response)
    - Ensure background processing doesn't impact foreground
    - Implement cache effectiveness monitoring
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_
  
  - [x]* 17.2 Write property tests for performance
    - **Property 25: Preset Question Display Performance**
    - **Property 26: Pre-Computed Query Performance**
    - **Property 27: Streaming Response Performance**
    - **Validates: Requirements 17.1, 17.2, 17.3**

- [x] 18. Checkpoint - Integration testing
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. End-to-end testing
  - [x]* 19.1 Write E2E test for Provocations mode flow
    - Test complete flow: toggle mode → select preset question → view results → save to scratchpad
    - Test with real SEC filing data (AAPL, MSFT)
    - Verify provocation structure and references
    - _Requirements: 6.1, 6.2, 6.5, 6.6, 9.1_
  
  - [x]* 19.2 Write E2E test for Sentiment mode flow
    - Test sentiment analysis across multiple filings
    - Verify sentiment scores and deltas
    - Test confidence language tracking
    - _Requirements: 13.1, 13.2_
  
  - [x]* 19.3 Write E2E test for auto-generation
    - Submit 3 queries for a ticker
    - Verify Provocations Tab auto-generates
    - Verify top 3-5 provocations displayed
    - _Requirements: 7.1, 7.2_
  
  - [x]* 19.4 Write E2E test for pre-computation
    - Ingest new filing
    - Verify diffs pre-computed
    - Verify provocations cached
    - Verify fast response on subsequent query
    - _Requirements: 10.1, 10.4, 10.5_

- [x] 20. Documentation and deployment
  - [x] 20.1 Create user documentation
    - Document Provocations mode usage
    - Document Sentiment mode usage
    - Document preset questions
    - Document severity classifications
    - Create demo video/screenshots
  
  - [x] 20.2 Create developer documentation
    - Document architecture and design decisions
    - Document API endpoints
    - Document database schema
    - Document extension points for new modes
  
  - [x] 20.3 Deployment preparation
    - Run database migrations
    - Configure Redis cache
    - Test with production data
    - Monitor performance metrics

- [x] 21. Final checkpoint - Production readiness
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Leverage existing infrastructure throughout to minimize development time
- Focus on reusing existing document processing, RAG, and frontend patterns
- Minimal new code - maximum infrastructure reuse
