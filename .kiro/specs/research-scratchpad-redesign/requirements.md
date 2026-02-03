# Requirements Document: Research Scratchpad Redesign

## Introduction

The Research Scratchpad is a critical component of FundLens that serves as a **reservoir for saved research items** from the Research Assistant chatbot. Equity analysts save important findings, insights, and data points from their chat interactions, accumulating them in the scratchpad over time. This curated collection of saved items then feeds into IC Memo generation, acting as a funnel of key information for investment decision-making.

**Key Concept**: The scratchpad is NOT an intelligent analysis tool—it's a **collection interface** for items the analyst explicitly saves. Each saved item represents a discrete piece of research (a direct answer, a trend analysis, a revenue framework, or a provocation question) that the analyst deemed important enough to preserve.

This redesign transforms the scratchpad from a basic text list into a sophisticated, scannable interface optimized for equity analysts who need to quickly review, extract, and act on their saved research items. The redesign emphasizes visual hierarchy, type-specific rendering, and micro-interactions while maintaining FundLens's enterprise brand identity (deep navy #1a2744 primary, teal #0d9488 accents).

## Glossary

- **Research_Scratchpad**: The component that displays a collection of saved research items from the Research Assistant chatbot
- **Saved_Item**: A discrete piece of research (answer, framework, trend, or provocation) that an analyst has explicitly saved
- **Item_Type**: The category of saved item (direct_answer, revenue_framework, trend_analysis, provocation)
- **Direct_Answer**: A primary finding or conclusion extracted from SEC filings and saved by the analyst
- **Revenue_Recognition_Framework**: A structured breakdown of how a company recognizes revenue (point-in-time vs over-time)
- **Trend_Analysis**: Multi-year data visualization showing revenue, income, or other metrics over time
- **Confidence_Score**: A numerical or qualitative indicator of the reliability of extracted insights
- **Source_Citation**: A reference to a specific SEC filing (10-K, 10-Q) with filing date
- **Provocation**: An AI-generated analytical question designed to stimulate deeper thinking
- **Card_Component**: A visual container with rounded corners, subtle shadows, and padding
- **Micro_Interaction**: Small, responsive UI behaviors triggered by user actions (hover, click, copy)
- **IC_Memo**: Investment Committee Memo that will be generated from scratchpad items

## Requirements

### Requirement 1: Card-Based Layout Structure

**User Story:** As an equity analyst, I want a clean, organized visual layout for my saved items, so that I can quickly scan and navigate research insights without visual clutter.

#### Acceptance Criteria

