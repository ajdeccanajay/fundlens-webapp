# Visual Verification Guide

## What You Should See After the Fix

### Test 1: Simple Query

**Query:** "What is NVDA revenue?"

#### ✅ CORRECT (After Fix)
```
┌─────────────────────────────────────────────────────┐
│ 🤖 Assistant                                        │
├─────────────────────────────────────────────────────┤
│ NVDA's revenue for FY2024 is $60.9B, representing  │
│ strong growth driven by data center demand...       │
│                                                     │
│ Sources:                                            │
│ 📄 NVDA 10-K (FY2024)                              │
│ 📄 NVDA 10-Q (Q3 2024)                             │
└─────────────────────────────────────────────────────┘
```

#### ❌ INCORRECT (Before Fix - Should NOT See This)
```
┌─────────────────────────────────────────────────────┐
│ 🤖 Assistant                                        │
├─────────────────────────────────────────────────────┤
│ NVDA's revenue for FY2024 is $60.9B...             │
│                                                     │
│ Sources:                                            │
│ 📄 undefined undefined                              │
│ 📄 NVDA undefined                                   │
│ 📄 undefined 10-K                                   │
│ 📄 NVDA 10-K (FY2024)                              │
│ 📄 NVDA 10-K (FY2024)  [duplicate]                 │
└─────────────────────────────────────────────────────┘
```

### Test 2: Multi-Company Query

**Query:** "Compare AAPL and MSFT revenue"

#### ✅ CORRECT (After Fix)
```
┌─────────────────────────────────────────────────────┐
│ 🤖 Assistant                                        │
├─────────────────────────────────────────────────────┤
│ ## 📊 Financial Metrics                            │
│                                                     │
│ ### AAPL                                            │
│ **Revenue**                                         │
│ | Period    | Value   | YoY Growth | Filing |      │
│ |-----------|---------|------------|--------|      │
│ | FY2024    | $394.3B | +2.0%      | 10-K   |      │
│ | FY2023    | $383.3B | +7.8%      | 10-K   |      │
│                                                     │
│ ### MSFT                                            │
│ **Revenue**                                         │
│ | Period    | Value   | YoY Growth | Filing |      │
│ |-----------|---------|------------|--------|      │
│ | FY2024    | $245.1B | +15.7%     | 10-K   |      │
│ | FY2023    | $211.9B | +6.9%      | 10-K   |      │
│                                                     │
│ Sources:                                            │
│ 📄 AAPL 10-K (FY2024)                              │
│ 📄 AAPL 10-K (FY2023)                              │
│ 📄 MSFT 10-K (FY2024)                              │
│ 📄 MSFT 10-K (FY2023)                              │
└─────────────────────────────────────────────────────┘
```

#### ❌ INCORRECT (Before Fix - Should NOT See This)
```
┌─────────────────────────────────────────────────────┐
│ 🤖 Assistant                                        │
├─────────────────────────────────────────────────────┤
│ [Same metrics table]                                │
│                                                     │
│ Sources:                                            │
│ 📄 undefined undefined                              │
│ 📄 AAPL undefined                                   │
│ 📄 AAPL 10-K (FY2024)                              │
│ 📄 AAPL 10-K (FY2024)  [duplicate]                 │
│ 📄 undefined 10-K                                   │
│ 📄 MSFT undefined                                   │
│ 📄 MSFT 10-K (FY2024)                              │
│ 📄 MSFT 10-K (FY2024)  [duplicate]                 │
└─────────────────────────────────────────────────────┘
```

### Test 3: No Data Available

**Query:** "What is XYZ revenue?" (company not in database)

#### ✅ CORRECT (After Fix)
```
┌─────────────────────────────────────────────────────┐
│ 🤖 Assistant                                        │
├─────────────────────────────────────────────────────┤
│ I don't have data for XYZ in my database. Please   │
│ verify the ticker symbol or try another company.    │
│                                                     │
│ (No sources shown)                                  │
└─────────────────────────────────────────────────────┘
```

#### ❌ INCORRECT (Before Fix - Should NOT See This)
```
┌─────────────────────────────────────────────────────┐
│ 🤖 Assistant                                        │
├─────────────────────────────────────────────────────┤
│ I don't have data for XYZ...                        │
│                                                     │
│ Sources:                                            │
│ 📄 undefined undefined                              │
│ 📄 undefined undefined                              │
└─────────────────────────────────────────────────────┘
```

