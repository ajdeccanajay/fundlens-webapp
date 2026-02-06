# Testing the Sources Fix

## Quick Test Guide

### Prerequisites
```bash
# Start the application
npm run start:dev
```

### Test 1: Basic Query with Sources
1. Open http://localhost:3000/app/research/index.html
2. Login with admin credentials
3. Create a new conversation
4. Send query: **"What is NVDA revenue?"**

**Expected Result:**
- ✅ Sources appear with format: "NVDA 10-K" or "NVDA 10-Q"
- ✅ No "undefined" in any source title
- ✅ Each source has a valid ticker and filing type
- ✅ Fiscal periods are shown (e.g., "FY2024", "Q3 2024")

**What to Look For:**
```
✅ GOOD:
Sources:
- NVDA 10-K (FY2024)
- NVDA 10-Q (Q3 2024)

❌ BAD (this should NOT appear):
Sources:
- undefined undefined
- NVDA undefined
- undefined 10-K
```

### Test 2: Multi-Company Query
Send query: **"Compare AAPL and MSFT revenue"**

**Expected Result:**
- ✅ Sources for both AAPL and MSFT
- ✅ No duplicate sources
- ✅ All sources have valid data

### Test 3: Ambiguous Query
Send query: **"Tell me about Tesla"**

**Expected Result:**
- ✅ Either shows valid sources OR no sources
- ✅ Never shows "undefined" sources

### Test 4: User Document Query
1. Upload a document (if you have user documents enabled)
2. Send query related to that document

**Expected Result:**
- ✅ Citations appear with proper document names
- ✅ No undefined values in citations

## Automated Test

```bash
# Run the automated test
node test-research-sources-fix.js
```

This will:
1. Login
2. Create a test conversation
3. Send a query
4. Verify sources have no undefined values
5. Report pass/fail

## Debugging

If you see undefined sources:

1. **Check the logs:**
   ```bash
   # Look for these log lines:
   grep "DEBUG First Metric Retrieved" logs/*
   grep "Retrieved.*structured metrics" logs/*
   ```

2. **Check the database:**
   ```sql
   -- Verify metrics have proper data
   SELECT ticker, normalized_metric, fiscal_period, filing_type
   FROM financial_metrics
   WHERE ticker = 'NVDA'
   LIMIT 5;
   ```

3. **Check the RAG service:**
   - Look for the `extractSources` method in `src/rag/rag.service.ts`
   - Verify it has the validation logic

4. **Check the research assistant:**
   - Look for the source filtering in `src/research/research-assistant.service.ts`
   - Verify it filters out invalid sources

## Common Issues

### Issue: Still seeing undefined sources
**Solution:** 
- Restart the server to pick up code changes
- Clear browser cache
- Check that both files were modified correctly

### Issue: No sources appearing at all
**Solution:**
- Check that the database has data for the queried ticker
- Verify the RAG service is returning metrics/narratives
- Check logs for any errors

### Issue: Duplicate sources
**Solution:**
- Verify the deduplication logic in `extractSources`
- Check that the Set is working correctly

## Success Criteria

The fix is working correctly when:
- ✅ All source titles are clean and readable
- ✅ No "undefined" appears anywhere in sources
- ✅ Sources are deduplicated
- ✅ Only valid sources with complete data are shown
- ✅ The user experience is professional and polished

## Rollback Plan

If the fix causes issues:

```bash
# Revert the changes
git checkout HEAD -- src/rag/rag.service.ts
git checkout HEAD -- src/research/research-assistant.service.ts

# Restart the server
npm run start:dev
```
