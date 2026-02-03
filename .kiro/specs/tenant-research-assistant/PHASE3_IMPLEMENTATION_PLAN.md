# Phase 3: Notebook System - Implementation Plan

**Date**: January 26, 2026
**Duration**: Weeks 5-6
**Status**: In Progress

---

## Overview

Phase 3 implements the Notebook System, allowing users to save insights from research conversations, organize them, and export them in various formats.

---

## Goals

1. ✅ Backend: Implement NotebookService with full CRUD operations
2. ✅ Backend: Implement NotebookController with REST API
3. ✅ Backend: Add insight management (create, update, delete, reorder)
4. ✅ Backend: Add export functionality (Markdown, PDF, DOCX)
5. ✅ Backend: Write comprehensive unit tests (>90% coverage)
6. ✅ Frontend: Add "Save to Notebook" button in chat interface
7. ✅ Frontend: Create notebook sidebar panel
8. ✅ Frontend: Implement drag-and-drop reordering
9. ✅ Frontend: Add export UI
10. ✅ Frontend: Write automated Playwright tests

---

## Database Schema

Already created in Phase 1 migration:

```sql
-- Research notebooks
CREATE TABLE research_notebooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_archived BOOLEAN DEFAULT FALSE
);

-- Saved insights
CREATE TABLE research_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id UUID NOT NULL REFERENCES research_notebooks(id) ON DELETE CASCADE,
  message_id UUID REFERENCES research_messages(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  selected_text TEXT,
  user_notes TEXT,
  tags TEXT[],
  companies TEXT[],
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  position INTEGER
);
```

---

## API Endpoints

### Notebook CRUD

```typescript
POST   /research/notebooks              // Create notebook
GET    /research/notebooks              // List notebooks
GET    /research/notebooks/:id          // Get notebook with insights
PATCH  /research/notebooks/:id          // Update notebook
DELETE /research/notebooks/:id          // Delete notebook
```

### Insight Management

```typescript
POST   /research/notebooks/:id/insights              // Add insight
PATCH  /research/notebooks/:id/insights/:insightId  // Update insight
DELETE /research/notebooks/:id/insights/:insightId  // Delete insight
POST   /research/notebooks/:id/insights/reorder     // Reorder insights
```

### Export

```typescript
GET    /research/notebooks/:id/export?format=markdown  // Export as Markdown
GET    /research/notebooks/:id/export?format=pdf      // Export as PDF
GET    /research/notebooks/:id/export?format=docx     // Export as DOCX
```

---

## Implementation Steps

### Step 1: Backend Service (NotebookService)

**File**: `src/research/notebook.service.ts`

**Methods**:
- `createNotebook(title, description)` - Create new notebook
- `listNotebooks(filters, pagination)` - List user's notebooks
- `getNotebook(id)` - Get notebook with insights
- `updateNotebook(id, data)` - Update notebook
- `deleteNotebook(id)` - Delete notebook
- `addInsight(notebookId, data)` - Add insight to notebook
- `updateInsight(notebookId, insightId, data)` - Update insight
- `deleteInsight(notebookId, insightId)` - Delete insight
- `reorderInsights(notebookId, insightIds)` - Reorder insights
- `exportNotebook(id, format)` - Export notebook

**Tenant Isolation**:
- All queries filter by `tenant_id` and `user_id`
- Verify ownership before updates/deletes
- Return 404 (not 403) for unauthorized access

### Step 2: Backend Controller (NotebookController)

**File**: `src/research/notebook.controller.ts`

**Endpoints**:
- All endpoints use `@UseGuards(TenantGuard)`
- All endpoints inject tenant context
- All endpoints return standardized responses

### Step 3: Backend Tests

**File**: `test/unit/notebook.service.spec.ts`

**Test Coverage**:
- Notebook CRUD (10 tests)
- Insight management (8 tests)
- Tenant isolation (6 tests)
- User isolation (2 tests)
- Reordering (3 tests)
- Export (3 tests)

**Target**: 30+ tests, >90% coverage

### Step 4: Frontend - Save to Notebook Button

**File**: `public/app/research/index.html`

**Features**:
- Add "Save to Notebook" button to assistant messages
- Modal to select notebook or create new one
- Option to add user notes
- Option to add tags
- Success notification

### Step 5: Frontend - Notebook Sidebar

**File**: `public/app/research/index.html`

**Features**:
- Collapsible notebook panel (right side)
- List of notebooks
- Create new notebook button
- Select notebook to view insights
- Archive/delete notebook

### Step 6: Frontend - Insight Management

**File**: `public/app/research/index.html`

**Features**:
- Display insights in selected notebook
- Drag-and-drop reordering
- Edit insight notes
- Delete insight
- Add tags to insights

### Step 7: Frontend - Export UI

**File**: `public/app/research/index.html`

**Features**:
- Export button in notebook panel
- Format selector (Markdown, PDF, DOCX)
- Download file

### Step 8: Frontend Tests

**File**: `test/e2e/research-assistant-notebooks.spec.ts`

