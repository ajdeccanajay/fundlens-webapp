# CRITICAL BUG: Wrong Data Returned for Simple Queries

## Problem Statement

User reports that simple queries are returning WRONG DATA:
- Query: "What is revenue?"
- Returns: net_income data instead

**This is a CRITICAL bug** - returning wrong financial data is unacceptable.

## Status

Cache is DISABLED (commented out in rag.service.ts lines 69-88 and 330-340), so this is NOT a cache issue.

## Possible Root Causes

### 1. Intent Detection Bug
- Intent detector may be extracting wrong metric from query
- Query: "What is revenue?" → Intent extracts "net_income" instead

### 2. Query Router Bug
- Router may be routing to wrong metric retrieval path

### 3. Structured Retriever Bug
- Retriever may be fetching wrong metric from database

### 4. Browser Cache
- Browser may be caching API responses
- Need to add cache-busting headers

## Immediate Actions Required

1. **Add debug logging** to trace the full query path:
   - Log intent detection result
   - Log structured query being sent to database
   - Log database query results
   - Log final response

2. **Test with curl** to eliminate browser caching:
   ```bash
   curl -X POST http://localhost:3000/api/rag/query \
     -H "Content-Type: application/json" \
     -d '{"query": "What is NVDA revenue?"}'
   ```

3. **Check intent detection**:
   - Add logging to intent-detector.service.ts
   - Verify extracted metrics match query

4. **Check database query**:
   - Add logging to structured-retriever.service.ts
   - Verify SQL query is correct

## Testing Plan

### Test 1: Intent Detection
```bash
# Query: "What is NVDA revenue?"
# Expected intent.metrics: ["revenue"]
# Actual: ???
```

### Test 2: Database Query
```bash
# Expected SQL: SELECT * FROM financial_metrics WHERE ticker='NVDA' AND normalized_metric='revenue'
# Actual: ???
```

### Test 3: Response Data
```bash
# Expected: Revenue values
# Actual: net_income values (BUG!)
```

## Fix Strategy

Once root cause is identified:

1. **If Intent Detection Bug**:
   - Fix metric extraction logic
   - Add test cases for common queries
   - Verify with property-based tests

2. **If Query Router Bug**:
   - Fix routing logic
   - Add test cases

3. **If Structured Retriever Bug**:
   - Fix database query construction
   - Add test cases

4. **If Browser Cache**:
   - Add `Cache-Control: no-cache` headers
   - Add timestamp to API responses
   - Clear browser cache

## Next Steps

1. **STOP all formatting work** - data correctness is priority #1
2. **Add comprehensive logging** to trace query path
3. **Test with curl** to eliminate browser caching
4. **Identify root cause**
5. **Fix and test**
6. **Verify with multiple queries**

## User Impact

**CRITICAL**: Users cannot trust the system if it returns wrong data. This must be fixed immediately before any other work.

---

**Status**: 🔴 CRITICAL BUG - Investigation in progress
**Priority**: P0 - Highest
**Blocker**: Yes - blocks all other work

