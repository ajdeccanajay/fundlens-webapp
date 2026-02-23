# Implementation Plan: Metric Resolution Architecture

## Overview

Six-phase implementation replacing the broken metric resolution system with a three-layer deterministic resolution stack, powered by a Python calculation bridge for all formula evaluation. The complete metric registry (252 metrics, 1,209 synonyms across 20 YAML files) has been pre-authored and is ready for deployment. Each phase is independently deployable and adds incremental value. Phase 1 (Foundation) delivers the core registry and exact-match resolution. Phase 2 (Completeness) adds fuzzy matching, MetricResolution objects, and deletes legacy code. Phase 3 (Computed Metrics) extends the Python calculator with a generic `/calculate` endpoint and replaces the hardcoded if/else chain with formula-driven dispatch via the Python bridge. Phase 4 (Concepts) adds analytical question → metric bundle mapping. Phase 5 (Learning Loop) adds offline feedback processing. Phase 6 (Admin Formula Management) adds a CRUD workflow for creating, validating, and approving new formulas via an admin UI.

## Tasks

- [x] 1. Phase 1 Foundation: MetricRegistryService, Inverted Index, Exact Match
  - [x] 1.1 Create normalize_for_lookup utility function
    - Create `src/rag/metric-resolution/normalize-for-lookup.ts`
    - Implement: lowercase input, strip all non-alphanumeric characters via `text.toLowerCase().replace(/[^a-z0-9]/g, '')`
    - Handle edge cases: empty string, whitespace-only, null/undefined
    - Export as named function
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 1.2 Write property tests for normalize_for_lookup
    - **Property 3: normalize_for_lookup Output Invariant**
    - **Validates: Requirements 2.1**
    - Create `test/properties/normalize-for-lookup.property.spec.ts`
    - Use fast-check to generate arbitrary strings
    - Assert output contains only [a-z0-9], assert idempotence (normalizing twice = normalizing once)
    - Include unit test examples from requirements: "Cash & Cash Equivalents" → "cashandcashequivalents", "SG&A" → "sga", etc.

  - [x] 1.3 Define TypeScript interfaces for MetricDefinition and MetricResolution
    - Create `src/rag/metric-resolution/types.ts`
    - Define `MetricDefinition` interface matching YAML schema (canonical_id, display_name, type, statement, category, asset_class, industry, synonyms, xbrl_tags, db_column, formula, dependencies, output_format, output_suffix, interpretation, calculation_notes)
    - Define `MetricResolution` interface (canonical_id, display_name, type, confidence, fuzzy_score, original_query, match_source, suggestions, db_column, formula, dependencies)
    - Define `MetricSuggestion` interface (canonical_id, display_name, fuzzy_score)
    - Define `IndexBuildResult` interface (metricsLoaded, synonymsIndexed, collisions, loadTimeMs)
    - Define `RegistryStats` interface
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 1.4 Upload pre-built YAML registry files to S3
    - Source files are in `.kiro/specs/metric-resolution-architecture/` (20 YAML files, 252 metrics, 1,209 synonyms)
    - Upload to S3 bucket `fundlens-documents-dev` under `metrics/` prefix using the directory structure from design.md:
      - `metrics/universal/` ← `income_statement.yaml`, `balance_sheet.yaml`, `cash_flow.yaml`, `equity_statement.yaml`
      - `metrics/sector/` ← `revenue_by_industry.yaml`, `energy.yaml`, `materials.yaml`, `industrials.yaml`, `consumer_discretionary.yaml`, `consumer_staples.yaml`, `healthcare.yaml`, `financials.yaml`, `info_tech.yaml`, `communication_services.yaml`, `utilities.yaml`, `real_estate.yaml`
      - `metrics/pe_specific/` ← `return_and_fund_metrics.yaml`
      - `metrics/computed/` ← `all_computed_metrics.yaml`
      - `metrics/concepts/` ← `analytical_concepts.yaml`
      - `metrics/clients/` ← `third_avenue.yaml`
    - Create a script `scripts/upload-metric-registry.js` that reads from the spec directory and uploads to S3
    - For local dev, also copy files to `local-s3-storage/fundlens-documents-dev/metrics/` as filesystem fallback
    - Validate: all files uploaded successfully, total metric count matches 252
    - Note: these YAML files are the authoritative registry for ALL tenants — client overlays extend but never replace
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 1.5 Implement MetricRegistryService with S3 YAML loading and inverted index
    - Create `src/rag/metric-resolution/metric-registry.service.ts`
    - Inject AWS S3 client (use existing S3 service or `@aws-sdk/client-s3`)
    - Read S3 bucket from env var `S3_BUCKET_NAME` (default: `fundlens-documents-dev`) and prefix from `METRIC_REGISTRY_S3_PREFIX` (default: `metrics/`)
    - Implement `onModuleInit()`: list objects in S3 bucket/prefix, download YAML files, parse with js-yaml, validate schema, build inverted index
    - Build `synonymIndex: Map<string, string>` mapping normalized synonyms → canonical_id
    - Build `metricsById: Map<string, MetricDefinition>` for full metric lookup
    - Build `originalSynonyms: Map<string, string>` preserving original text for display
    - For each metric: index canonical_id, display_name, all synonyms, XBRL tag labels (strip namespace prefix) — all via normalizeForLookup()
    - Handle duplicate canonical_ids across files (e.g., `net_income` appears in income_statement.yaml, cash_flow.yaml, equity_statement.yaml) — merge synonyms, keep first definition's metadata
    - Log synonym collisions as warnings, keep first entry
    - Validate all atomic metrics have non-empty db_column (note: many sector/PE metrics lack db_column since they're supplemental — log warning but don't fail)
    - Wrap with LRU cache (lru-cache package, max 10,000 entries)
    - Implement `resolve(query, tenantId?)`: normalize → cache check → index lookup → return MetricResolution with confidence "exact"
    - Implement `resolveMultiple(queries, tenantId?)`: resolve each query
    - Implement `rebuildIndex()`: reload from S3, rebuild all maps
    - Implement `getStats()`: return metrics count, synonyms count, collisions, cache size
    - For local dev: support filesystem fallback reading from `local-s3-storage/fundlens-documents-dev/metrics/` when `USE_MOCK_S3=true`
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 1.8, 3.1, 3.2, 3.4, 3.6_

  - [ ]* 1.6 Write property tests for MetricRegistryService exact match resolution
    - **Property 1: Synonym Resolution Completeness**
    - **Validates: Requirements 1.4, 3.4**
    - Create `test/properties/metric-resolution.property.spec.ts`
    - Load test YAML fixtures, build index, use fast-check to pick random metrics and random synonyms from those metrics
    - Assert: resolving any synonym returns the correct canonical_id with confidence "exact"
    - **Property 2: Resolution Idempotence**
    - **Validates: Requirements 3.1, 3.2**
    - Assert: resolving the same query twice returns identical MetricResolution objects
    - **Property 18: Atomic Metric db_column Validation**
    - **Validates: Requirements 1.6**
    - Assert: every atomic metric in the registry has non-null, non-empty db_column

  - [x] 1.7 Wire MetricRegistryService into QueryRouterService replacing normalizeMetrics()
    - In `QueryRouterService`, inject `MetricRegistryService` instead of `MetricMappingService`
    - Replace `normalizeMetrics()` method with `resolveMetrics()` that calls `metricRegistry.resolveMultiple()`
    - For now, extract db_column from each MetricResolution and pass as string[] to StructuredQuery (Phase 2 will change StructuredQuery to carry MetricResolution[])
    - Remove MetricMappingService import and injection
    - _Requirements: 7.2, 8.5_

  - [x] 1.8 Register MetricRegistryService in NestJS module
    - Add MetricRegistryService to the RAG module providers
    - Configure S3 bucket via existing `S3_BUCKET_NAME` env var (default: `fundlens-documents-dev`) and prefix via `METRIC_REGISTRY_S3_PREFIX` env var (default: `metrics/`)
    - Add js-yaml and lru-cache to package.json if not already present
    - _Requirements: 1.1_

