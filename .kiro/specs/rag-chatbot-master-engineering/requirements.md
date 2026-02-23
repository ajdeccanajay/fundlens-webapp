# Requirements Document

## Introduction

This document captures the complete requirements for the FundLens RAG ChatBot Master Engineering initiative spanning three sprints. The initiative addresses foundation-level retrieval bugs, introduces a structured hybrid synthesis intelligence layer, enables multi-part query decomposition with bounded agentic retrieval, adds peer comparison capabilities, and establishes reliability pillars for production-grade financial analysis. The governing principle is that the existing architecture (MetricRegistry, FormulaResolutionService, ConceptRegistry, three-layer intent detection, parallel hybrid retrieval) is sound — every problem is plumbing: connections designed but not wired, synthesis with no financial reasoning structure, and query planning that is single-pass where it needs to be iterative.

## Glossary

- **StructuredRetriever**: The service (`structured-retriever.service.ts`) responsible for querying the database for financial metric data using Prisma ORM
- **MetricResolution**: A typed object produced by MetricRegistryService containing `canonical_id`, `db_column`, `display_name`, `type`, `confidence`, and synonym metadata for a resolved metric query
- **MetricRegistryService**: The service (`metric-registry.service.ts`) that resolves raw metric query strings into `MetricResolution` objects using YAML-based metric definitions
- **FormulaResolutionService**: The service (`formula-resolution.service.ts`) that evaluates computed metrics via a Python calculation bridge using a DAG of dependencies
- **IntentDetectorService**: The three-layer intent detection service (`intent-detector.service.ts`) using regex fast-path, LRU cache, and Claude Haiku LLM classification
- **RAGService**: The main orchestration service (`rag.service.ts`) coordinating intent detection, retrieval, synthesis, and response enrichment
- **HybridSynthesisService**: A new service (`hybrid-synthesis.service.ts`) replacing freeform LLM generation with a structured 5-step financial reasoning prompt
- **QueryDecomposerService**: A new service (`query-decomposer.service.ts`) that splits multi-part analyst queries into independently answerable sub-queries
- **PeerComparisonService**: A new service (`peer-comparison.service.ts`) that fetches and normalizes metrics across peer universe tickers for comparative analysis
- **VisualizationPayload**: A typed contract defining chart type, data rows/columns, and metadata for frontend rendering of financial data
- **ResponseType**: An enum taxonomy classifying RAG responses into 8 categories that drive frontend rendering decisions
- **FinancialAnalysisContext**: An interface aggregating query, intent, metrics, narratives, computed results, peer data, and sub-query results for synthesis
- **Fiscal_Period_Sort_Key**: A numeric sort key derived from fiscal period strings (e.g., FY2024, Q3FY2025) enabling correct chronological ordering
- **Peer_Universe**: A YAML-defined group of comparable companies within a sector, used for peer comparison queries
- **Tenant_Overlay**: A YAML-based configuration allowing PE clients to customize synthesis behavior (e.g., terminology, metric preferences)
- **Bounded_Retrieval_Loop**: An iterative retrieval mechanism capped at 3 iterations that re-plans retrieval based on completeness evaluation

## Requirements

### Requirement 1: Wire MetricResolution.db_column into StructuredRetriever

**User Story:** As a financial analyst, I want the StructuredRetriever to correctly use MetricResolution objects for database queries, so that queries like "What is the latest Revenue for ABNB?" return actual data instead of "No Data Available."

#### Acceptance Criteria

1. WHEN `getLatestByFilingType()` receives a MetricResolution object, THE StructuredRetriever SHALL accept a `MetricResolution` parameter instead of a `string` parameter and use `resolution.canonical_id` for synonym-based database lookup
2. WHEN a MetricResolution has `type === 'computed'`, THE StructuredRetriever SHALL route the request to `FormulaResolutionService.resolveComputed()` instead of querying the database directly
3. WHEN a MetricResolution has `confidence === 'unresolved'`, THE StructuredRetriever SHALL log a warning with the original query and return null without executing a database query
4. WHEN querying for an atomic metric, THE StructuredRetriever SHALL use `MetricRegistryService.getSynonymsForDbColumn()` to build an IN clause containing all known synonyms for the canonical metric
5. WHEN the `retrieveLatest()` method iterates over `query.metrics`, THE StructuredRetriever SHALL pass `MetricResolution` objects to `getLatestByFilingType()` instead of raw strings
6. IF the synonym-based IN clause returns no results, THEN THE StructuredRetriever SHALL return null for that metric without throwing an error

