# RAG Competitive Intelligence Extraction

## Overview

This feature addresses critical failures in the Research Assistant (RAG system) where competitive intelligence, MD&A insights, and footnote details are not being extracted from SEC filings despite correct section identification.

**Current Problem**: The system identifies where information should be located (e.g., "Item 1 - Competition") but fails to extract and present the actual content (competitor names, market positioning, etc.).

**Solution**: Implement subsection-aware extraction with advanced retrieval techniques in 4 phased deployments with clear rollback points.

---

## Quick Links

- **[Requirements](./requirements.md)**: 40 detailed requirements with acceptance criteria
- **[Design](./design.md)**: Architecture, components, and 30 correctness properties
- **[Tasks](./tasks.md)**: Phased implementation plan with 150+ tasks
- **[CHANGELOG](../../CHANGELOG-RAG-EXTRACTION.md)**: Version history and deployment tracking
- **[Git Tagging Guide](./GIT_TAGGING_GUIDE.md)**: Step-by-step tagging and rollback procedures

---

## Implementation Phases

### Phase 1: Core Subsection Extraction and Storage
**Risk**: LOW | **Duration**: 1-2 weeks | **Tag**: `rag-extraction-phase1-v1.0.0`

**What it does**:
- Enhances Python parser to identify subsections within SEC sections
- Adds `subsection_name` column to database
- Syncs subsection metadata to Bedrock KB
- Maintains backward compatibility

**Success Criteria**:
- ✅ All new chunks have subsection_name populated
- ✅ Existing chunks work without errors
- ✅ Bedrock KB ingests subsection metadata
- ✅ All Phase 1 tests pass

**Rollback**: Simple database column drop + code revert

---

### Phase 2: Intent Detection and Subsection-Aware Retrieval
**Risk**: MEDIUM | **Duration**: 2-3 weeks | **Tag**: `rag-extraction-phase2-v1.0.0`

**What it does**:
- Detects competitive intelligence, MD&A, and footnote intents
- Filters retrieval by subsection for precise targeting
- Extracts structured insights (competitor names, trends, policies)
- Adds confidence scoring and quality validation
- Enforces multi-ticker isolation

**Success Criteria**:
- ✅ Competitive intelligence success rate >95%
- ✅ MD&A success rate >90%
- ✅ Footnote success rate >90%
- ✅ Zero multi-ticker mixing incidents
- ✅ Average confidence scores >0.7

**Rollback**: Feature flags for quick disable + code revert

---

### Phase 3: Advanced Retrieval Techniques
**Risk**: MEDIUM | **Duration**: 2-3 weeks | **Tag**: `rag-extraction-phase3-v1.0.0`

**What it does**:
- Implements reranking for improved relevance
- Adds HyDE (Hypothetical Document Embeddings)
- Implements query decomposition for complex queries
- Adds contextual chunk expansion
- Implements iterative retrieval for gap filling

**Success Criteria**:
- ✅ Reranking improves top-3 relevance by >10%
- ✅ Latency p95 < 5 seconds
- ✅ All advanced techniques working correctly
- ✅ All Phase 3 tests pass

**Rollback**: Feature flags for each technique + code revert

---

### Phase 4: Dynamic Calculations and Multi-Modal Responses
**Risk**: HIGH | **Duration**: 3-4 weeks | **Tag**: `rag-extraction-phase4-v1.0.0`

**What it does**:
- Enables custom financial metric calculations
- Adds formula caching and validation
- Generates charts (line, bar, pie, scatter)
- Implements code interpreter for complex calculations
- Creates multi-modal responses (text + charts + code)

**Success Criteria**:
- ✅ Dynamic calculations success rate >90%
- ✅ Formula validation prevents invalid calculations
- ✅ Charts generate correctly
- ✅ Code interpreter works safely
- ✅ Latency targets met

**Rollback**: Feature flags + database schema revert + code revert

---

## Key Features

### Subsection-Aware Extraction
- **Item 1 (Business)**: Competition, Products, Customers, Markets, Operations, Strategy
- **Item 7 (MD&A)**: Results of Operations, Liquidity, Critical Accounting Policies, Market Risk
- **Item 8 (Financial Statements)**: Note 1, Note 2, Revenue Recognition, Leases, etc.
- **Item 1A (Risk Factors)**: Operational, Financial, Market, Regulatory Risks

