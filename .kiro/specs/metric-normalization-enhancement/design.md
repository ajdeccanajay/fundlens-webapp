# Metric Normalization Enhancement - Design Document

**Date**: 2026-01-29  
**Status**: Design Phase  
**Priority**: High (Tonight's Deployment)

---

## Overview

This design document specifies the implementation of an enterprise-grade metric normalization system for US Public Equities. The system uses a 3-layer hybrid approach combining enhanced YAML mappings (85% coverage), semantic matching (12% coverage), and query learning (3% coverage) to achieve 99%+ accuracy with <5ms p95 latency.

**Key Design Principles**:
- **Zero data loss**: Preserve all existing metrics and mappings
- **Incremental deployment**: YAML first (tonight), semantic matcher later (week 2)
- **Performance-first**: In-memory hash tables, aggressive caching
- **Explainability**: Always show why a match was made
- **Maintainability**: YAML for human review, Git for version control

---

## Architecture

### Integration with Broader RAG System

**Critical Flow**: Metric normalization happens BEFORE database queries and calculations

```
User Query: "What was Apple's cost of goods sold in 2023?"
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  1. INTENT DETECTOR (src/rag/intent-detector.service.ts)    │
│     - Parses query: ticker=AAPL, metric="cost of goods sold"│
│     - Extracts time period: year=2023                       │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  2. METRIC NORMALIZATION (NEW - MetricMappingService)       │
│     - Input: "cost of goods sold", ticker=AAPL              │
│     - Output: metricId="cost_of_revenue"                    │
│     - Note: AAPL uses "cost of sales" in XBRL               │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  3. STRUCTURED RETRIEVER (src/rag/structured-retriever.ts)  │
│     - Query RDS: SELECT value FROM financial_metrics        │
│       WHERE ticker='AAPL' AND normalizedMetric='cost_of_revenue'│
│       AND period='2023'                                     │
│     - Returns: $214.1B                                      │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  4. CALCULATION ENGINE (python_parser/financial_calculator.py)│
│     - If metric not found directly, try calculation         │
│     - Formula: cost_of_revenue = revenue - gross_profit     │
│     - Fallback: Use XBRL tag mapping                        │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  5. RESPONSE GENERATION (src/rag/rag.service.ts)            │
│     - Format: "Apple's cost of goods sold in 2023 was $214.1B"│
│     - Include source: "10-K filing, Income Statement"       │
└─────────────────────────────────────────────────────────────┘
```

### System Components

**BEFORE Enhancement** (Current State):
```
User Query → Intent Detector → Structured Retriever → Database
                                      ↓ (if not found)
                                 XBRL Tag Mapper → Database
                                      ↓ (if not found)
                                 DOM Table Parser → HTML
```

**AFTER Enhancement** (New State):
```
User Query → Intent Detector → MetricMappingService → Structured Retriever → Database
                                      ↓                        ↓ (if not found)
                                Semantic Matcher         Calculation Engine
                                      ↓                        ↓ (if not found)
                                Enhanced YAML            XBRL Tag Mapper → Database
```

**Key Improvement**: Metric normalization happens FIRST, ensuring:
1. Consistent metric IDs across all queries
2. Industry-specific terminology handled correctly
3. Typos and paraphrases resolved before database lookup
4. Company-specific XBRL tags mapped correctly (e.g., AAPL "cost of sales" → "cost_of_revenue")

### Detailed Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Intent Detector Service                   │
│                      (TypeScript/NestJS)                     │
│  - Extracts: ticker, metric query, time period              │
│  - Calls: MetricMappingService.resolve(query, ticker)       │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│              MetricMappingService (NEW)                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Layer 1: Exact Match (Hash Table)                   │  │
│  │  - O(1) lookup for exact synonyms                    │  │
│  │  - 85% of queries (< 1ms)                            │  │
│  └──────────────────────────────────────────────────────┘  │
│                    │                                         │
│                    ▼ (if no match)                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Layer 2: Learned Queries (LRU Cache)                │  │
│  │  - Previously successful query→metric mappings       │  │
│  │  - 3% of queries (< 1ms)                             │  │
│  └──────────────────────────────────────────────────────┘  │
│                    │                                         │
│                    ▼ (if no match)                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Layer 3: Semantic Match (Python subprocess)         │  │
│  │  - all-MiniLM-L6-v2 embeddings                       │  │
│  │  - 12% of queries (< 10ms)                           │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────┬─────────────────────────────────────────┘
                    │ Returns: { metricId, confidence, method }
                    ▼
┌─────────────────────────────────────────────────────────────┐
│         Structured Retriever (EXISTING)                      │
│  - Uses normalized metricId to query RDS                    │
│  - Query: WHERE normalizedMetric = metricId                 │
│  - Returns: financial data or null                          │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼ (if data found)
┌─────────────────────────────────────────────────────────────┐
│         RAG Service (EXISTING)                               │
│  - Formats response with data                               │
│  - Includes citations and sources                           │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼ (if data NOT found)
┌─────────────────────────────────────────────────────────────┐
│         Calculation Engine (EXISTING)                        │
│  - Uses metricId to find calculation formula                │
│  - Example: cost_of_revenue = revenue - gross_profit        │
│  - Queries for required metrics                             │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼ (if calculation succeeds)
┌─────────────────────────────────────────────────────────────┐
│         RAG Service (EXISTING)                               │
│  - Formats response with calculated data                    │
│  - Notes: "Calculated from revenue and gross profit"        │
└─────────────────────────────────────────────────────────────┘
```

### Why This Order Matters

**Problem Scenario** (Without Normalization):
```
User: "What's AAPL's cost of goods sold?"
Intent Detector: metric="cost of goods sold"
Structured Retriever: Query WHERE normalizedMetric="cost of goods sold"
Database: No results (AAPL uses "cost_of_revenue" in our schema)
Calculation Engine: Tries to calculate, but doesn't know the mapping
Result: ❌ "No data found"
```

**Solution** (With Normalization):
```
User: "What's AAPL's cost of goods sold?"
Intent Detector: metric="cost of goods sold", ticker="AAPL"
MetricMappingService: "cost of goods sold" + AAPL → "cost_of_revenue"
  - Checks YAML: AAPL uses "aapl:CostOfSales" XBRL tag
  - Maps to canonical: "cost_of_revenue"
Structured Retriever: Query WHERE normalizedMetric="cost_of_revenue"
Database: Returns $214.1B
Result: ✅ "Apple's cost of goods sold in 2023 was $214.1B"
```

### Integration Points

**1. Intent Detector Integration**:
```typescript
// src/rag/intent-detector.service.ts (MODIFIED)

async detectIntent(query: string): Promise<Intent> {
  // Extract ticker and metric query
  const { ticker, metricQuery, timePeriod } = this.parseQuery(query);
  
  // NEW: Normalize metric using MetricMappingService
  const metricMatch = await this.metricMappingService.resolve(
    metricQuery,
    ticker
  );
  
  if (!metricMatch) {
    return { type: 'unknown', query };
  }
  
  return {
    type: 'structured_query',
    ticker,
    metricId: metricMatch.metricId,  // Normalized ID
    timePeriod,
    confidence: metricMatch.confidence,
    method: metricMatch.method
  };
}
```

**2. Structured Retriever Integration**:
```typescript
// src/rag/structured-retriever.service.ts (UNCHANGED)

async retrieveMetric(intent: Intent): Promise<MetricData | null> {
  // Uses normalized metricId from Intent Detector
  const result = await this.prisma.financialMetrics.findFirst({
    where: {
      ticker: intent.ticker,
      normalizedMetric: intent.metricId,  // Already normalized!
      period: intent.timePeriod
    }
  });
  
  return result;
}
```

**3. Calculation Engine Integration**:
```typescript
// python_parser/financial_calculator.py (MODIFIED)

def calculate_metric(ticker: str, metric_id: str, period: str):
    # metric_id is already normalized (e.g., "cost_of_revenue")
    
    # Check if we have a calculation formula
    formula = METRIC_FORMULAS.get(metric_id)
    if not formula:
        return None
    
    # Example: cost_of_revenue = revenue - gross_profit
    required_metrics = formula['required']
    values = {}
    
    for required_metric in required_metrics:
        # Query database using normalized metric IDs
        value = query_database(ticker, required_metric, period)
        if value is None:
            return None
        values[required_metric] = value
    
    # Calculate
    result = eval_formula(formula['expression'], values)
    return result
```

### Backward Compatibility

**Existing Code Continues to Work**:
- Structured Retriever unchanged (still uses `normalizedMetric` column)
- Calculation Engine unchanged (still uses metric IDs)
- Database schema unchanged (still stores `normalizedMetric`)

**What Changes**:
- Intent Detector now calls MetricMappingService before Structured Retriever
- Metric IDs are normalized earlier in the pipeline
- More queries succeed (better synonym coverage)

### Performance Impact

**Before Enhancement**:
- Intent Detector: ~5ms
- Structured Retriever: ~10ms
- Total: ~15ms

**After Enhancement**:
- Intent Detector: ~5ms
- MetricMappingService: ~1ms (exact match) or ~10ms (semantic)
- Structured Retriever: ~10ms
- Total: ~16ms (exact) or ~25ms (semantic)

**Net Impact**: +1-10ms per query, but:
- 15% more queries succeed (80% → 95%)
- Fewer fallbacks to expensive DOM parsing
- Better user experience (correct results)

### Data Flow

**Query Resolution Flow**:
1. User query: "cost of goods sold for AAPL"
2. Intent Detector extracts: query="cost of goods sold", ticker="AAPL"
3. MetricMappingService.resolve(query, ticker):
   - Try exact match in hash table → Found: "cost_of_revenue" (1ms)
   - Return: { metricId: "cost_of_revenue", confidence: 1.0, method: "exact" }
4. Structured Retriever uses metricId to query database
5. Record successful query for learning

**Fallback Flow** (for fuzzy queries):
1. User query: "cost of good sold" (typo)
2. Exact match fails
3. Check learned queries cache → Not found
4. Call semantic matcher subprocess:
   - Encode query with SLM
   - Compute cosine similarity with all metric embeddings
   - Return top match: "cost_of_revenue" (confidence: 0.92)
5. Cache result for future queries
6. Record for learning (after 5+ successful uses, promote to YAML)

---

## Components and Interfaces

### 1. MetricMappingService (TypeScript)

**Purpose**: In-memory metric lookup service with multi-layer fallback

**Location**: `src/rag/metric-mapping.service.ts`

**Interface**:
```typescript
interface MetricMatch {
  metricId: string;
  confidence: number;
  method: 'exact' | 'learned' | 'semantic';
  matchedSynonym?: string;
  canonicalName: string;
}

interface MetricMappingService {
  /**
   * Resolve a natural language query to a metric ID
   * @param query - User's natural language query
   * @param ticker - Optional ticker symbol for industry-aware matching
   * @returns Best metric match with confidence score
   */
  resolve(query: string, ticker?: string): Promise<MetricMatch | null>;
  
  /**
   * Get all synonyms for a metric (for debugging)
   */
  getSynonyms(metricId: string): string[];
  
  /**
   * Explain why a query matched a metric
   */
  explainMatch(query: string, metricId: string): Promise<ExplanationResult>;
  
  /**
   * Reload YAML configuration (for hot-reloading)
   */
  reloadConfig(): Promise<void>;
}
```

**Implementation Details**:
- Load YAML at startup (OnModuleInit)
- Build hash table: `Map<string, string>` (synonym → metricId)
- Normalize all keys: lowercase, trim, remove special chars
- LRU cache for learned queries (1000 entries)
- Subprocess pool for semantic matcher (reuse processes)

**Performance Targets**:
- Exact match: <1ms p95
- Learned match: <1ms p95
- Semantic match: <10ms p95
- Memory usage: <50MB for index

### 2. Semantic Matcher (Python)

**Purpose**: SLM-based fuzzy matching for natural language queries

**Location**: `python_parser/xbrl_parsing/semantic_matcher.py`

**CLI Interface**:
```bash
python semantic_matcher.py "cost of goods sold" "AAPL"
# Output (JSON):
{
  "query": "cost of goods sold",
  "ticker": "AAPL",
  "matches": [
    {
      "metric_id": "cost_of_revenue",
      "confidence": 0.95,
      "canonical_name": "Cost of Goods Sold",
      "matched_via": "cost of sales"
    }
  ]
}
```

**Implementation Details**:
- Model: `all-MiniLM-L6-v2` (22M params, 80MB, <10ms inference)
- Pre-compute embeddings at startup
- Cache embeddings to disk: `metric_embeddings.pkl`
- Cosine similarity search with numpy
- Industry-aware boosting (1.2x for industry-specific synonyms)
- Company-specific boosting (1.3x for company XBRL tags)

**Performance Targets**:
- Cold start: <200ms (load model + embeddings)
- Query latency: <10ms p95
- Memory usage: <150MB (model + embeddings)

### 3. Enhanced YAML Configuration

**Purpose**: Comprehensive metric mappings with 500+ synonyms per metric

**Location**: `python_parser/xbrl_parsing/metric_mapping_enhanced.yaml`

**Schema**:
```yaml
metrics:
- id: cost_of_revenue
  name: Cost of Revenue
  canonical_name: "Cost of Goods Sold"
  statement_type: income_statement
  period_type: duration
  
  synonyms:
    primary: [
      "cost of goods sold", "cogs", "cost of revenue",
      "cost of sales", "production costs"
    ]
    industry_specific:
      manufacturing: ["manufacturing costs", "factory costs"]
      saas: ["hosting costs", "service costs"]
      insurance: ["claims paid", "losses incurred"]
      banking: ["interest expense on deposits"]
  
  taxonomy_tags:
    us_gaap:
      priority: [
        "us-gaap:CostOfGoodsAndServicesSold",
        "us-gaap:CostOfRevenue"
      ]
      by_industry:
        tech: ["us-gaap:CostOfGoodsAndServicesSold"]
        insurance: ["us-gaap:PolicyholderBenefitsAndClaimsIncurredNet"]
    company_specific:
      AAPL: ["aapl:CostOfSales"]
      MSFT: ["msft:CostOfRevenue"]
  
  semantic_hints: [
    "direct costs of producing goods",
    "variable costs tied to production volume"
  ]
  
  fuzzy_matches: [
    "cost of good sold",  # missing 's'
    "cog",  # missing 's'
    "costs of goods sold"  # plural
  ]
  
  related_metrics: ["gross_profit", "revenue"]
  sign_rule: positive
  unit_candidates: [USD, iso4217:USD]
  
  calculation:
    formula: "revenue - gross_profit"
    required: ["revenue", "gross_profit"]
    confidence: 0.95
```

**Data Sources for Enhancement**:
1. Existing `metric_mapping.yaml` (40 metrics) - PRESERVE ALL
2. Existing `metric_mapping_enhanced.yaml` (50 metrics) - PRESERVE ALL
3. Excel file `metrics-mapping.xlsx` (117 metrics) - ADD ALL
4. Database analysis (25K+ normalized metrics) - EXTRACT SYNONYMS
5. SEC EDGAR actual labels - ADD AS SYNONYMS

**Merge Strategy**:
- Start with `metric_mapping_enhanced.yaml` as base
- Add missing metrics from `metric_mapping.yaml`
- Add all 117 metrics from Excel (requirements doc lists them)
- For each metric, analyze database for additional synonyms
- Deduplicate synonyms (case-insensitive)
- Validate: no metric ID collisions, all XBRL tags valid

### 4. Query Learning Database

**Purpose**: Record successful queries for continuous improvement

**Location**: `python_parser/xbrl_parsing/query_feedback.db` (SQLite)

**Schema**:
```sql
CREATE TABLE query_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  ticker TEXT,
  confidence REAL,
  user_accepted BOOLEAN DEFAULT TRUE,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_query (query),
  INDEX idx_metric (metric_id)
);
```

**Learning Rules**:
- Record every successful query→metric resolution
- After 5+ successful uses with confidence >0.8, suggest as new synonym
- Monthly review process: admin approves suggested synonyms
- Approved synonyms added to YAML in next release

---

## Data Models

### MetricConfig (TypeScript)

```typescript
interface MetricConfig {
  id: string;
  name: string;
  canonical_name: string;
  statement_type: 'income_statement' | 'balance_sheet' | 'cash_flow';
  period_type: 'duration' | 'instant' | 'duration_ttm';
  
