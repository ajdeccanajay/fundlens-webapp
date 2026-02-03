# HITL Workflow - Visual Guide

## User Interface Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Deal Financial Analysis                       │
│                                                                  │
│  Company: AAPL                    Period: FY2024                │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Income Statement                                          │ │
│  │  ┌──────────────┬──────────┬──────────┬──────────────┐   │ │
│  │  │ Metric       │ 2024     │ 2023     │ Confidence   │   │ │
│  │  ├──────────────┼──────────┼──────────┼──────────────┤   │ │
│  │  │ Revenue      │ $394.3B  │ $383.3B  │ 98% ✓        │   │ │
│  │  │ Cost of Rev  │ $210.4B  │ $214.1B  │ 95% ✓        │   │ │
│  │  │ Gross Profit │ $183.9B  │ $169.1B  │ 97% ✓        │   │ │
│  │  │ R&D          │ $29.9B   │ $26.3B   │ 92% ✓        │   │ │
│  │  │ SG&A         │ $24.9B   │ $24.9B   │ 65% ⚠️       │   │ │
│  │  │              │          │          │ [Edit] [Source]│  │ │
│  │  └──────────────┴──────────┴──────────┴──────────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

Legend:
✓ = High confidence (>90%)
⚠️ = Medium confidence (70-90%)
❌ = Low confidence (<70%)
```

---

## Correction Modal

```
┌─────────────────────────────────────────────────────────────┐
│  Correct Metric Value                                  [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Metric:          SG&A Expenses                            │
│  Period:          FY2024                                    │
│                                                             │
│  Original Value:  $24.9B                                    │
│  Confidence:      65% ⚠️                                    │
│                                                             │
│  Corrected Value: [_$25.2B_____________]                   │
│                                                             │
│  Correction Type: [Value Error ▼]                          │
│                   • Value Error (wrong number)             │
│                   • Wrong Metric (misclassified)           │
│                   • Missing Data (not extracted)           │
│                   • Manual Entry (not in filing)           │
│                                                             │
│  Reason:          [_Parser extracted wrong line item___]   │
│                   [_from consolidated statement. Actual_]  │
│                   [_SG&A is on page 42 of 10-K._______]   │
│                                                             │
│  Source Document: [_https://sec.gov/10-K/aapl-2024___]    │
│  Page Number:     [_42_]                                   │
│                                                             │
│  Screenshot:      [Choose File] No file chosen             │
│                   (Optional: Upload screenshot of source)  │
│                                                             │
│  ┌─────────────┐  ┌─────────────────────────────────┐    │
│  │   Cancel    │  │  Submit for Review              │    │
│  └─────────────┘  └─────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## Backend Workflow

```
┌──────────────────────────────────────────────────────────────┐
│                    Correction Workflow                        │
└──────────────────────────────────────────────────────────────┘

1. ANALYST SUBMITS CORRECTION
   ↓
   POST /api/deals/:dealId/metrics/corrections
   {
     normalizedMetric: "sg_and_a",
     fiscalPeriod: "FY2024",
     originalValue: 24900000000,
     correctedValue: 25200000000,
     correctionType: "value_error",
     reason: "Parser extracted wrong line item...",
     sourceUrl: "https://sec.gov/10-K/aapl-2024",
     pageNumber: 42
   }
   ↓
2. SYSTEM CREATES CORRECTION RECORD
   ↓
   INSERT INTO metric_corrections (
     deal_id, normalized_metric, fiscal_period,
     original_value, corrected_value,
     correction_type, reason,
     corrected_by, status
   ) VALUES (
     'deal-123', 'sg_and_a', 'FY2024',
     24900000000, 25200000000,
     'value_error', 'Parser extracted wrong...',
     'user-456', 'pending'
   )
   ↓
3. SYSTEM TRACKS PATTERN
   ↓
   UPSERT INTO correction_patterns (
     ticker, normalized_metric, correction_type,
     occurrence_count
   ) VALUES (
     'AAPL', 'sg_and_a', 'value_error',
     occurrence_count + 1
   )
   ↓
4. SYSTEM NOTIFIES REVIEWERS
   ↓
   Email/Slack: "New correction pending review for AAPL FY2024"
   ↓
5. SENIOR ANALYST REVIEWS
   ↓
   GET /api/deals/:dealId/metrics/corrections
   [Shows list of pending corrections]
   ↓
6. SENIOR ANALYST APPROVES
   ↓
   PATCH /api/deals/:dealId/metrics/corrections/:id/approve
   {
     notes: "Verified against SEC filing page 42"
   }
   ↓
7. SYSTEM APPLIES CORRECTION
   ↓
   UPDATE financial_metrics
   SET value = 25200000000,
       source = 'corrected',
       confidence_score = 100
   WHERE deal_id = 'deal-123'
     AND normalized_metric = 'sg_and_a'
     AND fiscal_period = 'FY2024'
   ↓
8. SYSTEM RECALCULATES DERIVED METRICS
   ↓
   Operating Income = Gross Profit - R&D - SG&A
   = 183.9B - 29.9B - 25.2B = 128.8B
   ↓
9. SYSTEM REVALIDATES FINANCIALS
   ↓
   Run validation checks:
   ✓ Operating Income = Gross Profit - Operating Expenses
   ✓ Net Income = Operating Income - Interest - Taxes
   ↓
10. CORRECTION COMPLETE
    ↓
    UI updates with new value and ✓ indicator
```

---

## Parser Improvement Loop

```
┌──────────────────────────────────────────────────────────────┐
│              Weekly Parser Improvement Process                │
└──────────────────────────────────────────────────────────────┘

MONDAY: Generate Report
   ↓
   SELECT ticker, normalized_metric, correction_type,
          COUNT(*) as occurrences
   FROM correction_patterns
   WHERE parser_fix_applied = false
   GROUP BY ticker, normalized_metric, correction_type
   HAVING COUNT(*) >= 5
   ORDER BY COUNT(*) DESC
   ↓
   Results:
   • AAPL, sg_and_a, value_error: 12 occurrences
   • MSFT, research_and_development, missing_data: 8 occurrences
   • GOOGL, cost_of_revenue, wrong_metric: 6 occurrences

TUESDAY: Create GitHub Issues
   ↓
   For each high-frequency pattern (>5 occurrences):
   
   GitHub Issue #123: "Parser: Fix SG&A extraction for AAPL"
   
   **Occurrences:** 12
   **Metric:** sg_and_a
   **Ticker:** AAPL
   **Type:** value_error
   **Common Reason:** Parser extracts wrong line item from consolidated statement
   
   **Action Required:**
   1. Review XBRL tag mappings for us-gaap:SellingGeneralAndAdministrativeExpense
   2. Test with AAPL 10-K filings from 2022-2024
   3. Update parser logic to handle AAPL's specific table structure
   4. Mark pattern as fixed in database

WEDNESDAY-FRIDAY: Engineering Fixes Parser
   ↓
   1. Review XBRL tag mappings
   2. Add AAPL-specific extraction logic
   3. Test with recent filings
   4. Deploy fix
   ↓
   UPDATE correction_patterns
   SET parser_fix_applied = true,
       fix_applied_at = NOW()
   WHERE ticker = 'AAPL'
     AND normalized_metric = 'sg_and_a'
     AND correction_type = 'value_error'

NEXT WEEK: Verify Fix
   ↓
   Re-parse AAPL filings
   ↓
   If no new corrections for sg_and_a:
   ✓ Fix successful
   
   If new corrections still appearing:
   ❌ Fix incomplete, investigate further
```

---

## Data Flow Diagram

```
┌─────────────┐
│  SEC Filing │
│   (HTML)    │
└──────┬──────┘
       │
       ↓
┌─────────────────┐
│  Hybrid Parser  │
│  (Python)       │
└──────┬──────────┘
       │
       ↓
┌─────────────────────────────────────┐
│  Extracted Metrics                  │
│  • Revenue: $394.3B (98% conf) ✓   │
│  • SG&A: $24.9B (65% conf) ⚠️       │
└──────┬──────────────────────────────┘
       │
       ↓
┌─────────────────┐
│  PostgreSQL DB  │
│  financial_     │
│  metrics table  │
└──────┬──────────┘
       │
       ↓
┌─────────────────────────────────────┐
│  Deal Workspace UI                  │
│  Analyst sees low confidence ⚠️     │
└──────┬──────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────┐
│  Analyst Corrects Value             │
│  $24.9B → $25.2B                    │
│  + Reason + Source                  │
└──────┬──────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────┐
│  metric_corrections table           │
│  (pending review)                   │
└──────┬──────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────┐
│  correction_patterns table          │
│  (tracks frequency)                 │
└──────┬──────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────┐
│  Senior Analyst Approves            │
└──────┬──────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────┐
│  Correction Applied                 │
│  • Update financial_metrics         │
│  • Recalculate derived metrics      │
│  • Revalidate financials            │
└──────┬──────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────┐
│  Weekly Pattern Analysis            │
│  • Generate report                  │
│  • Create GitHub issues             │
│  • Engineering fixes parser         │
└─────────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────┐
│  Improved Parser                    │
│  • Re-parse filings                 │
│  • Higher accuracy                  │
│  • Fewer corrections needed         │
└─────────────────────────────────────┘
```

---

## Permission Matrix

```
┌──────────────────┬─────────┬─────────┬─────────┬─────────┐
│ Action           │ Analyst │ Senior  │ Admin   │ Engineer│
│                  │         │ Analyst │         │         │
├──────────────────┼─────────┼─────────┼─────────┼─────────┤
│ View Metrics     │    ✓    │    ✓    │    ✓    │    ✓    │
│ Create Correction│    ✓    │    ✓    │    ✓    │    ✗    │
│ Approve Correct. │    ✗    │    ✓    │    ✓    │    ✗    │
│ Reject Correct.  │    ✗    │    ✓    │    ✓    │    ✗    │
│ View Patterns    │    ✗    │    ✗    │    ✓    │    ✓    │
│ View Report      │    ✗    │    ✗    │    ✓    │    ✓    │
│ Mark Fix Applied │    ✗    │    ✗    │    ✗    │    ✓    │
└──────────────────┴─────────┴─────────┴─────────┴─────────┘
```

---

## Metrics Dashboard (Admin View)

```
┌─────────────────────────────────────────────────────────────┐
│  Parser Quality Dashboard                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  This Week:                                                 │
│  • Total Corrections: 47                                    │
│  • Pending Review: 12                                       │
│  • Approved: 35                                             │
│  • Rejected: 0                                              │
│                                                             │
│  Top Issues (>5 occurrences):                              │
│  ┌─────────┬──────────────┬──────────┬─────────────────┐  │
│  │ Ticker  │ Metric       │ Count    │ Status          │  │
│  ├─────────┼──────────────┼──────────┼─────────────────┤  │
│  │ AAPL    │ sg_and_a     │ 12       │ [Fix Pending]   │  │
│  │ MSFT    │ r_and_d      │ 8        │ [Fix Pending]   │  │
│  │ GOOGL   │ cost_of_rev  │ 6        │ [Fix Applied]   │  │
│  │ AMZN    │ revenue      │ 5        │ [Fix Pending]   │  │
│  └─────────┴──────────────┴──────────┴─────────────────┘  │
│                                                             │
│  Correction Types:                                          │
│  • Value Error: 28 (60%)                                    │
│  • Missing Data: 12 (25%)                                   │
│  • Wrong Metric: 5 (11%)                                    │
│  • Manual Entry: 2 (4%)                                     │
│                                                             │
│  [Download Full Report] [View GitHub Issues]               │
└─────────────────────────────────────────────────────────────┘
```

---

## Success Metrics

### Week 1 (Baseline)
- Corrections created: 47
- Average confidence: 87%
- Parser accuracy: 85%

### Week 4 (After first fixes)
- Corrections created: 38 (-19%)
- Average confidence: 89% (+2%)
- Parser accuracy: 88% (+3%)

### Week 12 (Mature system)
- Corrections created: 15 (-68%)
- Average confidence: 94% (+7%)
- Parser accuracy: 95% (+10%)

**Result:** Continuous improvement driven by real analyst feedback
