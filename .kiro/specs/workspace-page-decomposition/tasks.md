# Implementation Plan: Workspace Page Decomposition

## Overview

Break the 5,784-line workspace monolith into 7 independent HTML pages plus a module-agnostic shell, module config, and shared utilities. Tasks are ordered to build shared infrastructure first, then extract pages one at a time, then wire up cross-page interactions and redirects.

## Tasks

- [x] 1. Create shared utility module `_utils.js`
  - [x] 1.1 Create `public/app/_utils.js` with `window.FundLensUtils` exporting: `formatCurrency`, `formatPercent`, `formatRatio`, `formatDays`, `getYoYGrowth`, `getMarginForPeriod`, `getValueForPeriod`, `deepCopy`
    - Extract these functions from the current `workspace.html` (lines ~4100-4250)
    - Ensure null/undefined inputs return `"—"` for all formatting functions
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [ ]* 1.2 Write property tests for formatting utilities
    - **Property 5: formatCurrency correctness**
    - **Property 6: formatPercent correctness**
    - **Validates: Requirements 3.2, 3.3, 3.4**
  - [ ]* 1.3 Write unit tests for formatting edge cases
    - Test `formatCurrency(0)`, `formatCurrency(-999)`, `formatCurrency(1.5e9)`, `formatPercent(NaN)`, `formatRatio(null)`
    - _Requirements: 3.2, 3.3, 3.4_

- [x] 2. Create equity module configuration `_module-config.js`
  - [x] 2.1 Create `public/app/deals/_module-config.js` setting `window.FundLensModuleConfig`
    - Define `moduleName: 'Equity Research'`, `moduleSlug: 'deals'`, `basePath: '/app/deals'`
    - Define `entityParam: 'ticker'`, `entityType: 'ticker'`
    - Define `sidebarGroups` with 3 groups: Analysis (Quantitative, Qualitative), Tools (Export, Provocations), Research (Research Assistant, Scratchpad with badge, IC Memo)
    - Define `breadcrumbs` with home → `/fundlens-main.html` and module → `/app/deals/index.html`
    - Define `loadEntityInfo()` that fetches `/api/deals/:ticker` for display name and sector
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 3. Create shared shell module `_shell.js`
  - [x] 3.1 Create `public/app/_shell.js` with `window.FundLensShell(viewName, viewData)` function
    - Read `window.FundLensModuleConfig` for module-specific behavior
    - Implement common state: `user`, `entityContext`, `isOnline`, `dataLoadError`, `showUserMenu`, `filingNotifications`, `filingNotifCount`, `filingNotifOpen`, `scratchpadCount`, `sidebarGroups`
    - Implement event bus: `shellOn(event, callback)`, `shellEmit(event, data)`, `_eventListeners`
    - Implement common methods: `getAuthHeaders()`, `loadUser()`, `logout()`, `navigateTo()`, `navigateToWithParams()`, `loadFilingNotifications()`, `startFilingNotifPolling()`, `loadScratchpadCount()`, `getUserInitials()`
    - Implement `breadcrumbItems` computed property using module config sidebar to derive page display name
    - Implement `_shellInit()` that checks entity context, runs auth, loads entity info, starts polling, sets up keyboard shortcuts and online/offline handlers
    - Implement dev mode mock JWT injection on localhost
    - Implement merge logic: shell state + viewData, with init wrapping (shell init first, then view init)
    - Extract entity value from URL query parameter specified by `moduleConfig.entityParam`
    - Redirect to module index if entity param is missing
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 14.1, 14.2, 14.3, 14.4, 14.5_
  - [ ]* 3.2 Write property tests for shell merge, navigation, and event bus
    - **Property 1: Shell merge completeness**
    - **Property 2: Entity extraction from URL**
    - **Property 4: Navigation URL construction**
    - **Property 11: Event bus delivery**
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.11, 14.1**
  - [ ]* 3.3 Write property test for deep copy
    - **Property 8: Deep copy prevents reference sharing**
    - **Validates: Requirements 4.3, 13.3**

- [x] 4. Checkpoint - Verify shared modules
  - Ensure `_utils.js`, `_module-config.js`, and `_shell.js` are created and all tests pass. Ask the user if questions arise.

