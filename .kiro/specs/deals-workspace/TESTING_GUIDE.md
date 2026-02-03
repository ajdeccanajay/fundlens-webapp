# Deal Workspace - Testing Guide

**Date**: January 26, 2026  
**Phase**: 1 - Foundation  
**Status**: Ready for Testing

---

## 🚀 Quick Start

### 1. Start the Backend
```bash
# Terminal 1: Start NestJS backend
npm run start:dev

# Terminal 2: Start Python parser (if needed)
cd python_parser
python api_server.py
```

### 2. Open the Workspace
```
http://localhost:3000/app/deals/workspace.html?ticker=AAPL
```

---

## 🧪 Test Scenarios

### Scenario 1: Navigation Testing

#### Test 1.1: Sidebar Navigation
1. Open workspace
2. Click "Analysis" → Should show analysis view
3. Click "Research" → Should show research view
4. Click "Scratchpad" → Should show scratchpad view
5. Click "IC Memo" → Should show IC memo view

**Expected**: Each view loads correctly, active state highlights

#### Test 1.2: Keyboard Shortcuts
1. Open workspace
2. Press `Cmd+1` (or `Ctrl+1` on Windows) → Analysis view
3. Press `Cmd+2` → Research view
4. Press `Cmd+3` → Scratchpad view
5. Press `Cmd+4` → IC Memo view

**Expected**: Views switch instantly, URL hash updates

#### Test 1.3: URL Hash Navigation
1. Open `workspace.html?ticker=AAPL#research`
2. Should load directly to Research view
3. Change URL to `#scratchpad`
4. Should switch to Scratchpad view

**Expected**: Direct navigation works, browser back/forward works

---

### Scenario 2: Analysis View Testing

#### Test 2.1: Quantitative Tab
1. Navigate to Analysis view
2. Click "Quantitative" tab
3. Wait for data to load

**Expected**:
- Loading spinner appears
- 4 metric cards display (Revenue, Net Income, Op Margin, FCF)
- Values formatted correctly ($XXX.XB)
- Growth percentages shown
- Cards have gradient backgrounds

#### Test 2.2: Qualitative Tab
1. Click "Qualitative" tab
2. Wait for data to load

**Expected**:
- Loading spinner appears
- QA cards display
- Questions and answers formatted correctly
- Cards have left border (FundLens blue)

#### Test 2.3: Export Tab
1. Click "Export" tab
2. Click "Export to Excel" button

**Expected**:
- Excel file downloads
- Filename: `{TICKER}-Financial-Statements-{DATE}.xlsx`
- File contains financial data

---

### Scenario 3: Research View Testing

#### Test 3.1: Empty State
1. Navigate to Research view (first time)

**Expected**:
- Brain icon displayed
- "Research Assistant" title
- 2 quick query buttons (Risk Analysis, Compare)

#### Test 3.2: Quick Query
1. Click "Risk Analysis" button

**Expected**:
- Query appears in input
- Message sent automatically
- User message appears (right side, gradient background)
- Assistant response appears (left side, white background)
- "Save to Scratchpad" button visible

#### Test 3.3: Manual Query
1. Type "What is the revenue?" in input
2. Press Enter (or click send button)

**Expected**:
- Message sent
- User message appears
- Assistant response appears
- Input clears

#### Test 3.4: Save to Scratchpad
1. Send a message
2. Wait for response
3. Click "Save to Scratchpad" button
4. Enter notes (optional)
5. Click OK

**Expected**:
- Alert: "Saved to scratchpad!"
- Scratchpad badge count increases
- Item appears in Scratchpad view

---

### Scenario 4: Scratchpad View Testing

#### Test 4.1: Empty State
1. Navigate to Scratchpad view (no items)

**Expected**:
- Bookmark icon displayed
- "No saved items yet" message
- Instructions to save from Research

#### Test 4.2: View Items
1. Navigate to Scratchpad view (with items)

**Expected**:
- All saved items displayed
- Content rendered (markdown if applicable)
- Notes displayed (if any)
- Timestamp shown
- Delete button visible

#### Test 4.3: Delete Item
1. Click delete button (trash icon)
2. Confirm deletion

**Expected**:
- Confirmation dialog appears
- Item removed from list
- Badge count decreases

