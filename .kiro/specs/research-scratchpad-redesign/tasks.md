# Implementation Plan: Research Scratchpad Redesign

## Overview

This implementation plan transforms the Research Scratchpad from a basic text display into a sophisticated collection interface for saved research items. The scratchpad is integrated as a tab within the Analyst Workspace (`/app/deals/workspace.html`), not a standalone page.

The approach follows an incremental pattern: backend data models → API endpoints → frontend components → type-specific renderers → workspace integration → micro-interactions → testing.

The implementation integrates with existing FundLens infrastructure (`src/deals/scratch-pad.service.ts`, `/app/deals/workspace.html`, `public/css/design-system.css`) and builds upon patterns from the previous workspace chat scratchpad upgrade.

## Tasks

- [x] 1. Set up database schema and backend data models
  - Create `scratchpad_items` table with fields: id, workspaceId, type, content (JSONB), sources (JSONB), savedAt, savedFrom (JSONB), metadata (JSONB)
  - Add indexes on workspaceId and savedAt for efficient querying
  - Create TypeScript interfaces matching database schema (ScratchpadItem, DirectAnswer, RevenueFramework, TrendAnalysis, Provocation)
  - _Requirements: 2.1, 2.2_

- [ ]* 1.1 Write property test for scratchpad data model
  - **Property 1: Section State Persistence Round-Trip**
  - **Validates: Requirements 4.5**

- [x] 2. Implement backend API endpoints
  - [x] 2.1 Create GET /api/research/scratchpad/:workspaceId endpoint
    - Fetch all saved items for workspace, ordered by savedAt descending
    - Return items array and totalCount
    - _Requirements: 2.1_

  - [x] 2.2 Create POST /api/research/scratchpad/save endpoint
    - Accept workspaceId, type, content, sources, savedFrom
    - Validate item type and content structure
    - Save to database and return created item
    - _Requirements: 2.1_

  - [x] 2.3 Create DELETE /api/research/scratchpad/:itemId endpoint
    - Verify item belongs to user's workspace
    - Delete item and return success status
    - _Requirements: 2.3, 2.4_

  - [x] 2.4 Create POST /api/research/scratchpad/export endpoint
    - Accept workspaceId, format (markdown/text/json), optional itemIds
    - Generate formatted export of items
    - Return content and suggested filename
    - _Requirements: 12.2, 12.3_

  - [ ]* 2.5 Write unit tests for API endpoints
    - Test successful item creation, retrieval, deletion
    - Test validation errors (invalid type, missing fields)
    - Test authorization (user can only access their workspace items)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [ ] 3. Extend scratch-pad.service.ts with new methods
  - Add `saveItem(workspaceId, itemData)` method
  - Add `getItems(workspaceId)` method
  - Add `deleteItem(itemId, workspaceId)` method
  - Add `exportItems(workspaceId, format, itemIds?)` method
  - Integrate with existing service patterns
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 12.2, 12.3_

- [ ]* 3.1 Write property test for item management
  - **Property 2: Section Toggle Consistency**
  - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [x] 4. Create frontend component structure
  - [x] 4.1 Create ResearchScratchpad container component
    - Set up state management (items, collapsedItems, selectedItems, isLoading, error)
    - Implement data fetching on mount
    - Handle loading and error states
    - _Requirements: 1.1, 1.3, 2.1, 2.2_

  - [x] 4.2 Create StickyHeader component
    - Display title "Research Scratchpad" and item count
    - Render three action buttons (Export, Copy All, Add to Report)
    - Implement sticky positioning with scroll shadow
    - _Requirements: 1.3, 1.4, 12.1, 12.5_

  - [x] 4.3 Create SavedItem component
    - Render item card with header (type badge, timestamp, delete button)
    - Implement collapse/expand functionality
    - Show truncated preview when collapsed (100 chars)
    - Handle delete with confirmation modal
    - _Requirements: 1.1, 1.2, 2.5, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4_

  - [x] 4.4 Create EmptyState component
    - Display when items array is empty
    - Show icon, message, and guidance text
    - Optional CTA button to navigate to Research Assistant
    - _Requirements: 2.2_

  - [ ]* 4.5 Write unit tests for container and base components
    - Test data fetching and state updates
    - Test collapse/expand behavior
    - Test delete confirmation flow
    - Test empty state rendering
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.3, 4.4_

