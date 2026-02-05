# CHANGELOG: RAG Competitive Intelligence Extraction

## Overview

This changelog tracks all changes for the RAG Competitive Intelligence Extraction feature, which addresses critical failures in extracting competitive intelligence, MD&A insights, and footnote details from SEC filings.

**Feature Location**: `.kiro/specs/rag-competitive-intelligence-extraction/`

**Implementation Approach**: Phased rollout with git tags and rollback capability

---

## Git Tagging Strategy

### Tag Format
- **Baseline**: `rag-extraction-baseline` (before any changes)
- **Phase Tags**: `rag-extraction-phase{N}-v{X}.{Y}.{Z}`
- **Hotfix Tags**: `rag-extraction-phase{N}-hotfix-v{X}.{Y}.{Z}`

### Tag Descriptions
- `rag-extraction-baseline`: System state before RAG extraction improvements
- `rag-extraction-phase1-v1.0.0`: Core subsection extraction and storage
- `rag-extraction-phase2-v1.0.0`: Intent detection and subsection-aware retrieval
- `rag-extraction-phase3-v1.0.0`: Advanced retrieval techniques (HyDE, reranking)
- `rag-extraction-phase4-v1.0.0`: Dynamic calculations and multi-modal responses

### Rollback Commands
```bash
# Rollback to baseline (before any changes)
git checkout rag-extraction-baseline

# Rollback to Phase 1 (from Phase 2)
git checkout rag-extraction-phase1-v1.0.0

# Rollback to Phase 2 (from Phase 3)
git checkout rag-extraction-phase2-v1.0.0

# Rollback to Phase 3 (from Phase 4)
git checkout rag-extraction-phase3-v1.0.0
```

---

## Baseline (Pre-Implementation)

**Tag**: `rag-extraction-baseline`
**Date**: 2026-02-03
**Status**: Baseline established

### Current Behavior
- Competitive intelligence queries identify Item 1 but don't extract competitor names
- MD&A queries identify Item 7 but don't extract trends, risks, or guidance
- Footnote queries identify Item 8 but don't extract accounting policy details
- No subsection-level targeting
- No confidence scoring or quality validation
- Risk of data mixing in multi-company queries

### Known Issues
1. **Issue #1**: "Who are NVDA's competitors?" returns section references but no competitor names
2. **Issue #2**: MD&A queries don't extract structured insights (trends, risks, guidance)
3. **Issue #3**: Footnote queries don't extract specific accounting policy details
4. **Issue #4**: No validation to prevent ticker mixing in multi-company queries

---

## Phase 1: Core Subsection Extraction and Storage

**Tag**: `rag-extraction-phase1-v1.0.0`
**Date**: 2026-02-03
**Risk Level**: LOW
**Status**: COMPLETE

### Changes

#### Database Schema
- **Added**: `subsection_name` column to `narrative_chunks` table (nullable TEXT)
- **Added**: Index on `(ticker, section_type, subsection_name)` for efficient filtering
- **Migration**: `20260203_add_subsection_to_narrative_chunks.sql`

#### Python Parser (`python_parser/section_parser.py`)
- **Enhanced**: Subsection identification for Item 1 (Business)
  - Identifies: Competition, Products, Customers, Markets, Operations, Strategy, Intellectual Property, Human Capital
- **Enhanced**: Subsection identification for Item 7 (MD&A)
  - Identifies: Results of Operations, Liquidity and Capital Resources, Critical Accounting Policies, Market Risk
- **Enhanced**: Subsection identification for Item 8 (Financial Statements)
  - Identifies: Note 1, Note 2, etc., Revenue Recognition, Leases, Stock-Based Compensation
- **Enhanced**: Subsection identification for Item 1A (Risk Factors)
  - Identifies: Operational Risks, Financial Risks, Market Risks, Regulatory Risks