#### Test 4.4: Export to Markdown
1. Click "Export to Markdown" button

**Expected**:
- Markdown file downloads
- Filename: `scratchpad-{TICKER}-{DATE}.md`
- File contains all items

---

### Scenario 5: IC Memo View Testing

#### Test 5.1: Generate Memo
1. Navigate to IC Memo view
2. Click "Generate Memo" button

**Expected**:
- Loading state (if applicable)
- Memo content appears
- Formatted with headings, lists, etc.
- Download PDF button visible
- "Generate New" button visible

#### Test 5.2: Download PDF
1. After generating memo
2. Click "Download PDF" button

**Expected**:
- PDF file downloads
- Filename: `IC-Memo-{TICKER}-{DATE}.pdf`
- File contains memo content

#### Test 5.3: Generate New
1. After generating memo
2. Click "Generate New" button

**Expected**:
- Returns to generation screen
- Can generate another memo

---

### Scenario 6: Cross-View Testing

#### Test 6.1: Scratchpad Count Badge
1. Navigate to Research view
2. Save 3 messages to scratchpad
3. Check sidebar

**Expected**:
- Badge shows "3"
- Badge updates in real-time

#### Test 6.2: Data Persistence
1. Save items to scratchpad
2. Navigate to Analysis view
3. Navigate back to Scratchpad view

**Expected**:
- Items still there
- No data loss

#### Test 6.3: Multiple Tickers
1. Open workspace with `?ticker=AAPL`
2. Note the data
3. Change URL to `?ticker=MSFT`
4. Refresh page

**Expected**:
- New ticker data loads
- Deal info updates in header

---

## 🐛 Bug Reporting

### If You Find a Bug

**Report Format**:
```
Title: [Brief description]

Steps to Reproduce:
1. Step 1
2. Step 2
3. Step 3

Expected Behavior:
[What should happen]

Actual Behavior:
[What actually happened]

Browser: [Chrome/Firefox/Safari/Edge]
Version: [Browser version]
OS: [macOS/Windows/Linux]

Screenshots: [If applicable]
Console Errors: [If any]
```

---

## ✅ Success Criteria

### Phase 1 Complete When:
- [ ] All navigation works (sidebar, keyboard, hash)
- [ ] All 4 views load correctly
- [ ] Analysis view shows metrics
- [ ] Research chat sends/receives messages
- [ ] Scratchpad saves/deletes items
- [ ] IC Memo generates and downloads
- [ ] Export to Excel works
- [ ] No console errors
- [ ] FundLens colors applied correctly
- [ ] Animations smooth
- [ ] Loading states work
- [ ] Empty states work

---

## 📊 Performance Checklist

### Page Load
- [ ] Initial load < 2s
- [ ] View switching < 100ms
- [ ] No layout shifts
- [ ] No memory leaks

### Interactions
- [ ] Button clicks responsive
- [ ] Form submissions fast
- [ ] API calls complete
- [ ] Downloads work

---

## 🔍 Browser Compatibility

### Test On:
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)

### Known Issues:
- None yet

---

## 📱 Responsive Testing

### Desktop (1920x1080)
- [ ] Sidebar visible
- [ ] Content not cramped
- [ ] All features accessible

### Laptop (1440x900)
- [ ] Sidebar visible
- [ ] Content readable
- [ ] All features accessible

### Tablet (768x1024)
- [ ] Sidebar collapsible (future)
- [ ] Content stacks properly
- [ ] Touch targets large enough

---

## 🎯 Next Phase Preview

### Phase 2: Analysis View Enhancement
Will add:
- Full annual data tables
- Charts and visualizations
- More detailed metrics
- Enhanced export wizard

### Phase 3: Research Chat Enhancement
Will add:
- Conversation history
- Streaming responses
- Source citations
- Context management

---

## 📞 Support

### Questions?
- Check `.kiro/specs/deals-workspace/IMPLEMENTATION_PLAN.md`
- Check `.kiro/specs/deals-workspace/PHASE1_COMPLETE.md`
- Review existing code in `public/comprehensive-financial-analysis.html`

### Issues?
- Check browser console for errors
- Check network tab for failed API calls
- Check backend logs for server errors

---

**Happy Testing!** 🎉

