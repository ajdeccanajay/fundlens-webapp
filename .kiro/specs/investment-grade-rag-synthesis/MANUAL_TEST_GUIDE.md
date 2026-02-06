# Manual Testing Guide - Citation Links Fix

## Prerequisites
- Server running: `npm run start:dev`
- Browser: Chrome/Firefox with DevTools open
- Test ticker: NVDA (has good data)

## Test 1: Standalone Citation Test

### Steps
1. Open `test-citation-debug.html` in browser
2. Open browser console (F12)
3. Verify you see:
   - A table with revenue data
   - Text with [1], [2], [3] citations that are blue and underlined on hover
4. Click on [1]
   - Should see alert with citation details
5. Click on [2] and [3]
   - Should see alerts with different citation details

### Expected Results
✅ Table renders correctly with borders
✅ Citations [1], [2], [3] are blue links
✅ Clicking shows alert with correct data
✅ Console shows detailed logs

### If This Fails
- Problem is with basic citation rendering logic
- Check browser console for errors
- Verify marked.js is loaded

## Test 2: Live Workspace - Citation Links

### Steps
1. Navigate to: `http://localhost:3000/app/deals/workspace.html?ticker=NVDA`
2. Open browser console (F12)
3. Click "Research" tab
4. Type: "What was NVDA's revenue in Q4 2025?"
5. Press Enter
6. Watch console for logs:
   ```
   📎 Added citations: X citations
   📎 Citation details: [...]
   🎨 renderMarkdownWithCitations called
   ```
7. Wait for response to complete
8. Look for citation numbers [1], [2], etc. in the response
9. Hover over a citation - should be blue and underlined
10. Click on a citation
11. Watch console for:
    ```
    🔗 Citation clicked: 1
    🖱️ handleCitationClickByNumber called: 1
    📋 handleSecFilingCitation called: {...}
    ✅ Modal should be visible now
    ```
12. Verify modal appears with:
    - Ticker, filing type, fiscal period in header
    - Section name
    - Relevance score
    - Excerpt text

### Expected Console Output
```
📎 Added citations: 3 citations
📎 Citation details: [
  {
    "number": 1,
    "ticker": "NVDA",
    "filingType": "10-Q",
    "fiscalPeriod": "Q4 2025",
    "section": "Revenue",
    "excerpt": "...",
    "relevanceScore": 0.95
  },
  ...
]
🎨 renderMarkdownWithCitations called
  - Content length: 450
  - Citations: (3) [{…}, {…}, {…}]
  ✅ Stored citations in currentCitations: (3) [{…}, {…}, {…}]
  📝 Markdown rendered, HTML length: 520
  🔢 Processing citation: 1 {number: 1, ticker: 'NVDA', ...}
    🔍 Looking for [1], found 1 matches
    ✅ Replaced with clickable link
  🔢 Processing citation: 2 {number: 2, ticker: 'NVDA', ...}
    🔍 Looking for [2], found 1 matches
    ✅ Replaced with clickable link
  🔢 Processing citation: 3 {number: 3, ticker: 'NVDA', ...}
    🔍 Looking for [3], found 1 matches
    ✅ Replaced with clickable link
  ✅ Final HTML length: 650

[User clicks citation [1]]

🔗 Citation clicked: 1
🖱️ handleCitationClickByNumber called: 1
  - currentCitations: (3) [{…}, {…}, {…}]
  - Found citation: {number: 1, ticker: 'NVDA', ...}
  ✅ Opening modal for citation
📋 handleSecFilingCitation called: {number: 1, ticker: 'NVDA', ...}
  - sourceModal set: {ticker: 'NVDA', filingType: '10-Q', ...}
  ✅ Modal should be visible now
```

### Expected Visual Results
✅ Citations appear as blue links [1], [2], [3]
✅ Hovering shows underline
✅ Clicking opens modal
✅ Modal shows correct data
✅ Modal can be closed

### If Citations Don't Appear
Check console for:
- `📎 Added citations: 0 citations` - Backend not sending citations
- `🎨 renderMarkdownWithCitations called` with empty citations - Timing issue
- No `🎨 renderMarkdownWithCitations called` - Function not being called

