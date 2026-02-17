# Requirements Document

## Introduction

Refactor the FundLens workspace monolith (`public/app/deals/workspace.html`, 5,784 lines) into separate, independent HTML pages with a module-agnostic shared JavaScript shell. The monolith currently contains a single Alpine.js component with 80+ state variables, 60+ methods, and 7 views toggled via `x-show`, causing Alpine.js proxy crashes, excessive page load times, and inability to evolve views independently. The refactored architecture uses real page navigation (`window.location.href`) instead of `x-show` toggling, with each page loading only its own state and methods.

The architecture must support future FundLens modules (Private Equity, Credit Analysis) without copy-pasting the shell or navigation patterns. PE will have different pages (Pipeline, Due Diligence, Portfolio, Data Room), different entity identifiers (`?dealId=uuid` instead of `?ticker=`), and different sidebar items — the shell must accommodate this structurally without writing PE code now.

## Glossary

- **Workspace_Monolith**: The current `public/app/deals/workspace.html` file containing all views in a single Alpine.js component
- **Shell**: The shared JavaScript module (`public/app/_shell.js`) that provides common navigation, authentication, breadcrumbs, sidebar, user menu, and filing notification functionality across all modules and pages
- **Module_Config**: A per-module JavaScript file (`_module-config.js`) that defines sidebar items, entity parameter, breadcrumb labels, and base path for that module
- **Utils**: The shared JavaScript module (`public/app/_utils.js`) that provides formatting functions (currency, percent, ratio, days, YoY growth) used across all modules
- **Page**: A self-contained HTML file with its own Alpine.js component, loading only the state and methods relevant to that view
- **Ticker**: The stock symbol (e.g., AAPL) passed via URL query parameter `?ticker=` to identify the current deal in the Equity Research module
- **Entity_Context**: The abstracted identifier for the "thing" being analyzed — `{ type: 'ticker', value: 'AAPL' }` for equity, `{ type: 'dealId', value: 'uuid' }` for PE (future)
- **Quantitative_Page**: The page displaying financial performance metrics (revenue, margins, cash flow, balance sheet, working capital)
- **Qualitative_Page**: The page displaying deep-value qualitative analysis (management credibility, balance sheet protection, capital allocation, earnings quality, competitive risk)
- **Export_Page**: The page containing the 3-step Excel export wizard (year → filing type → export)
- **Provocations_Page**: The page for the provocations engine and sentiment analysis
- **Research_Page**: The page for the research assistant chat, Instant RAG document upload, and SSE streaming
- **Scratchpad_Page**: The page for saved research items from Research_Page and Provocations_Page
- **IC_Memo_Page**: The page for generating Investment Committee memos using scratchpad and financial data
- **Sidebar**: The left navigation panel present on every page, with collapsible groups, highlighting the current page and providing keyboard shortcuts
- **Breadcrumbs**: The navigation trail displayed on every page: Home > Deals > TICKER > Page Name
- **Filing_Notifications**: The bell icon notification system in the nav bar showing new SEC filing alerts
- **Deep_Copy**: Using `JSON.parse(JSON.stringify(...))` when assigning complex API responses to Alpine reactive properties to prevent proxy crashes
- **Shell_Events**: An in-page pub/sub event bus provided by the shell for decoupled communication between shell and page components

## Requirements

### Requirement 1: Module-Agnostic Shared Shell

**User Story:** As a platform developer, I want a single shared shell that works across all FundLens modules (Equity, PE, Credit), so that navigation, authentication, and UI chrome remain consistent without code duplication.

#### Acceptance Criteria

