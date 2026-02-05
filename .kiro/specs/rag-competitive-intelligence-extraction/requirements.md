# Requirements Document

## Introduction

This specification addresses critical failures in the Research Assistant (RAG system) where competitive intelligence, MD&A insights, and footnote details are not being extracted from SEC filings despite correct section identification. The system currently identifies where information should be located but fails to extract and present the actual content, undermining the core value proposition of the platform.

## Glossary

- **RAG_System**: The Research Assistant retrieval-augmented generation system that processes queries against SEC filing data
- **Semantic_Retriever**: The component responsible for retrieving relevant narrative chunks using vector search (Bedrock KB) or keyword search (PostgreSQL)
- **Intent_Detector**: The component that analyzes user queries to determine query type and target sections
- **Section_Parser**: The Python component that extracts sections from SEC filings and creates narrative chunks
- **Bedrock_KB**: AWS Bedrock Knowledge Base providing vector-based semantic search
- **Narrative_Chunk**: A segment of SEC filing text stored with metadata (ticker, section_type, filing_type, content)
- **Subsection**: Fine-grained divisions within major SEC sections (e.g., "Competition" within Item 1 Business)
- **Competitive_Intelligence**: Information about competitors, market positioning, competitive advantages/disadvantages extracted from filings
- **MD&A**: Management Discussion and Analysis section (Item 7) containing trends, risks, and forward guidance
- **Footnote**: Detailed accounting policy and supplementary information (Item 8 Notes to Financial Statements)
- **Response_Generator**: The component that synthesizes retrieved chunks into user-facing responses using Claude
- **Reranker**: A model that re-scores retrieved chunks to improve relevance ranking (e.g., Mistral reranking via Bedrock)
- **Qualitative_Engine**: The narrative-based RAG system that extracts insights from SEC filing text
- **Quantitative_Engine**: The deterministic Python-based system that extracts structured financial metrics from XBRL data
- **Hybrid_Response**: A response that combines both qualitative narrative insights and quantitative financial metrics
- **HyDE**: Hypothetical Document Embeddings - a technique that generates synthetic documents to improve retrieval
- **Query_Decomposition**: Breaking complex queries into simpler sub-queries for better retrieval
- **Contextual_Expansion**: Retrieving surrounding chunks to provide complete context
- **Few-Shot_Learning**: Providing example inputs/outputs in prompts to guide model behavior
- **Iterative_Retrieval**: Refining retrieval through follow-up queries based on initial results
- **Dynamic_Metric_Calculation**: Computing financial metrics on-demand using formulas derived from queries
- **Chart_Generator**: Service that creates chart configurations for visual data representation
- **Code_Interpreter**: Sandboxed Python execution environment for complex financial calculations
- **Multi-Modal_Response**: Response that includes text, tables, charts, and code
- **Formula_Cache**: Database storage for validated formulas to enable reuse and consistency
- **Feature_Flag**: Configuration toggle to enable/disable features for gradual rollout
- **Audit_Log**: Record of all system operations for debugging and compliance

## Requirements

### Requirement 1: Universal Subsection-Aware Section Extraction

**User Story:** As a system component, I want to preserve subsection structure during section parsing for ALL SEC filing sections, so that retrieval can target fine-grained content at the subsection level for any query type.

#### Acceptance Criteria

1. WHEN the Section_Parser extracts ANY major section (Item 1-16, Part I/II), THE Section_Parser SHALL identify and label ALL subsections within that section
2. WHEN the Section_Parser extracts Item 1 (Business), THE Section_Parser SHALL identify subsections including: Competition, Products, Customers, Markets, Operations, Strategy, Intellectual Property, Human Capital
3. WHEN the Section_Parser extracts Item 7 (MD&A), THE Section_Parser SHALL identify subsections including: Results of Operations, Liquidity and Capital Resources, Critical Accounting Policies, Market Risk, Contractual Obligations, Off-Balance Sheet Arrangements
4. WHEN the Section_Parser extracts Item 8 (Financial Statements), THE Section_Parser SHALL identify subsections including: Note 1, Note 2, etc., and specific policy topics (Revenue Recognition, Leases, Stock-Based Compensation, etc.)
5. WHEN the Section_Parser extracts Item 1A (Risk Factors), THE Section_Parser SHALL identify subsections by risk category (Operational Risks, Financial Risks, Market Risks, Regulatory Risks, etc.)
6. WHEN creating narrative chunks, THE Section_Parser SHALL ALWAYS include subsection metadata in addition to section_type
7. WHEN a subsection is identified, THE Narrative_Chunk SHALL store subsection_name in metadata
8. THE Section_Parser SHALL maintain backward compatibility with existing section_type values (item_1, item_7, item_8)
9. WHEN subsection boundaries cannot be determined, THE Section_Parser SHALL label chunks with subsection_name as null
10. THE Section_Parser SHALL support hierarchical subsections (e.g., Item 7 > Results of Operations > Revenue Analysis)

