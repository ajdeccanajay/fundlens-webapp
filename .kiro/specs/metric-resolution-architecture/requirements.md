# Requirements Document

## Introduction

This document specifies the requirements for a complete architectural redesign of the metric resolution system in FundLens, an AI-powered equity research platform. The current system suffers from two parallel synonym systems that disagree, a broken normalize() function, silent fallback to raw metric keys producing empty results, and inappropriate use of an SLM (all-MiniLM-L6-v2) for short financial term matching. The new architecture replaces all of this with a three-layer resolution stack: a Canonical Metric Registry with inverted synonym index, a Formula/Concept Registry for computed and analytical metrics, and a graceful degradation layer with an offline learning loop. YAML registry files are stored in S3, loaded into memory at startup, and built into an inverted index for sub-millisecond resolution.

## Glossary

- **Resolution_Pipeline**: The core metric resolution flow that takes a raw metric string and returns a MetricResolution object through exact match, fuzzy match, or suggestion stages
- **Canonical_Metric_Registry**: The single source of truth for all metric definitions, stored as YAML files in S3, organized by statement type, sector, and domain
- **Inverted_Synonym_Index**: An in-memory hash map built at startup that maps every normalized synonym to its canonical metric ID for O(1) lookup
- **MetricResolution**: A structured object returned by the Resolution_Pipeline containing canonical_id, display_name, type, confidence, match_source, and suggestions
- **normalize_for_lookup**: The normalization function that converts any metric string to lowercase with all non-alphanumeric characters stripped
- **Formula_Registry**: YAML-defined computed metric definitions containing formulas, dependencies, and output formats
- **Concept_Registry**: YAML-defined analytical question mappings that resolve to bundles of primary and secondary metrics filtered by sector and asset class
- **Client_Overlay**: A per-tenant YAML file in S3 that extends the universal registry with additional synonyms without replacing universal definitions
- **Learning_Loop**: An offline batch process that aggregates unresolved queries and analyst corrections, uses LLM to suggest new synonyms, and presents them for human review
- **Calculation_Engine**: The Python-based financial calculation engine (financial_calculator.py) that serves as the SINGLE execution environment for ALL formula evaluation — extended with a generic `/calculate` endpoint
- **Python_Calculation_Bridge**: The HTTP interface between the TypeScript FormulaResolutionService (dispatcher) and the Python Calculation Engine — the dispatcher resolves dependencies and packages inputs, Python evaluates the formula
- **Formula_Dispatch_Pattern**: The architecture where TypeScript resolves the dependency DAG and fetches all atomic values, then sends `{ formula, inputs, output_format }` to Python for evaluation — TypeScript never evaluates formulas itself
- **Admin_Formula_UI**: A web interface for platform operators to create, test, and submit new computed metric formulas for human review before production deployment
- **Pending_Formula**: A formula submitted via the Admin UI that awaits human approval before being written to the production YAML registry in S3
- **LRU_Cache**: A Least Recently Used cache (10,000 entries) wrapping the Resolution_Pipeline for sub-millisecond repeated query resolution
- **Fuzzy_Matcher**: A JavaScript fuzzy matching library (fuse.js or string-similarity) used for token-level comparison when exact match fails
- **Metric_Registry_Service**: The NestJS service that owns the Canonical_Metric_Registry, Inverted_Synonym_Index, and Resolution_Pipeline
- **Intent_Router**: The existing intent detection system that classifies queries into TYPE A (atomic metric), TYPE B (computed metric), TYPE C (analytical concept), or TYPE D (narrative/qualitative)
- **DAG**: Directed Acyclic Graph — the dependency graph of computed metrics that must be validated at startup to detect circular dependencies

## Requirements

### Requirement 1: Canonical Metric Registry and S3 Loading

**User Story:** As a platform operator, I want all metric definitions stored as YAML files in S3 and loaded into memory at application startup, so that there is a single source of truth for metric resolution shared across all tenants.

#### Acceptance Criteria

