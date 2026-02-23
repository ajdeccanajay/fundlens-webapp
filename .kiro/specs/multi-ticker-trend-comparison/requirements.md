# Requirements Document

## Introduction

FundLens's RAG-based equity research pipeline fails on four categories of analyst queries: (1) qualitative/disclosure queries about accounting policies and footnotes return nothing, (2) lease and stock-based compensation queries return nothing, (3) segment queries return weak/incomplete answers, and (4) multi-ticker trend comparison queries produce broken responses. Root causes span six services: `IntentDetectorService`, `QueryRouterService`, `SemanticRetrieverService`, `StructuredRetrieverService`, `VisualizationGeneratorService`, and `ResponseEnrichmentService`. The defects include section type mismatches between the `SectionType` type definition and actual Bedrock KB metadata values, incorrect default section routing in hybrid/concept plans, missing multi-section routing for segment queries, broken multi-year period extraction, single-ticker-only trend visualization, and context ticker suppression of query-mentioned tickers.

## Glossary

- **Intent_Detector**: The `IntentDetectorService` that parses natural language queries into structured `QueryIntent` objects, extracting tickers, metrics, periods, section types, and query characteristics.
- **Period_Extractor**: The `extractPeriod()` method within Intent_Detector that identifies time period references in queries.
- **Trend_Detector**: The `needsTrend()` method within Intent_Detector that determines whether a query requires historical trend analysis.
- **Section_Extractor**: The `extractSectionTypes()` method within Intent_Detector that identifies which 10-K sections a query targets (e.g., `item_1`, `item_7`, `item_8`).
- **Structured_Retriever**: The `StructuredRetrieverService` that fetches exact financial metrics from PostgreSQL.
- **Semantic_Retriever**: The `SemanticRetrieverService` that fetches narrative chunks from Bedrock Knowledge Base using vector search with metadata filters.
- **Visualization_Generator**: The `VisualizationGeneratorService` that produces chart payloads from metric results.
- **Response_Enrichment**: The `ResponseEnrichmentService` that computes YoY growth via `computeFinancials()` and attaches visualizations to RAG responses.
- **Query_Router**: The `QueryRouterService` that builds `StructuredQuery` and `SemanticQuery` objects from detected intent, routing to structured, semantic, or hybrid retrieval paths.
- **RAG_Orchestrator**: The `RAGService` that coordinates the full query pipeline from intent detection through retrieval, LLM generation, and response enrichment.
- **Section_Type_Value**: The metadata label stored on Bedrock KB chunks identifying which 10-K section a chunk belongs to. Actual values in the database and Bedrock KB are `item_1`, `item_1a`, `item_2`, `item_3`, `item_7`, `item_8` (not the `SectionType` union type values `mda`, `risk_factors`, etc.).
- **Period_Range**: A period specification representing a span of years (e.g., "past 5 years"), stored as `periodType: 'range'` with `periodStart` and `periodEnd` fields on `QueryIntent`.
- **Metric_Registry**: The `MetricRegistryService` with inverted synonym index for canonical metric resolution.
- **Concept_Registry**: The `ConceptRegistryService` for analytical question routing to metric bundles.

## Requirements

### Requirement 1: Section Type Alignment Between Type Definition and Runtime Values

**User Story:** As a developer, I want the `SectionType` type definition to match the actual metadata values stored in the database and Bedrock KB, so that TypeScript catches mismatches at compile time and default values in the query router produce valid Bedrock KB filters.

#### Acceptance Criteria

1. THE `SectionType` type definition SHALL include the values `item_1`, `item_1a`, `item_2`, `item_3`, `item_7`, and `item_8` that match the metadata stored in the Bedrock Knowledge Base.
2. WHEN the Query_Router builds a hybrid plan and the QueryIntent has no `sectionTypes`, THE Query_Router SHALL default `sectionTypes` to `['item_7']` instead of `['mda']`.
3. WHEN the Query_Router builds a concept plan, THE Query_Router SHALL default `sectionTypes` to `['item_7']` instead of `['mda']`.
4. THE `SemanticQuery.sectionTypes` field SHALL use the same `SectionType` values as the Bedrock KB metadata (`item_1`, `item_7`, `item_8`, etc.).

