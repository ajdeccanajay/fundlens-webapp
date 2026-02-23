# RAG System Diagnostic Package
## Date: February 17, 2026

## Problem Summary

**User Query:** "What is the latest Revenue for ABNB?"
**Expected:** Actual revenue data from database
**Actual:** "No Data Available / We couldn't find Revenue for ABNB"

## Root Cause Hypothesis

The issue spans **two layers**: the retrieval layer AND the metric resolution layer. The three-layer intent detection architecture (regex → cache → LLM) is working correctly. The problems are:

1. **Metric name mismatch**: The database stores metrics with different formats depending on ingestion path:
   - `sec-processing.service.ts`: PascalCase like `"Revenue"`, `"NetIncome"`
   - `metrics.service.ts`: lowercase like `"revenue"`

2. **`getLatestByFilingType` in structured-retriever.service.ts** tries case variations but may not cover all DB formats

3. **ABNB ticker may not be in the hardcoded ticker regex** in `extractTickersFromQuery()`

4. **Metric Resolution Architecture is partially implemented** — the new three-layer resolution stack (Canonical Registry → Formula Resolution → Concept Registry) with YAML-defined metrics, inverted synonym index, and Python calculation bridge exists but the structured retriever hasn't been fully wired to use `MetricResolution.db_column` for WHERE clauses

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RAG QUERY FLOW                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  User Query: "What is the latest Revenue for ABNB?"                 │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              INTENT DETECTION (3 Layers)                     │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │    │
│  │  │ Layer 1:    │  │ Layer 2:    │  │ Layer 3:            │  │    │
│  │  │ Regex       │→ │ Cache       │→ │ LLM (Claude Haiku)  │  │    │
│  │  │ Fast-Path   │  │ Lookup      │  │ Classification      │  │    │
│  │  │ (<10ms, $0) │  │ (<5ms, $0)  │  │ (~$0.0002/query)    │  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘  │    │
│  │                                                              │    │
│  │  Output: QueryIntent {                                       │    │
│  │    type: 'structured',                                       │    │
│  │    ticker: 'ABNB',        ← PROBLEM: ABNB not in regex!     │    │
│  │    metrics: ['revenue'],                                     │    │
│  │    period: 'latest',                                         │    │
│  │    confidence: 0.95                                          │    │
│  │  }                                                           │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │         METRIC RESOLUTION ARCHITECTURE (NEW)                 │    │
│  │                                                              │    │
│  │  MetricRegistryService.resolve("revenue")                    │    │
│  │    ├── normalize_for_lookup → "revenue"                      │    │
│  │    ├── LRU Cache check (10K entries)                         │    │
│  │    ├── Inverted Synonym Index (O(1) lookup)                  │    │
│  │    │   252 metrics, 1,209 synonyms from 20 YAML files       │    │
│  │    ├── Fuzzy match fallback (≥0.85 auto, 0.70-0.84 suggest) │    │
│  │    └── Returns MetricResolution {                            │    │
│  │          canonical_id: "revenue",                            │    │
│  │          display_name: "Revenue",                            │    │
│  │          type: "atomic",                                     │    │
│  │          confidence: "exact",                                │    │
│  │          db_column: "revenue"  ← KEY: maps to DB column     │    │
│  │        }                                                     │    │
│  │                                                              │    │
│  │  FormulaResolutionService (for computed metrics)             │    │
│  │    ├── Resolves dependency DAG                               │    │
│  │    ├── Batch-fetches atomic values from DB                   │    │
│  │    └── Dispatches to Python /calculate endpoint              │    │
│  │                                                              │    │
│  │  ConceptRegistryService (for analytical questions)           │    │
│  │    ├── "How levered is AAPL?" → leverage concept             │    │
│  │    └── Returns sector-filtered metric bundles                │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              QUERY ROUTER                                    │    │
│  │  Builds StructuredQuery with:                                │    │
│  │  - tickers: ['ABNB']                                         │    │
│  │  - metrics: [MetricResolution objects]  ← not raw strings    │    │
│  │  - periodType: 'latest'                                      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              STRUCTURED RETRIEVER                            │    │
│  │                                                              │    │
│  │  ⚠️ PROBLEM: Still uses string-based metric matching         │    │
│  │  instead of MetricResolution.db_column for WHERE clauses     │    │
│  │                                                              │    │
│  │  getLatestByFilingType(ticker, metric, filingType)          │    │
│  │  Tries variations: 'revenue', 'Revenue', etc.               │    │
│  │  DB might have: 'total_revenue', 'Revenue', 'us-gaap:...'   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              RESPONSE                                        │    │
│  │  metrics.length === 0 → "No Data Available"                  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Files Included in This Package

### Core RAG Services (Full Source)
| File | Size | Description |
|------|------|-------------|
| `src/rag/rag.service.ts` | 58KB | Main RAG orchestration |
| `src/rag/intent-detector.service.ts` | 24KB | Three-layer intent detection |
| `src/rag/structured-retriever.service.ts` | 20KB | **PROBLEM AREA** — DB retrieval |
| `src/rag/query-router.service.ts` | 10KB | Query routing |

