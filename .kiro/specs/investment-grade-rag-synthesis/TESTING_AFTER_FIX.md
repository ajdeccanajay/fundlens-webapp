# Testing Guide - After Modal Multiple Clicks Fix

## What Was Fixed

1. **Duplicate Modal Removed**: Deleted broken modal HTML that was outside Alpine.js component
2. **Event Handler Deduplication**: Event listener now registered only once (no multiple handlers)
3. **Event Bubbling Prevented**: Added `event.stopPropagation()` to prevent bubbling
4. **Text Wrapping**: Modal text wraps properly without cutoff

## Testing Instructions

### 1. Test Modal Opens Once (CRITICAL)

**URL**: http://localhost:3000/app/deals/workspace.html?ticker=NVDA

**Steps**:
1. Navigate to workspace
2. Ask: "What are NVIDIA's key risks?"
3. Wait for response with citations [1], [2], [3]
4. Click on citation [1]

**Expected Result**:
- ✅ Modal opens ONCE (not multiple times)
- ✅ Modal shows NVDA 10-K information
- ✅ Text is fully visible (no cutoff)
- ✅ Close button works

**If Modal Opens Multiple Times**:
- Check browser console for errors
- Verify `window._citationHandlerRegistered` is set to `true`
- Check if there are multiple event listeners attached

### 2. Test Modal Content Display

**Steps**:
1. Click on different citations [1], [2], [3]
2. Verify each shows different content

**Expected Result**:
- ✅ Each citation shows correct ticker, filing type, period
- ✅ Section name is displayed
- ✅ Excerpt text is visible and readable
- ✅ Relevance score is shown
- ✅ Text wraps properly (no horizontal scroll)

### 3. Test Modal Interactions

**Steps**:
1. Open modal by clicking citation
2. Try these actions:
   - Click "Close" button
   - Press Esc key
   - Click outside modal (on backdrop)
   - Click "Copy Citation" button

**Expected Result**:
- ✅ All close methods work
- ✅ Copy citation copies to clipboard
- ✅ Toast notification appears after copy

### 4. Test Table Rendering (NEW RESPONSES ONLY)

**Important**: Table formatting only affects NEW responses from Claude. Old responses won't be retroactively fixed.

**Steps**:
1. Ask a NEW question that would generate a table
2. Example: "Compare NVIDIA's revenue across quarters in a table"

**Expected Result**:
- ✅ Table renders with proper markdown formatting
- ✅ Headers are separated with pipes |
- ✅ Alignment row shows |--------|--------|
- ✅ Data rows are properly formatted

**If Tables Still Render as Raw Markdown**:
- This is expected for OLD responses (already in database)
- Only NEW responses will have proper table formatting
- Try asking a completely new question

### 5. Test Multiple Citations in One Response

**Steps**:
1. Ask: "What are NVIDIA's risks and opportunities?"
2. Response should have multiple citations [1], [2], [3], [4], [5]
3. Click on each citation

**Expected Result**:
- ✅ Each citation opens modal with correct content
- ✅ Modal opens only once per click
- ✅ No duplicate modals appear
- ✅ Citations are independent (clicking [2] doesn't affect [1])

## Browser Console Checks

Open browser console (F12) and look for these logs:

### Good Logs (Expected):
```
🔗 Citation clicked: 1
🖱️ handleCitationClickByNumber called: 1
  - currentCitations: Array(5)
  - Found citation: {number: 1, ticker: "NVDA", ...}
  ✅ Opening modal for citation
📋 handleSecFilingCitation called: {number: 1, ...}
  - sourceModal set: {ticker: "NVDA", ...}
  - showSourceModal value: true
  ✅ Modal should be visible now
```

### Bad Logs (Issues):
```
❌ Citation not found: 1
  - This means currentCitations is empty or citation number doesn't match
  
Multiple "🔗 Citation clicked" logs for single click
  - This means multiple event handlers are registered
  - Should be fixed by the global flag
```

## Troubleshooting

### Modal Opens Multiple Times
**Cause**: Event listener registered multiple times
**Fix**: Already implemented with `window._citationHandlerRegistered` flag
**Verify**: Check console for `window._citationHandlerRegistered` value

### Modal Not Visible
**Cause**: Modal outside Alpine.js component
**Fix**: Already implemented - duplicate modal removed
**Verify**: Check HTML structure - modal should be inside `<div x-data="dealWorkspace()">`

### Text Cutoff in Modal
**Cause**: Incorrect CSS for text wrapping
**Fix**: Already implemented - inline style with proper word wrapping
**Verify**: Check modal excerpt has style: `white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word;`

### Tables Render as Raw Markdown
**Cause**: System prompt missing table formatting instruction
**Status**: System prompt already has instruction (line 608 in bedrock.service.ts)
**Note**: Only affects NEW responses. Old responses won't be fixed.
**Workaround**: Ask a new question to get properly formatted tables

## Success Criteria

All of these should work:
- ✅ Modal opens once per click (no duplicates)
- ✅ Modal is fully visible with all content
- ✅ Text wraps properly (no cutoff)
- ✅ Close button, Esc key, and click-away all work
- ✅ Copy citation works
- ✅ Multiple citations work independently
- ✅ NEW responses have properly formatted tables

## Next Steps

If all tests pass:
1. Mark Task 5 as complete in tasks.md
2. Move to Task 4 (Integration Testing and Validation)
3. Test with different query types
4. Validate synthesis quality

If any tests fail:
1. Check browser console for errors
2. Verify HTML structure (modal inside Alpine.js component)
3. Verify event listener deduplication (global flag)
4. Check for any JavaScript errors