1. WHEN the application starts, THE Metric_Registry_Service SHALL load all YAML metric definition files from the configured S3 bucket and prefix
2. WHEN YAML files are loaded, THE Metric_Registry_Service SHALL parse each metric entry and validate it against the metric entry schema (canonical_id, display_name, type, statement, synonyms, db_column for atomic metrics, formula and dependencies for computed metrics)
3. IF a YAML file fails to parse or contains invalid entries, THEN THE Metric_Registry_Service SHALL log a detailed error identifying the file and entry, and continue loading remaining files
4. WHEN all YAML files are loaded, THE Metric_Registry_Service SHALL build the Inverted_Synonym_Index by indexing the canonical_id, display_name, every synonym, and every XBRL tag label (without namespace prefix) for each metric, all normalized via normalize_for_lookup
5. IF two metrics produce a synonym collision (same normalized key), THEN THE Metric_Registry_Service SHALL log a warning identifying both metrics and the colliding synonym, and retain the first entry
6. WHEN all YAML files are loaded, THE Metric_Registry_Service SHALL validate that every atomic metric has a db_column value that corresponds to a known database column
7. WHEN an index rebuild is triggered via the admin API endpoint, THE Metric_Registry_Service SHALL reload all YAML files from S3 and rebuild the Inverted_Synonym_Index without requiring an application restart
8. THE Metric_Registry_Service SHALL expose metrics for monitoring: total metrics loaded, total synonyms indexed, synonym collisions detected, and load time in milliseconds

### Requirement 2: normalize_for_lookup Function

**User Story:** As a developer, I want a single aggressive normalization function that strips all non-alphanumeric characters, so that metric lookups succeed regardless of formatting differences in user input.

#### Acceptance Criteria

1. THE normalize_for_lookup function SHALL convert the input string to lowercase and remove all non-alphanumeric characters
2. WHEN given "Cash & Cash Equivalents", THE normalize_for_lookup function SHALL return "cashandcashequivalents"
3. WHEN given "Cash_and_Cash_Equivalents", THE normalize_for_lookup function SHALL return "cashandcashequivalents"
4. WHEN given "SG&A", THE normalize_for_lookup function SHALL return "sga"
5. WHEN given "Net Debt / EBITDA", THE normalize_for_lookup function SHALL return "netdebtebitda"
6. WHEN given an empty string or whitespace-only string, THE normalize_for_lookup function SHALL return an empty string

### Requirement 3: Resolution Pipeline (Exact Match)

**User Story:** As an analyst, I want my metric queries to resolve instantly via exact match against the synonym index, so that 95%+ of my queries return correct results in under 10ms.

#### Acceptance Criteria

1. WHEN a metric query is submitted, THE Resolution_Pipeline SHALL first normalize the query via normalize_for_lookup and check the LRU_Cache
2. WHEN the LRU_Cache contains a hit, THE Resolution_Pipeline SHALL return the cached MetricResolution immediately
3. WHEN the LRU_Cache misses, THE Resolution_Pipeline SHALL perform an O(1) hash lookup in the Inverted_Synonym_Index
4. WHEN the Inverted_Synonym_Index contains an exact match, THE Resolution_Pipeline SHALL return a MetricResolution with confidence "exact" and populate the LRU_Cache
5. THE Resolution_Pipeline SHALL log every cache miss with the raw query string for analytics
6. THE LRU_Cache SHALL hold a maximum of 10,000 entries

### Requirement 4: Resolution Pipeline (Fuzzy Match)

**User Story:** As an analyst, I want the system to handle typos and close variants of metric names, so that minor spelling differences do not produce empty results.

#### Acceptance Criteria

1. WHEN exact match fails, THE Resolution_Pipeline SHALL perform fuzzy matching against all synonym keys using a JavaScript fuzzy matching library (fuse.js or string-similarity)
2. WHEN fuzzy matching produces a candidate with score at or above 0.85, THE Resolution_Pipeline SHALL auto-resolve to that metric and return a MetricResolution with confidence "fuzzy_auto" and the fuzzy_score
3. WHEN fuzzy matching produces candidates with scores between 0.70 and 0.84, THE Resolution_Pipeline SHALL return a MetricResolution with confidence "unresolved" and the top 3 candidates as suggestions
4. WHEN fuzzy matching produces no candidates above 0.70, THE Resolution_Pipeline SHALL return a MetricResolution with confidence "unresolved" and an empty suggestions list
5. THE Resolution_Pipeline SHALL complete fuzzy matching in under 50ms
6. THE Resolution_Pipeline SHALL NOT use any SLM, embedding model, or LLM call in the synchronous resolution path

### Requirement 5: MetricResolution Object

**User Story:** As a downstream consumer, I want every metric resolution to return a structured MetricResolution object, so that I never receive a raw string and always know the resolution confidence.

#### Acceptance Criteria

