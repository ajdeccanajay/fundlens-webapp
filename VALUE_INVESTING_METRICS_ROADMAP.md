# 50 Metrics for Value Investing - Implementation Roadmap

## Overview

This document lists 50 essential metrics commonly used in value investing for US Equity Stocks. These metrics need to be:
1. Added to the Python calculator for computation
2. Added to the metric normalization mapping
3. Recognized by the intent detector
4. Tested with property-based tests

**Status**: 🔴 Not yet implemented (to be added to python calculator)

---

## 1. Cash Flow Metrics (10 metrics)

### Already Implemented ✅
- **Free Cash Flow (FCF)** - Operating cash flow minus capex
- **Operating Cash Flow (OCF)** - Cash generated from operations
- **Capital Expenditure (CapEx)** - Cash spent on fixed assets

### To Be Implemented 🔴

1. **Levered Free Cash Flow** - FCF after interest payments
   - Formula: `FCF - Interest Expense`
   - Use case: Measures cash available to equity holders

2. **Unlevered Free Cash Flow** - FCF before interest payments
   - Formula: `EBIT * (1 - Tax Rate) + D&A - CapEx - Change in NWC`
   - Use case: Enterprise valuation, DCF models

3. **Free Cash Flow to Equity (FCFE)** - Cash available to equity shareholders
   - Formula: `Net Income + D&A - CapEx - Change in NWC + Net Borrowing`
   - Use case: Equity valuation

4. **Free Cash Flow to Firm (FCFF)** - Cash available to all investors
   - Formula: `EBIT * (1 - Tax Rate) + D&A - CapEx - Change in NWC`
   - Use case: Enterprise valuation

5. **Cash Flow Margin** - Operating cash flow as % of revenue
   - Formula: `(Operating Cash Flow / Revenue) * 100`
   - Use case: Efficiency of converting sales to cash

6. **Cash Flow Return on Investment (CFROI)** - Cash return on invested capital
   - Formula: `(Operating Cash Flow - Dividends) / Total Capital`
   - Use case: Measures cash-based returns

7. **Cash Flow to Debt Ratio** - Ability to pay off debt with cash flow
   - Formula: `Operating Cash Flow / Total Debt`
   - Use case: Debt coverage analysis

---

## 2. Valuation Metrics (15 metrics)

### Already Implemented ✅
- **P/E Ratio** - Price to earnings
- **P/B Ratio** - Price to book
- **P/S Ratio** - Price to sales
- **EV/EBITDA** - Enterprise value to EBITDA
- **EV/Sales** - Enterprise value to sales
- **FCF Yield** - Free cash flow yield
- **Dividend Yield** - Dividend per share / price

### To Be Implemented 🔴

8. **PEG Ratio** - P/E to growth ratio
   - Formula: `P/E Ratio / Earnings Growth Rate`
   - Use case: Adjusts P/E for growth

9. **EV/FCF** - Enterprise value to free cash flow
   - Formula: `Enterprise Value / Free Cash Flow`
   - Use case: Cash flow based valuation

10. **Price to Cash Flow (P/CF)** - Price to operating cash flow
    - Formula: `Market Cap / Operating Cash Flow`
    - Use case: Alternative to P/E

11. **Price to Tangible Book (P/TB)** - Price to tangible book value
    - Formula: `Market Cap / (Total Equity - Intangibles)`
    - Use case: Conservative book value metric

12. **EV/EBIT** - Enterprise value to EBIT
    - Formula: `Enterprise Value / EBIT`
    - Use case: Pre-tax valuation metric

13. **Earnings Yield** - Inverse of P/E ratio
    - Formula: `(Earnings Per Share / Price) * 100`
    - Use case: Compare to bond yields

14. **Dividend Payout Ratio** - % of earnings paid as dividends
    - Formula: `(Dividends / Net Income) * 100`
    - Use case: Sustainability of dividends

15. **Shiller P/E (CAPE)** - Cyclically adjusted P/E
    - Formula: `Price / 10-Year Average Inflation-Adjusted Earnings`
    - Use case: Long-term valuation

---

## 3. Profitability Metrics (10 metrics)

### Already Implemented ✅
- **Gross Margin** - Gross profit / revenue
- **Operating Margin** - Operating income / revenue
- **Net Margin** - Net income / revenue
- **ROE** - Return on equity
- **ROA** - Return on assets

### To Be Implemented 🔴

16. **ROIC (Return on Invested Capital)** - Return on total capital
    - Formula: `NOPAT / Invested Capital`
    - Use case: Measures efficiency of capital allocation

