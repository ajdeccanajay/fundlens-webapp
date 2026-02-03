# Design Document: Research Scratchpad Redesign

## Overview

The Research Scratchpad redesign transforms a basic text-based display into a sophisticated, analyst-optimized interface for managing saved research items. The scratchpad acts as a **reservoir of important findings** that equity analysts save from the Research Assistant chatbot. These saved items accumulate over time and serve as a curated collection of insights that will feed into IC Memo generation.

**Key Concept**: The scratchpad is NOT an intelligent analysis tool itself—it's a **collection interface** for items the analyst has explicitly saved from chat interactions. Each saved item might be:
- A direct answer to a research question
- A revenue recognition breakdown
- A multi-year trend analysis
- Source citations from SEC filings
- An AI-generated provocation question

The redesign is built on three core principles:
1. **Scannability**: Visual hierarchy and card-based layout enable rapid review of saved items
2. **Interactivity**: Micro-interactions (copy-on-hover, smooth transitions) reduce friction when extracting data
3. **Progressive Disclosure**: Collapsible sections allow analysts to focus on relevant saved items

The component integrates with existing FundLens infrastructure:
- **Analyst Workspace**: Part of `/app/deals/workspace.html` (not standalone)
- Existing scratchpad service (`src/deals/scratch-pad.service.ts`)
- Research assistant integration (save from chat to scratchpad)
- FundLens design system (`public/css/design-system.css`)
- Previous scratchpad upgrade patterns (`.kiro/specs/workspace-chat-scratchpad-upgrade/`)

## Architecture

### Component Structure

```
AnalystWorkspace (/app/deals/workspace.html)
├── LeftNavigation
│   ├── Overview Tab
│   ├── Financials Tab
│   ├── Research Tab (Chat Interface)
│   ├── Scratchpad Tab ← NEW/REDESIGNED
│   └── Reports Tab
└── MainContent (Tab-based)
    └── [When Scratchpad Tab Active]
        └── ResearchScratchpad (Container)
            ├── StickyHeader
            │   ├── Title ("Research Scratchpad")
            │   ├── ItemCount ("12 saved items")
            │   └── ActionButtons
            │       ├── ExportToMarkdown
            │       ├── CopyAll
            │       └── AddToReport
            ├── SavedItemsList (Scrollable)
            │   ├── SavedItem #1 (Card)
            │   │   ├── ItemHeader
            │   │   │   ├── ItemType Badge ("Direct Answer" | "Trend Analysis" | "Framework" | "Provocation")
            │   │   │   ├── Timestamp ("Saved 2 hours ago")
            │   │   │   └── DeleteButton
            │   │   ├── ItemContent (varies by type)
            │   │   │   ├── [If Direct Answer]: AnswerText + Badges
            │   │   │   ├── [If Revenue Framework]: TwoColumnLayout
            │   │   │   ├── [If Trend Analysis]: ChartVisualization
            │   │   │   └── [If Provocation]: AnalyticalQuestion
            │   │   └── ItemFooter
            │   │       ├── SourceChips (if applicable)
            │   │       └── CopyButton
            │   ├── SavedItem #2 (Card)
            │   │   └── [Same structure]
            │   └── SavedItem #N (Card)
            │       └── [Same structure]
            └── EmptyState (when no items)
                ├── Icon
                ├── "No saved items yet"
                └── "Save insights from the Research tab to build your analysis"
```

### State Management

The scratchpad maintains the following state:
- **Saved Items List**: Array of saved research items with metadata (type, timestamp, content)
- **Item Collapse State**: Boolean map of item IDs to expanded/collapsed state
- **Hover State**: Currently hovered data point for copy icon display
- **Copy Confirmation**: Temporary state for showing copy success feedback
- **Selection State**: Selected items for bulk operations (delete, export)

State persistence:
- Saved items stored in backend database (linked to workspace/deal)
- Item collapse states stored in `localStorage` with key `fundlens_scratchpad_collapse_{workspaceId}`
- State synced across browser tabs using BroadcastChannel API

### Data Flow