### Requirement 2: Subsection-Aware Intent Detection for ALL Query Types

**User Story:** As an analyst, I want the system to identify target subsections for ALL query types (structured, semantic, hybrid), so that retrieval can target fine-grained content regardless of query type.

**CRITICAL CLARIFICATION**: This requirement enhances the EXISTING intent detector (which already handles structured queries, semantic queries, hybrid queries, metrics, periods, document types, sections, comparisons, trends, etc.) by ADDING subsection identification. It does NOT replace the existing system with a narrow competitive-intelligence-only detector.

#### Acceptance Criteria

1. WHEN the Intent_Detector identifies a section_type (item_1, item_7, item_8, item_1a), THE Intent_Detector SHALL ALSO identify the target subsection_name when query keywords match subsection patterns
2. WHEN a query contains terms "competitors", "competitive landscape", "competition", or "peer comparison", THE Intent_Detector SHALL set sectionTypes=['item_1'] and subsectionName='Competition'
3. WHEN a query asks "Who are [TICKER]'s competitors?", THE Intent_Detector SHALL extract the ticker, set type='semantic', sectionTypes=['item_1'], and subsectionName='Competition'
4. WHEN a query asks "What is [TICKER]'s revenue recognition policy?", THE Intent_Detector SHALL set type='semantic', sectionTypes=['item_8'], and subsectionName='Revenue Recognition'
5. WHEN a query asks "What is [TICKER]'s revenue and how do they recognize it?", THE Intent_Detector SHALL set type='hybrid', metrics=['Revenue'], sectionTypes=['item_8'], and subsectionName='Revenue Recognition'
6. WHEN multiple subsection patterns match, THE Intent_Detector SHALL prioritize the most specific subsection
7. WHEN no subsection pattern matches, THE Intent_Detector SHALL leave subsectionName as undefined (existing behavior preserved)

### Requirement 3: MD&A Subsection Detection

**User Story:** As an analyst, I want the system to identify MD&A subsections for queries targeting management discussion, so that retrieval targets relevant MD&A subsections.

#### Acceptance Criteria

1. WHEN a query contains terms "growth drivers", "trends", "outlook", "guidance", or "management discussion", THE Intent_Detector SHALL set sectionTypes=['item_7']
2. WHEN MD&A queries mention specific topics, THE Intent_Detector SHALL identify the relevant subsection:
   - "results of operations", "operating results", "performance" → subsectionName='Results of Operations'
   - "liquidity", "capital resources", "cash flow" → subsectionName='Liquidity and Capital Resources'
   - "critical accounting", "accounting policies", "estimates" → subsectionName='Critical Accounting Policies'
   - "market risk", "interest rate risk", "currency risk" → subsectionName='Market Risk'
3. WHEN MD&A queries are ambiguous, THE Intent_Detector SHALL set sectionTypes=['item_7'] without subsectionName (existing behavior)
4. THE Intent_Detector SHALL preserve existing query type classification (structured, semantic, hybrid) while adding subsection identification

### Requirement 4: Footnote Subsection Detection

**User Story:** As an analyst, I want the system to identify specific footnote subsections, so that retrieval targets Item 8 Notes to Financial Statements with subsection precision.

#### Acceptance Criteria

1. WHEN a query contains terms "footnote", "accounting policy", "revenue recognition", "lease accounting", or "note [number]", THE Intent_Detector SHALL set sectionTypes=['item_8']
2. WHEN footnote queries mention specific policies, THE Intent_Detector SHALL identify the relevant subsection:
   - "revenue recognition", "revenue policy" → subsectionName='Revenue Recognition'
   - "leases", "lease accounting" → subsectionName='Leases'
   - "stock-based compensation", "equity compensation" → subsectionName='Stock-Based Compensation'
   - "income taxes", "tax provision" → subsectionName='Income Taxes'
   - "debt", "borrowings", "credit facilities" → subsectionName='Debt'
   - "fair value", "fair value measurements" → subsectionName='Fair Value'
3. WHEN a query references a specific note number (e.g., "Note 3"), THE Intent_Detector SHALL extract the note number for targeted retrieval
4. THE Intent_Detector SHALL recognize accounting policy terms (depreciation, amortization, inventory valuation) and set sectionTypes=['item_8']
5. WHEN a query asks about financial statement details without specific subsection keywords, THE Intent_Detector SHALL set sectionTypes=['item_8'] without subsectionName

### Requirement 5: Subsection-Aware Semantic Retrieval

**User Story:** As a system component, I want to filter retrieval by subsection when available, so that competitive intelligence queries return Competition-specific content.