### Requirement 2: Synonym Lookup as Single Source of Truth

**User Story:** As a platform engineer, I want a single authoritative method for looking up all storage synonyms for a canonical metric, so that the hardcoded `metricTranslation` map is eliminated and synonym management is centralized in YAML.

#### Acceptance Criteria

1. THE MetricRegistryService SHALL expose a `getSynonymsForDbColumn(canonicalId: string): string[]` method that returns all known storage synonyms for a given canonical metric ID
2. WHEN `getSynonymsForDbColumn()` is called, THE MetricRegistryService SHALL include the `canonical_id`, `db_column`, and all YAML-defined synonyms in the returned array
3. WHEN the canonical ID has no matching metric definition, THE MetricRegistryService SHALL return an array containing only the canonical ID itself
4. WHEN synonyms are returned, THE MetricRegistryService SHALL return raw YAML synonym strings without normalization, since the database stores raw labels as written by ingestion
5. WHEN the StructuredRetriever is updated, THE hardcoded `metricTranslation` map SHALL be deleted and replaced entirely by calls to `getSynonymsForDbColumn()`

### Requirement 3: YAML Synonym Coverage for Revenue Metrics

**User Story:** As a financial analyst, I want the income statement YAML registry to include all known revenue synonyms, so that queries for revenue match data regardless of how the ingestion pipeline stored the raw label.

#### Acceptance Criteria

1. THE income_statement.yaml revenue definition SHALL include synonyms for: `revenue`, `revenues`, `total_revenue`, `net_revenue`, `net_sales`, `sales`, `total_net_revenue`, `us-gaap:Revenues`, `us-gaap:SalesRevenueNet`, and `us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax`
2. WHEN the MetricRegistryService loads at startup, THE MetricRegistryService SHALL parse and index all synonyms from the updated YAML file
3. WHEN a database audit reveals additional raw metric labels not in the synonym list, THE income_statement.yaml SHALL be updated to include those labels

### Requirement 4: Fiscal Period Sort Fix

**User Story:** As a financial analyst, I want fiscal periods sorted correctly so that quarterly results rank after annual results within the same fiscal year, and the most recent period is returned for "latest" queries.

#### Acceptance Criteria

1. WHEN parsing a fiscal period string like "FY2024", THE StructuredRetriever SHALL produce a sort key of `year * 10000` (e.g., 20240000)
2. WHEN parsing a fiscal period string like "Q3FY2024", THE StructuredRetriever SHALL produce a sort key of `year * 10000 + quarter * 100` (e.g., 20240300)
3. WHEN parsing a fiscal period string containing "TTM", THE StructuredRetriever SHALL produce a sort key of 99990000 to rank TTM above all fiscal periods
4. WHEN multiple results exist for the same ticker and metric, THE StructuredRetriever SHALL sort by the fiscal period sort key in descending order and return the most recent result
5. WHEN the database contains ABNB data for FY2024, Q1FY2025, Q2FY2025, and Q3FY2025, and the query requests "latest quarterly revenue", THE StructuredRetriever SHALL return Q3FY2025

### Requirement 5: Computed Metric Routing

**User Story:** As a financial analyst, I want computed metrics like EBITDA margin to be resolved through the formula engine with a full audit trail, so that I can verify the calculation methodology.

#### Acceptance Criteria

1. WHEN a MetricResolution has `type === 'computed'`, THE StructuredRetriever SHALL call `FormulaResolutionService.resolveComputed()` with the resolution, ticker, and period
2. WHEN the formula resolution succeeds, THE StructuredRetriever SHALL return a MetricResult with `statementType: 'computed'` and the computed value
3. IF the formula resolution fails or returns null, THEN THE StructuredRetriever SHALL log a warning and return null without propagating the error
4. WHEN a computed metric result is returned, THE MetricResult SHALL include the `displayName` from the MetricResolution object