1. THE Resolution_Pipeline SHALL return a MetricResolution object for every query, containing: canonical_id, display_name, type (atomic or computed), confidence (exact, fuzzy_auto, or unresolved), fuzzy_score (or null), original_query, match_source, suggestions (or null), formula (or null), and dependencies (or null)
2. THE Resolution_Pipeline SHALL never return a raw metric string as a resolution result
3. WHEN a metric is resolved with confidence "exact" or "fuzzy_auto", THE MetricResolution SHALL include the db_column for atomic metrics or the formula and dependencies for computed metrics
4. WHEN a metric is unresolved, THE MetricResolution SHALL include up to 3 suggestion objects each containing canonical_id, display_name, and fuzzy_score

### Requirement 6: Client Overlay and Tenant Isolation

**User Story:** As a platform operator, I want per-client synonym overlay files in S3 that extend the universal registry, so that each client's custom terminology resolves correctly without affecting other tenants.

#### Acceptance Criteria

1. WHEN a request includes a tenantId, THE Metric_Registry_Service SHALL load the corresponding client overlay YAML from S3 and merge additional_synonyms into the resolution index for that request
2. WHEN merging a client overlay, THE Metric_Registry_Service SHALL add synonyms to existing metrics without replacing universal synonyms
3. WHEN resolving a metric for tenant A, THE Resolution_Pipeline SHALL NOT use synonyms from tenant B's overlay
4. IF a client overlay file does not exist for a tenantId, THEN THE Metric_Registry_Service SHALL use the universal registry without error

### Requirement 7: StructuredQuery Update and Pipeline Integration

**User Story:** As a developer, I want StructuredQuery to carry MetricResolution objects instead of raw strings, so that downstream services have full resolution context including display names and confidence.

#### Acceptance Criteria

1. THE StructuredQuery interface SHALL carry an array of MetricResolution objects instead of a string array for metrics
2. WHEN the Query_Router builds a StructuredQuery, THE Query_Router SHALL resolve each metric through the Resolution_Pipeline and include the resulting MetricResolution objects
3. WHEN the Structured_Retriever receives a StructuredQuery, THE Structured_Retriever SHALL use the db_column from each MetricResolution for database WHERE clauses
4. WHEN the Response_Enrichment_Service builds a markdown table, THE Response_Enrichment_Service SHALL use the display_name from MetricResolution instead of formatMetricLabel()

### Requirement 8: Delete Legacy Metric Resolution Code

**User Story:** As a developer, I want all legacy metric resolution code removed, so that there is exactly one resolution path and no silent fallback to broken logic.

#### Acceptance Criteria

1. WHEN the new Resolution_Pipeline is wired in, THE system SHALL delete the entire extractMetrics() regex map from IntentDetectorService
2. WHEN the new Resolution_Pipeline is wired in, THE system SHALL delete the existing MetricMappingService class and its YAML configuration
3. WHEN the new Resolution_Pipeline is wired in, THE system SHALL delete the normalize() function that only strips underscores
4. WHEN the new Resolution_Pipeline is wired in, THE system SHALL delete the resolveMetricsWithSLM() method and extractCandidatePhrases() method from IntentDetectorService
5. WHEN the new Resolution_Pipeline is wired in, THE system SHALL remove any fallback logic in Query_Router.normalizeMetrics() that uses raw metric keys when resolution fails

### Requirement 9: Graceful Degradation (No Silent Failures)

**User Story:** As an analyst, I want the system to always explain what happened when a metric cannot be resolved, so that I never see an empty table without understanding why.

#### Acceptance Criteria

1. WHEN a metric resolves with confidence "unresolved" and suggestions exist, THE system SHALL present the suggestions as clickable options with the message "Showing results for [top suggestion] — is that what you meant?"
2. WHEN a metric resolves with confidence "unresolved" and no suggestions exist, THE system SHALL display a message: "I don't have a metric mapped for [original query] yet" with the closest available alternatives
3. THE system SHALL never display an empty results table without an accompanying explanation
4. THE system SHALL never display raw canonical_ids (e.g., "cash_and_cash_equivalents") in user-facing text — only display_name values

### Requirement 10: Formula Registry and Computed Metrics (Python-as-Engine)

**User Story:** As an analyst, I want computed metrics (like Net Debt/EBITDA) to be defined as formulas in YAML with recursive dependency resolution, so that adding new computed metrics requires no code changes.

#### Acceptance Criteria

