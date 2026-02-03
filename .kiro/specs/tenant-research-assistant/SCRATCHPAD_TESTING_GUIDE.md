# Scratchpad Testing Guide

Quick guide to manually test the new scratchpad feature.

---

## Prerequisites

1. **Start the backend:**
   ```bash
   npm run start:dev
   ```

2. **Open the Research Assistant:**
   ```
   http://localhost:3000/app/research/
   ```

3. **Login** (if not already logged in)

---

## Test Scenarios

### 1. Open/Close Scratchpad Panel

**Steps:**
1. Look for "Scratchpad" button in top navigation
2. Click "Scratchpad" button
3. Panel should slide in from the right
4. Click the X button in panel header
5. Panel should slide out

**Expected:**
- ✅ Panel slides in smoothly
- ✅ Panel slides out smoothly
- ✅ Button highlights when panel is open

---

### 2. Save Answer Without Notes

**Steps:**
1. Create a new conversation
2. Ask a question (e.g., "What is AAPL revenue?")
3. Wait for assistant response
4. Click "Save" button below the response
5. Modal should appear
6. Click "Save" button (without adding notes)
7. Modal should close

**Expected:**
- ✅ Save button appears on assistant messages
- ✅ Modal opens when clicking Save
- ✅ Modal closes after saving
- ✅ Item appears in scratchpad

---

### 3. Save Answer With Notes

**Steps:**
1. Ask another question
2. Click "Save" on the response
3. Type notes in the textarea (e.g., "Important for Q4 analysis")
4. Click "Save"
5. Open scratchpad panel
6. Find the saved item
7. Verify notes appear below the content

**Expected:**
- ✅ Notes textarea is visible in modal
- ✅ Notes are saved with the item
- ✅ Notes display in scratchpad panel

---

### 4. View Saved Items

**Steps:**
1. Open scratchpad panel
2. Verify all saved items are listed
3. Check that markdown is rendered (bold, italic, lists, etc.)
4. Check that timestamps are shown
5. Scroll through items if many

**Expected:**
- ✅ All saved items visible
- ✅ Markdown renders correctly
- ✅ Timestamps show relative time (e.g., "2h ago")
- ✅ User notes display below content

---

### 5. Item Count Badge

**Steps:**
1. Save 3 different answers
2. Look at "Scratchpad" button in top nav
3. Verify badge shows "3"
4. Delete one item
5. Verify badge shows "2"

**Expected:**
- ✅ Badge appears when items exist
- ✅ Badge shows correct count
- ✅ Badge updates when items added/deleted

---

### 6. Delete Item

**Steps:**
1. Open scratchpad panel
2. Click trash icon on any item
3. Confirm deletion in dialog
4. Item should disappear

**Expected:**
- ✅ Confirmation dialog appears
- ✅ Item is removed after confirmation
- ✅ Panel updates immediately
- ✅ Item count badge updates

---

### 7. Export to Markdown

**Steps:**
1. Save 2-3 items to scratchpad
2. Open scratchpad panel
3. Click "Export to Markdown" button
4. File should download
5. Open the downloaded .md file
6. Verify content is correct

**Expected:**
- ✅ File downloads automatically
- ✅ Filename includes date (e.g., `research-notes-2026-01-26.md`)
- ✅ File contains all saved items
- ✅ Markdown formatting is preserved
- ✅ User notes are included

---

### 8. Empty State

**Steps:**
1. Delete all items from scratchpad
2. Open scratchpad panel
3. Verify empty state message

**Expected:**
- ✅ Shows bookmark icon
- ✅ Shows "No saved items yet"
- ✅ Shows "Click 'Save' on any answer"

---

### 9. Cancel Save Modal

**Steps:**
1. Click "Save" on a message
2. Type some notes
3. Click "Cancel"
4. Modal should close
5. Item should NOT be saved

**Expected:**
- ✅ Modal closes
- ✅ Item is not saved
- ✅ Notes are cleared

---

### 10. Responsive Design

**Steps:**
1. Resize browser window to mobile size (375px)
2. Verify scratchpad button is visible
3. Open scratchpad panel
4. Verify panel is readable on mobile
5. Test all features on mobile

**Expected:**
- ✅ UI adapts to mobile size
- ✅ Panel is usable on mobile
- ✅ All features work on mobile

---

## Quick Smoke Test (2 minutes)

1. ✅ Open scratchpad panel
2. ✅ Save an answer
3. ✅ Add notes to saved item
4. ✅ View item in scratchpad
5. ✅ Export to Markdown
6. ✅ Delete item
7. ✅ Close scratchpad panel

If all 7 steps work, the scratchpad is functioning correctly!

---

## Common Issues

### Panel doesn't open
- Check browser console for errors
- Verify backend is running
- Check auth token is valid

### Items don't save
- Check network tab for API errors
- Verify notebook was created
- Check tenant isolation

### Export doesn't work
- Check browser allows downloads
- Verify export endpoint returns data
- Check file permissions

---

## Automated Tests

Run Playwright tests:

```bash
# Run all tests
npx playwright test

# Run only scratchpad tests
npx playwright test research-assistant-scratchpad

# Run with UI (visual debugging)
npx playwright test --ui

# Run specific test
npx playwright test -g "should toggle scratchpad panel"
```

---

## Test Data

Use these sample questions to generate test data:

1. "What is AAPL revenue for FY2024?"
2. "Compare MSFT and GOOGL cloud revenue"
3. "What are the key risks for TSLA?"
4. "Show me NVDA operating margin trend"
5. "Explain AMZN business model"

Each will generate an assistant response you can save to the scratchpad.

---

## Success Criteria

All features working:
- ✅ Save answers with one click
- ✅ Add personal notes
- ✅ View all saved items
- ✅ Markdown renders correctly
- ✅ Delete items
- ✅ Export to Markdown
- ✅ Item count badge
- ✅ Empty state
- ✅ Smooth animations
- ✅ Responsive design

**If all checkboxes are checked, Phase 3 is complete!**
