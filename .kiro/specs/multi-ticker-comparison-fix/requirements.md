# Multi-Ticker Comparison Query Fix - Requirements

## Problem Statement

Multi-ticker comparison queries in workspace.html are failing:

**Test Case 1**: "Compare NVDA and MSFT revenue over the past 3 years"
- **Expected**: Deep comparative analysis with metrics table and commentary
- **Actual**: BLANK answer (no response)

**Test Case 2**: "Compare AAPL and MSFT revenue over the past 3 years"  
- **Expected**: Deep comparative analysis with metrics table and commentary
- **Actual**: Chart only, NO commentary

## Root Cause

The `detectPeerComparisonIntent()` method in `research-assistant.service.ts` does NOT detect simple comparison queries like "Compare X and Y" or "X vs Y".

Current detection keywords:
```typescript
const peerKeywords = [
  'peers', 'peer group', 'peer companies',
  'competitors', 'competitor', 'competition',
  'compare to peers', 'compare with peers',  // ❌ Too specific
  'vs peers', 'versus peers',                 // ❌ Too specific
  // ... etc
];
```

**Missing**: Simple comparison keywords like "compare", "vs", "versus" WITHOUT "peers"

## Requirements

### 1. Broaden Peer Comparison Detection

**Acceptance Criteria**:
- Queries with "compare X and Y" should be detected as peer comparison
- Queries with "X vs Y" should be detected as peer comparison  
- Queries with "X versus Y" should be detected as peer comparison
- Queries with multiple tickers (2+) AND comparison keywords should trigger peer comparison flow

### 2. Preserve Multi-Ticker Array Through Pipeline

**Acceptance Criteria**:
- When 2+ tickers are extracted from query, they should be passed as an array to RAG service
- The `tickers` array should NOT be reduced to just `primaryTicker` when peer comparison is detected
- The RAG service should receive `options.tickers` array for multi-ticker retrieval

### 3. Ensure Structured Retrieval for All Tickers

**Acceptance Criteria**:
- Structured retriever should query metrics for ALL tickers in the array
- If ticker A has data but ticker B doesn't, return data for A with a message about B
- If neither ticker has data, return helpful error message

### 4. Generate Comparative Commentary

**Acceptance Criteria**:
- Bedrock should receive `isPeerComparison: true` flag when multiple tickers present
- Response should include:
  - Comparison table with metrics for all tickers
  - Comparative commentary explaining differences
  - Trend analysis if period range specified
- Response should NOT be blank or chart-only

### 5. Handle Missing Data Gracefully

**Acceptance Criteria**:
- If one ticker has no data: Show data for available ticker(s) + message about missing ticker
- If all tickers have no data: Show helpful message about ingesting data
- Never return blank response for valid multi-ticker queries

## Test Cases

### Test Case 1: Simple Two-Ticker Comparison
**Query**: "Compare NVDA and MSFT revenue over the past 3 years"

**Expected**:
```
Revenue Comparison: NVDA vs MSFT (FY2021-FY2024)

| Metric  | NVDA FY2021 | NVDA FY2022 | NVDA FY2023 | NVDA FY2024 |
|---------|-------------|-------------|-------------|-------------|
| Revenue | $X.XB       | $X.XB       | $X.XB       | $X.XB       |

| Metric  | MSFT FY2021 | MSFT FY2022 | MSFT FY2023 | MSFT FY2024 |
|---------|-------------|-------------|-------------|-------------|
| Revenue | $X.XB       | $X.XB       | $X.XB       | $X.XB       |

Analysis:
- NVDA revenue grew X% CAGR vs MSFT's Y% CAGR
- NVDA's growth accelerated in FY2023-2024 due to AI demand
- MSFT maintained steady growth across cloud and productivity segments
...
```

### Test Case 2: VS Format
**Query**: "AAPL vs MSFT revenue over the past 3 years"

**Expected**: Same format as Test Case 1

### Test Case 3: Missing Data for One Ticker
**Query**: "Compare INVALID_TICKER and MSFT revenue"

**Expected**:
```
Data available for MSFT only. No data found for INVALID_TICKER - please ingest their SEC filings.

MSFT Revenue:
- FY2024: $X.XB
- FY2023: $X.XB
...
```

### Test Case 4: Missing Data for All Tickers
**Query**: "Compare INVALID1 and INVALID2 revenue"

**Expected**:
```
No data found for INVALID1, INVALID2. Please ingest their SEC filings first.
```

## Success Criteria

1. All test cases pass
2. No blank responses for valid multi-ticker queries
3. Comparative commentary is generated for all comparison queries
4. Charts are accompanied by text analysis (not chart-only)
5. Missing data is handled gracefully with helpful messages

## Out of Scope

- Peer identification from LLM (already implemented, just not triggered)
- More than 5 tickers in comparison (already capped at 5)
- Cross-industry comparisons (already supported)