## Checklist for Visual Verification

When testing, verify these points:

### ✅ Source Titles
- [ ] No "undefined" appears in any source title
- [ ] All sources have format: "TICKER FILING-TYPE"
- [ ] Examples: "NVDA 10-K", "AAPL 10-Q", "MSFT 10-K"

### ✅ Source Data
- [ ] All sources have a valid ticker (NVDA, AAPL, MSFT, etc.)
- [ ] All sources have a valid filing type (10-K, 10-Q, 8-K, etc.)
- [ ] Fiscal periods are shown when available (FY2024, Q3 2024, etc.)

### ✅ Deduplication
- [ ] No duplicate sources appear
- [ ] Each unique ticker/filing/period combination appears only once

### ✅ Edge Cases
- [ ] Queries with no data don't show "undefined" sources
- [ ] Queries with partial data only show valid sources
- [ ] Multi-company queries show sources for all companies

### ✅ Confidence Scores (if shown)
- [ ] Confidence scores only appear for valid sources
- [ ] Scores are meaningful percentages (e.g., 85%, 90%)
- [ ] No scores shown for undefined sources

## Browser Console Check

Open browser console (F12) and verify:

### ✅ No Errors
```javascript
// Should NOT see:
❌ TypeError: Cannot read property 'ticker' of undefined
❌ TypeError: Cannot read property 'filingType' of undefined
```

### ✅ Clean Logs
```javascript
// Should see:
✅ 📎 Received citations: [...]
✅ ✅ RAG Result: structured query
✅ ✅ Retrieved 5 structured metrics
```

## Network Tab Check

Open Network tab (F12 → Network) and check the streaming response:

### ✅ Valid Source Events
```
event: source
data: {"title":"NVDA 10-K","type":"metric","ticker":"NVDA","filingType":"10-K","fiscalPeriod":"FY2024"}

event: source
data: {"title":"NVDA 10-Q","type":"metric","ticker":"NVDA","filingType":"10-Q","fiscalPeriod":"Q3 2024"}
```

### ❌ Invalid Source Events (Should NOT See)
```
event: source
data: {"title":"undefined undefined","type":"metric","ticker":null,"filingType":null}

event: source
data: {"title":"NVDA undefined","type":"metric","ticker":"NVDA","filingType":null}
```

## Screenshot Comparison

### Before Fix ❌
```
┌────────────────────────────────────┐
│ Sources:                           │
│ • undefined undefined              │  ← BAD
│ • NVDA undefined (85% relevance)   │  ← BAD
│ • undefined 10-K (90% relevance)   │  ← BAD
│ • NVDA 10-K (FY2024)               │  ← OK
│ • NVDA 10-K (FY2024)               │  ← DUPLICATE
└────────────────────────────────────┘
```

### After Fix ✅
```
┌────────────────────────────────────┐
│ Sources:                           │
│ • NVDA 10-K (FY2024)               │  ← GOOD
│ • NVDA 10-Q (Q3 2024)              │  ← GOOD
└────────────────────────────────────┘
```

## Success Criteria

The fix is successful when:

1. ✅ **Zero "undefined" values** in any source title
2. ✅ **All sources have valid data** (ticker + filing type)
3. ✅ **No duplicates** in source list
4. ✅ **Clean, professional appearance**
5. ✅ **Meaningful confidence scores** (when shown)

## Failure Indicators

Report back if you see:

1. ❌ "undefined" in any source title
2. ❌ Duplicate sources
3. ❌ Sources with missing ticker or filing type
4. ❌ Console errors related to sources
5. ❌ Confidence scores for invalid sources

## Quick Test Commands

```bash
# 1. Start server
npm run start:dev

# 2. Open browser
open http://localhost:3000/app/research/index.html

# 3. Login
# Email: admin@fundlens.com
# Password: admin123

# 4. Test queries
# - "What is NVDA revenue?"
# - "Compare AAPL and MSFT revenue"
# - "Tell me about Tesla"

# 5. Verify sources look clean (no "undefined")
```

## Automated Verification

```bash
# Run automated test
node test-research-sources-fix.js

# Expected output:
# ✅ TEST PASSED: All sources have valid data
```

---

**Remember:** The key indicator of success is that you should NEVER see "undefined" in any source title or data. All sources should be clean, professional, and trustworthy.
