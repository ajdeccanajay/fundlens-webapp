# Research Workspace - Sidebar Navigation Redesign

**Date**: January 26, 2026  
**Status**: In Progress  
**Priority**: High

---

## Overview

Complete redesign of comprehensive-financial-analysis.html into a professional research workspace with left sidebar navigation. This is the main playground for research analysts.

---

## Design Principles

### 1. Professional & Intuitive
- Clean, modern interface inspired by VS Code, Slack, Linear
- Left sidebar for primary navigation
- Full-page content areas (no modals)
- Keyboard shortcuts for power users
- Responsive design

### 2. Research-First
- Optimized for financial analysts
- Quick access to all tools
- Seamless context switching
- Data persistence across views

### 3. Performance
- Fast page transitions
- Lazy loading of content
- Efficient state management
- Minimal re-renders

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│  [Logo] Research Workspace            [User] [Settings] │
├──────┬──────────────────────────────────────────────────┤
│      │                                                   │
│  📊  │                                                   │
│ Fin  │                                                   │
│      │          MAIN CONTENT AREA                        │
│  🧠  │          (Full Page View)                         │
│ Chat │                                                   │
│      │                                                   │
│  📑  │                                                   │
│ Pad  │                                                   │
│      │                                                   │
│  📄  │                                                   │
│ Memo │                                                   │
│      │                                                   │
└──────┴──────────────────────────────────────────────────┘
```

---

## Navigation Items

### 1. Financial Analysis (Default)
- **Icon**: 📊 Chart Line
- **Route**: `#financial`
- **Content**: Quantitative + Qualitative + Export tabs
- **Keyboard**: `Cmd/Ctrl + 1`

### 2. Research Assistant
- **Icon**: 🧠 Brain
- **Route**: `#research`
- **Content**: Full-page chat interface
- **Keyboard**: `Cmd/Ctrl + 2`

### 3. Scratchpad
- **Icon**: 📑 Bookmark
- **Route**: `#scratchpad`
- **Content**: Full-page saved items list
- **Keyboard**: `Cmd/Ctrl + 3`
- **Badge**: Item count

### 4. IC Memo
- **Icon**: 📄 File Export
- **Route**: `#ic-memo`
- **Content**: Full-page memo generator
- **Keyboard**: `Cmd/Ctrl + 4`

---

## Technical Architecture

### State Management
```javascript
{
  // Global state
  currentView: 'financial' | 'research' | 'scratchpad' | 'ic-memo',
  ticker: 'AAPL',
  
  // Financial view state
  financialData: {...},
  activeFinancialTab: 'quantitative',
  
  // Research view state
  researchConversationId: null,
  researchMessages: [],
  
  // Scratchpad view state
  scratchpadItems: [],
  activeScratchpadId: null,
  
  // IC Memo view state
  icMemoContent: '',
  icMemoGenerated: false
}
```

### Routing
- Hash-based routing (`#financial`, `#research`, etc.)
- Browser back/forward support
- Deep linking support
- State preservation on navigation

### Performance Optimizations
- Lazy load content for inactive views
- Virtual scrolling for large lists
- Debounced search/filter
- Cached API responses

---

## Implementation Plan

### Phase 1: Core Structure ✅
- [x] Create new HTML structure
- [x] Implement sidebar navigation
- [x] Set up routing system
- [x] Add view switching logic

### Phase 2: Financial View
- [ ] Port existing financial analysis
- [ ] Maintain all existing functionality
- [ ] Update styling for new layout

### Phase 3: Research View
- [ ] Full-page chat interface
- [ ] Conversation management
- [ ] Message streaming
- [ ] Save to scratchpad

### Phase 4: Scratchpad View
- [ ] Full-page item list
- [ ] Search and filter
- [ ] Export functionality
- [ ] Item management

### Phase 5: IC Memo View
- [ ] Full-page memo generator
- [ ] Preview and edit
- [ ] Download functionality

### Phase 6: Testing
- [ ] Unit tests (15-20 tests)
- [ ] E2E tests (10-15 tests)
- [ ] Accessibility testing
- [ ] Performance testing

---

## File Structure

```
public/
  research-workspace.html (NEW - main file)
  
test/
  e2e/
    research-workspace.spec.ts (NEW)
    research-workspace-navigation.spec.ts (NEW)
  unit/
    research-workspace-state.spec.ts (NEW)
    research-workspace-routing.spec.ts (NEW)

.kiro/specs/tenant-research-assistant/
  SIDEBAR_REDESIGN_SPEC.md (this file)
  SIDEBAR_IMPLEMENTATION_COMPLETE.md (after completion)
```

---

## Next Steps

1. Create base HTML structure with sidebar
2. Implement routing system
3. Port financial analysis view
4. Implement research assistant view
5. Implement scratchpad view
6. Implement IC memo view
7. Create comprehensive tests
8. Update documentation

---

**Status**: Ready to implement
