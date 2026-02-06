# Investment-Grade RAG Synthesis - Testing Guide

## Quick Start

### 1. Server Status
The server should already be running on process ID 2:
```bash
# Check if server is running
ps aux | grep "npm run start:dev"

# If not running, start it:
npm run start:dev
```

### 2. Access Workspace
Open in browser:
```
http://localhost:3000/app/deals/workspace.html
```

## Test Scenarios

### Test 1: Basic Synthesis Quality
**Query:** "What are NVDA's risks?"

**Expected Behavior:**
- Response is synthesized (NOT raw filing text)
- Professional investment-grade language
- Organized by theme:
  - Supply Chain Concentration
  - Competitive Pressures
  - Regulatory Risks
  - etc.
- Each theme has 2-3 sentences of analysis
- NO repetition of the same point

**What to Check:**
- [ ] No copy-paste from filings (e.g., "The Company faces risks...")
- [ ] Professional language (e.g., "NVIDIA faces several material risks...")
- [ ] Organized by insight, not by source
- [ ] Each point stated once

### Test 2: Citation Accuracy
**Query:** "What are NVDA's risks?"

**Expected Behavior:**
- Citations [1], [2], [3] appear inline after facts
- Citations are blue and clickable
- Hovering shows pointer cursor
- Clicking opens modal with source context

