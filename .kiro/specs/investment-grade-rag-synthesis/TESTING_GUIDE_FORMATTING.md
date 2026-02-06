# Testing Guide - Formatting Fixes

## Quick Test

The server is already running on process ID 2. Follow these steps to test the formatting fixes:

### Step 1: Navigate to Workspace

Open your browser and go to:
```
http://localhost:3000/app/deals/workspace.html?dealId=<your-deal-id>
```

Replace `<your-deal-id>` with an actual deal ID from your database.

### Step 2: Switch to Research Tab

Click on the "Research" tab in the left sidebar.

### Step 3: Ask a Test Question

Type in the research assistant:
```
What are NVDA's risks?
```

### Step 4: Verify Formatting

Check the response for these 3 things:

#### ✅ 1. Headers Are Left-Aligned

Look for headers like:
```
**Supply Chain Concentration**
**Competitive Pressures**
```

These should be aligned to the left, not centered or right-aligned.

#### ✅ 2. No "---" Before Sources

The response should end with:
```
Sources:
[1] NVDA 10-K FY2024, Item 1A - Risk Factors, p. 23
[2] NVDA 10-K FY2024, Item 1 - Business, p. 8
```

**NOT:**
```
---
Sources:
[1] NVDA 10-K FY2024, Item 1A - Risk Factors, p. 23
```

#### ✅ 3. Citations Are Clickable

The citations [1], [2], [3] should be:
- Blue colored links
- Clickable
- Show a light blue background on hover

### Step 5: Test Citation Modal

1. Click on any citation link (e.g., [1])
2. Verify modal opens with:
   - **Header:** Ticker, filing type, fiscal period (e.g., "NVDA 10-K FY2024")
   - **Section:** Section name (e.g., "Item 1A - Risk Factors")
   - **Metadata:** Page number and relevance score
   - **Excerpt:** First 500 characters of source content
   - **Copy Button:** "Copy Citation" button
3. Click "Copy Citation" button
4. Verify toast notification appears: "Citation copied to clipboard"
5. Paste somewhere to verify format:
   ```
   NVDA 10-K FY2024, Item 1A - Risk Factors, p. 23
   ```
6. Close modal by:
   - Clicking "Close" button
   - Pressing Esc key
   - Clicking outside modal

## Alternative Test Questions

If NVDA doesn't work, try these:

```
What are AAPL's revenue trends?
```

```
What are MSFT's competitive advantages?
```

```
What are TSLA's business risks?
```

## Expected Response Format

Here's what a properly formatted response should look like:

```
NVIDIA faces several material risks that could impact its market leadership in AI accelerators.

**Supply Chain Concentration**
NVIDIA's production is heavily concentrated at TSMC, with over 80% of advanced 
chips manufactured in Taiwan [1]. Any disruption could significantly impact 
supply [2].

**Competitive Pressures**
The AI accelerator market is intensifying with hyperscaler custom chips [3]. 
While NVIDIA maintains advantages in CUDA ecosystem, market share erosion is 
a key risk [4].

**Regulatory and Geopolitical Risks**
Export controls on advanced AI chips to China represent a significant revenue 
risk [5]. The company faces ongoing regulatory scrutiny in multiple 
jurisdictions [6].

Sources:
[1] NVDA 10-K FY2024, Item 1A - Risk Factors, p. 23
[2] NVDA 10-K FY2024, Item 1 - Business, p. 8
[3] NVDA 10-Q Q3 2024, MD&A, p. 45
[4] NVDA 10-K FY2024, Item 1A - Risk Factors, p. 28
[5] NVDA 10-K FY2024, Item 1A - Risk Factors, p. 31
[6] NVDA 10-Q Q3 2024, Item 1A - Risk Factors, p. 52
```

## What to Look For

### ✅ Good Signs

- Headers are left-aligned
- No "---" before Sources section
- Citations [1], [2] are blue and clickable
- Modal opens when clicking citations
- Modal shows correct metadata
- Copy citation works
- Professional, synthesized language (not copy-paste from filings)

### ❌ Bad Signs

- Headers are centered or right-aligned
- "---" appears before Sources section
- Citations are not clickable
- Modal doesn't open
- Modal shows incorrect data
- Response is copy-paste from filings (not synthesized)

## Troubleshooting

### Issue: Citations Not Clickable

**Check:**
1. Open browser console (F12)
2. Look for JavaScript errors
3. Verify Alpine.js is loaded
4. Check if `handleSecFilingCitation()` function exists

### Issue: Modal Doesn't Open

**Check:**
1. Verify `showSourceModal` state is defined
2. Check if citation data is being passed correctly
3. Look for console errors

### Issue: "---" Still Appears

**Check:**
1. Verify server was restarted after code changes
2. Clear browser cache
3. Check if correct prompt is being used (inspect network tab)

### Issue: Headers Not Left-Aligned

**Check:**
1. Inspect element in browser
2. Verify `.message-assistant h1, h2, h3` CSS has `text-align: left`
3. Check for conflicting CSS rules

## Server Status

Server is running on process ID 2:
```bash
# Check server logs
npm run start:dev
```

If you need to restart:
```bash
# Stop server
Ctrl+C

# Start server
npm run start:dev
```

## Success Criteria

All 3 formatting issues must be resolved:
- ✅ Headers are left-aligned
- ✅ No "---" before Sources section
- ✅ Citations are clickable and modal works

## Next Steps After Testing

1. If all tests pass → Mark Task 5 as complete
2. If issues found → Document issues and iterate
3. Get user feedback on formatting
4. Move to optional testing tasks (4.1-4.4)

---

**Ready to Test:** Yes
**Server Status:** Running (Process ID 2)
**Estimated Test Time:** 5 minutes