- [x] 2. Checkpoint — Phase 1 Validation
  - Ensure all tests pass, ask the user if questions arise.
  - Verify MetricRegistryService loads YAML from S3 (or local fallback for dev)
  - Verify exact match resolution works for known synonyms
  - Verify QueryRouterService uses new resolution path

- [ ] 3. Phase 2 Completeness: Fuzzy Matching, MetricResolution Objects, Legacy Deletion
  - [x] 3.1 Add fuzzy matching to MetricRegistryService
    - Install `string-similarity` (or `fuse.js`) package
    - In `resolve()`, when exact match fails: run fuzzy match against all keys in synonymIndex
    - Use token-level comparison (string-similarity's `compareTwoStrings` or fuse.js with tokenize)
    - Score >= 0.85: auto-resolve, return MetricResolution with confidence "fuzzy_auto" and fuzzy_score, populate cache
    - Score 0.70-0.84: return MetricResolution with confidence "unresolved", top 3 candidates as suggestions
    - Score < 0.70: return MetricResolution with confidence "unresolved", empty suggestions
    - Log every unresolved query (raw query, timestamp, tenantId, suggestions offered)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 12.1_

  - [ ]* 3.2 Write property tests for fuzzy matching and threshold classification
    - **Property 4: Fuzzy Threshold Classification**
    - **Validates: Requirements 4.2, 4.3, 4.4**
    - Create test fixtures with known fuzzy distances
    - Use fast-check to generate query variants (character swaps, missing chars, extra chars)
    - Assert confidence classification matches score thresholds
    - **Property 5: MetricResolution Structural Completeness**
    - **Validates: Requirements 5.1, 5.2**
    - Generate arbitrary strings, resolve each, assert all required fields present
    - **Property 6: Resolved Metric Type-Specific Fields**
    - **Validates: Requirements 5.3**
    - For resolved metrics, assert atomic has db_column, computed has formula+dependencies
    - **Property 7: Unresolved Suggestions Bounded**
    - **Validates: Requirements 5.4**
    - For unresolved results with suggestions, assert length <= 3

  - [x] 3.3 Update StructuredQuery to carry MetricResolution objects
    - In `src/rag/types/query-intent.ts`, change `StructuredQuery.metrics` from `string[]` to `MetricResolution[]`
    - Update `QueryRouterService.buildStructuredPlan()` and `buildHybridPlan()` to pass MetricResolution[] directly
    - Update `StructuredRetrieverService.retrieve()` to extract `db_column` from each MetricResolution for WHERE clauses
    - Update `ResponseEnrichmentService.buildMarkdownTable()` to use `display_name` from MetricResolution instead of `formatMetricLabel()`
    - Fix all TypeScript compilation errors from the interface change
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 3.4 Write property test for display name in output
    - **Property 10: Display Name in User-Facing Output**
    - **Validates: Requirements 7.4, 9.4**
    - Generate MetricResolution objects with known display_names and canonical_ids
    - Build markdown table, assert display_name appears, assert canonical_id (snake_case) does not appear

  - [x] 3.5 Implement client overlay loading and tenant-scoped resolution
    - In MetricRegistryService, implement `loadClientOverlay(tenantId)`: fetch `clients/{tenantId}.yaml` from S3 (`s3://fundlens-documents-dev/metrics/clients/`)
    - Parse overlay YAML (schema: `client`, `notes`, `overrides` with `additional_synonyms` per metric — see `third_avenue.yaml` for reference)
    - In `resolve(query, tenantId)`: if tenantId provided, load overlay (cache per-tenant), merge additional synonyms into a temporary index for this resolution
    - Overlay synonyms extend, never replace universal synonyms
    - If overlay file doesn't exist, use universal registry silently (no error)
    - Test with pre-built `third_avenue.yaml` overlay (Third Avenue Management deep value terminology)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 3.6 Write property tests for tenant isolation
    - **Property 8: Client Overlay Additive Merge**
    - **Validates: Requirements 6.2**
    - Create test overlay, resolve universal synonyms before and after overlay, assert same results
    - **Property 9: Tenant Isolation**
    - **Validates: Requirements 6.3**
    - Create two tenant overlays with distinct synonyms, assert tenant A's synonym doesn't resolve for tenant B

  - [x] 3.7 Add graceful degradation responses
    - In `RAGService` or `ResponseEnrichmentService`, when MetricResolution has confidence "unresolved":
      - If suggestions exist: format response as "Showing results for [top suggestion display_name] — is that what you meant?" with clickable suggestion chips
      - If no suggestions: format as "I don't have a metric mapped for [original_query] yet" with closest alternatives
    - Ensure no empty tables are ever returned without explanation
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ]* 3.8 Write property test for no empty results without explanation
    - **Property 11: No Empty Results Without Explanation**
    - **Validates: Requirements 9.3**
    - Generate random queries that produce zero DB results, assert response contains non-empty explanation

  - [x] 3.9 Delete legacy metric resolution code
    - Delete the entire `extractMetrics()` method and `metricPatterns` object from `IntentDetectorService`
    - Delete `resolveMetricsWithSLM()` and `extractCandidatePhrases()` from `IntentDetectorService`
    - Delete `MetricMappingService` class (`src/rag/metric-mapping.service.ts`)
    - Remove MetricMappingService from NestJS module providers and all imports
    - Delete the `normalize()` method from MetricMappingService (already gone with the class)
    - Remove silent fallback in QueryRouterService that uses raw metric keys when resolution fails
    - Update IntentDetectorService to use MetricRegistryService for metric detection (the resolution pipeline IS the detection mechanism)
    - Fix all TypeScript compilation errors
    - Ensure `extractPeriod()`, `extractTicker()`, `determinePeriodType()` are preserved unchanged
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 15.1, 15.2, 15.3, 15.4_

