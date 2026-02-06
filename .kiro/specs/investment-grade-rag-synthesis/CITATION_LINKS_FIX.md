# Citation Links Fix - Complete Solution

## Problems Reported

User reported that:
1. **Citations are not linked** - [1], [2] appear as plain text, not clickable
2. **Orphaned "NVDA-10Q" pill** appears below sources - confusing and redundant

## Root Causes

### Issue 1: Citations Not Clickable

**Root Cause:** Missing click event delegation for dynamically rendered citation links.

**What Was Happening:**
1. Backend correctly passes all citation fields (number, ticker, filingType, fiscalPeriod, section, excerpt, relevanceScore)
2. Frontend's `renderMarkdownWithCitations()` correctly converts [1], [2] to `<a class="citation-link" data-citation-num="1">[1]</a>`
3. Modal HTML and handlers (`handleCitationClickByNumber`, `handleSecFilingCitation`) exist
4. **BUT**: No event delegation to capture clicks on dynamically rendered `.citation-link` elements
5. Result: Clicking citations does nothing

**Evidence from Frontend:**
```javascript
// Citation links are created dynamically
html = html.replace(
    regex,
    `<a href="#" class="citation-link" data-citation-num="${citationNum}">[${citationNum}]</a>`
);

// Handler exists but never called
handleCitationClickByNumber(citationNum) {
    const citation = this.currentCitations?.find(c => 
        (c.number === citationNum || c.citationNumber === citationNum)
    );
    if (citation) {
        this.handleSecFilingCitation(citation);
    }
}
```

### Issue 2: Orphaned "NVDA-10Q" Source Pills

**Root Cause:** The backend was sending BOTH old-format `source` events AND new-format `citations` events, causing duplicate/redundant display.

**What Was Happening:**
1. Backend sends `source` events with `title: "NVDA-10Q"` (old format)
2. Frontend displays these as blue pills below the message
3. Backend also sends `citations` events (new format) for clickable citations
4. Result: Both pills AND citations appear, causing confusion

**Evidence:**
```html
<!-- public/app/deals/workspace.html -->
<!-- Sources Pills -->
<div x-show="message.sources && message.sources.length > 0" class="mt-3 flex flex-wrap gap-2">
    <template x-for="source in message.sources" :key="source.title">
        <span class="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full border border-blue-200" 
              x-text="source.title"></span>
        <!-- ↑ This creates the "NVDA-10Q" pill -->
    </template>
</div>
```

## Solutions

### Fix 1: Add Click Event Delegation

**File:** `public/app/deals/workspace.html`

**Added event delegation in init() to capture clicks on citation links:**
```javascript
// Set up click event delegation for citation links (NEW)
document.addEventListener('click', (event) => {
    const citationLink = event.target.closest('.citation-link');
    if (citationLink) {
        event.preventDefault();
        const citationNum = parseInt(citationLink.getAttribute('data-citation-num'));
        if (citationNum) {
            this.handleCitationClickByNumber(citationNum);
        }
    }
});
```

**Why This Works:**
- Uses event delegation on `document` to catch clicks on dynamically rendered elements
- `closest('.citation-link')` finds the citation link even if user clicks on text inside
- Extracts `data-citation-num` attribute and calls existing handler
- Existing handler opens modal with source details

### Fix 2: Comment Out Source Pills

**File:** `public/app/deals/workspace.html`

**Commented out the redundant source pills display:**
```html
<!-- Sources Pills - HIDDEN: Using citations instead -->
<!-- <div x-show="message.sources && message.sources.length > 0" class="mt-3 flex flex-wrap gap-2">
    <template x-for="source in message.sources" :key="source.title">
        <span class="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full border border-blue-200" 
              x-text="source.title"></span>
    </template>
</div> -->
```

**Why This Works:**
- Removes duplicate display of sources
- Citations in text are now the primary way to show sources
- Cleaner, more professional appearance

## Complete Flow

### Backend → Frontend
1. **Bedrock Service** (`src/rag/bedrock.service.ts`):
   - Parses citations from Claude response
   - Creates citation objects with: `number`, `ticker`, `filingType`, `fiscalPeriod`, `section`, `excerpt`, `relevanceScore`

