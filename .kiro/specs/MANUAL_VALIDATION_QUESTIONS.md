# FundLens RAG Manual Validation Questions

Comprehensive test suite covering all intent detection paths, query types, edge cases, and analytical concepts. Use these to validate end-to-end RAG answers against a specific ticker (default: AAPL, NVDA, AMZN, MSFT).

---

## 1. Simple Structured Queries (Regex Fast-Path — should resolve without LLM)

These should hit Layer 1 (regex fast-path) with confidence ≥ 0.9.

| # | Query | Expected Type | Expected Metrics | Expected Period |
|---|-------|--------------|-----------------|----------------|
| 1.1 | `AAPL revenue FY2024` | structured | revenue | FY2024 |
| 1.2 | `NVDA net income FY2024` | structured | net_income | FY2024 |
| 1.3 | `MSFT gross profit FY2023` | structured | gross_profit | FY2023 |
| 1.4 | `AMZN operating income FY2024` | structured | operating_income | FY2024 |
| 1.5 | `AAPL free cash flow FY2024` | structured | fcf | FY2024 |
| 1.6 | `TSLA ebitda FY2024` | structured | ebitda | FY2024 |
| 1.7 | `GOOGL total debt FY2024` | structured | total_debt | FY2024 |
| 1.8 | `META R&D FY2024` | structured | r_and_d | FY2024 |
| 1.9 | `NVDA gross margin FY2024` | structured | gross_margin_pct | FY2024 |
| 1.10 | `AAPL operating cash flow FY2024` | structured | operating_cash_flow | FY2024 |

**What to validate:** Fast response (<100ms), correct metric value, correct period, no LLM invocation.

---

## 2. Period Variations

| # | Query | Expected Period Resolution |
|---|-------|--------------------------|
| 2.1 | `AAPL revenue latest` | period: "latest" |
| 2.2 | `NVDA revenue Q4-2024` | period: "Q4-2024" |
| 2.3 | `MSFT revenue last 3 years` | periodStart: FY2023, periodEnd: FY2026 (range) |
| 2.4 | `AMZN revenue last 5 years` | periodStart: FY2021, periodEnd: FY2026 (range) |
| 2.5 | `AAPL revenue over the past decade` | periodStart: FY2016, periodEnd: FY2026 (range) |
| 2.6 | `NVDA revenue year over year` | range with needsTrend: true |
| 2.7 | `TSLA revenue 2023` | period: "FY2023" |
| 2.8 | `GOOGL revenue Q3 2024` | period: "Q3-2024" |
| 2.9 | `AAPL revenue most recent` | period: "latest" |
| 2.10 | `MSFT revenue current` | period: "latest" |

---

## 3. Company Name Resolution (LLM Layer)

These use company names instead of tickers — should resolve via LLM.

| # | Query | Expected Ticker |
|---|-------|----------------|
| 3.1 | `Apple revenue FY2024` | AAPL |
| 3.2 | `Microsoft gross margin FY2024` | MSFT |
| 3.3 | `Amazon operating income FY2024` | AMZN |
| 3.4 | `Nvidia net income FY2024` | NVDA |
| 3.5 | `Tesla free cash flow FY2024` | TSLA |
| 3.6 | `Google revenue FY2024` | GOOGL |
| 3.7 | `Meta R&D spending FY2024` | META |
| 3.8 | `Alphabet revenue FY2024` | GOOGL |
| 3.9 | `Facebook operating margin FY2024` | META |

---

## 4. Subsidiary/Segment → Parent Ticker Mapping

| # | Query | Expected Ticker | Notes |
|---|-------|----------------|-------|
| 4.1 | `AWS revenue FY2024` | AMZN | Subsidiary → parent |
| 4.2 | `Azure revenue growth FY2024` | MSFT | Subsidiary → parent |
| 4.3 | `YouTube ad revenue FY2024` | GOOGL | Subsidiary → parent |
| 4.4 | `Instagram user growth` | META | Subsidiary → parent |
| 4.5 | `iCloud revenue` | AAPL | Subsidiary → parent |
| 4.6 | `Google Cloud revenue trend` | GOOGL | Subsidiary → parent |
| 4.7 | `WhatsApp monetization strategy` | META | Subsidiary → parent |
| 4.8 | `Amazon Web Services operating margin` | AMZN | Full subsidiary name |

---

## 5. Multi-Ticker Comparison Queries

