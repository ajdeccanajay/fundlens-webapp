# Phase 3 Frontend Implementation Plan

**Date**: January 26, 2026
**Status**: Ready to Implement

---

## Overview

Add notebook functionality to the Research Assistant frontend, allowing users to save insights from conversations into organized notebooks.

---

## UI Components to Add

### 1. Notebook Sidebar (Right Side)

**Location**: Right side of the screen (collapsible)
**Features**:
- List of notebooks
- Create new notebook button
- Select notebook to view insights
- Archive/delete notebook
- Export notebook button

**Layout**:
```
┌─────────────────────────────────────────────────────────┐
│  Conversations  │    Chat Area    │    Notebooks       │
│   (Left)        │    (Center)     │    (Right)         │
│                 │                 │                     │
│  [New Conv]     │  Messages       │  [New Notebook]    │
│                 │                 │                     │
│  Conv 1         │  User: ...      │  📓 Q4 Research    │
│  Conv 2         │  AI: ...        │     - Insight 1    │
│  Conv 3         │                 │     - Insight 2    │
│                 │  [Input]        │                     │
│                 │                 │  📓 Tech Analysis  │
│                 │                 │     - Insight 1    │
└─────────────────────────────────────────────────────────┘
```

### 2. "Save to Notebook" Button

**Location**: On each assistant message
**Features**:
- Click to open modal
- Select existing notebook or create new
- Add user notes
- Add tags
- Save insight

**UI**:
```html
<div class="message-assistant">
  <div class="message-content">
    AI response content...
  </div>
  <div class="message-actions">
    <button class="btn-save-notebook">
      <i class="fas fa-bookmark"></i> Save to Notebook
    </button>
    <button class="btn-copy">
      <i class="fas fa-copy"></i>
    </button>
  </div>
</div>
```

### 3. Save to Notebook Modal

**Features**:
- Select existing notebook (dropdown)
- Or create new notebook (inline)
- Add user notes (textarea)
- Add tags (comma-separated input)
- Save button

**UI**:
```html
<div class="modal">
  <h3>Save to Notebook</h3>
  
  <label>Notebook</label>
  <select>
    <option>Select notebook...</option>
    <option>Q4 2024 Research</option>
    <option>Tech Analysis</option>
    <option>+ Create New Notebook</option>
  </select>
  
  <label>User Notes (optional)</label>
  <textarea placeholder="Add your notes..."></textarea>
  
  <label>Tags (optional)</label>
  <input placeholder="revenue, growth, analysis" />
  
  <button>Save Insight</button>
  <button>Cancel</button>
</div>
```

### 4. Notebook Detail View

**Features**:
- Display insights in selected notebook
- Reorder insights (drag-and-drop)
- Edit insight notes
- Delete insight
- Export notebook

**UI**:
```html
<div class="notebook-detail">
  <h3>Q4 2024 Research</h3>
  <p>Tech company analysis</p>
  
  <div class="insights-list">
    <div class="insight-card" draggable="true">
      <div class="drag-handle">⋮⋮</div>
      <div class="insight-content">
        AAPL revenue grew 15% YoY
      </div>
      <div class="insight-notes">
        Strong services growth
      </div>
      <div class="insight-tags">
        <span class="tag">revenue</span>
        <span class="tag">growth</span>
      </div>
      <div class="insight-actions">
        <button>Edit</button>
        <button>Delete</button>
      </div>
    </div>
  </div>
  
  <button>Export Notebook</button>
</div>
```

---

## Implementation Steps

### Step 1: Add Notebook State to Alpine.js

```javascript
function researchAssistant() {
  return {
    // Existing state...
    
    // Notebook state
    notebooks: [],
    activeNotebookId: null,
    insights: [],
    showNotebookPanel: true,
    showSaveModal: false,
    selectedMessageForSave: null,
    newNotebookTitle: '',
    insightNotes: '',
    insightTags: '',
    
    // Notebook methods
    async loadNotebooks() { ... },
    async createNotebook(title, description) { ... },
    async selectNotebook(notebookId) { ... },
    async saveInsight(messageId, content) { ... },
    async deleteInsight(insightId) { ... },
    async reorderInsights(insightIds) { ... },
    async exportNotebook(notebookId, format) { ... },
  };
}
```

### Step 2: Add Notebook Sidebar HTML

