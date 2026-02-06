# Debug Logging Added - Wrong Data Investigation

## Problem

User reports: "Simple queries are not working. The cache returns net_income, even if I ask for revenue."

**This is a CRITICAL data correctness bug** - must be fixed immediately.

## Debug Logging Added

Added comprehensive logging to trace the full query path and identify where wrong data is being returned.

### Location 1: Intent Detection (Line ~52-60)
```typescript
// DEBUG: Log intent to trace wrong data bug
this.logger.log(`🔍 DEBUG Intent Detection:`);
this.logger.log(`   Query: "${query}"`);
this.logger.log(`   Intent Type: ${intent.type}`);
this.logger.log(`   Ticker: ${JSON.stringify(intent.ticker)}`);
this.logger.log(`   Metrics: ${JSON.stringify(intent.metrics)}`);  // ← KEY: Should show ["revenue"]
this.logger.log(`   Period: ${intent.period}`);
```

### Location 2: Structured Query (Line ~180-195)
```typescript
this.logger.log(`🔍 DEBUG Structured Query:`);
this.logger.log(`   Tickers: ${JSON.stringify(plan.structuredQuery.tickers)}`);
this.logger.log(`   Metrics: ${JSON.stringify(plan.structuredQuery.metrics)}`);  // ← KEY: Should show ["revenue"]
this.logger.log(`   Period: ${plan.structuredQuery.period}`);
```

### Location 3: Retrieved Data (Line ~200-210)
```typescript
// DEBUG: Log first metric to verify correctness
if (metrics.length > 0) {
  this.logger.log(`🔍 DEBUG First Metric Retrieved:`);
  this.logger.log(`   Ticker: ${metrics[0].ticker}`);
  this.logger.log(`   Metric: ${metrics[0].normalizedMetric}`);  // ← KEY: Should show "revenue"
  this.logger.log(`   Value: ${metrics[0].value}`);
  this.logger.log(`   Period: ${metrics[0].fiscalPeriod}`);
}
```

## Testing Instructions

### 1. Check Server Logs

Open a new terminal and watch the logs:
```bash
tail -f /tmp/server-logs.txt
```

Or check the process output:
```bash
# Get process ID
ps aux | grep "npm run start:dev"

# Check logs in the terminal where server is running
```

### 2. Test Query

In the browser at `http://localhost:3000/app/deals/workspace.html`:

**Query 1**: "What is NVDA revenue?"

**Expected logs**:
```
🔍 DEBUG Intent Detection:
   Query: "What is NVDA revenue?"
   Intent Type: structured
   Ticker: "NVDA"
   Metrics: ["revenue"]  ← Should be revenue, NOT net_income
   Period: latest

🔍 DEBUG Structured Query:
   Tickers: ["NVDA"]
   Metrics: ["revenue"]  ← Should be revenue, NOT net_income
   Period: latest

🔍 DEBUG First Metric Retrieved:
   Ticker: NVDA
   Metric: revenue  ← Should be revenue, NOT net_income
   Value: 123456789
   Period: Q4 2025
```

**If logs show**:
```
   Metrics: ["net_income"]  ← WRONG! Bug in intent detection
```

Then the bug is in **intent-detector.service.ts** - it's extracting the wrong metric from the query.

**If logs show**:
```
   Metrics: ["revenue"]  ← Correct
   ...
   Metric: net_income  ← WRONG! Bug in database query
```

Then the bug is in **structured-retriever.service.ts** - it's querying the wrong metric from the database.

### 3. Test Multiple Queries

Test these queries and check logs for each:

1. "What is NVDA revenue?" → Should extract ["revenue"]
2. "What is NVDA net income?" → Should extract ["net_income"]
3. "What is AAPL revenue?" → Should extract ["revenue"]
4. "Compare NVDA and AAPL revenue" → Should extract ["revenue"]

## Root Cause Analysis

Based on the logs, identify which component is causing the issue:

### Scenario A: Intent Detection Bug
**Symptoms**: Logs show wrong metric in intent.metrics
**Fix**: Update intent-detector.service.ts to correctly extract metrics from queries

### Scenario B: Query Router Bug
**Symptoms**: Intent is correct, but structured query has wrong metrics
**Fix**: Update query-router.service.ts to correctly map intent to structured query

### Scenario C: Structured Retriever Bug
**Symptoms**: Structured query is correct, but retrieved data has wrong metric
**Fix**: Update structured-retriever.service.ts to correctly query database

### Scenario D: Browser Cache
**Symptoms**: Logs show correct data, but browser displays wrong data
**Fix**: Clear browser cache, add no-cache headers

## Next Steps

1. **Run test query** and capture logs
2. **Identify root cause** from logs
3. **Report findings** with specific log output
4. **Fix the identified component**
5. **Re-test** to verify fix
6. **Add regression test** to prevent future occurrences

## Files Modified

- `src/rag/rag.service.ts`:
  - Added debug logging at line ~52-60 (intent detection)
  - Added debug logging at line ~180-195 (structured query)
  - Added debug logging at line ~200-210 (retrieved data)

## Build Status

✅ Build successful (Exit Code: 0)
✅ Server running (Process 28)
✅ Debug logging active

## Priority

🔴 **P0 - CRITICAL**
- Data correctness is non-negotiable
- Must fix before any other work
- Blocks all formatting improvements

---

**Ready for Testing**: ✅ Yes
**Next Action**: Run test query and capture logs to identify root cause