1. THE Shell SHALL live at `public/app/_shell.js` (not inside any module directory) and export a `window.FundLensShell(viewName, viewData)` function that returns a merged Alpine.js data object combining common state and view-specific state
2. THE Shell SHALL read module configuration from `window.FundLensModuleConfig` (set by a per-module `_module-config.js` loaded before `_shell.js`)
3. THE Shell SHALL provide common state properties: user object, entityContext (with entity value from URL params), auth headers, filing notifications array, online/offline status, and scratchpadCount
4. THE Shell SHALL provide common methods: `getAuthHeaders()`, `loadUser()`, `logout()`, `navigateTo(page)`, `navigateToWithParams(page, extraParams)`, `loadFilingNotifications()`, `startFilingNotifPolling()`, `loadScratchpadCount()`, and `getUserInitials()`
5. WHEN a page loads, THE Shell SHALL extract the entity value from the URL query parameter specified by `moduleConfig.entityParam` (e.g., `?ticker=` for equity) and populate `entityContext`
6. WHEN no authentication token is found in localStorage, THE Shell SHALL redirect the user to `/login.html`
7. WHEN running on localhost, THE Shell SHALL auto-inject a mock JWT token with tenant ID `00000000-0000-0000-0000-000000000000`
8. THE Shell SHALL render a consistent nav bar matching `public/app/deals/index.html` (navy background, tenant badge, user menu, filing notifications bell)
9. THE Shell SHALL render breadcrumbs on every page in the format: Home > Module > ENTITY > Page Name, where Home links to `/fundlens-main.html`, Module links to the module index (e.g., `/app/deals/index.html`), ENTITY is the entity display name (not a link), and Page Name is derived from the sidebar config
10. THE Shell SHALL render a sidebar with collapsible groups as defined by `moduleConfig.sidebarGroups`, highlighting the current page and providing keyboard shortcuts (⌘1-7) for navigating between pages
11. WHEN `navigateTo(page)` is called, THE Shell SHALL perform real page navigation via `window.location.href` to the target page within the current module's base path, preserving all entity context query parameters

### Requirement 2: Module Configuration

**User Story:** As a developer, I want each module to define its own navigation structure and entity type, so that the shell adapts to different modules without code changes.

#### Acceptance Criteria

1. THE Equity Module SHALL provide `public/app/deals/_module-config.js` setting `window.FundLensModuleConfig` with: `moduleName: 'Equity Research'`, `moduleSlug: 'deals'`, `basePath: '/app/deals'`, `entityParam: 'ticker'`, `entityType: 'ticker'`, and sidebar groups
2. THE Module_Config SHALL define `sidebarGroups` as an array of groups, each with `label`, `items` array, and optional `collapsed` boolean
3. EACH sidebar item SHALL have: `name` (display label), `page` (filename without .html), `icon` (Font Awesome class), `shortcut` (keyboard number), and optional `badge` (Alpine state property name for count badge)
4. THE Equity Module sidebar groups SHALL preserve the current UX grouping: "Analysis" group (Quantitative, Qualitative), "Tools" group (Export, Provocations), "Research" group (Research Assistant, Scratchpad with count badge, IC Memo)
5. THE Module_Config SHALL define breadcrumb labels: `home` (label + path), `module` (label + path), with entity and page labels populated at runtime from entityContext and sidebar config

### Requirement 3: Shared Utilities Module

**User Story:** As a developer, I want shared formatting utility functions in a module-agnostic location, so that all modules display financial data consistently without duplicating formatting logic.

#### Acceptance Criteria

1. THE Utils SHALL live at `public/app/_utils.js` (not inside any module directory) and export `window.FundLensUtils` with formatting functions: `formatCurrency(value)`, `formatPercent(value)`, `formatRatio(value)`, `formatDays(value)`, `getYoYGrowth(growthData, period)`, `getMarginForPeriod(marginData, period)`, `getValueForPeriod(data, period, type)`, and `deepCopy(obj)`
2. WHEN `formatCurrency` receives a numeric value, THE Utils SHALL return a formatted US dollar string with appropriate magnitude suffix (K, M, B)
3. WHEN `formatPercent` receives a numeric value, THE Utils SHALL return a formatted percentage string with one decimal place
4. WHEN any formatting function receives null or undefined, THE Utils SHALL return a dash character ("—") instead of throwing an error

### Requirement 4: Quantitative Analysis Page

**User Story:** As an equity analyst, I want a dedicated quantitative analysis page, so that I can view financial performance metrics without loading unrelated research or memo code.

#### Acceptance Criteria

1. WHEN the Quantitative_Page loads, THE Quantitative_Page SHALL fetch and display comprehensive financial metrics (revenue, profitability, cash flow, balance sheet, working capital) for the current ticker
2. THE Quantitative_Page SHALL contain only the state variables and methods needed for quantitative financial display (data, loading, years, metrics)
3. WHEN financial data is received from the API, THE Quantitative_Page SHALL apply Deep_Copy before assigning to Alpine reactive properties
4. IF the API call fails, THEN THE Quantitative_Page SHALL display an error message and offer a retry mechanism with exponential backoff up to 3 retries

### Requirement 5: Qualitative Analysis Page

**User Story:** As an equity analyst, I want a dedicated qualitative analysis page, so that I can view deep-value analysis and evolve sector-specific qualitative features independently.