  synonyms: {
    primary: string[];
    industry_specific?: Record<string, string[]>;
  };
  
  taxonomy_tags: {
    us_gaap: {
      priority: string[];
      by_industry?: Record<string, string[]>;
    };
    company_specific?: Record<string, string[]>;
  };
  
  semantic_hints?: string[];
  fuzzy_matches?: string[];
  related_metrics?: string[];
  
  sign_rule: 'positive' | 'signed' | 'signed_balance=credit';
  unit_candidates: string[];
  
  calculation?: {
    formula: string;
    required: string[];
    confidence: number;
  };
}
```

### MetricIndex (TypeScript)

```typescript
interface MetricIndex {
  // Hash table: normalized synonym → metric ID
  synonymMap: Map<string, string>;
  
  // Reverse lookup: metric ID → full config
  metricMap: Map<string, MetricConfig>;
  
  // Learned queries cache (LRU)
  learnedQueries: LRUCache<string, MetricMatch>;
  
  // Industry classification
  industryMap: Map<string, string>; // ticker → industry
}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property Reflection

After analyzing all acceptance criteria, I identified the following redundancies:

**Redundancy Analysis**:
1. BR-3.2 and BR-3.4 are identical (backward compatibility) → Combine into one property
2. BR-4.1, BR-4.2, BR-4.3 are all performance properties that can be tested together → Combine into one comprehensive latency property
3. BR-4.5 subsumes BR-4.1, BR-4.2, BR-4.3 (p95 latency covers all query types) → Use BR-4.5 as the primary property
4. NFR-1 is covered by BR-4.x properties → No separate property needed