| # | Query | Expected Tickers | Expected Flags |
|---|-------|-----------------|---------------|
| 5.1 | `Compare NVDA and MSFT gross margin` | [NVDA, MSFT] | needsComparison, needsPeerComparison |
| 5.2 | `AAPL vs MSFT revenue FY2024` | [AAPL, MSFT] | needsComparison, needsPeerComparison |
| 5.3 | `AMZN vs GOOGL operating income last 3 years` | [AMZN, GOOGL] | needsComparison, needsTrend |
| 5.4 | `Compare AAPL, MSFT, and GOOGL operating margins over the last 3 years` | [AAPL, MSFT, GOOGL] | needsComparison, needsTrend, needsPeerComparison |
| 5.5 | `How does NVDA stack up against AMD in revenue growth?` | [NVDA, AMD] | needsComparison, needsPeerComparison |
| 5.6 | `TSLA versus NKE net margin` | [TSLA, NKE] | needsComparison |
| 5.7 | `AMZN and MSFT capex compared` | [AMZN, MSFT] | needsComparison |
| 5.8 | `Revenue comparison between Apple and Microsoft` | [AAPL, MSFT] | needsComparison (company names) |
| 5.9 | `Who has better margins, NVDA or AMD?` | [NVDA, AMD] | needsComparison, needsPeerComparison |
| 5.10 | `AAPL MSFT GOOGL AMZN revenue FY2024` | [AAPL, MSFT, GOOGL, AMZN] | needsComparison (4 tickers) |

**What to validate:** Grouped bar chart generated, all tickers present, correct metric values for each.

---

## 6. Peer/Competitor Queries (Single Ticker + Peer Intent)

| # | Query | Expected Ticker | Expected Flags |
|---|-------|----------------|---------------|
| 6.1 | `How does AAPL compare to its peers in profitability?` | AAPL | needsPeerComparison |
| 6.2 | `NVDA vs competitors in revenue growth` | NVDA | needsPeerComparison |
| 6.3 | `Show me MSFT relative to industry peers` | MSFT | needsPeerComparison |
| 6.4 | `AMZN comparable companies analysis` | AMZN | needsPeerComparison |
| 6.5 | `How does Tesla stack up against its comps?` | TSLA | needsPeerComparison |
| 6.6 | `GOOGL industry peer comparison on margins` | GOOGL | needsPeerComparison, needsComputation |

---

## 7. Trend Queries

| # | Query | Expected Flags | Expected Period |
|---|-------|---------------|----------------|
| 7.1 | `AAPL revenue trend over the last 5 years` | needsTrend | FY2021–FY2026 range |
| 7.2 | `NVDA net income over time` | needsTrend | range |
| 7.3 | `MSFT gross margin year over year` | needsTrend | range |
| 7.4 | `AMZN operating income historical` | needsTrend | range |
| 7.5 | `TSLA revenue 3-year trend` | needsTrend | 3-year range |
| 7.6 | `Is NVDA's revenue growth accelerating or decelerating?` | needsTrend, needsComputation | range |
| 7.7 | `AAPL free cash flow trend last decade` | needsTrend | 10-year range |
| 7.8 | `Show me MSFT capex trend` | needsTrend | range |

**What to validate:** Line chart generated, chronological data points, correct trend direction.

---

## 8. Competitive Peer Trend Comparisons (Multi-Ticker + Trend)

| # | Query | Expected Tickers | Expected Flags |
|---|-------|-----------------|---------------|
| 8.1 | `Is Amazon's AWS growth decelerating relative to Azure?` | [AMZN, MSFT] | needsTrend, needsComparison, needsPeerComparison |
| 8.2 | `NVDA vs AMD revenue growth over the last 3 years` | [NVDA, AMD] | needsTrend, needsComparison |
| 8.3 | `Compare AAPL and MSFT operating margin trends` | [AAPL, MSFT] | needsTrend, needsComparison |
| 8.4 | `How has GOOGL's revenue growth compared to META over 5 years?` | [GOOGL, META] | needsTrend, needsComparison |
| 8.5 | `AMZN vs MSFT vs GOOGL cloud revenue trend` | [AMZN, MSFT, GOOGL] | needsTrend, needsComparison |
| 8.6 | `Which is growing faster, NVDA or AAPL?` | [NVDA, AAPL] | needsTrend, needsComparison |

**What to validate:** Multi-series line chart, all tickers on same axis, correct trend data.

---

## 9. Qualitative / Narrative Queries (Semantic)

