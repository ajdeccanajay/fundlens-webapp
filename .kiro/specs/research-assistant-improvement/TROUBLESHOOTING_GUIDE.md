# Research Assistant Troubleshooting Guide

## Issue: No Answers Appearing for AAPL

### Quick Diagnostic Checklist

Open your browser DevTools (F12) and check each of these:

#### 1. Check Authentication ⚠️ MOST COMMON ISSUE
```javascript
// In Browser Console, run:
localStorage.getItem('fundlens_token')
localStorage.getItem('authToken')
```

**Expected**: Should return a JWT token string  
**If null**: You need to login first at `/login.html`

**Fix**:
1. Go to `http://localhost:3000/login.html`
2. Login with your credentials
3. Return to the page and try again

#### 2. Check Network Requests
Open DevTools → Network tab → Filter by "research"

**Look for these requests**:
- `POST /api/research/conversations` - Should return 201 with conversation ID
- `POST /api/research/conversations/{id}/messages` - Should return 200 with SSE stream

**Common Issues**:
- ❌ 401 Unauthorized → Auth token missing/expired (see #1)
- ❌ 404 Not Found → Backend not running or wrong URL
- ❌ 500 Server Error → Backend error (check server logs)
- ❌ Failed to fetch → CORS or network issue

#### 3. Check Console Errors
Look in Console tab for errors:

**Common Errors**:
```
Error: this.getAuthHeaders is not a function
→ Fix: Refresh the page (function was added recently)

TypeError: Cannot read property 'content' of undefined
→ Fix: Check if conversationId was created

401 Unauthorized
→ Fix: Login again

Failed to fetch
→ Fix: Check if backend is running
```

#### 4. Check Backend is Running
```bash
# In terminal, check if backend is running:
curl http://localhost:3000/health

# Expected: {"status":"ok"}
# If connection refused: Start backend with `npm run start:dev`
```

#### 5. Check Conversation Creation
In Console, after sending first message:

```javascript
// Check if conversation was created
// Look for console.log showing conversation ID
```

**Expected**: Should see conversation ID in component state  
**If missing**: Conversation creation failed (check Network tab)

### Step-by-Step Diagnostic Process

#### Step 1: Verify Authentication
```javascript
// Run in Console:
const token = localStorage.getItem('fundlens_token') || localStorage.getItem('authToken');
console.log('Token exists:', !!token);
console.log('Token value:', token ? token.substring(0, 20) + '...' : 'MISSING');
```

**If token is missing**:
1. Go to `/login.html`
2. Login
3. Verify token appears in localStorage
4. Return to research page

#### Step 2: Test API Manually
```javascript
// Run in Console:
const token = localStorage.getItem('fundlens_token') || localStorage.getItem('authToken');

fetch('/api/research/conversations', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    title: 'Test Conversation'
  })
})
.then(r => r.json())
.then(data => console.log('Conversation created:', data))
.catch(err => console.error('Error:', err));
```

**Expected**: Should return conversation object with ID  
**If 401**: Token is invalid, login again  
**If 404**: Backend not running or wrong endpoint

#### Step 3: Test Message Sending
```javascript
// Replace CONV_ID with actual conversation ID from Step 2
const CONV_ID = 'your-conversation-id-here';
const token = localStorage.getItem('fundlens_token') || localStorage.getItem('authToken');

fetch(`/api/research/conversations/${CONV_ID}/messages`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    content: 'What are the key risks for AAPL?',
    context: { tickers: ['AAPL'] }
  })
})
.then(response => {
  console.log('Response status:', response.status);
  console.log('Response headers:', response.headers);
  return response.text();
})
.then(text => console.log('Response body:', text))
.catch(err => console.error('Error:', err));
```

**Expected**: Should return SSE stream with data chunks  
**If empty**: RAG system may not have data for AAPL

#### Step 4: Check Data Availability
```bash
# In terminal, check if AAPL data exists:
npm run test -- scripts/check-tables.js

# Or query database directly:
psql -d fundlens -c "SELECT COUNT(*) FROM narrative_chunks WHERE ticker = 'AAPL';"
```

**Expected**: Should show narrative chunks for AAPL  
**If 0**: Need to ingest AAPL data first

### Common Issues and Fixes

#### Issue 1: "Error: this.getAuthHeaders is not a function"
**Cause**: Old cached version of page  
**Fix**: Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)