1. WHEN the application starts, THE Metric_Registry_Service SHALL parse computed metric entries from YAML, extracting formula and dependencies fields
2. WHEN the application starts, THE Metric_Registry_Service SHALL build a dependency graph of all computed metrics and validate it is a DAG (no circular dependencies)
3. IF a circular dependency is detected at startup, THEN THE Metric_Registry_Service SHALL fail with a clear error message identifying the cycle
4. WHEN a computed metric is requested, THE Formula_Resolution_Service (acting as a dispatcher) SHALL recursively resolve all dependencies by fetching atomic values from the database in a single batch query, then package the formula string and resolved input values as a JSON payload and send to the Python Calculation Engine via HTTP POST `/calculate`
5. IF a dependency value is missing (null from database), THEN THE Formula_Resolution_Service SHALL return null with an explanation identifying the missing dependency by display_name, period, and ticker — the request SHALL NOT be sent to Python
6. THE Formula_Resolution_Service SHALL never return 0 as a default for missing values
7. WHEN a computed metric result is returned, THE Formula_Resolution_Service SHALL include the formula, all resolved input values with their sources, the Python-computed result, and an audit trail for full transparency
8. WHEN the new Formula_Resolution_Service is operational, THE system SHALL delete the hardcoded getComputedMetrics() if/else chain in RAGService
9. THE Python Calculation Engine SHALL be the SINGLE execution environment for ALL formula evaluation — TypeScript SHALL NOT evaluate any formulas directly
10. THE Formula_Resolution_Service SHALL cache resolved dependency values per (ticker, period) to avoid redundant DB hits when multiple computed metrics share dependencies in the same request

### Requirement 16: Python Calculation Bridge

**User Story:** As a platform operator, I want all formula evaluation to route through a single Python calculation engine, so that we have one execution environment with consistent precision, auditability, and the ability to support arbitrarily complex formulas (CAGR, IRR, waterfall models) without building a TypeScript expression evaluator.

#### Acceptance Criteria

1. THE Python Calculation Engine (financial_calculator.py) SHALL expose a new generic endpoint: `POST /calculate` accepting `{ formula, inputs, output_format }` and returning `{ result, audit_trail }`
2. THE `/calculate` endpoint SHALL support two formula modes: inline expressions (e.g., `gross_profit / revenue * 100`) evaluated via `simpleeval` (safe expression evaluator), and named functions (e.g., `cagr(revenue, 3)`) for complex multi-period calculations
3. THE `/calculate` endpoint SHALL use the `simpleeval` library (NOT Python `eval()`) for inline expression evaluation to prevent code injection
4. THE `/calculate` endpoint SHALL use Python's `decimal` module for all arithmetic to ensure financial-grade precision (no floating point drift)
5. THE `/calculate` endpoint SHALL return an audit trail containing: formula evaluated, input values used, intermediate calculations (if any), final result, and execution time in milliseconds
6. THE `/calculate` endpoint SHALL validate that all variables referenced in the formula are present in the inputs dict, and return a clear error if any are missing
7. THE `/calculate` endpoint SHALL support named Python functions for complex calculations: `cagr(values, periods)`, `irr(cash_flows)`, `compound_growth(start, end, periods)` — registered as safe functions in the simpleeval evaluator
8. WHEN `output_format` is "percentage", THE endpoint SHALL return the result as-is (formula already multiplies by 100); WHEN "ratio", return as-is; WHEN "currency", return rounded to nearest integer; WHEN "days", return rounded to 1 decimal
9. THE existing Python calculator endpoints (`/calculate-metrics`, `/health`) SHALL remain unchanged for backward compatibility
10. THE TypeScript `FinancialCalculatorService` SHALL be extended with a new method `evaluateFormula(formula, inputs, outputFormat)` that calls the Python `/calculate` endpoint via HTTP POST

### Requirement 17: Admin Formula Management

**User Story:** As a platform operator, I want an admin UI where I can create new computed metric formulas, test them with sample data, and submit them for human review before they go to production, so that the formula registry can grow without requiring code deployments.

#### Acceptance Criteria

1. THE system SHALL provide an admin API endpoint `POST /api/admin/formulas` for creating new formula definitions, accepting: metric_name (canonical_id), display_name, inputs (comma-delimited canonical_ids), formula, output_format, category, and optional interpretation thresholds
2. WHEN a new formula is submitted, THE system SHALL validate it by sending a test payload to the Python `/calculate` endpoint with sample input values, and return the validation result to the admin
3. IF formula validation fails (Python returns an error), THE system SHALL reject the submission with a clear error message identifying the issue (missing variable, syntax error, division by zero, etc.)
4. WHEN a formula passes validation, THE system SHALL save it to a `pending_formulas` database table with status "pending_review"
5. THE system SHALL provide an admin API endpoint `GET /api/admin/formulas/pending` to list all formulas awaiting review
6. THE system SHALL provide an admin API endpoint `POST /api/admin/formulas/{id}/approve` to approve a pending formula — on approval, the system SHALL write the formula to the appropriate YAML file in S3 and trigger an index rebuild
7. THE system SHALL provide an admin API endpoint `POST /api/admin/formulas/{id}/reject` to reject a pending formula with a reason
8. THE `pending_formulas` table SHALL store: id, canonical_id, display_name, formula, dependencies (JSON array), output_format, category, interpretation (JSON), submitted_by, reviewed_by, status (pending_review, approved, rejected), submitted_at, reviewed_at, rejection_reason
9. WHEN a formula is approved and written to S3, THE system SHALL trigger `MetricRegistryService.rebuildIndex()` so the new formula is immediately available without application restart
10. THE admin formula management SHALL support future extensibility for industry-specific and PE-specific formulas by including industry and asset_class fields in the submission