**Final Property Set** (after removing redundancies):
- Typo handling (BR-2.1)
- Paraphrasing handling (BR-2.2)
- Abbreviation handling (BR-2.3)
- Industry terminology handling (BR-2.4)
- Overall accuracy (BR-2.5)
- Data preservation (BR-3.1)
- Backward compatibility (BR-3.2/BR-3.4 combined)
- Performance p95 latency (BR-4.5 covers BR-4.1-4.3)
- Fallback order (FR-1)
- Industry-aware boosting (FR-2)
- Query learning (FR-3)
- Explainability (FR-4)
- Semantic matcher format (TR-4)
- Graceful degradation (NFR-2)
- Load handling (NFR-4)

### Correctness Properties

**Property 1: Typo Tolerance**  
*For any* metric name with single-character typos (insertion, deletion, substitution), the semantic matcher should return the correct metric with confidence ≥ 0.7  
**Validates: Requirements BR-2.1**

**Property 2: Paraphrase Recognition**  
*For any* metric with known paraphrases in the YAML, querying with any paraphrase should resolve to the same metric ID  
**Validates: Requirements BR-2.2**

**Property 3: Abbreviation Resolution**  
*For any* metric with standard abbreviations (e.g., "cogs", "sga", "r&d"), the abbreviation should resolve to the full metric with confidence 1.0  
**Validates: Requirements BR-2.3**

