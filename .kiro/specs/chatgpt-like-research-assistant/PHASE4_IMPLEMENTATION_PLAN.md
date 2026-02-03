# Phase 4: Frontend Integration - Implementation Plan

**Status**: In Progress  
**Date**: January 27, 2026

## Overview

Integrate citation display and document preview into the research assistant frontend. Enable users to see which documents were cited and preview the source content.

## Goals

1. Display citation numbers in assistant responses [1], [2], [3]
2. Make citations clickable to preview document
3. Show citation sidebar with document metadata
4. Enable document preview modal with highlighted text
5. Add document upload UI to research assistant

## Architecture

### Citation Display Flow
```
1. User sends message
2. Backend returns response with citations array
3. Frontend parses citations and adds superscript numbers
4. User clicks citation number
5. Modal opens showing document preview
6. Highlighted text shows the cited passage
```

### Data Structure
```typescript
interface Citation {
  citationNumber: number;
  documentId: string;
  chunkId: string;
  filename: string;
  ticker: string | null;
  pageNumber: number | null;
  snippet: string;
  score: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[];
  citations: Citation[];  // NEW
  createdAt: Date;
}
```

## Implementation Tasks

### Task 1: Citation API Endpoints ✅ (Backend Ready)
**Status**: Already implemented in Phase 3
- `CitationService` created
- Citations stored automatically
- Ready for frontend consumption

### Task 2: Update Message Response Format
**File**: `src/research/research-assistant.controller.ts`
- Include citations in SSE stream
- Add citation metadata to message response

### Task 3: Frontend Citation Display
**File**: `public/app/research/index.html`
- Parse citations from message
- Add superscript citation numbers [1], [2], [3]
- Style citations as clickable links
- Show citation sidebar below message

### Task 4: Document Preview Modal
**File**: `public/app/research/index.html`
- Create modal component
- Fetch document content
- Display document metadata
- Highlight cited text
- Navigate between pages

### Task 5: Document Upload UI
**File**: `public/app/research/index.html`
- Add upload button to sidebar
- File picker for PDF/DOCX/TXT
- Upload progress indicator
- Success/error notifications
- Document list with delete option

### Task 6: Citation Preview API
**File**: `src/rag/citation.controller.ts` (NEW)
- GET `/api/citations/:messageId` - Get citations for message
- GET `/api/documents/:documentId/preview` - Preview document content

## UI Design

### Citation Display
```
Assistant: Based on the documents, revenue increased by 15% [1] 
and operating margin improved to 30% [2].

Sources:
[1] Q4 2023 Earnings Report (Page 5)
[2] Annual Report 2023 (Page 12)

[View All Citations]
```

### Citation Modal
```
┌─────────────────────────────────────────────────┐
│ Q4 2023 Earnings Report                    [X] │
├─────────────────────────────────────────────────┤
│ Ticker: AAPL                                    │
│ Page: 5 of 45                                   │
│ Relevance: 95%                                  │
├─────────────────────────────────────────────────┤
│                                                 │
│ Revenue increased to $2.5B in Q4 2023,         │
│ representing a 15% year-over-year growth.      │
│ This was driven by strong performance in...    │
│                                                 │
│ [< Previous] [Next >] [Download]               │
└─────────────────────────────────────────────────┘
```

### Document Upload
```
┌─────────────────────────────────────────────────┐
│ My Documents                                    │
├─────────────────────────────────────────────────┤
│ [+ Upload Document]                             │
│                                                 │
│ ✓ Q4 2023 Earnings.pdf (AAPL)                  │
│   Uploaded 2 hours ago                    [🗑] │
│                                                 │
│ ✓ Pitch Deck.pdf (MSFT)                        │
│   Uploaded yesterday                      [🗑] │
│                                                 │
│ ⏳ Annual Report.pdf (Processing...)           │
└─────────────────────────────────────────────────┘
```

## Technical Details

### Citation Parsing
```javascript
function parseCitations(content, citations) {
  // Replace citation markers with clickable links
  let parsed = content;
  citations.forEach((citation, index) => {
    const marker = `[${citation.citationNumber}]`;
    const link = `<sup class="citation-link" data-citation-id="${citation.citationNumber}">${marker}</sup>`;
    parsed = parsed.replace(marker, link);
  });
  return parsed;
}
```

### Document Preview
```javascript
async function previewDocument(documentId, chunkId) {
  const response = await fetch(
    `/api/documents/${documentId}/preview?chunkId=${chunkId}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const data = await response.json();
  
  // Show modal with document content
  showDocumentModal({
    title: data.title,
    ticker: data.ticker,
    pageNumber: data.pageNumber,
    content: data.content,
    highlightedText: data.highlightedText
  });
}
```

### Document Upload
```javascript
async function uploadDocument(file, ticker) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('ticker', ticker);
  
  const response = await fetch('/api/documents/upload', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });
  
  if (!response.ok) throw new Error('Upload failed');
  
  const data = await response.json();
  return data.data;
}
```

## Styling

### Citation Links
```css
.citation-link {
  color: #2563eb;
  cursor: pointer;
  font-weight: 600;
  text-decoration: none;
  padding: 0 2px;
  transition: all 0.2s;
}

.citation-link:hover {
  color: #1d4ed8;
  background: #eff6ff;
  border-radius: 4px;
}
```

### Citation Sidebar
```css
.citation-sidebar {
  background: #f9fafb;
  border-left: 3px solid #3b82f6;
  padding: 12px;
  margin-top: 12px;
  border-radius: 8px;
}

.citation-item {
  display: flex;
  align-items: start;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.citation-item:hover {
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
```

### Document Preview Modal
```css
.document-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.document-content {
  background: white;
  border-radius: 12px;
  max-width: 800px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}

.highlighted-text {
  background: #fef3c7;
  padding: 2px 4px;
  border-radius: 2px;
  font-weight: 500;
}
```

## Testing Strategy

### Unit Tests
- Citation parsing logic
- Document preview data fetching
- Upload progress tracking

### E2E Tests
1. Upload document → Ask question → Verify citations appear
2. Click citation → Verify modal opens with correct content
3. Navigate between pages in document preview
4. Delete document → Verify removed from list
5. Upload multiple documents → Verify all processed

### Manual Testing
1. Upload various file types (PDF, DOCX, TXT)
2. Test citation display with multiple citations
3. Test document preview with long documents
4. Test error handling (upload failures, missing documents)
5. Test mobile responsiveness

## Success Criteria

✅ Citations display as clickable superscript numbers  
✅ Citation sidebar shows document metadata  
✅ Document preview modal opens on click  
✅ Highlighted text shows cited passage  
✅ Document upload UI is intuitive  
✅ Upload progress is visible  
✅ Error handling is graceful  
✅ Mobile responsive  
✅ E2E tests pass  

## Timeline

- **Task 2**: Update message response format (15 min)
- **Task 3**: Frontend citation display (30 min)
- **Task 4**: Document preview modal (30 min)
- **Task 5**: Document upload UI (30 min)
- **Task 6**: Citation preview API (20 min)
- **Testing**: E2E tests (20 min)

**Total Estimated Time**: 2-3 hours

## Next Steps

1. Update research assistant controller to include citations in response
2. Add citation parsing to frontend
3. Create document preview modal
4. Add document upload UI
5. Create citation preview API endpoints
6. Write E2E tests
7. Manual testing and polish