### Requirement 11: Concept Registry

**User Story:** As an analyst, I want to ask analytical questions like "How levered is this company?" and receive a composite profile of relevant metrics, so that I save 15-30 minutes versus manual assembly.

#### Acceptance Criteria

1. WHEN the application starts, THE Concept_Registry SHALL load concept definitions from YAML files in S3
2. WHEN a TYPE C query is detected, THE Intent_Router SHALL match the query against concept triggers using exact and fuzzy matching
3. WHEN a concept is matched, THE Concept_Registry SHALL collect primary_metrics for the company's sector and secondary_metrics for the company's asset class
4. WHEN concept metrics are collected, THE system SHALL resolve each metric through the Resolution_Pipeline and execute atomic lookups and computed metric calculations
5. WHERE a concept has a context_prompt, THE system SHALL pass the prompt to the RAG pipeline asynchronously for narrative context without blocking the numeric results

### Requirement 12: Learning Loop and Feedback

**User Story:** As a platform operator, I want unresolved queries and analyst corrections to feed an offline learning loop, so that the system improves over time without manual synonym curation becoming a bottleneck.

#### Acceptance Criteria

1. WHEN a metric resolves with confidence "unresolved", THE system SHALL log the raw query, timestamp, tenantId, and any suggestions offered
2. WHEN an analyst selects a suggestion (clicks a correction), THE system SHALL log the mapping from original query to selected metric as a candidate synonym
3. THE Learning_Loop SHALL aggregate unresolved queries and corrections in a batch process
4. WHEN corrections originate from a specific tenant, THE Learning_Loop SHALL write approved synonyms to that tenant's Client_Overlay file in S3
5. WHEN corrections are determined to be universal, THE Learning_Loop SHALL write approved synonyms to the universal registry YAML files in S3

### Requirement 13: Performance Requirements

**User Story:** As an analyst running 50+ queries during IC prep, I want metric resolution to be fast enough that it never feels like waiting, so that my workflow is not interrupted.

#### Acceptance Criteria

1. THE Resolution_Pipeline SHALL complete exact match resolution in under 10ms
2. THE Resolution_Pipeline SHALL complete fuzzy match resolution in under 50ms
3. THE LRU_Cache SHALL return cached results in under 1ms
4. WHEN the Inverted_Synonym_Index is rebuilt, THE Metric_Registry_Service SHALL complete the rebuild in under 5 seconds for up to 1,000 metrics

### Requirement 14: Startup Integrity Validation

**User Story:** As a platform operator, I want the system to validate registry integrity at startup, so that data quality issues are caught before they reach analysts.

#### Acceptance Criteria

1. WHEN the application starts, THE Metric_Registry_Service SHALL verify that no two metrics share a synonym that normalizes to the same key (collision detection)
2. WHEN the application starts, THE Metric_Registry_Service SHALL verify that every atomic metric's db_column corresponds to a known database column
3. WHEN the application starts, THE Metric_Registry_Service SHALL verify that the computed metric dependency graph is a DAG
4. IF any integrity check fails, THEN THE Metric_Registry_Service SHALL log detailed warnings but continue startup with the valid subset of metrics

### Requirement 15: Preserved Orthogonal Dimensions

**User Story:** As a developer, I want the existing period, ticker, tenant, and deal/workspace context extraction to remain unchanged, so that the metric resolution redesign does not break any orthogonal query dimensions.

#### Acceptance Criteria

1. THE system SHALL preserve extractPeriod() and determinePeriodType() in IntentDetectorService without modification
2. THE system SHALL preserve extractTicker() in IntentDetectorService without modification
3. THE system SHALL preserve tenantId flow through options.tenantId without modification
4. THE system SHALL preserve contextTicker (workspace/deal context) flow without modification
