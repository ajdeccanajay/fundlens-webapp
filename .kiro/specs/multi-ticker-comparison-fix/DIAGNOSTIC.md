# Multi-Ticker Comparison Query Failure - Root Cause Analysis

## Problem Statement

Multi-ticker comparison queries are failing in workspace.html:
- **NVDA vs MSFT revenue over past 3 years**: Returns BLANK answer
- **AAPL vs MSFT revenue over past 3 years**: Returns chart only, NO commentary

## Root Cause Analysis

### Issue 1: Peer Comparison Detection Not Triggering

Looking at `research-assistant.service.ts` line 371:

```typescript
const isPeerComparisonQuery = this.detectPeerComparisonIntent(dto.content);

if (isPeerComparisonQuery && primaryTicker) {
  // Peer identification logic
}
```

**Problem**: The detection method `detectPeerComparisonIntent()` looks for keywords like:
- "peers", "competitors", "peer group", etc.

**But the user queries are**:
- "Compare NVDA and MSFT revenue over the past 3 years"
- "Compare AAPL and MSFT revenue over the past 3 years"

These queries contain "compare" but NOT the peer-specific keywords. The detection is failing.

### Issue 2: Multi-Ticker Intent Not Being Set

When peer comparison detection fails, the code falls through to:

```typescript
let tickers = this.extractTickers(dto.content, dto.context?.tickers);
const primaryTicker = tickers[0] || undefined;
```

**Problem**: `extractTickers()` correctly finds both tickers (e.g., ["NVDA", "MSFT"]), but then:
1. Only `primaryTicker` (first ticker) is used
2. The `tickers` array is NOT passed to the RAG service unless peer comparison is detected

### Issue 3: RAG Service Not Receiving Multi-Ticker Array

In `research-assistant.service.ts` line 418:

```typescript
const ragResult = await this.ragService.query(enhancedQuery, {
  ticker: primaryTicker, // Primary ticker for scoping
  tickers: tickers.length > 1 ? tickers : undefined, // Pass peer tickers for multi-ticker retrieval
});
```

**Problem**: This ONLY passes `tickers` array if `tickers.length > 1`, which should work. BUT the issue is that `tickers` was already reduced to just the primary ticker earlier in the flow when peer comparison wasn't detected.

### Issue 4: Bedrock Not Receiving isPeerComparison Flag

In `rag.service.ts` line 467:

```typescript
const isPeerComparison = Array.isArray(intent.ticker) && intent.ticker.length > 1;
const generated = await this.bedrock.generate(query, {
  metrics,
  narratives,
  systemPrompt: options?.systemPrompt,
  modelId,
  isPeerComparison,
  computedSummary,
});
```

**Problem**: The `isPeerComparison` flag is correctly set based on `intent.ticker` being an array with multiple tickers. BUT if the intent detection earlier didn't preserve the multi-ticker array, this will be false.

### Issue 5: Intent Detector Not Preserving Multi-Ticker Array

In `intent-detector.service.ts` line 268:

```typescript
private extractTicker(query: string, contextTicker?: string): string | string[] | undefined {
  const queryTickers = this.extractTickersFromQuery(query);
  
  if (queryTickers.length === 0) {
    return undefined;
  }
  if (queryTickers.length === 1) {
    return queryTickers[0];
  }
  // Multiple tickers found - return array for comparison queries
  this.logger.log(`🔍 Multiple tickers detected: ${queryTickers.join(', ')}`);
  return queryTickers;
}
```

**This looks correct** - it returns an array when multiple tickers are found.

## The Real Bug

After tracing through the code, the issue is in the **peer comparison detection logic**:

1. User asks: "Compare NVDA and MSFT revenue over the past 3 years"
2. `detectPeerComparisonIntent()` returns FALSE (no "peer" keywords)
3. Code extracts tickers: ["NVDA", "MSFT"]
4. BUT then the code doesn't expand the ticker list because peer comparison wasn't detected
5. The `tickers` array IS passed to RAG service (line 418)
6. RAG service receives the array and sets `isPeerComparison = true`
7. BUT the Bedrock prompt might not be handling multi-ticker comparison correctly

## The Missing Piece

Looking at the Bedrock service prompt building (line 732):

```typescript
if (context.isPeerComparison) {
  parts.push('9. PEER COMPARISON FORMAT:');
  parts.push('   - Present financial metrics in a comparison table across all companies');
  parts.push('   - Organize qualitative insights (risks, strategy) by company with cross-company commentary');
}
```

**This should work**, but let's check if the metrics are actually being retrieved for both tickers.

## Hypothesis

The issue is likely in the **structured retrieval** step. When the query is:
- "Compare NVDA and MSFT revenue over the past 3 years"

The intent detector extracts:
- `ticker`: ["NVDA", "MSFT"]
- `metrics`: ["revenue"]
- `period`: range from FY2021 to FY2024

But the structured retriever might be:
1. Only querying for the first ticker
2. Or returning empty results for one/both tickers
3. Or the metrics aren't being found in the database

## Next Steps

1. Check if metrics are being retrieved for BOTH tickers
2. Check if the period range is being handled correctly
3. Check if the Bedrock prompt is receiving the metrics
4. Check if the response is being generated but not streamed correctly

## Quick Fix Strategy

The immediate fix should be:

1. **Broaden peer comparison detection** to include "compare", "vs", "versus" keywords
2. **Ensure multi-ticker array is preserved** through the entire pipeline
3. **Add logging** to trace where the data is being lost
4. **Verify structured retrieval** is querying for all tickers in the array