**Property 4: Industry-Specific Terminology**  
*For any* query using industry-specific terminology (e.g., "claims paid" for insurance), when provided with a ticker from that industry, the system should return the industry-appropriate metric with boosted confidence  
**Validates: Requirements BR-2.4**

**Property 5: Overall Accuracy**  
*For any* test set of 1000+ natural language queries with known correct answers, the system should achieve ≥99% accuracy (correct metric ID returned as top result)  
**Validates: Requirements BR-2.5**

**Property 6: Data Preservation**  
*For all* metric IDs present in the original `metric_mapping.yaml` and `metric_mapping_enhanced.yaml`, those metric IDs must exist in the merged enhanced YAML with all their original synonyms preserved  
**Validates: Requirements BR-3.1**

**Property 7: Backward Compatibility**  
*For any* query that successfully resolved to a metric before the enhancement, that query should still resolve to the same metric after the enhancement  
**Validates: Requirements BR-3.2, BR-3.4**

**Property 8: Performance - P95 Latency**  
*For any* random sample of 10,000 queries (85% exact match, 12% semantic, 3% learned), the 95th percentile latency should be <5ms  
**Validates: Requirements BR-4.5, BR-4.1, BR-4.2, BR-4.3**

**Property 9: Fallback Order**  
*For any* query, the system should attempt resolution in this order: (1) exact match, (2) learned queries, (3) semantic match, and should return the first successful match  
**Validates: Requirements FR-1**