17. **ROCE (Return on Capital Employed)** - Return on operating capital
    - Formula: `EBIT / (Total Assets - Current Liabilities)`
    - Use case: Operating efficiency

18. **EBITDA Margin** - EBITDA as % of revenue
    - Formula: `(EBITDA / Revenue) * 100`
    - Use case: Operating profitability before D&A

19. **Pre-Tax Margin** - Pre-tax income / revenue
    - Formula: `(Income Before Tax / Revenue) * 100`
    - Use case: Profitability before tax effects

20. **Asset Turnover Ratio** - Revenue per dollar of assets
    - Formula: `Revenue / Average Total Assets`
    - Use case: Asset efficiency

21. **Return on Tangible Assets (ROTA)** - Return on tangible assets
    - Formula: `EBIT / (Total Assets - Intangibles)`
    - Use case: Conservative ROA

22. **Return on Net Assets (RONA)** - Return on net operating assets
    - Formula: `Net Income / (Fixed Assets + Working Capital)`
    - Use case: Operating asset efficiency

---

## 4. Leverage & Solvency Metrics (8 metrics)

### Already Implemented ✅
- **Total Debt** - Sum of short-term and long-term debt
- **Total Equity** - Shareholders' equity

### To Be Implemented 🔴

23. **Debt to Equity Ratio** - Total debt / total equity
    - Formula: `Total Debt / Total Equity`
    - Use case: Financial leverage

24. **Debt to Assets Ratio** - Total debt / total assets
    - Formula: `Total Debt / Total Assets`
    - Use case: Asset-based leverage

25. **Interest Coverage Ratio** - Ability to pay interest
    - Formula: `EBIT / Interest Expense`
    - Use case: Debt service capacity

26. **Debt Service Coverage Ratio (DSCR)** - Cash available for debt service
    - Formula: `Operating Cash Flow / Total Debt Service`
    - Use case: Loan covenant compliance

27. **Net Debt** - Debt minus cash
    - Formula: `Total Debt - Cash and Equivalents`
    - Use case: Effective debt burden

28. **Net Debt to EBITDA** - Leverage relative to earnings
    - Formula: `Net Debt / EBITDA`
    - Use case: Debt sustainability

29. **Equity Multiplier** - Assets per dollar of equity
    - Formula: `Total Assets / Total Equity`
    - Use case: Financial leverage (DuPont analysis)

30. **Long-Term Debt to Capitalization** - Long-term leverage
    - Formula: `Long-Term Debt / (Long-Term Debt + Total Equity)`
    - Use case: Capital structure analysis

---

## 5. Liquidity Metrics (5 metrics)

### Already Implemented ✅
- **Current Assets** - Short-term assets
- **Current Liabilities** - Short-term liabilities
- **Working Capital** - Current assets - current liabilities

### To Be Implemented 🔴

31. **Current Ratio** - Ability to pay short-term obligations
    - Formula: `Current Assets / Current Liabilities`
    - Use case: Short-term liquidity

32. **Quick Ratio (Acid Test)** - Liquidity excluding inventory
    - Formula: `(Current Assets - Inventory) / Current Liabilities`
    - Use case: Conservative liquidity measure

33. **Cash Ratio** - Most conservative liquidity measure
    - Formula: `Cash and Equivalents / Current Liabilities`
    - Use case: Immediate liquidity

34. **Operating Cash Flow Ratio** - Cash-based liquidity
    - Formula: `Operating Cash Flow / Current Liabilities`
    - Use case: Cash generation vs. obligations

35. **Defensive Interval Ratio** - Days of operations covered by liquid assets
    - Formula: `(Cash + Marketable Securities + Receivables) / Daily Operating Expenses`
    - Use case: Survival period without revenue

---

## 6. Efficiency Metrics (7 metrics)

### Already Implemented ✅
- **Inventory Turnover** - Cost of goods sold / average inventory
- **Receivables Turnover** - Revenue / average receivables
- **Days Sales Outstanding (DSO)** - Average collection period
- **Days Inventory Outstanding (DIO)** - Average inventory holding period
- **Days Payable Outstanding (DPO)** - Average payment period
- **Cash Conversion Cycle (CCC)** - DSO + DIO - DPO

### To Be Implemented 🔴

36. **Fixed Asset Turnover** - Revenue per dollar of fixed assets
    - Formula: `Revenue / Average Fixed Assets`
    - Use case: PP&E efficiency

37. **Total Asset Turnover** - Revenue per dollar of total assets
    - Formula: `Revenue / Average Total Assets`
    - Use case: Overall asset efficiency

