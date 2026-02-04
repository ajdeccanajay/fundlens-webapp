# Implementation Plan: RAG Competitive Intelligence Extraction

## Overview

This implementation plan breaks down the RAG competitive intelligence extraction feature into 4 phases with clear rollback points. Each phase is independently deployable and testable, with git tags for version control and rollback procedures.

**Phased Approach**:
- **Phase 1**: Core subsection extraction and storage (foundational, low risk)
- **Phase 2**: Intent detection and subsection-aware retrieval (builds on Phase 1)
- **Phase 3**: Advanced retrieval techniques (HyDE, reranking, contextual expansion)
- **Phase 4**: Dynamic calculations and multi-modal responses (highest complexity)

## Phase 1: Core Subsection Extraction and Storage

**Git Tag**: `rag-extraction-phase1-v1.0.0`
**Risk Level**: LOW
**Estimated Time**: 1-2 weeks

- [x] 1. Create baseline git tag and CHANGELOG
  - Create git tag `rag-extraction-baseline` before any changes
  - Initialize CHANGELOG-RAG-EXTRACTION.md with baseline state
  - Document current system behavior
  - _Requirements: 35.1_

- [x] 2. Enhance Python Section Parser for subsection identification
  - [x] 2.1 Implement subsection identification for Item 1 (Business)
    - Add pattern matching for: Competition, Products, Customers, Markets, Operations, Strategy, Intellectual Property, Human Capital
    - Return subsection boundaries and names
    - _Requirements: 1.2_
  
  - [x] 2.2 Implement subsection identification for Item 7 (MD&A)
    - Add pattern matching for: Results of Operations, Liquidity and Capital Resources, Critical Accounting Policies, Market Risk, Contractual Obligations
    - Return subsection boundaries and names
    - _Requirements: 1.3_
  
  - [x] 2.3 Implement subsection identification for Item 8 (Financial Statements)
    - Add pattern matching for: Note 1, Note 2, etc., Revenue Recognition, Leases, Stock-Based Compensation
    - Return subsection boundaries and names
    - _Requirements: 1.4_
  
  - [x] 2.4 Implement subsection identification for Item 1A (Risk Factors)
    - Add pattern matching for: Operational Risks, Financial Risks, Market Risks, Regulatory Risks
    - Return subsection boundaries and names
    - _Requirements: 1.5_
  
  - [x] 2.5 Implement hierarchical subsection support
    - Support nested subsections (e.g., Item 7 > Results of Operations > Revenue Analysis)
    - Store full hierarchy in subsection_name
    - _Requirements: 1.10_
  
  - [ ]* 2.6 Write property test for universal subsection identification
    - **Property 1: Universal Subsection Identification**
    - **Validates: Requirements 1.1**
    - Test that all major sections have subsections identified
    - Use fast-check to generate random section types
  
  - [ ]* 2.7 Write unit tests for specific subsection identification
    - Test Item 1 Competition subsection identification
    - Test Item 7 MD&A subsection identification
    - Test Item 8 footnote subsection identification
    - Test Item 1A risk factor subsection identification
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

- [x] 3. Update database schema for subsection storage
  - [x] 3.1 Create migration script for subsection_name column
    - Add nullable TEXT column subsection_name to narrative_chunks
    - Create index on (ticker, section_type, subsection_name)
    - Test migration on development database
    - _Requirements: 15.1, 15.3_
  
  - [x] 3.2 Update chunk creation to include subsection metadata
    - Modify Section Parser to populate subsection_name when creating chunks
    - Handle null subsection_name for ambiguous sections
    - Maintain backward compatibility with existing chunks
    - _Requirements: 1.6, 1.7, 1.9_
  
  - [ ]* 3.3 Write property test for subsection metadata persistence
    - **Property 2: Subsection Metadata Persistence**
    - **Validates: Requirements 1.6, 1.7**
    - Test that all chunks with identified subsections store subsection_name
  
  - [ ]* 3.4 Write property test for backward compatibility
    - **Property 4: Backward Compatibility**
    - **Validates: Requirements 1.8**
    - Test that existing chunks without subsection_name work without errors