- [x] 4. Checkpoint — Phase 2 Validation
  - Ensure all tests pass, ask the user if questions arise.
  - Verify fuzzy matching works for typos and close variants
  - Verify MetricResolution objects flow through the entire pipeline
  - Verify legacy code is fully removed and no compilation errors
  - Verify graceful degradation messages appear for unresolved queries

- [x] 5. Phase 3 Computed Metrics: Python Calculation Bridge and Formula Dispatch
  - [x] 5.1 Implement DAG validation for computed metric dependencies
    - In MetricRegistryService, after loading all metrics, build dependency graph from computed metrics
    - Implement topological sort to validate the graph is a DAG
    - If cycle detected: log error with full cycle path (e.g., "Circular dependency: A → B → C → A"), exclude cycled metrics from registry
    - Store topological order for efficient resolution ordering
    - _Requirements: 10.2, 10.3, 14.3_

  - [ ]* 5.2 Write property tests for DAG validation
    - **Property 12: DAG Validation Correctness**
    - **Validates: Requirements 10.2, 10.3**
    - Create `test/properties/dag-validation.property.spec.ts`
    - Use fast-check to generate random directed graphs (both DAGs and graphs with cycles)
    - Assert: cycles are always detected, valid DAGs always pass

  - [x] 5.3 Add generic `/calculate` endpoint to Python financial_calculator.py
    - In `python_parser/financial_calculator.py`, add a new Flask/FastAPI route: `POST /calculate`
    - Accept JSON body: `{ formula, inputs, output_format }`
    - Install `simpleeval` package — use `SimpleEval` class for inline expression evaluation (NOT Python `eval()`)
    - Register named functions in simpleeval: `cagr(values, periods)`, `irr(cash_flows)`, `compound_growth(start, end, periods)`
    - Use Python `decimal.Decimal` for all arithmetic to ensure financial-grade precision
    - Validate all formula variables exist in inputs dict — return clear error if any missing
    - Build audit trail: formula, inputs, intermediate steps, result, execution_time_ms
    - Apply output_format rounding: percentage → as-is, ratio → as-is, currency → round to integer, days → 1 decimal
    - Return `{ result, audit_trail }` on success, `{ error, formula, provided_inputs }` on failure
    - Existing endpoints (`/calculate-metrics`, `/health`) remain unchanged
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9_

  - [ ]* 5.4 Write property tests for Python `/calculate` endpoint safety
    - **Property 19: Python Formula Evaluation Safety**
    - **Validates: Requirements 16.3**
    - Create `test/properties/python-formula-safety.property.spec.ts`
    - Use fast-check to generate formula strings containing injection attempts (`os.system`, `import`, `__builtins__`, `exec`, `eval`)
    - Assert: all return errors, none execute
    - **Property 20: Formula Variable Completeness**
    - **Validates: Requirements 16.6**
    - Generate formulas with known variables, remove random variables from inputs
    - Assert: error returned identifying missing variable, never silent 0/None substitution

  - [x] 5.5 Extend FinancialCalculatorService with evaluateFormula() method
    - In `src/deals/financial-calculator.service.ts`, add new method:
      ```typescript
      async evaluateFormula(formula: string, inputs: Record<string, number>, outputFormat: string): Promise<PythonCalculationResult>
      ```
    - HTTP POST to Python `/calculate` endpoint (same host as existing `/calculate-metrics`)
    - Handle errors: Python unreachable (circuit breaker), formula error (return null with explanation)
    - Return `{ result, audit_trail }` on success
    - _Requirements: 16.10_

  - [x] 5.6 Implement FormulaResolutionService as dispatcher
    - Create `src/rag/metric-resolution/formula-resolution.service.ts`
    - Inject MetricRegistryService, PrismaService, FinancialCalculatorService
    - Implement resolution cache: `Map<string, ResolvedValue>` keyed by `${ticker}:${period}:${metricId}` — avoids redundant DB hits when multiple computed metrics share dependencies
    - Implement `resolveComputed(resolution, ticker, period)`:
      - Get metric definition from registry (formula, dependencies, output_format)
      - Walk the dependency DAG using topological order from 5.1
      - For each dependency: check resolution cache → if atomic, batch-fetch from DB → if computed, recurse
      - If ANY dependency is null: return null with explanation "Cannot calculate [display_name]: missing [dependency display_name] for [period]" — do NOT dispatch to Python
      - Never return 0 for missing values
      - If all dependencies resolved: package `{ formula, inputs, output_format }` and call `calculator.evaluateFormula()`
      - Wire interpretation thresholds from YAML to output (e.g., "Net Debt/EBITDA: 2.3x — Moderate")
      - Return ComputedMetricResult with formula, resolved_inputs, value, audit_trail, interpretation
    - Implement `batchFetchAtomicValues(metricIds, ticker, period)`: single Prisma query fetching all needed atomic values
    - _Requirements: 10.4, 10.5, 10.6, 10.7, 10.9, 10.10_

  - [ ]* 5.7 Write property tests for formula resolution
    - **Property 13: Computed Metric Dependency Resolution (Python Bridge)**
    - **Validates: Requirements 10.4, 16.1**
    - Create `test/properties/formula-resolution.property.spec.ts`
    - Generate computed metrics with known formulas and mock DB values
    - Assert: all dependencies resolved, result is non-null, audit_trail is non-null
    - **Property 14: Missing Dependency Returns Null With Explanation (No Python Call)**
    - **Validates: Requirements 10.5, 10.6**
    - Generate computed metrics with at least one null dependency
    - Assert: result is null (not 0), explanation is non-empty and contains missing dependency name, Python NOT called
    - **Property 15: Computed Metric Transparency (With Audit Trail)**
    - **Validates: Requirements 10.7, 16.5**
    - For successful computations, assert formula string present, resolved_inputs count equals dependencies count, audit_trail contains execution_time_ms

  - [x] 5.8 Replace getComputedMetrics() if/else chain with formula-driven dispatch
    - In `RAGService`, replace `getComputedMetrics()` method:
      - For each metric in the query with type "computed", call `FormulaResolutionService.resolveComputed()`
      - Remove hardcoded if/else for gross_margin, net_margin, ebitda, fcf
      - Format ComputedMetricResult into the existing response structure
      - Include interpretation thresholds in response when available
    - Delete the old `getComputedMetrics()` method
    - _Requirements: 10.8_

  - [x] 5.9 Register FormulaResolutionService in NestJS module
    - Add FormulaResolutionService to RAG module providers
    - Wire dependencies (MetricRegistryService, PrismaService, FinancialCalculatorService)
    - _Requirements: 10.4_