### Requirement 2: Qualitative Disclosure Query Retrieval

**User Story:** As a deep value equity analyst, I want queries about accounting policies, stock-based compensation, leases, and other footnote disclosures to return the relevant Notes to Financial Statements content, so that I can analyze a company's accounting treatment and policy choices.

#### Acceptance Criteria

1. WHEN a query asks about stock-based compensation, leases, income taxes, fair value measurements, or other footnote topics, THE Section_Extractor SHALL include `item_8` in the detected section types.
2. WHEN a semantic query has `sectionTypes` containing `item_8`, THE Semantic_Retriever SHALL search Bedrock KB chunks with `section_type` metadata equal to `item_8`.
3. WHEN a semantic query with section filtering returns zero results, THE Semantic_Retriever SHALL fall back to a broader ticker-only search (existing fallback behavior preserved).
4. WHEN a qualitative disclosure query is routed as `semantic` type with valid section types, THE Query_Router SHALL pass those section types through to the SemanticQuery without overriding them.

### Requirement 3: Multi-Section Routing for Segment Queries

**User Story:** As a deep value equity analyst, I want segment queries to search across Item 1 (Business), Item 7 (MD&A), and Item 8 (Notes) simultaneously, so that I get comprehensive segment information including definitions, financial discussion, and detailed breakdowns.

#### Acceptance Criteria

1. WHEN a query contains "segment", "segments", "business segment", or "operating segment", THE Section_Extractor SHALL include `item_1`, `item_7`, and `item_8` in the detected section types.
2. WHEN a query about segments is classified, THE Intent_Detector SHALL classify segment queries that mention segment counts or segment structure as `hybrid` type rather than `semantic` only.
3. WHEN a semantic query has multiple section types, THE Semantic_Retriever SHALL search each section type separately and merge results ranked by relevance score (existing multi-section search behavior).
4. WHEN the Query_Router builds a plan for a segment query with detected section types `[item_1, item_7, item_8]`, THE Query_Router SHALL pass all three section types to the SemanticQuery.

### Requirement 4: Multi-Year Period Extraction

**User Story:** As an equity analyst, I want the system to understand temporal phrases like "past 5 years" or "last 3 years" in my queries, so that the correct multi-year date range is extracted and used for data retrieval.

#### Acceptance Criteria

1. WHEN a query contains "past N years", "last N years", or "over the past N years", THE Period_Extractor SHALL return a period range with `periodType` set to `range`, `periodStart` set to the fiscal year N years before the current year, and `periodEnd` set to the current fiscal year.
2. WHEN a query contains "N-year" or "N year" (e.g., "5-year trend"), THE Period_Extractor SHALL extract N and return the corresponding period range.
3. WHEN a query contains "over the past decade", THE Period_Extractor SHALL return a period range spanning 10 years.
4. WHEN a query contains "year over year" or "yoy", THE Period_Extractor SHALL return a period range spanning at least 2 years.
5. WHEN a query contains both a multi-year phrase and a specific fiscal year, THE Period_Extractor SHALL prioritize the specific fiscal year over the multi-year phrase.

### Requirement 5: Expanded Trend Detection

**User Story:** As an equity analyst, I want the system to recognize all common phrasing for historical trend queries, so that trend analysis is triggered for queries like "how has it changed" or "past 5 years".

#### Acceptance Criteria

1. WHEN a query contains any of "past N years", "last N years", "how has it changed", "how has .* changed", "year over year", "yoy", "N-year", "multi-year", or "over the past", THE Trend_Detector SHALL return true.
2. WHEN the Trend_Detector returns true, THE Intent_Detector SHALL set `needsTrend` to true on the resulting QueryIntent.

### Requirement 6: Multi-Year Structured Retrieval

**User Story:** As an equity analyst, I want the structured retriever to fetch exactly the right number of years of annual data when a period range is specified, so that I get complete historical data for my analysis.

#### Acceptance Criteria

1. WHEN a StructuredQuery has `periodType` set to `range` with `periodStart` and `periodEnd`, THE Structured_Retriever SHALL query for all annual (10-K) metrics with fiscal periods between `periodStart` and `periodEnd` inclusive.
2. WHEN a StructuredQuery has `periodType` set to `range` and multiple tickers, THE Structured_Retriever SHALL retrieve data for all tickers in the range.
3. WHEN a StructuredQuery has `periodType` set to `range`, THE Query_Router SHALL propagate `periodStart` and `periodEnd` from the QueryIntent to the StructuredQuery.