#### Acceptance Criteria

1. WHEN the Intent_Detector specifies a subsection, THE Semantic_Retriever SHALL filter results by both section_type and subsection_name
2. WHEN using Bedrock_KB, THE Semantic_Retriever SHALL include subsection metadata in retrieval filters
3. WHEN using PostgreSQL fallback, THE Semantic_Retriever SHALL filter by subsection_name in WHERE clauses
4. WHEN subsection is null, THE Semantic_Retriever SHALL filter by section_type only
5. WHEN no chunks match the subsection filter, THE Semantic_Retriever SHALL fall back to section_type filtering

### Requirement 5A: Retrieval Re-ranking for Improved Accuracy

**User Story:** As a system component, I want to re-rank retrieved chunks using a specialized model, so that the most relevant chunks are prioritized for response generation.

#### Acceptance Criteria

1. WHEN the Semantic_Retriever retrieves initial chunks, THE Reranker SHALL re-score chunks using a reranking model (Mistral reranking via Bedrock)
2. WHEN re-ranking is complete, THE Reranker SHALL sort chunks by reranked scores in descending order
3. WHEN the Reranker is unavailable, THE Semantic_Retriever SHALL fall back to original retrieval scores
4. THE Reranker SHALL accept query text and chunk content as inputs and return relevance scores (0.0 to 1.0)
5. WHEN re-ranking fails for specific chunks, THE Reranker SHALL preserve original scores for those chunks

### Requirement 6: Structured Competitive Intelligence Extraction

**User Story:** As an analyst, I want competitive intelligence queries to extract structured information (competitor names, market positioning), so that I receive actionable insights.

#### Acceptance Criteria

1. WHEN the Response_Generator receives competitive_intelligence intent, THE Response_Generator SHALL extract competitor names from retrieved chunks
2. WHEN competitor names are extracted, THE Response_Generator SHALL provide context for each competitor (market segment, competitive threat level)
3. WHEN competitive positioning is discussed, THE Response_Generator SHALL extract competitive advantages and disadvantages
4. THE Response_Generator SHALL structure competitive intelligence as: Competitors List, Market Positioning, Competitive Advantages, Competitive Disadvantages
5. WHEN market share data is present, THE Response_Generator SHALL extract and present it

### Requirement 7: Structured MD&A Intelligence Extraction

**User Story:** As an analyst, I want MD&A queries to extract structured insights (trends, risks, guidance), so that I understand management's perspective.

#### Acceptance Criteria

1. WHEN the Response_Generator receives mda_intelligence intent, THE Response_Generator SHALL extract key trends from retrieved chunks
2. WHEN risks are discussed, THE Response_Generator SHALL extract and categorize risks (operational, market, regulatory)
3. WHEN forward guidance is present, THE Response_Generator SHALL extract guidance statements with timeframes
4. THE Response_Generator SHALL structure MD&A intelligence as: Key Trends, Risks and Challenges, Forward Guidance, Management Perspective
5. WHEN quantitative metrics are mentioned, THE Response_Generator SHALL extract and highlight them

### Requirement 8: Footnote Content Extraction

**User Story:** As an analyst, I want footnote queries to extract specific accounting policy details, so that I understand financial statement preparation.

#### Acceptance Criteria

1. WHEN the Response_Generator receives footnote intent, THE Response_Generator SHALL extract relevant accounting policy text from Item 8 chunks
2. WHEN a specific note number is requested, THE Response_Generator SHALL prioritize chunks containing that note number
3. WHEN accounting policies are extracted, THE Response_Generator SHALL preserve technical terminology and numerical details
4. THE Response_Generator SHALL structure footnote content as: Policy Summary, Key Assumptions, Quantitative Details, Changes from Prior Periods
5. WHEN multiple related policies are found, THE Response_Generator SHALL group them logically

### Requirement 9: Citation and Source Attribution

**User Story:** As an analyst, I want all extracted information to include citations, so that I can verify claims and trace information to source documents.

#### Acceptance Criteria

1. WHEN the Response_Generator presents extracted information, THE Response_Generator SHALL include section references (Item 1, Item 7, Item 8)
2. WHEN subsection information is available, THE Response_Generator SHALL include subsection names in citations
3. WHEN multiple chunks contribute to an insight, THE Response_Generator SHALL cite all contributing chunks
4. THE Response_Generator SHALL format citations as: [Section] - [Subsection] (Filing Type, Filing Date)
5. WHEN confidence in extraction is low, THE Response_Generator SHALL indicate uncertainty in citations

### Requirement 10: Multi-Company Query Isolation

**User Story:** As an analyst, I want multi-company queries to maintain strict ticker separation, so that competitor information is never mixed between companies.

#### Acceptance Criteria