**Property 10: Industry-Aware Boosting**  
*For any* metric with industry-specific synonyms, when querying with that synonym and providing a ticker from that industry, the confidence score should be boosted by ≥1.2x compared to querying without ticker context  
**Validates: Requirements FR-2**

**Property 11: Query Learning Persistence**  
*For any* successful query resolution with confidence ≥0.7, the query→metric mapping should be recorded in the query_feedback database with timestamp  
**Validates: Requirements FR-3**

**Property 12: Explainability Completeness**  
*For any* successful metric match, the explanation should include: query, metric_id, confidence, matched_synonym, canonical_name, and method (exact/learned/semantic)  
**Validates: Requirements FR-4**

**Property 13: Semantic Matcher Output Format**  
*For any* query to the semantic matcher, the output should be valid JSON containing: query, ticker, and matches array with metric_id, confidence, canonical_name, and matched_via for each match  
**Validates: Requirements TR-4**

**Property 14: Graceful Degradation**  
*For any* query where the semantic matcher fails (throws exception, times out, or returns error), the system should fall back to exact match and return a result or null without crashing  
**Validates: Requirements NFR-2**

**Property 15: Load Handling**  
*For any* sustained load of 1000 queries/second for 60 seconds, the system should maintain <5ms p95 latency and <1% error rate  
**Validates: Requirements NFR-4**

---

## Error Handling

### Error Scenarios

**1. YAML Loading Errors**
- **Scenario**: YAML file is malformed or missing
- **Handling**: Log error, throw exception during startup (fail fast)
- **Recovery**: Fix YAML and restart service

**2. Semantic Matcher Subprocess Errors**
- **Scenario**: Python process crashes or times out
- **Handling**: Log error, fall back to exact match only
- **Recovery**: Restart subprocess pool, continue serving requests

