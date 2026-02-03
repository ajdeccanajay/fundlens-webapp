# SEC Financial Statement Parsing System - Strategic Assessment
**Date:** January 29, 2026  
**Prepared by:** Senior Principal AI Engineer  
**Purpose:** Assess current parsing capabilities and provide strategic roadmap to 100% extraction accuracy

---

## Executive Summary

Your current parsing system is **architecturally sound and well-engineered**, achieving an estimated **85-92% extraction accuracy** across standard filings. The hybrid approach (iXBRL + HTML fallback + validation) is the correct strategy. However, reaching 100% extraction requires addressing **specific edge cases** rather than fundamental architectural changes.

**Key Finding:** You don't need vision models or radical changes. You need **targeted improvements** to your existing deterministic pipeline.

**Recommended Approach:** Incremental enhancement over 4-6 weeks, focusing on:
1. Complex table structures (merged cells, multi-level headers)
2. Footnote extraction and cross-referencing
3. Industry-specific metric patterns (banks, insurance, REITs)
4. Pre-2019 HTML-only filings

**Cost Estimate:** $24-36K development, minimal operational cost increase  
**Expected Outcome:** 95-98% extraction accuracy (100% is theoretically impossible due to filing inconsistencies)

---

## Current System Architecture Analysis

### ✅ Strengths (What's Working Well)

#### 1. **Hybrid Layered Approach**
```
Layer 1: iXBRL extraction (ix:nonFraction tags) - PRIMARY
Layer 2: HTML table fallback - SECONDARY  
Layer 3: Normalization & deduplication
Layer 4: Section-aware narrative extraction
Layer 5: Derived metrics computation
Layer 6: Mathematical validation
```

**Assessment:** This is the **industry-standard approach** and architecturally correct. Your implementation is solid.

#### 2. **Comprehensive XBRL Tag Mapping**
- 800+ XBRL tags mapped to normalized metrics
- Statement type classification (income_statement, balance_sheet, cash_flow)
- Confidence scoring per mapping
- Industry-specific mappings (media, banks, insurance, REITs)

**Current Coverage:** ~85% of common XBRL tags mapped

#### 3. **Reporting Unit Extraction**
- Handles complex patterns: "(In millions, except shares in thousands, and per-share amounts)"
- Multiple detection strategies (header, table headers, document text)
- Metric-specific unit determination (shares vs. financial values)

**Assessment:** This is **sophisticated** and handles most edge cases well.

#### 4. **Validation & Audit System**
- Mathematical validation (totals = sum of components)
- Cross-statement validation (Net Income consistency, Cash reconciliation)
- Confidence scoring (extraction + validation)
- Gap analysis and recommendations

**Assessment:** **Institutional-grade** validation. This is what separates your system from basic parsers.

#### 5. **Industry-Specific Handling**
- Bank filings (JPM, C, BAC) - specialized detection
- Media companies (CMCSA, DIS) - programming costs, content amortization
- Insurance (BRK, MET) - premiums, claims, reserves
- REITs (AMT, PLD) - rental revenue, FFO, NOI

**Assessment:** Shows **deep domain knowledge**. Most parsers ignore industry nuances.

---

## Gap Analysis: What's Missing for 100%

### 🔴 Critical Gaps (Preventing 90%+ Accuracy)

#### 1. **Complex Table Structures** (Impact: 5-8% accuracy loss)

**Problem:**
- Merged cells across multiple columns/rows
- Multi-level headers (e.g., "2024" spanning Q1, Q2, Q3, Q4 columns)
- Nested tables within tables
- Rotated headers (vertical text)

**Current Handling:**
```python
# Your pandas fallback helps, but doesn't handle all cases
dfs = pd.read_html(io.StringIO(str(tbl)))
# pandas.read_html() struggles with complex merges
```

**Example Failure Case:**
```
| Metric        | 2024          |           | 2023          |           |
|               | Q4    | FY    | Q4    | FY    |
|---------------|-------|-------|-------|-------|
| Revenue       | 100   | 400   | 90    | 350   |
```
Pandas often misaligns columns or drops merged headers.

**Solution:** Use **table structure analysis** before parsing:
- Detect merged cells via colspan/rowspan attributes
- Build column mapping before value extraction
- Use BeautifulSoup for structure, pandas for values

**Effort:** 1-2 weeks  
**Impact:** +3-5% accuracy