- [x] 6. Checkpoint — Phase 3 Validation
  - Ensure all tests pass, ask the user if questions arise.
  - Verify Python `/calculate` endpoint works with inline expressions and named functions
  - Verify `simpleeval` blocks injection attempts (no `eval()`, no `os.system`, no `import`)
  - Verify computed metrics resolve via formula dispatch to Python (not hardcoded if/else)
  - Verify missing dependencies produce null with explanation (never 0) and do NOT call Python
  - Verify formula transparency with audit trail in responses
  - Verify interpretation thresholds wire to output

- [x] 7. Phase 4 Concepts: Analytical Question → Metric Bundle Mapping
  - [x] 7.1 Upload concept YAML files to S3
    - The concept registry is pre-built: `.kiro/specs/metric-resolution-architecture/analytical_concepts.yaml` (10 concepts: leverage, profitability, liquidity, capital_allocation, earnings_quality, valuation, growth, efficiency, downside_protection, management_alignment)
    - Each concept includes: display_name, description, 10-17 triggers, primary_metrics by sector (all + sector-specific), secondary_metrics, context_prompt for RAG, presentation config
    - PE-specific metric overrides are included in primary_metrics (e.g., leverage → net_debt_to_ebitda + interest_coverage + leverage_at_entry for private_equity)
    - Upload to `s3://fundlens-documents-dev/metrics/concepts/analytical_concepts.yaml` (already handled by task 1.4 upload script)
    - Verify: all 10 concepts load correctly, all referenced metric IDs exist in the registry
    - _Requirements: 11.1_

  - [x] 7.2 Implement ConceptRegistryService
    - Create `src/rag/metric-resolution/concept-registry.service.ts`
    - Load concept YAML from S3 at startup
    - Build trigger index: normalized trigger → concept_id (same normalization as metric synonyms)
    - Implement `matchConcept(query)`: normalize query, check trigger index for exact match, fuzzy match on triggers if no exact match
    - Implement `getMetricBundle(conceptId, sector, assetClass)`: collect primary_metrics from "all" + sector key, secondary_metrics from "all" + asset_class key, deduplicate
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ]* 7.3 Write property tests for concept registry
    - **Property 16: Concept Trigger Matching**
    - **Validates: Requirements 11.2**
    - Create `test/properties/concept-registry.property.spec.ts`
    - For each concept, pick random triggers, assert correct concept matched
    - **Property 17: Concept Metric Collection by Sector**
    - **Validates: Requirements 11.3**
    - For each concept and sector, assert bundle includes "all" metrics + sector-specific, no duplicates

  - [x] 7.4 Integrate ConceptRegistryService with Intent Router
    - In IntentDetectorService or QueryRouterService, when query matches a concept trigger (TYPE C):
      - Match concept via ConceptRegistryService
      - Get metric bundle for company's sector and asset class
      - Resolve each metric through MetricRegistryService
      - Execute atomic lookups and computed metric calculations
      - If concept has context_prompt, pass to RAG pipeline asynchronously
    - _Requirements: 11.2, 11.3, 11.4, 11.5_

  - [x] 7.5 Register ConceptRegistryService in NestJS module
    - Add ConceptRegistryService to RAG module providers
    - _Requirements: 11.1_