### Structured Extraction
- **Competitive Intelligence**: Competitor names, market positioning, competitive advantages/disadvantages
- **MD&A Intelligence**: Key trends, risks (categorized), forward guidance, management perspective
- **Footnote Content**: Policy summary, key assumptions, quantitative details, changes from prior periods

### Advanced Retrieval
- **Reranking**: Mistral reranking via Bedrock for improved relevance
- **HyDE**: Hypothetical Document Embeddings for better semantic matching
- **Query Decomposition**: Break complex queries into sub-queries
- **Contextual Expansion**: Retrieve surrounding chunks for complete context
- **Iterative Retrieval**: Follow-up queries to fill gaps

### Dynamic Calculations
- **Formula Extraction**: Natural language to financial formulas
- **Formula Validation**: Against known formulas with safety checks
- **Formula Caching**: Reuse validated formulas for consistency
- **Peer Comparison**: Calculate custom metrics across companies
- **Code Interpreter**: Sandboxed Python for complex calculations

### Multi-Modal Responses
- **Charts**: Line (trends), Bar (comparisons), Pie (composition), Scatter (correlation)
- **Tables**: Structured data presentation
- **Code**: Show calculation steps for transparency
- **Text**: Narrative insights with citations

---

## Testing Strategy

### Dual Testing Approach
- **Unit Tests**: Specific examples, edge cases, error conditions
- **Property Tests**: Universal properties across all inputs

### Test Coverage
- **Phase 1**: 4 property tests + unit tests
- **Phase 2**: 7 property tests + unit tests + integration tests
- **Phase 3**: 6 property tests + unit tests + integration tests
- **Phase 4**: 6 property tests + unit tests + integration tests
- **Total**: 23 property tests + comprehensive unit and integration tests

### Property Test Configuration
- Library: `fast-check` (TypeScript), `hypothesis` (Python)
- Minimum 100 iterations per property test
- Each test tagged with: `Feature: rag-competitive-intelligence-extraction, Property {number}: {property_text}`

---

## Rollback Strategy

### Quick Rollback (Feature Flags)
Each phase has feature flags that can be disabled immediately without code changes:

```bash
# Phase 2
export FEATURE_SUBSECTION_FILTERING=false
export FEATURE_STRUCTURED_EXTRACTION=false

# Phase 3
export FEATURE_RERANKING=false
export FEATURE_HYDE=false

# Phase 4
export FEATURE_DYNAMIC_CALCULATIONS=false
export FEATURE_CHART_GENERATION=false
```

### Full Rollback (Git Tags)
Each phase has a git tag for complete rollback:

```bash
# Rollback to Phase 1
git checkout rag-extraction-phase1-v1.0.0
npm run build
pm2 restart all
```

### Rollback Decision Criteria
**Immediate Rollback**:
- Multi-ticker mixing detected
- Data accuracy issues
- Critical bugs

**Rollback Recommended**:
- Success rate drops below 80%
- Latency exceeds targets by >50%
- Formula validation failures >10%

---

## Monitoring

### Key Metrics
- **Success Rates**: Competitive intelligence (>95%), MD&A (>90%), Footnote (>90%)
- **Confidence Scores**: Average by intent type (>0.7)
- **Latency**: p95 < 5 seconds (Phase 2-3), < 8 seconds (Phase 4 calculations)
- **Multi-Ticker Mixing**: Zero incidents
- **Formula Validation**: Failure rate < 10%

### Alerts
- Success rate drops below targets
- Multi-ticker mixing detected
- Latency exceeds targets
- Formula validation failures exceed 10%

### Dashboards
- Real-time extraction success rates
- Latency trends by phase
- Confidence score distributions
- Advanced technique usage
- Formula cache hit rates

---

## Getting Started

### For Developers