### Metric Resolution Architecture (Full Source)
| File | Size | Description |
|------|------|-------------|
| `src/rag/metric-resolution/metric-registry.service.ts` | 34KB | Canonical registry + inverted synonym index + resolution pipeline |
| `src/rag/metric-resolution/formula-resolution.service.ts` | 12KB | Computed metric dispatcher → Python calculation bridge |
| `src/rag/metric-resolution/concept-registry.service.ts` | 10KB | Analytical question → metric bundle mapping |
| `src/rag/metric-resolution/types.ts` | 8KB | All TypeScript interfaces (MetricDefinition, MetricResolution, etc.) |

### Intent Detection Subsystem (Full Source)
| File | Size | Description |
|------|------|-------------|
| `src/rag/intent-detection/llm-detection-engine.ts` | 36KB | LLM classification (Claude Haiku) |
| `src/rag/intent-detection/fast-path-cache.ts` | 7KB | Cache layer |

### YAML Metric Registries (20 files, 252 metrics, 1,209 synonyms)
| Category | Files | Metric Count |
|----------|-------|-------------|
| Universal atomic | `income_statement.yaml`, `balance_sheet.yaml`, `cash_flow.yaml`, `equity_statement.yaml` | 122 |
| Sector-specific (GICS) | `revenue_by_industry.yaml`, `energy.yaml`, `materials.yaml`, `industrials.yaml`, `consumer_discretionary.yaml`, `consumer_staples.yaml`, `healthcare.yaml`, `financials.yaml`, `info_tech.yaml`, `communication_services.yaml`, `utilities.yaml`, `real_estate.yaml` | 71 |
| PE-specific | `return_and_fund_metrics.yaml` | 14 |
| Computed/derived | `all_computed_metrics.yaml` | 45 |
| Analytical concepts | `analytical_concepts.yaml` | 10 concepts |
| Client overlay (example) | `third_avenue.yaml` | — |

### Data Ingestion (Shows How Metrics Are Stored)
| File | Description |
|------|-------------|
| `src/s3/sec-processing.service.ts` | SEC filing processing (PascalCase metric names) |
| `src/dataSources/sec/metrics.service.ts` | Metrics storage (lowercase normalization) |

### Architecture Specs
| File | Description |
|------|-------------|
| `specs/intelligent-intent-detection-system-design.md` | Intent detection architecture |
| `specs/metric-resolution-architecture-design.md` | **Metric resolution architecture** — three-layer resolution stack |
| `specs/metric-resolution-architecture-requirements.md` | **17 requirements** for the metric resolution redesign |

## Metric Resolution Architecture Summary

The system has a new three-layer metric resolution stack that is partially implemented:

### Layer 1: Canonical Metric Registry + Inverted Synonym Index
- **MetricRegistryService** loads 20 YAML files from S3 at startup
- Builds an inverted synonym index mapping every normalized synonym → canonical_id
- Resolution pipeline: normalize → LRU cache → exact index lookup → fuzzy match → suggestions
- `normalize_for_lookup`: strips all non-alphanumeric, lowercases (e.g., "Cash & Cash Equivalents" → "cashandcashequivalents")
- 252 metrics with 1,209 synonyms pre-built in YAML

### Layer 2: Formula Resolution + Concept Registry + Python Bridge
- **FormulaResolutionService** resolves computed metrics (Net Debt/EBITDA, Gross Margin %, etc.)
  - Resolves dependency DAG, batch-fetches atomic values from DB
  - Dispatches `{ formula, inputs, output_format }` to Python `/calculate` endpoint
  - Python uses `simpleeval` (safe evaluator) + named functions (CAGR, IRR)
- **ConceptRegistryService** maps analytical questions to sector-filtered metric bundles
  - "How levered is this company?" → leverage concept → net_debt_to_ebitda, debt_to_equity, interest_coverage
  - 10 pre-built concepts with triggers, primary/secondary metrics by sector

### Layer 3: Graceful Degradation + Learning Loop
- Unresolved queries always produce suggestions (never empty results without explanation)
- Analyst corrections feed offline learning loop → new synonyms for human review
- Client overlays per tenant for custom terminology

### Key Integration Gap
The **StructuredRetrieverService** hasn't been fully wired to use `MetricResolution.db_column` for database WHERE clauses. It still uses string-based metric name matching with case variations, which is the root cause of the "No Data Available" failures.

## Potential Fixes

### Fix 1: Add ABNB to ticker regex (Quick)
In `intent-detector.service.ts`, add ABNB to the ticker pattern.

### Fix 2: Wire StructuredRetriever to use MetricResolution.db_column (Correct)
The structured retriever should use the `db_column` from `MetricResolution` objects instead of trying case variations of raw metric strings. This is the designed integration point per the metric resolution architecture.

### Fix 3: Expand metric variations in retriever (Interim)
Add more case variations (`total_${metric}`, `metric.toUpperCase()`) as a stopgap.

### Fix 4: Use case-insensitive LIKE query (Fallback)
Replace exact matching with fuzzy matching in the database query.