- [x] 8. Checkpoint — Phase 4 Validation
  - Ensure all tests pass, ask the user if questions arise.
  - Verify concept queries return composite metric profiles
  - Verify sector and asset class filtering works correctly

- [x] 9. Phase 5 Learning Loop: Feedback and Offline Improvement
  - [x] 9.1 Create MetricResolutionLog database model
    - Add Prisma model for MetricResolutionLog (id, tenantId, rawQuery, confidence, resolvedTo, suggestions, userChoice, timestamp)
    - Create and run migration
    - Add indexes on (tenantId, timestamp) and (confidence, timestamp)
    - _Requirements: 12.1, 12.2_

  - [x] 9.2 Implement resolution logging in MetricRegistryService
    - After every resolution, log to MetricResolutionLog via PrismaService
    - Log: tenantId, rawQuery, confidence, resolvedTo (canonical_id or null), suggestions offered
    - For cache misses specifically, log with a flag for analytics
    - _Requirements: 12.1, 3.5_

  - [x] 9.3 Implement analyst correction endpoint
    - Create API endpoint: POST `/api/metrics/correction` accepting { rawQuery, selectedMetricId, tenantId }
    - Update MetricResolutionLog entry with userChoice
    - Log the correction as a candidate synonym mapping
    - _Requirements: 12.2_

  - [x] 9.4 Implement admin index rebuild endpoint
    - Create API endpoint: POST `/api/admin/metrics/rebuild-index`
    - Call MetricRegistryService.rebuildIndex()
    - Return IndexBuildResult with metrics loaded, synonyms indexed, collisions, load time
    - _Requirements: 1.7_