- [x] 5. Create quantitative analysis page
  - [x] 5.1 Create `public/app/deals/quantitative.html` with its own Alpine component
    - Include `_module-config.js`, `/app/_shell.js`, `/app/_utils.js`, design-system CSS, filing-notifications CSS
    - Page-specific state: `loading`, `years`, `data`, `retryCount`, `maxRetries`
    - Page-specific methods: `loadFinancialData()`, `retryLoadData()` with exponential backoff
    - Copy quantitative HTML template from workspace.html (the `analysisTab === 'quantitative'` section)
    - Include nav bar, breadcrumbs (using `breadcrumbItems`), and sidebar HTML with shell data bindings (grouped sidebar from module config)
    - Use `FundLensUtils.deepCopy()` when assigning API responses
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 1.8, 1.9, 1.10, 13.1_
  - [ ]* 5.2 Write property test for page state isolation
    - **Property 7: Page state isolation** (test quantitative page does not contain research/memo/scratchpad state)
    - **Validates: Requirements 4.2, 13.1**

- [x] 6. Create qualitative analysis page
  - [x] 6.1 Create `public/app/deals/qualitative.html` with its own Alpine component
    - Page-specific state: `loadingQualitative`, `refreshingQualitative`, `refreshQualitativeStatus`, `qualitativeData`, `qualitativeHasData`, `_autoTriggerFired`, `_qualitativeSectionMeta`
    - Page-specific methods: `loadQualitativeData()`, `refreshQualitativeData()`, `autoTriggerQualitative()`, `_checkQualitativeData()`
    - Copy qualitative HTML template from workspace.html (the `analysisTab === 'qualitative'` section)
    - Include nav bar, breadcrumbs, and grouped sidebar
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 7. Create export wizard page
  - [x] 7.1 Create `public/app/deals/export.html` with its own Alpine component
    - Page-specific state: `exportStep`, `exportSelectedYear`, `exportFilingType`, `availablePeriods`, `selectedYears`, `selectedQuarterYear`, `selectedQuarters`, `selectedStatements`, `includeCalculatedMetrics`, `exportLoading`, `exportError`
    - Page-specific methods: `loadAvailablePeriods()`, `selectYear()`, `selectFilingType()`, `exportToExcel()`, `resetExport()`
    - Copy export wizard HTML from workspace.html (the `analysisTab === 'export'` section)
    - Include nav bar, breadcrumbs, and grouped sidebar
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 8. Create provocations page
  - [x] 8.1 Create `public/app/deals/provocations.html` with its own Alpine component
    - Page-specific state: `provocationsData`, `provocationsLoading`, `provocationsMode`, `sentimentData`, `presetQuestions`
    - Page-specific methods: `loadProvocations()`, `toggleProvocationsMode()`, `loadPresetQuestions()`, `askProvocationInResearch()`, `saveProvocationToScratchpad()`
    - `askProvocationInResearch()` uses `navigateToWithParams('research', { query: encodedQuestion })`
    - Copy provocations HTML from workspace.html (the `analysisTab === 'provocations'` section)
    - Include nav bar, breadcrumbs, and grouped sidebar
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 9. Checkpoint - Verify analysis and tools pages
  - Ensure quantitative, qualitative, export, and provocations pages render correctly with consistent nav bar, breadcrumbs, and grouped sidebar. Ask the user if questions arise.

- [x] 10. Create research assistant page
  - [x] 10.1 Create `public/app/deals/research.html` with its own Alpine component
    - Include `instant-rag.css` in addition to shared CSS
    - Include `marked.min.js` and `highlight.js` for markdown rendering
    - Page-specific state: all research state (messages, input, typing, conversationId, notebookId), provocations mode state, settings modal state, source modal/citation state, all Instant RAG state
    - Page-specific methods: `sendMessage()`, `handleSSEStream()`, `renderMarkdown()`, `toggleProvocationsMode()`, `getEffectiveSystemPrompt()`, all Instant RAG methods (upload, session management, timer), citation handling methods, settings methods
    - On init: check for `?query=` URL param and auto-populate input
    - Copy research HTML from workspace.html (the `currentView === 'research'` section)
    - Include nav bar, breadcrumbs, and grouped sidebar
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [ ]* 10.2 Write property test for query parameter auto-populate
    - **Property 10: Query parameter auto-populate**
    - **Validates: Requirements 8.4**