#### Issue 2: Silent Failure (No Error, No Response)
**Cause**: Conversation creation failed silently  
**Fix**: 
1. Check Network tab for failed requests
2. Check Console for errors
3. Verify auth token exists

#### Issue 3: "No response received. Please try again."
**Cause**: SSE stream returned empty  
**Fix**:
1. Check backend logs for RAG query errors
2. Verify AAPL data exists in database
3. Check Bedrock KB has AAPL documents

#### Issue 4: Typing Indicator Stuck
**Cause**: Stream never completed  
**Fix**:
1. Refresh page
2. Check Network tab for incomplete requests
3. Check backend logs for errors

#### Issue 5: 401 Unauthorized
**Cause**: Token expired or missing  
**Fix**:
1. Clear localStorage: `localStorage.clear()`
2. Go to `/login.html`
3. Login again
4. Return to research page

### Backend Diagnostic Commands

#### Check if Backend is Running
```bash
curl http://localhost:3000/health
```

#### Check Backend Logs
```bash
# If running with npm run start:dev
# Logs appear in terminal

# Look for:
# - "Nest application successfully started"
# - Research API requests
# - RAG query results
# - Any error messages
```

#### Check Database Connection
```bash
npm run test -- scripts/check-tables.js
```

#### Check AAPL Data
```bash
# Check if AAPL documents exist
psql -d fundlens -c "
  SELECT 
    ticker,
    COUNT(*) as chunk_count,
    MAX(filing_date) as latest_filing
  FROM narrative_chunks 
  WHERE ticker = 'AAPL'
  GROUP BY ticker;
"
```

**Expected**: Should show chunks for AAPL  
**If empty**: Run ingestion:
```bash
npm run ingest -- --ticker=AAPL
```

### Data Ingestion (If No AAPL Data)

If AAPL data is missing, ingest it:

```bash
# Ingest AAPL 10-K
node scripts/end-to-end-pipeline.js AAPL

# Or use batch ingestion
node scripts/batch-sec-ingestion.js --tickers=AAPL
```

### Testing the Fix

After applying fixes, test the flow:

1. **Clear cache**: Hard refresh (Ctrl+Shift+R)
2. **Verify auth**: Check localStorage has token
3. **Open Research**: Click "Research Assistant" button
4. **Send message**: "What are the key risks for AAPL?"
5. **Verify response**: Should see streaming text appear
6. **Check conversation**: "Conversation active" indicator should show
7. **Test follow-up**: "How does that compare to competitors?"
8. **Verify context**: Response should reference previous question

### Enable Debug Mode

Add this to your browser console for detailed logging:

```javascript
// Enable debug logging
localStorage.setItem('DEBUG_RESEARCH', 'true');

// Reload page
location.reload();
```

This will show detailed logs for:
- Conversation creation
- Message sending
- SSE stream reading
- Error handling

### Still Not Working?

If none of the above fixes work:

1. **Check browser compatibility**: Use Chrome/Edge (best SSE support)
2. **Disable browser extensions**: Ad blockers may interfere
3. **Check firewall**: May block SSE connections
4. **Try incognito mode**: Rules out cache/extension issues
5. **Check backend version**: Ensure latest code is running

### Get Help

If issue persists, collect this info:

1. Browser console errors (screenshot)
2. Network tab showing failed requests (screenshot)
3. Backend logs (copy/paste)
4. Output of diagnostic commands above
5. Browser and OS version

Then check:
- Backend logs for errors
- Database for AAPL data
- Bedrock KB sync status
