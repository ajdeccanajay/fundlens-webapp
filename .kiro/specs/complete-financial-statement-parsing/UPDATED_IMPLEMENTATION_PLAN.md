# Updated Implementation Plan: Reaching 95-98% Extraction Accuracy
**Based on Strategic Assessment - January 29, 2026**

## Executive Summary

Current system is at **85-92% accuracy** with solid architecture. This plan focuses on **targeted improvements** to reach **95-98% accuracy** over 6-8 weeks without fundamental architectural changes.

**Key Insight:** You don't need vision models or rewrites. You need targeted enhancements to handle edge cases.

---

## Phase 1: Quick Wins (Weeks 1-2) → 90% Accuracy

### Goal: Low-hanging fruit with high impact
**Effort:** 10 days | **Cost:** $8K | **Impact:** +3-5% accuracy

### Tasks

#### 1.1 Expand XBRL Tag Mappings (3 days)
- [ ] Analyze unmapped tags from recent audit reports
- [ ] Add 100-200 new tag mappings to xbrl_tag_mapper.py
- [ ] Focus on frequently occurring unmapped tags
- [ ] Test against 20 recent filings
- **Impact:** +2-3% accuracy

#### 1.2 Enhance Derived Metrics (2 days)
- [ ] Add EBITDA calculation (Net Income + Interest + Taxes + D&A)
- [ ] Add Free Cash Flow (OCF - CapEx)
- [ ] Add Working Capital (Current Assets - Current Liabilities)
- [ ] Add common ratios (Debt-to-Equity, ROE, ROA)
- [ ] Add 10-15 total derived metrics
- **Impact:** +1-2% accuracy

#### 1.3 Implement Fuzzy Matching for HTML Tables (3 days)
- [ ] Install rapidfuzz library
- [ ] Add fuzzy_match_metric_name() helper
- [ ] Use in HTML table extraction for unmapped labels
- [ ] Set confidence threshold at 85% similarity
- **Impact:** +1-2% accuracy

#### 1.4 Improve 8-K Regex Patterns (2 days)
- [ ] Add 20-30 more extraction patterns
- [ ] Test against 50 recent 8-K filings
- [ ] Handle variations in press release formats
- **Impact:** +1% accuracy

---

## Phase 2: Complex Tables (Weeks 3-4) → 93% Accuracy

### Goal: Handle merged cells, multi-level headers
**Effort:** 10 days | **Cost:** $8K | **Impact:** +3-4% accuracy


### Tasks

#### 2.1 Table Structure Analyzer (5 days)
- [ ] Create table_structure_analyzer.py module
- [ ] Detect colspan/rowspan attributes before parsing
- [ ] Build column mapping for complex headers
- [ ] Handle multi-level headers (e.g., "2024" spanning Q1-Q4)
- [ ] Handle nested tables within tables
- **Impact:** +2-3% accuracy

#### 2.2 Enhanced Pandas Integration (3 days)
- [ ] Pre-process tables for pandas (flatten merged cells)
- [ ] Post-process pandas output (validate against structure)
- [ ] Add fallback to BeautifulSoup for complex cases
- **Impact:** +1-2% accuracy

#### 2.3 Test Suite for Complex Tables (2 days)
- [ ] Create fixtures for 20 complex table patterns
- [ ] Include bank filings (JPM, C, BAC)
- [ ] Include insurance filings (BRK, MET)
- [ ] Include REIT filings (AMT, PLD)
- [ ] Automated regression testing
- **Impact:** Prevents regressions

---

## Phase 3: Footnotes & Segments (Weeks 5-6) → 95% Accuracy

### Goal: Extract context and dimensional data
**Effort:** 10 days | **Cost:** $8K | **Impact:** +2-3% accuracy

### Tasks

#### 3.1 Footnote Extraction (5 days)
- [ ] Add footnote_extractor.py module
- [ ] Parse footnote sections from HTML
- [ ] Link footnotes to metrics via reference numbers
- [ ] Extract segment breakdowns from footnotes
- [ ] Add footnote_refs and footnote_text to ExtractedMetric
- **Impact:** +1-2% accuracy

#### 3.2 Segment Data Extraction (3 days)
- [ ] Parse dimensional contexts in iXBRL (us-gaap:SegmentDomain)
- [ ] Extract segment-specific metrics
- [ ] Store with segment identifier
- [ ] Add segment_name field to ExtractedMetric
- **Impact:** +1-2% accuracy

#### 3.3 Cross-Reference Resolution (2 days)
- [ ] Link table values to footnote references
- [ ] Extract footnote text for each metric
- [ ] Build reference graph for navigation
- **Impact:** Improves data quality

---

## Phase 4: Pre-2019 Filings (Weeks 7-8) → 96-97% Accuracy

### Goal: Improve HTML-only parsing for old filings
**Effort:** 10 days | **Cost:** $8K | **Impact:** +2-3% for pre-2019

### Tasks

#### 4.1 Enhanced HTML Table Parser (5 days)
- [ ] Improve table identification (caption analysis, header patterns)
- [ ] Implement row-by-row extraction with context awareness
- [ ] Use fuzzy matching for metric names
- [ ] Handle company-specific table formats
- **Impact:** +2-3% for pre-2019 filings

#### 4.2 Camelot Integration (3 days)
- [ ] Install camelot-py library
- [ ] Add PDF table extraction capability
- [ ] Use as fallback for terrible HTML
- [ ] Test on 50 pre-2019 filings
- **Impact:** +1-2% for PDF-based filings