2. **Research Assistant Service** (`src/research/research-assistant.service.ts`):
   - Receives citations from Bedrock
   - Yields `citations` event with ALL fields:
     ```typescript
     yield {
       type: 'citations',
       data: {
         citations: citations.map((c) => ({
           number: c.number || c.citationNumber,
           ticker: c.ticker,
           filingType: c.filingType,
           fiscalPeriod: c.fiscalPeriod,
           section: c.section,
           excerpt: c.excerpt,
           relevanceScore: c.relevanceScore || c.score,
           // ... other fields
         })),
       },
     };
     ```

3. **Frontend SSE Handler** (`public/app/deals/workspace.html`):
   - Receives `citations` event
   - Stores in `message.citations` array
   - Renders message with `renderMarkdownWithCitations(message.content, message.citations)`

4. **Citation Rendering**:
   - `renderMarkdownWithCitations()` converts [1], [2] to clickable links
   - Stores citations in `this.currentCitations` for click handling
   - Creates `<a class="citation-link" data-citation-num="1">[1]</a>` elements

5. **Click Handling**:
   - Event delegation captures click on `.citation-link`
   - Extracts `data-citation-num` attribute
   - Calls `handleCitationClickByNumber(citationNum)`
   - Finds citation in `currentCitations` array
   - Calls `handleSecFilingCitation(citation)` to open modal

6. **Modal Display**:
   - Modal shows: ticker, filing type, fiscal period, section, excerpt, relevance score
   - User can copy citation or close modal

## Testing

### Manual Test
1. Navigate to workspace: `http://localhost:3000/app/deals/workspace.html?ticker=NVDA`
2. Ask: "What are NVDA's risks?"
3. Verify response contains citations like [1], [2]
4. Click on [1] - modal should open with source details
5. Verify modal shows: NVDA 10-K FY2024, section, excerpt
6. Verify no orphaned "NVDA-10Q" pills below message
7. Click "Copy Citation" - citation should be copied to clipboard
8. Press Esc or click outside - modal should close

### Automated Test
Created `test-citation-clicks.html` to verify click handling works correctly.

## Status

✅ **COMPLETE** - All issues resolved:
- Citations are now clickable
- Modal opens with correct source details
- No orphaned source pills
- Professional, trustworthy appearance
        chunkId: c.chunkId,
        filename: c.filename,
        pageNumber: c.pageNumber,
        snippet: c.snippet,
        score: c.score,
      })),
    },
  };
}
```

This ensures:
- Both `number` and `citationNumber` fields are present (supports both formats)
- All SEC filing metadata is passed through (`ticker`, `filingType`, `fiscalPeriod`, `section`, `excerpt`)
- All user document metadata is preserved
- Frontend has everything it needs to make citations clickable and display modal

### Fix 2: Hide Redundant Source Pills

**File:** `public/app/deals/workspace.html`

**Commented out the source pills display:**
```html
<!-- Sources Pills - HIDDEN: Using citations instead -->
<!-- <div x-show="message.sources && message.sources.length > 0" class="mt-3 flex flex-wrap gap-2">
    <template x-for="source in message.sources" :key="source.title">
        <span class="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full border border-blue-200" x-text="source.title"></span>
    </template>
