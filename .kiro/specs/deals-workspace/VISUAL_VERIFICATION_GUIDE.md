# Deal Workspace - Visual Verification Guide

## What You Should See

### 1. Main Navigation Bar (Top of Page)

```
┌─────────────────────────────────────────────────────────────────────┐
│  🔷 FundLens    Deals    Research    Analysis         🔔  👤        │
└─────────────────────────────────────────────────────────────────────┘
```

**Location**: Very top of the page, above everything else
**Height**: 64px (h-16)
**Background**: White with bottom border
**Content**:
- Left side: FundLens logo (blue gradient square with chart icon) + "FundLens" text
- Center: "Deals", "Research", "Analysis" links
- Right side: Bell icon (notifications) and user icon

**Links**:
- FundLens logo → `/index.html` (home page)
- Deals → `/app/deals/index.html` (deals list)
- Research → `/app/research/index.html` (research workspace)
- Analysis → `/comprehensive-financial-analysis.html` (analysis page)

---

### 2. Deal Info Bar (Below Navigation)

```
┌─────────────────────────────────────────────────────────────────────┐
│  📊 AAPL - Apple Inc.                          Export ⚙️            │
│     Technology                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**Location**: Below main navigation bar
**Height**: 64px (h-16)
**Background**: White with bottom border
**Content**:
- Left: Company icon, ticker, name, sector
- Right: Export button and settings button

---

### 3. Main Layout (Below Deal Info Bar)

```
┌──────────┬──────────────────────────────────────────────────────────┐
│          │                                                          │
│ Analysis │                                                          │
│          │                                                          │
│ Research │                    CONTENT AREA                          │
│          │                                                          │
│Scratchpad│                                                          │
│          │                                                          │
│ IC Memo  │                                                          │
│          │                                                          │
│          │                                                          │
│  ⌘1-4    │                                                          │
└──────────┴──────────────────────────────────────────────────────────┘
```

**Left Sidebar**:
- Width: 240px
- Background: White
- Navigation items with icons
- Active item has blue background and left border
- Keyboard shortcuts hint at bottom

**Content Area**:
- Fills remaining space
- Scrollable
- Changes based on selected view

---

### 4. Research View - Empty State

When you click "Research" in the sidebar, you should see:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│                          🧠                                         │
│                  Research Assistant                                 │
│         Ask questions about AAPL or compare with other companies    │
│                                                                     │
│  ┌──────────────────────┐  ┌──────────────────────┐               │
│  │  ⚠️                   │  │  📈                   │               │
│  │  Risk Analysis        │  │  Compare              │               │
│  │  Key risks and        │  │  Compare with peers   │               │
│  │  challenges           │  │                       │               │
│  └──────────────────────┘  └──────────────────────┘               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
│  Ask about any company...                                    📤    │
└─────────────────────────────────────────────────────────────────────┘
```

**Elements**:
1. Brain icon (🧠) in blue circle
2. "Research Assistant" heading
3. Description text with ticker
4. Two quick query buttons:
   - Left: "Risk Analysis" with warning icon
   - Right: "Compare" with chart icon
5. Text input at bottom
6. Send button (paper plane icon)

---

### 5. Research View - After Clicking Quick Query

After clicking "What are the key risks?" button:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│                                    ┌──────────────────────────────┐│
│                                    │ What are the key risks?      ││
│                                    └──────────────────────────────┘│
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ Based on Apple's SEC filings, the key risks include:       │   │
│  │                                                             │   │
│  │ 1. Supply chain dependencies...                            │   │
│  │ 2. Competition in smartphone market...                     │   │
│  │ 3. Regulatory challenges...                                │   │
│  │                                                             │   │
│  │ 🔖 Save to Scratchpad                                      │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
│  Ask about any company...                                    📤    │
└─────────────────────────────────────────────────────────────────────┘
```

**Message Flow**:
1. User message appears on right (blue gradient background)
2. Assistant message appears on left (white background with border)
3. Markdown is rendered (bold, lists, etc.)
4. "Save to Scratchpad" button appears below assistant message

---

## Color Reference

### FundLens Brand Colors

- **Primary Blue**: `#1a56db` (buttons, active states, links)
- **Secondary Teal**: `#0e7490` (accents)
- **Accent Purple**: `#7c3aed` (gradients)
- **Success Green**: `#059669` (positive indicators)
- **Warning Orange**: `#d97706` (warnings)
- **Error Red**: `#dc2626` (errors, risk indicators)

### UI Colors

- **Gray 50**: `#f9fafb` (backgrounds)
- **Gray 100**: `#f3f4f6` (hover states)
- **Gray 200**: `#e5e7eb` (borders)
- **Gray 600**: `#4b5563` (secondary text)
- **Gray 900**: `#111827` (primary text)

---

## Interactive Elements

### Hover States

**Navigation Links**:
- Default: Gray text
- Hover: Darker gray + light gray background
- Active: Blue text + blue left border + light blue background

**Quick Query Buttons**:
- Default: White background + gray border
- Hover: Shadow appears (hover:shadow-lg)
- Click: Message sent immediately

**Send Button**:
- Default: Blue-purple gradient
- Hover: Shadow appears
- Disabled: Opacity 50% + cursor not-allowed

---

## Keyboard Shortcuts

Press these keys to switch views:

- **Cmd+1** (Mac) or **Ctrl+1** (Windows) → Analysis
- **Cmd+2** (Mac) or **Ctrl+2** (Windows) → Research
- **Cmd+3** (Mac) or **Ctrl+3** (Windows) → Scratchpad
- **Cmd+4** (Mac) or **Ctrl+4** (Windows) → IC Memo

---

## Browser DevTools Check