1. WHEN a query references multiple tickers, THE Semantic_Retriever SHALL process each ticker independently
2. WHEN retrieving chunks for multiple tickers, THE Semantic_Retriever SHALL enforce ticker-based filtering for each retrieval
3. WHEN the Response_Generator synthesizes multi-company results, THE Response_Generator SHALL clearly separate information by ticker
4. THE RAG_System SHALL validate that no chunk from ticker A appears in ticker B's results
5. WHEN ticker separation fails validation, THE RAG_System SHALL return an error rather than mixed results

### Requirement 11: Extraction Confidence Scoring

**User Story:** As an analyst, I want confidence scores for extracted insights, so that I can assess the reliability of information.

#### Acceptance Criteria

1. WHEN the Response_Generator extracts structured information, THE Response_Generator SHALL assign a confidence score (0.0 to 1.0)
2. WHEN competitor names are extracted, THE Response_Generator SHALL score confidence based on explicit mentions and context clarity
3. WHEN confidence is below 0.7, THE Response_Generator SHALL indicate uncertainty to the user
4. THE Response_Generator SHALL base confidence on: chunk relevance scores, explicit vs. inferred information, consistency across chunks
5. WHEN no relevant information is found, THE Response_Generator SHALL return confidence 0.0 with explanation

### Requirement 12: Fallback Retrieval Strategy

**User Story:** As a system component, I want graceful fallback when subsection retrieval fails, so that queries still return relevant information.

#### Acceptance Criteria

1. WHEN subsection-filtered retrieval returns zero chunks, THE Semantic_Retriever SHALL retry with section_type filtering only
2. WHEN section-filtered retrieval returns zero chunks, THE Semantic_Retriever SHALL retry with broader semantic search
3. WHEN Bedrock_KB is unavailable, THE Semantic_Retriever SHALL fall back to PostgreSQL keyword search
4. THE Semantic_Retriever SHALL log fallback events for monitoring and debugging
5. WHEN all retrieval strategies fail, THE Semantic_Retriever SHALL return an empty result set with explanation

### Requirement 13: Response Quality Validation

**User Story:** As a system component, I want to validate response quality before returning to users, so that institutional-grade accuracy is maintained.

#### Acceptance Criteria

1. WHEN the Response_Generator produces a response, THE Response_Generator SHALL validate that all claims are supported by retrieved chunks
2. WHEN competitor names are listed, THE Response_Generator SHALL verify each name appears in source chunks
3. WHEN quantitative data is presented, THE Response_Generator SHALL verify exact matches in source chunks
4. THE Response_Generator SHALL reject responses where confidence scores are below minimum thresholds (0.5 for competitive intelligence)
5. WHEN validation fails, THE Response_Generator SHALL return a qualified response indicating limitations

### Requirement 14: Prompt Engineering for Extraction

**User Story:** As a system component, I want specialized prompts for each extraction type, so that Claude extracts information accurately.

#### Acceptance Criteria

1. WHEN the Response_Generator handles competitive_intelligence intent, THE Response_Generator SHALL use a prompt template optimized for competitor extraction
2. WHEN the Response_Generator handles mda_intelligence intent, THE Response_Generator SHALL use a prompt template optimized for trend and risk extraction
3. WHEN the Response_Generator handles footnote intent, THE Response_Generator SHALL use a prompt template optimized for policy extraction
4. THE Response_Generator SHALL include explicit instructions to extract structured information (lists, categories, metrics)
5. WHEN prompts are updated, THE Response_Generator SHALL maintain backward compatibility with existing intent types

### Requirement 15: Database Schema Enhancement

**User Story:** As a system component, I want to store subsection metadata in the database, so that retrieval can filter by subsection.

#### Acceptance Criteria

1. THE narrative_chunks table SHALL include a subsection_name column (nullable text)
2. WHEN new chunks are inserted, THE Section_Parser SHALL populate subsection_name when available
3. THE narrative_chunks table SHALL maintain indexes on (ticker, section_type, subsection_name) for efficient retrieval
4. WHEN existing chunks lack subsection_name, THE system SHALL support null values without errors
5. THE Section_Parser SHALL support backfilling subsection_name for existing chunks

### Requirement 16: Bedrock KB Metadata Synchronization

**User Story:** As a system component, I want subsection metadata synchronized to Bedrock KB, so that semantic search can filter by subsection.

#### Acceptance Criteria

1. WHEN the Section_Exporter exports chunks to S3 for Bedrock KB, THE Section_Exporter SHALL include subsection_name in metadata
2. WHEN Bedrock_KB ingests chunks, THE Bedrock_KB SHALL index subsection_name as a filterable attribute
3. WHEN the Semantic_Retriever queries Bedrock_KB, THE Semantic_Retriever SHALL include subsection_name in filter expressions
4. THE Section_Exporter SHALL support re-exporting existing chunks with updated metadata
5. WHEN subsection_name is null, THE Section_Exporter SHALL omit it from metadata rather than exporting null values