### Requirement 6: Ticker Resolution Hardening

**User Story:** As a financial analyst, I want all known company tickers extracted from queries in sub-10ms via regex fast-path with zero false positives, so that ticker detection is fast and accurate for every publicly traded company.

#### Acceptance Criteria

1. WHEN the IntentDetectorService starts, THE IntentDetectorService SHALL load all tickers from the `companies` database table into an in-memory Set
2. WHEN extracting tickers from a query, THE IntentDetectorService SHALL use a universal regex pattern matching 1-5 uppercase letters bounded by whitespace or punctuation
3. WHEN ticker candidates are extracted by regex, THE IntentDetectorService SHALL validate each candidate against the companies table Set, rejecting non-ticker uppercase words like EBITDA, GAAP, CEO, and FY
4. WHEN the query contains "GAAP vs non-GAAP operating income for MSFT", THE IntentDetectorService SHALL extract only MSFT as a ticker (GAAP rejected by companies table validation)
5. WHEN the query contains "What did the 10-K say about risks?", THE IntentDetectorService SHALL extract no tickers (K is bounded by a hyphen, not whitespace)
6. THE IntentDetectorService SHALL refresh the ticker validation set daily via a cron job at 2:00 AM

### Requirement 7: VisualizationPayload Contract

**User Story:** As a frontend developer, I want a well-defined VisualizationPayload type with chart type, data rows/columns, and metadata, so that the frontend can render financial charts from structured data without parsing prose.

#### Acceptance Criteria

1. THE VisualizationPayload type SHALL define `suggestedChartType` as one of: `line`, `bar`, `grouped_bar`, `stacked_bar`, `waterfall`, `table`, `pie`, or `null`
2. THE VisualizationPayload data SHALL contain `rows` (array of ticker/period/filingType/metrics objects) and `columns` (array of canonical_id/display_name/format/unit_scale objects)
3. THE VisualizationPayload meta SHALL contain `title`, `tickers`, `periods` (sorted ascending), `source`, and optional `freshnessWarning`
4. WHEN metrics are available and the intent includes a suggested chart type, THE ResponseEnrichmentService SHALL populate a VisualizationPayload by merging metrics into rows keyed by ticker and period
5. WHEN no metrics are available or the intent type is `semantic`, THE ResponseEnrichmentService SHALL return undefined for the visualization field

### Requirement 8: HybridSynthesisService with Structured Reasoning

**User Story:** As a financial analyst, I want RAG responses to follow a structured 5-step reasoning process (Quantitative Facts → Narrative Summary → Reconciliation → Conclusion → Provocation), so that responses provide investment-grade analysis rather than unstructured prose.

#### Acceptance Criteria

1. THE HybridSynthesisService SHALL accept a `FinancialAnalysisContext` containing originalQuery, intent, metrics, narratives, computedResults, optional peerData, optional subQueryResults, modelTier, and optional tenantId
2. WHEN synthesizing a response, THE HybridSynthesisService SHALL build a structured prompt with 5 required reasoning steps: Quantitative Facts, Narrative Summary, Reconciliation, Conclusion, and Provocation
3. WHEN the prompt includes quantitative data, THE HybridSynthesisService SHALL format metrics into a table with ticker, metric, period, and value columns cited as ground truth
4. WHEN the prompt includes narrative data, THE HybridSynthesisService SHALL format each narrative chunk with ticker, section type, and fiscal period attribution
5. WHEN peer data is present in the context, THE HybridSynthesisService SHALL include a peer comparison section in the prompt
6. THE HybridSynthesisService SHALL invoke Claude via BedrockService with the structured prompt, using the model tier specified in the context
7. WHEN the synthesis completes, THE HybridSynthesisService SHALL return a `SynthesisResult` containing the answer text, token usage, and extracted citations

### Requirement 9: ResponseType Taxonomy

**User Story:** As a frontend developer, I want each RAG response classified into one of 8 response types, so that the frontend can render the appropriate UI layout for each type of financial analysis.