```
Research Tab (Chat Interface in workspace.html)
    ↓ (User clicks "Save to Scratchpad" on chat message)
Backend API (/api/research/scratchpad/save)
    ↓ (Stores item with metadata)
Database (scratchpad_items table)
    ↓ (Fetch on Scratchpad tab activation)
Backend Service (scratch-pad.service.ts)
    ↓
Scratchpad Tab (in workspace.html)
    ↓
Frontend Component (research-scratchpad.js)
    ↓
Render Pipeline:
    1. Group items by type or chronologically
    2. Apply visual transformations per item type
    3. Attach event listeners (collapse, copy, delete)
    4. Restore collapse state from localStorage
    
Export Flow:
    Scratchpad Items → Format as Markdown/Text → IC Memo Generation (Reports Tab)
```

## Components and Interfaces

### 1. StickyHeader Component

**Purpose**: Provides persistent access to scratchpad title, item count, and action buttons

**Interface**:
```typescript
interface StickyHeaderProps {
  title: string;
  itemCount: number;
  onExportMarkdown: () => void;
  onCopyAll: () => void;
  onAddToReport: () => void;
}
```

**Styling**:
- Position: `sticky`, top: 0, z-index: 100
- Background: white with subtle bottom border
- Height: 64px
- Padding: 16px 24px
- Box shadow on scroll: `0 2px 4px rgba(0,0,0,0.1)`
- Item count: Gray text, 14px, positioned next to title

**Behavior**:
- Buttons use FundLens design system button styles
- Primary action ("Add to Report") uses teal accent
- Secondary actions use outline style
- Item count updates dynamically as items are added/removed

### 2. SavedItem Component

**Purpose**: Displays a single saved research item with type-specific rendering

**Interface**:
```typescript
interface SavedItemProps {
  item: ScratchpadItem;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onCopy: () => void;
}

interface ScratchpadItem {
  id: string;
  type: 'direct_answer' | 'revenue_framework' | 'trend_analysis' | 'provocation';
  content: any; // Type-specific content
  sources?: SourceCitation[];
  savedAt: string; // ISO timestamp
  workspaceId: string;
}
```

**Styling**:
- Card: Border-radius 8px, padding 20px, box-shadow `0 2px 6px rgba(0,0,0,0.06)`
- Margin: 16px between cards
- Header: Flex layout, space-between
- Type badge: Pill style, color-coded by type
  - Direct Answer: Teal background
  - Revenue Framework: Blue background
  - Trend Analysis: Purple background
  - Provocation: Orange background
- Timestamp: Gray text, 12px, "Saved X hours/days ago"
- Delete button: Icon only, appears on hover, red on hover

**Behavior**:
- Click anywhere on card to expand/collapse (except delete button)
- Collapsed state shows truncated preview (first 100 chars)
- Expanded state shows full content with type-specific rendering
- Delete requires confirmation modal
- Copy button copies item content to clipboard

### 3. DirectAnswerItem Component

**Purpose**: Renders a saved direct answer with prominence

**Interface**:
```typescript
interface DirectAnswerItemProps {
  answerText: string;
  confidenceScore?: number | string;
  sourceCount?: number;
}
```

**Styling**:
- Background: `rgba(13, 148, 136, 0.05)` (very light teal tint)
- Border-left: 3px solid `#0d9488` (teal accent)
- Font-size: 16px (answer text)
- Font-weight: 500
- Badges: Inline, positioned below answer text

