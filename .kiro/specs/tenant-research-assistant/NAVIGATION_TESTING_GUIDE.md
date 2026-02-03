# Navigation Testing Guide

Quick guide to test the new enterprise navigation system.

---

## Prerequisites

1. **Start the backend:**
   ```bash
   npm run start:dev
   ```

2. **Have a deal created** (or use existing deal ID)

---

## Test Scenarios

### 1. Navigation on Deal Analysis Page

**URL**: `http://localhost:3000/deal-analysis.html?id={deal-id}`

**Expected**:
- ✅ Navigation bar appears at top
- ✅ Breadcrumbs show: `Home / {TICKER} / Analysis`
- ✅ "Deal Analysis" is highlighted (active)
- ✅ All 4 nav items visible: Deal Analysis, Research Assistant, Scratchpad, IC Memo
- ✅ Help icon on right side

**Test**:
1. Click "Research Assistant" → Should navigate to research page
2. Click "Scratchpad" → Should show coming soon or navigate
3. Click "IC Memo" → Should show coming soon message
4. Click help icon → Help panel should slide down
5. Click help icon again → Help panel should hide

---

### 2. Navigation on Research Assistant Page

**URL**: `http://localhost:3000/app/research/index.html`

**Expected**:
- ✅ Navigation bar appears at top
- ✅ Breadcrumbs show: `Home / Research Assistant`
- ✅ "Research Assistant" is highlighted (active)
- ✅ Scratchpad badge shows count if items exist
- ✅ Old navigation is removed (no duplicate nav)

**Test**:
1. Save an answer to scratchpad
2. Badge count should update to show "1"
3. Click "Scratchpad" in nav → Panel should slide in
4. Delete the item → Badge should update to "0" or hide
5. Click "Deal Analysis" → Should navigate to deals list (no deal context)

---

### 3. Breadcrumb Navigation

**Test Flow**:
1. Start on deal analysis page
   - Breadcrumbs: `Home / AAPL / Analysis`
2. Click "Research Assistant"
   - Breadcrumbs: `Home / AAPL / Research Assistant`
3. Click "Home" in breadcrumbs
   - Should go to deals list
4. Open research page directly
   - Breadcrumbs: `Home / Research Assistant` (no ticker)

**Expected**:
- ✅ Breadcrumbs always show current location
- ✅ Ticker appears when in deal context
- ✅ Ticker disappears when no deal context
- ✅ Breadcrumb links are clickable

---

### 4. Help Panel

**Test**:
1. Click help icon (question mark)
2. Panel should slide down with blue background
3. Read the content:
   - ✅ Explains each feature
   - ✅ Shows workflow tips
   - ✅ Highlights cross-company capability
   - ✅ Provides example query
4. Click help icon again
5. Panel should slide up and hide

**Expected Content**:
```
Research Workflow

• Deal Analysis: View financial metrics and pipeline status for this specific deal
• Research Assistant: Chat across ALL companies in your database - ask comparative questions, analyze trends
• Scratchpad: Save favorite answers and insights from your research for quick reference
• IC Memo: Export your research and analysis into a formatted Investment Committee memo

Tip: The Research Assistant can query across multiple companies simultaneously.
Example: "Compare AAPL, MSFT, and GOOGL revenue growth over the last 3 years"
```

---

### 5. Scratchpad Badge

**Test**:
1. Open research page
2. Badge should show current count or be hidden if 0
3. Save an answer
4. Badge should update immediately
5. Save another answer
6. Badge should show "2"
7. Delete one item
8. Badge should show "1"
9. Delete all items
10. Badge should hide

**Expected**:
- ✅ Badge shows correct count
- ✅ Badge updates in real-time
- ✅ Badge hides when count is 0
- ✅ Badge is blue with white text

---

### 6. Active State Highlighting

**Test**:
1. On deal analysis page
   - "Deal Analysis" should be highlighted
2. On research page
   - "Research Assistant" should be highlighted
3. Highlighted item should have:
   - ✅ Blue background
   - ✅ White text
   - ✅ Blue bottom border
   - ✅ Subtle glow effect

---

### 7. Hover Effects

**Test**:
1. Hover over each nav item
2. Should see:
   - ✅ Background color change (blue tint)
   - ✅ Text color change (lighter)
   - ✅ Smooth transition