38. **Working Capital Turnover** - Revenue per dollar of working capital
    - Formula: `Revenue / Average Working Capital`
    - Use case: Working capital efficiency

39. **Payables Turnover** - How quickly company pays suppliers
    - Formula: `Cost of Goods Sold / Average Accounts Payable`
    - Use case: Supplier payment efficiency

40. **Capital Intensity Ratio** - Assets required per dollar of revenue
    - Formula: `Total Assets / Revenue`
    - Use case: Capital requirements

---

## 7. Growth Metrics (5 metrics)

### To Be Implemented 🔴

41. **Revenue Growth Rate (YoY)** - Year-over-year revenue growth
    - Formula: `((Current Revenue - Prior Revenue) / Prior Revenue) * 100`
    - Use case: Top-line growth

42. **Earnings Growth Rate (YoY)** - Year-over-year earnings growth
    - Formula: `((Current EPS - Prior EPS) / Prior EPS) * 100`
    - Use case: Bottom-line growth

43. **FCF Growth Rate (YoY)** - Year-over-year FCF growth
    - Formula: `((Current FCF - Prior FCF) / Prior FCF) * 100`
    - Use case: Cash generation growth

44. **Book Value Growth Rate** - Growth in shareholders' equity
    - Formula: `((Current Equity - Prior Equity) / Prior Equity) * 100`
    - Use case: Intrinsic value growth

45. **Sustainable Growth Rate** - Growth without external financing
    - Formula: `ROE * (1 - Dividend Payout Ratio)`
    - Use case: Organic growth potential

---

## 8. Quality Metrics (5 metrics)

### To Be Implemented 🔴

46. **Altman Z-Score** - Bankruptcy prediction
    - Formula: `1.2*WC/TA + 1.4*RE/TA + 3.3*EBIT/TA + 0.6*MVE/TL + 1.0*Sales/TA`
    - Use case: Financial distress prediction

47. **Piotroski F-Score** - Financial strength (9-point scale)
    - Components: Profitability, leverage, liquidity, operating efficiency
    - Use case: Value stock screening

48. **Accrual Ratio** - Quality of earnings
    - Formula: `(Net Income - Operating Cash Flow) / Total Assets`
    - Use case: Earnings quality (lower is better)

49. **Quality of Earnings Ratio** - Cash vs. accrual earnings
    - Formula: `Operating Cash Flow / Net Income`
    - Use case: Earnings sustainability (>1 is good)

50. **Reinvestment Rate** - % of earnings reinvested
    - Formula: `(CapEx - Depreciation + Change in NWC) / Net Income`
    - Use case: Growth investment analysis

---

## Implementation Priority

### Phase 1: High Priority (Weeks 1-2)
- Cash flow metrics (1-7)
- Valuation metrics (8-15)
- **Reason**: Most commonly requested by value investors

### Phase 2: Medium Priority (Weeks 3-4)
- Profitability metrics (16-22)
- Leverage metrics (23-30)
- **Reason**: Essential for fundamental analysis

### Phase 3: Lower Priority (Weeks 5-6)
- Liquidity metrics (31-35)
- Efficiency metrics (36-40)
- **Reason**: Important but less frequently requested

### Phase 4: Advanced (Weeks 7-8)
- Growth metrics (41-45)
- Quality metrics (46-50)
- **Reason**: Sophisticated analysis, requires historical data

---

## Technical Implementation Checklist

For each metric, we need to:

- [ ] Add to `python_parser/comprehensive_financial_calculator.py`
- [ ] Add to `python_parser/xbrl_parsing/metric_mapping.yaml`
- [ ] Add to `src/rag/intent-detector.service.ts` metric patterns
- [ ] Add to `src/rag/metric-mapping.service.ts` normalization
- [ ] Create unit tests in `test/unit/`
- [ ] Create property tests in `test/properties/`
- [ ] Update API documentation
- [ ] Add to clarification prompt suggestions

---

## Learning Agent Integration

The `MetricLearningService` will:
1. Track which metrics users request most frequently
2. Prioritize implementation based on demand
3. Log failed queries for analysis
4. Provide graceful failure messages
5. Auto-update when new metrics are added

---

## Notes

- All formulas assume standard accounting conventions
- Some metrics require historical data (3-5 years)
- Industry-specific adjustments may be needed
- Tax rates and other assumptions should be configurable
- Consider adding sector-specific metrics later (e.g., SaaS metrics, retail metrics)

---

**Last Updated**: February 5, 2026
**Status**: Planning phase - ready for implementation
**Owner**: Development team + Learning Agent