#### Acceptance Criteria

1. THE RAGService SHALL classify each response into one of 8 ResponseTypes: STRUCTURED_ONLY, COMPUTED_ONLY, HYBRID_SYNTHESIS, PEER_COMPARISON, TIME_SERIES, CONCEPT_ANALYSIS, DECOMPOSED_HYBRID, or NARRATIVE_ONLY
2. WHEN a query resolves to a single metric for a single company with no narrative needed, THE RAGService SHALL assign ResponseType STRUCTURED_ONLY
3. WHEN a query resolves to a computed metric, THE RAGService SHALL assign ResponseType COMPUTED_ONLY and include the formula audit trail
4. WHEN a query requires both structured data and narrative context, THE RAGService SHALL assign ResponseType HYBRID_SYNTHESIS
5. WHEN a query involves multiple tickers for the same metrics, THE RAGService SHALL assign ResponseType PEER_COMPARISON
6. WHEN a query matches a ConceptRegistry concept (e.g., leverage, liquidity), THE RAGService SHALL assign ResponseType CONCEPT_ANALYSIS
7. WHEN a query is decomposed into sub-queries, THE RAGService SHALL assign ResponseType DECOMPOSED_HYBRID
8. WHEN a query resolves to semantic-only results with no metrics, THE RAGService SHALL assign ResponseType NARRATIVE_ONLY

### Requirement 10: Wire HybridSynthesisService into RAGService

**User Story:** As a platform engineer, I want the RAGService to use HybridSynthesisService for all synthesis instead of the current freeform `bedrock.generate()` and `buildAnswer()` branches, so that all responses follow the structured reasoning format.

#### Acceptance Criteria

1. WHEN the RAGService has completed retrieval, THE RAGService SHALL construct a `FinancialAnalysisContext` from the query, intent, metrics, narratives, computed results, peer data, and model tier
2. WHEN the context is constructed, THE RAGService SHALL call `HybridSynthesisService.synthesize(context)` instead of `bedrock.generate()` or `buildAnswer()`
3. WHEN the synthesis result is returned, THE RAGService SHALL use the answer, usage, and citations from the `SynthesisResult` in the final `RAGResponse`

### Requirement 11: PE Tenant Overlay Extensibility

**User Story:** As a PE client (e.g., Third Avenue Management), I want the synthesis prompt to include my firm-specific terminology and analysis preferences, so that responses use language and metrics appropriate for private equity analysis.

#### Acceptance Criteria

1. WHEN a tenant overlay YAML file exists for the requesting tenant, THE HybridSynthesisService SHALL load and inject the `synthesis_instructions` into the structured prompt
2. WHEN the overlay specifies `asset_class: 'private_equity'`, THE HybridSynthesisService SHALL append PE-specific context instructions to the prompt
3. WHEN a Third Avenue query references "distributable cash", THE MetricRegistryService SHALL resolve it to `free_cash_flow` via the tenant overlay synonym mapping

### Requirement 12: QueryDecomposerService for Multi-Part Queries

**User Story:** As a financial analyst, I want multi-part questions automatically decomposed into independently answerable sub-queries, so that complex questions like "What are ABNB's margins AND what does management say drives them?" produce comprehensive answers.

#### Acceptance Criteria

1. WHEN a query has a single information need, THE QueryDecomposerService SHALL return `isDecomposed: false` without making an LLM call (fast-path)
2. WHEN a query contains compound markers (and, also, as well as, additionally, plus, both) combined with mixed intent types, THE QueryDecomposerService SHALL invoke Claude Haiku to determine decomposition
3. WHEN decomposition is needed, THE QueryDecomposerService SHALL produce a maximum of 3 sub-queries, each independently answerable
4. WHEN sub-queries are produced, THE QueryDecomposerService SHALL preserve company names and periods from the original query in each sub-query
5. WHEN sub-queries are produced, THE QueryDecomposerService SHALL order them by dependency: quantitative data before qualitative analysis
6. WHEN the QueryDecomposerService returns a decomposed result, THE result SHALL include a `unifyingInstruction` describing how to combine sub-query answers

### Requirement 13: Bounded Agentic Retrieval Loop