#### Acceptance Criteria

1. WHEN the Qualitative_Page loads, THE Qualitative_Page SHALL fetch and display qualitative analysis data organized by categories (management credibility, balance sheet protection, capital allocation, earnings quality, competitive risk)
2. WHEN no cached qualitative data exists, THE Qualitative_Page SHALL auto-trigger qualitative data generation
3. THE Qualitative_Page SHALL provide a refresh button to regenerate qualitative analysis
4. THE Qualitative_Page SHALL contain only the state variables and methods needed for qualitative display (qualitativeData, loadingQualitative, refreshingQualitative, section metadata)

### Requirement 6: Export Wizard Page

**User Story:** As an equity analyst, I want a dedicated export page, so that I can export financial data to Excel through the 3-step wizard without loading analysis or research code.

#### Acceptance Criteria

1. WHEN the Export_Page loads, THE Export_Page SHALL display the 3-step export wizard: year selection → filing type selection → export options
2. THE Export_Page SHALL load available periods from the API when the page initializes
3. WHEN the user completes all 3 steps and clicks export, THE Export_Page SHALL trigger the Excel file download
4. IF the export fails, THEN THE Export_Page SHALL display a descriptive error message
5. THE Export_Page SHALL contain only the state variables needed for export (exportStep, exportSelectedYear, exportFilingType, availablePeriods, selectedStatements, exportLoading, exportError)

### Requirement 7: Provocations Page

**User Story:** As an equity analyst, I want a dedicated provocations page, so that I can run the provocations engine and sentiment analysis independently from other views.

#### Acceptance Criteria

1. WHEN the Provocations_Page loads, THE Provocations_Page SHALL fetch and display precomputed provocations for the current ticker
2. THE Provocations_Page SHALL support two modes: provocations mode (adversarial analysis) and sentiment mode (tone tracking)
3. WHEN the user clicks "Ask in Research" on a provocation, THE Provocations_Page SHALL navigate to `research.html?ticker=TICKER&query=ENCODED_QUESTION`
4. WHEN the user clicks "Save to Scratchpad" on a provocation, THE Provocations_Page SHALL make an API call to save the item and display a confirmation
5. THE Provocations_Page SHALL contain only the state variables needed for provocations (provocationsData, provocationsLoading, provocationsMode, sentimentData, presetQuestions)

### Requirement 8: Research Assistant Page

**User Story:** As an equity analyst, I want a dedicated research page, so that I can use the chat assistant, upload documents via Instant RAG, and receive SSE-streamed responses without loading analysis or memo code.

#### Acceptance Criteria

1. WHEN the Research_Page loads, THE Research_Page SHALL initialize the chat interface and load any existing conversation for the current ticker
2. THE Research_Page SHALL support SSE (Server-Sent Events) streaming for real-time response rendering with markdown formatting
3. THE Research_Page SHALL support Instant RAG document upload with drag-and-drop, file validation, processing status tracking, and session timeout countdown
4. WHEN the Research_Page receives a `?query=` URL parameter, THE Research_Page SHALL auto-populate the input field and optionally auto-send the query
5. WHEN the user clicks "Save to Scratchpad" on a research response, THE Research_Page SHALL make an API call to save the item
6. THE Research_Page SHALL support provocations mode and sentiment mode toggles that modify the system prompt for the chat
7. THE Research_Page SHALL contain only the state variables needed for research (researchMessages, researchInput, researchTyping, conversationId, provocationsMode, instantRag state, citation state)

### Requirement 9: Scratchpad Page

**User Story:** As an equity analyst, I want a dedicated scratchpad page, so that I can review and manage saved research items independently.

#### Acceptance Criteria

1. WHEN the Scratchpad_Page loads, THE Scratchpad_Page SHALL fetch and display all saved scratchpad items for the current ticker
2. THE Scratchpad_Page SHALL support deleting individual scratchpad items
3. WHEN the user clicks "Add to Report", THE Scratchpad_Page SHALL navigate to `ic-memo.html?ticker=TICKER`
4. WHEN the user clicks "Go to Research", THE Scratchpad_Page SHALL navigate to `research.html?ticker=TICKER`
5. THE Scratchpad_Page SHALL contain only the state variables needed for scratchpad (scratchpadItems, scratchpadCount, scratchpadScrolled)

### Requirement 10: IC Memo Page

**User Story:** As an equity analyst, I want a dedicated IC Memo page, so that I can generate Investment Committee memos using scratchpad items and financial data.

