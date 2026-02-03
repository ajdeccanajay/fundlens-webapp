# FundLens Deals Workspace - Design System

**Date**: January 26, 2026  
**Status**: Design Phase  
**Approach**: Design-Led Development

---

## Vision

Create a world-class research workspace for financial analysts that rivals Bloomberg Terminal, FactSet, and Pitchbook in user experience. This is not just a feature - it's THE platform where analysts spend their day.

---

## User Journey

### 1. Deal List (Entry Point)
**URL**: `/app/deals/`

**Purpose**: Overview of all deals in pipeline

**Layout**:
```
┌─────────────────────────────────────────────────────────────┐
│  FundLens                                    [+ New Deal]    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  My Deals                                                    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  AAPL - Apple Inc.                    $2.8T  Active   │  │
│  │  Technology • Consumer Electronics                     │  │
│  │  Last updated: 2 hours ago                            │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  MSFT - Microsoft Corp.              $2.5T  Active   │  │
│  │  Technology • Cloud Services                          │  │
│  │  Last updated: 1 day ago                              │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key Features**:
- Clean card-based layout
- Quick filters (Active, Archived, By Sector)
- Search functionality
- Sort by date, value, status
- One-click to create new deal
- One-click to open deal workspace

---

### 2. Deal Workspace (Main Experience)
**URL**: `/app/deals/workspace.html?dealId=xxx`

**Purpose**: Complete research environment for a single deal

**Layout**: Left sidebar navigation with full-page content areas

```
┌──────┬──────────────────────────────────────────────────────┐
│      │  AAPL - Apple Inc.                    [Export] [⚙️]  │
│      ├──────────────────────────────────────────────────────┤
│  📊  │                                                       │
│ Anal │                                                       │
│ ysis │                                                       │
│      │                                                       │
│  🧠  │          MAIN CONTENT AREA                            │
│ Chat │          (Changes based on nav selection)             │
│      │                                                       │
│  📑  │                                                       │
│ Pad  │                                                       │
│  3   │                                                       │
│      │                                                       │
│  📄  │                                                       │
│ Memo │                                                       │
│      │                                                       │
└──────┴──────────────────────────────────────────────────────┘
```

---

## Navigation Structure

### Sidebar (64px collapsed, 240px expanded)

#### 1. Analysis (Default View)
**Icon**: 📊 Chart Bar  
**Label**: "Analysis"  
**Shortcut**: `Cmd/Ctrl + 1`

**Content Tabs**:
- Quantitative Metrics
- Qualitative Analysis  
- Export to Excel

**Purpose**: Core financial analysis - metrics, ratios, trends

---

#### 2. Research Chat
**Icon**: 🧠 Brain  
**Label**: "Research"  
**Shortcut**: `Cmd/Ctrl + 2`

**Features**:
- AI-powered research assistant
- Cross-company queries
- Streaming responses
- Source citations
- Save to scratchpad

**Purpose**: Ask questions, get insights, explore data

---

#### 3. Scratchpad
**Icon**: 📑 Bookmark  
**Label**: "Scratchpad"  
**Badge**: Item count (e.g., "3")  
**Shortcut**: `Cmd/Ctrl + 3`

**Features**:
- Saved research items
- Personal notes
- Search and filter
- Export to Markdown
- Organize by tags

**Purpose**: Collect and organize research findings

---

#### 4. IC Memo
**Icon**: 📄 File Text  
**Label**: "IC Memo"  
**Shortcut**: `Cmd/Ctrl + 4`

**Features**:
- Generate investment memo
- Edit and preview
- Export to PDF/Word
- Share with team

**Purpose**: Create final investment recommendation

---

## Design Principles

### 1. Clarity
- Clear visual hierarchy
- Obvious next actions
- No ambiguity in navigation
- Consistent patterns

### 2. Speed
- Fast page transitions (<100ms)
- Instant feedback
- Keyboard shortcuts
- Minimal clicks to action

### 3. Focus
- One primary action per view
- Minimal distractions
- Clean, spacious layout
- Progressive disclosure

### 4. Delight
- Smooth animations
- Thoughtful micro-interactions
- Beautiful typography
- Professional color palette

---

## Color System

### Primary Colors
```
Indigo:   #6366f1  (Primary actions, active states)
Purple:   #8b5cf6  (Secondary actions, accents)
Gray:     #6b7280  (Text, borders, backgrounds)
```

### Semantic Colors
```
Success:  #10b981  (Positive metrics, confirmations)
Warning:  #f59e0b  (Alerts, important info)
Error:    #ef4444  (Errors, destructive actions)
Info:     #3b82f6  (Information, tips)
```

### Backgrounds
```
Primary:  #ffffff  (Main content)
Secondary:#f9fafb  (Sidebar, cards)
Tertiary: #f3f4f6  (Hover states, disabled)
```

---

## Typography

### Font Family
```
Primary:   Inter, system-ui, sans-serif
Monospace: 'Monaco', 'Courier New', monospace
```

### Scale
```
Display:   2.5rem / 40px  (Page titles)
Heading 1: 2rem / 32px    (Section titles)
Heading 2: 1.5rem / 24px  (Subsections)
Heading 3: 1.25rem / 20px (Card titles)
Body:      1rem / 16px    (Main text)
Small:     0.875rem / 14px (Labels, captions)
Tiny:      0.75rem / 12px  (Badges, timestamps)
```

---

## Spacing System

```
xs:  4px   (Tight spacing)
sm:  8px   (Small gaps)
md:  16px  (Default spacing)
lg:  24px  (Section spacing)
xl:  32px  (Large gaps)
2xl: 48px  (Major sections)
```

---

## Component Library

### 1. Sidebar Navigation Item
```
State: Default
- Background: transparent
- Text: gray-600
- Icon: gray-400