1. **Read the Requirements**: Start with [requirements.md](./requirements.md) to understand what we're building
2. **Review the Design**: Read [design.md](./design.md) to understand the architecture
3. **Check the Tasks**: Open [tasks.md](./tasks.md) to see the implementation plan
4. **Set Up Git Tags**: Follow [GIT_TAGGING_GUIDE.md](./GIT_TAGGING_GUIDE.md) for tagging procedures

### For Product Managers

1. **Review Success Criteria**: Each phase has clear success criteria in [tasks.md](./tasks.md)
2. **Monitor Metrics**: Track success rates, latency, and confidence scores
3. **Collect Feedback**: User feedback is critical for continuous improvement
4. **Plan Rollout**: Consider gradual rollout to specific users/tenants first

### For QA Engineers

1. **Test Plan**: Review testing strategy in [design.md](./design.md)
2. **Property Tests**: Understand the 23 correctness properties
3. **Integration Tests**: Test end-to-end flows for each phase
4. **Rollback Testing**: Verify rollback procedures work on staging

---

## Example Queries

### Competitive Intelligence
**Query**: "Who are NVDA's competitors?"

**Before**: Returns section references but no competitor names

**After Phase 2**: 
```json
{
  "competitors": [
    {
      "name": "AMD",
      "context": "Competes in GPU and data center markets",
      "threatLevel": "high"
    },
    {
      "name": "Intel",
      "context": "Competes in data center and AI chip markets",
      "threatLevel": "medium"
    }
  ],
  "marketPositioning": "NVIDIA is the market leader in GPUs for gaming and AI...",
  "competitiveAdvantages": [
    "Strong brand recognition in gaming",
    "CUDA ecosystem lock-in",
    "First-mover advantage in AI chips"
  ],
  "confidence": 0.92,
  "sources": [
    {
      "section": "Item 1",
      "subsection": "Competition",
      "filingType": "10-K",
      "fiscalPeriod": "FY2024"
    }
  ]
}
```

### MD&A Intelligence
**Query**: "What are AAPL's growth drivers?"

**Before**: Identifies Item 7 but doesn't extract trends

**After Phase 2**:
```json
{
  "keyTrends": [
    "Services revenue growth accelerating",
    "iPhone upgrade cycle driven by 5G adoption",
    "Wearables and accessories showing strong momentum"
  ],
  "risks": [
    {
      "category": "market",
      "description": "Smartphone market saturation in developed markets"
    },
    {
      "category": "operational",
      "description": "Supply chain constraints for key components"
    }
  ],
  "forwardGuidance": [
    {
      "statement": "Expect services revenue to grow double digits",
      "timeframe": "FY2025"
    }
  ],
  "confidence": 0.88,
  "sources": [
    {
      "section": "Item 7",
      "subsection": "Results of Operations",
      "filingType": "10-K",
      "fiscalPeriod": "FY2024"
    }
  ]
}
```

### Dynamic Calculation (Phase 4)
**Query**: "Calculate NVDA's operating leverage"