**Test Coverage**:
- Create notebook (2 tests)
- Save insight to notebook (3 tests)
- View notebook insights (2 tests)
- Reorder insights (2 tests)
- Edit insight (2 tests)
- Delete insight (1 test)
- Export notebook (3 tests)

**Target**: 15+ tests

---

## Technical Details

### Export Formats

#### Markdown Export

```typescript
function exportMarkdown(notebook: Notebook): string {
  let md = `# ${notebook.title}\n\n`;
  if (notebook.description) {
    md += `${notebook.description}\n\n`;
  }
  md += `---\n\n`;
  
  for (const insight of notebook.insights) {
    md += `## ${insight.title || 'Insight'}\n\n`;
    md += `${insight.content}\n\n`;
    
    if (insight.userNotes) {
      md += `**Notes**: ${insight.userNotes}\n\n`;
    }
    
    if (insight.tags?.length) {
      md += `**Tags**: ${insight.tags.join(', ')}\n\n`;
    }
    
    if (insight.companies?.length) {
      md += `**Companies**: ${insight.companies.join(', ')}\n\n`;
    }
    
    md += `---\n\n`;
  }
  
  return md;
}
```

#### PDF Export

Use library like `pdfkit` or `puppeteer`:
```typescript
import PDFDocument from 'pdfkit';

function exportPDF(notebook: Notebook): Buffer {
  const doc = new PDFDocument();
  const chunks = [];
  
  doc.on('data', chunk => chunks.push(chunk));
  
  doc.fontSize(24).text(notebook.title);
  doc.moveDown();
  
  for (const insight of notebook.insights) {
    doc.fontSize(16).text(insight.title || 'Insight');
    doc.fontSize(12).text(insight.content);
    doc.moveDown();
  }
  
  doc.end();
  
  return Buffer.concat(chunks);
}
```

#### DOCX Export

Use library like `docx`:
```typescript
import { Document, Packer, Paragraph, TextRun } from 'docx';

async function exportDOCX(notebook: Notebook): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text: notebook.title,
              bold: true,
              size: 32,
            }),
          ],
        }),
        ...notebook.insights.map(insight => 
          new Paragraph({
            children: [
              new TextRun({
                text: insight.content,
              }),
            ],
          })
        ),
      ],
    }],
  });
  
  return await Packer.toBuffer(doc);
}
```

### Drag-and-Drop Reordering

Use SortableJS or native HTML5 drag-and-drop:

```html
<div x-data="notebookManager()">
  <div id="insights-list" class="sortable">
    <template x-for="insight in insights" :key="insight.id">
      <div class="insight-card" :data-id="insight.id" draggable="true">
        <div class="drag-handle">⋮⋮</div>
        <div x-text="insight.content"></div>
      </div>
    </template>
  </div>
</div>

<script>
// Initialize SortableJS
new Sortable(document.getElementById('insights-list'), {
  animation: 150,
  handle: '.drag-handle',
  onEnd: async (evt) => {
    const newOrder = Array.from(evt.to.children).map(el => el.dataset.id);
    await reorderInsights(notebookId, newOrder);
  }
});
</script>
```

---

## Success Criteria

### Backend

- [x] NotebookService implemented with all methods
- [x] NotebookController implemented with all endpoints
- [x] 30+ unit tests passing (>90% coverage)
- [x] Tenant isolation enforced
- [x] Export functionality working (Markdown, PDF, DOCX)

### Frontend

- [ ] "Save to Notebook" button in chat interface
- [ ] Notebook sidebar panel
- [ ] Create/edit/delete notebooks
- [ ] Add/edit/delete insights
- [ ] Drag-and-drop reordering
- [ ] Export UI (Markdown, PDF, DOCX)
- [ ] 15+ Playwright tests passing

### Quality

- [ ] All tests passing (backend + frontend)
- [ ] No console errors
- [ ] No memory leaks
- [ ] Performance acceptable (<2s for operations)
- [ ] Mobile responsive

---

## Timeline

### Week 5

**Days 1-2**: Backend Implementation
- Implement NotebookService
- Implement NotebookController
- Write unit tests

**Days 3-4**: Frontend Implementation
- Add "Save to Notebook" button
- Create notebook sidebar panel
- Implement insight management

**Day 5**: Testing & Polish
- Write Playwright tests
- Fix bugs
- Polish UI

### Week 6

**Days 1-2**: Export Functionality
- Implement Markdown export
- Implement PDF export
- Implement DOCX export

**Days 3-4**: Drag-and-Drop
- Implement reordering UI
- Test reordering functionality
- Polish animations

**Day 5**: Final Testing & Documentation
- Run all tests
- Update documentation
- Prepare for Phase 4

---

## Dependencies

### NPM Packages

```bash
# For PDF export
npm install pdfkit @types/pdfkit

# For DOCX export
npm install docx

# For drag-and-drop (optional, can use native HTML5)
npm install sortablejs @types/sortablejs
```

---

## Next Phase

**Phase 4**: IC Memo Generation (Weeks 7-8)
- Generate IC memos from notebooks
- Memo templates (executive, detailed, comparison)
- Memo editor
- Export memos

---

**Created**: January 26, 2026
**Status**: Ready to Implement
