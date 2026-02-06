# Expected Behavior After Fixes

## Citation Clicks

### What Should Happen

1. **User clicks on [1]**
   ```
   NVIDIA faces supply chain risks [1] and competitive pressures [2].
                                    ↑ USER CLICKS HERE
   ```

2. **Console Output**
   ```
   🔗 Citation clicked: 1
   ```

3. **Modal Opens**
   ```
   ┌─────────────────────────────────────────────────────────────┐
   │  NVDA 10-K FY2024                                      [X]  │
   │  Item 1A. Risk Factors                                      │
   ├─────────────────────────────────────────────────────────────┤
   │  📄 Page 23  ⭐ 95% relevant                                │
   ├─────────────────────────────────────────────────────────────┤
   │  Source Excerpt                                             │
   │  ┌───────────────────────────────────────────────────────┐ │
   │  │ NVIDIA's production is heavily concentrated at TSMC,  │ │
   │  │ with over 80% of advanced chips manufactured in       │ │
   │  │ Taiwan. Any disruption could significantly impact...  │ │
   │  └───────────────────────────────────────────────────────┘ │
   ├─────────────────────────────────────────────────────────────┤
   │  [Close]                              [📋 Copy Citation]   │
   └─────────────────────────────────────────────────────────────┘
   ```

4. **User can:**
   - Read the full excerpt
   - Click "Copy Citation" to copy: "NVDA 10-K FY2024, Item 1A. Risk Factors, p. 23"
   - Press Esc to close
   - Click outside modal to close
   - Click X button to close

### What Should NOT Happen

❌ Nothing happens when clicking [1]
❌ Console error: "Citation not found"
❌ Modal shows "undefined" values
❌ Modal doesn't open at all

---

## Markdown Tables

### What Should Happen

**Query:** "Compare NVDA revenue with peers"

**Response Should Look Like:**

```
## Revenue Comparison

NVIDIA's revenue growth significantly outpaces competitors [1].

┌──────────┬──────────┬─────────────┬─────────┐
│ Period   │ Value    │ YoY Growth  │ Filing  │
├──────────┼──────────┼─────────────┼─────────┤
│ Q4 2025  │ $57.01B  │ +62.5%      │ 10-Q    │
│ Q4 2024  │ $35.08B  │ +93.6%      │ 10-Q    │
│ Q4 2023  │ $18.12B  │ +205.5%     │ 10-Q    │
│ Q4 2022  │ $5.93B   │ -16.5%      │ 10-Q    │
│ Q4 2021  │ $7.10B   │ -           │ 10-Q    │
└──────────┴──────────┴─────────────┴─────────┘

Showing most recent 5 of 31 periods. 26 earlier periods available.
```

**Visual Appearance:**
- ✅ Headers have gray background
- ✅ Cells have borders
- ✅ Rows have hover effect (light gray on hover)
- ✅ Proper spacing and alignment
- ✅ Professional, clean look

### What Should NOT Happen

❌ Raw markdown syntax visible:
```
| Period | Value | YoY Growth | Filing |
|--------|-------|------------|--------|
| Q4 2025 | $57.01B | +62.5% | 10-Q |
```

❌ Pipes and dashes showing
❌ No table formatting
❌ Text runs together without structure

---

## Debugging

### If Citation Modal Doesn't Open

1. **Open browser console (F12)**
2. **Click on [1]**
3. **Check for:**
   - `🔗 Citation clicked: 1` ← Should see this
   - Any errors about `handleCitationClickByNumber`
   - Any errors about `currentCitations`

4. **If no console output:**
   - Event delegation not working
   - Check if Alpine.js loaded
   - Check if `init()` ran

5. **If console shows error:**
   - Check error message
   - Likely scope issue or missing method

### If Tables Don't Render

1. **Check marked.js version:**
   ```javascript
   // In browser console
   marked.version
   // Should be 4.0.0 or higher
   ```

2. **Check if table CSS exists:**
   ```javascript
   // In browser console
   getComputedStyle(document.querySelector('.message-assistant table')).borderCollapse
   // Should return "collapse"
   ```

3. **Check markdown source:**
   - View page source
   - Find the message content
   - Check if pipes and dashes are in the HTML
   - If yes, marked.js isn't parsing tables

4. **Check marked.js options:**
   ```javascript
   // In browser console
   marked.getDefaults()
   // Should show: tables: true, gfm: true
   ```

---

## Success Criteria

### Citations
✅ Clicking [1], [2], [3] opens modal
✅ Modal shows correct source details
✅ Console shows debug log
✅ Copy citation works
✅ Modal closes properly

### Tables
✅ Tables render with proper formatting
✅ Headers have gray background
✅ Cells have borders
✅ Rows have hover effect
✅ No raw markdown syntax visible

---

## If Issues Persist

### Citation Modal Issues
1. Check browser console for errors
2. Verify Alpine.js is loaded
3. Check if `currentCitations` array has data
4. Verify `handleCitationClickByNumber` method exists

### Table Rendering Issues
1. Check marked.js version (should be 4.0+)
2. Verify `tables: true` in marked.setOptions
3. Check if table CSS is loaded
4. Try a simple table test in console:
   ```javascript
   marked.parse('| A | B |\n|---|---|\n| 1 | 2 |')
   ```

### Still Not Working?
- Clear browser cache
- Hard refresh (Cmd+Shift+R)
- Check if server restarted after changes
- Verify files were saved correctly
