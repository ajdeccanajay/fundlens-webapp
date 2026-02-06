# Critical Bugs Fix - Citation Modal & Markdown Tables

## Bug 1: Citation Links Clickable But Modal Doesn't Show

### Problem
User clicks on [1], [2], [3] but nothing happens. No modal appears.

### Root Cause
**Alpine.js scope issue** - The event listener uses `this` which loses context when called from a DOM event.

### Solution
Capture the Alpine component context using `const self = this` before setting up the event listener.

**Before:**
```javascript
document.addEventListener('click', (event) => {
    const citationLink = event.target.closest('.citation-link');
    if (citationLink) {
        event.preventDefault();
        const citationNum = parseInt(citationLink.getAttribute('data-citation-num'));
        if (citationNum) {
            this.handleCitationClickByNumber(citationNum); // ❌ 'this' is undefined
        }
    }
});
```

**After:**
```javascript
const self = this; // ✅ Capture Alpine component context
document.addEventListener('click', (event) => {
    const citationLink = event.target.closest('.citation-link');
    if (citationLink) {
        event.preventDefault();
        const citationNum = parseInt(citationLink.getAttribute('data-citation-num'));
        console.log('🔗 Citation clicked:', citationNum);
        if (citationNum) {
            self.handleCitationClickByNumber(citationNum); // ✅ Uses captured context
        }
    }
});
```

### Testing
1. Open browser console (F12)
2. Click on [1] in a response
3. Should see: `🔗 Citation clicked: 1`
4. Modal should open with source details

---

## Bug 2: Markdown Tables Render as Raw Text

### Problem
When Claude returns a markdown table, it displays as raw text with pipes and dashes instead of a formatted table.

**Example:**
```
| Period | Value | YoY Growth | Filing |
|--------|-------|------------|--------|
| Q4 2025 | $57.01B | +62.5% | 10-Q |
```

Shows as plain text instead of a formatted table.

### Root Cause
Marked.js needs explicit `tables: true` option to parse GFM tables.

### Solution
Add `tables: true` to marked.js configuration.

**Updated Configuration:**
```javascript
marked.setOptions({
    breaks: true,
    gfm: true,
    tables: true, // ✅ Explicitly enable tables
    headerIds: false,
    mangle: false,
    sanitize: false,
    smartLists: true,
    smartypants: true,
    pedantic: false, // ✅ Don't be too strict
    highlight: function(code, lang) {
        // ... syntax highlighting
    }
});
```

### CSS Already Exists
The table CSS is already defined:
```css
.message-assistant table {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
    font-size: 0.9em;
}

.message-assistant table th {
    background: var(--fundlens-gray-50);
    padding: 0.75em;
    text-align: left;
    font-weight: 600;
    border-bottom: 2px solid var(--fundlens-gray-300);
}

.message-assistant table td {
    padding: 0.75em;
    border-bottom: 1px solid var(--fundlens-gray-200);
}

.message-assistant table tr:hover {
    background: var(--fundlens-gray-50);
}
```

### Testing
1. Ask: "Compare NVDA revenue with peers"
2. Response should include a formatted table
3. Table should have:
   - Gray header row
   - Bordered cells
   - Hover effect on rows
   - Proper spacing

---

## Files Modified

### public/app/deals/workspace.html
1. **Line ~2115**: Fixed Alpine.js scope issue in citation click handler
2. **Line ~3210**: Added `tables: true` and `pedantic: false` to marked.js config

---

## Testing Checklist

### Citation Modal
- [ ] Click on [1] - modal opens
- [ ] Modal shows ticker, filing, section, excerpt
- [ ] Click "Copy Citation" - citation copied
- [ ] Press Esc - modal closes
- [ ] Click outside modal - modal closes
- [ ] Console shows: `🔗 Citation clicked: 1`

### Markdown Tables
- [ ] Ask: "Compare NVDA revenue with peers"
- [ ] Table renders with proper formatting
- [ ] Headers are bold and gray background
- [ ] Cells have borders
- [ ] Rows have hover effect
- [ ] No raw markdown syntax visible

---

## Status
🔧 **IN PROGRESS** - Fixes applied, awaiting user testing