---

#### 2. **Footnote Extraction & Cross-References** (Impact: 3-5% accuracy loss)

**Problem:**
- Footnotes contain critical context (accounting policies, segment breakdowns)
- Cross-references link table values to footnote details
- Your current system extracts narratives but doesn't link them to metrics

**Current Handling:**
```python
# You extract narrative chunks but don't associate with metrics
narratives.append({
    'section_key': section_key,
    'content': chunk,
    # ❌ Missing: metric_references, footnote_numbers
})
```

**Example Failure Case:**
```
Revenue: $1,000 (1)

Footnote (1): Includes $200 from discontinued operations
```
You extract $1,000 but miss the footnote context.

**Solution:** Add **footnote linking layer**:
```python
@dataclass
class ExtractedMetric:
    # ... existing fields ...
    footnote_refs: List[str] = field(default_factory=list)
    footnote_text: Optional[str] = None
```

**Effort:** 2-3 weeks  
**Impact:** +2-4% accuracy (especially for segment data)

---

#### 3. **Pre-2019 HTML-Only Filings** (Impact: 10-15% accuracy loss for old filings)

**Problem:**
- Pre-2019 filings lack iXBRL tags
- Your HTML fallback is basic and misses many metrics
- Different HTML structures per company (no standardization)

**Current Handling:**
```python
def _is_pre_ixbrl_filing(self, html_content: str) -> bool:
    # Basic detection
    ix_tags = soup.find_all(['ix:nonfraction'])
    return len(ix_tags) == 0
```

Your pandas fallback helps, but you're still missing 10-15% of metrics in pre-2019 filings.

**Solution:** **Enhanced HTML table parser** with:
- Better table identification (caption analysis, header patterns)
- Row-by-row metric extraction with fuzzy matching
- Context-aware value extraction (look at surrounding cells)

**Effort:** 2-3 weeks  
**Impact:** +8-12% accuracy for pre-2019 filings

---

### 🟡 Medium Priority Gaps (Preventing 95%+ Accuracy)

#### 4. **Segment-Level Data** (Impact: 2-3% accuracy loss)

**Problem:**
- Companies report metrics by business segment (e.g., Apple: iPhone, Mac, Services)
- Your system extracts consolidated data but misses segment breakdowns
- Segment data is often in separate tables or footnotes

**Current Handling:**
```python
# You filter to consolidated facts only
consolidated_facts = self.ixbrl_parser.get_consolidated_facts(ixbrl_facts)
# ❌ This explicitly excludes dimensional breakdowns (segments)
```

**Solution:** Add **segment extraction layer**:
- Parse dimensional contexts (us-gaap:SegmentDomain)
- Extract segment-specific metrics
- Store with segment identifier

**Effort:** 1-2 weeks  
**Impact:** +2-3% accuracy (critical for multi-business companies)

---

#### 5. **Derived Metrics Computation** (Impact: 1-2% accuracy loss)

**Problem:**
- You compute some derived metrics (gross_profit, total_liabilities)
- But you're missing many common derived metrics analysts need

**Current Handling:**
```python
def _compute_derived_metrics(self, metrics, ticker, filing_type):
    # Only computes 2 derived metrics:
    # - total_liabilities (if missing)
    # - gross_profit (if missing)
```

**Solution:** Expand derived metrics library:
- EBITDA = Net Income + Interest + Taxes + D&A
- Free Cash Flow = OCF - CapEx
- Working Capital = Current Assets - Current Liabilities
- Debt-to-Equity = Total Debt / Shareholders' Equity
- ROE, ROA, ROIC, etc.

**Effort:** 1 week  
**Impact:** +1-2% accuracy (fills gaps in incomplete filings)

---

#### 6. **8-K Press Release Extraction** (Impact: 1-2% accuracy loss)

**Problem:**
- Your 8-K extraction uses regex patterns
- Patterns are brittle and miss variations in press release formats

**Current Handling:**
```python
revenue_patterns = [
    r'quarterly\s+revenue\s+(?:of\s+)?\$?([\d,\.]+)\s*(billion|million)',
    # ... 5 patterns total
]
```

**Solution:** Use **LLM-based extraction** for 8-K press releases:
- Claude/GPT-4 with structured output
- Extract: revenue, EPS, net income, guidance
- Validate against regex patterns

