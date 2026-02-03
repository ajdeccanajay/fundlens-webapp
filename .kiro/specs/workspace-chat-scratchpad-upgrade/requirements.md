# Workspace Chat & Scratch Pad Upgrade - Requirements

## Overview
Comprehensive upgrade of the Deal Workspace chat interface and scratch pad to match the FundLens design system with navy/teal colors, enhanced message styling, slide-out scratch pad panel, and rich content rendering.

## Design System Integration
- **Colors**: Navy (#0B1829) primary, Teal (#1E5A7A) accents
- **Typography**: Inter font family throughout
- **Spacing**: Design system tokens (var(--spacing-*))
- **Shadows**: Navy-based shadows (var(--shadow-*))
- **Transitions**: Smooth 200ms cubic-bezier animations

## Phase 1: Design System Application
### Requirements
- Replace all purple/indigo colors with navy/teal
- Apply Inter font family consistently
- Use design system CSS variables for all styling
- Update message bubbles with navy gradient
- Apply design system border radius and shadows

## Phase 2: Enhanced Chat Interface
### Message Styling
- User messages: Navy gradient background, white text, rounded corners
- Assistant messages: White background, navy text, subtle border
- Streaming cursor animation with teal color
- Message actions (copy, save, regenerate) on hover

### Message Actions
- Copy button with clipboard icon
- Save to Scratch Pad button (primary action, teal)
- Regenerate button for assistant messages
- Smooth fade-in animation on hover

### Input Area
- Auto-resizing textarea (24px min, 200px max)
- Focus state with teal border and shadow
- Send button with navy background
- Loading state with spinning icon

## Phase 3: Scratch Pad Slide-Out Panel
### Panel Design
- Fixed position, right side, 420px width
- Slide animation (300ms cubic-bezier)
- Navy header with white text
- Search and filter toolbar
- Scrollable items list

### Saved Item Cards
- White background with subtle border
- Hover state with teal border
- Preview text (3 lines max)
- Source badges (ticker, filing type)
- Action buttons (view, edit, delete)

### Features
- Search functionality
- Filter by type/source
- Collections/tags
- Export to PDF/Word
- Batch operations

## Phase 4: Rich Content Rendering
### Financial Tables
- Navy header background
- Sticky header on scroll
- Tabular nums font variant
- Hover row highlighting
- Export table button

### Citations
- Inline citation numbers (superscript)
- Teal color with hover effect
- Popover on click with document preview
- Filing badge (10-K, 10-Q, 8-K)
- Link to full document

### Code Blocks
- JetBrains Mono font
- Syntax highlighting
- Copy button
- Line numbers (optional)

## Testing Requirements
### Unit Tests
- Message rendering with citations
- Scratch pad CRUD operations
- Table rendering and formatting
- Citation popover functionality
- File upload and processing

### E2E Tests
- Complete chat flow with file upload
- Save to scratch pad animation
- Export scratch pad items
- Citation preview and navigation
- Keyboard shortcuts

## Accessibility
- ARIA labels for all interactive elements
- Keyboard navigation support
- Focus management
- Screen reader announcements
- Color contrast compliance (WCAG AA)

## Performance
- Lazy load scratch pad items
- Virtual scrolling for long message lists
- Debounced search input
- Optimized animations (GPU-accelerated)
- Code splitting for heavy components
