# Workspace Chat & Scratch Pad Upgrade - Design

## Architecture

### Component Structure
```
workspace.html
├── Header (Navy with logo and actions)
├── Sidebar (Navigation)
├── Main Content Area
│   ├── Analysis View (existing)
│   ├── Research View (UPGRADED)
│   │   ├── Chat Messages Container
│   │   │   ├── User Message Bubbles
│   │   │   ├── Assistant Message Bubbles
│   │   │   ├── Message Actions
│   │   │   └── Rich Content (Tables, Citations)
│   │   └── Input Area
│   ├── Scratchpad View (UPGRADED)
│   │   └── Slide-Out Panel
│   │       ├── Header with Search
│   │       ├── Filter Tabs
│   │       ├── Items List
│   │       └── Export Footer
│   └── IC Memo View (existing)
└── Modals
    ├── Citation Preview Modal
    └── Settings Modal
```

### State Management
```javascript
{
  // Chat state
  researchMessages: [],
  researchInput: '',
  researchTyping: false,
  conversationId: null,
  
  // Scratch pad state
  scratchpadOpen: false,
  scratchpadItems: [],
  scratchpadSearch: '',
  scratchpadFilter: 'all',
  
  // Citation state
  showCitationPreview: false,
  activeCitation: null,
  
  // Upload state
  uploadedDocuments: [],
  uploadProgress: 0
}
```

## Visual Design

### Color Palette
```css
/* Primary */
--color-navy-900: #0B1829;
--color-teal-500: #1E5A7A;

/* Backgrounds */
--bg-primary: #FFFFFF;
--bg-secondary: #F8FAFC;
--bg-navy: #0B1829;

/* Text */
--text-primary: #0B1829;
--text-secondary: #475569;
--text-inverse: #FFFFFF;
```

### Typography Scale
```css
--text-xs: 0.75rem;   /* 12px - badges, meta */
--text-sm: 0.875rem;  /* 14px - body, buttons */
--text-base: 1rem;    /* 16px - messages */
--text-lg: 1.125rem;  /* 18px - headings */
--text-xl: 1.25rem;   /* 20px - titles */
```

### Spacing System
```css
--spacing-2: 0.5rem;   /* 8px */
--spacing-3: 0.75rem;  /* 12px */
--spacing-4: 1rem;     /* 16px */
--spacing-6: 1.5rem;   /* 24px */
--spacing-8: 2rem;     /* 32px */
```

## Component Designs

### User Message Bubble
```css
.message--user {
  background: linear-gradient(135deg, #0B1829 0%, #1E5A7A 100%);
  color: white;
  border-radius: 18px;
  border-bottom-right-radius: 4px;
  padding: 12px 18px;
  max-width: 70%;
  margin-left: auto;
}
```

### Assistant Message Bubble
```css
.message--assistant {
  background: white;
  border: 1px solid #E2E8F0;
  border-radius: 18px;
  padding: 16px 20px;
  max-width: 85%;
}
```

### Message Actions
```css
.message__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #E2E8F0;
  opacity: 0;
  transition: opacity 150ms ease;
}

.message:hover .message__actions {
  opacity: 1;
}

.action-btn--primary {
  background: rgba(30, 90, 122, 0.1);
  border-color: #1E5A7A;
  color: #1E5A7A;
}

.action-btn--primary:hover {
  background: #1E5A7A;
  color: white;
}
```

### Financial Table
```css
.table-container {
  margin: 16px 0;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  overflow: hidden;
}

.table-header {
  background: #0B1829;
  color: white;
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
}

.financial-table {
  width: 100%;
  font-variant-numeric: tabular-nums;
}

.financial-table thead {
  background: #F1F5F9;
  position: sticky;
  top: 0;
}

.financial-table tbody tr:hover {
  background: rgba(30, 90, 122, 0.05);
}
```

### Citation Link
```css
.citation {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  margin: 0 2px;
  font-size: 11px;
  font-weight: 600;
  color: #1E5A7A;
  background: rgba(30, 90, 122, 0.1);
  border-radius: 4px;
  cursor: pointer;
  vertical-align: super;
  transition: all 150ms ease;
}

.citation:hover {
  background: #1E5A7A;
  color: white;
}
```

### Scratch Pad Panel
```css
.scratch-pad {
  position: fixed;
  top: 0;
  right: 0;
  width: 420px;
  height: 100vh;
  background: white;
  border-left: 1px solid #E2E8F0;
  box-shadow: 0 25px 50px -12px rgba(11, 24, 41, 0.25);
  transform: translateX(100%);
  transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 50;
}

.scratch-pad--open {
  transform: translateX(0);
}

.scratch-pad__header {
  background: #0B1829;
  color: white;
  padding: 16px 20px;
}
```

### Saved Item Card
```css
.saved-item {
  background: white;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  margin-bottom: 12px;
  overflow: hidden;
  transition: all 200ms ease;
}

.saved-item:hover {
  border-color: #1E5A7A;
  box-shadow: 0 4px 6px -1px rgba(11, 24, 41, 0.1);
}

.saved-item__header {
  background: #F8FAFC;
  padding: 12px;
  border-bottom: 1px solid #E2E8F0;
}

.saved-item__body {
  padding: 12px;
}

.saved-item__preview {
  font-size: 14px;
  color: #475569;
  line-height: 1.625;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

## Animations

### Save to Scratch Pad
```css
@keyframes flyToScratchPad {
  0% {
    opacity: 1;
    transform: translate(0, 0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(calc(100vw - 200px), -50vh) scale(0.2);
  }
}

.save-animation {
  animation: flyToScratchPad 400ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
```

### Streaming Cursor
```css
.message--streaming::after {
  content: '|';
  animation: blink 1s infinite;
  color: #1E5A7A;
  font-weight: bold;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
```

### Panel Slide
```css
.scratch-pad {
  transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

## Responsive Breakpoints

### Desktop (>= 1200px)
- Full layout with sidebar and scratch pad
- 420px scratch pad width
- 85% max width for assistant messages

### Tablet (768px - 1199px)
- Collapsible sidebar
- 360px scratch pad width
- Full-width scratch pad on mobile

### Mobile (< 768px)
- Hidden sidebar (hamburger menu)
- Full-width scratch pad overlay
- 90% max width for messages
- Simplified table rendering

## Accessibility Features

### Keyboard Navigation
- Tab through all interactive elements
- Enter/Space to activate buttons
- Escape to close modals/panels
- Arrow keys for message navigation

### Screen Reader Support
- ARIA labels for all buttons
- ARIA-live regions for dynamic content
- Role attributes for semantic structure
- Alt text for all images/icons

### Focus Management
- Visible focus indicators
- Focus trap in modals
- Return focus after modal close
- Skip links for main content

## Performance Optimizations

### Lazy Loading
- Load scratch pad items on demand
- Virtual scrolling for long lists
- Intersection Observer for images

### Debouncing
- Search input (300ms)
- Resize handlers (150ms)
- Scroll handlers (100ms)

### Code Splitting
- Separate bundle for rich content renderers
- Lazy load citation preview modal
- Dynamic import for export functionality

### Animation Performance
- Use transform and opacity only
- will-change for animated elements
- GPU acceleration with translate3d
- Reduce motion for accessibility
