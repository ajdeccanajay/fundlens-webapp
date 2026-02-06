# Citation Click Flow - Visual Diagram

## Complete End-to-End Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER ASKS QUESTION                               │
│                    "What are NVDA's risks?"                              │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    RESEARCH ASSISTANT SERVICE                            │
│  src/research/research-assistant.service.ts                              │
│                                                                           │
│  1. Calls RAG service with query                                         │
│  2. Gets back: { answer, citations, sources }                            │
│  3. Streams response via SSE:                                            │
│     - event: token, data: { text: "..." }                                │
│     - event: citations, data: { citations: [...] }                       │
│     - event: done, data: { complete: true }                              │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         CITATIONS EVENT                                  │
│  {                                                                        │
│    type: 'citations',                                                    │
│    data: {                                                               │
│      citations: [                                                        │
│        {                                                                 │
│          number: 1,                                                      │
│          ticker: 'NVDA',                                                 │
│          filingType: '10-K',                                             │
│          fiscalPeriod: 'FY2024',                                         │
│          section: 'Item 1A. Risk Factors',                               │
│          excerpt: 'We face intense competition...',                      │
│          relevanceScore: 0.95                                            │
│        },                                                                │
│        { number: 2, ... },                                               │
│        { number: 3, ... }                                                │
│      ]                                                                   │
│    }                                                                     │
│  }                                                                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      FRONTEND SSE HANDLER                                │
│  public/app/deals/workspace.html                                         │
│                                                                           │
│  if (currentEvent === 'citations' && data.citations) {                  │
│    this.researchMessages[assistantMessageIndex].citations = data.citations;│
│    console.log('📎 Added citations:', data.citations.length);           │
│  }                                                                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      MESSAGE RENDERING                                   │
│  <div x-html="renderMarkdownWithCitations(message.content, message.citations)">│
│                                                                           │
│  renderMarkdownWithCitations(content, citations) {                       │
│    // Store citations for click handling                                 │
│    this.currentCitations = citations;                                    │
│                                                                           │
│    // Render markdown                                                    │
│    let html = this.renderMarkdown(content);                              │
│                                                                           │
│    // Convert [1], [2] to clickable links                                │
│    citations.forEach(citation => {                                       │
│      const citationNum = citation.number;                                │
│      const regex = new RegExp(`\\[${citationNum}\\]`, 'g');             │
│      html = html.replace(                                                │
│        regex,                                                            │
│        `<a href="#" class="citation-link" data-citation-num="${citationNum}">[${citationNum}]</a>`│
│      );                                                                  │
│    });                                                                   │
│                                                                           │
│    return html;                                                          │
│  }                                                                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      RENDERED HTML                                       │
│                                                                           │
│  <p>NVIDIA faces several key risks <a href="#" class="citation-link"    │
│     data-citation-num="1">[1]</a>, including intense competition         │
│     <a href="#" class="citation-link" data-citation-num="2">[2]</a>     │
│     and supply chain constraints <a href="#" class="citation-link"       │
│     data-citation-num="3">[3]</a>.</p>                                  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
                          USER CLICKS [1]
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    EVENT DELEGATION (init)                               │
│                                                                           │
│  document.addEventListener('click', (event) => {                         │
│    const citationLink = event.target.closest('.citation-link');         │
│    if (citationLink) {                                                   │
│      event.preventDefault();                                             │
│      const citationNum = parseInt(citationLink.getAttribute('data-citation-num'));│
│      if (citationNum) {                                                  │
│        this.handleCitationClickByNumber(citationNum);  // ← CALLS THIS  │
│      }                                                                   │
│    }                                                                     │
│  });                                                                     │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  handleCitationClickByNumber(1)                          │
│                                                                           │
│  const citation = this.currentCitations?.find(c =>                       │
│    (c.number === citationNum || c.citationNumber === citationNum)       │
│  );                                                                      │
│                                                                           │
│  if (citation) {                                                         │
│    this.handleSecFilingCitation(citation);  // ← CALLS THIS             │
│  }                                                                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  handleSecFilingCitation(citation)                       │
│                                                                           │
│  this.sourceModal = {                                                    │
│    ticker: citation.ticker,              // 'NVDA'                       │
│    filingType: citation.filingType,      // '10-K'                       │
│    fiscalPeriod: citation.fiscalPeriod,  // 'FY2024'                     │
│    section: citation.section,            // 'Item 1A. Risk Factors'      │
│    pageNumber: citation.pageNumber,      // null or page number          │
│    excerpt: citation.excerpt,            // 'We face intense...'         │
│    relevanceScore: citation.relevanceScore, // 0.95                      │
│  };                                                                      │
│  this.showSourceModal = true;  // ← OPENS MODAL                         │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         MODAL DISPLAYS                                   │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  NVDA 10-K FY2024                                          [X]   │   │
│  │  Item 1A. Risk Factors                                          │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │  📄 Page 15  ⭐ 95% relevant                                     │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │  Source Excerpt                                                 │   │
│  │  ┌───────────────────────────────────────────────────────────┐ │   │
│  │  │ We face intense competition in the markets in which we    │ │   │
│  │  │ operate. Our competitors include companies that offer     │ │   │
│  │  │ similar products and services...                          │ │   │
│  │  └───────────────────────────────────────────────────────────┘ │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │  [Close]                              [📋 Copy Citation]        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Citation Storage
- **Where:** `this.currentCitations` in Alpine.js component
- **When:** Set by `renderMarkdownWithCitations()`
- **Why:** Needed for click handling to find citation details

### 2. Citation Links
- **HTML:** `<a class="citation-link" data-citation-num="1">[1]</a>`
- **Styling:** Blue text, hover effect, rounded background
- **Data Attribute:** `data-citation-num` stores the citation number

### 3. Event Delegation
- **Where:** `document.addEventListener('click', ...)` in init()
- **Why:** Captures clicks on dynamically rendered elements
- **How:** Uses `closest('.citation-link')` to find citation link

### 4. Modal State
- **Where:** `this.sourceModal` object
- **Fields:** ticker, filingType, fiscalPeriod, section, excerpt, relevanceScore
- **Trigger:** `this.showSourceModal = true`

## Why Event Delegation?

**Problem:** Citation links are rendered dynamically via `x-html` directive. They don't exist when the page loads.

**Solution:** Event delegation listens on `document` (which always exists) and checks if the clicked element is a citation link.

**Alternative (doesn't work):**
```javascript
// ❌ This won't work - elements don't exist yet
document.querySelectorAll('.citation-link').forEach(link => {
  link.addEventListener('click', handler);
});
```

**Correct approach:**
```javascript
// ✅ This works - listens on document, checks target
document.addEventListener('click', (event) => {
  const citationLink = event.target.closest('.citation-link');
  if (citationLink) {
    // Handle click
  }
});
```

## Debugging Tips

### Check Citations Array
```javascript
// In browser console
Alpine.store('workspace').currentCitations
// Should show: [{ number: 1, ticker: 'NVDA', ... }, ...]
```

### Check Event Delegation
```javascript
// Add to init()
document.addEventListener('click', (event) => {
  console.log('Clicked:', event.target);
  const citationLink = event.target.closest('.citation-link');
  if (citationLink) {
    console.log('Citation link clicked!', citationLink);
  }
});
```

### Check Modal State
```javascript
// In browser console
Alpine.store('workspace').sourceModal
// Should show: { ticker: 'NVDA', filingType: '10-K', ... }
```
