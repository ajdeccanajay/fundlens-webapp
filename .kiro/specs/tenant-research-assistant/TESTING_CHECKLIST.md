# Testing Checklist - Research Tools Integration

**Date**: January 26, 2026  
**Page**: `comprehensive-financial-analysis.html`  
**Status**: Ready for Testing

---

## Pre-Testing Setup

### 1. Start Backend Server
```bash
npm run start:dev
```
Wait for: "Nest application successfully started"

### 2. Verify Authentication
- Ensure you have a valid auth token
- Login at: `http://localhost:3000/login.html`
- Token stored as `fundlens_token` or `authToken`

### 3. Load Test Data
- Ensure at least one company is ingested (e.g., AAPL)
- Verify SEC data is available

---

## Test 1: Page Load & Initialization

### Steps
1. Open: `http://localhost:3000/comprehensive-financial-analysis.html?ticker=AAPL`
2. Wait for page to load

### Expected Results
- ✅ Page loads without errors
- ✅ Header shows "AAPL - 5 Year Analysis"
- ✅ Three navigation buttons visible:
  - Research Assistant
  - Scratchpad (with count badge)
  - IC Memo
- ✅ Financial metrics load and display
- ✅ No console errors

### Pass/Fail: ⬜

---

## Test 2: Research Assistant Modal

### Test 2.1: Open Modal
**Steps**:
1. Click "Research Assistant" button

**Expected**:
- ✅ Modal opens with fade-in animation
- ✅ Welcome screen displays
- ✅ Shows current ticker (AAPL) in header
- ✅ Two quick query cards visible
- ✅ Input box at bottom

**Pass/Fail**: ⬜

### Test 2.2: Send Message
**Steps**:
1. Type: "What are the key risks for AAPL?"
2. Press Enter

**Expected**:
- ✅ User message appears (purple bubble, right-aligned)
- ✅ Typing indicator appears
- ✅ Assistant response streams in
- ✅ Response has "Save to Scratchpad" button
- ✅ Auto-scrolls to bottom

**Pass/Fail**: ⬜

### Test 2.3: Quick Query
**Steps**:
1. Refresh page
2. Open Research Assistant
3. Click "Risk Analysis" quick query card

**Expected**:
- ✅ Query auto-fills input
- ✅ Message sends automatically
- ✅ Response streams in

**Pass/Fail**: ⬜

### Test 2.4: Close Modal
**Steps**:
1. Click X button or click outside modal