| # | Query | Expected Type | Expected Section |
|---|-------|--------------|-----------------|
| 9.1 | `What are AMZN's key risk factors from their latest 10-K?` | semantic | item_1a |
| 9.2 | `AAPL management discussion and analysis` | semantic | item_7 |
| 9.3 | `NVDA business description` | semantic | item_1 |
| 9.4 | `MSFT legal proceedings` | semantic | item_3 |
| 9.5 | `TSLA accounting policies` | semantic | item_8 |
| 9.6 | `GOOGL properties and facilities` | semantic | item_2 |
| 9.7 | `What did Apple's CEO say about AI in the latest earnings call?` | semantic | earnings_call |
| 9.8 | `AMZN executive compensation from proxy statement` | semantic | item_11, DEF 14A |
| 9.9 | `NVDA risk factors related to supply chain` | semantic | item_1a |
| 9.10 | `What is MSFT's revenue recognition policy?` | semantic | item_8 |

**What to validate:** Narrative response with citations, correct section referenced, relevant content.

---

## 10. Hybrid Queries (Structured + Semantic)

| # | Query | Expected Type | Notes |
|---|-------|--------------|-------|
| 10.1 | `How is Apple's profitability trending and what's driving it?` | hybrid | Needs metrics + narrative |
| 10.2 | `NVDA revenue growth — what's driving the acceleration?` | hybrid | Metrics + MD&A context |
| 10.3 | `Is AMZN's margin expansion sustainable?` | hybrid | Margin data + narrative analysis |
| 10.4 | `What's behind MSFT's operating leverage improvement?` | hybrid | Operating metrics + narrative |
| 10.5 | `TSLA capex — what are they investing in?` | hybrid | Capex data + narrative |
| 10.6 | `Why is GOOGL's operating margin declining?` | hybrid | Margin trend + narrative explanation |

---

## 11. Analytical Concept Queries

### 11.1 Leverage
| # | Query | Expected conceptMatch |
|---|-------|--------------------|
| 11.1.1 | `How levered is Apple?` | leverage |
| 11.1.2 | `What's NVDA's debt situation?` | leverage |
| 11.1.3 | `AMZN capital structure analysis` | leverage |
| 11.1.4 | `Is Tesla overleveraged?` | leverage |
| 11.1.5 | `MSFT debt-to-equity and interest coverage` | leverage |
| 11.1.6 | `How much debt does Google have?` | leverage |

### 11.2 Profitability
| # | Query | Expected conceptMatch |
|---|-------|--------------------|
| 11.2.1 | `What's Apple's profitability profile?` | profitability |
| 11.2.2 | `How profitable is NVDA?` | profitability |
| 11.2.3 | `AMZN margin analysis` | profitability |
| 11.2.4 | `Is MSFT's margin expanding or compressing?` | profitability |
| 11.2.5 | `TSLA earnings power` | profitability |
| 11.2.6 | `GOOGL return on capital` | profitability |

### 11.3 Liquidity
| # | Query | Expected conceptMatch |
|---|-------|--------------------|
| 11.3.1 | `How liquid is Tesla?` | liquidity |
| 11.3.2 | `AAPL cash position and working capital` | liquidity |
| 11.3.3 | `Can AMZN pay its bills?` | liquidity |
| 11.3.4 | `NVDA cash runway` | liquidity |
| 11.3.5 | `MSFT current ratio and quick ratio` | liquidity |

### 11.4 Capital Allocation
| # | Query | Expected conceptMatch |
|---|-------|--------------------|
| 11.4.1 | `How does Meta allocate capital?` | capital_allocation |
| 11.4.2 | `AAPL buybacks and dividends` | capital_allocation |
| 11.4.3 | `What is MSFT doing with its cash?` | capital_allocation |
| 11.4.4 | `AMZN shareholder returns` | capital_allocation |
| 11.4.5 | `GOOGL capital deployment strategy` | capital_allocation |

### 11.5 Earnings Quality
| # | Query | Expected conceptMatch |
|---|-------|--------------------|
| 11.5.1 | `AAPL earnings quality assessment` | earnings_quality |
| 11.5.2 | `Is NVDA's earnings growth sustainable?` | earnings_quality |
| 11.5.3 | `AMZN cash conversion vs reported earnings` | earnings_quality |
| 11.5.4 | `Any accounting red flags at TSLA?` | earnings_quality |
| 11.5.5 | `MSFT accruals and revenue recognition risk` | earnings_quality |

