# Testing Instructions - Investment-Grade RAG Synthesis

## Status: Ready for Testing

All code changes have been implemented. Now we need to test with a real query to verify:
1. Headers render as proper H2 elements (not bold text)
2. Citations [1], [2] are clickable blue links
3. Modal opens when clicking citations

## What Was Fixed

### Fix 1: System Prompt Updated to Use ## Headers
**File:** `src/rag/bedrock.service.ts` (lines 520-550)

**Changes:**
- Updated system prompt to explicitly require `## markdown headers`
- Added instruction: "USE PROPER HEADERS - Use ## markdown syntax for section headers. NEVER use **bold text** as headers."
- Added formatting rules section
- Updated example response to show proper `## Header` format

**Example from prompt:**
```
FORMATTING RULES:
- Use ## for section headers (e.g., "## Supply Chain Risks")
- Use proper markdown headers, NOT **bold text** for section titles
- Headers must be on their own line with blank lines before and after
```

### Fix 2: Citations Event Handler Added
**File:** `public/app/deals/workspace.html` (lines 2496-2499)

**Changes:**
- Added handler for `citations` SSE event
- Citations array is now populated when backend sends citations
- Added console log to track citations received

**Code:**
```javascript
} else if (currentEvent === 'citations' && data.citations) {
    // NEW: Handle citations from backend
    this.researchMessages[assistantMessageIndex].citations = data.citations;
    console.log('📎 Added citations:', data.citations.length);
```

### Fix 3: Citations Array Initialized
**File:** `public/app/deals/workspace.html` (line 2407)

**Changes:**
- Added `citations: []` to message initialization
- Ensures citations array exists before SSE handler tries to populate it

**Code:**
```javascript
this.researchMessages.push({
    id: Date.now() + 1,
    role: 'assistant',
    content: '',
    sources: [],
    citations: [] // NEW: Initialize citations array
});
```

### Fix 4: CSS Styling Already in Place
**File:** `public/app/deals/workspace.html` (lines 125-138, 343-362)

**Headers CSS:**
```css
.message-assistant h2 {
    font-size: 1.3em;
    font-weight: 600;
    margin-top: 1.5em;
    margin-bottom: 0.75em;
    line-height: 1.3;
    color: var(--fundlens-gray-900);
    text-align: left;
}
```

**Citation Links CSS:**
```css
.citation-link {
    color: #2563eb;
    text-decoration: none;
    font-weight: 500;
    padding: 0 2px;
    border-radius: 2px;
    transition: all 0.2s ease;
    cursor: pointer;
    display: inline-block;
}

.citation-link:hover {
    background-color: #dbeafe;
    color: #1e40af;
}
```

## How to Test

### Step 1: Navigate to Workspace
1. Open browser to: `http://localhost:3000/app/deals/workspace.html?ticker=NVDA`
2. Ensure you're logged in (if not, login first)

### Step 2: Ask Test Query
In the Research Assistant panel (right side), ask:
```
What are NVDA's risks?
```

### Step 3: Verify Headers
**Expected:** Headers should render as proper H2 elements
- Larger font size (1.3em)
- Bold (font-weight: 600)
- Proper spacing (margin-top: 1.5em)
- Left-aligned

**Example:**
```
## Supply Chain Concentration

NVIDIA's production is heavily concentrated at TSMC...

## Competitive Pressures

The AI accelerator market is intensifying...
```

**NOT like this (bad):**
```
**Supply Chain Concentration**

NVIDIA's production is heavily concentrated at TSMC...
```

### Step 4: Verify Citations Are Clickable
**Expected:** Citations should be blue clickable links
- [1], [2], [3] appear in blue color (#2563eb)
- Hover shows light blue background (#dbeafe)
- Cursor changes to pointer on hover
- Clicking opens modal

**Check browser console for:**
```
📎 Added citations: 3
```

### Step 5: Click a Citation
**Expected:** Modal opens with source details
- Header shows: "NVDA 10-K FY2024"
- Section shows: "Item 1A - Risk Factors"
- Metadata shows: "Page 23 • Relevance: 95%"
- Excerpt shows first 500 chars of source chunk
- "Copy Citation" button works

### Step 6: Verify Modal Functionality
1. Click citation [1] → Modal opens
2. Verify all fields populated correctly
3. Click "Copy Citation" → Citation copied to clipboard
4. Click "Close" or press Esc → Modal closes
5. Click outside modal → Modal closes

## Debug Console Logs

### Expected Logs During Streaming:
```
🔌 Starting SSE stream reading...
📦 Buffer chunk received, length: 156
📄 Processing line: event: token
🏷️ Event type: token
📄 Processing line: data: {"text":"NVIDIA"}
📊 Parsed SSE - event: token data: {text: "NVIDIA"}
✍️ Added token, total length: 6
...
📄 Processing line: event: citations
🏷️ Event type: citations
📄 Processing line: data: {"citations":[...]}
📊 Parsed SSE - event: citations data: {citations: Array(3)}
📎 Added citations: 3
...
```

### If Citations Not Received:
```
⚠️ Unhandled event/data combination: citations {...}
```
This means the handler is not working - check line 2496-2499 in workspace.html

### If Citations Not Clickable:
- Check if `renderMarkdownWithCitations()` is being called
- Check if citations array is populated
- Check browser console for JavaScript errors
- Verify citation-link CSS is loaded

## Common Issues

### Issue 1: Headers Still Bold Text
**Symptom:** Headers appear as `**text**` instead of proper H2
**Cause:** Claude is still using old prompt format
**Fix:** 
1. Check if system prompt was updated in bedrock.service.ts
2. Restart server: `npm run start:dev`
3. Clear browser cache
4. Try query again

### Issue 2: Citations Not Clickable
**Symptom:** [1], [2] appear as plain text
**Cause:** Citations event not handled or citations array empty
**Fix:**
1. Check browser console for "📎 Added citations: X"
2. If not present, check SSE handler (line 2496-2499)
3. Verify citations array initialized (line 2407)
4. Check if backend is sending citations event

### Issue 3: Modal Not Opening
**Symptom:** Clicking citation does nothing
**Cause:** Click handler not wired up or citation data missing
**Fix:**
1. Check if `handleSecFilingCitation()` is defined
2. Verify `preview-citation` event listener exists
3. Check browser console for JavaScript errors
4. Verify citation object has required fields

## Success Criteria

✅ Headers render as proper H2 elements (larger, bold, spaced)
✅ Citations [1], [2], [3] are blue clickable links
✅ Hovering citations shows light blue background
✅ Clicking citation opens modal
✅ Modal shows correct source information
✅ Copy citation button works
✅ Modal closes on Esc, click-away, or close button
✅ Console shows "📎 Added citations: X"

## Next Steps After Testing

1. If all tests pass → Mark Task 5 complete
2. If headers still wrong → Adjust system prompt further
3. If citations not clickable → Debug SSE handler
4. If modal not working → Debug click handler

## Files to Check If Issues Occur

1. **Backend:**
   - `src/rag/bedrock.service.ts` - System prompt and citation parsing
   - `src/research/research-assistant.service.ts` - SSE streaming

2. **Frontend:**
   - `public/app/deals/workspace.html` - SSE handler, rendering, modal

3. **Logs:**
   - Server logs: Check terminal running `npm run start:dev`
   - Browser console: Check for errors and debug logs
   - Network tab: Check SSE stream events

---

**Status:** ✅ CODE COMPLETE - READY FOR TESTING
**Date:** February 6, 2026
**Next:** Test with real query and verify all functionality works