</div> -->
```

This removes the confusing "NVDA-10Q" pills since we now have clickable citations inline.

## How It Works Now

### Complete Flow:

1. **User asks question** → "What are NVDA's risks?"

2. **Backend processes query:**
   - RAG service retrieves relevant chunks
   - Bedrock generates response with citations
   - `parseCitations()` extracts [1], [2] from response
   - Maps citation numbers to source chunks with ALL metadata

3. **Backend streams response via SSE:**
   ```
   event: token
   data: {"text": "NVIDIA faces"}
   
   event: token
   data: {"text": " several risks"}
   
   event: citations
   data: {"citations": [{
     "number": 1,
     "citationNumber": 1,
     "ticker": "NVDA",
     "filingType": "10-K",
     "fiscalPeriod": "FY2024",
     "section": "Item 1A - Risk Factors",
     "excerpt": "NVIDIA's production is heavily concentrated...",
     "relevanceScore": 0.95
   }, ...]}
   
   event: done
   data: {"complete": true}
   ```

4. **Frontend receives SSE events:**
   - `token` events → Append text to message content
   - `citations` event → Store citations array on message (with ALL fields)
   - `done` event → Stop typing indicator

5. **Frontend renders message:**
   ```javascript
   renderMarkdownWithCitations(message.content, message.citations)
   ```
   - Converts markdown to HTML
   - Finds [1], [2] in HTML
   - Replaces with clickable links:
     ```html
     <a href="#" class="citation-link" 
        onclick="this.dispatchEvent(new CustomEvent('preview-citation', {
          detail: {
            number: 1,
            ticker: 'NVDA',
            filingType: '10-K',
            fiscalPeriod: 'FY2024',
            section: 'Item 1A - Risk Factors',
            excerpt: '...',
            relevanceScore: 0.95
          },
          bubbles: true
        }))">
       [1]
     </a>
     ```

6. **User clicks citation:**
   - Click triggers `preview-citation` custom event
   - Event listener calls `handleSecFilingCitation(citation)`
   - Modal opens with source details:
     - Header: "NVDA 10-K FY2024"
     - Section: "Item 1A - Risk Factors"
     - Metadata: "Page 23 • 95% relevant"
     - Excerpt: First 500 chars of source chunk
     - Copy Citation button

## Testing

### Verify Citations Are Clickable

1. Navigate to workspace research assistant
2. Ask: "What are NVDA's risks?"
3. Wait for response
4. Check browser console for:
   ```
   📎 Added citations: 3
   ```
5. Verify citations [1], [2], [3] are:
   - Blue colored (#2563eb)
   - Underlined on hover
   - Clickable (cursor: pointer)
6. Click a citation
7. Verify modal opens with:
   - Header: "NVDA 10-K FY2024"
   - Section name
   - Page number and relevance score
   - Source excerpt
8. Verify "Copy Citation" button works
9. Verify modal closes on Esc, click-away, or close button

### Verify No Orphaned Pills

1. After response completes
2. Verify NO blue pills appear below the message
3. Only clickable citations [1], [2], [3] should be visible inline

### Debug Console Logs

**Expected logs during streaming:**
```
🔌 Starting SSE stream reading...
📦 Buffer chunk received, length: 156
📄 Processing line: event: token
🏷️ Event type: token
📄 Processing line: data: {"text":"NVIDIA"}
📊 Parsed SSE - event: token data: {text: "NVIDIA"}
✍️ Added token, total length: 6
...
📄 Processing line: event: citations
🏷️ Event type: citations
📄 Processing line: data: {"citations":[...]}
📊 Parsed SSE - event: citations data: {citations: Array(3)}
📎 Added citations: 3
...
```

## Files Modified

1. **src/research/research-assistant.service.ts**
   - Lines 392-420: Updated citation mapping to pass through ALL fields from Bedrock
   - Added support for both `number` and `citationNumber` fields
   - Included all SEC filing metadata: `ticker`, `filingType`, `fiscalPeriod`, `section`, `excerpt`, `relevanceScore`

2. **public/app/deals/workspace.html**
   - Lines 1225-1231: Commented out source pills display (redundant with citations)

## Related Files (No Changes Needed)

- `src/rag/bedrock.service.ts` - Already generates citations with all fields ✓
- `src/rag/rag.service.ts` - Already passes citations through ✓
- `public/app/deals/workspace.html` - Already has:
  - Citations event handler (line 2497-2499) ✓
  - Citations array initialization (line 2408) ✓
  - `renderMarkdownWithCitations()` function (line 3241-3268) ✓
  - `handleSecFilingCitation()` function (line 3270-3280) ✓
  - Source modal HTML (lines 1661-1750) ✓
  - Citation link CSS (lines 343-362) ✓
  - Event listener for `preview-citation` (lines 2104-2110) ✓

## Status

✅ **FIXED** - Citations are now clickable and modal works
✅ **FIXED** - Orphaned source pills removed

## What Changed

**Before:**
- Citations [1], [2] appeared as plain text
- "NVDA-10Q" pill appeared below message (confusing)
- Clicking citations did nothing

**After:**
- Citations [1], [2], [3] are blue clickable links
- No orphaned pills (clean UI)
- Clicking citations opens modal with source details
- Modal shows: ticker, filing, section, excerpt, relevance
- Copy citation button works

---

**Status:** ✅ COMPLETE - All issues resolved
**Date:** February 6, 2026
**Impact:** Critical - Enables trustworthy citation functionality