**User Story:** As a financial analyst, I want the retrieval system to iteratively fetch additional data when the initial retrieval is incomplete, so that complex queries get comprehensive answers without unbounded execution.

#### Acceptance Criteria

1. THE RAGService retrieval loop SHALL execute a maximum of 3 iterations
2. WHEN the first retrieval iteration completes, THE RAGService SHALL evaluate completeness by checking that all requested tickers have metrics and all narrative needs are met
3. WHEN retrieval is incomplete after the first iteration, THE RAGService SHALL invoke a replanner prompt via Claude Haiku to determine what additional data is needed
4. WHEN the replanner indicates no more data is needed, THE RAGService SHALL exit the loop immediately
5. WHEN additional retrieval queries are generated, THE RAGService SHALL execute them and merge results with previously retrieved data
6. WHEN the loop completes, THE RAGService SHALL log the total number of iterations executed

### Requirement 14: Sub-Query Execution and Unified Synthesis

**User Story:** As a financial analyst, I want decomposed sub-queries executed independently and their results unified into a single coherent response, so that multi-part questions produce integrated analysis.

#### Acceptance Criteria

1. WHEN the QueryDecomposerService returns `isDecomposed: true`, THE RAGService SHALL execute each sub-query through the standard retrieval pipeline
2. WHEN all sub-query results are collected, THE RAGService SHALL pass them to HybridSynthesisService as `subQueryResults` in the FinancialAnalysisContext
3. WHEN the HybridSynthesisService detects `subQueryResults`, THE HybridSynthesisService SHALL use a unifying synthesis prompt that combines sub-query answers according to the `unifyingInstruction`

### Requirement 15: Peer Universe Registry

**User Story:** As a financial analyst, I want sector-based peer groups defined in YAML, so that peer comparison queries automatically resolve the correct set of comparable companies.

#### Acceptance Criteria

1. THE peer_universes.yaml SHALL define peer groups with `display_name`, `gics_subindustry`, `members` (ticker array), `primary_metrics`, and `normalization_basis`
2. WHEN a peer universe is defined, THE peer_universes.yaml SHALL include at minimum: `online_travel` (ABNB, BKNG, EXPE, TRIP), `us_mega_cap_tech` (AAPL, MSFT, GOOGL, AMZN, META, NVDA)
3. WHEN a tenant-specific peer universe is defined (e.g., `third_avenue_portfolio`), THE peer_universes.yaml SHALL support dynamic member population from the tenant overlay

### Requirement 16: PeerComparisonService

**User Story:** As a financial analyst, I want to compare a company's metrics against its sector peers with proper normalization, so that I can assess relative performance.

#### Acceptance Criteria

1. WHEN a peer comparison is requested, THE PeerComparisonService SHALL fetch all tickers × all metrics in parallel using `Promise.all()`
2. WHEN the normalization basis is LTM, THE PeerComparisonService SHALL sum trailing 4 quarters per company and flag fiscal year-end mismatches exceeding 60 days
3. WHEN results are collected, THE PeerComparisonService SHALL compute median, mean, subject ticker rank, and subject-vs-median percentage
4. THE PeerComparisonResult SHALL include `metric`, `normalizationBasis`, `period`, `rows` (with ticker/value/rank), `median`, `mean`, `subjectTicker`, `subjectRank`, and `subjectVsMedianPct`

### Requirement 17: QueryRouter Peer Universe Resolution

**User Story:** As a financial analyst, I want single-ticker peer comparison queries to automatically resolve the peer universe, so that asking "How does ABNB compare to peers on margins?" fetches data for all online travel peers.

#### Acceptance Criteria

1. WHEN the intent indicates `needsPeerComparison` and only one ticker is provided, THE QueryRouterService SHALL look up the peer universe for that ticker
2. WHEN a peer universe is found, THE QueryRouterService SHALL expand the ticker list to include all peer universe members
3. WHEN the peer universe is resolved, THE QueryRouterService SHALL log the universe name and member tickers

### Requirement 18: Grounded Provocation

**User Story:** As a financial analyst, I want the provocation step in synthesis to reference specific peer divergences when peer data is available, so that challenge questions are grounded in actual comparative data rather than generic risk prompts.