- [ ] 5. Checkpoint - Ensure basic structure works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement type-specific item renderers
  - [ ] 6.1 Create DirectAnswerItem component
    - Render with light teal background tint and left border accent
    - Display answer text with larger font size (16px)
    - Show confidence badge if present
    - Show source count badge
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 6.2 Write property tests for DirectAnswerItem
    - **Property 3: Confidence Badge Display**
    - **Property 4: Source Count Badge Format**
    - **Validates: Requirements 5.3, 5.4**

  - [ ] 6.3 Create RevenueFrameworkItem component
    - Implement two-column layout (Point-in-Time vs Over-Time)
    - Render product categories with icons
    - Apply color-coded tags (green for point-in-time, blue for over-time)
    - Implement hover highlighting
    - Make responsive (stack columns below 768px)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 6.4 Write property tests for RevenueFrameworkItem
    - **Property 5: Product Category Icon Presence**
    - **Property 6: Semantic Color Coding**
    - **Validates: Requirements 6.2, 6.3**

  - [ ] 6.5 Create TrendAnalysisItem component
    - Render horizontal bar chart using SVG
    - Display metric label above chart
    - Show YoY badges (green for positive, red for negative)
    - Implement hover tooltips with exact figures
    - Format currency with abbreviations (B/M)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 6.6 Write property tests for TrendAnalysisItem
    - **Property 7: Hover State Feedback**
    - **Property 8: Currency Formatting Consistency**
    - **Validates: Requirements 7.3, 7.4**

  - [ ] 6.7 Create ProvocationItem component
    - Render with dashed border and light gray background
    - Display "Think Deeper" heading with lightbulb icon
    - Italicize question text
    - Make read-only (no interactions)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 6.8 Write unit tests for type-specific renderers
    - Test each renderer with various data inputs
    - Test edge cases (missing fields, extreme values)
    - Test responsive behavior
    - _Requirements: 5.1-5.5, 6.1-6.5, 7.1-7.5, 9.1-9.5_

- [ ] 7. Implement source citations component
  - [ ] 7.1 Create SourceChips component
    - Render each source as clickable chip
    - Display filing type and date in chip
    - Open filing URL in new tab on click
    - Apply hover styles
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 7.2 Write property tests for SourceChips
    - **Property 9: Source Citation Completeness**
    - **Property 10: Source Citation Click Behavior**
    - **Validates: Requirements 8.2, 8.3, 8.4**

- [ ] 8. Implement copy-on-hover micro-interactions
  - [ ] 8.1 Create CopyOnHover utility component
    - Show copy icon on hover over numerical values
    - Implement clipboard copy with Excel formatting
    - Display confirmation toast for 1-2 seconds
    - Apply fade-in/fade-out transitions (150ms)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 8.2 Write property tests for copy functionality
    - **Property 11: Copy-to-Clipboard Formatting**
    - **Property 12: Copy Confirmation Feedback**
    - **Property 13: Numerical Value Copy Support**
    - **Validates: Requirements 10.2, 10.3, 10.5**

- [ ] 9. Implement action buttons functionality
  - [ ] 9.1 Implement "Export to Markdown" button
    - Call export API with markdown format
    - Trigger file download with generated content
    - Show success/error feedback
    - _Requirements: 12.2_

  - [ ] 9.2 Implement "Copy All" button
    - Call export API with text format
    - Copy formatted content to clipboard
    - Show success/error feedback
    - _Requirements: 12.3_

  - [ ] 9.3 Implement "Add to Report" button
    - Integrate with IC Memo generation workflow
    - Pass selected items (or all items if none selected)
    - Navigate to report generation interface
    - _Requirements: 12.4_

  - [ ]* 9.4 Write unit tests for action buttons
    - Test export functionality
    - Test clipboard operations
    - Test IC Memo integration
    - _Requirements: 12.2, 12.3, 12.4_

- [ ] 10. Checkpoint - Ensure all functionality works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement animations and transitions
  - [ ] 11.1 Add collapse/expand animations
    - Implement max-height transition (200-300ms, ease-in-out)
    - Add opacity fade for smooth appearance
    - _Requirements: 11.1, 11.3_

  - [ ] 11.2 Add hover state transitions
    - Apply 150ms transitions to all hover effects
    - Ensure smooth color and opacity changes
    - _Requirements: 11.2, 11.3_

  - [ ] 11.3 Implement prefers-reduced-motion support
    - Detect user preference
    - Disable all animations when enabled
    - Use instant state changes
    - _Requirements: 11.4_

  - [ ]* 11.4 Write property tests for animations
    - **Property 14: Animation Timing Consistency**
    - **Property 15: Reduced Motion Compliance**
    - **Validates: Requirements 11.1, 11.3, 11.4**

