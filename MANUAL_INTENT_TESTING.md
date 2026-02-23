# FundLens — Manual Intent Detection Test Queries
### Quick-fire testing across all query categories
### Copy-paste each query into the research chat and verify the response.

---

## How to Use
1. Open a workspace for any ticker (AAPL, AMZN, ABNB, etc.)
2. Paste each query into the research assistant chat
3. Check: correct ticker resolved, right metrics, right query type, appropriate response format
4. Mark pass/fail in the checkbox

---

## 1. SINGLE TICKER — Simple Metric Lookups

These should resolve fast with correct structured data.

- [ ] `ABNB revenue FY2024`
- [ ] `NVDA net income latest`
- [ ] `AAPL gross profit Q4 2024`
- [ ] `MSFT operating cash flow FY2024`
- [ ] `TSLA capex FY2024`
- [ ] `META R&D spending FY2024`
- [ ] `GOOGL total debt latest`
- [ ] `AMZN free cash flow FY2024`
- [ ] `COIN EPS FY2024`
- [ ] `BKNG deferred revenue Q3 2024`

---

## 2. ACROSS TICKERS — Two-Company Comparisons

Should produce side-by-side data or grouped bar charts.

- [ ] `AMZN vs MSFT revenue FY2024`
- [ ] `Compare AAPL and NVDA gross margin`
- [ ] `TSLA versus META operating income FY2024`
- [ ] `GOOGL vs AMZN free cash flow last 3 years`
- [ ] `ABNB vs BKNG operating margin FY2024`
- [ ] `How does Apple compare to Microsoft on profitability?`
- [ ] `NVDA vs AMD revenue growth over 3 years`
- [ ] `JPM vs C net interest income`
- [ ] `F vs GM operating margin`
- [ ] `Who has better margins, ABNB or BKNG?`

---

## 3. ACROSS COMPANIES — Multi-Company (3+)

Should handle 3+ tickers gracefully with comparison tables or charts.

- [ ] `Compare AAPL, MSFT, and GOOGL operating margins FY2024`
- [ ] `AMZN vs NVDA vs TSLA revenue growth over 5 years`
- [ ] `Rank ABNB, BKNG, EXPE, and TRIP by operating margin`
- [ ] `AAPL MSFT GOOGL AMZN META revenue FY2024`
- [ ] `Which has the highest gross margin: NVDA, AMD, or INTC?`

---

## 4. PEER / COMPETITOR QUERIES

Should trigger `needs_peer_comparison: true` and pull sector peers.

- [ ] `How does ABNB compare to its peers on margins?`
- [ ] `NVDA vs competitors in revenue growth`
- [ ] `MSFT relative to industry peers on profitability`
- [ ] `Is EXPE underperforming its peers?`
- [ ] `Benchmark ABNB's take rate against online travel peers`
- [ ] `How does JPM's net interest margin compare to large bank peers?`
- [ ] `AAPL vs tech sector on capital allocation`
- [ ] `How does Tesla stack up against its comps?`
- [ ] `GOOGL industry peer comparison on margins`
- [ ] `Compare ABNB to peers on revenue growth, margins, and free cash flow`

---

## 5. PROVOCATIVE / OPINION-SEEKING QUERIES

Should trigger `needs_narrative: true` and often `sentiment` query type.

- [ ] `Is NVDA a bubble?`
- [ ] `Bull case for ABNB`
- [ ] `Bear case for Tesla`
- [ ] `Why would someone short META?`
- [ ] `Is Amazon wasting money on Alexa?`
- [ ] `Red flags in COIN's financials`
- [ ] `Is TSLA's growth sustainable or is it hype?`
- [ ] `What could disrupt NVDA's dominance?`
- [ ] `Is Apple's best days behind it?`
- [ ] `Should I be worried about AMZN's margins?`
- [ ] `Is MSFT overpaying for AI acquisitions?`
- [ ] `What's the biggest risk to GOOGL's ad business?`

---

## 6. SENTIMENT / TONE QUERIES

Should classify as `sentiment` query type with narrative retrieval.

- [ ] `What is the sentiment on TSLA right now?`
- [ ] `Tone of NVDA's latest earnings call`
- [ ] `Is management at META optimistic or cautious?`
- [ ] `How did the market react to AAPL's last earnings?`
- [ ] `What's the mood around AMZN's AWS growth?`
- [ ] `Is ABNB management credible?`
- [ ] `Analyst sentiment on GOOGL`
- [ ] `Did MSFT's CEO sound confident about AI?`

---

## 7. COMPLEX / CONCEPT ANALYSIS QUERIES

Should trigger `concept_analysis` with multiple derived metrics.

- [ ] `How levered is Apple?`
- [ ] `Assess MSFT's profitability`
- [ ] `How liquid is Tesla?`
- [ ] `What's NVDA's earnings quality?`
- [ ] `AMZN capital allocation strategy`
- [ ] `Is GOOGL's growth structural or cyclical?`
- [ ] `ABNB credit profile`
- [ ] `What's AAPL's competitive moat?`
- [ ] `How efficient is Amazon's operations?`
- [ ] `TSLA margin of safety analysis`

---

## 8. NARRATIVE / QUALITATIVE QUERIES

Should trigger `needs_narrative: true` and pull 10-K/10-Q sections.