### If Citations Appear But Not Clickable
Check console for:
- `🔍 Looking for [1], found 0 matches` - Regex not matching
- Check if citations are inside code blocks or special markdown
- Verify HTML has `<a class="citation-link" data-citation-num="1">[1]</a>`

### If Click Doesn't Work
Check console for:
- No `🔗 Citation clicked:` - Event delegation not working
- `🖱️ handleCitationClickByNumber called` but no citation found - currentCitations not set
- `📋 handleSecFilingCitation called` but modal doesn't show - Alpine.js reactivity issue

## Test 3: Live Workspace - Table Rendering

### Steps
1. In workspace for NVDA
2. Click "Research" tab
3. Type: "Compare revenue with peers"
4. Press Enter
5. Wait for response
6. Verify table renders correctly with:
   - Headers in first row
   - Separator line (|--------|--------|)
   - Data rows with borders
   - Proper alignment

### Expected Results
✅ Table has visible borders
✅ Headers are bold
✅ Data is aligned
✅ No raw markdown visible (no `|` characters in rendered output)

### If Table Shows Raw Markdown
- Backend needs to regenerate response with new prompt
- Clear conversation and try again
- Check if marked.js tables option is enabled

## Test 4: Multiple Messages

### Steps
1. Send first message: "What was NVDA's revenue?"
2. Wait for response with citations
3. Click citation [1] - verify modal works
4. Send second message: "What about their profit margins?"
5. Wait for response with citations
6. Click citation [1] in SECOND message
7. Verify modal shows data from SECOND message, not first

### Expected Results
✅ Each message has its own citations
✅ Clicking citation in message 1 shows message 1 data
✅ Clicking citation in message 2 shows message 2 data
✅ No cross-contamination between messages

### If Citations Get Mixed Up
- Problem with `currentCitations` being global
- Need to store citations per message
- Check if `renderMarkdownWithCitations` is called for each message

## Troubleshooting Guide

### Problem: No citations in response
**Symptoms**: Response has no [1], [2], [3] numbers
**Cause**: Backend not generating citations
**Fix**: Check backend logs, verify Bedrock is returning citations

### Problem: Citations not clickable
**Symptoms**: [1], [2], [3] appear as plain text
**Cause**: `renderMarkdownWithCitations` not being called
**Fix**: Verify template uses `renderMarkdownWithCitations(message.content, message.citations)`

### Problem: Click does nothing
**Symptoms**: Click on citation, no console logs
**Cause**: Event delegation not set up
**Fix**: Verify `document.addEventListener('click', ...)` is in init()

### Problem: Modal doesn't show
**Symptoms**: Console shows "Modal should be visible" but no modal
**Cause**: Alpine.js reactivity or CSS issue
**Fix**: 
- Check if `x-show="showSourceModal"` is correct
- Verify modal HTML is not hidden by CSS
- Check if `x-cloak` is causing issues

### Problem: Modal shows but empty
**Symptoms**: Modal appears but no data
**Cause**: `sourceModal` not being set correctly
**Fix**: Check console logs in `handleSecFilingCitation`

### Problem: Wrong citation data
**Symptoms**: Click [1] but shows data for [2]
**Cause**: Citation number mismatch
**Fix**: Verify `citation.number` matches the number in the response text

## Success Criteria

All of these must pass:
- ✅ Standalone test works (test-citation-debug.html)
- ✅ Citations appear as blue links in workspace
- ✅ Clicking citation opens modal
- ✅ Modal shows correct data (ticker, filing, period, section, excerpt)
- ✅ Modal can be closed
- ✅ Multiple messages work independently
- ✅ Tables render correctly (no raw markdown)
- ✅ Console logs show complete flow

## Files to Check

If issues persist, verify these files:
1. `public/app/deals/workspace.html` - Frontend rendering and event handling
2. `src/research/research-assistant.service.ts` - Backend citation generation
3. `src/rag/bedrock.service.ts` - System prompt and citation parsing
4. Browser DevTools Console - Detailed logs
5. Browser DevTools Network - SSE stream data
