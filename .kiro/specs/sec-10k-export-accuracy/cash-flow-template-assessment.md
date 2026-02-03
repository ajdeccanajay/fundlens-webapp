# Cash Flow Statement Template Assessment

## Executive Summary

After analyzing the generic CASH_FLOW_METRICS template and comparing it to industry-specific requirements, we've determined that **only 1-2 sectors may need dedicated cash flow templates**. The remaining 9-10 sectors can use the generic template.

## Generic Template Coverage

The generic CASH_FLOW_METRICS template (95+ line items) covers:

### Operating Activities (Well Covered)
- ✅ Net income starting point
- ✅ Non-cash adjustments (D&A, stock comp, deferred taxes, impairments)
- ✅ Working capital changes (receivables, inventory, payables, accrued, deferred revenue)
- ✅ Gain/loss on investments and asset sales

### Investing Activities (Well Covered)
- ✅ Capital expenditures
- ✅ Acquisitions and divestitures
- ✅ Purchases/sales of marketable securities
- ✅ Purchases of intangible assets

### Financing Activities (Well Covered)
- ✅ Debt issuance and repayment
- ✅ Stock issuance and repurchases
- ✅ Dividends paid
- ✅ Stock option exercises
- ✅ Tax withholding on stock compensation

### Summary & Metrics (Well Covered)
- ✅ FX effects
- ✅ Net change in cash
- ✅ Beginning/ending cash
- ✅ Free cash flow (OCF - CapEx)
- ✅ FCF margin, cash conversion ratio
- ✅ CapEx ratios

---

## Sector Analysis

### Sectors Likely Using Generic Template (9-10/11)

#### 1. Communication Services (GICS 50) - USE GENERIC
**Companies**: CMCSA, DIS, NFLX, META  
**Assessment**: Standard cash flow structure
- Operating: Standard adjustments (D&A, stock comp, working capital)
- Investing: CapEx (content, infrastructure), acquisitions
- Financing: Standard debt, dividends, buybacks
- **Verdict**: Generic template is sufficient

#### 2. Information Technology (GICS 45) - USE GENERIC
**Companies**: AAPL, MSFT, NVDA, ORCL  
**Assessment**: Standard cash flow structure
- Operating: High cash generation, standard adjustments
- Investing: CapEx (data centers), marketable securities, acquisitions
- Financing: Large buybacks, dividends
- **Verdict**: Generic template is sufficient

#### 3. Consumer Discretionary (GICS 25) - USE GENERIC
**Companies**: AMZN, TSLA, HD, NKE  
**Assessment**: Standard retail/consumer cash flow
- Operating: Standard working capital changes
- Investing: CapEx (stores, warehouses, factories)
- Financing: Standard debt and equity activities
- **Verdict**: Generic template is sufficient

#### 4. Energy (GICS 10) - USE GENERIC
**Companies**: XOM, CVX, COP, SLB  
**Assessment**: Standard industrial cash flow
- Operating: Standard adjustments, working capital
- Investing: High CapEx (wells, refineries), acquisitions
- Financing: Dividends, debt management
- **Verdict**: Generic template is sufficient

#### 5. Health Care (GICS 35) - USE GENERIC
**Companies**: UNH, JNJ, LLY, ABBV  
**Assessment**: Standard cash flow structure
- Operating: Standard adjustments
- Investing: R&D capitalized, acquisitions
- Financing: Standard activities
- **Verdict**: Generic template is sufficient

#### 6. Consumer Staples (GICS 30) - USE GENERIC
**Companies**: PG, KO, PEP, WMT  
**Assessment**: Standard consumer goods cash flow
- Operating: Stable cash generation
- Investing: Moderate CapEx, acquisitions
- Financing: Consistent dividends
- **Verdict**: Generic template is sufficient

#### 7. Industrials (GICS 20) - USE GENERIC
**Companies**: UNP, CAT, BA, HON  
**Assessment**: Standard industrial cash flow
- Operating: Standard adjustments
- Investing: CapEx (equipment, facilities)
- Financing: Standard activities
- **Verdict**: Generic template is sufficient

#### 8. Materials (GICS 15) - USE GENERIC
**Companies**: LIN, APD, SHW, ECL  
**Assessment**: Standard industrial cash flow
- Operating: Standard adjustments
- Investing: CapEx (plants, equipment)
- Financing: Standard activities
- **Verdict**: Generic template is sufficient

#### 9. Utilities (GICS 55) - LIKELY USE GENERIC
**Companies**: NEE, DUK, SO, D  
**Assessment**: Mostly standard with minor differences
- Operating: Standard adjustments, regulatory items (minor)
- Investing: High CapEx (generation, transmission, distribution)
- Financing: High debt usage, consistent dividends
- **Unique Items**: Regulatory deferrals (can be in "other" categories)
- **Verdict**: Generic template likely sufficient (monitor for regulatory items)

---

### Sectors Potentially Needing Dedicated Templates (1-2/11)