### Requirement 17: Monitoring and Observability

**User Story:** As a system administrator, I want to monitor extraction success rates, so that I can identify and fix failures.

#### Acceptance Criteria

1. THE RAG_System SHALL log extraction attempts with intent type, ticker, and success/failure status
2. WHEN extraction fails, THE RAG_System SHALL log the failure reason (no chunks found, low confidence, validation failure)
3. THE RAG_System SHALL expose metrics for: competitive intelligence success rate, MD&A success rate, footnote success rate
4. THE RAG_System SHALL track average confidence scores by intent type
5. WHEN success rates drop below thresholds (95% for competitive intelligence), THE RAG_System SHALL generate alerts

### Requirement 18: Hybrid Qualitative-Quantitative Responses

**User Story:** As an analyst, I want responses that combine narrative insights with financial metrics, so that I get comprehensive answers from both qualitative and quantitative sources.

#### Acceptance Criteria

1. WHEN a query can be answered by both Qualitative_Engine and Quantitative_Engine, THE RAG_System SHALL invoke both engines
2. WHEN the Quantitative_Engine has relevant financial metrics, THE Response_Generator SHALL include them in the response with proper formatting
3. WHEN the Qualitative_Engine has narrative context, THE Response_Generator SHALL combine it with quantitative metrics
4. THE Response_Generator SHALL clearly distinguish between qualitative insights (from narratives) and quantitative metrics (from XBRL)
5. WHEN only one engine has relevant data, THE Response_Generator SHALL use that engine's data without requiring both

### Requirement 19: Quantitative Engine Integration

**User Story:** As a system component, I want to query the deterministic Python engine for financial metrics, so that responses include accurate structured data.

#### Acceptance Criteria

1. WHEN a query requests financial metrics (revenue, EBITDA, margins), THE RAG_System SHALL invoke the Quantitative_Engine
2. WHEN the Quantitative_Engine returns metrics, THE Response_Generator SHALL format them with proper units and time periods
3. WHEN competitive intelligence queries request market share or financial comparisons, THE RAG_System SHALL combine qualitative competitor names with quantitative financial metrics
4. THE Quantitative_Engine SHALL return metrics with metadata: ticker, metric_name, value, unit, period, filing_date
5. WHEN quantitative data is unavailable, THE RAG_System SHALL rely solely on qualitative narrative extraction

### Requirement 20: Advanced Retrieval Techniques for Fine-Grained Details

**User Story:** As a system component, I want to use advanced retrieval techniques beyond basic semantic search, so that even the tiniest details can be extracted from narratives.

#### Acceptance Criteria

1. WHEN basic semantic retrieval returns insufficient detail, THE RAG_System SHALL employ hierarchical retrieval (retrieve parent chunks around matched chunks)
2. WHEN a query requires specific details, THE RAG_System SHALL use query decomposition to break complex queries into sub-queries
3. WHEN initial retrieval misses relevant content, THE RAG_System SHALL use hypothetical document embeddings (HyDE) to generate synthetic documents and re-retrieve
4. THE RAG_System SHALL support multi-hop retrieval for queries requiring information from multiple sections
5. WHEN chunks are retrieved, THE RAG_System SHALL optionally retrieve surrounding context chunks (chunk_index ± N) for better coherence

### Requirement 21: Contextual Chunk Expansion

**User Story:** As a system component, I want to expand retrieved chunks with surrounding context, so that responses have complete information without truncation.

#### Acceptance Criteria

1. WHEN a chunk is retrieved, THE Semantic_Retriever SHALL optionally fetch adjacent chunks (chunk_index - 1, chunk_index + 1)
2. WHEN adjacent chunks are fetched, THE Semantic_Retriever SHALL merge them into a coherent context window
3. WHEN merging chunks, THE Semantic_Retriever SHALL preserve chunk boundaries for citation purposes
4. THE Semantic_Retriever SHALL limit context expansion to a maximum token budget (e.g., 4000 tokens)
5. WHEN context expansion exceeds token budget, THE Semantic_Retriever SHALL prioritize chunks with highest relevance scores

### Requirement 22: Query Decomposition for Complex Queries

**User Story:** As a system component, I want to decompose complex queries into simpler sub-queries, so that multi-faceted questions are answered comprehensively.

#### Acceptance Criteria

1. WHEN a query contains multiple questions (e.g., "Who are NVDA's competitors and what are their market shares?"), THE Intent_Detector SHALL decompose it into sub-queries
2. WHEN sub-queries are identified, THE RAG_System SHALL execute each sub-query independently
3. WHEN sub-query results are retrieved, THE Response_Generator SHALL synthesize them into a unified response
4. THE RAG_System SHALL track which sub-query contributed to which part of the response for citation purposes
5. WHEN sub-queries conflict, THE Response_Generator SHALL prioritize the most recent or most relevant information