- [ ] 12. Implement localStorage persistence
  - [ ] 12.1 Create localStorage utility functions
    - `saveCollapseState(workspaceId, itemId, isCollapsed)`
    - `loadCollapseStates(workspaceId)`
    - `clearCollapseStates(workspaceId)`
    - _Requirements: 4.5_

  - [ ] 12.2 Integrate persistence with SavedItem component
    - Save collapse state on toggle
    - Restore states on component mount
    - Handle workspace changes
    - _Requirements: 4.5_

  - [ ]* 12.3 Write property test for persistence
    - **Property 1: Section State Persistence Round-Trip** (revisited)
    - **Validates: Requirements 4.5**

- [ ] 13. Implement responsive design
  - [ ] 13.1 Add responsive styles for mobile viewports
    - Stack revenue framework columns below 768px
    - Reduce card padding on small screens
    - Collapse action buttons into dropdown menu
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ] 13.2 Ensure minimum font sizes
    - Apply 14px minimum across all screen sizes
    - Test readability at various zoom levels
    - _Requirements: 13.4_

  - [ ]* 13.3 Write property test for responsive behavior
    - **Property 16: Minimum Font Size Enforcement**
    - **Validates: Requirements 13.4**

- [ ] 14. Implement accessibility features
  - [ ] 14.1 Add keyboard navigation support
    - Implement focus indicators for all interactive elements
    - Support Space/Enter for expand/collapse
    - Support Delete key for item deletion
    - Ensure logical tab order
    - _Requirements: 14.1, 14.2_

  - [ ] 14.2 Add ARIA attributes and labels
    - Add aria-label to all icons
    - Add aria-expanded to collapsible items
    - Add role attributes where appropriate
    - Implement live regions for state announcements
    - _Requirements: 14.3, 14.4_

  - [ ] 14.3 Verify color contrast ratios
    - Test all text/background combinations
    - Ensure 4.5:1 minimum contrast
    - Adjust colors if needed
    - _Requirements: 14.5_

  - [ ]* 14.4 Write property tests for accessibility
    - **Property 17: Accessibility - Focus Indicators and ARIA**
    - **Property 18: Accessibility - State Announcements**
    - **Property 19: Accessibility - Color Contrast**
    - **Validates: Requirements 14.1, 14.3, 14.4, 14.5**

- [x] 15. Create CSS styles
  - [x] 15.1 Create research-scratchpad.css file
    - Define card styles (border-radius, shadows, spacing)
    - Define type badge colors
    - Define animation keyframes and transitions
    - Define responsive breakpoints
    - Use FundLens design system variables
    - _Requirements: 1.1, 1.2, 1.5, 3.2_

  - [x] 15.2 Integrate with existing design-system.css
    - Use existing button styles
    - Use existing color variables
    - Maintain consistency with other components
    - _Requirements: 1.5, 12.5_

- [ ] 16. Integrate with Analyst Workspace
  - [ ] 16.1 Add Scratchpad tab to workspace.html navigation
    - Add "Scratchpad" tab to left navigation menu
    - Position between "Research" and "Reports" tabs
    - Add item count badge to tab label
    - Implement tab switching logic
    - _Requirements: 1.3, 2.1_

  - [ ] 16.2 Add "Save to Scratchpad" button to Research tab chat messages
    - Display button on relevant chat responses
    - Determine item type from response structure
    - Call save API on click
    - Show success feedback and update scratchpad tab badge
    - _Requirements: 2.1_

  - [ ] 16.3 Update EmptyState to reference Research tab
    - Change CTA button text to "Go to Research Tab"
    - Implement tab switching on button click
    - Update guidance text to mention "Research tab"
    - _Requirements: 2.2_

  - [ ]* 16.4 Write integration tests
    - Test save flow from Research tab to Scratchpad tab
    - Test tab navigation and state preservation
    - Test item count badge updates
    - _Requirements: 2.1, 2.2_

- [ ] 17. Final checkpoint - End-to-end testing
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Write end-to-end tests
  - [ ]* 18.1 Test complete user workflow
    - Navigate to workspace → Switch to Scratchpad tab → Verify items render → Collapse/expand items → Delete item → Verify persistence on reload
    - Switch to Research tab → Save item from chat → Switch to Scratchpad tab → Verify item appears → Export to markdown → Verify file content
    - Hover over data points → Copy values → Verify clipboard content
    - Click source citations → Verify new tabs open
    - Resize viewport → Verify responsive layout
    - _Requirements: All_

  - [ ]* 18.2 Test accessibility with automated tools
    - Run axe-core checks
    - Test keyboard navigation within workspace tabs
    - Verify ARIA attributes
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Integration tests verify component interactions
- End-to-end tests validate complete user workflows