**What to Check:**
- [ ] Every factual claim has a citation
- [ ] Citations are blue (#2563eb)
- [ ] Citations have hover effect (light blue background)
- [ ] Citations are clickable

### Test 3: Source Modal Functionality
**Query:** "What are NVDA's risks?"

**Steps:**
1. Click on citation [1]
2. Verify modal opens
3. Check modal content
4. Click "Copy Citation"
5. Press Esc key

**Expected Behavior:**
- Modal opens with smooth animation
- Header shows: "NVDA 10-K FY2024"
- Section shows: "Item 1A - Risk Factors" (or similar)
- Metadata shows: Page number + relevance score
- Excerpt shows first 500 chars of source
- Copy button copies citation to clipboard
- Esc key closes modal
- Click outside modal closes it

**What to Check:**
- [ ] Modal opens on citation click
- [ ] Ticker, filing type, period displayed correctly
- [ ] Section name displayed
- [ ] Page number displayed (if available)
- [ ] Relevance score displayed as percentage
- [ ] Excerpt is readable and relevant
- [ ] Copy citation button works
- [ ] Toast notification appears after copy
- [ ] Esc key closes modal
- [ ] Click outside closes modal

### Test 4: Multiple Query Types

#### Financial Performance
**Query:** "What is NVDA's revenue growth?"

**Expected:**
- Synthesized analysis of revenue trends
- Citations for each metric mentioned
- Professional language

#### Competitive Analysis
**Query:** "How does NVDA compare to AMD in AI chips?"

**Expected:**
- Comparative analysis
- Citations from both companies (if available)
- Organized by competitive dimension

#### Business Model
**Query:** "What is NVDA's AI strategy?"

**Expected:**
- Strategic analysis
- Citations from business section
- Forward-looking insights

**What to Check:**
- [ ] All query types produce synthesized responses
- [ ] Citations work for all query types
- [ ] Quality is consistent across query types

### Test 5: Edge Cases

#### No Citations
**Query:** "What is 2+2?"

**Expected:**
- Simple answer without citations
- No citation links
- No modal functionality needed

#### Single Source
**Query:** "What is NVDA's ticker symbol?"

**Expected:**
- Simple answer
- Single citation [1]
- Modal works for single citation

#### Many Citations
**Query:** "Give me a comprehensive analysis of NVDA's business model, risks, and financial performance"

**Expected:**
- Long synthesized response
- Many citations [1], [2], [3], [4], [5], etc.
- All citations clickable
- Modal works for all citations

**What to Check:**
- [ ] System handles queries without citations
- [ ] System handles single citation
- [ ] System handles many citations (10+)

## Quality Checklist

### Synthesis Quality
- [ ] No copy-paste from filings
- [ ] Professional investment-grade language
- [ ] Organized by theme/insight
- [ ] No repetition
- [ ] Clear and concise
- [ ] Factually accurate

### Citation Quality
- [ ] Every fact has a citation
- [ ] Citations map to correct sources
- [ ] Citation numbers are sequential
- [ ] No broken citations
- [ ] No duplicate citations

### UI/UX Quality
- [ ] Citations are visually distinct (blue color)
- [ ] Hover effect works
- [ ] Click opens modal smoothly
- [ ] Modal is readable and well-formatted
- [ ] Copy citation works
- [ ] Keyboard navigation works (Esc)
- [ ] Mobile responsive (if applicable)

## Performance Checklist

- [ ] Response time < 5 seconds for typical query
- [ ] Modal opens instantly (< 100ms)
- [ ] No lag when clicking citations
- [ ] No memory leaks (test with many queries)
- [ ] Server logs show Claude Opus 4.5 being used

## Debugging

### If Response is NOT Synthesized
Check server logs for:
```
🔍 DEBUG Claude Generation Conditions:
   shouldUseLLM: true
   BEDROCK_KB_ID: SET
   Will use Claude: true
```

If `Will use Claude: false`, check:
1. BEDROCK_KB_ID environment variable is set
2. Intent detection is working
3. Narratives are being retrieved

### If Citations Don't Work
Check browser console for:
- JavaScript errors
- Event listener issues
- Alpine.js initialization

Check server logs for:
```
Found X unique citations in response
Mapped X citations to source chunks
```

### If Modal Doesn't Open
Check:
1. `showSourceModal` state in Alpine.js
2. `preview-citation` event is firing
3. Citation object has required fields (ticker, filingType, etc.)

## Success Criteria

### Minimum Viable
- [x] Responses are synthesized (not copy-paste)
- [x] Citations appear inline
- [x] Citations are clickable
- [x] Modal opens and displays source info

### Production Ready
- [ ] 90%+ synthesis quality (manual review)
- [ ] 95%+ citation accuracy
- [ ] No performance issues
- [ ] No UI bugs
- [ ] User feedback positive

## Test Results Template

```markdown
## Test Results - [Date]

### Test 1: Basic Synthesis Quality
- Query: "What are NVDA's risks?"
- Result: ✅ PASS / ❌ FAIL
- Notes: [observations]

### Test 2: Citation Accuracy
- Result: ✅ PASS / ❌ FAIL
- Notes: [observations]

### Test 3: Source Modal Functionality
- Result: ✅ PASS / ❌ FAIL
- Notes: [observations]

### Test 4: Multiple Query Types
- Financial: ✅ PASS / ❌ FAIL
- Competitive: ✅ PASS / ❌ FAIL
- Business Model: ✅ PASS / ❌ FAIL

### Test 5: Edge Cases
- No Citations: ✅ PASS / ❌ FAIL
- Single Source: ✅ PASS / ❌ FAIL
- Many Citations: ✅ PASS / ❌ FAIL

### Overall Assessment
- Synthesis Quality: [1-10]
- Citation Accuracy: [1-10]
- UI/UX: [1-10]
- Performance: [1-10]

### Issues Found
1. [Issue description]
2. [Issue description]

### Recommendations
1. [Recommendation]
2. [Recommendation]
```

## Next Steps After Testing

1. **If Tests Pass:**
   - Mark tasks 1.3, 3.5, 4.1-4.4 as complete
   - Get user feedback from analysts
   - Deploy to production

2. **If Tests Fail:**
   - Document issues
   - Iterate on prompts (if synthesis quality issues)
   - Fix bugs (if technical issues)
   - Re-test

3. **Iteration:**
   - Adjust system prompt based on output quality
   - Fine-tune citation parsing if needed
   - Improve modal UX based on feedback

---

**Ready to Test!** 🚀