State: Hover
- Background: gray-50
- Text: gray-900
- Icon: gray-600

State: Active
- Background: indigo-50
- Text: indigo-600
- Icon: indigo-600
- Border-left: 3px solid indigo-600
```

### 2. Content Card
```
- Background: white
- Border: 1px solid gray-200
- Border-radius: 12px
- Padding: 24px
- Shadow: 0 1px 3px rgba(0,0,0,0.1)

Hover:
- Shadow: 0 4px 6px rgba(0,0,0,0.1)
- Transform: translateY(-2px)
```

### 3. Button Hierarchy

**Primary**:
```
- Background: indigo-600
- Text: white
- Hover: indigo-700
- Active: indigo-800
```

**Secondary**:
```
- Background: white
- Border: 1px solid gray-300
- Text: gray-700
- Hover: gray-50
```

**Ghost**:
```
- Background: transparent
- Text: gray-600
- Hover: gray-100
```

---

## Interaction Patterns

### Page Transitions
```
Duration: 200ms
Easing: cubic-bezier(0.4, 0, 0.2, 1)
Effect: Fade + slight slide
```

### Loading States
```
Skeleton screens for initial load
Spinners for actions
Progress bars for long operations
```

### Empty States
```
Friendly illustration
Clear message
Primary action button
```

### Error States
```
Clear error message
Suggested action
Retry button
```

---

## Responsive Breakpoints

```
Mobile:  < 768px   (Stack vertically, hide sidebar)
Tablet:  768-1024px (Collapsible sidebar)
Desktop: > 1024px   (Full experience)
```

---

## Accessibility

### Keyboard Navigation
- Tab through all interactive elements
- Enter/Space to activate
- Escape to close modals
- Arrow keys for lists

### Screen Readers
- Semantic HTML
- ARIA labels
- Alt text for images
- Focus indicators

### Color Contrast
- WCAG AA minimum (4.5:1)
- WCAG AAA preferred (7:1)

---

## Performance Targets

```
First Contentful Paint:  < 1.5s
Time to Interactive:     < 3.0s
Largest Contentful Paint: < 2.5s
Cumulative Layout Shift:  < 0.1
```

---

## Implementation Priority

### Phase 1: Foundation (Week 1)
1. Deal list page
2. Basic workspace structure
3. Sidebar navigation
4. Routing system

### Phase 2: Analysis View (Week 1-2)
1. Quantitative metrics
2. Qualitative analysis
3. Export functionality

### Phase 3: Research Tools (Week 2-3)
1. Research chat
2. Scratchpad
3. IC Memo generator

### Phase 4: Polish (Week 3-4)
1. Animations
2. Error handling
3. Loading states
4. Empty states

### Phase 5: Testing (Week 4)
1. Unit tests
2. E2E tests
3. Accessibility audit
4. Performance optimization

---

## Success Metrics

### User Experience
- Task completion rate > 95%
- Time to complete analysis < 10 min
- User satisfaction score > 4.5/5

### Technical
- Page load time < 2s
- Zero critical bugs
- 100% test coverage on core flows

### Business
- Daily active users
- Time spent in workspace
- Memos generated per week

---

**Next Step**: Create detailed wireframes and prototypes for each view