**Badge Styling**:
- Confidence: Pill badge with percentage or "High/Medium/Low"
- Source count: Pill badge with "Sources: N SEC filings"
- Badge colors: Navy background (#1a2744), white text, 12px

### 4. RevenueFrameworkItem Component

**Purpose**: Renders saved revenue recognition framework in two-column layout

**Interface**:
```typescript
interface RevenueFrameworkItemProps {
  pointInTime: ProductCategory[];
  overTime: ProductCategory[];
}

interface ProductCategory {
  name: string;
  icon: string;
  description?: string;
}
```

**Styling**:
- Layout: CSS Grid with 2 columns (1fr 1fr)
- Gap: 20px between columns
- Column headers: Bold, 14px, navy color
- Product tags: Inline-flex, padding 6px 10px, border-radius 12px
- Point-in-time tags: Green background (#10b981), white text
- Over-time tags: Blue background (#3b82f6), white text
- Icons: 16px, positioned left of product name

**Responsive**:
- Below 768px: Stack columns vertically

### 5. TrendAnalysisItem Component

**Purpose**: Renders saved revenue trend visualization

**Interface**:
```typescript
interface TrendAnalysisItemProps {
  data: YearlyRevenue[];
  metric: string; // "Revenue", "Operating Income", etc.
}

interface YearlyRevenue {
  year: number;
  value: number;
  yoyChange: number;
}
```

**Styling**:
- Chart type: Horizontal bar chart or sparkline
- Bar color: Teal (#0d9488)
- Bar height: 28px
- Gap between bars: 10px
- YoY badges: Positioned right of bars
  - Positive: Green background (#10b981), white text, "↑ X%"
  - Negative: Red background (#ef4444), white text, "↓ X%"
- Hover state: Bar opacity 0.8, tooltip appears
- Metric label: Bold, 14px, above chart

**Tooltip**:
- Position: Above hovered bar
- Content: "FY {year}: ${value}B (YoY: {change}%)"
- Background: Navy (#1a2744), white text
- Border-radius: 4px, padding: 6px 10px

### 6. ProvocationItem Component

**Purpose**: Renders saved AI-generated analytical question

**Interface**:
```typescript
interface ProvocationItemProps {
  question: string;
}
```

**Styling**:
- Border: 2px dashed #cbd5e1 (gray)
- Background: #fafafa (very light gray)
- Border-radius: 8px
- Padding: 16px
- Icon: Lightbulb, 20px, teal color
- Question text: Italic, 15px, line-height 1.6
- Label: "Think Deeper" with icon

**Behavior**:
- Read-only (no interactive elements)
- Visually distinct from factual content

### 7. SourceChips Component

**Purpose**: Displays clickable source citations for an item

**Interface**:
```typescript
interface SourceChipsProps {
  sources: SourceCitation[];
}

interface SourceCitation {
  filingType: string;
  filingDate: string;
  url: string;
  ticker: string;
}
```

**Styling**:
- Chip layout: Inline-flex, flex-wrap
- Gap: 6px between chips
- Chip style: Border-radius 12px, padding 4px 10px
- Background: Light gray (#f3f4f6)
- Border: 1px solid #e5e7eb
- Hover: Background #e5e7eb, cursor pointer
- Text: 12px, navy color
- Format: "{ticker} {filingType} - {date}"

**Behavior**:
- Click opens filing URL in new tab
- Keyboard: Enter/Space to activate
- ARIA: `role="link"`, descriptive label

### 8. EmptyState Component

**Purpose**: Displays when scratchpad has no saved items

**Interface**:
```typescript
interface EmptyStateProps {
  onNavigateToChat?: () => void;
}
```

**Styling**:
- Centered layout, vertical flex
- Icon: Large (64px), gray color, document/clipboard icon
- Heading: "No saved items yet", 18px, bold
- Subtext: "Save insights from the Research tab to build your analysis", 14px, gray
- Optional CTA button: "Go to Research Tab"

**Behavior**:
- Only displays when items array is empty
- CTA button switches to Research tab in workspace

## Data Models

### ScratchpadItem

The primary data structure for a saved research item:

```typescript
interface ScratchpadItem {
  id: string; // UUID
  workspaceId: string; // Links to workspace/deal
  type: 'direct_answer' | 'revenue_framework' | 'trend_analysis' | 'provocation';
  content: DirectAnswer | RevenueFramework | TrendAnalysis | Provocation;
  sources?: SourceCitation[];
  savedAt: string; // ISO timestamp
  savedFrom: {
    chatMessageId?: string; // Reference to original chat message
    query?: string; // Original user question
  };
  metadata?: {
    ticker?: string;
    filingPeriod?: string;
    tags?: string[];
  };
}

interface DirectAnswer {
  text: string;
  confidence?: number | 'high' | 'medium' | 'low';
  sourceCount: number;
}

interface RevenueFramework {
  pointInTime: ProductCategory[];
  overTime: ProductCategory[];
}

interface ProductCategory {
  name: string;
  icon: 'phone' | 'laptop' | 'tablet' | 'services' | 'other';
  description?: string;
}

interface TrendAnalysis {
  metric: string; // "Revenue", "Operating Income", etc.
  data: YearlyData[];
}

interface YearlyData {
  year: number;
  value: number; // in millions
  yoyChange: number; // percentage
}

interface Provocation {
  question: string;
  context?: string; // What prompted this question
}

interface SourceCitation {
  filingType: '10-K' | '10-Q' | '8-K';
  filingDate: string; // ISO date
  url: string;
  ticker: string;
}
```

### ScratchpadState

Frontend state management:

```typescript
interface ScratchpadState {
  items: ScratchpadItem[];
  collapsedItems: Set<string>; // Item IDs that are collapsed
  selectedItems: Set<string>; // Item IDs selected for bulk operations
  isLoading: boolean;
  error?: string;
}
```

### LocalStorage Schema

```typescript
interface ScratchpadLocalState {
  collapsedItems: string[]; // Array of collapsed item IDs
  lastUpdated: string; // ISO timestamp
  workspaceId: string;
}

// Storage key: `fundlens_scratchpad_state_{workspaceId}`
```

### Backend API Schema

**GET /api/research/scratchpad/:workspaceId**
```typescript
Response: {
  items: ScratchpadItem[];
  totalCount: number;
}
```

**POST /api/research/scratchpad/save**
```typescript
Request: {
  workspaceId: string;
  type: string;
  content: any;
  sources?: SourceCitation[];
  savedFrom?: {
    chatMessageId?: string;
    query?: string;
  };
}

Response: {
  item: ScratchpadItem;
}
```

**DELETE /api/research/scratchpad/:itemId**
```typescript
Response: {
  success: boolean;
}
```

**POST /api/research/scratchpad/export**
```typescript
Request: {
  workspaceId: string;
  format: 'markdown' | 'text' | 'json';
  itemIds?: string[]; // Optional: specific items to export
}

Response: {
  content: string;
  filename: string;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property Reflection

After analyzing all acceptance criteria, I've identified the following consolidations to eliminate redundancy:

**Consolidation 1: Chevron Icon States (2.3, 2.4)**
- These two properties test the same behavior from opposite angles (collapsed vs expanded)
- Can be combined into one property: "Chevron icon direction matches section state"

**Consolidation 2: Color-Coded Tags (4.3) and YoY Badge Colors (5.2)**
- Both test color-based visual indicators matching data semantics
- Can be combined into: "Visual indicators use semantic colors matching data meaning"

**Consolidation 3: Hover Transitions (8.4, 9.2)**
- Both test hover animation timing
- Can be combined into: "All hover states use consistent 150ms transitions"

**Consolidation 4: Accessibility Properties (12.1, 12.3)**
- Both ensure interactive elements have proper accessibility features
- Can be combined into: "All interactive elements have focus indicators and ARIA labels"

**Consolidation 5: Section Collapse Toggle (2.1) and Keyboard Shortcuts (12.2)**
- Both test section toggle behavior, just with different input methods
- Can be combined into: "Section toggle works with both mouse and keyboard"

After reflection, we'll focus on high-value properties that provide unique validation:

### Correctness Properties

**Property 1: Section State Persistence Round-Trip**
*For any* set of section collapse states, saving to localStorage then reloading the page should restore the exact same collapse states for all sections.
**Validates: Requirements 2.5**

**Property 2: Section Toggle Consistency**
*For any* collapsible section, clicking or pressing Space/Enter should toggle between expanded and collapsed states, with chevron icon direction matching the current state (right for collapsed, down for expanded).
**Validates: Requirements 2.1, 2.3, 2.4, 12.2**

**Property 3: Confidence Badge Display**
*For any* direct answer with a confidence score (numeric or qualitative), the system should display a badge containing that confidence value.
**Validates: Requirements 3.3**

**Property 4: Source Count Badge Format**
*For any* direct answer with N sources, the system should display a badge with text "Sources: N SEC filings" where N matches the actual source count.
**Validates: Requirements 3.4**

**Property 5: Product Category Icon Presence**
*For any* product category in the revenue recognition framework, an icon should be displayed alongside the product name.
**Validates: Requirements 4.2**

**Property 6: Semantic Color Coding**
*For any* revenue recognition product, point-in-time products should have green tags and over-time products should have blue tags; for any YoY change, positive changes should have green badges and negative changes should have red badges.
**Validates: Requirements 4.3, 5.2**

**Property 7: Hover State Feedback**
*For any* hoverable element (product category, chart data point, numerical value), hovering should trigger a visual change (background color, tooltip, or icon appearance) within 150ms.
**Validates: Requirements 4.4, 5.3, 8.1, 9.2**

**Property 8: Currency Formatting Consistency**
*For any* revenue value, the system should format it with appropriate abbreviations (B for values ≥ 1,000M, M for values ≥ 1M) and proper decimal precision.
**Validates: Requirements 5.4**

**Property 9: Source Citation Completeness**
*For any* source citation, both the filing type (10-K, 10-Q, 8-K) and filing date should be displayed in the chip.
**Validates: Requirements 6.4**

**Property 10: Source Citation Click Behavior**
*For any* source citation chip, clicking should open the corresponding SEC filing URL in a new browser tab.
**Validates: Requirements 6.3**

**Property 11: Copy-to-Clipboard Formatting**
*For any* numerical value, clicking the copy icon should copy the value to clipboard with Excel-compatible formatting (no currency symbols, proper decimal separator).
**Validates: Requirements 8.2**

**Property 12: Copy Confirmation Feedback**
*For any* copy action, a confirmation message should appear and remain visible for 1-2 seconds.
**Validates: Requirements 8.3**

**Property 13: Numerical Value Copy Support**
*For any* numerical metric (revenue, percentage, growth rate), a copy icon should appear on hover and enable clipboard copying.
**Validates: Requirements 8.5**

**Property 14: Animation Timing Consistency**
*For any* collapsible section transition, the animation duration should be between 200-300ms with ease-in-out timing function.
**Validates: Requirements 9.1, 9.3**

**Property 15: Reduced Motion Compliance**
*For any* animated element, when prefers-reduced-motion is enabled, no animations should occur (transitions should be instant).
**Validates: Requirements 9.5**

**Property 16: Minimum Font Size Enforcement**
*For any* text element at any viewport width, the computed font size should be at least 14px.
**Validates: Requirements 11.4**

**Property 17: Accessibility - Focus Indicators and ARIA**
*For any* interactive element (button, link, collapsible header), it should have both a visible focus indicator and an appropriate ARIA label or role.
**Validates: Requirements 12.1, 12.3**

**Property 18: Accessibility - State Announcements**
*For any* section collapse/expand action, the state change should be announced to screen readers via ARIA live regions or aria-expanded attributes.
**Validates: Requirements 12.4**

**Property 19: Accessibility - Color Contrast**
*For any* text element, the color contrast ratio between text and background should be at least 4.5:1.
**Validates: Requirements 12.5**

## Error Handling

### Input Validation

**Missing or Invalid Data**:
- If `directAnswer` is missing: Display placeholder message "No direct answer available"
- If `directAnswer.text` is empty: Display "Analysis in progress..."
- If `confidence` is invalid: Hide confidence badge
- If `sourceCount` is 0 or negative: Display "Sources: 0 SEC filings"
- If `revenueRecognition` is missing: Hide entire section
- If `revenueTrends` is empty array: Display "No trend data available"
- If `sources` is empty: Display "No sources available" in collapsed panel
- If `provocation` is null/undefined: Hide provocation card entirely

**Malformed Data**:
- If revenue values are non-numeric: Display "N/A" and log error
- If dates are invalid: Display "Invalid date" and log error
- If URLs are malformed: Disable click behavior and show warning icon
- If icon identifiers are unknown: Use default "document" icon

### User Action Errors

**Copy to Clipboard Failures**:
- If clipboard API is unavailable: Show error toast "Copy not supported in this browser"
- If copy operation fails: Show error toast "Failed to copy. Please try again."
- Fallback: Provide "Select All" button for manual copying

**Export Failures**:
- If markdown generation fails: Show error modal with details
- If file download is blocked: Show instructions to allow downloads
- Provide retry button with exponential backoff

**localStorage Failures**:
- If localStorage is full: Clear old scratchpad states, keep only current
- If localStorage is disabled: Gracefully degrade (no state persistence)
- Log warning but don't block functionality

### Network Errors

**Data Loading Failures**:
- If scratchpad data fetch fails: Display error state with retry button
- Show last successful data if available (stale data indicator)
- Provide "Refresh" action to retry fetch

**Timeout Handling**:
- If data fetch exceeds 10s: Show loading state with "Taking longer than usual..." message
- Provide cancel button to abort request
- After 30s: Show timeout error with retry option

### Browser Compatibility

**Unsupported Features**:
- If CSS Grid is unsupported: Fallback to Flexbox layout
- If CSS transitions are unsupported: Instant state changes (no animation)
- If Intersection Observer is unsupported: Sticky header always visible
- Detect feature support on mount and apply appropriate fallbacks

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests**: Focus on specific examples, edge cases, and integration points
- Specific UI component rendering with known data
- Edge cases (empty data, missing fields, malformed input)
- Integration with existing services (scratch-pad.service.ts)
- Browser API interactions (localStorage, clipboard)

**Property-Based Tests**: Verify universal properties across all inputs
- Generate random scratchpad data and verify properties hold
- Test with various data sizes, formats, and combinations
- Verify behavior consistency across different states
- Minimum 100 iterations per property test

### Property-Based Testing Configuration

**Library**: Use `fast-check` for JavaScript/TypeScript property-based testing

**Test Configuration**:
- Minimum 100 iterations per property test
- Each test tagged with: `Feature: research-scratchpad-redesign, Property {N}: {property_text}`
- Generators for: ScratchpadData, DirectAnswer, RevenueTrend, SourceCitation
- Custom arbitraries for domain-specific data (filing types, confidence scores)

**Example Property Test Structure**:
```typescript
// Feature: research-scratchpad-redesign, Property 1: Section State Persistence Round-Trip
test('section collapse states persist across page reloads', () => {
  fc.assert(
    fc.property(
      fc.record({
        sections: fc.dictionary(fc.string(), fc.boolean())
      }),
      (collapseStates) => {
        // Save states to localStorage
        saveCollapseStates(collapseStates);
        
        // Simulate page reload
        const restored = loadCollapseStates();
        
        // Verify round-trip
        expect(restored).toEqual(collapseStates);
      }
    ),
    { numRuns: 100 }
  );
});
```

### Unit Test Coverage

**Component Tests** (using Jest + React Testing Library):
1. StickyHeader: Button presence, click handlers, sticky positioning
2. DirectAnswerCard: Rendering with/without badges, styling verification
3. CollapsibleSection: Toggle behavior, animation classes, ARIA attributes
4. RevenueRecognitionFramework: Two-column layout, icon rendering, color coding
5. RevenueTrendChart: SVG rendering, tooltip display, hover interactions
6. SourcesPanel: Chip rendering, click behavior, external link opening
7. ProvocationCard: Conditional rendering, distinct styling
8. CopyOnHover: Icon appearance, clipboard interaction, confirmation feedback

**Integration Tests**:
1. Full scratchpad rendering with complete data
2. localStorage integration (save/load states)
3. Export functionality (markdown generation, clipboard copy)
4. Responsive behavior (viewport size changes)
5. Accessibility (keyboard navigation, screen reader announcements)

**Edge Case Tests**:
1. Empty data scenarios (no direct answer, no trends, no sources)
2. Malformed data (invalid dates, non-numeric revenues, broken URLs)
3. Extreme values (very large numbers, very long text)
4. Browser compatibility (unsupported features, disabled APIs)
5. Performance (large datasets, many sections, rapid interactions)

### End-to-End Tests

**User Workflows** (using Playwright or Cypress):
1. Load scratchpad → Verify all sections render → Collapse/expand sections → Verify state persists on reload
2. Hover over data points → Verify tooltips appear → Click copy icons → Verify clipboard content
3. Click source citations → Verify new tabs open with correct URLs
4. Click export buttons → Verify markdown file downloads / clipboard contains all content
5. Resize viewport → Verify responsive layout changes
6. Navigate with keyboard → Verify focus indicators and keyboard shortcuts work

### Visual Regression Tests

**Snapshot Tests** (using Percy or Chromatic):
1. Default scratchpad state (all sections expanded)
2. Partially collapsed state
3. Hover states (product categories, chart bars, copy icons)
4. Mobile viewport (responsive layout)
5. Empty/error states
6. Dark mode (if applicable)

### Accessibility Tests

**Automated Checks** (using axe-core):
1. Color contrast ratios
2. ARIA attributes and roles
3. Keyboard navigation order
4. Focus indicators
5. Screen reader announcements

**Manual Testing**:
1. Navigate entire scratchpad with keyboard only
2. Test with screen reader (NVDA/JAWS/VoiceOver)
3. Verify with prefers-reduced-motion enabled
4. Test with browser zoom at 200%

### Performance Tests

**Metrics to Monitor**:
1. Initial render time (< 500ms for typical data)
2. Collapse/expand animation smoothness (60fps)
3. Hover interaction responsiveness (< 100ms)
4. Large dataset handling (100+ sources, 10+ years of trends)
5. Memory usage (no leaks on repeated interactions)

### Test Data Fixtures

Create realistic test fixtures based on actual SEC filing data:
- Apple revenue recognition (hardware vs services)
- Amazon multi-year revenue trends
- Various filing types (10-K, 10-Q) with real dates
- Edge cases (negative growth, missing data, unusual formats)

Store fixtures in: `test/fixtures/scratchpad-data/`

## Implementation Notes

### Technology Stack

- **Framework**: Vanilla JavaScript or React (match existing FundLens architecture)
- **Styling**: CSS Modules or styled-components (use existing design-system.css)
- **Charts**: D3.js or Chart.js for revenue trend visualization
- **Icons**: Lucide React or Heroicons (match existing icon library)
- **Testing**: Jest + React Testing Library + fast-check + Playwright

### Integration Points

1. **Backend Service**: `src/deals/scratch-pad.service.ts`
   - Extend to return structured data matching `ScratchpadData` interface
   - Add endpoint for provocation generation
   - Ensure source citations include full URLs

2. **Research Assistant**: `/app/research/index.html`
   - Replace existing scratchpad display with new component
   - Maintain existing chat interface integration
   - Preserve workspace context and authentication

3. **Design System**: `public/css/design-system.css`
   - Use existing button styles, color variables, spacing utilities
   - Extend with scratchpad-specific styles in separate file
   - Ensure consistency with other FundLens components

4. **Previous Scratchpad Upgrade**: `.kiro/specs/workspace-chat-scratchpad-upgrade/`
   - Review previous implementation patterns
   - Reuse collapsible section logic if applicable
   - Maintain backward compatibility with existing data

### Performance Considerations

1. **Lazy Loading**: Load chart library only when revenue trends section is expanded
2. **Virtualization**: If source list exceeds 50 items, use virtual scrolling
3. **Debouncing**: Debounce hover events (50ms) to reduce re-renders
4. **Memoization**: Memoize expensive computations (chart data transformations)
5. **Code Splitting**: Split scratchpad component into separate bundle

### Accessibility Considerations

1. **Semantic HTML**: Use `<button>`, `<nav>`, `<article>` appropriately
2. **ARIA Patterns**: Follow WAI-ARIA authoring practices for disclosure widgets
3. **Focus Management**: Trap focus in modals, restore focus after actions
4. **Keyboard Shortcuts**: Document shortcuts in help tooltip
5. **Screen Reader Testing**: Test with multiple screen readers (NVDA, JAWS, VoiceOver)

### Browser Support

- **Modern Browsers**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Fallbacks**: Provide graceful degradation for older browsers
- **Polyfills**: Include polyfills for Intersection Observer, ResizeObserver if needed
- **Testing**: Test on Windows, macOS, iOS, Android

### Deployment Strategy

1. **Feature Flag**: Deploy behind feature flag for gradual rollout
2. **A/B Testing**: Compare new scratchpad vs old for user engagement metrics
3. **Monitoring**: Track error rates, performance metrics, user interactions
4. **Rollback Plan**: Maintain old scratchpad component for quick rollback if needed
5. **User Feedback**: Collect feedback through in-app survey after 1 week

### Future Enhancements

1. **Customization**: Allow users to reorder sections, hide unwanted sections
2. **Export Formats**: Add PDF and Excel export options
3. **Annotations**: Allow users to add notes and highlights
4. **Collaboration**: Share scratchpad with team members
5. **Historical Comparison**: Compare current scratchpad with previous versions
6. **AI Insights**: Expand provocation feature with more analytical questions
