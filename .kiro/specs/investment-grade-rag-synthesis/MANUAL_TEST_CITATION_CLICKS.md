# Manual Testing Guide - Citation Clicks

## Prerequisites
- Server running on `http://localhost:3000`
- Logged in with valid credentials
- NVDA data loaded in database

## Test 1: Basic Citation Click

### Steps
1. Navigate to: `http://localhost:3000/app/deals/workspace.html?ticker=NVDA`
2. Click on "Research Assistant" tab
3. Type: "What are NVDA's risks?"
4. Wait for response to complete
5. Look for citations in the response like [1], [2], [3]
6. Click on [1]

### Expected Results
✅ Modal opens immediately
✅ Modal shows:
   - Header: "NVDA 10-K FY2024" (or similar)
   - Section: "Item 1A. Risk Factors" (or similar)
   - Excerpt: Text from the filing
   - Relevance score: XX% relevant
✅ Modal has "Copy Citation" and "Close" buttons

### Failure Indicators
❌ Nothing happens when clicking [1]
❌ Console error: "Citation not found"
❌ Modal shows empty/undefined values

## Test 2: Multiple Citations

### Steps
1. Same setup as Test 1
2. Click on [1], verify modal opens
3. Close modal (click X or press Esc)
4. Click on [2], verify modal opens with DIFFERENT content
5. Close modal
6. Click on [3], verify modal opens with DIFFERENT content

### Expected Results
✅ Each citation opens modal with unique content
✅ Modal updates correctly for each citation
✅ No "stale" data from previous citation

## Test 3: Copy Citation

### Steps
1. Click on any citation [1]
2. Modal opens
3. Click "Copy Citation" button
4. Paste into a text editor (Cmd+V)

### Expected Results
✅ Citation copied to clipboard
✅ Format: "NVDA 10-K FY2024, Item 1A. Risk Factors"
✅ Toast notification: "Citation copied to clipboard"
✅ Modal closes automatically

## Test 4: Modal Close Methods

### Steps
1. Click on [1] to open modal
2. Press Esc key → Modal should close
3. Click on [1] again
4. Click outside modal (on dark overlay) → Modal should close
5. Click on [1] again
6. Click X button → Modal should close

### Expected Results
✅ All three methods close the modal
✅ No console errors

## Test 5: No Orphaned Pills

### Steps
1. Same setup as Test 1
2. After response completes, scroll to bottom of message
3. Look below the message content

### Expected Results
✅ NO blue pills with "NVDA-10Q" or similar
✅ Only citations [1], [2], [3] visible in the text
✅ Clean, professional appearance

## Test 6: Different Query Types

### Test 6a: Financial Query
**Query:** "What was NVDA's revenue growth?"
**Expected:** Citations appear, clickable, modal works

### Test 6b: Competitive Query
**Query:** "Who are NVDA's main competitors?"
**Expected:** Citations appear, clickable, modal works

### Test 6c: Business Model Query
**Query:** "How does NVDA make money?"
**Expected:** Citations appear, clickable, modal works

## Debugging

### If Citations Don't Appear
1. Open browser console (F12)
2. Look for: `📎 Added citations: X`
3. If missing, backend may not be sending citations
4. Check: `src/research/research-assistant.service.ts` - citations event

### If Clicks Don't Work
1. Open browser console (F12)
2. Click on [1]
3. Look for: `Citation clicked: 1`
4. If missing, event delegation not working
5. Check: `public/app/deals/workspace.html` - init() section

### If Modal Shows Wrong Data
1. Open browser console (F12)
2. Type: `Alpine.store('workspace').currentCitations`
3. Verify citations array has correct data
4. Check: `renderMarkdownWithCitations()` stores citations

### If Modal Shows "undefined"
1. Backend may not be passing all fields
2. Check: `src/research/research-assistant.service.ts` - citation mapping
3. Verify: `ticker`, `filingType`, `fiscalPeriod`, `section`, `excerpt` are present

## Success Criteria

✅ All citations are clickable
✅ Modal opens with correct source details
✅ Copy citation works
✅ No orphaned pills
✅ Professional, trustworthy appearance
✅ No console errors

## Common Issues

### Issue: "Citation not found" error
**Cause:** Citation number mismatch
**Fix:** Check `currentCitations` array has correct `number` field

### Issue: Modal shows empty values
**Cause:** Backend not passing all fields
**Fix:** Verify citation mapping in `research-assistant.service.ts`

### Issue: Clicks do nothing
**Cause:** Event delegation not set up
**Fix:** Verify init() has click event listener

### Issue: Orphaned pills still appear
**Cause:** Source pills not commented out
**Fix:** Comment out source pills HTML in workspace.html