### Requirement 23: Hypothetical Document Embeddings (HyDE)

**User Story:** As a system component, I want to generate hypothetical documents for queries, so that retrieval can match semantic intent even when query phrasing differs from document phrasing.

#### Acceptance Criteria

1. WHEN a query is received, THE RAG_System SHALL optionally generate a hypothetical answer using Claude
2. WHEN a hypothetical answer is generated, THE RAG_System SHALL embed it and use it for retrieval alongside the original query
3. WHEN HyDE retrieval is used, THE RAG_System SHALL merge results from both query-based and HyDE-based retrieval
4. THE RAG_System SHALL deduplicate chunks retrieved by both methods
5. WHEN HyDE generation fails, THE RAG_System SHALL fall back to standard query-based retrieval

### Requirement 24: Prompt Fine-Tuning and Optimization

**User Story:** As a system administrator, I want to fine-tune prompts for extraction tasks, so that accuracy improves over time based on real-world usage.

#### Acceptance Criteria

1. THE RAG_System SHALL maintain a prompt library with versioned prompt templates for each intent type
2. WHEN extraction quality is low, THE system administrator SHALL be able to update prompt templates without code changes
3. THE RAG_System SHALL support A/B testing of prompt variants to measure effectiveness
4. WHEN prompt variants are tested, THE RAG_System SHALL track success rates and confidence scores for each variant
5. THE RAG_System SHALL automatically select the best-performing prompt variant based on historical performance

### Requirement 25: Few-Shot Learning for Extraction

**User Story:** As a system component, I want to use few-shot examples in extraction prompts, so that Claude understands the desired output format.

#### Acceptance Criteria

1. WHEN the Response_Generator uses extraction prompts, THE Response_Generator SHALL include 2-3 few-shot examples
2. WHEN few-shot examples are provided, THE examples SHALL demonstrate the desired output structure (competitor names, trends, policies)
3. THE Response_Generator SHALL select few-shot examples relevant to the query domain (tech companies for NVDA, retail for WMT)
4. WHEN few-shot examples are unavailable for a domain, THE Response_Generator SHALL use generic examples
5. THE RAG_System SHALL maintain a few-shot example library that can be expanded over time

### Requirement 26: Iterative Retrieval and Refinement

**User Story:** As a system component, I want to iteratively refine retrieval based on initial results, so that missing information can be found through follow-up queries.

#### Acceptance Criteria

1. WHEN initial retrieval returns low-confidence results, THE RAG_System SHALL generate follow-up queries to fill gaps
2. WHEN follow-up queries are generated, THE RAG_System SHALL execute them and merge results with initial retrieval
3. THE RAG_System SHALL limit iterative retrieval to a maximum of 2 iterations to control latency and cost
4. WHEN iterative retrieval is used, THE RAG_System SHALL track which iteration contributed to which information
5. WHEN iterative retrieval does not improve results, THE RAG_System SHALL stop and return initial results

### Requirement 27: Dynamic Metric Calculation

**User Story:** As an analyst, I want to request custom financial metric calculations not pre-computed by the system, so that I can perform ad-hoc analysis.

#### Acceptance Criteria

1. WHEN a query requests a metric not in the database, THE RAG_System SHALL detect the calculation request
2. WHEN a calculation is detected, THE RAG_System SHALL extract the formula from the query (e.g., "EBITDA margin = EBITDA / Revenue")
3. WHEN a formula is extracted, THE RAG_System SHALL retrieve the required component metrics from RDS
4. WHEN component metrics are retrieved, THE RAG_System SHALL execute the calculation using the Quantitative_Engine
5. WHEN the calculation is complete, THE Response_Generator SHALL present the result with the formula and component values

### Requirement 28: LLM-Assisted Metric Calculation

**User Story:** As an analyst, I want the system to understand natural language metric requests, so that I don't need to specify exact formulas.

#### Acceptance Criteria

1. WHEN a query requests a metric calculation in natural language (e.g., "calculate operating leverage"), THE RAG_System SHALL use Claude to generate the appropriate formula
2. WHEN Claude generates a formula, THE RAG_System SHALL validate it against known financial formulas
3. WHEN the formula is validated, THE RAG_System SHALL display the formula to the user for transparency
4. WHEN component metrics are missing, THE RAG_System SHALL inform the user which metrics are unavailable
5. WHEN the calculation succeeds, THE Response_Generator SHALL explain the formula and show the calculation steps with all intermediate values

### Requirement 28A: Formula Caching and Reuse

