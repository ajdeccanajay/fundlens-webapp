# Multi-Ticker Comparison Query Fix - Design

## Overview

Fix the peer comparison detection logic to handle simple multi-ticker comparison queries like "Compare X and Y" or "X vs Y" that don't explicitly mention "peers" or "competitors".

## Architecture

### Current Flow (Broken)

```
User Query: "Compare NVDA and MSFT revenue"
    ↓
detectPeerComparisonIntent() → FALSE ❌ (no "peers" keyword)
    ↓
extractTickers() → ["NVDA", "MSFT"] ✅
    ↓
primaryTicker = "NVDA" ✅
    ↓
tickers array NOT expanded (peer comparison not detected) ❌
    ↓
RAG service receives: ticker="NVDA", tickers=["NVDA", "MSFT"]
    ↓
Structured retrieval: Queries for both tickers ✅
    ↓
Bedrock generation: isPeerComparison=true ✅
    ↓
BUT: Response is blank or chart-only ❌
```

### Fixed Flow

```
User Query: "Compare NVDA and MSFT revenue"
    ↓
detectPeerComparisonIntent() → TRUE ✅ (detects "compare")
    ↓
extractTickers() → ["NVDA", "MSFT"] ✅
    ↓
primaryTicker = "NVDA" ✅
    ↓
Peer identification: Finds MSFT in tenant deals ✅
    ↓
tickers = ["NVDA", "MSFT"] (expanded) ✅
    ↓
RAG service receives: ticker="NVDA", tickers=["NVDA", "MSFT"]
    ↓
Structured retrieval: Queries for both tickers ✅
    ↓
Bedrock generation: isPeerComparison=true ✅
    ↓
Response: Comparative table + commentary ✅
```

## Implementation

### 1. Fix Peer Comparison Detection

**File**: `src/research/research-assistant.service.ts`

**Method**: `detectPeerComparisonIntent()`

**Change**: Add simple comparison keywords

```typescript
private detectPeerComparisonIntent(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  
  const peerKeywords = [
    // Existing peer-specific keywords
    'peers',
    'peer group',
    'peer companies',
    'competitors',
    'competitor',
    'competition',
    'comparable',
    'comparables',
    'comps',
    'industry peers',
    'similar companies',
    'compare to peers',
    'compare with peers',
    'vs peers',
    'versus peers',
    'against peers',
    'relative to peers',
    'benchmark',
    'benchmarking',
    
    // NEW: Simple comparison keywords
    'compare',      // "Compare X and Y"
    ' vs ',         // "X vs Y" (with spaces to avoid "versus")
    ' vs.',         // "X vs. Y"
    'versus',       // "X versus Y"
  ];

  // Check for exact keyword matches
  const hasKeyword = peerKeywords.some(kw => lowerQuery.includes(kw));
  
  // Also check for pattern "how does X compare"
  const hasComparePattern = /how does.*compare/i.test(query);
  
  // NEW: Check for multi-ticker pattern "X and Y"
  const hasMultiTickerPattern = this.hasMultiTickerPattern(query);

  if (hasKeyword || hasComparePattern || hasMultiTickerPattern) {
    this.logger.log(`🔍 Peer comparison intent detected in query: "${query}"`);
    return true;
  }

  return false;
}

/**
 * Check if query has multi-ticker pattern like "X and Y" or "X, Y"
 * Only returns true if 2+ tickers are present
 */
private hasMultiTickerPattern(query: string): boolean {
  const tickers = this.extractTickers(query);
  
  if (tickers.length < 2) {
    return false;
  }
  
  // Check for "and" or "," between tickers
  const lowerQuery = query.toLowerCase();
  const hasAndPattern = lowerQuery.includes(' and ');
  const hasCommaPattern = lowerQuery.includes(',');
  
  return hasAndPattern || hasCommaPattern;
}
```

### 2. Ensure Multi-Ticker Array is Preserved

**File**: `src/research/research-assistant.service.ts`

**Method**: `sendMessage()`

**Current Code** (line 368-420):
```typescript
let tickers = this.extractTickers(dto.content, dto.context?.tickers);
const primaryTicker = tickers[0] || undefined;

// Check for peer comparison intent
let peerComparisonMetadata: PeerComparisonMetadata | undefined;
const isPeerComparisonQuery = this.detectPeerComparisonIntent(dto.content);

if (isPeerComparisonQuery && primaryTicker) {
  // Peer identification logic
  const peerResult = await this.identifyPeersFromDeals(primaryTicker);
  const peerTickers = peerResult.found.slice(0, 4);
  tickers = [primaryTicker, ...peerTickers].slice(0, 5);
  // ...
}

// Pass tickers to RAG service
const ragResult = await this.ragService.query(enhancedQuery, {
  ticker: primaryTicker,
  tickers: tickers.length > 1 ? tickers : undefined,
});
```

