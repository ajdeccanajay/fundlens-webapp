# Citation Links Debug Plan

## Current Status

### What's Working
1. ✅ Backend sends citations correctly via SSE stream
2. ✅ Citations array is populated in message object
3. ✅ Event delegation is set up on document
4. ✅ `renderMarkdownWithCitations()` function exists
5. ✅ `handleCitationClickByNumber()` function exists
6. ✅ Modal HTML exists and is ready

### What's Broken
1. ❌ Some citation links are clickable, some are not (user observation)
2. ❌ When clicked, modal doesn't show content
3. ❌ Tables render as raw markdown text

## Root Cause Analysis

### Issue 1: Inconsistent Citation Rendering
**Hypothesis**: The `renderMarkdownWithCitations()` function is being called, but:
- Citations might be arriving AFTER the message is rendered
- The regex replacement might not be matching all instances
- There might be multiple rendering paths (some using `renderMarkdown`, some using `renderMarkdownWithCitations`)

**Evidence Needed**:
- Console logs showing when citations arrive vs when rendering happens
- Console logs showing regex matches for each citation number
- Verification that ALL messages use `renderMarkdownWithCitations`

### Issue 2: Modal Not Showing Content
**Hypothesis**: The modal is opening but `sourceModal` data is not being set correctly

**Evidence Needed**:
- Console logs in `handleSecFilingCitation()` showing what data is being set
- Verification that `showSourceModal` is being set to `true`
- Check if Alpine.js is properly reactive

### Issue 3: Tables Rendering as Raw Text
**Root Cause**: System prompt doesn't instruct Claude on proper table formatting

**Fix Applied**: Added instruction #4 to system prompt:
```
4. Use markdown tables with proper formatting: | Header | Header | on first line, then |--------|--------| separator
```

## Debugging Steps Added

### 1. Enhanced Logging in `renderMarkdownWithCitations()`
```javascript
console.log('🎨 renderMarkdownWithCitations called');
console.log('  - Content length:', content?.length);
console.log('  - Citations:', citations);
// ... detailed logs for each citation processing step
```

### 2. Enhanced Logging in `handleCitationClickByNumber()`
```javascript
console.log('🖱️ handleCitationClickByNumber called:', citationNum);
console.log('  - currentCitations:', this.currentCitations);
console.log('  - Found citation:', citation);
```

### 3. Enhanced Logging in `handleSecFilingCitation()`
```javascript
console.log('📋 handleSecFilingCitation called:', citation);
console.log('  - sourceModal set:', this.sourceModal);
console.log('  ✅ Modal should be visible now');
```

### 4. Enhanced Logging in SSE Stream Handler
```javascript
console.log('📎 Added citations:', data.citations.length, 'citations');
console.log('📎 Citation details:', JSON.stringify(data.citations, null, 2));
```

## Testing Plan

### Test 1: Standalone Citation Test
**File**: `test-citation-debug.html`
**Purpose**: Verify citation rendering and click handling in isolation
**Steps**:
1. Open `test-citation-debug.html` in browser
2. Verify table renders correctly
3. Click on [1], [2], [3] citations
4. Verify alert shows citation details

### Test 2: Live Workspace Test
**Steps**:
1. Open workspace for NVDA
2. Ask: "Compare revenue with peers"
3. Open browser console
4. Look for logs:
   - `📎 Added citations:` - confirms citations received
   - `🎨 renderMarkdownWithCitations called` - confirms rendering
   - `🔍 Looking for [1]` - confirms regex matching
   - `🔗 Citation link clicked:` - confirms click detection
   - `🖱️ handleCitationClickByNumber called:` - confirms handler invoked
   - `📋 handleSecFilingCitation called:` - confirms modal opening
5. Click on citation links
6. Verify modal opens with content

## Expected Console Output (Success Case)

```
📎 Added citations: 3 citations
📎 Citation details: [
  {
    "number": 1,
    "ticker": "NVDA",
    "filingType": "10-Q",
    ...
  },
  ...
]
🎨 renderMarkdownWithCitations called
  - Content length: 450
  - Citations: [Object, Object, Object]
  ✅ Stored citations in currentCitations: [Object, Object, Object]
  📝 Markdown rendered, HTML length: 520
  🔢 Processing citation: 1 {number: 1, ticker: "NVDA", ...}
    🔍 Looking for [1], found 1 matches
    ✅ Replaced with clickable link
  🔢 Processing citation: 2 {number: 2, ticker: "NVDA", ...}
    🔍 Looking for [2], found 1 matches
    ✅ Replaced with clickable link
  🔢 Processing citation: 3 {number: 3, ticker: "NVDA", ...}
    🔍 Looking for [3], found 1 matches
    ✅ Replaced with clickable link
  ✅ Final HTML length: 650

[User clicks citation [1]]

🔗 Citation link clicked: 1
🖱️ handleCitationClickByNumber called: 1
  - currentCitations: [Object, Object, Object]
  - Found citation: {number: 1, ticker: "NVDA", ...}
  ✅ Opening modal for citation
📋 handleSecFilingCitation called: {number: 1, ticker: "NVDA", ...}
  - sourceModal set: {ticker: "NVDA", filingType: "10-Q", ...}
  ✅ Modal should be visible now
```

## Potential Issues to Watch For

### Issue A: Citations Arrive After Rendering
**Symptom**: `renderMarkdownWithCitations` is called with empty citations array
**Solution**: Ensure citations are sent BEFORE the final tokens in SSE stream

### Issue B: Regex Not Matching
**Symptom**: `Looking for [1], found 0 matches`
**Possible Causes**:
- Citation number in response doesn't match citation number in array
- Markdown rendering converts `[1]` to something else (e.g., HTML entity)
- Citation is inside a code block or other special markdown context

### Issue C: Alpine.js Reactivity Issue
**Symptom**: `showSourceModal` is set to `true` but modal doesn't appear
**Solution**: Check if `x-show="showSourceModal"` is working correctly

### Issue D: Multiple Rendering Paths
**Symptom**: Some messages use `renderMarkdown`, some use `renderMarkdownWithCitations`
**Solution**: Ensure ALL assistant messages use `renderMarkdownWithCitations`

## Next Steps

1. **Test standalone HTML** - Verify basic functionality works
2. **Test live workspace** - Collect console logs
3. **Analyze logs** - Identify where the flow breaks
4. **Fix root cause** - Based on log analysis
5. **Verify fix** - Test again with logs

## Files Modified

1. `public/app/deals/workspace.html` - Added comprehensive logging
2. `src/rag/bedrock.service.ts` - Added table formatting instruction
3. `test-citation-debug.html` - Created standalone test page