**User Story:** As a system component, I want to cache validated formulas for future use, so that repeated calculations are faster and more consistent.

#### Acceptance Criteria

1. WHEN a formula is successfully validated and executed, THE RAG_System SHALL store it in a formula cache with metadata (metric name, formula, required components, validation status)
2. WHEN a cached formula exists for a metric, THE RAG_System SHALL reuse it instead of regenerating
3. WHEN a cached formula is reused, THE RAG_System SHALL still display it to the user for transparency
4. THE formula cache SHALL support versioning to track formula changes over time
5. WHEN a formula fails validation or execution, THE RAG_System SHALL NOT cache it

### Requirement 29: Peer Comparison with Dynamic Metrics

**User Story:** As an analyst, I want to compare custom metrics across peer companies, so that I can perform competitive analysis.

#### Acceptance Criteria

1. WHEN a query requests peer comparison with a custom metric, THE RAG_System SHALL identify the peer companies
2. WHEN peers are identified, THE RAG_System SHALL calculate the custom metric for each peer independently
3. WHEN calculations are complete, THE Response_Generator SHALL present results in a comparison table
4. THE Response_Generator SHALL highlight the best and worst performers for the metric
5. WHEN peer data is incomplete, THE Response_Generator SHALL indicate which peers have missing data

### Requirement 30: Multi-Modal Response Generation

**User Story:** As an analyst, I want responses to include charts and tables when appropriate, so that I can visualize data more effectively.

#### Acceptance Criteria

1. WHEN a query requests trend analysis, THE Response_Generator SHALL generate a line chart showing the metric over time
2. WHEN a query requests peer comparison, THE Response_Generator SHALL generate a bar chart or table comparing companies
3. WHEN a query requests composition analysis, THE Response_Generator SHALL generate a pie chart or stacked bar chart
4. THE Response_Generator SHALL return charts in a format compatible with the frontend (e.g., Chart.js config, SVG, or data arrays)
5. WHEN chart generation fails, THE Response_Generator SHALL fall back to tabular or text representation

### Requirement 31: Chart Generation Service

**User Story:** As a system component, I want a dedicated service for generating chart configurations, so that responses can include visualizations.

#### Acceptance Criteria

1. THE Chart_Generator SHALL accept data arrays and chart type (line, bar, pie, scatter)
2. WHEN data is provided, THE Chart_Generator SHALL generate a Chart.js configuration object
3. WHEN generating charts, THE Chart_Generator SHALL apply consistent styling (colors, fonts, labels)
4. THE Chart_Generator SHALL support multiple chart types: line (trends), bar (comparisons), pie (composition), scatter (correlation)
5. WHEN data is unsuitable for the requested chart type, THE Chart_Generator SHALL suggest an alternative chart type

### Requirement 32: Code Interpreter for Complex Calculations

**User Story:** As an analyst, I want the system to execute complex financial calculations using Python, so that I can perform advanced analysis.

#### Acceptance Criteria

1. WHEN a query requires complex calculations beyond simple formulas, THE RAG_System SHALL generate Python code to perform the calculation
2. WHEN Python code is generated, THE RAG_System SHALL execute it in a sandboxed environment
3. WHEN code execution succeeds, THE Response_Generator SHALL present the results with the code used
4. WHEN code execution fails, THE RAG_System SHALL retry with a corrected version or inform the user of the error
5. THE RAG_System SHALL support calculations including: regression analysis, correlation matrices, scenario modeling, sensitivity analysis

### Requirement 33: Comprehensive Testing Strategy

**User Story:** As a developer, I want comprehensive tests for all extraction and calculation functionality, so that regressions are caught early and the system is reliable.

#### Acceptance Criteria

1. THE test suite SHALL include unit tests for Intent_Detector with competitive intelligence, MD&A, and footnote queries
2. THE test suite SHALL include integration tests for end-to-end extraction with real SEC filing data
3. THE test suite SHALL validate that multi-company queries maintain ticker separation
4. THE test suite SHALL verify that confidence scores are calculated correctly
5. THE test suite SHALL include property-based tests for subsection filtering logic
6. THE test suite SHALL validate hybrid responses combine qualitative and quantitative data correctly
7. THE test suite SHALL verify re-ranking improves retrieval relevance compared to baseline
8. THE test suite SHALL include tests for dynamic metric calculation with known formulas
9. THE test suite SHALL validate formula extraction and execution accuracy
10. THE test suite SHALL test chart generation for all supported chart types
11. THE test suite SHALL include tests for code interpreter with sandboxed execution
12. THE test suite SHALL achieve minimum 90% code coverage for all new components

### Requirement 34: Formula Validation and Safety

**User Story:** As a system administrator, I want strict validation of generated formulas, so that incorrect calculations are prevented.

#### Acceptance Criteria