#### 4.3 Validation & Testing (2 days)
- [ ] Test on 100 pre-2019 filings
- [ ] Compare against manual extraction
- [ ] Measure accuracy improvement
- [ ] Document remaining gaps
- **Impact:** Validates improvements

---

## Phase 5: LLM Fallback (Optional, Weeks 9-10) → 97-98% Accuracy

### Goal: Use LLMs for edge cases only
**Effort:** 10 days | **Cost:** $8K dev + $100-5K/month operational | **Impact:** +1-2% accuracy

### Tasks

#### 5.1 LLM-Based 8-K Extraction (3 days)
- [ ] Integrate Claude/GPT-4 with structured output
- [ ] Extract from press release text
- [ ] Validate against regex patterns
- [ ] Use only when regex fails
- **Cost:** $0.001 per extraction = $10-50/month
- **Impact:** +1% accuracy for 8-K filings

#### 5.2 LLM Metric Normalization (3 days)
- [ ] Normalize unmapped XBRL tags using LLM
- [ ] Handle company-specific metrics
- [ ] Build confidence scoring
- [ ] Use only for unmapped tags
- **Cost:** $0.001 per tag = $50-100/month
- **Impact:** +0.5-1% accuracy

#### 5.3 Vision Model Fallback (4 days)
- [ ] Integrate AWS Textract
- [ ] Trigger only when extraction confidence < 70%
- [ ] Merge vision results with deterministic results
- [ ] Use for <10% of filings
- **Cost:** $5-25 per filing × 10% = $5K-25K/month
- **Impact:** +0.5-1% accuracy

---

## Testing Strategy

### Automated Testing
- [ ] Create 100+ fixture filings across industries
- [ ] Automated accuracy measurement per filing
- [ ] Regression testing for each change
- [ ] Track accuracy metrics over time

### Manual Validation
- [ ] Manual review of 20 filings per phase
- [ ] Compare Excel exports against SEC originals
- [ ] Document edge cases and limitations

### Audit-First Development
- [ ] Run audit_script.py on every change
- [ ] Track completeness percentage
- [ ] Identify gaps systematically
- [ ] Prioritize high-frequency gaps

---

## Success Metrics

### Phase 1 (Weeks 1-2)
- **Target:** 88-90% accuracy
- **Measure:** Audit script completeness percentage
- **Validation:** 20 filings manually reviewed

### Phase 2 (Weeks 3-4)
- **Target:** 91-93% accuracy
- **Measure:** Complex table extraction success rate
- **Validation:** Bank/insurance filings reviewed

### Phase 3 (Weeks 5-6)
- **Target:** 93-95% accuracy
- **Measure:** Segment data extraction coverage
- **Validation:** Multi-segment companies reviewed

### Phase 4 (Weeks 7-8)
- **Target:** 95-97% accuracy (for pre-2019)
- **Measure:** Pre-2019 filing completeness
- **Validation:** 50 old filings reviewed

### Phase 5 (Weeks 9-10, Optional)
- **Target:** 96-98% accuracy
- **Measure:** Edge case handling success rate
- **Validation:** Low-confidence filings reviewed

---

## Cost Summary

| Phase | Duration | Dev Cost | Operational Cost | Accuracy Gain |
|-------|----------|----------|------------------|---------------|
| Phase 1: Quick Wins | 2 weeks | $8K | $0 | +3-5% |
| Phase 2: Complex Tables | 2 weeks | $8K | $0 | +3-4% |
| Phase 3: Footnotes & Segments | 2 weeks | $8K | $0 | +2-3% |
| Phase 4: Pre-2019 Filings | 2 weeks | $8K | $0 | +2-3% (old) |
| Phase 5: LLM Fallback (Optional) | 2 weeks | $8K | $100-5K/mo | +1-2% |
| **Total** | **8-10 weeks** | **$32-40K** | **$100-5K/mo** | **+10-15%** |

---

## Risk Mitigation

### Technical Risks
- **Risk:** Complex table parsing breaks existing functionality
- **Mitigation:** Comprehensive regression testing, feature flags

- **Risk:** LLM costs spiral out of control
- **Mitigation:** Strict usage limits, fallback only for <10% of filings

- **Risk:** Pre-2019 filings too inconsistent to parse reliably
- **Mitigation:** Focus on post-2019 first, pre-2019 is bonus

### Business Risks
- **Risk:** 95% accuracy not sufficient for customers
- **Mitigation:** Validate with customers early, adjust targets

- **Risk:** Development takes longer than estimated
- **Mitigation:** Phased approach allows early value delivery

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Prioritize phases** based on business needs
3. **Start Phase 1** immediately (quick wins)
4. **Set up automated testing** infrastructure
5. **Track accuracy metrics** weekly

---

## Appendix: Why Not Vision Models?

### Cost Comparison
- **Deterministic:** $0 per filing
- **Vision (AWS Textract):** $50-250 per filing
- **At scale (1000/month):** $0 vs. $50K-250K/month

### Accuracy Comparison
- **iXBRL extraction:** 95%+ accurate
- **Vision models:** 85-90% accurate
- **Vision would be a downgrade** for post-2019 filings

### Latency Comparison
- **Deterministic:** <1 second per filing
- **Vision:** 5-10 seconds per page = 50-100x slower

### Auditability
- **Deterministic:** Full audit trail (source, confidence, validation)
- **Vision:** Black box, no audit trail
- **Financial institutions require auditability**

### Recommendation
Use vision models **only as fallback** for:
- Pre-2019 filings with terrible HTML
- Scanned PDFs (rare for SEC filings)
- When deterministic parsing confidence < 70%

This keeps costs low while handling edge cases.