**After Phase 4**:
```json
{
  "formula": "Operating Leverage = % Change in Operating Income / % Change in Revenue",
  "calculation": {
    "revenueGrowth": 0.265,
    "operatingIncomeGrowth": 0.412,
    "operatingLeverage": 1.55
  },
  "interpretation": "NVDA has positive operating leverage of 1.55x, meaning a 1% increase in revenue leads to a 1.55% increase in operating income",
  "chart": {
    "type": "line",
    "data": [/* time series data */]
  },
  "confidence": 0.95,
  "sources": [/* quantitative sources */]
}
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Query                               │
│         "Who are NVDA's competitors?"                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Intent Detector Service                       │
│  Intent: competitive_intelligence                                │
│  Target: Item 1, Subsection: Competition                         │
│  Ticker: NVDA                                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                  Semantic Retriever Service                      │
│  Filter: ticker=NVDA, section_type=item_1,                      │
│          subsection_name=Competition                             │
│  Source: Bedrock KB (with reranking in Phase 3)                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                  Response Generator Service                      │
│  Extract: Competitor names, market positioning,                  │
│           competitive advantages/disadvantages                   │
│  Validate: All claims supported by chunks                        │
│  Score: Confidence = 0.92                                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      RAG Response                                │
│  Competitors: AMD, Intel, AI chip startups                       │
│  Market Positioning: Market leader in GPUs...                    │
│  Competitive Advantages: CUDA ecosystem, brand...                │
│  Confidence: 0.92                                                │
│  Sources: Item 1 - Competition (10-K, FY2024)                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Success Metrics

### Phase 1 Success
- ✅ 80%+ of chunks have subsection_name populated
- ✅ Zero errors with existing chunks
- ✅ Bedrock KB ingestion success rate >99%

### Phase 2 Success
- ✅ Competitive intelligence queries extract competitor names (>95% success)
- ✅ MD&A queries extract trends, risks, guidance (>90% success)
- ✅ Footnote queries extract policy details (>90% success)
- ✅ Zero multi-ticker mixing incidents
- ✅ Average confidence scores >0.7

### Phase 3 Success
- ✅ Reranking improves top-3 relevance by >10%
- ✅ HyDE improves retrieval for ambiguous queries
- ✅ Query decomposition handles multi-faceted queries
- ✅ Latency p95 < 5 seconds

### Phase 4 Success
- ✅ Dynamic calculations work for common metrics (>90% success)
- ✅ Formula validation prevents invalid calculations
- ✅ Charts generate correctly for all types
- ✅ Code interpreter executes safely
- ✅ Latency p95 < 8 seconds (calculations), < 15 seconds (code interpreter)

---

## Timeline

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 1 | 1-2 weeks | 1-2 weeks |
| Phase 2 | 2-3 weeks | 3-5 weeks |
| Phase 3 | 2-3 weeks | 5-8 weeks |
| Phase 4 | 3-4 weeks | 8-12 weeks |

**Total Estimated Duration**: 8-12 weeks for complete implementation

---

## Team

**Feature Owner**: TBD
**Technical Lead**: TBD
**Backend Engineers**: TBD
**Frontend Engineers**: TBD
**QA Engineers**: TBD
**Product Manager**: TBD

---

## Communication

**Slack Channel**: #rag-extraction-feature
**Standup**: Daily at TBD
**Sprint Planning**: Bi-weekly on TBD
**Retrospective**: After each phase completion

---

## Resources

### Documentation
- [Requirements Document](./requirements.md)
- [Design Document](./design.md)
- [Implementation Tasks](./tasks.md)
- [CHANGELOG](../../CHANGELOG-RAG-EXTRACTION.md)
- [Git Tagging Guide](./GIT_TAGGING_GUIDE.md)

### Related Features
- [Research Assistant Improvement](./../research-assistant-improvement/)
- [ChatGPT-like Research Assistant](./../chatgpt-like-research-assistant/)
- [Metric Normalization Enhancement](./../metric-normalization-enhancement/)

### External Resources
- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [fast-check Documentation](https://fast-check.dev/)
- [Chart.js Documentation](https://www.chartjs.org/)

---

## FAQ

### Q: Why phased approach instead of all at once?
**A**: Phased approach reduces risk, enables faster feedback, and allows rollback at any point. Each phase builds on the previous one and can be independently deployed and tested.

### Q: What if Phase 2 fails in production?
**A**: Use feature flags for immediate disable, or git checkout to Phase 1 tag for full rollback. All rollback procedures are documented in the Git Tagging Guide.

### Q: How do we prevent multi-ticker mixing?
**A**: Phase 2 implements strict ticker isolation with validation. Any mixing incident triggers immediate alert and automatic rollback.

### Q: What's the performance impact?
**A**: Phase 2-3 target p95 latency < 5 seconds. Phase 4 (dynamic calculations) targets < 8 seconds. All phases include performance monitoring and optimization.

### Q: Can we skip Phase 3 or 4?
**A**: Yes! Each phase is optional. Phase 1-2 provide core functionality. Phase 3-4 add advanced features but aren't required for basic competitive intelligence extraction.

### Q: How do we test this?
**A**: Dual testing approach: unit tests for specific examples + property tests for universal properties. 23 property tests cover all correctness properties across all phases.

---

## Status

**Current Phase**: Not Started
**Last Updated**: TBD
**Next Milestone**: Create baseline git tag

---

## License

Internal use only. Proprietary to FundLens.