### 11.6 Valuation
| # | Query | Expected conceptMatch |
|---|-------|--------------------|
| 11.6.1 | `Is NVDA expensive?` | valuation |
| 11.6.2 | `AAPL valuation multiples` | valuation |
| 11.6.3 | `What multiple is AMZN trading at?` | valuation |
| 11.6.4 | `Is MSFT overvalued or undervalued?` | valuation |
| 11.6.5 | `GOOGL EV/EBITDA and P/E` | valuation |
| 11.6.6 | `How cheap is META?` | valuation |

### 11.7 Growth
| # | Query | Expected conceptMatch |
|---|-------|--------------------|
| 11.7.1 | `How fast is NVDA growing?` | growth |
| 11.7.2 | `AAPL growth trajectory` | growth |
| 11.7.3 | `Is AMZN's growth decelerating?` | growth |
| 11.7.4 | `MSFT organic growth rate` | growth |
| 11.7.5 | `TSLA growth outlook` | growth |

### 11.8 Efficiency
| # | Query | Expected conceptMatch |
|---|-------|--------------------|
| 11.8.1 | `How efficient is AMZN's operations?` | efficiency |
| 11.8.2 | `AAPL working capital efficiency` | efficiency |
| 11.8.3 | `MSFT asset utilization` | efficiency |
| 11.8.4 | `NVDA cash conversion cycle` | efficiency |

### 11.9 Downside Protection
| # | Query | Expected conceptMatch |
|---|-------|--------------------|
| 11.9.1 | `What's the downside risk for AAPL?` | downside_protection |
| 11.9.2 | `How safe is MSFT's balance sheet?` | downside_protection |
| 11.9.3 | `NVDA margin of safety analysis` | downside_protection |
| 11.9.4 | `What could go wrong with AMZN?` | downside_protection |
| 11.9.5 | `TSLA worst case scenario` | downside_protection |

### 11.10 Management Alignment
| # | Query | Expected conceptMatch |
|---|-------|--------------------|
| 11.10.1 | `Does AAPL management have skin in the game?` | management_alignment |
| 11.10.2 | `NVDA insider ownership` | management_alignment |
| 11.10.3 | `MSFT executive compensation structure` | management_alignment |
| 11.10.4 | `Is AMZN management aligned with shareholders?` | management_alignment |
| 11.10.5 | `TSLA governance quality` | management_alignment |

---

## 12. Computed / Derived Metric Queries

| # | Query | Expected Metrics | needsComputation |
|---|-------|-----------------|-----------------|
| 12.1 | `AAPL gross margin FY2024` | gross_margin_pct | true |
| 12.2 | `NVDA operating margin FY2024` | operating_margin_pct | true |
| 12.3 | `MSFT net margin FY2024` | net_margin_pct | true |
| 12.4 | `AMZN return on equity` | roe | true |
| 12.5 | `TSLA debt-to-equity ratio` | debt_to_equity | true |
| 12.6 | `GOOGL interest coverage ratio` | interest_coverage | true |
| 12.7 | `AAPL current ratio` | current_ratio | true |
| 12.8 | `NVDA EV/EBITDA` | ev_to_ebitda | true |
| 12.9 | `MSFT free cash flow yield` | fcf_yield_pct | true |
| 12.10 | `AMZN ROIC` | roic | true |

---

## 13. Edge Cases & Ambiguity

| # | Query | Expected Behavior |
|---|-------|------------------|
| 13.1 | `Tell me about Tesla` | needsClarification: true, low confidence |
| 13.2 | `AAPL` | needsClarification: true (ticker only, no intent) |
| 13.3 | `revenue` | No ticker — should ask for clarification or use context ticker |
| 13.4 | `What's happening in tech?` | No ticker, vague — needsClarification: true |
| 13.5 | `Compare` | Incomplete — needsClarification: true |
| 13.6 | `AAPL 10-K` | Vague — what about the 10-K? needsClarification: true |
| 13.7 | `How is the market doing?` | No specific ticker — semantic fallback |
| 13.8 | `NVDA MSFT AAPL GOOGL META AMZN TSLA revenue` | 7 tickers — should handle gracefully |
| 13.9 | `What's AAPL's revenue in euros?` | Should still resolve, currency is display concern |
| 13.10 | `AAPL revenue growth rate for Q4 2024 compared to Q4 2023` | Quarter-over-quarter comparison |

---

## 14. Filing Type Edge Cases

