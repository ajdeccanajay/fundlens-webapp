# RAG Formatting Testing Guide

## Quick Start

**Server**: ✅ Running on `http://localhost:3000`
**Test URL**: `http://localhost:3000/app/deals/workspace.html`
**Cache**: ❌ Disabled (every query is fresh)

---

## Test Scenarios

### Test 1: Sentence Boundaries (Primary Fix)

**Query**: `What are the key risks?`

**What to check**:
- [ ] No cut-off words at the beginning of sentences
- [ ] All paragraphs start with complete words (capital letter)
- [ ] Content flows naturally without "...tion" or similar fragments
- [ ] Comprehensive content (multiple paragraphs, not 2-3 sentences)

**Expected output structure**:
```markdown
### NVDA

**Risk Factors**

[Complete sentence starting with capital letter, ~2000 chars]

[Another complete sentence starting with capital letter, ~2000 chars]

[More comprehensive content...]

**Sources:**
- NVDA 10-K FY2024, Page 15 (92% relevance)
- NVDA 10-K FY2024, Page 16 (89% relevance)
...
```

---

### Test 2: Metric Tables

**Query**: `What is NVDA net income?`

**What to check**:
- [ ] Table has all 4 columns: Period | Value | YoY Growth | Filing
- [ ] Values are formatted correctly (e.g., "$31.91B")
- [ ] YoY Growth shows +/- signs (e.g., "+65.2%")
- [ ] If >5 periods, shows top 5 with note about hidden data

**Expected output**:
```markdown
### NVDA

**net_income**

| Period | Value | YoY Growth | Filing |
|--------|-------|------------|--------|
| Q4 2025 | $31.91B | +65.2% | 10-Q |
| Q4 2024 | $19.31B | +33.1% | 10-Q |
| Q4 2023 | $14.51B | - | 10-Q |

_Showing most recent 5 of 10 periods. 5 earlier periods available._
```

---

### Test 3: Hybrid Query

**Query**: `Compare NVDA and AAPL revenue and discuss their business strategies`

**What to check**:
- [ ] Metrics section with proper tables for both companies
- [ ] Context & Analysis section with comprehensive narratives
- [ ] No cut-off words anywhere in the response
- [ ] Sources listed cleanly at the end of each section

**Expected structure**:
```markdown
## 📊 Financial Metrics

### NVDA
**revenue**
[Table with all columns]

### AAPL
**revenue**
[Table with all columns]

## 📄 Context & Analysis

### NVDA
**Business Overview**
[Comprehensive paragraphs with complete sentences]

**Sources:**
[Clean list]

### AAPL
**Business Overview**
[Comprehensive paragraphs with complete sentences]

**Sources:**
[Clean list]
```

---

### Test 4: Content Depth

**Query**: `What are NVDA's competitive advantages?`

**What to check**:
- [ ] Response is "meaty" - multiple paragraphs, not shallow
- [ ] Each paragraph is ~2000 characters (comprehensive)
- [ ] Up to 8 chunks of content per section
- [ ] Content makes sense to equity analysts
- [ ] Full sentences throughout

---

### Test 5: Multiple Queries (Cache Disabled)

**Queries** (run in sequence):
1. `What is NVDA revenue?`
2. `What is NVDA revenue?` (same query again)

**What to check**:
- [ ] Both queries return fresh results (no cache)
- [ ] Response times are similar (both hit backend)
- [ ] Formatting is consistent across queries

---

## Common Issues to Watch For

### ❌ Bad: Cut-off Words
```
"...tion of our products could be affected by..."
```

### ✅ Good: Complete Sentences
```
"Production of our products could be affected by..."
```

---

### ❌ Bad: Missing Table Columns
```
| Period | YoY Growth | Filing |
|--------|------------|--------|
| Q4 2025 | +65.2% | 10-Q |
```

### ✅ Good: All Columns Present
```
| Period | Value | YoY Growth | Filing |
|--------|-------|------------|--------|
| Q4 2025 | $31.91B | +65.2% | 10-Q |
```

---

### ❌ Bad: Shallow Content
```
**Risk Factors**

NVDA faces competition in the GPU market. Supply chain issues could impact production.

**Sources:**
- NVDA 10-K FY2024
```

### ✅ Good: Comprehensive Content
```
**Risk Factors**

[2000 char paragraph with detailed risk analysis]

[Another 2000 char paragraph with more context]

[Up to 8 comprehensive paragraphs]

**Sources:**
- NVDA 10-K FY2024, Page 15 (92% relevance)
- NVDA 10-K FY2024, Page 16 (89% relevance)
...
```

---

## Browser Console Checks

Open browser console (F12) and look for:

### Good Signs:
```
🔍 Processing hybrid query: "What are the key risks?"
🎯 Optimization decisions: ...
📊 Retrieved X structured metrics
🧠 Retrieved Y semantic narratives
✅ Hybrid query complete: ...
```

### Warning Signs:
```
❌ Error processing hybrid query: ...
⚠️ Cache hit! (should NOT see this - cache is disabled)
```

---

## Performance Expectations

With cache disabled:
- **Simple metric query**: 1-3 seconds
- **Semantic query**: 3-5 seconds
- **Hybrid query**: 4-7 seconds

These are normal since we're hitting the backend fresh every time.

---

## Reporting Issues

If you find problems, please note:

1. **Exact query** that caused the issue
2. **Screenshot** of the problematic output
3. **Specific problem**:
   - Cut-off words? (where exactly?)
   - Missing table columns? (which ones?)
   - Shallow content? (how many paragraphs?)
   - Other formatting issues?

4. **Browser console logs** (if any errors)

---

## Success Criteria

The formatting is approved when:

- ✅ No cut-off words at sentence boundaries
- ✅ All metric tables have 4 columns
- ✅ YoY growth calculated correctly with +/- signs
- ✅ Risk factors and narratives are comprehensive (meaty)
- ✅ Sources listed cleanly at the end
- ✅ Content is readable and makes sense to analysts
- ✅ Consistent formatting across all query types

---

## After Approval

Once formatting is approved:

1. **Re-enable cache** in `src/rag/rag.service.ts`:
   - Uncomment cache read section (~line 60)
   - Uncomment cache write section (~line 330)

2. **Rebuild**:
   ```bash
   npm run build
   ```

3. **Restart server** (or it will auto-restart)

4. **Verify cache works**:
   - Run same query twice
   - Second query should be much faster (<100ms)
   - Console should show "✅ Cache hit!"

---

## Quick Reference

| Aspect | Before | After |
|--------|--------|-------|
| Chunks per section | 5 | 8 |
| Chars per excerpt | 1200 | 2000 |
| Total content | ~6000 chars | ~16000 chars |
| Table columns | 3 (missing Value) | 4 (complete) |
| Sentence boundaries | Cut-off words | Complete sentences |
| Cache | Enabled | Disabled (testing) |
| Source display | Inline (cluttered) | End of section (clean) |

---

**Ready to Test**: ✅ Yes
**Server Running**: ✅ Yes
**Build Status**: ✅ Success
**Documentation**: ✅ Complete

Start testing at: `http://localhost:3000/app/deals/workspace.html`