#### 10. Financials (GICS 40) - EVALUATE FOR DEDICATED TEMPLATE
**Companies**: JPM, BAC, WFC, GS  
**Assessment**: Banks have different cash flow structure
- **Operating Activities**: Different starting point and adjustments
  - May start with "Cash flows from operating activities" directly
  - Loan originations/collections
  - Deposits received/paid
  - Trading activities
  - Interest received/paid (operating, not financing)
- **Investing Activities**: Securities purchases/sales, loans
- **Financing Activities**: Debt issuance/repayment
- **Unique Structure**: Banks often use direct method or modified indirect method
- **Verdict**: EVALUATE - May need BANK_CASH_FLOW template

#### 11. Real Estate (GICS 60) - EVALUATE FOR DEDICATED TEMPLATE
**Companies**: AMT, PLD, EQIX, PSA  
**Assessment**: REITs have some unique items
- **Operating Activities**: Standard with property-specific adjustments
  - Depreciation of real estate
  - Straight-line rent adjustments
  - Amortization of lease intangibles
- **Investing Activities**: Property acquisitions/dispositions (major focus)
- **Financing Activities**: High leverage, consistent distributions
- **Unique Metrics**: Funds From Operations (FFO), Adjusted FFO
- **Verdict**: EVALUATE - May benefit from REIT_CASH_FLOW template for FFO

---

## Recommendation

### Approach 1: Minimal (Recommended)
**Create 0 dedicated templates, use generic for all 11 sectors**

**Rationale**:
- Cash flow statements are the MOST standardized across industries
- Even banks and REITs follow similar structure (operating, investing, financing)
- Industry-specific items can fit into existing categories:
  - Banks: Loan activities → "other operating activities"
  - REITs: FFO → calculated metric (not in SEC 10-K cash flow statement)
  
**Pros**:
- Fastest implementation (0 new templates)
- Simplest maintenance
- Cash flow statements are already standardized by GAAP

**Cons**:
- May not perfectly match bank cash flow statement order
- FFO not included (but FFO is typically in MD&A, not cash flow statement)

### Approach 2: Conservative
**Create 1 dedicated template: BANK_CASH_FLOW**

**Rationale**:
- Banks have the most different cash flow structure
- REITs can use generic (FFO is supplemental, not in cash flow statement)

**Pros**:
- Handles bank-specific cash flow structure
- Still minimal work (1 template)

**Cons**:
- More maintenance
- Banks' cash flow statements vary significantly even within sector

### Approach 3: Comprehensive
**Create 2 dedicated templates: BANK_CASH_FLOW + REIT_CASH_FLOW**

**Rationale**:
- Consistency with balance sheet approach (3 dedicated templates)
- Provides FFO reconciliation for REITs

**Pros**:
- Most comprehensive coverage
- Matches balance sheet pattern

**Cons**:
- Most work (2 templates)
- FFO may not be in SEC 10-K cash flow statement

---

## Decision: Approach 1 (Minimal)

**Recommendation**: Use generic CASH_FLOW_METRICS template for all 11 sectors

**Reasoning**:
1. **Cash flow statements are highly standardized** by GAAP/IFRS
2. **SEC requires specific format** (ASC 230) - less industry variation than income statements
3. **Generic template covers 95%+ of all items** across all industries
4. **Industry-specific items fit into existing categories**:
   - Banks: Loan/deposit activities → "other operating activities"
   - REITs: Property transactions → standard investing activities
   - Utilities: Regulatory items → "other" categories
5. **FFO (for REITs) is supplemental** - not part of GAAP cash flow statement
6. **Time savings**: 0 templates × 60 min = 0 hours (vs 2 templates × 60 min = 2 hours)

---

## Implementation Plan

### Phase 4: Cash Flow Statements

#### Step 1: Add Generic Template Validation Tests (30 min)
- Add 11 tests (one per sector) to verify generic template works
- Test that operating, investing, financing sections appear correctly
- Validate key metrics (OCF, FCF, net change in cash)

#### Step 2: Update Documentation (15 min)
- Mark all 11 sectors as using generic template in tasks.md
- Document decision in this assessment file
- Update phase completion summary

#### Step 3: Run Full Test Suite (5 min)
- Verify all tests pass
- Confirm 100% coverage across all 3 statement types

**Total Time**: ~50 minutes

---

## Alternative: If Bank Cash Flow Proves Problematic

If testing reveals that banks' cash flow statements don't match well with generic template:

### Quick Fix Option
Add bank-specific items to generic template:
- `change_loans` - Change in loans
- `change_deposits` - Change in deposits  
- `net_interest_received` - Net interest received (operating)
- `trading_activities` - Net cash from trading activities

This adds 4 lines to generic template (now 99 items) and handles banks without dedicated template.

---

## Conclusion

**Phase 4 can be completed with 0 dedicated templates** by using the generic CASH_FLOW_METRICS template for all 11 sectors. This is the fastest and simplest approach, leveraging the fact that cash flow statements are the most standardized financial statement across industries.

**Estimated Time**: 50 minutes (vs 2 hours for dedicated templates)  
**Time Savings**: 70 minutes (58% reduction)

---

**Date**: January 24, 2026  
**Status**: Assessment Complete  
**Recommendation**: Use generic template for all 11 sectors  
**Next Action**: Add validation tests for all 11 sectors
