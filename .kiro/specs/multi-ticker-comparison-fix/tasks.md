# Multi-Ticker Comparison Query Fix - Tasks

## Task 1: Fix Peer Comparison Detection

### 1.1 Add Simple Comparison Keywords
- [ ] Update `detectPeerComparisonIntent()` in `src/research/research-assistant.service.ts`
- [ ] Add "compare", " vs ", " vs.", "versus" to peerKeywords array
- [ ] Test with queries: "Compare X and Y", "X vs Y", "X versus Y"

### 1.2 Add Multi-Ticker Pattern Detection
- [ ] Create `hasMultiTickerPattern()` helper method
- [ ] Check for "and" or "," between tickers
- [ ] Only return true if 2+ tickers present
- [ ] Test with queries: "NVDA and MSFT", "AAPL, MSFT, GOOGL"

### 1.3 Update Detection Logic
- [ ] Add `hasMultiTickerPattern` check to detection condition
- [ ] Add logging for detection results
- [ ] Test detection with all query formats

## Task 2: Preserve Multi-Ticker Array

### 2.1 Skip Peer Identification for Explicit Multi-Ticker Queries
- [ ] Check if `tickers.length > 1` before calling `identifyPeersFromDeals()`
- [ ] Use explicit tickers directly when provided
- [ ] Only identify peers when single ticker + peer comparison intent

### 2.2 Build Peer Comparison Metadata for Explicit Queries
- [ ] Set `primaryTicker` to first ticker
- [ ] Set `peersIncluded` to remaining tickers
- [ ] Set `missingPeers` to empty array (no missing peers for explicit queries)

### 2.3 Add Debug Logging
- [ ] Log extracted tickers
- [ ] Log primary ticker
- [ ] Log peer comparison detection result
- [ ] Log tickers array passed to RAG service
- [ ] Log RAG service response metrics

## Task 3: Enhance Bedrock Prompt

### 3.1 Add Explicit Instructions for Peer Comparison
- [ ] Update `buildSystemPrompt()` in `src/rag/bedrock.service.ts`
- [ ] Add instruction: "ALWAYS provide comparative commentary - never return just a chart"
- [ ] Add instruction: "Explain key differences, trends, and insights across companies"

### 3.2 Verify Prompt is Received
- [ ] Add logging to show when `isPeerComparison` flag is set
- [ ] Verify prompt includes peer comparison instructions
- [ ] Test with sample multi-ticker query

## Task 4: Testing

### 4.1 Unit Tests
- [ ] Test `detectPeerComparisonIntent()` with "Compare X and Y"
- [ ] Test `detectPeerComparisonIntent()` with "X vs Y"
- [ ] Test `detectPeerComparisonIntent()` with "X versus Y"
- [ ] Test `hasMultiTickerPattern()` with various formats
- [ ] Test `extractTickers()` with multi-ticker queries

### 4.2 Integration Tests
- [ ] Test full flow: "Compare NVDA and MSFT revenue over the past 3 years"
- [ ] Test full flow: "AAPL vs MSFT revenue over the past 3 years"
- [ ] Test with missing data for one ticker
- [ ] Test with missing data for all tickers
- [ ] Verify response includes table + commentary

### 4.3 Manual Testing in Workspace
- [ ] Test "Compare NVDA and MSFT revenue over the past 3 years" in workspace.html
- [ ] Verify response is NOT blank
- [ ] Verify response includes comparison table
- [ ] Verify response includes comparative commentary
- [ ] Verify charts are accompanied by text analysis

## Task 5: Verification

### 5.1 Check Logs
- [ ] Verify peer comparison detection logs show TRUE for comparison queries
- [ ] Verify tickers array is passed correctly to RAG service
- [ ] Verify structured retrieval queries for all tickers
- [ ] Verify Bedrock receives `isPeerComparison: true`
- [ ] Verify response is generated with comparative format

### 5.2 Check Response Quality
- [ ] Response includes comparison table with metrics for all tickers
- [ ] Response includes comparative commentary
- [ ] Response explains differences and trends
- [ ] Response is NOT blank
- [ ] Response is NOT chart-only

## Task 6: Deployment

### 6.1 Deploy to Development
- [ ] Deploy changes to dev environment
- [ ] Run smoke tests
- [ ] Verify no regressions

### 6.2 Deploy to Production
- [ ] Deploy changes to production
- [ ] Monitor logs for errors
- [ ] Monitor user feedback
- [ ] Verify success metrics

## Success Criteria

- [ ] All test cases pass
- [ ] No blank responses for valid multi-ticker queries
- [ ] Comparative commentary is generated for all comparison queries
- [ ] Charts are accompanied by text analysis
- [ ] Missing data is handled gracefully
- [ ] Response time < 5 seconds for 2-ticker comparisons