1. THE Research_Scratchpad SHALL display saved items as individual card-based components with 8px border radius and subtle box shadows
2. WHEN the Research_Scratchpad renders, THE System SHALL apply consistent spacing (16px between cards, 20px padding inside cards)
3. THE Research_Scratchpad SHALL display a sticky header containing the title "Research Scratchpad", item count, and action buttons
4. WHEN a user scrolls down, THE sticky header SHALL remain visible at the top of the viewport
5. THE Research_Scratchpad SHALL use the FundLens brand colors (navy #1a2744 for primary elements, teal #0d9488 for accents)

### Requirement 2: Saved Item Management

**User Story:** As an equity analyst, I want to manage my saved research items, so that I can organize and curate my collection of insights.

#### Acceptance Criteria

1. WHEN the Research_Scratchpad loads, THE System SHALL fetch all saved items for the current workspace from the backend
2. WHEN no saved items exist, THE System SHALL display an empty state with message "No saved items yet" and guidance text
3. WHEN a user deletes a saved item, THE System SHALL show a confirmation modal before removing the item
4. WHEN a saved item is deleted, THE System SHALL remove it from the display and update the item count
5. THE System SHALL display each saved item with a timestamp showing when it was saved (e.g., "Saved 2 hours ago")

### Requirement 3: Item Type Differentiation

**User Story:** As an equity analyst, I want to quickly identify the type of each saved item, so that I can find specific kinds of research insights efficiently.

#### Acceptance Criteria

1. WHEN displaying a saved item, THE System SHALL show a type badge indicating the item type (Direct Answer, Revenue Framework, Trend Analysis, or Provocation)
2. THE System SHALL use distinct badge colors for each item type (teal for Direct Answer, blue for Revenue Framework, purple for Trend Analysis, orange for Provocation)
3. WHEN a saved item is of type Direct Answer, THE System SHALL render it with light teal background tint and larger font size
4. WHEN a saved item is of type Revenue Framework, THE System SHALL render it in a two-column layout
5. WHEN a saved item is of type Trend Analysis, THE System SHALL render it as a chart visualization

### Requirement 4: Item Collapse and Expansion

### Requirement 4: Item Collapse and Expansion

**User Story:** As an equity analyst, I want to expand and collapse saved items, so that I can focus on relevant information and reduce visual noise.

#### Acceptance Criteria

1. WHEN a user clicks a saved item card, THE System SHALL toggle the item between expanded and collapsed states
2. WHEN an item transitions between states, THE System SHALL animate the transition over 200-300ms using ease-in-out timing
3. WHEN an item is collapsed, THE System SHALL display a truncated preview of the content (first 100 characters)
4. WHEN an item is expanded, THE System SHALL display the full content with type-specific rendering
5. THE System SHALL persist item collapse states in browser localStorage for the current session

### Requirement 5: Direct Answer Item Rendering

**User Story:** As an equity analyst, I want direct answer items displayed prominently, so that I can immediately understand key findings I've saved.

#### Acceptance Criteria

1. THE Direct_Answer item SHALL be displayed with light teal background tint (rgba(13, 148, 136, 0.05))
2. THE Direct_Answer item SHALL use larger font size (16px) compared to other content (14px base)
3. WHEN a Direct_Answer includes a Confidence_Score, THE System SHALL display it as a badge with percentage or qualitative label
4. WHEN a Direct_Answer includes source count, THE System SHALL display "Sources: N SEC filings" as a badge
5. THE Direct_Answer item SHALL have a left border accent (3px solid teal)

### Requirement 6: Revenue Recognition Framework Item Rendering

**User Story:** As an equity analyst, I want saved revenue recognition frameworks displayed visually, so that I can quickly understand how different product lines are recognized.

#### Acceptance Criteria

1. THE Revenue_Recognition_Framework item SHALL display in a two-column layout with "Point-in-Time" and "Over-Time" categories
2. WHEN displaying product categories, THE System SHALL use icons or visual indicators for each (iPhone, Mac, iPad, Services)
3. THE System SHALL apply color-coded tags showing recognition timing (green for point-in-time, blue for over-time)
4. WHEN a user hovers over a product category, THE System SHALL highlight the category with a subtle background color change
5. WHEN viewport width is below 768px, THE System SHALL stack columns vertically

### Requirement 7: Trend Analysis Item Visualization

**User Story:** As an equity analyst, I want saved trend analyses displayed as visual charts, so that I can quickly identify patterns and changes over time.

#### Acceptance Criteria

1. THE Trend_Analysis item SHALL render as a horizontal bar chart or sparkline showing multi-year data
2. WHEN displaying year-over-year changes, THE System SHALL use green pill badges for positive changes and red pill badges for negative changes
3. WHEN a user hovers over a data point in the chart, THE System SHALL display a tooltip with exact figures and percentage change
4. THE System SHALL format currency values with appropriate abbreviations (B for billions, M for millions)
5. THE chart SHALL use the FundLens color palette with teal (#0d9488) for primary bars

### Requirement 8: Source Citations Display

**User Story:** As an equity analyst, I want to see and access source documents for saved items, so that I can verify insights and dive deeper into original filings.

#### Acceptance Criteria

1. WHEN a saved item includes sources, THE System SHALL display each Source_Citation as a clickable chip/tag
2. WHEN a user clicks a Source_Citation, THE System SHALL open the corresponding SEC filing in a new browser tab
3. THE System SHALL display filing date and document type (10-K, 10-Q) for each Source_Citation
4. THE source chips SHALL be displayed at the bottom of each saved item card
5. WHEN a saved item has no sources, THE System SHALL not display a sources section

### Requirement 9: Provocation Item Rendering

**User Story:** As an equity analyst, I want saved provocation questions displayed distinctly, so that I can distinguish analytical questions from factual content.

#### Acceptance Criteria

1. THE Provocation item SHALL use distinct styling (dashed border, light gray background) to differentiate from factual content
2. THE Provocation item SHALL be labeled with "Think Deeper" heading and lightbulb icon
3. THE Provocation question text SHALL be italicized
4. THE Provocation item SHALL use a lighter background color (#fafafa) to visually distinguish it from data-driven content
5. THE Provocation item SHALL be read-only with no interactive elements beyond collapse/expand

### Requirement 10: Copy-on-Hover Micro-Interactions

**User Story:** As an equity analyst, I want to quickly copy data points to Excel, so that I can build financial models without manual retyping.

#### Acceptance Criteria

1. WHEN a user hovers over a numerical data point, THE System SHALL display a copy icon next to the value
2. WHEN a user clicks the copy icon, THE System SHALL copy the value to clipboard formatted for Excel (no currency symbols, proper decimal format)
3. WHEN a value is copied, THE System SHALL display a brief confirmation message (toast or tooltip) for 1-2 seconds
4. THE copy icon SHALL fade in over 150ms on hover and fade out when hover ends
5. THE System SHALL support copying for all numerical metrics (revenue figures, percentages, growth rates)

### Requirement 11: Smooth State Transitions

**User Story:** As an equity analyst, I want smooth, polished interactions, so that the interface feels responsive and professional.

#### Acceptance Criteria

1. WHEN any saved item transitions between collapsed/expanded states, THE System SHALL use CSS transitions with 200-300ms duration
2. WHEN hover states activate, THE System SHALL apply transitions with 150ms duration
3. THE System SHALL use ease-in-out timing functions for all animations
4. WHEN the user has prefers-reduced-motion enabled, THE System SHALL disable all animations
5. THE System SHALL maintain 60fps performance during all transitions and animations

### Requirement 12: Action Button Integration

**User Story:** As an equity analyst, I want to export or share my saved research items, so that I can incorporate findings into reports and presentations.

#### Acceptance Criteria

1. THE sticky header SHALL display three action buttons: "Export to Markdown", "Copy All", and "Add to Report"
2. WHEN a user clicks "Export to Markdown", THE System SHALL generate a markdown file with all saved items
3. WHEN a user clicks "Copy All", THE System SHALL copy all saved items to clipboard in formatted text
4. WHEN a user clicks "Add to Report", THE System SHALL initiate the IC Memo generation workflow with selected items
5. THE action buttons SHALL use the FundLens design system button styles with teal accent color

### Requirement 13: Responsive Layout Adaptation

**User Story:** As an equity analyst, I want the scratchpad to work on different screen sizes, so that I can review insights on various devices.

#### Acceptance Criteria

1. WHEN viewport width is below 768px, THE Revenue_Recognition_Framework items SHALL stack columns vertically
2. WHEN viewport width is below 768px, THE System SHALL reduce card padding from 20px to 16px
3. WHEN viewport width is below 768px, THE sticky header action buttons SHALL collapse into a dropdown menu
4. THE System SHALL maintain readability with minimum font size of 14px on all screen sizes
5. THE System SHALL use CSS Grid or Flexbox for responsive layout management

### Requirement 14: Accessibility Compliance

**User Story:** As an equity analyst with accessibility needs, I want the scratchpad to be keyboard navigable and screen-reader friendly, so that I can access all functionality.

#### Acceptance Criteria

1. WHEN a user navigates with keyboard, THE System SHALL provide visible focus indicators on all interactive elements
2. THE System SHALL support keyboard shortcuts (Space/Enter to expand/collapse, Tab to navigate, Delete to remove items)
3. THE System SHALL provide ARIA labels for all icons and interactive elements
4. WHEN items collapse/expand or are deleted, THE System SHALL announce state changes to screen readers
5. THE System SHALL maintain color contrast ratios of at least 4.5:1 for all text elements