### Requirement 7: Multi-Ticker Trend Visualization

**User Story:** As an equity analyst, I want to see trend charts for every ticker in my query and a side-by-side comparison chart, so that I can visually compare historical performance across companies.

#### Acceptance Criteria

1. WHEN a query has both `needsTrend` and `needsComparison` set to true with multiple tickers, THE Visualization_Generator SHALL produce a multi-series trend chart containing one data series per ticker plotted over time.
2. WHEN a query has `needsTrend` set to true with multiple tickers but `needsComparison` is false, THE Visualization_Generator SHALL produce a trend chart that includes data series for all tickers.
3. WHEN a query has `needsTrend` set to true with a single ticker, THE Visualization_Generator SHALL produce a single-ticker trend chart (existing behavior preserved).
4. THE Visualization_Generator SHALL label each data series with the ticker symbol in the chart legend.

### Requirement 8: Multi-Ticker Financial Computation

**User Story:** As an equity analyst, I want YoY growth and derived metrics computed for all tickers in my query, so that the LLM response includes complete comparative financial analysis.

#### Acceptance Criteria

1. WHEN a QueryIntent contains multiple tickers and `needsTrend` or `needsComputation` is true, THE Response_Enrichment SHALL compute financial summaries for each ticker.
2. WHEN computing financials for multiple tickers, THE Response_Enrichment SHALL return an array of MetricsSummary objects, one per ticker.
3. WHEN a financial computation fails for one ticker, THE Response_Enrichment SHALL continue computing for remaining tickers and include partial results.

### Requirement 9: Missing Ticker Data Handling

**User Story:** As an equity analyst, I want a clear and actionable message when data for a requested ticker is not available, so that I understand what data exists and how to get the missing data ingested.

#### Acceptance Criteria

1. WHEN structured retrieval returns zero metrics for a specific ticker in a multi-ticker query, THE RAG_Orchestrator SHALL identify which tickers have data and which do not.
2. WHEN a ticker has no data, THE RAG_Orchestrator SHALL include in the response a message stating which ticker lacks data, what tickers do have data, and a suggestion to ingest the missing ticker's SEC filings.
3. WHEN some tickers have data and others do not, THE RAG_Orchestrator SHALL still generate analysis and visualizations for the tickers that have data.
4. IF all tickers in a query lack data, THEN THE RAG_Orchestrator SHALL return a message listing the requested tickers and suggesting the user ingest their SEC filings.

### Requirement 10: Query Router Period Range Propagation

**User Story:** As a developer, I want the query router to correctly propagate period range information into structured and semantic queries, so that downstream retrievers receive the full date range context.

#### Acceptance Criteria

1. WHEN the QueryIntent has `periodType` set to `range`, THE Query_Router SHALL set `periodStart` and `periodEnd` on the StructuredQuery.
2. WHEN the QueryIntent has `periodType` set to `range`, THE Query_Router SHALL set the `period` field on the SemanticQuery to a descriptive string (e.g., "FY2020-FY2024") for narrative context.
3. WHEN the QueryIntent has `periodType` set to `range`, THE Query_Router SHALL set `filingTypes` to `['10-K']` to retrieve annual data for the range.

### Requirement 11: Context Ticker Does Not Suppress Query Tickers

**User Story:** As an equity analyst working within a deal workspace, I want the system to detect additional tickers mentioned in my query even when a context ticker is provided by the workspace, so that comparison queries like "compare to AMZN" work correctly from any deal page.

#### Acceptance Criteria

1. WHEN a contextTicker is provided and the query also mentions additional ticker symbols or company names, THE Intent_Detector SHALL return all tickers (context ticker plus query-mentioned tickers) as an array.
2. WHEN a contextTicker is provided and the query does not mention any additional tickers, THE Intent_Detector SHALL return only the context ticker (existing behavior preserved).
3. WHEN a contextTicker is provided and the query mentions the same ticker as the context, THE Intent_Detector SHALL deduplicate and return a single ticker.