```html
<!-- Notebook Sidebar -->
<div class="w-80 bg-white border-l border-gray-200 flex flex-col" x-show="showNotebookPanel">
  <!-- Header -->
  <div class="p-4 border-b border-gray-200">
    <button @click="createNotebookModal = true" 
            class="w-full bg-indigo-600 text-white px-4 py-3 rounded-xl">
      <i class="fas fa-plus mr-2"></i>
      New Notebook
    </button>
  </div>
  
  <!-- Notebooks List -->
  <div class="flex-1 overflow-y-auto p-3">
    <template x-for="notebook in notebooks" :key="notebook.id">
      <div @click="selectNotebook(notebook.id)" 
           :class="{'active': activeNotebookId === notebook.id}"
           class="notebook-item">
        <h3 x-text="notebook.title"></h3>
        <p x-text="notebook.insightCount + ' insights'"></p>
      </div>
    </template>
  </div>
</div>
```

### Step 3: Add "Save to Notebook" Button

```html
<template x-if="message.role === 'assistant'">
  <div class="flex justify-start">
    <div class="message-assistant">
      <div x-html="renderMarkdown(message.content)"></div>
      
      <!-- Add Save Button -->
      <div class="message-actions mt-3 flex gap-2">
        <button @click="openSaveModal(message)" 
                class="btn-save">
          <i class="fas fa-bookmark mr-1"></i>
          Save to Notebook
        </button>
        <button @click="copyMessage(message.content)" 
                class="btn-copy">
          <i class="fas fa-copy mr-1"></i>
          Copy
        </button>
      </div>
      
      <!-- Sources -->
      <template x-if="message.sources && message.sources.length > 0">
        ...
      </template>
    </div>
  </div>
</template>
```

### Step 4: Add Save Modal

```html
<!-- Save to Notebook Modal -->
<div x-show="showSaveModal" 
     class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
     @click.self="showSaveModal = false">
  <div class="bg-white rounded-xl p-6 max-w-md w-full">
    <h3 class="text-xl font-bold mb-4">Save to Notebook</h3>
    
    <!-- Notebook Selection -->
    <div class="mb-4">
      <label class="block text-sm font-medium mb-2">Notebook</label>
      <select x-model="selectedNotebookId" class="w-full border rounded-lg p-2">
        <option value="">Select notebook...</option>
        <template x-for="notebook in notebooks" :key="notebook.id">
          <option :value="notebook.id" x-text="notebook.title"></option>
        </template>
        <option value="new">+ Create New Notebook</option>
      </select>
    </div>
    
    <!-- New Notebook Title (if creating new) -->
    <div x-show="selectedNotebookId === 'new'" class="mb-4">
      <label class="block text-sm font-medium mb-2">New Notebook Title</label>
      <input x-model="newNotebookTitle" 
             type="text" 
             placeholder="Q4 2024 Research"
             class="w-full border rounded-lg p-2" />
    </div>
    
    <!-- User Notes -->
    <div class="mb-4">
      <label class="block text-sm font-medium mb-2">Notes (optional)</label>
      <textarea x-model="insightNotes" 
                placeholder="Add your notes..."
                rows="3"
                class="w-full border rounded-lg p-2"></textarea>
    </div>
    
    <!-- Tags -->
    <div class="mb-4">
      <label class="block text-sm font-medium mb-2">Tags (optional)</label>
      <input x-model="insightTags" 
             type="text" 
             placeholder="revenue, growth, analysis"
             class="w-full border rounded-lg p-2" />
    </div>
    
    <!-- Actions -->
    <div class="flex gap-2">
      <button @click="saveInsightToNotebook()" 
              class="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-lg">
        Save
      </button>
      <button @click="showSaveModal = false" 
              class="flex-1 border border-gray-300 px-4 py-2 rounded-lg">
        Cancel
      </button>
    </div>
  </div>
</div>
```

### Step 5: Add Drag-and-Drop for Reordering

```html
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js"></script>

<script>
// Initialize drag-and-drop
const insightsList = document.getElementById('insights-list');
if (insightsList) {
  new Sortable(insightsList, {
    animation: 150,
    handle: '.drag-handle',
    onEnd: async (evt) => {
      const newOrder = Array.from(evt.to.children).map(el => el.dataset.id);
      await reorderInsights(activeNotebookId, newOrder);
    }
  });
}
</script>
```

---

## API Integration

### Load Notebooks