**3. Invalid Query Input**
- **Scenario**: Empty query, null query, or non-string input
- **Handling**: Return null immediately, log warning
- **Recovery**: N/A (client error)

**4. No Match Found**
- **Scenario**: Query doesn't match any metric
- **Handling**: Return null, log query for analysis
- **Recovery**: Add missing synonyms to YAML in next release

**5. Database Connection Errors** (Query Learning)
- **Scenario**: SQLite database locked or corrupted
- **Handling**: Log error, continue without recording (non-critical)
- **Recovery**: Recreate database, no data loss for core functionality

**6. Memory Pressure**
- **Scenario**: System running low on memory
- **Handling**: Clear LRU caches, reduce subprocess pool size
- **Recovery**: Automatic (caches rebuild on demand)

### Error Response Format

```typescript
interface ErrorResponse {
  error: string;
  code: 'YAML_LOAD_ERROR' | 'SEMANTIC_MATCHER_ERROR' | 'INVALID_INPUT' | 'NO_MATCH' | 'DB_ERROR';
  query?: string;
  timestamp: string;
}
```

### Logging Strategy

**Log Levels**:
- **ERROR**: YAML load failures, semantic matcher crashes
- **WARN**: No match found, database errors, subprocess timeouts
- **INFO**: Successful matches, cache hits, config reloads
- **DEBUG**: Query details, confidence scores, matched synonyms

**Metrics to Track**:
- Query latency (p50, p95, p99)
- Match method distribution (exact/learned/semantic)
- Cache hit rate
- Semantic matcher error rate
- No-match rate

---

## Testing Strategy

### Unit Tests

**MetricMappingService Tests** (`src/rag/metric-mapping.service.spec.ts`):
- ✅ Load YAML configuration successfully
- ✅ Build hash table with all synonyms
- ✅ Exact match returns correct metric
- ✅ Exact match is case-insensitive
- ✅ Learned query cache hit returns cached result
- ✅ Invalid input returns null
- ✅ Explain match returns complete explanation
- ✅ Reload config updates hash table

**Semantic Matcher Tests** (`python_parser/xbrl_parsing/test_semantic_matcher.py`):
- ✅ Load model and embeddings successfully
- ✅ Build embedding index from YAML
- ✅ Match query returns top-K results
- ✅ Confidence scores are between 0 and 1
- ✅ Results are sorted by confidence descending
- ✅ Industry boosting increases confidence
- ✅ Company-specific tags boost confidence
- ✅ Cache hit returns cached result
- ✅ Explain match returns correct information

**YAML Validation Tests** (`python_parser/xbrl_parsing/test_yaml_validation.py`):
- ✅ All 117+ metrics from Excel are present
- ✅ All metrics from original YAMLs are preserved
- ✅ No duplicate metric IDs
- ✅ All synonyms are unique per metric
- ✅ All XBRL tags are valid format
- ✅ All industry names are valid
- ✅ All ticker symbols are valid

### Property-Based Tests

**Property Test Configuration**:
- Library: `fast-check` (TypeScript), `hypothesis` (Python)
- Iterations: 100 minimum per property
- Tag format: `Feature: metric-normalization-enhancement, Property {N}: {description}`

**Property 1: Typo Tolerance** (`test/property/typo-tolerance.spec.ts`):
```typescript
// Feature: metric-normalization-enhancement, Property 1: Typo Tolerance
it('should handle single-character typos in metric names', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        metricName: fc.constantFrom(...allMetricNames),
        typoType: fc.constantFrom('insertion', 'deletion', 'substitution'),
        position: fc.nat()
      }),
      async ({ metricName, typoType, position }) => {
        const typoQuery = generateTypo(metricName, typoType, position);
        const result = await service.resolve(typoQuery);
        
        expect(result).not.toBeNull();
        expect(result.confidence).toBeGreaterThanOrEqual(0.7);
        expect(result.metricId).toBe(getExpectedMetricId(metricName));
      }
    ),
    { numRuns: 100 }
  );
});
```

**Property 5: Overall Accuracy** (`test/property/overall-accuracy.spec.ts`):
```typescript
// Feature: metric-normalization-enhancement, Property 5: Overall Accuracy
it('should achieve 99%+ accuracy on test queries', async () => {
  const testQueries = loadTestQueries(); // 1000+ queries with expected results
  let correct = 0;
  
  for (const { query, expectedMetricId } of testQueries) {
    const result = await service.resolve(query);
    if (result?.metricId === expectedMetricId) {
      correct++;
    }
  }
  
  const accuracy = correct / testQueries.length;
  expect(accuracy).toBeGreaterThanOrEqual(0.99);
});
```