- [x] 10. Checkpoint — Phase 5 Validation
  - Ensure all tests pass, ask the user if questions arise.
  - Verify resolution logging works for all confidence levels
  - Verify analyst correction endpoint updates MetricResolutionLog

- [x] 11. Phase 6 Admin Formula Management: CRUD, Validation, Approval Workflow
  - [x] 11.1 Create PendingFormula database model and migration
    - Add `PendingFormula` model to `prisma/schema.prisma` with fields: id, canonicalId, displayName, formula, dependencies (Json), outputFormat, category, industry, assetClass (Json), interpretation (Json), synonyms (Json), calculationNotes, submittedBy, reviewedBy, status, rejectionReason, submittedAt, reviewedAt
    - Create and run Prisma migration
    - Add indexes on (status) and (submittedAt)
    - _Requirements: 17.8_

  - [x] 11.2 Implement admin formula CRUD API endpoints
    - Create `src/admin/formula-management.controller.ts` and `src/admin/formula-management.service.ts`
    - `POST /api/admin/formulas` — create new formula submission:
      - Accept: metric_name, display_name, inputs (comma-delimited canonical_ids), formula, output_format, category, industry, asset_class, interpretation, synonyms
      - Validate formula by sending test payload to Python `/calculate` with sample input values (use 1000000 for currency, 0.15 for ratios, etc.)
      - If Python validation succeeds: save to `pending_formulas` with status "pending_review"
      - If Python validation fails: return error with Python error message (syntax error, missing variable, division by zero)
    - `GET /api/admin/formulas/pending` — list all pending formulas
    - `GET /api/admin/formulas/:id` — get single formula details
    - `POST /api/admin/formulas/:id/approve` — approve formula:
      - Build YAML entry from PendingFormula fields
      - Append to `metrics/computed/all_computed_metrics.yaml` in S3 (or create new file for industry-specific)
      - Trigger `MetricRegistryService.rebuildIndex()`
      - Update PendingFormula status → "approved", set reviewedBy and reviewedAt
    - `POST /api/admin/formulas/:id/reject` — reject formula:
      - Accept rejection_reason
      - Update PendingFormula status → "rejected", set rejectionReason, reviewedBy, reviewedAt
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.9_

  - [ ]* 11.3 Write property test for admin formula validation
    - **Property 21: Admin Formula Validation Before Persistence**
    - **Validates: Requirements 17.2, 17.3**
    - Create `test/properties/admin-formula-validation.property.spec.ts`
    - Generate formula submissions with valid and invalid formulas
    - Assert: invalid formulas never reach pending_review status, valid formulas always do

  - [x] 11.4 Register formula management in NestJS module
    - Add FormulaManagementController and FormulaManagementService to admin module providers
    - Wire dependencies (PrismaService, FinancialCalculatorService, MetricRegistryService, S3 service)
    - _Requirements: 17.10_