```javascript
async loadNotebooks() {
  try {
    const token = localStorage.getItem('authToken');
    const response = await fetch(`${window.API_BASE_URL}/research/notebooks`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Failed to load notebooks');
    
    const data = await response.json();
    this.notebooks = data.data || [];
  } catch (error) {
    console.error('Failed to load notebooks:', error);
    this.showError('Failed to load notebooks');
  }
}
```

### Create Notebook

```javascript
async createNotebook(title, description) {
  try {
    const token = localStorage.getItem('authToken');
    const response = await fetch(`${window.API_BASE_URL}/research/notebooks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title, description })
    });
    
    if (!response.ok) throw new Error('Failed to create notebook');
    
    const data = await response.json();
    this.notebooks.unshift(data.data);
    return data.data.id;
  } catch (error) {
    console.error('Failed to create notebook:', error);
    this.showError('Failed to create notebook');
  }
}
```

### Save Insight

```javascript
async saveInsightToNotebook() {
  try {
    let notebookId = this.selectedNotebookId;
    
    // Create new notebook if needed
    if (notebookId === 'new') {
      notebookId = await this.createNotebook(this.newNotebookTitle, '');
    }
    
    const token = localStorage.getItem('authToken');
    const tags = this.insightTags.split(',').map(t => t.trim()).filter(t => t);
    
    const response = await fetch(`${window.API_BASE_URL}/research/notebooks/${notebookId}/insights`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messageId: this.selectedMessageForSave.id,
        content: this.selectedMessageForSave.content,
        userNotes: this.insightNotes,
        tags: tags,
      })
    });
    
    if (!response.ok) throw new Error('Failed to save insight');
    
    this.showSaveModal = false;
    this.showSuccess('Insight saved to notebook!');
    await this.loadNotebooks();
  } catch (error) {
    console.error('Failed to save insight:', error);
    this.showError('Failed to save insight');
  }
}
```

### Export Notebook

```javascript
async exportNotebook(notebookId, format = 'markdown') {
  try {
    const token = localStorage.getItem('authToken');
    const response = await fetch(
      `${window.API_BASE_URL}/research/notebooks/${notebookId}/export?format=${format}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );
    
    if (!response.ok) throw new Error('Failed to export notebook');
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notebook-${notebookId}.${format === 'markdown' ? 'md' : format}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error) {
    console.error('Failed to export notebook:', error);
    this.showError('Failed to export notebook');
  }
}
```

---

## Styling

### Notebook Sidebar

```css
.notebook-item {
  padding: 12px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
  margin-bottom: 8px;
}

.notebook-item:hover {
  background: #f3f4f6;
  border-color: #e5e7eb;
}

.notebook-item.active {
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
  border-color: #93c5fd;
}

.insight-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  cursor: move;
}

.drag-handle {
  color: #9ca3af;
  cursor: grab;
  font-size: 18px;
  margin-right: 8px;
}

.drag-handle:active {
  cursor: grabbing;
}

.tag {
  display: inline-block;
  background: #eff6ff;
  color: #1e40af;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.75rem;
  margin-right: 4px;
}
```

---

## Testing Plan

### Manual Testing

1. **Create Notebook**
   - Click "New Notebook"
   - Enter title and description
   - Verify notebook appears in list

2. **Save Insight**
   - Send message in chat
   - Click "Save to Notebook" on assistant response
   - Select notebook
   - Add notes and tags
   - Click "Save"
   - Verify insight appears in notebook

3. **View Insights**
   - Click on notebook
   - Verify insights are displayed
   - Check notes and tags

4. **Reorder Insights**
   - Drag insight to new position
   - Verify order is saved

5. **Export Notebook**
   - Click "Export"
   - Select format (Markdown)
   - Verify file downloads
   - Open file and check content

### Automated Testing (Playwright)

Add to `test/e2e/research-assistant-notebooks.spec.ts`:

```typescript
describe('Notebooks', () => {
  it('should create notebook', async ({ page }) => { ... });
  it('should save insight to notebook', async ({ page }) => { ... });
  it('should display insights in notebook', async ({ page }) => { ... });
  it('should reorder insights', async ({ page }) => { ... });
  it('should export notebook', async ({ page }) => { ... });
});
```

---

## Timeline

**Day 1-2**: Implement UI components
**Day 3**: Add API integration
**Day 4**: Add drag-and-drop
**Day 5**: Testing and polish

---

**Status**: Ready to implement
**Next**: Build the enhanced Research Assistant UI with notebooks