#### Acceptance Criteria

1. WHEN the IC_Memo_Page loads, THE IC_Memo_Page SHALL fetch scratchpad items and financial summary data for the current ticker
2. WHEN the user clicks "Generate Memo", THE IC_Memo_Page SHALL stream the memo content via SSE with real-time markdown rendering
3. THE IC_Memo_Page SHALL support copying the generated memo to clipboard and downloading as a document
4. THE IC_Memo_Page SHALL contain only the state variables needed for memo generation (memoGenerated, memoGenerating, memoContent, scratchpadItems)

### Requirement 11: URL Redirect Compatibility

**User Story:** As a user with bookmarked workspace URLs, I want old workspace.html URLs to redirect to the correct new page, so that existing bookmarks and shared links continue to work.

#### Acceptance Criteria

1. WHEN `workspace.html?ticker=AAPL` is loaded with no hash, THE Workspace_Monolith SHALL redirect to `quantitative.html?ticker=AAPL`
2. WHEN `workspace.html?ticker=AAPL#research` is loaded, THE Workspace_Monolith SHALL redirect to `research.html?ticker=AAPL`
3. WHEN `workspace.html?ticker=AAPL#scratchpad` is loaded, THE Workspace_Monolith SHALL redirect to `scratchpad.html?ticker=AAPL`
4. WHEN `workspace.html?ticker=AAPL#ic-memo` is loaded, THE Workspace_Monolith SHALL redirect to `ic-memo.html?ticker=AAPL`
5. WHEN `workspace.html?ticker=AAPL#analysis` is loaded, THE Workspace_Monolith SHALL redirect to `quantitative.html?ticker=AAPL`
6. THE redirect SHALL use `window.location.replace()` to avoid back-button loops
7. THE redirect SHALL preserve all query parameters (not just ticker) in the destination URL

### Requirement 12: Cross-Page Interactions

**User Story:** As an equity analyst, I want seamless navigation between pages with context preserved, so that cross-view workflows (save to scratchpad, ask in research, add to report) work correctly.

#### Acceptance Criteria

1. WHEN any page performs a "Save to Scratchpad" action, THE Page SHALL make an API call to persist the item and display a success confirmation without requiring page navigation
2. WHEN any page navigates to another page, THE Page SHALL preserve all entity context query parameters in the destination URL
3. THE Sidebar SHALL display the scratchpad item count badge on every page, fetched via API on page load
4. WHEN the user presses keyboard shortcuts (⌘1-7), THE Shell SHALL navigate to the corresponding page as defined in the module config
5. WHEN the Research_Page receives a `?query=` parameter from cross-page navigation, THE Research_Page SHALL auto-populate and optionally auto-send the query

### Requirement 13: Performance and Isolation

**User Story:** As a developer, I want each page to load only its own code and state, so that page load times are reduced and Alpine.js proxy crashes are eliminated.

#### Acceptance Criteria

1. THE Quantitative_Page SHALL include only `_shell.js`, `_module-config.js`, `_utils.js`, and its own inline Alpine component — no research, memo, or scratchpad code
2. THE Research_Page SHALL include only `_shell.js`, `_module-config.js`, `_utils.js`, and its own inline Alpine component — no quantitative, qualitative, or export code
3. WHEN complex API response objects are assigned to Alpine reactive state, THE Page SHALL use Deep_Copy (`JSON.parse(JSON.stringify(...))`) to prevent Alpine.js 3.x proxy crashes
4. THE Shell SHALL load only shared CSS files (design-system.css, filing-notifications.css) and each page SHALL load only its own additional CSS files

### Requirement 14: Shell Event Bus

**User Story:** As a platform developer, I want a shared in-page event mechanism so that shell and page components can communicate without tight coupling, and so that future real-time updates (WebSocket/SSE) can be added without restructuring.

#### Acceptance Criteria

1. THE Shell SHALL provide `shellOn(event, callback)` and `shellEmit(event, data)` methods for in-page pub/sub communication
2. Filing notification polling SHALL be managed by the shell, with pages subscribing to `filing:loaded` events if they need notification data
3. Scratchpad count updates SHALL be emitted as `scratchpad:countChanged` events after any save or delete operation
4. THE event bus SHALL be in-page only (not cross-tab) — each page has its own instance
5. THE event bus SHALL be designed so it can be upgraded to SSE/WebSocket for cross-module real-time updates in the future without changing the subscriber API