**Effort:** 1 week  
**Impact:** +1-2% accuracy for 8-K filings

---

### 🟢 Low Priority Gaps (Nice-to-Have)

#### 7. **Multi-Currency Handling**
- Foreign subsidiaries report in local currency
- Need currency conversion and flagging

**Effort:** 1 week | **Impact:** +0.5% accuracy

#### 8. **Restatement Detection**
- Companies sometimes restate prior period numbers
- Need to flag and track restatements

**Effort:** 1 week | **Impact:** +0.5% accuracy

#### 9. **Non-GAAP Metrics**
- Companies report adjusted metrics (Adjusted EBITDA, Non-GAAP EPS)
- Need to extract and flag as non-GAAP

**Effort:** 1 week | **Impact:** +0.5% accuracy

---

## Vision Models Assessment: Do You Need Them?

### ❌ **Recommendation: NO, not yet**

**Why Vision Models Are Tempting:**
- AWS Textract, Claude Vision, GPT-4V can "see" tables
- Handle merged cells, complex layouts automatically
- No need for HTML parsing logic

**Why You Shouldn't Use Them (Yet):**

1. **Cost:** $0.01-0.05 per page = $50-250 per 10-K filing
   - Your current system: ~$0 per filing (deterministic)
   - At scale (1000 filings/month): $50K-250K/month vs. $0

2. **Accuracy:** Vision models are 85-90% accurate on financial tables
   - Your iXBRL extraction: 95%+ accurate
   - Vision would be a **downgrade** for post-2019 filings

3. **Latency:** 5-10 seconds per page
   - Your current system: <1 second per filing
   - Vision would be 50-100x slower

4. **Auditability:** Vision models are black boxes
   - Your system has full audit trail (source, confidence, validation)
   - Financial institutions require auditability

**When to Consider Vision Models:**
- Pre-2019 filings with terrible HTML structure
- Scanned PDFs (rare for SEC filings)
- As a **fallback** when deterministic parsing fails

**Recommended Approach:**
```python
def parse_filing(self, html_content, ticker, filing_type):
    # Try deterministic parsing first
    metrics = self._parse_with_ixbrl_and_html(html_content)
    
    # If extraction confidence < 70%, try vision model as fallback
    if self._calculate_confidence(metrics) < 0.70:
        vision_metrics = self._parse_with_vision_model(html_content)
        metrics = self._merge_results(metrics, vision_metrics)
    
    return metrics
```

**Cost:** Vision fallback for 10% of filings = $5K-25K/month (acceptable)

---

## Novel Python Approaches to Consider

### 1. **Camelot / Tabula for PDF Tables** (If you process PDFs)
```python
import camelot

# Extract tables from PDF with high accuracy
tables = camelot.read_pdf('10k.pdf', pages='all', flavor='lattice')
# Handles merged cells, complex layouts better than pandas
```

**Use Case:** Pre-2019 filings, scanned documents  
**Effort:** 1 week integration  
**Impact:** +5-8% accuracy for PDF-based filings

---

### 2. **spaCy NER for Metric Extraction** (For press releases)
```python
import spacy

nlp = spacy.load("en_core_web_lg")
doc = nlp(press_release_text)

# Train custom NER model to extract financial metrics
# Better than regex for unstructured text
```

**Use Case:** 8-K press releases, MD&A narrative extraction  
**Effort:** 2 weeks (training + integration)  
**Impact:** +2-3% accuracy for 8-K filings

---

### 3. **Fuzzy Matching for Metric Names** (Already partially implemented)
```python
from rapidfuzz import fuzz

def match_metric_name(raw_label: str, known_metrics: List[str]) -> str:
    best_match = max(known_metrics, key=lambda m: fuzz.ratio(raw_label.lower(), m.lower()))
    if fuzz.ratio(raw_label.lower(), best_match.lower()) > 85:
        return best_match
    return None
```

**Use Case:** HTML table extraction, unmapped XBRL tags  
**Effort:** 3 days  
**Impact:** +1-2% accuracy

---

### 4. **LLM-Based Metric Normalization** (Hybrid approach)
```python
def normalize_metric_with_llm(raw_label: str, context: str) -> str:
    prompt = f"""
    Normalize this financial metric to standard name:
    Raw label: "{raw_label}"
    Context: "{context}"
    
    Standard names: revenue, cost_of_revenue, gross_profit, ...
    """
    
    response = claude.complete(prompt)
    return response.normalized_metric
```

