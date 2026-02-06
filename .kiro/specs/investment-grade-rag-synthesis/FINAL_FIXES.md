# Final Fixes - Modal Scrolling and Table Formatting

## Issues Fixed

### 1. Modal Text Cutoff - FIXED ✅
**Problem**: Citation excerpt text was being cut off in the modal without proper scrolling.

**Solution**: 
- Increased outer container max height from `max-h-96` (384px) to `max-h-[500px]` (500px)
- Added inner scrollable div with `max-h-[400px]` and `overflow-y-auto` around the excerpt text
- Kept proper text wrapping: `white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word;`

**Result**: Modal now shows full excerpt with smooth scrolling if content is too long.

### 2. Table Formatting - FIXED ✅
**Problem**: Tables in responses were rendering as raw markdown with mixed pipes and dashes.

**Root Cause**: Tables from Claude were being stored/transmitted as collapsed single lines with `||` as row separators instead of proper newlines. Example:
```
| Metric | FY2021 ||--------|--------|| Net Income | $4.33B |
```

**Solution** (implemented in `renderMarkdown()` function):

1. **Collapsed Table Detection**: Added regex to detect tables that got collapsed into single lines

2. **Row Separator Fix**: Added `processedText.replace(/\|\|/g, '|\n|')` to convert `||` back to proper row breaks

3. **Separator Row Fix**: Added regex to ensure separator rows (`|---|---|`) have proper newlines before data rows

4. **Fallback HTML Table Converter**: Added `convertRawTableToHtml()` helper function that manually converts pipe-delimited text to HTML tables when marked.js fails to parse them

5. **Updated marked.js Configuration**: Changed from deprecated `marked.setOptions()` to `marked.use()` for v5+ compatibility

**Files Modified**:
- `public/app/deals/workspace.html`:
  - Lines 3214-3340: Enhanced `renderMarkdown()` with table preprocessing
  - Lines 3340-3420: Added `convertRawTableToHtml()` fallback function
  - Lines 222-245: Enhanced CSS for `.markdown-table` class

**Result**: Tables now render correctly even when stored as collapsed single lines.

## Testing Instructions

### Test Modal Scrolling
1. Navigate to: http://localhost:3000/app/deals/workspace.html?ticker=NVDA
2. Ask: "What are NVIDIA's key risks?"
3. Click on any citation [1], [2], [3]
4. **Expected**: 
   - Modal opens with full excerpt visible
   - If excerpt is long, scroll bar appears
   - Text wraps properly without horizontal scroll
   - No text cutoff

### Test Table Formatting
1. Navigate to workspace
2. Ask a question that generates a table (or view existing response with table)
3. **Expected**: 
   - Table renders with proper formatting
   - Headers on first row with gray background
   - Data rows properly aligned
   - NO raw pipes and dashes visible

## Technical Details

### Table Preprocessing Pipeline
1. Detect collapsed tables (all on one line)
2. Replace `||` with `|\n|` to restore row breaks
3. Ensure separator row has newlines around it
4. Pass to marked.js for parsing
5. If marked.js fails, use fallback HTML converter

### Fallback HTML Converter
The `convertRawTableToHtml()` function:
1. Splits text by newlines (or `||` if single line)
2. Identifies header row (first row)
3. Identifies separator row (row with `---`)
4. Builds HTML `<table>` with `<thead>` and `<tbody>`
5. Returns formatted HTML table

## Summary

- ✅ Modal scrolling: FIXED - works for all responses
- ✅ Table formatting: FIXED - handles collapsed tables from backend
- ✅ Fallback converter: Added for edge cases where marked.js fails
- ✅ CSS enhanced: Added `.markdown-table` class for fallback tables