- [x] 4. Update Bedrock KB metadata synchronization
  - [x] 4.1 Enhance chunk exporter to include subsection metadata
    - Update S3 export format to include subsection_name in metadata
    - Omit subsection_name if null (don't export null values)
    - Test export with sample chunks
    - _Requirements: 16.1, 16.5_
  
  - [x] 4.2 Configure Bedrock KB to index subsection_name
    - Update Bedrock KB metadata schema
    - Add subsection_name as filterable attribute
    - Test metadata filtering in Bedrock KB
    - _Requirements: 16.2_
  
  - [x] 4.3 Re-export existing chunks with updated metadata
    - Create backfill script for existing chunks
    - Run backfill on development environment
    - Verify Bedrock KB ingestion
    - _Requirements: 16.4_

- [x] 5. Phase 1 checkpoint and git tag
  - Run all Phase 1 tests
  - Verify no impact on current retrieval behavior
  - Update CHANGELOG with Phase 1 changes
  - Create git tag `rag-extraction-phase1-v1.0.0`
  - Document rollback procedure
  - _Requirements: 35.1_


## Phase 2: Intent Detection and Subsection-Aware Retrieval

**Git Tag**: `rag-extraction-phase2-v1.0.0`
**Risk Level**: MEDIUM
**Estimated Time**: 2-3 weeks

- [ ] 6. Enhance Intent Detector for subsection targeting
  - [ ] 6.1 Implement competitive intelligence intent detection
    - Add keyword patterns: "competitors", "competitive landscape", "competition", "peer comparison"
    - Set target section: item_1, subsection: Competition
    - Extract ticker from query
    - _Requirements: 2.1, 2.2, 2.3_
  
  - [ ] 6.2 Implement MD&A intelligence intent detection
    - Add keyword patterns: "growth drivers", "trends", "outlook", "guidance", "management discussion"
    - Set target section: item_7
    - Map specific MD&A topics to subsections
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  
  - [ ] 6.3 Implement footnote intent detection
    - Add keyword patterns: "footnote", "accounting policy", "revenue recognition", "note [number]"
    - Set target section: item_8
    - Extract note number if specified
    - _Requirements: 4.1, 4.2, 4.3_
  
  - [ ] 6.4 Implement intent prioritization logic
    - When multiple intents match, prioritize most specific
    - Distinguish competitive queries from general business queries
    - _Requirements: 2.4, 2.5_
  
  - [ ]* 6.5 Write property test for competitive intelligence classification
    - **Property 5: Competitive Intelligence Intent Classification**
    - **Validates: Requirements 2.1, 2.2**
    - Generate random queries with competitive keywords
    - Verify classification and subsection targeting
  
  - [ ]* 6.6 Write property test for intent prioritization
    - **Property 6: Intent Prioritization**
    - **Validates: Requirements 2.5**
    - Generate queries matching multiple patterns
    - Verify most specific intent is selected
  
  - [ ]* 6.7 Write property tests for MD&A and footnote classification
    - **Property 7: MD&A Intent Classification** (Requirements 3.1, 3.2)
    - **Property 8: Footnote Intent Classification** (Requirements 4.1, 4.2)
    - Test classification for all intent types
  
  - [ ]* 6.8 Write unit tests for specific intent examples
    - Test "Who are AAPL's competitors?" → competitive_intelligence
    - Test "What are NVDA's growth drivers?" → mda_intelligence
    - Test "What is AMZN's revenue recognition policy?" → footnote
    - _Requirements: 2.1, 3.1, 4.1_

- [ ] 7. Implement subsection-aware retrieval in Semantic Retriever
  - [ ] 7.1 Add subsection filtering to Bedrock KB retrieval
    - Update metadata filter to include subsection_name
    - Implement filter expression for Bedrock KB API
    - Test retrieval with subsection filters
    - _Requirements: 5.1, 5.2_
  
  - [ ] 7.2 Add subsection filtering to PostgreSQL fallback
    - Update WHERE clause to filter by subsection_name
    - Handle null subsection_name gracefully
    - Test PostgreSQL retrieval with subsection filters
    - _Requirements: 5.1, 5.3_
  
  - [ ] 7.3 Implement fallback chain for retrieval
    - Try subsection-filtered retrieval first
    - If no results, fallback to section-only filtering
    - If still no results, fallback to broader semantic search
    - Log all fallback events
    - _Requirements: 5.4, 5.5, 12.1, 12.2, 12.3_
  
  - [ ]* 7.4 Write property test for subsection-filtered retrieval
    - **Property 9: Subsection-Filtered Retrieval**
    - **Validates: Requirements 5.1**
    - Generate random queries with subsection specifications
    - Verify filtering by both section_type and subsection_name
  
  - [ ]* 7.5 Write property test for retrieval fallback chain
    - **Property 10: Retrieval Fallback Chain**
    - **Validates: Requirements 5.5, 12.1, 12.2**
    - Test fallback when subsection filtering returns zero results
    - Verify fallback to section-only, then broader search
  
  - [ ]* 7.6 Write unit tests for fallback scenarios
    - Test subsection filter with no results → section filter
    - Test section filter with no results → broad search
    - Test Bedrock KB unavailable → PostgreSQL fallback
    - _Requirements: 12.1, 12.2, 12.3_

- [ ] 8. Implement multi-ticker isolation
  - [ ] 8.1 Add independent ticker processing
    - Process each ticker in separate retrieval calls
    - Maintain strict ticker-based filtering
    - Merge results with clear ticker separation
    - _Requirements: 10.1, 10.2_
  
  - [ ] 8.2 Add ticker mixing validation
    - Validate no chunk from ticker A appears in ticker B's results
    - Return error if mixing detected
    - Log mixing incidents for alerting
    - _Requirements: 10.4, 10.5_
  
  - [ ]* 8.3 Write property test for multi-ticker isolation
    - **Property 11: Multi-Ticker Isolation**
    - **Validates: Requirements 10.1, 10.2, 10.4**
    - Generate random multi-ticker queries
    - Verify strict ticker separation in results
  
  - [ ]* 8.4 Write unit tests for multi-ticker scenarios
    - Test 2-ticker query maintains separation
    - Test 3-ticker query maintains separation
    - Test ticker mixing detection and error
    - _Requirements: 10.1, 10.2, 10.4_

- [ ] 9. Create Response Generator Service for structured extraction
  - [ ] 9.1 Implement competitive intelligence extraction
    - Extract competitor names from chunks
    - Extract market positioning and context
    - Extract competitive advantages and disadvantages
    - Structure as CompetitiveIntelligence interface
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  
  - [ ] 9.2 Implement MD&A intelligence extraction
    - Extract key trends from chunks
    - Extract and categorize risks
    - Extract forward guidance with timeframes
    - Structure as MDAIntelligence interface
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  
  - [ ] 9.3 Implement footnote content extraction
    - Extract accounting policy text
    - Preserve technical terminology and numerical details
    - Structure as FootnoteContent interface
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  
  - [ ] 9.4 Implement confidence scoring
    - Calculate confidence based on chunk relevance, explicit mentions, consistency
    - Assign confidence score (0.0 to 1.0) to all extractions
    - Indicate uncertainty when confidence < 0.7
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  
  - [ ] 9.5 Implement response validation
    - Validate all claims are supported by retrieved chunks
    - Verify competitor names appear in source chunks
    - Verify quantitative data matches source chunks
    - Reject responses below minimum confidence thresholds
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_
  
  - [ ] 9.6 Implement citation generation
    - Include section and subsection references
    - Format citations: [Section] - [Subsection] (Filing Type, Filing Date)
    - Cite all contributing chunks
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  
  - [ ]* 9.7 Write property tests for extraction and validation
    - **Property 23: Confidence Score Bounds** (Requirements 11.1)
    - **Property 24: Low Confidence Indication** (Requirements 11.3)
    - **Property 25: Citation Completeness** (Requirements 9.1, 9.2, 9.3)
    - **Property 26: Response Validation** (Requirements 13.1, 13.2, 13.3)
  
  - [ ]* 9.8 Write unit tests for structured extraction
    - Test competitive intelligence extraction with known chunks
    - Test MD&A intelligence extraction with known chunks
    - Test footnote content extraction with known chunks
    - Test confidence scoring with various chunk qualities
    - _Requirements: 6.1, 7.1, 8.1, 11.1_

- [ ] 10. Implement prompt engineering for extraction
  - [ ] 10.1 Create prompt templates for each intent type
    - Competitive intelligence prompt template
    - MD&A intelligence prompt template
    - Footnote prompt template
    - Include explicit instructions for structured extraction
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  
  - [ ] 10.2 Implement prompt versioning and management
    - Store prompts in prompt library with versions
    - Support prompt updates without code changes
    - Maintain backward compatibility
    - _Requirements: 14.5_
  
  - [ ]* 10.3 Write unit tests for prompt selection
    - Test competitive intelligence intent → competitive prompt
    - Test MD&A intelligence intent → MD&A prompt
    - Test footnote intent → footnote prompt
    - _Requirements: 14.1, 14.2, 14.3_

- [ ] 11. Add monitoring and observability
  - [ ] 11.1 Implement extraction attempt logging
    - Log intent type, ticker, success/failure status
    - Log failure reasons (no chunks, low confidence, validation failure)
    - Log latency for all operations
    - _Requirements: 17.1, 17.2_
  
  - [ ] 11.2 Implement success rate metrics
    - Track competitive intelligence success rate
    - Track MD&A success rate
    - Track footnote success rate
    - Track average confidence scores by intent type
    - _Requirements: 17.3, 17.4_
  
  - [ ] 11.3 Implement alerting
    - Alert when competitive intelligence success rate < 95%
    - Alert when MD&A success rate < 90%
    - Alert on any multi-ticker mixing incident
    - _Requirements: 17.5_
  
  - [ ]* 11.4 Write property test for monitoring event logging
    - **Property 29: Monitoring Event Logging**
    - **Validates: Requirements 17.1, 37.1**
    - Test that all extraction attempts are logged

- [ ] 12. Phase 2 checkpoint and git tag
  - Run all Phase 2 tests (unit + property + integration)
  - Verify extraction success rates meet targets (>95% for competitive intelligence)
  - Test end-to-end competitive intelligence query
  - Test end-to-end MD&A query
  - Test end-to-end footnote query
  - Test multi-ticker query with separation validation
  - Update CHANGELOG with Phase 2 changes
  - Create git tag `rag-extraction-phase2-v1.0.0`
  - Document rollback procedure and feature flags
  - _Requirements: 35.1, 36.1_


## Phase 3: Advanced Retrieval Techniques

**Git Tag**: `rag-extraction-phase3-v1.0.0`
**Risk Level**: MEDIUM
**Estimated Time**: 2-3 weeks

- [ ] 13. Create Reranker Service
  - [ ] 13.1 Implement Mistral reranking via Bedrock
    - Integrate with Bedrock Rerank API
    - Accept query text and chunk content as inputs
    - Return relevance scores (0.0 to 1.0)
    - Sort chunks by reranked scores descending
    - _Requirements: 5A.1, 5A.2, 5A.4_
  
  - [ ] 13.2 Implement reranking fallback
    - Detect reranking failures
    - Preserve original scores when reranking fails
    - Log reranking failures for monitoring
    - _Requirements: 5A.3, 5A.5_
  
  - [ ]* 13.3 Write property test for reranking score improvement
    - **Property 12: Reranking Score Improvement**
    - **Validates: Requirements 5A.1, 5A.2**
    - Test that top-ranked chunks have higher or equal scores after reranking
  
  - [ ]* 13.4 Write property test for reranking fallback safety
    - **Property 13: Reranking Fallback Safety**
    - **Validates: Requirements 5A.3**
    - Test that reranking failures preserve original scores
  
  - [ ]* 13.5 Write unit tests for reranking
    - Test reranking with known chunks
    - Test reranking failure fallback
    - Test reranking with empty chunk list
    - _Requirements: 5A.1, 5A.3_

- [ ] 14. Implement HyDE (Hypothetical Document Embeddings)
  - [ ] 14.1 Implement hypothetical answer generation
    - Use Claude to generate hypothetical answer for query
    - Embed hypothetical answer using Bedrock embeddings
    - Handle generation failures gracefully
    - _Requirements: 23.1, 23.2_
  
  - [ ] 14.2 Implement HyDE-based retrieval
    - Retrieve using hypothetical embedding
    - Retrieve using original query embedding
    - Merge results from both methods
    - Deduplicate merged results
    - _Requirements: 23.2, 23.3, 23.4_
  
  - [ ] 14.3 Implement HyDE fallback
    - Fallback to standard query-based retrieval if HyDE fails
    - Log HyDE failures for monitoring
    - _Requirements: 23.5_
  
  - [ ]* 14.4 Write property test for HyDE deduplication
    - **Property 15: HyDE Deduplication**
    - **Validates: Requirements 23.4**
    - Test that chunks retrieved by both methods are deduplicated
  
  - [ ]* 14.5 Write unit tests for HyDE
    - Test hypothetical answer generation
    - Test HyDE-based retrieval
    - Test deduplication logic
    - Test HyDE fallback
    - _Requirements: 23.1, 23.2, 23.4, 23.5_

- [ ] 15. Implement Query Decomposition
  - [ ] 15.1 Implement multi-faceted query detection
    - Detect queries with multiple questions
    - Use Claude to decompose into sub-queries
    - Handle decomposition failures
    - _Requirements: 22.1_
  
  - [ ] 15.2 Implement sub-query execution
    - Execute each sub-query independently
    - Track which sub-query contributed to which results
    - Merge sub-query results
    - _Requirements: 22.2, 22.4_
  
  - [ ] 15.3 Implement unified response synthesis
    - Synthesize sub-query results into unified response
    - Handle conflicting sub-query results
    - Prioritize most recent or most relevant information
    - _Requirements: 22.3, 22.5_
  
  - [ ]* 15.4 Write property test for query decomposition completeness
    - **Property 16: Query Decomposition Completeness**
    - **Validates: Requirements 22.2, 22.4**
    - Test that all sub-queries are executed
    - Test that each part of response is traceable to sub-query
  
  - [ ]* 15.5 Write unit tests for query decomposition
    - Test multi-faceted query detection
    - Test sub-query execution
    - Test unified response synthesis
    - _Requirements: 22.1, 22.2, 22.3_

- [ ] 16. Implement Contextual Chunk Expansion
  - [ ] 16.1 Implement adjacent chunk retrieval
    - Fetch chunks with chunk_index ± 1 for each retrieved chunk
    - Merge adjacent chunks into coherent context window
    - Preserve chunk boundaries for citations
    - _Requirements: 21.1, 21.2, 21.3_
  
  - [ ] 16.2 Implement token budget enforcement
    - Calculate total token count of expanded context
    - Limit expansion to maximum token budget (4000 tokens)
    - Prioritize chunks with highest relevance scores
    - _Requirements: 21.4, 21.5_
  
  - [ ]* 16.3 Write property test for token budget enforcement
    - **Property 14: Contextual Expansion Token Budget**
    - **Validates: Requirements 21.4**
    - Test that expanded context never exceeds token budget
  
  - [ ]* 16.4 Write unit tests for contextual expansion
    - Test adjacent chunk retrieval
    - Test chunk merging
    - Test token budget enforcement
    - Test prioritization by relevance
    - _Requirements: 21.1, 21.2, 21.4, 21.5_

- [ ] 17. Implement Iterative Retrieval
  - [ ] 17.1 Implement low-confidence detection
    - Detect when initial retrieval returns low-confidence results
    - Generate follow-up queries to fill gaps
    - _Requirements: 26.1_
  
  - [ ] 17.2 Implement follow-up query execution
    - Execute follow-up queries
    - Merge results with initial retrieval
    - Track which iteration contributed to which information
    - _Requirements: 26.2, 26.4_
  
  - [ ] 17.3 Implement iteration limit
    - Limit iterative retrieval to maximum 2 iterations
    - Stop if iterative retrieval does not improve results
    - _Requirements: 26.3, 26.5_
  
  - [ ]* 17.4 Write property test for iterative retrieval termination
    - **Property 17: Iterative Retrieval Termination**
    - **Validates: Requirements 26.3**
    - Test that iterative retrieval terminates after 2 iterations
  
  - [ ]* 17.5 Write unit tests for iterative retrieval
    - Test low-confidence detection
    - Test follow-up query generation
    - Test iteration limit enforcement
    - _Requirements: 26.1, 26.2, 26.3_

- [ ] 18. Create Advanced Retrieval Service orchestration
  - [ ] 18.1 Integrate all advanced techniques
    - Orchestrate reranking, HyDE, query decomposition, contextual expansion, iterative retrieval
    - Implement feature flags for each technique
    - Handle failures gracefully with fallbacks
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_
  
  - [ ] 18.2 Implement performance optimization
    - Ensure latency p95 < 5 seconds
    - Optimize parallel execution where possible
    - Cache intermediate results
    - _Requirements: 38.1_
  
  - [ ]* 18.3 Write integration tests for advanced retrieval
    - Test end-to-end retrieval with all techniques enabled
    - Test feature flag disabling for each technique
    - Compare Phase 2 vs Phase 3 retrieval quality
    - _Requirements: 20.1, 36.2_

- [ ] 19. Phase 3 checkpoint and git tag
  - Run all Phase 3 tests (unit + property + integration)
  - Verify reranking improves top-3 relevance by 10%
  - Verify latency p95 < 5 seconds
  - Test all advanced techniques with feature flags
  - Update CHANGELOG with Phase 3 changes
  - Create git tag `rag-extraction-phase3-v1.0.0`
  - Document rollback procedure and feature flags
  - _Requirements: 35.1, 36.1_


## Phase 4: Dynamic Calculations and Multi-Modal Responses

**Git Tag**: `rag-extraction-phase4-v1.0.0`
**Risk Level**: HIGH
**Estimated Time**: 3-4 weeks

- [ ] 20. Create database schema for formula caching
  - [ ] 20.1 Create formula_cache table
    - Add columns: id, metric_name, formula, required_components, validation_status, version
    - Add unique constraint on metric_name
    - Add timestamps (created_at, updated_at)
    - _Requirements: 28A.1_
  
  - [ ] 20.2 Create formula_audit_log table
    - Add columns: id, formula_id, ticker, period, inputs, outputs, execution_time_ms, executed_at
    - Add foreign key to formula_cache
    - Add indexes for efficient querying
    - _Requirements: 35.4_
  
  - [ ]* 20.3 Write unit tests for schema
    - Test formula_cache insertion and retrieval
    - Test formula_audit_log insertion
    - Test foreign key constraints
    - _Requirements: 28A.1, 35.4_

- [ ] 21. Create Dynamic Calculator Service
  - [ ] 21.1 Implement formula extraction from queries
    - Use Claude to extract formulas from natural language
    - Parse formula into components (metric name, formula, required components)
    - Handle extraction failures gracefully
    - _Requirements: 27.2, 28.1_
  
  - [ ] 21.2 Implement formula validation
    - Validate against known financial formulas library
    - Check for unknown operations
    - Whitelist allowed operations (arithmetic, basic functions)
    - Reject unknown operations without user confirmation
    - _Requirements: 34.1, 34.2, 34.4_
  
  - [ ] 21.3 Implement result bounds validation
    - Validate results are within reasonable bounds (e.g., margins 0-100%)
    - Log validation failures
    - Present formula to user for manual review on failure
    - _Requirements: 34.3, 34.5_
  
  - [ ] 21.4 Implement metric calculation
    - Retrieve required component metrics from RDS
    - Execute formula calculation
    - Return result with formula and component values
    - Handle missing component metrics
    - _Requirements: 27.3, 27.4, 27.5, 28.4_
  
  - [ ] 21.5 Implement formula caching
    - Cache successfully validated formulas
    - Retrieve cached formulas for repeated calculations
    - Display cached formulas to user for transparency
    - Support formula versioning
    - _Requirements: 28A.1, 28A.2, 28A.3, 28A.4_
  
  - [ ] 21.6 Implement formula audit logging
    - Log all formula executions with inputs, outputs, timestamps
    - Store execution time for performance monitoring
    - _Requirements: 35.4_
  
  - [ ]* 21.7 Write property tests for formula validation and caching
    - **Property 18: Formula Validation Safety** (Requirements 34.1, 34.2)
    - **Property 19: Formula Result Bounds** (Requirements 34.3)
    - **Property 20: Formula Cache Consistency** (Requirements 28A.1, 28A.2)
  
  - [ ]* 21.8 Write unit tests for dynamic calculator
    - Test formula extraction from natural language
    - Test formula validation with known formulas
    - Test calculation with known component metrics
    - Test formula caching and retrieval
    - Test result bounds validation
    - _Requirements: 27.2, 28.1, 34.1, 34.3, 28A.1_

- [ ] 22. Implement peer comparison with dynamic metrics
  - [ ] 22.1 Implement peer company identification
    - Extract peer companies from query or use predefined lists
    - Validate peer companies exist in database
    - _Requirements: 29.1_
  
  - [ ] 22.2 Implement peer metric calculation
    - Calculate custom metric for each peer company
    - Handle missing data for some peers
    - _Requirements: 29.2_
  
  - [ ] 22.3 Implement comparison table generation
    - Present results in comparison table format
    - Highlight best and worst performers
    - Indicate which peers have missing data
    - _Requirements: 29.3, 29.4, 29.5_
  
  - [ ]* 22.4 Write unit tests for peer comparison
    - Test peer identification
    - Test peer metric calculation
    - Test comparison table generation
    - Test handling of missing peer data
    - _Requirements: 29.1, 29.2, 29.3, 29.5_

- [ ] 23. Create Chart Generator Service
  - [ ] 23.1 Implement chart configuration generation
    - Accept data arrays and chart type (line, bar, pie, scatter)
    - Generate Chart.js configuration object
    - Apply consistent styling (colors, fonts, labels)
    - _Requirements: 31.1, 31.2, 31.3_
  
  - [ ] 23.2 Implement chart type validation
    - Validate data is suitable for requested chart type
    - Suggest alternative chart type if data is unsuitable
    - _Requirements: 31.5_
  
  - [ ] 23.3 Implement chart type handlers
    - Line charts for trend analysis
    - Bar charts for peer comparisons
    - Pie charts for composition analysis
    - Scatter charts for correlation analysis
    - _Requirements: 31.4_
  
  - [ ]* 23.4 Write property test for chart type appropriateness
    - **Property 21: Chart Type Appropriateness**
    - **Validates: Requirements 31.5**
    - Test that unsuitable data triggers alternative suggestion
  
  - [ ]* 23.5 Write unit tests for chart generation
    - Test line chart generation
    - Test bar chart generation
    - Test pie chart generation
    - Test scatter chart generation
    - Test chart type validation
    - _Requirements: 31.1, 31.2, 31.3, 31.4, 31.5_

- [ ] 24. Create Code Interpreter Service
  - [ ] 24.1 Implement Python code generation
    - Use Claude to generate Python code for complex calculations
    - Include regression analysis, correlation matrices, scenario modeling, sensitivity analysis
    - Validate generated code for safety
    - _Requirements: 32.1, 32.5_
  
  - [ ] 24.2 Implement sandboxed execution environment
    - Set up isolated Python execution environment
    - Enforce timeout limits (30 seconds)
    - Enforce resource limits (memory, CPU)
    - _Requirements: 32.2_
  
  - [ ] 24.3 Implement code execution with retry
    - Execute code in sandbox
    - Capture results and errors
    - Retry with corrected code on failure (max 2 attempts)
    - Present code to user for transparency
    - _Requirements: 32.3, 32.4_
  
  - [ ]* 24.4 Write property test for code execution safety
    - **Property 22: Code Execution Safety**
    - **Validates: Requirements 32.2**
    - Test that all code executes in sandbox with limits enforced
  
  - [ ]* 24.5 Write unit tests for code interpreter
    - Test Python code generation
    - Test sandboxed execution
    - Test timeout enforcement
    - Test retry with correction
    - Test error handling
    - _Requirements: 32.1, 32.2, 32.3, 32.4_

- [ ] 25. Implement multi-modal response generation
  - [ ] 25.1 Implement response type detection
    - Detect when trend analysis is requested → line chart
    - Detect when peer comparison is requested → bar chart or table
    - Detect when composition analysis is requested → pie chart
    - _Requirements: 30.1, 30.2, 30.3_
  
  - [ ] 25.2 Implement chart generation integration
    - Generate charts for appropriate query types
    - Return charts in frontend-compatible format (Chart.js config)
    - Fallback to tabular or text representation on failure
    - _Requirements: 30.4, 30.5_
  
  - [ ] 25.3 Implement hybrid response formatting
    - Combine text, tables, charts, and code in responses
    - Clearly distinguish qualitative vs quantitative data
    - Include all visualizations in response
    - _Requirements: 18.4, 30.1, 30.2, 30.3_
  
  - [ ]* 25.4 Write property test for hybrid response distinction
    - **Property 27: Hybrid Response Distinction**
    - **Validates: Requirements 18.4**
    - Test that qualitative and quantitative data are clearly distinguished
  
  - [ ]* 25.5 Write unit tests for multi-modal responses
    - Test trend analysis → line chart
    - Test peer comparison → bar chart
    - Test composition analysis → pie chart
    - Test chart generation fallback
    - _Requirements: 30.1, 30.2, 30.3, 30.5_

- [ ] 26. Implement feature flags and gradual rollout
  - [ ] 26.1 Add feature flags for Phase 4 features
    - FEATURE_DYNAMIC_CALCULATIONS
    - FEATURE_FORMULA_CACHE
    - FEATURE_CHART_GENERATION
    - FEATURE_CODE_INTERPRETER
    - FEATURE_MULTI_MODAL_RESPONSES
    - _Requirements: 36.1_
  
  - [ ] 26.2 Implement feature flag fallback behavior
    - When disabled, fall back to previous behavior without errors
    - Log feature flag usage and success rates
    - _Requirements: 36.2, 36.4_
  
  - [ ] 26.3 Implement tenant-specific feature flags
    - Enable features for specific users or tenants for testing
    - Track feature flag usage by tenant
    - _Requirements: 36.3_
  
  - [ ]* 26.4 Write property test for feature flag fallback
    - **Property 28: Feature Flag Fallback**
    - **Validates: Requirements 36.2**
    - Test that disabled features fall back without errors
  
  - [ ]* 26.5 Write unit tests for feature flags
    - Test each feature flag enabled/disabled
    - Test tenant-specific feature flags
    - Test fallback behavior
    - _Requirements: 36.1, 36.2, 36.3_

- [ ] 27. Implement rollback and error recovery
  - [ ] 27.1 Implement prompt version rollback
    - Maintain previous prompt versions
    - Support immediate rollback to previous version
    - _Requirements: 35.1, 35.2_
  
  - [ ] 27.2 Implement formula cache invalidation
    - Support invalidating incorrect cached formulas
    - Log invalidation events
    - _Requirements: 35.3_
  
  - [ ] 27.3 Implement automatic fallback on critical errors
    - Fall back to safe defaults (no dynamic calculations, text-only responses)
    - Log critical errors for investigation
    - _Requirements: 35.5_
  
  - [ ]* 27.4 Write unit tests for rollback procedures
    - Test prompt version rollback
    - Test formula cache invalidation
    - Test automatic fallback on errors
    - _Requirements: 35.1, 35.2, 35.3, 35.5_

- [ ] 28. Implement enhanced monitoring and alerting
  - [ ] 28.1 Add Phase 4 metrics
    - Dynamic calculation success rate
    - Chart generation success rate
    - Code interpreter success rate
    - Formula cache hit rate
    - Formula validation failure rate
    - _Requirements: 37.3, 37.6, 37.7_
  
  - [ ] 28.2 Add Phase 4 alerts
    - Alert when dynamic calculation success rate < 90%
    - Alert when formula validation failures > 10%
    - Alert on code interpreter security violations
    - _Requirements: 37.5, 37.7_
  
  - [ ]* 28.3 Write unit tests for monitoring
    - Test metric collection for all Phase 4 features
    - Test alert triggering at thresholds
    - _Requirements: 37.3, 37.5, 37.6, 37.7_

- [ ] 29. Implement user feedback collection
  - [ ] 29.1 Add feedback buttons to responses
    - Thumbs up/down buttons on all responses
    - Prompt for details on negative feedback
    - _Requirements: 39.1, 39.2_
  
  - [ ] 29.2 Implement feedback storage
    - Store feedback with query, response, and intent
    - Enable analysis of feedback patterns
    - _Requirements: 39.3, 39.4_
  
  - [ ]* 29.3 Write property test for feedback storage
    - **Property 30: Feedback Storage**
    - **Validates: Requirements 39.3**
    - Test that all feedback is stored with required metadata
  
  - [ ]* 29.4 Write unit tests for feedback collection
    - Test feedback button rendering
    - Test feedback storage
    - Test feedback detail prompts
    - _Requirements: 39.1, 39.2, 39.3_

- [ ] 30. Phase 4 checkpoint and git tag
  - Run all Phase 4 tests (unit + property + integration + security)
  - Verify dynamic calculation success rate > 90%
  - Verify formula validation prevents incorrect calculations
  - Verify code interpreter sandboxing works correctly
  - Test end-to-end dynamic calculation query
  - Test end-to-end peer comparison query
  - Test end-to-end multi-modal response
  - Update CHANGELOG with Phase 4 changes
  - Create git tag `rag-extraction-phase4-v1.0.0`
  - Document rollback procedure and feature flags
  - _Requirements: 35.1, 36.1_

## Final Integration and Documentation

- [ ] 31. Create comprehensive documentation
  - [ ] 31.1 Write API documentation
    - Document all services (Intent Detector, Semantic Retriever, Dynamic Calculator, Chart Generator, Code Interpreter)
    - Include examples for each intent type and calculation type
    - _Requirements: 40.1, 40.2_
  
  - [ ] 31.2 Write formula validation documentation
    - Explain formula validation process
    - Document safety measures
    - Provide examples of valid and invalid formulas
    - _Requirements: 40.3_
  
  - [ ] 31.3 Write troubleshooting guide
    - Document common issues and solutions
    - Include rollback procedures for each phase
    - Provide debugging tips
    - _Requirements: 40.4_
  
  - [ ] 31.4 Update documentation for new features
    - Keep documentation in sync with feature additions
    - Document all feature flags
    - _Requirements: 40.5_

- [ ] 32. Final end-to-end testing
  - Test all 4 phases together
  - Test rollback from Phase 4 to Phase 3, Phase 2, Phase 1
  - Test feature flag combinations
  - Verify all success rate targets met
  - Verify all latency targets met
  - Verify all monitoring and alerting works
  - _Requirements: 33.1-33.12, 38.1-38.5_

- [ ] 33. Production deployment preparation
  - Create deployment runbook
  - Document rollback procedures for production
  - Set up monitoring dashboards
  - Configure alerting thresholds
  - Train team on new features
  - _Requirements: 35.1, 36.1, 37.1-37.7_

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at phase boundaries
- Property tests validate universal correctness properties (minimum 100 iterations each)
- Unit tests validate specific examples and edge cases
- Each phase has clear success criteria before moving to next phase
- Git tags enable clean rollback to any phase
- Feature flags enable gradual rollout and quick disabling of problematic features