- [x] 12. Final Checkpoint — Full System Validation
  - Ensure all tests pass, ask the user if questions arise.
  - Verify end-to-end: analyst query → resolution → DB lookup → Python formula dispatch → response with display names and audit trail
  - Verify computed metrics with formula transparency and interpretation thresholds
  - Verify graceful degradation for unresolved queries
  - Verify tenant isolation with client overlays
  - Verify Python `/calculate` endpoint handles inline expressions and named functions
  - Verify admin formula submission → validation → approval → S3 write → index rebuild
  - Verify no legacy code remains (extractMetrics, MetricMappingService, resolveMetricsWithSLM, getComputedMetrics if/else)

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each phase
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Phase 1 is independently deployable — exact match resolution replaces the broken system immediately
- The Python Calculation Engine (`financial_calculator.py`) IS modified: a new generic `POST /calculate` endpoint is added in Phase 3 (task 5.3)
- Python is the SINGLE execution environment for ALL formula evaluation — TypeScript `FormulaResolutionService` is a dispatcher, not a calculator
- The `/calculate` endpoint uses `simpleeval` (safe expression evaluator), NOT Python `eval()`, to prevent code injection
- Python uses `decimal.Decimal` for all arithmetic to ensure financial-grade precision
- Two formula modes: inline expressions (`gross_profit / revenue * 100`) and named functions (`cagr(revenue, 3)`)
- YAML registry files (252 metrics, 1,209 synonyms) are pre-authored in `.kiro/specs/metric-resolution-architecture/` — task 1.4 uploads them to S3
- S3 bucket: `fundlens-documents-dev` (existing, from `S3_BUCKET_NAME` env var), prefix: `metrics/`
- For local dev, support filesystem fallback via `local-s3-storage/fundlens-documents-dev/metrics/` when `USE_MOCK_S3=true`
- Some metrics appear in multiple YAML files (e.g., `net_income` in income_statement, cash_flow, equity_statement) — the loader must merge synonyms and deduplicate
- Sector/PE metrics may lack `db_column` since they're supplemental KPIs not stored in the financialMetric table — log warning but don't fail validation
- The learning loop writes approved synonyms back to S3, and index rebuild can be triggered via API endpoint without restarting the app
- Admin formula management (Phase 6) includes a human review step: pending_formulas → approval → S3 write → index rebuild
- Feature flag `USE_FORMULA_REGISTRY=true/false` enables phased rollout and instant rollback
- S3 versioning on the metrics/ prefix provides YAML rollback capability
- Estimated timeline: ~10-14 working days total across all 6 phases