#### Acceptance Criteria

1. WHEN peer data is present in the FinancialAnalysisContext, THE HybridSynthesisService SHALL replace the standard Step 5 provocation with a peer-grounded provocation prompt
2. WHEN generating a peer-grounded provocation, THE HybridSynthesisService SHALL reference a specific divergence between the subject ticker and a named peer
3. THE peer-grounded provocation SHALL follow the format: "Given that [PEER] achieved [X] while [SUBJECT] achieved [Y] in [PERIOD], what explains the gap and is it structural or cyclical?"

### Requirement 19: Pre-Write Validation at Ingestion

**User Story:** As a data engineer, I want financial metrics validated before database writes, so that data quality issues are caught at ingestion time rather than at query time.

#### Acceptance Criteria

1. WHEN a financial metric is written to the database, THE ingestion pipeline SHALL apply `normalizeForStorage()` to ensure normalization consistency
2. WHEN a metric value deviates more than 5 standard deviations from the historical mean (last 8 periods), THE ingestion pipeline SHALL flag the metric for review and write it with a low confidence score
3. WHEN a metric has a `sign_convention` defined in the YAML registry, THE ingestion pipeline SHALL verify and correct the sign if needed, logging any correction
4. WHEN net income values from the income statement and cash flow statement differ beyond rounding tolerance, THE ingestion pipeline SHALL flag the discrepancy and prefer the income statement value
5. WHEN an XBRL tag is present, THE ingestion pipeline SHALL map it to the canonical_id and store both the raw tag and canonical_id

### Requirement 20: Post-Retrieval Validation

**User Story:** As a financial analyst, I want retrieved metrics validated before they appear in responses, so that low-confidence or malformed data is filtered out with appropriate warnings.

#### Acceptance Criteria

1. WHEN a MetricResult has a null or undefined value, THE StructuredRetriever SHALL exclude it from results
2. WHEN a MetricResult has a confidence score below 0.70, THE StructuredRetriever SHALL exclude it from results
3. WHEN a MetricResult has an unparseable fiscal period, THE StructuredRetriever SHALL exclude it from results
4. WHEN a MetricResult comes from an 8-K filing for an income statement metric, THE StructuredRetriever SHALL append a warning label: "⚠️ (press release, unaudited)"

### Requirement 21: Graceful Degradation

**User Story:** As a financial analyst, I want context-aware "no data" responses that explain what was found, what is missing, and suggest alternatives, so that I never receive a silent failure or generic "No Data Available" message.

#### Acceptance Criteria

1. WHEN some metrics are found and others are missing, THE ResponseEnrichmentService SHALL list found metrics and explain each missing metric with a reason (e.g., "not separately reported by this company")
2. WHEN a metric query is unresolved and suggestions exist, THE ResponseEnrichmentService SHALL present "Did you mean: [suggestions]?" with the top suggestion highlighted
3. WHEN a metric query is unresolved and no suggestions exist, THE ResponseEnrichmentService SHALL state that the metric is not recognized and suggest rephrasing

### Requirement 22: Observability Signals

**User Story:** As a platform engineer, I want structured observability signals emitted at key decision points, so that metric misses, unresolved queries, retrieval loop iterations, and user feedback are tracked for continuous improvement.

#### Acceptance Criteria

1. WHEN a metric is not found in the database, THE StructuredRetriever SHALL log to `metric_misses` and trigger MetricLearningService
2. WHEN a metric query is unresolved by MetricRegistry, THE MetricRegistryService SHALL log the unresolved query and suggest YAML synonym additions
3. WHEN the retrieval loop executes more than 1 iteration, THE RAGService SHALL log the query and iteration count
4. WHEN a query is decomposed, THE QueryDecomposerService SHALL log the sub-query count and unifying instruction
5. WHEN a ticker candidate is extracted by regex but not found in the companies table, THE IntentDetectorService SHALL log to `ticker_miss_log`
6. WHEN an analyst submits thumbs-down feedback, THE frontend feedback event SHALL be stored in `accuracy_feedback` and flagged for review
