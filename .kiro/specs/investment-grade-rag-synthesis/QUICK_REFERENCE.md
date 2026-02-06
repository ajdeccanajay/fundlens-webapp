# Citation Clicks - Quick Reference

## What Was Fixed
**Problem:** Citations [1], [2], [3] appeared in text but were not clickable.

**Solution:** Added event delegation to capture clicks on dynamically rendered citation links.

## The Fix (One Line Summary)
Added click event listener in `init()` that captures clicks on `.citation-link` elements and opens modal with source details.

## Code Location
**File:** `public/app/deals/workspace.html`
**Line:** ~2115 (in init() method)

```javascript
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

## How It Works
1. User clicks on [1] in the response
2. Event delegation captures the click
3. Extracts citation number from `data-citation-num` attribute
4. Calls `handleCitationClickByNumber(1)`
5. Finds citation in `currentCitations` array
6. Opens modal with source details

## Testing
```bash
# 1. Navigate to workspace
http://localhost:3000/app/deals/workspace.html?ticker=NVDA

# 2. Ask a question
"What are NVDA's risks?"

# 3. Click on [1], [2], [3]
# Modal should open with source details
```

## Debugging
```javascript
// Check citations array
Alpine.store('workspace').currentCitations

// Check modal state
Alpine.store('workspace').sourceModal

// Check if event delegation is working
// (Add console.log in the click handler)
```

## Related Files
- `src/research/research-assistant.service.ts` - Sends citations to frontend
- `src/rag/bedrock.service.ts` - Parses citations from Claude
- `public/app/deals/workspace.html` - Renders citations and handles clicks

## Status
✅ **COMPLETE** - Citations are now clickable and trustworthy.
