# Metric Normalization Enhancement - Requirements

**Date**: 2026-01-29  
**Status**: Planning  
**Priority**: High (Tonight's Deployment)

---

## Overview

Enhance the metric normalization system to provide enterprise-grade accuracy for US Public Equities across all industries. The system must handle 117+ comprehensive financial metrics with 500+ synonyms per metric, supporting fuzzy matching, industry-specific terminology, and natural language queries.

---

## Business Requirements

### BR-1: Comprehensive Metric Coverage
**As a** financial analyst  
**I want** the system to recognize all standard financial metrics across industries  
**So that** I can query any metric using natural terminology

**Acceptance Criteria**:
- System recognizes 117+ financial metrics from Excel mapping
- Covers all major industries: Technology, Banking, Insurance, Healthcare, Energy, Media, Telecom, Real Estate, Utilities, Retail, Manufacturing
- Includes both GAAP and non-GAAP metrics
- Supports industry-specific metrics (e.g., Combined Ratio for insurance, ARPU for telecom)

### BR-2: Natural Language Query Support
**As a** user  
**I want** to query metrics using natural language  
**So that** I don't need to know exact technical terms

**Acceptance Criteria**:
- Handles typos: "cost of good sold" → "cost of goods sold"
- Handles paraphrasing: "what did it cost to make" → "cost of goods sold"
- Handles abbreviations: "cogs" → "cost of goods sold"
- Handles industry terminology: "claims paid" → "cost of revenue" (for insurance)
- 99%+ accuracy on natural language queries

### BR-3: Zero Data Loss
**As a** system administrator  
**I want** all existing metric mappings preserved  
**So that** current functionality continues to work

**Acceptance Criteria**:
- All existing YAML metrics retained
- All existing Intent Detector mappings retained
- All existing database metrics analyzed and incorporated
- Backward compatibility with existing queries
- No breaking changes to API

### BR-4: Fast Performance
**As a** user  
**I want** instant query responses  
**So that** the system feels responsive

**Acceptance Criteria**:
- <1ms for exact synonym match (85% of queries)
- <10ms for semantic match (12% of queries)
- <1ms for learned query match (3% of queries)
- <200ms total startup time (cold start)
- <5ms p95 latency overall

---

## Technical Requirements

### TR-1: Enhanced YAML Mapping
**Requirement**: Expand metric_mapping_enhanced.yaml with comprehensive coverage

**Specifications**:
- 117+ metrics from Excel
- 500+ synonyms per metric (primary + industry-specific + fuzzy + NLP patterns)
- Company-specific XBRL tags (AAPL, MSFT, GOOGL, etc.)
- Semantic hints for LLM matching
- Calculation formulas for derived metrics
- Related metrics for context

**Data Sources**:
1. Existing `metric_mapping.yaml` (40 metrics)
2. Existing `metric_mapping_enhanced.yaml` (50 metrics)
3. Excel file `metrics-mapping.xlsx` (117 metrics)
4. Database analysis (all processed metrics from RDS)
5. Intent Detector current mappings
6. SEC EDGAR actual labels (from processed filings)

### TR-2: Metric Mapping Service
**Requirement**: Create TypeScript service for in-memory metric lookup

**Specifications**:
- Load YAML at startup (OnModuleInit)
- Build hash table indexes for O(1) lookup
- Support exact match, fuzzy match, and pattern match
- Cache results in LRU cache (1000 entries)
- Provide explainability (show matched synonym)

### TR-3: Database Metric Analysis
**Requirement**: Analyze all metrics in RDS to find missing synonyms

**Specifications**:
- Query `financial_metrics` table for all unique `normalizedMetric` values
- Query `financial_metrics` table for all unique `rawLabel` values
- Group by industry/ticker to find industry-specific patterns
- Identify gaps in current YAML coverage
- Generate synonym suggestions

### TR-4: Semantic Matcher Integration
**Requirement**: Integrate all-MiniLM-L6-v2 for fuzzy matching

**Specifications**:
- Python module with CLI interface
- Pre-compute embeddings at startup
- Cache embeddings to disk (pickle file)
- Support batch processing
- Return top-K matches with confidence scores

### TR-5: End-to-End Testing
**Requirement**: Comprehensive test coverage for all functionality

**Specifications**:
- Unit tests for MetricMappingService
- Unit tests for semantic matcher
- Integration tests for Intent Detector
- E2E tests for research assistant queries
- Performance tests for latency
- Coverage tests for all 117 metrics

---

## Functional Requirements

### FR-1: Metric Lookup
**Input**: Natural language query (e.g., "cost of goods sold")  
**Output**: Metric ID, confidence score, matched synonym

**Flow**:
1. Normalize query (lowercase, trim)
2. Try exact synonym match (hash table)
3. If no match, try fuzzy pattern match
4. If no match, try semantic matcher
5. Return best match with confidence

### FR-2: Industry-Aware Matching
**Input**: Query + ticker symbol  
**Output**: Industry-boosted metric matches

**Flow**:
1. Determine ticker's industry (GICS sector)
2. Get semantic matches
3. Boost matches that use industry-specific synonyms
4. Boost matches with company-specific XBRL tags
5. Return re-ranked results

### FR-3: Query Learning
**Input**: Successful query → metric mapping  
**Output**: Learned mapping stored for future use

**Flow**:
1. Record query, metric_id, ticker, confidence
2. After 5+ successful uses, promote to YAML
3. Monthly review of suggested synonyms
4. Human approval before YAML update

### FR-4: Explainability
**Input**: Query + matched metric  
**Output**: Explanation of why it matched

**Flow**:
1. Show matched synonym
2. Show confidence score
3. Show matching method (exact/fuzzy/semantic)
4. Show industry boost (if applicable)

---

## Non-Functional Requirements

### NFR-1: Performance
- Startup time: <200ms
- Query latency p50: <1ms
- Query latency p95: <5ms
- Query latency p99: <20ms
- Memory usage: <50MB for metric index

### NFR-2: Reliability
- 99.9%+ uptime
- Zero data loss during updates
- Graceful degradation (fallback to exact match if semantic fails)
- Error handling for malformed queries

### NFR-3: Maintainability
- YAML format for easy human review
- Git version control for all changes
- Automated tests for regression prevention
- Clear documentation for adding new metrics

### NFR-4: Scalability
- Support 500+ metrics (future growth)
- Support 10k+ synonyms total
- Support 1000+ queries/second
- Support multi-tenant isolation

---

## Success Metrics

### Accuracy
- **Target**: 99%+ correct metric identification
- **Measurement**: Manual review of 1000 random queries
- **Baseline**: 85% (current exact match only)

### Coverage
- **Target**: 99%+ of user queries return results
- **Measurement**: "No results" rate
- **Baseline**: 80% (current limited synonyms)

### Performance
- **Target**: <5ms p95 latency
- **Measurement**: Application metrics
- **Baseline**: ~10ms (current)

### User Satisfaction
- **Target**: <2% "no results" queries
- **Measurement**: Query logs
- **Baseline**: ~15% (current)

---

## Out of Scope

- Real-time metric updates (monthly deployment is sufficient)
- User-customizable metric names (standard metrics only)
- Multi-language support (English only)
- Historical metric name changes (current names only)

---

## Dependencies

- Existing `metric_mapping.yaml`
- Existing `metric_mapping_enhanced.yaml`
- Excel file `metrics-mapping.xlsx`
- RDS database with `financial_metrics` table
- Python environment with sentence-transformers
- TypeScript/NestJS backend

---

## Risks & Mitigation

### Risk 1: Excel file incomplete
**Mitigation**: Supplement with database analysis and SEC filing labels

### Risk 2: Semantic matcher too slow
**Mitigation**: Aggressive caching, fallback to exact match

### Risk 3: Breaking existing queries
**Mitigation**: Comprehensive backward compatibility tests

### Risk 4: Deployment tonight too aggressive
**Mitigation**: Incremental rollout (YAML first, semantic later)

---

## Deployment Strategy

### Phase 1: Enhanced YAML (Tonight)
- Merge existing YAMLs
- Add Excel metrics
- Add database-discovered synonyms
- Deploy with existing exact-match logic
- **Risk**: Low (additive only)

### Phase 2: Metric Mapping Service (Week 2)
- Implement TypeScript service
- Add hash table indexes
- Add fuzzy matching
- Deploy with feature flag
- **Risk**: Medium (new code path)

### Phase 3: Semantic Matcher (Week 3)
- Implement Python semantic matcher
- Integrate with Intent Detector
- Deploy with fallback to exact match
- **Risk**: Medium (external dependency)

### Phase 4: Query Learning (Week 4)
- Implement feedback database
- Add synonym suggestion tool
- Monthly review process
- **Risk**: Low (optional feature)

---

## Acceptance Criteria Summary

✅ All 117 metrics from Excel included  
✅ All existing metrics preserved (zero data loss)  
✅ 500+ synonyms per metric (comprehensive coverage)  
✅ Industry-specific variations included  
✅ Company-specific XBRL tags included  
✅ <5ms p95 query latency  
✅ 99%+ accuracy on test queries  
✅ End-to-end tests passing  
✅ Backward compatibility maintained  
✅ Documentation complete  

---

**Next**: Design document with detailed architecture