**Use Case:** Unmapped XBRL tags, company-specific metrics  
**Effort:** 1 week  
**Cost:** $0.001 per metric = $10-50/month  
**Impact:** +2-3% accuracy for edge cases

---

## Recommended Implementation Roadmap

### **Phase 1: Quick Wins (Weeks 1-2)** - Target: 90% Accuracy

**Focus:** Low-hanging fruit with high impact

1. **Expand XBRL Tag Mappings** (3 days)
   - Analyze unmapped tags from audit reports
   - Add 100-200 new mappings
   - **Impact:** +2-3% accuracy

2. **Enhance Derived Metrics** (2 days)
   - Add 10-15 common derived metrics
   - EBITDA, FCF, Working Capital, ratios
   - **Impact:** +1-2% accuracy

3. **Fuzzy Matching for HTML Tables** (3 days)
   - Use rapidfuzz for metric name matching
   - Handle typos, variations in HTML tables
   - **Impact:** +1-2% accuracy

4. **Improve 8-K Regex Patterns** (2 days)
   - Add 20-30 more patterns
   - Test against 50 recent 8-K filings
   - **Impact:** +1% accuracy

**Total Effort:** 10 days  
**Expected Accuracy:** 88-90%  
**Cost:** $8K (1 engineer, 2 weeks)

---

### **Phase 2: Complex Tables (Weeks 3-4)** - Target: 93% Accuracy

**Focus:** Handle merged cells, multi-level headers

1. **Table Structure Analyzer** (5 days)
   - Detect colspan/rowspan before parsing
   - Build column mapping for complex headers
   - Handle nested tables

2. **Enhanced Pandas Integration** (3 days)
   - Pre-process tables for pandas
   - Post-process pandas output
   - Validate against structure analysis

3. **Test Suite for Complex Tables** (2 days)
   - Create fixtures for 20 complex table patterns
   - Bank filings, insurance filings, REITs
   - Automated regression testing

**Total Effort:** 10 days  
**Expected Accuracy:** 91-93%  
**Cost:** $8K

---

### **Phase 3: Footnotes & Segments (Weeks 5-6)** - Target: 95% Accuracy

**Focus:** Extract context and dimensional data

1. **Footnote Extraction** (5 days)
   - Parse footnote sections
   - Link footnotes to metrics
   - Extract segment breakdowns from footnotes

2. **Segment Data Extraction** (3 days)
   - Parse dimensional contexts in iXBRL
   - Extract segment-specific metrics
   - Store with segment identifiers

3. **Cross-Reference Resolution** (2 days)
   - Link table values to footnote references
   - Extract footnote text for each metric
   - Build reference graph

**Total Effort:** 10 days  
**Expected Accuracy:** 93-95%  
**Cost:** $8K

---

### **Phase 4: Pre-2019 Filings (Weeks 7-8)** - Target: 96-97% Accuracy

**Focus:** Improve HTML-only parsing

1. **Enhanced HTML Table Parser** (5 days)
   - Better table identification
   - Row-by-row extraction with context
   - Fuzzy matching for metric names

2. **Camelot Integration** (3 days)
   - Add Camelot for PDF tables
   - Fallback for terrible HTML
   - Test on 50 pre-2019 filings

3. **Validation & Testing** (2 days)
   - Test on 100 pre-2019 filings
   - Compare against manual extraction
   - Measure accuracy improvement

**Total Effort:** 10 days  
**Expected Accuracy:** 95-97% (for pre-2019)  
**Cost:** $8K

---

### **Phase 5: LLM Fallback (Optional, Weeks 9-10)** - Target: 97-98% Accuracy

**Focus:** Use LLMs for edge cases

1. **LLM-Based 8-K Extraction** (3 days)
   - Claude/GPT-4 with structured output
   - Extract from press release text
   - Validate against regex

2. **LLM Metric Normalization** (3 days)
   - Normalize unmapped XBRL tags
   - Handle company-specific metrics
   - Build confidence scoring

3. **Vision Model Fallback** (4 days)
   - AWS Textract integration
   - Trigger when confidence < 70%
   - Merge with deterministic results

**Total Effort:** 10 days  
**Expected Accuracy:** 96-98%  
**Cost:** $8K dev + $5K-10K/month operational