| # | Query | Expected documentTypes |
|---|-------|----------------------|
| 14.1 | `AAPL 10-K risk factors` | ["10-K"], sectionTypes: ["item_1a"] |
| 14.2 | `NVDA 10-Q quarterly results` | ["10-Q"], sectionTypes: ["item_2_10q"] |
| 14.3 | `MSFT proxy statement executive comp` | ["DEF 14A"], sectionTypes: ["item_11"] |
| 14.4 | `AMZN latest earnings call transcript` | ["earnings_call"] |
| 14.5 | `TSLA 8-K filing` | ["8-K"] |

---

## 15. Context Ticker Queries (Workspace Context)

Test these while viewing a specific ticker's workspace page.

| # | Query (while viewing AAPL) | Expected Behavior |
|---|---------------------------|-------------------|
| 15.1 | `What's the revenue?` | Should use AAPL as context ticker |
| 15.2 | `Show me the margins` | Should use AAPL, resolve margin metrics |
| 15.3 | `Compare with MSFT` | Should merge: [AAPL, MSFT] |
| 15.4 | `How does it compare to peers?` | AAPL + needsPeerComparison |
| 15.5 | `Risk factors` | AAPL + semantic, item_1a |
| 15.6 | `Revenue trend` | AAPL + needsTrend |

---

## 16. Ticker Extraction Edge Cases (Anti-Patterns)

| # | Query | Should NOT extract as ticker |
|---|-------|----------------------------|
| 16.1 | `Show me the 10-K filing` | K is NOT a ticker |
| 16.2 | `What's in the 10-Q?` | Q is NOT a ticker |
| 16.3 | `8-K filing details` | K is NOT a ticker |
| 16.4 | `Item 1A risk factors` | A is NOT a ticker |
| 16.5 | `Section 7 MD&A` | No ticker extraction from section numbers |

---

## 17. Visualization Validation

| # | Query | Expected Chart Type |
|---|-------|-------------------|
| 17.1 | `AAPL revenue trend last 5 years` | line chart |
| 17.2 | `Compare NVDA and AMD gross margin` | grouped bar chart |
| 17.3 | `MSFT revenue breakdown by segment` | stacked bar |
| 17.4 | `AAPL, MSFT, GOOGL revenue FY2024` | grouped bar |
| 17.5 | `NVDA vs AMD revenue trend 3 years` | multi-series line chart |
| 17.6 | `What are AMZN's risk factors?` | no chart (narrative only) |
| 17.7 | `How levered is Apple?` | table (concept profile) |

---

## 18. Cross-Concept Competitive Questions

These combine multiple analytical dimensions with peer comparison.

| # | Query | Expected Behavior |
|---|-------|------------------|
| 18.1 | `How liquid is Tesla compared to Ford?` | [TSLA, F], conceptMatch: liquidity, needsComparison |
| 18.2 | `Compare NVDA and AMD on profitability and growth` | [NVDA, AMD], multiple concepts |
| 18.3 | `Which is more levered, AAPL or MSFT?` | [AAPL, MSFT], conceptMatch: leverage, needsComparison |
| 18.4 | `AMZN vs GOOGL capital allocation strategy` | [AMZN, GOOGL], conceptMatch: capital_allocation |
| 18.5 | `Who has better earnings quality, NVDA or AMD?` | [NVDA, AMD], conceptMatch: earnings_quality |
| 18.6 | `Compare valuation multiples across AAPL, MSFT, GOOGL, and AMZN` | 4 tickers, conceptMatch: valuation |
| 18.7 | `Is NVDA's growth sustainable compared to AMD?` | [NVDA, AMD], growth + comparison |
| 18.8 | `How does Meta's capital allocation compare to its peers?` | META, needsPeerComparison, capital_allocation |

---

## Scoring Rubric

For each question, evaluate:

1. **Intent Detection** (pass/fail): Did the system correctly classify the query type, flags, tickers, and metrics?
2. **Data Retrieval** (pass/fail): Did the system retrieve the correct data (structured metrics and/or narrative chunks)?
3. **Answer Quality** (1-5): Is the generated answer accurate, relevant, and well-structured?
4. **Visualization** (pass/fail/N/A): Was the correct chart type generated with accurate data?
5. **Latency** (ms): Response time — fast-path should be <100ms, LLM queries <2s.
6. **Citations** (pass/fail): Are sources properly cited with filing references?

### Target Pass Rates
- Section 1 (Simple Structured): 100%
- Section 5 (Multi-Ticker): ≥ 90%
- Section 9 (Narrative): ≥ 85%
- Section 11 (Concepts): ≥ 90%
- Section 13 (Edge Cases): ≥ 80%
- Section 18 (Cross-Concept Competitive): ≥ 85%