3. Hover over help icon
4. Should see same hover effect

---

### 8. Responsive Design

**Test**:
1. Resize browser to mobile width (375px)
2. Navigation should still be visible
3. Some labels may be abbreviated
4. Icons should always be visible
5. Breadcrumbs should condense

**Expected**:
- ✅ Navigation works on mobile
- ✅ No horizontal scrolling
- ✅ All items accessible
- ✅ Touch-friendly tap targets

---

### 9. Cross-Page Navigation

**Test Flow**:
1. Start on deal analysis for AAPL
2. Click "Research Assistant"
3. Ask: "Compare AAPL and MSFT revenue"
4. Save the answer
5. Click "Scratchpad" → Panel opens
6. Click "Deal Analysis" → Goes back to AAPL deal
7. Click "Research Assistant" again
8. Scratchpad badge still shows "1"

**Expected**:
- ✅ Navigation persists across pages
- ✅ State is maintained (badge count)
- ✅ Context is preserved (deal ID)
- ✅ No page reload issues

---

### 10. IC Memo Button

**Test**:
1. Click "IC Memo" button
2. Should show alert:
   ```
   IC Memo Export
   
   Export your research and scratchpad items into a formatted Investment Committee memo.
   
   Coming soon!
   ```

**Expected**:
- ✅ Alert appears
- ✅ Message is clear
- ✅ No errors in console

---

## Quick Smoke Test (3 Minutes)

1. ✅ Open deal analysis page
2. ✅ Navigation appears at top
3. ✅ Breadcrumbs show correctly
4. ✅ Click "Research Assistant"
5. ✅ Navigation updates (active state)
6. ✅ Save an answer
7. ✅ Badge shows "1"
8. ✅ Click "Scratchpad" in nav
9. ✅ Panel opens
10. ✅ Click help icon
11. ✅ Help panel appears
12. ✅ Click help icon again
13. ✅ Help panel hides

**If all 13 steps work, navigation is functioning correctly!**

---

## Common Issues

### Navigation doesn't appear
- Check browser console for errors
- Verify `/components/research-navigation.html` exists
- Check network tab for 404 errors
- Verify `initResearchNav()` is called

### Badge doesn't update
- Check scratchpad API is working
- Verify `updateNavigationBadge()` is called
- Check browser console for errors
- Refresh the page

### Active state wrong
- Verify correct page identifier passed to `initResearchNav()`
- Check `data-page` attributes match
- Inspect element to see classes

### Breadcrumbs wrong
- Verify deal ID and ticker passed correctly
- Check `updateBreadcrumbs()` function
- Inspect breadcrumb elements

---

## Browser Testing

Test on:
- [ ] Chrome (desktop)
- [ ] Firefox (desktop)
- [ ] Safari (desktop)
- [ ] Edge (desktop)
- [ ] Chrome (mobile)
- [ ] Safari (mobile)

---

## Accessibility Testing

- [ ] Tab through all nav items
- [ ] Enter key activates items
- [ ] Screen reader announces labels
- [ ] Color contrast is sufficient
- [ ] Focus indicators visible

---

## Performance Testing

- [ ] Navigation loads quickly (<100ms)
- [ ] No layout shift when loading
- [ ] Smooth animations
- [ ] No memory leaks
- [ ] Badge updates instantly

---

## Success Criteria

All features working:
- ✅ Navigation appears on all pages
- ✅ Active state highlights correctly
- ✅ Breadcrumbs show current location
- ✅ Badge shows scratchpad count
- ✅ Help panel toggles
- ✅ All links work
- ✅ Responsive design
- ✅ Smooth animations
- ✅ No console errors

**If all checkboxes are checked, navigation is production-ready!**

---

## URLs for Testing

```
# Deal Analysis (replace {deal-id} with actual ID)
http://localhost:3000/deal-analysis.html?id={deal-id}

# Research Assistant
http://localhost:3000/app/research/index.html

# Deals List
http://localhost:3000/app/deals/index.html
```

---

## Test Data

Use these to test cross-company research:

1. "What is AAPL revenue for FY2024?"
2. "Compare MSFT and GOOGL cloud revenue"
3. "Show me TSLA operating margin trend"
4. "What are the key risks for NVDA?"
5. "Explain AMZN business model"

Each will generate an answer you can save to test the badge.

---

**Happy Testing!** 🧪
