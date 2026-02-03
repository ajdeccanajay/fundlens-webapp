# Test the Research Assistant Fix

## Quick Test (2 minutes)

### Step 1: Open Workspace
```
http://localhost:3000/app/deals/workspace.html?ticker=AAPL
```

### Step 2: Click "Research Assistant" Tab
Look for the chat interface on the right side.

### Step 3: Type Query
```
what are the key risks?
```

### Step 4: Expected Result ✅

**Response should mention Apple, not Bank of America or Citigroup:**

```
Apple faces several key risks:

1. **Competition**: Intense competition in smartphones, tablets, and wearables from companies like Samsung, Google, and Huawei...

2. **Supply Chain**: Dependencies on third-party suppliers and manufacturers, particularly in Asia...

3. **Regulatory**: Increasing regulatory scrutiny regarding App Store policies, privacy practices, and antitrust concerns...

4. **Technology**: Rapid technological changes requiring continuous innovation in hardware and software...

5. **Economic**: Sensitivity to global economic conditions affecting consumer spending on premium products...

Sources:
- AAPL 10-K FY2024 (Risk Factors)
```

### Step 5: Check Backend Logs

Open terminal where backend is running and look for:

```
[ResearchAssistantService] 📊 Tickers: AAPL
[ResearchAssistantService] 🔧 Enhanced query with ticker context: "AAPL what are the key risks?"
[IntentDetectorService] Detected intent: { ticker: 'AAPL', type: 'semantic', sectionTypes: ['item_1a'] }
[BedrockService] Using KB-indexed metadata: ticker=AAPL
```

**If you see "ticker=BAC" or "ticker=C", the fix didn't work!**

## Additional Test Queries

### Test 2: Revenue Query (Structured)
```
what is the revenue?
```

**Expected**: Apple revenue numbers (e.g., "$385.6B for FY2024")

### Test 3: Hybrid Query
```
why did revenue decline?
```

**Expected**: Combination of revenue metrics + narrative explanation

### Test 4: Multi-Ticker (Change ticker to MSFT first)
```
compare revenue with AAPL
```

**Expected**: Side-by-side comparison of MSFT and AAPL revenue

## Troubleshooting

### Issue: Still seeing BAC/C instead of AAPL

**Check 1**: Is backend running with the fix?
```bash
# Check if process is running
ps aux | grep "npm run start:dev"

# If not, restart:
npm run start:dev
```

**Check 2**: Did Prisma client regenerate?
```bash
npx prisma generate
```

**Check 3**: Is the fix in the code?
```bash
grep -A 5 "Enhanced query with ticker context" src/research/research-assistant.service.ts
```

Should show:
```typescript
enhancedQuery = `${tickers.join(' and ')} ${dto.content}`;
this.logger.log(`🔧 Enhanced query with ticker context: "${enhancedQuery}"`);
```

### Issue: No response at all

**Check 1**: Is JWT token valid?
```javascript
// Open browser console
localStorage.getItem('fundlens_token')
// Should return a token
```

**Check 2**: Check network tab
- Open DevTools → Network
- Send message
- Look for POST to `/api/research/conversations/.../messages`
- Check status code (should be 200)
- Check response (should be streaming)

**Check 3**: Check backend logs for errors
```bash
# Look for errors in terminal
# Should NOT see:
# - "Conversation not found"
# - "Token expired"
# - "Tenant context not found"
```

### Issue: Response is slow (>10 seconds)

**This is normal!** The hybrid RAG system:
1. Queries Bedrock KB (1-2s)
2. Queries PostgreSQL (0.1-0.5s)
3. Generates with Claude Opus 4.5 (5-10s)

**Total**: 6-12 seconds is expected for complex queries.

## Success Criteria

✅ Response mentions **Apple** (not BAC/C)  
✅ Backend logs show **"ticker=AAPL"**  
✅ Backend logs show **"Enhanced query with ticker context"**  
✅ Sources show **"AAPL 10-K"**  
✅ Response is relevant to the query  

## If All Tests Pass

**Congratulations!** The Research Assistant is now working correctly with full hybrid RAG integration. You can:

1. Test with other tickers (MSFT, GOOGL, AMZN, etc.)
2. Test with different query types (risks, revenue, comparisons)
3. Test conversation memory (ask follow-up questions)
4. Test scratchpad integration (save insights)

## If Tests Fail

Please provide:
1. **Screenshot** of the response
2. **Backend logs** (last 50 lines)
3. **Browser console errors** (if any)
4. **Network tab** showing the request/response

I'll investigate further and provide additional fixes.

---

**Ready to test!** 🚀

Backend is running on: http://localhost:3000  
Workspace URL: http://localhost:3000/app/deals/workspace.html?ticker=AAPL