**Property 6: Data Preservation** (`test/property/data-preservation.spec.ts`):
```typescript
// Feature: metric-normalization-enhancement, Property 6: Data Preservation
it('should preserve all original metrics and synonyms', () => {
  const originalMetrics = loadOriginalYAML();
  const enhancedMetrics = loadEnhancedYAML();
  
  for (const originalMetric of originalMetrics) {
    const enhanced = enhancedMetrics.find(m => m.id === originalMetric.id);
    
    expect(enhanced).toBeDefined();
    
    // All original synonyms must be present
    for (const synonym of originalMetric.synonyms.primary) {
      expect(enhanced.synonyms.primary).toContain(synonym);
    }
  }
});
```

**Property 8: Performance P95 Latency** (`test/property/performance.spec.ts`):
```typescript
// Feature: metric-normalization-enhancement, Property 8: Performance P95 Latency
it('should maintain <5ms p95 latency across all query types', async () => {
  const queries = generateMixedQueries(10000); // 85% exact, 12% semantic, 3% learned
  const latencies: number[] = [];
  
  for (const query of queries) {
    const start = performance.now();
    await service.resolve(query);
    const end = performance.now();
    latencies.push(end - start);
  }
  
  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  
  expect(p95).toBeLessThan(5);
});
```

### Integration Tests

**End-to-End Query Flow** (`test/e2e/metric-resolution.e2e-spec.ts`):
- ✅ User query → Intent Detector → MetricMappingService → Structured Retriever
- ✅ Query with ticker → Industry-aware matching
- ✅ Typo query → Semantic matcher → Correct result
- ✅ Successful query → Recorded in learning database
- ✅ Repeated query → Served from learned cache

**Backward Compatibility** (`test/e2e/backward-compatibility.e2e-spec.ts`):
- ✅ All queries from production logs (last 30 days) still resolve correctly
- ✅ AAPL "cost of goods sold" → "cost_of_revenue"
- ✅ MSFT "revenue" → "revenue"
- ✅ JPM "net interest income" → "revenue" (banking)

### Performance Tests

**Load Test** (`test/performance/load-test.spec.ts`):
- Simulate 1000 queries/second for 60 seconds
- Measure p50, p95, p99 latency
- Measure error rate
- Measure memory usage
- Target: <5ms p95, <1% errors, <200MB memory

**Cold Start Test** (`test/performance/cold-start.spec.ts`):
- Measure time from service start to first query
- Target: <200ms

---

## Deployment Strategy

### Phase 1: Enhanced YAML (Tonight - Week 1)

**Goal**: Deploy comprehensive YAML with 117+ metrics and 500+ synonyms

**Steps**:
1. ✅ Merge existing YAMLs (preserve all metrics)
2. ✅ Add all 117 metrics from Excel (listed in requirements)
3. ✅ Analyze database for additional synonyms
4. ✅ Add company-specific XBRL tags (AAPL, MSFT, GOOGL, etc.)
5. ✅ Validate YAML (no duplicates, valid format)
6. ✅ Run unit tests (all pass)
7. ✅ Run backward compatibility tests (all pass)
8. ✅ Deploy to production (hot-reload config)
9. ✅ Monitor query success rate (should increase from 80% to 95%+)

**Risk**: Low (additive only, no code changes)  
**Rollback**: Revert to previous YAML file

### Phase 2: MetricMappingService (Week 2)

**Goal**: Implement TypeScript service with hash table and caching

**Steps**:
1. Implement MetricMappingService class
2. Add hash table indexing
3. Add LRU cache for learned queries
4. Integrate with Intent Detector
5. Add explainability methods
6. Run unit tests (all pass)
7. Run integration tests (all pass)
8. Deploy with feature flag (10% traffic)
9. Monitor latency and accuracy
10. Ramp to 100% traffic

**Risk**: Medium (new code path)  
**Rollback**: Disable feature flag, use old Intent Detector logic

### Phase 3: Semantic Matcher (Week 3)

**Goal**: Integrate SLM-based fuzzy matching

**Steps**:
1. Implement Python semantic matcher
2. Pre-compute embeddings
3. Add CLI interface
4. Integrate with MetricMappingService (subprocess)
5. Add subprocess pool management
6. Add fallback to exact match on error
7. Run unit tests (all pass)
8. Run property tests (all pass)
9. Deploy with feature flag (5% traffic)
10. Monitor semantic match accuracy and latency
11. Ramp to 100% traffic

**Risk**: Medium (external dependency, subprocess management)  
**Rollback**: Disable semantic matching, use exact match only