### Console Tab (F12 → Console)

**Expected** (no errors):
```
Alpine.js initialized
Deal workspace loaded
Ticker: AAPL
```

**Not Expected** (errors):
```
❌ Uncaught ReferenceError: quickQuery is not defined
❌ Failed to fetch
❌ Alpine.js not loaded
```

### Network Tab (F12 → Network)

When you click "What are the key risks?", you should see:

```
POST /api/research/chat
Status: 200 OK
Type: xhr
Size: ~2-5 KB
Time: ~2-5 seconds
```

**Request Payload**:
```json
{
  "message": "What are the key risks?",
  "ticker": "AAPL"
}
```

**Response**:
```json
{
  "response": "Based on Apple's SEC filings, the key risks include..."
}
```

---

## Mobile View (< 768px)

On mobile devices:

```
┌─────────────────────────┐
│  🔷 FundLens      🔔  👤 │  ← Navigation links hidden
└─────────────────────────┘
┌─────────────────────────┐
│  📊 AAPL - Apple Inc.   │
│     Technology          │
└─────────────────────────┘
┌──────┬──────────────────┐
│      │                  │
│ Anal │                  │
│      │                  │
│ Rese │    CONTENT       │
│      │                  │
│ Scra │                  │
│      │                  │
│ IC M │                  │
└──────┴──────────────────┘
```

- Navigation links hidden (only logo and icons visible)
- Sidebar remains visible but narrower
- Content area adjusts to fit

---

## Troubleshooting Visual Issues

### Issue: Navigation bar not visible

**Check**:
1. Scroll to very top of page
2. Look for white bar with FundLens logo
3. Should be 64px tall

**If not visible**:
- Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
- Check browser console for errors
- Try incognito window

---

### Issue: Quick query buttons not visible

**Check**:
1. Click "Research" in left sidebar
2. Should see empty state with brain icon
3. Should see two buttons below

**If not visible**:
- Verify you're in Research view (not Analysis)
- Check if `researchMessages.length === 0`
- Check browser console for errors

---

### Issue: Messages not displaying

**Check**:
1. Click quick query button
2. User message should appear immediately on right
3. Assistant message should appear after 2-5 seconds on left

**If not displaying**:
- Check browser console for errors
- Check Network tab for API request
- Verify backend is running
- Check if `researchMessages` array is populated

---

## Screenshot Locations

To verify implementation, take screenshots of:

1. **Full page view** - Shows navigation bar, deal info bar, sidebar, and content
2. **Navigation bar close-up** - Shows FundLens logo and links
3. **Research empty state** - Shows quick query buttons
4. **Research with messages** - Shows user and assistant messages
5. **Browser console** - Shows no errors
6. **Network tab** - Shows API request to `/api/research/chat`

---

## Expected File Structure

```
public/app/deals/workspace.html
├── Lines 1-138: HTML head, styles, CDN imports
├── Lines 139-177: Main navigation bar ← SHOULD BE VISIBLE
├── Lines 178-237: Deal info bar
├── Lines 238-289: Left sidebar navigation
├── Lines 290-908: Analysis view (quantitative, qualitative, export)
├── Lines 909-977: Research view ← QUICK QUERIES HERE
├── Lines 978-1067: Scratchpad and IC Memo views
├── Lines 1068-1798: JavaScript (Alpine.js component)
│   ├── Lines 1331-1335: quickQuery() function
│   └── Lines 1336-1373: sendResearchMessage() function
└── Line 1798: Closing tags
```

---

## Success Checklist

Use this checklist to verify everything is working:

- [ ] Navigation bar visible at top of page
- [ ] FundLens logo links to home page
- [ ] Deals link goes to deals index
- [ ] Research link goes to research workspace
- [ ] Analysis link goes to comprehensive analysis
- [ ] Left sidebar shows 4 navigation items
- [ ] Clicking "Research" switches to research view
- [ ] Research view shows brain icon and heading
- [ ] Two quick query buttons visible
- [ ] Clicking "What are the key risks?" sends message
- [ ] User message appears on right (blue background)
- [ ] API request sent to `/api/research/chat`
- [ ] Assistant message appears on left (white background)
- [ ] Markdown is rendered correctly
- [ ] "Save to Scratchpad" button appears
- [ ] No errors in browser console
- [ ] Keyboard shortcuts work (Cmd+1,2,3,4)

---

## Final Verification Command

Run this command to verify the file is complete:

```bash
# Check file exists and has correct line count
wc -l public/app/deals/workspace.html
# Expected: 1798 lines

# Check navigation bar is present
grep -n "Main Navigation Bar" public/app/deals/workspace.html
# Expected: Line 139

# Check quick query buttons are present
grep -n "quickQuery" public/app/deals/workspace.html
# Expected: Lines 923, 931, 1331

# Check sendResearchMessage function is present
grep -n "sendResearchMessage" public/app/deals/workspace.html
# Expected: Lines 964, 971, 1333, 1336

# Run unit tests
npm test -- test/unit/deals-workspace.spec.ts
# Expected: 47 tests passing

npm test -- test/unit/deals-workspace-phase2.spec.ts
# Expected: 36 tests passing
```

---

## Conclusion

If you can see all the elements described in this guide, the implementation is working correctly. If any elements are missing, follow the troubleshooting steps or check the browser console for specific error messages.

**Key Visual Indicators**:
1. ✅ White navigation bar at very top with FundLens logo
2. ✅ Deal info bar below navigation
3. ✅ Left sidebar with 4 navigation items
4. ✅ Research view with brain icon and 2 quick query buttons
5. ✅ Messages display after clicking quick query buttons

All visual elements should match the ASCII diagrams and descriptions in this guide.