- [x] 11. Create scratchpad page
  - [x] 11.1 Create `public/app/deals/scratchpad.html` with its own Alpine component
    - Include `research-scratchpad.css` in addition to shared CSS
    - Page-specific state: `scratchpadItems`, `scratchpadCount`, `scratchpadScrolled`
    - Page-specific methods: `loadScratchpad()`, `deleteScratchpadItem()`, `addToReport()`, `goToResearch()`
    - `addToReport()` uses `navigateTo('ic-memo')`
    - `goToResearch()` uses `navigateTo('research')`
    - After delete, emit `shellEmit('scratchpad:countChanged', newCount)` to update sidebar badge
    - Copy scratchpad HTML from workspace.html (the `currentView === 'scratchpad'` section)
    - Include nav bar, breadcrumbs, and grouped sidebar
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 12. Create IC Memo page
  - [x] 12.1 Create `public/app/deals/ic-memo.html` with its own Alpine component
    - Include `ic-memo.css` in addition to shared CSS
    - Include `marked.min.js` for markdown rendering
    - Page-specific state: `memoGenerated`, `memoGenerating`, `memoContent`, `scratchpadItems`
    - Page-specific methods: `loadScratchpadForMemo()`, `generateMemo()`, `handleMemoSSEStream()`, `copyMemoToClipboard()`, `downloadMemo()`
    - Copy IC Memo HTML from workspace.html (the `currentView === 'ic-memo'` section)
    - Include nav bar, breadcrumbs, and grouped sidebar
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 13. Create redirect hub and update workspace.html
  - [x] 13.1 Replace `public/app/deals/workspace.html` with a minimal redirect script
    - Map hash fragments to new pages: `''`/`'analysis'` → `quantitative.html`, `'research'` → `research.html`, `'scratchpad'` → `scratchpad.html`, `'ic-memo'` → `ic-memo.html`
    - Preserve ALL query parameters in redirect URL (not just ticker)
    - Use `window.location.replace()` for clean redirect (no back-button loop)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_
  - [ ]* 13.2 Write property test for redirect mapping
    - **Property 9: Redirect mapping correctness**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.7**
  - [ ]* 13.3 Write unit tests for redirect edge cases
    - Test unknown hash defaults to quantitative, missing ticker, special characters in ticker, extra query params preserved
    - _Requirements: 11.1, 11.5, 11.7_

- [x] 14. Wire cross-page interactions
  - [x] 14.1 Implement "Save to Scratchpad" API calls on Research and Provocations pages
    - Both pages call `POST /api/research/scratchpad/:ticker` and show toast confirmation
    - After save, call `this.loadScratchpadCount()` to update sidebar badge and emit event
    - _Requirements: 12.1, 12.2_
  - [x] 14.2 Verify sidebar scratchpad count badge loads on all pages
    - Shell's `loadScratchpadCount()` fetches count on every page init
    - Badge displays in sidebar next to Scratchpad nav item via `item.badge` config
    - _Requirements: 12.3_
  - [ ]* 14.3 Write property test for breadcrumb generation
    - **Property 3: Breadcrumb generation**
    - **Validates: Requirements 1.9**

- [x] 15. Final checkpoint - Full regression verification
  - Verify all 7 pages render with consistent nav bar, breadcrumbs, and grouped sidebar
  - Verify keyboard shortcuts (⌘1-7) navigate correctly
  - Verify cross-page workflows: Provocations → Ask in Research, Research → Save to Scratchpad, Scratchpad → Add to Report
  - Verify workspace.html redirect hub works for all hash variants
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The nav bar, sidebar, and breadcrumbs HTML is duplicated in each page file (no build step means no partials), but all dynamic behavior is driven by shell state and module config
- The sidebar uses collapsible groups (Analysis, Tools, Research) to preserve the current UX grouping
- `_shell.js` and `_utils.js` live at `public/app/` (module-agnostic), while `_module-config.js` lives inside each module directory
- Property tests use fast-check with minimum 100 iterations
- Unit tests use Jest
- The original workspace.html is preserved as a redirect hub, so no bookmarks break