- **Added**: Hierarchical subsection support (e.g., Item 7 > Results of Operations > Revenue Analysis)
- **Maintained**: Backward compatibility with existing chunks (null subsection_name)

#### Bedrock KB Sync (`src/rag/chunk-exporter.service.ts`)
- **Enhanced**: Export chunks with `subsection_name` metadata to S3
- **Enhanced**: Omit `subsection_name` from metadata if null (don't export null values)
- **Added**: Backfill script for existing chunks (`scripts/backfill-subsection-metadata.js`)

#### Tests
- **Added**: Property test for universal subsection identification (Property 1)
- **Added**: Property test for subsection metadata persistence (Property 2)
- **Added**: Property test for hierarchical subsection support (Property 3)
- **Added**: Property test for backward compatibility (Property 4)
- **Added**: Unit tests for Item 1, 7, 8, 1A subsection identification

### Success Criteria
- [ ] All new chunks have `subsection_name` populated when subsections are identifiable
- [ ] Existing chunks without `subsection_name` work without errors
- [ ] Bedrock KB successfully ingests chunks with subsection metadata
- [ ] All Phase 1 tests pass (4 property tests + unit tests)
- [ ] No impact on current retrieval behavior

### Rollback Procedure
```bash
# Revert database schema
psql -d fundlens -c "ALTER TABLE narrative_chunks DROP COLUMN subsection_name;"
psql -d fundlens -c "DROP INDEX IF EXISTS idx_narrative_chunks_subsection;"

# Revert code changes
git checkout rag-extraction-baseline

# Restart services
npm run build
pm2 restart all
```

### Monitoring
- Track subsection identification rate (target: >80% of chunks have subsection_name)
- Monitor Bedrock KB ingestion success rate
- Alert if subsection identification rate drops below 70%

---

## Phase 2: Intent Detection and Subsection-Aware Retrieval

**Tag**: `rag-extraction-phase2-v1.0.0`
**Date**: Started 2026-02-03
**Risk Level**: MEDIUM
**Estimated Duration**: 2-3 weeks
**Status**: IN PROGRESS

### CRITICAL CLARIFICATION (2026-02-03)

**Phase 2 enhances the EXISTING intent detector with subsection awareness. It does NOT replace the existing system with a narrow competitive-intelligence-only detector.**

The existing `IntentDetectorService` already handles:
- Query types: structured, semantic, hybrid
- Tickers: single or multiple for comparison queries
- Metrics: Revenue, Net_Income, Gross_Profit, Operating_Income, Cost_of_Revenue, R&D, SG&A, Total_Assets, Total_Liabilities, Total_Equity, Cash, Accounts_Payable, Accounts_Receivable, Inventory, margins, ROE, ROA
- Periods: FY2024, Q4-2024, latest, specific years
- Document types: 10-K, 10-Q, 8-K, news, earnings transcripts
- Section types: item_1, item_7, item_8, item_1a, item_2, item_3
- Query characteristics: needsNarrative, needsComparison, needsComputation, needsTrend

**Phase 2 adds ONE NEW FIELD**: `subsectionName?: string` to the `QueryIntent` interface

**Phase 2 adds ONE NEW METHOD**: `identifyTargetSubsection(query: string, sectionType: string): string | undefined`

**How it works**:
1. Existing behavior runs first: Extract ticker, metrics, period, document types, section types, determine query type
2. New behavior runs second: If a section type was identified, also identify the target subsection
3. Result: All existing fields are populated as before, PLUS subsectionName is added when applicable

**Examples**:
- "What is AAPL's revenue recognition policy?" → `{ type: 'semantic', ticker: 'AAPL', sectionTypes: ['item_8'], subsectionName: 'Revenue Recognition' }`
- "Who are NVDA's competitors?" → `{ type: 'semantic', ticker: 'NVDA', sectionTypes: ['item_1'], subsectionName: 'Competition' }`
- "What is AMZN's revenue and how do they recognize it?" → `{ type: 'hybrid', ticker: 'AMZN', metrics: ['Revenue'], sectionTypes: ['item_8'], subsectionName: 'Revenue Recognition' }`
- "What does TSLA do?" → `{ type: 'semantic', ticker: 'TSLA', sectionTypes: ['item_1'], subsectionName: undefined }` (no subsection keywords)

**Why this matters**: The spec was originally written with a focus on competitive intelligence, MD&A, and footnote queries (the example failures), but the solution is general-purpose and applies to ALL query types.

**Documents updated**: design.md, requirements.md, tasks.md, PHASE2_SCOPE_CLARIFICATION.md

### Changes

#### Intent Detector (`src/rag/intent-detector.service.ts`) - ✅ STARTED
- **✅ COMPLETE**: Added `subsectionName?: string` field to `QueryIntent` interface
- **✅ COMPLETE**: Added `identifyTargetSubsection()` method to identify subsections for all section types
- **✅ COMPLETE**: Item 1 (Business) subsection identification
  - Keywords: "competitors", "products", "customers", "markets", "operations", "strategy", "intellectual property", "employees"
  - Subsections: Competition, Products, Customers, Markets, Operations, Strategy, Intellectual Property, Human Capital
- **✅ COMPLETE**: Item 7 (MD&A) subsection identification
  - Keywords: "results of operations", "liquidity", "critical accounting", "market risk", "contractual obligations"
  - Subsections: Results of Operations, Liquidity and Capital Resources, Critical Accounting Policies, Market Risk, Contractual Obligations
- **✅ COMPLETE**: Item 8 (Financial Statements) subsection identification
  - Keywords: "revenue recognition", "leases", "stock-based compensation", "income taxes", "debt", "fair value", "note [number]"
  - Subsections: Revenue Recognition, Leases, Stock-Based Compensation, Income Taxes, Debt, Fair Value, Note {number}
- **✅ COMPLETE**: Item 1A (Risk Factors) subsection identification
  - Keywords: "operational risk", "financial risk", "market risk", "regulatory risk", "technology risk"
  - Subsections: Operational Risks, Financial Risks, Market Risks, Regulatory Risks, Technology Risks
- **✅ COMPLETE**: Subsection prioritization logic (first match wins)
- **✅ COMPLETE**: Integration into `detectIntent()` method - subsection identification runs after section type extraction

#### Semantic Retriever (`src/rag/semantic-retriever.service.ts`) - ✅ COMPLETE
- **✅ COMPLETE**: Added `subsectionNames?: string[]` field to `SemanticQuery` interface
- **✅ COMPLETE**: Filter by `subsection_name` in Bedrock KB queries
- **✅ COMPLETE**: Filter by `subsection_name` in PostgreSQL fallback queries
- **✅ COMPLETE**: Fallback chain: subsection → section → broad search
  - Bedrock KB: Try subsection filter → section-only → ticker-only
  - PostgreSQL: Try subsection filter → section-only → broader search
- **✅ COMPLETE**: Logging for all fallback events
- **Pending**: Multi-ticker isolation with validation

#### Response Generator (`src/rag/response-generator.service.ts`) - ⏳ PENDING (NEW SERVICE)
- **Pending**: Structured competitive intelligence extraction
  - Extracts: competitor names, market positioning, competitive advantages/disadvantages
- **Pending**: Structured MD&A intelligence extraction
  - Extracts: key trends, risks (categorized), forward guidance, management perspective
- **Pending**: Structured footnote content extraction
  - Extracts: policy summary, key assumptions, quantitative details, changes from prior periods
- **Pending**: Confidence scoring (0.0 to 1.0)
- **Pending**: Response quality validation
- **Pending**: Citation generation with section/subsection references

#### Prompt Templates (`src/rag/prompts/`) - ⏳ PENDING
- **Pending**: Competitive intelligence extraction prompt
- **Pending**: MD&A intelligence extraction prompt
- **Pending**: Footnote extraction prompt
- **Pending**: Prompt versioning and management

#### Monitoring (`src/rag/monitoring.service.ts`) - ⏳ PENDING
- **Pending**: Extraction attempt logging (intent type, ticker, success/failure)
- **Pending**: Success rate metrics by intent type
- **Pending**: Average confidence score tracking
- **Pending**: Alerting for success rates < 95% (competitive intelligence)

#### Tests - ⏳ PENDING
- **Pending**: Property tests for intent classification (Properties 5-8)
- **Pending**: Property tests for subsection-filtered retrieval (Properties 9-10)
- **Pending**: Property test for multi-ticker isolation (Property 11)
- **Pending**: Property tests for confidence scoring and citations (Properties 23-25)
- **Pending**: Unit tests for specific intent examples
- **Pending**: Integration tests for end-to-end extraction

### Progress Summary (2026-02-03)

**Completed Tasks**:
- ✅ Task 6.1: Add subsection identification for Item 1 (Business) queries
- ✅ Task 6.2: Add subsection identification for Item 7 (MD&A) queries
- ✅ Task 6.3: Add subsection identification for Item 8 (Financial Statements) queries
- ✅ Task 6.4: Add subsection identification for Item 1A (Risk Factors) queries
- ✅ Task 6.5: Implement subsection prioritization logic
- ✅ Task 7.1: Add subsection filtering to Bedrock KB retrieval
- ✅ Task 7.2: Add subsection filtering to PostgreSQL fallback
- ✅ Task 7.3: Implement fallback chain for retrieval

**In Progress**:
- Task 6: Enhance Intent Detector with subsection identification for ALL query types (5/8 subtasks complete)
- Task 7: Implement subsection-aware retrieval in Semantic Retriever (3/6 subtasks complete)

**Next Steps**:
- Task 6.6-6.8: Write property tests and unit tests for intent detection
- Task 7.4-7.6: Write property tests and unit tests for subsection-aware retrieval
- Task 8: Implement multi-ticker isolation
- Task 9: Create Response Generator Service
- Task 10: Implement prompt engineering
- Task 11: Add monitoring and observability
- Task 12: Phase 2 checkpoint and git tag

### Success Criteria
- [ ] Competitive intelligence queries extract competitor names (success rate >95%)
- [ ] MD&A queries extract trends, risks, guidance (success rate >90%)
- [ ] Footnote queries extract accounting policy details (success rate >90%)
- [ ] Multi-ticker queries maintain strict ticker separation (0 mixing incidents)
- [ ] All Phase 2 tests pass (7 property tests + unit tests + integration tests)
- [ ] Average confidence scores >0.7 for all intent types

### Rollback Procedure
```bash
# Disable subsection filtering via feature flag
export FEATURE_SUBSECTION_FILTERING=false

# Revert code changes
git checkout rag-extraction-phase1-v1.0.0

# Restart services
npm run build
pm2 restart all
```

### Feature Flags
- `FEATURE_SUBSECTION_FILTERING`: Enable/disable subsection-aware retrieval (default: true)
- `FEATURE_STRUCTURED_EXTRACTION`: Enable/disable structured extraction (default: true)
- `FEATURE_CONFIDENCE_SCORING`: Enable/disable confidence scoring (default: true)

### Monitoring
- Track competitive intelligence success rate (target: >95%)
- Track MD&A success rate (target: >90%)
- Track footnote success rate (target: >90%)
- Track average confidence scores by intent type
- Alert if success rates drop below targets
- Alert immediately on any multi-ticker mixing incident

---

## Phase 3: Advanced Retrieval Techniques

**Tag**: `rag-extraction-phase3-v1.0.0`
**Date**: TBD
**Risk Level**: MEDIUM
**Estimated Duration**: 2-3 weeks

### Changes

#### Reranker Service (`src/rag/reranker.service.ts`) - NEW SERVICE
- **Added**: Mistral reranking via Bedrock
- **Added**: Re-score chunks with relevance scores (0.0 to 1.0)
- **Added**: Fallback to original scores if reranking fails

#### Advanced Retrieval Service (`src/rag/advanced-retrieval.service.ts`) - NEW SERVICE
- **Added**: HyDE (Hypothetical Document Embeddings)
  - Generate hypothetical answer using Claude
  - Embed and retrieve using hypothetical embedding
  - Merge with query-based retrieval and deduplicate
- **Added**: Query Decomposition
  - Detect multi-faceted queries
  - Break into sub-queries using Claude
  - Execute independently and synthesize unified response
- **Added**: Contextual Chunk Expansion
  - Fetch adjacent chunks (chunk_index ± 1)
  - Merge into coherent context window
  - Limit to token budget (4000 tokens)
- **Added**: Iterative Retrieval
  - Detect low-confidence results
  - Generate follow-up queries to fill gaps
  - Limit to 2 iterations

#### Tests
- **Added**: Property tests for reranking (Properties 12-13)
- **Added**: Property tests for HyDE, query decomposition, contextual expansion (Properties 14-16)
- **Added**: Property test for iterative retrieval termination (Property 17)
- **Added**: Unit tests for all advanced techniques
- **Added**: Integration tests comparing Phase 2 vs Phase 3 retrieval quality

### Success Criteria
- [ ] Reranking improves top-3 relevance by >10%
- [ ] HyDE improves retrieval for ambiguous queries
- [ ] Query decomposition handles multi-faceted queries correctly
- [ ] Contextual expansion never exceeds token budget
- [ ] Iterative retrieval terminates after 2 iterations
- [ ] Latency p95 < 5 seconds
- [ ] All Phase 3 tests pass (6 property tests + unit tests + integration tests)

### Rollback Procedure
```bash
# Disable advanced retrieval features via feature flags
export FEATURE_RERANKING=false
export FEATURE_HYDE=false
export FEATURE_QUERY_DECOMPOSITION=false
export FEATURE_CONTEXTUAL_EXPANSION=false
export FEATURE_ITERATIVE_RETRIEVAL=false

# Revert code changes
git checkout rag-extraction-phase2-v1.0.0

# Restart services
npm run build
pm2 restart all
```

### Feature Flags
- `FEATURE_RERANKING`: Enable/disable reranking (default: true)
- `FEATURE_HYDE`: Enable/disable HyDE (default: true)
- `FEATURE_QUERY_DECOMPOSITION`: Enable/disable query decomposition (default: true)
- `FEATURE_CONTEXTUAL_EXPANSION`: Enable/disable contextual expansion (default: true)
- `FEATURE_ITERATIVE_RETRIEVAL`: Enable/disable iterative retrieval (default: true)

### Monitoring
- Track reranking improvement (target: >10% improvement in top-3 relevance)
- Track HyDE usage and success rate
- Track query decomposition frequency
- Track contextual expansion token usage
- Track iterative retrieval frequency and iteration counts
- Track latency p95 (target: <5 seconds)
- Alert if latency p95 exceeds 5 seconds

---

## Phase 4: Dynamic Calculations and Multi-Modal Responses

**Tag**: `rag-extraction-phase4-v1.0.0`
**Date**: TBD
**Risk Level**: HIGH
**Estimated Duration**: 3-4 weeks

### Changes

#### Database Schema
- **Added**: `formula_cache` table for validated formulas
- **Added**: `formula_audit_log` table for formula execution tracking
- **Migration**: `20260203_add_formula_cache.sql`

#### Dynamic Calculator Service (`src/rag/dynamic-calculator.service.ts`) - NEW SERVICE
- **Added**: Formula extraction from natural language queries
- **Added**: Formula validation against known financial formulas
- **Added**: Result bounds validation (e.g., margins 0-100%)
- **Added**: Formula caching with versioning
- **Added**: Formula audit logging

#### Chart Generator Service (`src/rag/chart-generator.service.ts`) - NEW SERVICE
- **Added**: Chart.js configuration generation
- **Added**: Support for line, bar, pie, scatter charts
- **Added**: Consistent styling application
- **Added**: Chart type validation and suggestions

#### Code Interpreter Service (`src/rag/code-interpreter.service.ts`) - NEW SERVICE
- **Added**: Python code generation for complex calculations
- **Added**: Sandboxed execution environment
- **Added**: Timeout and resource limits
- **Added**: Retry with correction (max 2 attempts)
- **Added**: Support for regression, correlation, scenario modeling, sensitivity analysis

#### Multi-Modal Response Generator
- **Enhanced**: Response Generator to include charts and code
- **Added**: Trend analysis → line chart
- **Added**: Peer comparison → bar chart or table
- **Added**: Composition analysis → pie chart
- **Added**: Fallback to text/table if chart generation fails

#### Tests
- **Added**: Property tests for formula validation and caching (Properties 18-20)
- **Added**: Property tests for chart generation and code execution (Properties 21-22)
- **Added**: Property test for hybrid response distinction (Property 27)
- **Added**: Unit tests for dynamic calculator, chart generator, code interpreter
- **Added**: Integration tests for end-to-end dynamic calculations

### Success Criteria
- [ ] Dynamic calculations work for common financial metrics (success rate >90%)
- [ ] Formula validation prevents invalid calculations
- [ ] Formula cache improves performance for repeated calculations
- [ ] Charts generate correctly for all supported types
- [ ] Code interpreter executes safely in sandbox
- [ ] Latency p95 < 8 seconds for dynamic calculations
- [ ] Latency p95 < 15 seconds for code interpreter
- [ ] All Phase 4 tests pass (6 property tests + unit tests + integration tests)

### Rollback Procedure
```bash
# Disable Phase 4 features via feature flags
export FEATURE_DYNAMIC_CALCULATIONS=false
export FEATURE_FORMULA_CACHE=false
export FEATURE_CHART_GENERATION=false
export FEATURE_CODE_INTERPRETER=false
export FEATURE_MULTI_MODAL_RESPONSES=false

# Revert database schema
psql -d fundlens -c "DROP TABLE IF EXISTS formula_audit_log;"
psql -d fundlens -c "DROP TABLE IF EXISTS formula_cache;"

# Revert code changes
git checkout rag-extraction-phase3-v1.0.0

# Restart services
npm run build
pm2 restart all
```

### Feature Flags
- `FEATURE_DYNAMIC_CALCULATIONS`: Enable/disable dynamic calculations (default: true)
- `FEATURE_FORMULA_CACHE`: Enable/disable formula caching (default: true)
- `FEATURE_CHART_GENERATION`: Enable/disable chart generation (default: true)
- `FEATURE_CODE_INTERPRETER`: Enable/disable code interpreter (default: true)
- `FEATURE_MULTI_MODAL_RESPONSES`: Enable/disable multi-modal responses (default: true)

### Monitoring
- Track dynamic calculation success rate (target: >90%)
- Track formula validation failure rate (alert if >10%)
- Track formula cache hit rate
- Track chart generation success rate
- Track code interpreter success rate
- Track latency p95 for dynamic calculations (target: <8 seconds)
- Track latency p95 for code interpreter (target: <15 seconds)
- Alert if formula validation failures exceed 10%
- Alert if latency targets are exceeded

---

## Hotfix Procedures

### Creating a Hotfix
```bash
# Create hotfix branch from phase tag
git checkout -b hotfix/rag-extraction-phase2-fix rag-extraction-phase2-v1.0.0

# Make fixes
# ... commit changes ...

# Tag hotfix
git tag rag-extraction-phase2-hotfix-v1.0.1

# Merge back to main
git checkout main
git merge hotfix/rag-extraction-phase2-fix
```

### Hotfix Naming Convention
- Format: `rag-extraction-phase{N}-hotfix-v{X}.{Y}.{Z}`
- Example: `rag-extraction-phase2-hotfix-v1.0.1`

---

## Testing Summary

### Test Coverage by Phase

**Phase 1**: 4 property tests + unit tests
**Phase 2**: 7 property tests + unit tests + integration tests
**Phase 3**: 6 property tests + unit tests + integration tests
**Phase 4**: 6 property tests + unit tests + integration tests

**Total**: 23 property tests + comprehensive unit and integration tests

### Property Test Configuration
- Library: `fast-check` (TypeScript), `hypothesis` (Python)
- Minimum 100 iterations per property test
- Each test tagged with: `Feature: rag-competitive-intelligence-extraction, Property {number}: {property_text}`

---

## Deployment Checklist

### Pre-Deployment
- [ ] All tests pass for the phase
- [ ] Code review completed
- [ ] Database migrations tested on staging
- [ ] Feature flags configured
- [ ] Monitoring dashboards updated
- [ ] Rollback procedure documented and tested

### Deployment
- [ ] Create git tag for the phase
- [ ] Update CHANGELOG with deployment date
- [ ] Run database migrations
- [ ] Deploy code changes
- [ ] Restart services
- [ ] Verify feature flags are set correctly
- [ ] Run smoke tests

### Post-Deployment
- [ ] Monitor success rates for 24 hours
- [ ] Monitor latency metrics
- [ ] Monitor error rates
- [ ] Verify no multi-ticker mixing incidents
- [ ] Collect user feedback
- [ ] Update documentation

### Rollback Decision Criteria
- Success rate drops below 80% for any intent type
- Latency p95 exceeds targets by >50%
- Any multi-ticker mixing incident detected
- Critical bugs affecting data accuracy
- User feedback indicates significant quality degradation

---

## Contact and Support

**Feature Owner**: TBD
**Technical Lead**: TBD
**Slack Channel**: #rag-extraction-feature
**Documentation**: `.kiro/specs/rag-competitive-intelligence-extraction/`

---

## Appendix: Feature Flag Reference

| Flag | Phase | Default | Description |
|------|-------|---------|-------------|
| `FEATURE_SUBSECTION_FILTERING` | 2 | true | Enable subsection-aware retrieval |
| `FEATURE_STRUCTURED_EXTRACTION` | 2 | true | Enable structured extraction |
| `FEATURE_CONFIDENCE_SCORING` | 2 | true | Enable confidence scoring |
| `FEATURE_RERANKING` | 3 | true | Enable reranking |
| `FEATURE_HYDE` | 3 | true | Enable HyDE |
| `FEATURE_QUERY_DECOMPOSITION` | 3 | true | Enable query decomposition |
| `FEATURE_CONTEXTUAL_EXPANSION` | 3 | true | Enable contextual expansion |
| `FEATURE_ITERATIVE_RETRIEVAL` | 3 | true | Enable iterative retrieval |
| `FEATURE_DYNAMIC_CALCULATIONS` | 4 | true | Enable dynamic calculations |
| `FEATURE_FORMULA_CACHE` | 4 | true | Enable formula caching |
| `FEATURE_CHART_GENERATION` | 4 | true | Enable chart generation |
| `FEATURE_CODE_INTERPRETER` | 4 | true | Enable code interpreter |
| `FEATURE_MULTI_MODAL_RESPONSES` | 4 | true | Enable multi-modal responses |

---

## Version History

- **v0.0.0** (TBD): Baseline - Current system state before improvements
- **v1.0.0** (TBD): Phase 1 - Core subsection extraction and storage
- **v2.0.0** (TBD): Phase 2 - Intent detection and subsection-aware retrieval
- **v3.0.0** (TBD): Phase 3 - Advanced retrieval techniques
- **v4.0.0** (TBD): Phase 4 - Dynamic calculations and multi-modal responses