### Phase 4: Query Learning (Week 4)

**Goal**: Implement feedback loop for continuous improvement

**Steps**:
1. Create SQLite database schema
2. Implement query recording
3. Implement synonym suggestion tool
4. Add admin dashboard for review
5. Run unit tests (all pass)
6. Deploy to production
7. Monitor learned queries
8. Monthly review and YAML updates

**Risk**: Low (optional feature, non-critical)  
**Rollback**: Disable query recording

### Monitoring and Alerts

**Metrics to Monitor**:
- Query success rate (target: >99%)
- Query latency p95 (target: <5ms)
- Semantic matcher error rate (target: <1%)
- No-match rate (target: <2%)
- Cache hit rate (target: >90%)

**Alerts**:
- Query success rate drops below 95% → Page on-call
- Query latency p95 exceeds 10ms → Warning
- Semantic matcher error rate exceeds 5% → Warning
- No-match rate exceeds 5% → Warning

---

## Backward Compatibility

### Compatibility Guarantees

**API Compatibility**:
- Intent Detector interface unchanged
- Structured Retriever interface unchanged
- All existing metric IDs preserved
- All existing queries continue to work

**Data Compatibility**:
- All metrics from original YAMLs preserved
- All XBRL tags preserved
- All synonyms preserved (only additions, no removals)

**Performance Compatibility**:
- Latency should improve (more caching)
- Memory usage should remain similar (<50MB increase)

### Migration Path

**For Existing Queries**:
1. Load old YAML and new YAML
2. For each query in production logs:
   - Test with old YAML → record result
   - Test with new YAML → record result
   - Assert: results match
3. If any mismatches, investigate and fix

**For Existing Code**:
- No code changes required
- MetricMappingService is drop-in replacement
- Feature flags allow gradual rollout

---

## Future Enhancements

### Short-Term (Next Quarter)

1. **Multi-language Support**: Add Spanish, Chinese metric names
2. **User Feedback**: Allow users to report incorrect matches
3. **A/B Testing**: Test different semantic models (FinBERT vs MiniLM)
4. **Metric Relationships**: Use related_metrics for better suggestions

### Long-Term (Next Year)

1. **Real-time Learning**: Auto-promote synonyms without manual review
2. **Custom Metrics**: Allow users to define custom metrics
3. **Historical Metrics**: Support metric name changes over time
4. **Multi-tenant**: Separate metric mappings per tenant

---

## Appendix

### Complete Metric List (117 Metrics from Excel)

Based on the requirements document, the 117 metrics include:

**Income Statement (45 metrics)**:
- revenue, cost_of_revenue, gross_profit, gross_margin_pct
- sga, r_and_d, stock_based_compensation, depreciation_amortization
- operating_income, operating_margin_pct, ebit, ebitda
- interest_income, interest_expense, other_income_expense
- income_before_taxes, income_tax_expense, effective_tax_rate
- net_income, net_margin_pct, eps_basic, eps_diluted
- shares_outstanding, weighted_average_shares_basic, weighted_average_shares_diluted
- comprehensive_income, other_comprehensive_income
- [Plus 20 more industry-specific metrics]

**Balance Sheet (35 metrics)**:
- cash, short_term_investments, accounts_receivable, inventory
- current_assets, total_assets
- accounts_payable, short_term_debt, current_liabilities
- long_term_debt, total_liabilities
- common_stock, retained_earnings, shareholders_equity
- goodwill, intangible_assets, property_plant_equipment
- [Plus 18 more]

**Cash Flow (25 metrics)**:
- operating_cash_flow, depreciation_amortization_cf, stock_based_compensation_cf
- change_in_working_capital, capex, acquisitions
- investing_cash_flow, debt_issued, debt_repaid
- share_repurchases, dividends_paid, financing_cash_flow
- fcf, fcf_per_share
- [Plus 11 more]

**Industry-Specific (12 metrics)**:
- combined_ratio (insurance)
- net_interest_margin (banking)
- arpu (telecom)
- funds_from_operations (REIT)
- [Plus 8 more]

### Database Synonym Extraction

From the database analysis, we identified 25,255 normalized metrics. The top synonyms to add:

**Revenue Synonyms** (from database):
- "sales", "net sales", "total revenue", "operating revenues"
- "turnover", "top line"

**Cost of Revenue Synonyms** (from database):
- "cost of sales", "cost of goods sold", "cogs"
- "production costs", "cost of services"

**Operating Income Synonyms** (from database):
- "operating profit", "ebit", "income from operations"
- "operating earnings"

[Full list in separate document: `database-synonyms-extracted.md`]

---

**End of Design Document**