- [ ] `What are AMZN's key risk factors from their latest 10-K?`
- [ ] `What did NVDA management say about supply chain?`
- [ ] `AAPL management discussion and analysis`
- [ ] `What guidance did MSFT provide for next quarter?`
- [ ] `How does ABNB describe its competitive position?`
- [ ] `What regulatory risks does Citigroup face?`
- [ ] `META's capital allocation strategy from the 10-K`
- [ ] `What is GOOGL's revenue recognition policy?`
- [ ] `TSLA legal proceedings`
- [ ] `What did Apple's CEO say about AI?`

---

## 9. TREND / TIME SERIES QUERIES

Should produce line charts with chronological data.

- [ ] `ABNB revenue over the past 5 years`
- [ ] `NVDA net income trend last 3 years`
- [ ] `AAPL free cash flow trend last decade`
- [ ] `MSFT operating margin year over year`
- [ ] `AMZN revenue quarter over quarter`
- [ ] `TSLA revenue from 2021 to 2024`
- [ ] `GOOGL capex trend`
- [ ] `What is MSFT's 5-year revenue CAGR?`
- [ ] `Is NVDA's revenue growth accelerating or decelerating?`
- [ ] `ABNB revenue, EBITDA, and free cash flow trend over 4 years`

---

## 10. EDGE CASES — Ticker Resolution

Tricky tickers, company names, anti-patterns.

- [ ] `What is C's revenue?` → should resolve to Citigroup, not the letter C
- [ ] `V's latest quarterly earnings` → Visa
- [ ] `F operating income` → Ford
- [ ] `X revenue and EBITDA` → United States Steel
- [ ] `abnb revenue` → lowercase should still resolve to ABNB
- [ ] `Google's operating income FY2024` → GOOGL
- [ ] `Facebook revenue` → META
- [ ] `Alphabet revenue trend` → GOOGL
- [ ] `Citi leverage analysis` → C (Citigroup)
- [ ] `Airbnb (ABNB) revenue trend` → single entity, not duplicate

---

## 11. EDGE CASES — Anti-Pattern Extraction

These words should NOT be extracted as tickers.

- [ ] `GAAP vs non-GAAP operating income for MSFT` → GAAP is not a ticker
- [ ] `What is EBITDA for ABNB?` → EBITDA is not a ticker
- [ ] `What did the CEO say about revenue growth?` → CEO is not a ticker
- [ ] `AAPL revenue FY2024` → FY is not a ticker
- [ ] `What did the 10-K say about risks?` → K is not a ticker
- [ ] `What's in the 10-Q?` → Q is not a ticker
- [ ] `AAPL PE ratio` → PE is not a ticker
- [ ] `MSFT ROE over 5 years` → ROE is not a ticker

---

## 12. EDGE CASES — Ambiguous / Incomplete Queries

Should trigger clarification or graceful fallback.

- [ ] `Tell me about Tesla` → vague, should ask what specifically
- [ ] `AAPL` → ticker only, no intent
- [ ] `revenue` → no ticker specified
- [ ] `What's happening in tech?` → too vague
- [ ] `Compare` → incomplete
- [ ] `How is the market doing?` → no specific ticker

---

## 13. COMPUTED METRICS — Ratios & Derived

Should flag `needs_computation: true`.

- [ ] `ABNB gross margin FY2024`
- [ ] `MSFT ROIC`
- [ ] `AAPL debt-to-equity ratio`
- [ ] `NVDA EV/EBITDA`
- [ ] `TSLA current ratio`
- [ ] `AMZN return on equity`
- [ ] `GOOGL free cash flow margin`
- [ ] `C net debt to EBITDA`
- [ ] `What are ABNB's margins?` → should expand to gross/operating/net
- [ ] `AAPL P/E ratio`

---

## 14. HYBRID QUERIES — Structured + Narrative

Should pull both metrics AND qualitative context.

- [ ] `How is Apple's profitability trending and what's driving it?`
- [ ] `NVDA revenue growth — what's driving the acceleration?`
- [ ] `Is AMZN's margin expansion sustainable?`
- [ ] `What's behind MSFT's operating leverage improvement?`
- [ ] `TSLA capex — what are they investing in?`
- [ ] `Why is GOOGL's operating margin declining?`
- [ ] `ABNB take rate trend and what management says about it`
- [ ] `Is NVDA's growth sustainable compared to AMD?`

---

## 15. SUBSIDIARY / SEGMENT QUERIES

Should resolve to parent ticker.

- [ ] `AWS revenue FY2024` → AMZN
- [ ] `Azure revenue growth` → MSFT
- [ ] `YouTube ad revenue` → GOOGL
- [ ] `Instagram user growth` → META
- [ ] `Google Cloud revenue trend` → GOOGL
- [ ] `Amazon Web Services operating margin` → AMZN

---

## Scoring Summary

| Category | Total | Pass | Fail | % |
|----------|-------|------|------|---|
| 1. Single Ticker | 10 | | | |
| 2. Across Tickers (2) | 10 | | | |
| 3. Across Companies (3+) | 5 | | | |
| 4. Peer/Competitor | 10 | | | |
| 5. Provocative | 12 | | | |
| 6. Sentiment/Tone | 8 | | | |
| 7. Concept Analysis | 10 | | | |
| 8. Narrative/Qualitative | 10 | | | |
| 9. Trend/Time Series | 10 | | | |
| 10. Ticker Resolution | 10 | | | |
| 11. Anti-Patterns | 8 | | | |
| 12. Ambiguous/Incomplete | 6 | | | |
| 13. Computed Metrics | 10 | | | |
| 14. Hybrid | 8 | | | |
| 15. Subsidiary/Segment | 6 | | | |
| **TOTAL** | **133** | | | |

Target: ≥90% overall pass rate across all categories.