**Issue**: When peer comparison is detected, the code tries to identify peers from deals. But for explicit multi-ticker queries like "Compare NVDA and MSFT", we already HAVE the tickers - we don't need to identify them!

**Fix**: Skip peer identification if tickers are already explicitly provided in the query

```typescript
let tickers = this.extractTickers(dto.content, dto.context?.tickers);
const primaryTicker = tickers[0] || undefined;

// Check for peer comparison intent
let peerComparisonMetadata: PeerComparisonMetadata | undefined;
const isPeerComparisonQuery = this.detectPeerComparisonIntent(dto.content);

if (isPeerComparisonQuery && primaryTicker) {
  // If user explicitly provided multiple tickers, use them directly
  if (tickers.length > 1) {
    this.logger.log(`📊 Explicit multi-ticker query: ${tickers.join(', ')}`);
    
    peerComparisonMetadata = {
      primaryTicker,
      peersIncluded: tickers.slice(1), // All tickers except primary
      missingPeers: [], // No missing peers for explicit queries
    };
  } else {
    // Single ticker - identify peers from deals
    this.logger.log(`🔄 Peer comparison detected, identifying peers for ${primaryTicker}`);
    
    try {
      const peerResult = await this.identifyPeersFromDeals(primaryTicker);
      const peerTickers = peerResult.found.slice(0, 4);
      tickers = [primaryTicker, ...peerTickers].slice(0, 5);
      
      peerComparisonMetadata = {
        primaryTicker,
        peersIncluded: peerTickers,
        missingPeers: peerResult.missing.map(ticker => ({
          ticker,
          reason: peerResult.rationale,
        })),
      };
    } catch (error) {
      this.logger.error(`❌ Peer identification failed: ${error.message}`);
    }
  }
}
```

### 3. Debug Logging

Add comprehensive logging to trace the data flow:

```typescript
// After ticker extraction
this.logger.log(`🔍 Extracted tickers: ${JSON.stringify(tickers)}`);
this.logger.log(`📊 Primary ticker: ${primaryTicker}`);
this.logger.log(`🔄 Peer comparison detected: ${isPeerComparisonQuery}`);

// Before RAG service call
this.logger.log(`📤 Calling RAG service with:`);
this.logger.log(`   ticker: ${primaryTicker}`);
this.logger.log(`   tickers: ${JSON.stringify(tickers)}`);

// After RAG service call
this.logger.log(`📥 RAG result:`);
this.logger.log(`   metrics: ${ragResult.metrics?.length || 0}`);
this.logger.log(`   narratives: ${ragResult.narratives?.length || 0}`);
this.logger.log(`   answer length: ${ragResult.answer?.length || 0}`);
```

### 4. Verify Bedrock Prompt

**File**: `src/rag/bedrock.service.ts`

**Method**: `buildSystemPrompt()`

**Current Code** (line 732):
```typescript
if (context.isPeerComparison) {
  parts.push('9. PEER COMPARISON FORMAT:');
  parts.push('   - Present financial metrics in a comparison table across all companies');
  parts.push('   - Organize qualitative insights (risks, strategy) by company with cross-company commentary');
}
```

**Verification**: This looks correct. The prompt should instruct Claude to generate comparative analysis.

**Additional Enhancement**: Add explicit instruction to NEVER return blank responses

```typescript
if (context.isPeerComparison) {
  parts.push('9. PEER COMPARISON FORMAT:');
  parts.push('   - Present financial metrics in a comparison table across all companies');
  parts.push('   - Organize qualitative insights (risks, strategy) by company with cross-company commentary');
  parts.push('   - ALWAYS provide comparative commentary - never return just a chart');
  parts.push('   - Explain key differences, trends, and insights across companies');
}
```

## Testing Strategy

### Unit Tests

1. Test `detectPeerComparisonIntent()` with various query formats
2. Test `extractTickers()` with multi-ticker queries
3. Test `hasMultiTickerPattern()` helper method

### Integration Tests

1. Test full flow from query to response for "Compare X and Y"
2. Test full flow for "X vs Y"
3. Test full flow for "X versus Y"
4. Test with missing data for one ticker
5. Test with missing data for all tickers

### Manual Tests

1. Test in workspace.html with real queries
2. Verify response includes both table and commentary
3. Verify no blank responses
4. Verify charts are accompanied by text

## Rollout Plan

1. Deploy fix to development environment
2. Test with sample queries
3. Verify logs show correct detection and data flow
4. Deploy to production
5. Monitor for any regressions

## Success Metrics

- 0% blank responses for valid multi-ticker queries
- 100% of comparison queries generate comparative commentary
- Response time < 5 seconds for 2-ticker comparisons
- User satisfaction with comparison quality