1. WHEN a formula is generated, THE RAG_System SHALL validate it against a library of known financial formulas
2. WHEN a formula uses unknown operations, THE RAG_System SHALL reject it and request user confirmation
3. WHEN a formula is executed, THE RAG_System SHALL validate that the result is within reasonable bounds (e.g., margins between 0-100%)
4. THE RAG_System SHALL maintain a whitelist of allowed mathematical operations (arithmetic, basic functions)
5. WHEN formula validation fails, THE RAG_System SHALL log the failure and present the formula to the user for manual review

### Requirement 35: Rollback and Error Recovery

**User Story:** As a system administrator, I want the ability to rollback changes and recover from errors, so that the system remains stable.

#### Acceptance Criteria

1. WHEN a new prompt version is deployed, THE RAG_System SHALL maintain the previous version for rollback
2. WHEN a prompt version causes errors, THE system administrator SHALL be able to rollback to the previous version immediately
3. WHEN a cached formula produces incorrect results, THE system administrator SHALL be able to invalidate the cache entry
4. THE RAG_System SHALL maintain audit logs of all formula executions with inputs, outputs, and timestamps
5. WHEN critical errors occur, THE RAG_System SHALL automatically fall back to safe defaults (no dynamic calculations, text-only responses)

### Requirement 36: Gradual Rollout and Feature Flags

**User Story:** As a system administrator, I want to gradually roll out new features, so that risks are minimized.

#### Acceptance Criteria

1. THE RAG_System SHALL support feature flags for: subsection retrieval, re-ranking, HyDE, iterative retrieval, dynamic calculations, multi-modal responses, code interpreter
2. WHEN a feature flag is disabled, THE RAG_System SHALL fall back to the previous behavior without errors
3. THE system administrator SHALL be able to enable features for specific users or tenants for testing
4. THE RAG_System SHALL track feature flag usage and success rates
5. WHEN a feature flag shows low success rates, THE system administrator SHALL be able to disable it immediately

### Requirement 37: Monitoring and Alerting

**User Story:** As a system administrator, I want comprehensive monitoring and alerting, so that issues are detected and resolved quickly.

#### Acceptance Criteria

1. THE RAG_System SHALL log extraction attempts with intent type, ticker, success/failure status, and latency
2. WHEN extraction fails, THE RAG_System SHALL log the failure reason (no chunks found, low confidence, validation failure, formula error)
3. THE RAG_System SHALL expose metrics for: competitive intelligence success rate, MD&A success rate, footnote success rate, dynamic calculation success rate, chart generation success rate
4. THE RAG_System SHALL track average confidence scores by intent type
5. WHEN success rates drop below thresholds (95% for competitive intelligence, 90% for dynamic calculations), THE RAG_System SHALL generate alerts
6. THE RAG_System SHALL track formula cache hit rates and invalidation rates
7. WHEN formula validation failures exceed 10% of attempts, THE RAG_System SHALL generate alerts

### Requirement 38: Performance and Scalability

**User Story:** As a system component, I want to maintain low latency and high throughput, so that the analyst experience remains responsive.

#### Acceptance Criteria

1. THE RAG_System SHALL respond to standard queries within 5 seconds (p95)
2. THE RAG_System SHALL respond to dynamic calculation queries within 8 seconds (p95)
3. THE RAG_System SHALL respond to code interpreter queries within 15 seconds (p95)
4. THE RAG_System SHALL support at least 100 concurrent users without degradation
5. WHEN latency exceeds thresholds, THE RAG_System SHALL log slow queries for optimization

### Requirement 39: User Feedback and Continuous Improvement

**User Story:** As an analyst, I want to provide feedback on responses, so that the system improves over time.

#### Acceptance Criteria

1. THE RAG_System SHALL provide thumbs up/down feedback buttons on all responses
2. WHEN feedback is negative, THE RAG_System SHALL prompt the user for details (incorrect information, missing information, poor formatting)
3. WHEN feedback is collected, THE RAG_System SHALL store it with the query, response, and intent for analysis
4. THE system administrator SHALL be able to review feedback and identify patterns
5. WHEN patterns are identified, THE system administrator SHALL be able to update prompts, formulas, or retrieval strategies

### Requirement 40: Documentation and Training

**User Story:** As a developer, I want comprehensive documentation, so that I can understand and maintain the system.

#### Acceptance Criteria

1. THE RAG_System SHALL include API documentation for all services (Intent Detector, Semantic Retriever, Dynamic Calculator, Chart Generator, Code Interpreter)
2. THE documentation SHALL include examples for each intent type and calculation type
3. THE documentation SHALL explain the formula validation process and safety measures
4. THE documentation SHALL include troubleshooting guides for common issues
5. THE documentation SHALL be updated whenever new features are added