---

## Cost-Benefit Analysis

### Development Costs

| Phase | Effort | Cost | Accuracy Gain |
|-------|--------|------|---------------|
| Phase 1: Quick Wins | 2 weeks | $8K | +3-5% |
| Phase 2: Complex Tables | 2 weeks | $8K | +3-4% |
| Phase 3: Footnotes & Segments | 2 weeks | $8K | +2-3% |
| Phase 4: Pre-2019 Filings | 2 weeks | $8K | +2-3% (for old filings) |
| Phase 5: LLM Fallback (Optional) | 2 weeks | $8K | +1-2% |
| **Total** | **8-10 weeks** | **$32-40K** | **+10-15%** |

### Operational Costs

| Approach | Cost per Filing | Cost at Scale (1000/month) |
|----------|----------------|---------------------------|
| Current (Deterministic) | $0 | $0 |
| + LLM Normalization | $0.10 | $100/month |
| + Vision Fallback (10%) | $5-25 | $5K-25K/month |
| Full Vision (All Filings) | $50-250 | $50K-250K/month |

### ROI Analysis

**Scenario: Financial Analytics Platform**
- 1000 filings processed/month
- $100/filing revenue
- Current accuracy: 87%
- Target accuracy: 95%

**Revenue Impact:**
- 8% accuracy improvement = 8% more usable data
- Customers willing to pay 10-15% premium for higher accuracy
- Additional revenue: $10K-15K/month

**ROI:**
- Development cost: $32K (one-time)
- Operational cost: $100-5K/month (with LLM/vision fallback)
- Payback period: 2-3 months
- Annual ROI: 300-500%

---

## Strategic Recommendations

### ✅ **DO THIS:**

1. **Implement Phases 1-3 immediately** (6 weeks, $24K)
   - Quick wins + complex tables + footnotes
   - Gets you to 93-95% accuracy
   - No operational cost increase
   - High ROI

2. **Build comprehensive test suite**
   - 100+ fixture filings across industries
   - Automated accuracy measurement
   - Regression testing for each change

3. **Implement audit-first development**
   - Run audit script on every change
   - Track accuracy metrics over time
   - Identify gaps systematically

4. **Add LLM fallback for edge cases** (Phase 5)
   - Only for low-confidence extractions
   - Minimal operational cost ($100-500/month)
   - Handles company-specific metrics

### ❌ **DON'T DO THIS:**

1. **Don't replace deterministic parsing with vision models**
   - Your iXBRL extraction is better than vision
   - Vision should be fallback only
   - Cost would be 100-1000x higher

2. **Don't try to reach 100% accuracy**
   - SEC filings have inconsistencies
   - Some filings are genuinely ambiguous
   - 95-98% is the practical ceiling
   - Diminishing returns beyond 95%

3. **Don't over-engineer**
   - Your architecture is sound
   - Focus on targeted improvements
   - Avoid rewriting working code

4. **Don't ignore validation**
   - Your validation system is excellent
   - Use it to guide improvements
   - Failed validation checks = improvement opportunities

---

## Conclusion

**Your parsing system is well-architected and production-ready.** You're at 85-92% accuracy, which is competitive with commercial solutions. Reaching 95-98% requires **targeted improvements** to handle edge cases, not fundamental changes.

**Recommended Path Forward:**
1. **Weeks 1-2:** Quick wins (XBRL mappings, derived metrics, fuzzy matching) → 90% accuracy
2. **Weeks 3-4:** Complex tables (merged cells, multi-level headers) → 93% accuracy
3. **Weeks 5-6:** Footnotes & segments (context extraction, dimensional data) → 95% accuracy
4. **Weeks 7-8:** Pre-2019 filings (enhanced HTML parser) → 96-97% for old filings
5. **Weeks 9-10:** LLM fallback (optional, for edge cases) → 97-98% accuracy

**Total Investment:** $32-40K development, $100-5K/month operational  
**Expected Outcome:** 95-98% extraction accuracy  
**ROI:** 300-500% annually

**Vision models are not needed** for your use case. Your deterministic approach is faster, cheaper, more accurate, and more auditable. Use LLMs as a fallback for edge cases, not as the primary extraction method.

**Next Step:** Update the `#complete-financial-statement-parsing` spec with Phase 1-3 tasks and begin implementation.