**Expected**:
- ✅ Modal closes with fade-out animation
- ✅ Messages persist (don't disappear)

**Pass/Fail**: ⬜

---

## Test 3: Scratchpad Panel

### Test 3.1: Open Scratchpad (Empty)
**Steps**:
1. Click "Scratchpad" button

**Expected**:
- ✅ Panel slides in from right
- ✅ Shows empty state message
- ✅ "No saved items yet" text
- ✅ Export button visible but disabled/empty

**Pass/Fail**: ⬜

### Test 3.2: Save Item from Research
**Steps**:
1. Open Research Assistant
2. Send a message and get response
3. Click "Save to Scratchpad" button
4. Modal opens
5. Add notes: "Important insight about revenue"
6. Click "Save"

**Expected**:
- ✅ Save modal opens
- ✅ Notes textarea visible
- ✅ Save button works
- ✅ Modal closes
- ✅ Success (no error)

**Pass/Fail**: ⬜

### Test 3.3: View Saved Item
**Steps**:
1. Open Scratchpad panel
2. Verify item appears

**Expected**:
- ✅ Saved item displays
- ✅ Content rendered as markdown
- ✅ User notes visible
- ✅ Timestamp shows (e.g., "Just now")
- ✅ Delete button (trash icon) visible
- ✅ Count badge updates (shows "1")

**Pass/Fail**: ⬜

### Test 3.4: Export Scratchpad
**Steps**:
1. Click "Export to Markdown" button

**Expected**:
- ✅ File downloads
- ✅ Filename: `AAPL-research-notes-YYYY-MM-DD.md`
- ✅ File contains saved items
- ✅ Markdown formatting correct

**Pass/Fail**: ⬜

### Test 3.5: Delete Item
**Steps**:
1. Click trash icon on saved item
2. Confirm deletion

**Expected**:
- ✅ Confirmation dialog appears
- ✅ Item removed from list
- ✅ Count badge updates (shows "0")
- ✅ Empty state appears

**Pass/Fail**: ⬜

### Test 3.6: Close Panel
**Steps**:
1. Click X button

**Expected**:
- ✅ Panel slides out to right
- ✅ Smooth animation

**Pass/Fail**: ⬜

---

## Test 4: IC Memo Generator

### Test 4.1: Open IC Memo Modal
**Steps**:
1. Click "IC Memo" button

**Expected**:
- ✅ Modal opens with fade-in animation
- ✅ Shows generator screen
- ✅ Current ticker (AAPL) in header
- ✅ "Generate IC Memo" button visible
- ✅ Info box shows what will be included

**Pass/Fail**: ⬜

### Test 4.2: Generate Memo (No Scratchpad Items)
**Steps**:
1. Ensure scratchpad is empty
2. Click "Generate IC Memo"

**Expected**:
- ✅ Button shows spinner
- ✅ "Generating Memo..." text
- ✅ Memo generates (may take a few seconds)
- ✅ Memo displays with markdown formatting
- ✅ Includes:
  - Title with ticker
  - Date
  - Executive Summary
  - Financial Highlights (if data loaded)
  - Recommendation section

**Pass/Fail**: ⬜

### Test 4.3: Generate Memo (With Scratchpad Items)
**Steps**:
1. Add 2-3 items to scratchpad
2. Open IC Memo modal
3. Click "Generate IC Memo"

**Expected**:
- ✅ Memo generates
- ✅ Includes "Research Notes" section
- ✅ Shows all scratchpad items
- ✅ Includes user notes

**Pass/Fail**: ⬜

### Test 4.4: Download Memo
**Steps**:
1. Click "Download as PDF" button

**Expected**:
- ✅ File downloads
- ✅ Filename: `AAPL-IC-Memo-YYYY-MM-DD.md`
- ✅ File contains full memo content
- ✅ Markdown formatting preserved

**Pass/Fail**: ⬜

### Test 4.5: Generate New Memo
**Steps**:
1. Click "Generate New" button

**Expected**:
- ✅ Returns to generator screen
- ✅ Previous memo cleared
- ✅ Can generate again

**Pass/Fail**: ⬜

### Test 4.6: Close Modal
**Steps**:
1. Click X button

**Expected**:
- ✅ Modal closes
- ✅ Smooth animation

**Pass/Fail**: ⬜

---

## Test 5: Integration & Data Flow

### Test 5.1: Full Workflow
**Steps**:
1. Load page with ticker: AAPL
2. Open Research Assistant
3. Ask 3 different questions
4. Save all 3 responses to scratchpad
5. Open scratchpad and verify all 3 items
6. Generate IC Memo
7. Verify memo includes all 3 research notes
8. Download memo
9. Export scratchpad

**Expected**:
- ✅ All steps complete without errors
- ✅ Data flows correctly between components
- ✅ Files download successfully
- ✅ Content is accurate

**Pass/Fail**: ⬜

### Test 5.2: Ticker Context
**Steps**:
1. Load page with ticker: AAPL
2. Open Research Assistant
3. Ask: "What is the revenue?"
4. Verify response is about AAPL

**Expected**:
- ✅ Research Assistant knows current ticker
- ✅ Responses are contextual to AAPL
- ✅ IC Memo includes AAPL in title

**Pass/Fail**: ⬜

### Test 5.3: Cross-Company Query
**Steps**:
1. Load page with ticker: AAPL
2. Open Research Assistant
3. Ask: "Compare AAPL and MSFT revenue"

**Expected**:
- ✅ Query works
- ✅ Response includes both companies
- ✅ Can query beyond current ticker

**Pass/Fail**: ⬜

---

## Test 6: Error Handling

### Test 6.1: No Ticker Loaded
**Steps**:
1. Open page without ticker parameter
2. Try to click "Research Assistant"

**Expected**:
- ✅ Button is disabled
- ✅ Cursor shows "not-allowed"
- ✅ Button appears grayed out

**Pass/Fail**: ⬜

### Test 6.2: Network Error
**Steps**:
1. Stop backend server
2. Try to send research message

**Expected**:
- ✅ Error message displays
- ✅ No crash
- ✅ Can retry after server restart

**Pass/Fail**: ⬜

### Test 6.3: Empty Message
**Steps**:
1. Open Research Assistant
2. Try to send empty message

**Expected**:
- ✅ Send button disabled
- ✅ Nothing happens

**Pass/Fail**: ⬜

---

## Test 7: UI/UX

### Test 7.1: Button States
**Steps**:
1. Observe all three navigation buttons

**Expected**:
- ✅ Hover effects work
- ✅ Icons display correctly
- ✅ Text readable
- ✅ Disabled states clear

**Pass/Fail**: ⬜

### Test 7.2: Animations
**Steps**:
1. Open/close each modal and panel

**Expected**:
- ✅ Smooth fade in/out (200ms)
- ✅ Scratchpad slides smoothly
- ✅ No jank or flicker
- ✅ Typing indicator animates

**Pass/Fail**: ⬜

### Test 7.3: Responsive Design
**Steps**:
1. Resize browser window
2. Test on mobile viewport (375px)

**Expected**:
- ✅ Modals scale appropriately
- ✅ Text remains readable
- ✅ Buttons accessible
- ✅ No horizontal scroll

**Pass/Fail**: ⬜

### Test 7.4: Markdown Rendering
**Steps**:
1. Send message with markdown:
   ```
   **Bold text**
   *Italic text*
   - List item 1
   - List item 2
   ```

**Expected**:
- ✅ Bold renders correctly
- ✅ Italic renders correctly
- ✅ Lists formatted properly
- ✅ Code blocks highlighted

**Pass/Fail**: ⬜

---

## Test 8: Performance

### Test 8.1: Page Load Time
**Steps**:
1. Open page with ticker
2. Measure time to interactive

**Expected**:
- ✅ Page loads in < 2 seconds
- ✅ No blocking scripts
- ✅ Smooth rendering

**Pass/Fail**: ⬜

### Test 8.2: Streaming Performance
**Steps**:
1. Send research message
2. Observe streaming

**Expected**:
- ✅ Tokens appear smoothly
- ✅ No lag or stuttering
- ✅ Auto-scroll works

**Pass/Fail**: ⬜

### Test 8.3: Large Scratchpad
**Steps**:
1. Add 20+ items to scratchpad
2. Open scratchpad panel

**Expected**:
- ✅ Panel opens quickly
- ✅ Scrolling is smooth
- ✅ No performance degradation

**Pass/Fail**: ⬜

---

## Test 9: Browser Compatibility

### Test 9.1: Chrome
**Steps**: Run all tests in Chrome

**Pass/Fail**: ⬜

### Test 9.2: Firefox
**Steps**: Run all tests in Firefox

**Pass/Fail**: ⬜

### Test 9.3: Safari
**Steps**: Run all tests in Safari

**Pass/Fail**: ⬜

---

## Test 10: Console & Network

### Test 10.1: Console Errors
**Steps**:
1. Open DevTools Console
2. Run through all features

**Expected**:
- ✅ No errors
- ✅ No warnings (or only expected ones)
- ✅ Clean console

**Pass/Fail**: ⬜

### Test 10.2: Network Requests
**Steps**:
1. Open DevTools Network tab
2. Run through all features

**Expected**:
- ✅ All API calls succeed (200/201)
- ✅ Proper auth headers
- ✅ No failed requests

**Pass/Fail**: ⬜

---

## Summary

### Total Tests: 40+
### Passed: ___
### Failed: ___
### Blocked: ___

### Critical Issues Found:
1. 
2. 
3. 

### Minor Issues Found:
1. 
2. 
3. 

### Notes:


---

## Sign-Off

**Tester Name**: _______________  
**Date**: _______________  
**Status**: ⬜ Pass ⬜ Fail ⬜ Needs Work

---

**Next Steps**:
- [ ] Fix critical issues
- [ ] Address minor issues
- [ ] Re-test failed scenarios
- [ ] Deploy to staging
- [ ] User acceptance testing
