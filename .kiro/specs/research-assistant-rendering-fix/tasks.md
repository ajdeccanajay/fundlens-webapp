# Implementation Plan - Research Assistant Rendering Fix

## Overview
This task list implements fixes for 7 critical defects in the research assistant page (research.html) using the bug condition methodology. Each defect has its own exploration test, and all defects share common preservation tests to ensure existing functionality remains intact.

---

## Phase 1: Bug Condition Exploration Tests (BEFORE Fix)

### 1.1 Alpine.js Initialization Bug Exploration

- [x] 1.1 Write bug condition exploration test - Alpine.js Syntax Error
  - **Property 1: Fault Condition** - Alpine.js Initialization Syntax Error
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the Alpine.js syntax error exists
  - **Scoped PBT Approach**: Test the specific x-init attribute on line 691 of research.html
  - Test that loading research.html does NOT produce "Unexpected token 'try'" console error
  - Test that Alpine.js initializes successfully and reactive features work
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: "x-init attribute contains invalid try/catch syntax causing Alpine.js initialization failure"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.1_

### 1.2 Citation Rendering Bug Exploration

- [x] 1.2 Write bug condition exploration test - Citations Not Rendering
  - **Property 1: Fault Condition** - Citation Links Not Rendering
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate citations render as plain text instead of clickable links
  - **Scoped PBT Approach**: Test conversation 21f572ba-1c7c-4eb0-8fea-d7ec700b9a55 which has citations
  - Test that citations render as `<a href="#" class="citation-link citation-sec" data-citation-num="1">[1]</a>`
  - Test that clicking citation opens source modal with correct filing metadata
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: "Citations display as plain text [1], [2] instead of clickable links due to incomplete renderMarkdownWithCitations() function"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.2_

### 1.3 Chart Rendering Bug Exploration

- [x] 1.3 Write bug condition exploration test - Charts Not Rendering
  - **Property 1: Fault Condition** - Chart.js Visualization Not Rendering
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate charts don't render despite visualization data being present
  - **Scoped PBT Approach**: Test query "AMZN vs MSFT revenue FY2024" which returns visualization data
  - Test that Chart.js renders bar/line chart on canvas element
  - Test that chart has proper styling, legends, and tooltips
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: "Canvas remains empty despite visualization data due to timing issues or missing canvas element in renderChart() function"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.3_

### 1.4 Markdown Formatting Bug Exploration

- [x] 1.4 Write bug condition exploration test - Markdown Formatting Broken
  - **Property 1: Fault Condition** - Poor Markdown Rendering Quality
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate markdown tables and formatting render poorly
  - **Scoped PBT Approach**: Test responses containing markdown tables, code blocks, lists, and paragraphs
  - Test that marked.js renders proper HTML structure with correct spacing and styling
  - Test that tables have borders, proper cell alignment, and readable formatting
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: "Tables display with broken formatting, missing line breaks, or incorrect HTML structure due to renderMarkdown() function issues"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.4_

### 1.5 Messages Endpoint Bug Exploration

- [x] 1.5 Write bug condition exploration test - Messages Endpoint 404
  - **Property 1: Fault Condition** - GET Messages Endpoint Missing
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate GET messages endpoint returns 404
  - **Scoped PBT Approach**: Test GET /api/research/conversations/{id}/messages for existing conversation IDs
  - Test that endpoint returns HTTP 200 with JSON array of message objects
  - Test that messages include all required fields: id, role, content, sources, citations, visualization, peerComparison
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: "GET /api/research/conversations/{id}/messages returns 404 because endpoint doesn't exist in ResearchAssistantController"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.5_

### 1.6 Scratchpad Endpoint Bug Exploration

- [x] 1.6 Write bug condition exploration test - Scratchpad Endpoint 500
  - **Property 1: Fault Condition** - Scratchpad Endpoint Error Handling
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate scratchpad endpoint returns 500 error
  - **Scoped PBT Approach**: Test GET /api/research/scratchpad/{ticker} for various ticker symbols
  - Test that endpoint returns HTTP 200 with scratchpad data or empty array (not 500 error)
  - Test that endpoint gracefully handles missing data without throwing exceptions
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: "GET /api/research/scratchpad/{ticker} returns 500 error due to missing endpoint or unhandled error condition"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.6_

### 1.7 Favicon Bug Exploration

- [x] 1.7 Write bug condition exploration test - Favicon 404 Error
  - **Property 1: Fault Condition** - Missing Favicon Configuration
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate browser generates 404 error for favicon
  - **Scoped PBT Approach**: Test page load of research.html and check browser console for 404 errors
  - Test that no 404 errors appear in browser console for favicon.ico
  - Test that HTML head contains valid favicon link or favicon.ico file exists
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: "Browser console shows 404 error for /favicon.ico due to missing favicon link in HTML head"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.7_

---

## Phase 2: Preservation Property Tests (BEFORE Fix)

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - All Existing Functionality Preserved
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs (all existing features that work correctly)
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 2.1 Test streaming responses preservation
    - Observe: New research queries stream responses via SSE with token-by-token delivery on unfixed code
    - Write property-based test: for all new research queries, responses stream correctly with SSE
    - Verify test passes on UNFIXED code
    - _Requirements: 3.1_

  - [x] 2.2 Test provocations mode preservation
    - Observe: Provocations mode toggle applies adversarial research analyst system prompt on unfixed code
    - Write property-based test: for all provocations mode activations, correct system prompt and preset questions display
    - Verify test passes on UNFIXED code
    - _Requirements: 3.2_

  - [x] 2.3 Test sentiment mode preservation
    - Observe: Sentiment mode toggle applies sentiment analysis system prompt on unfixed code
    - Write property-based test: for all sentiment mode activations, correct system prompt applies
    - Verify test passes on UNFIXED code
    - _Requirements: 3.3_

  - [x] 2.4 Test instant RAG preservation
    - Observe: Document upload and instant RAG queries work correctly on unfixed code
    - Write property-based test: for all document uploads and instant RAG queries, processing works correctly
    - Verify test passes on UNFIXED code
    - _Requirements: 3.4_

  - [x] 2.5 Test scratchpad save preservation
    - Observe: Saving messages to scratchpad works correctly on unfixed code
    - Write property-based test: for all scratchpad save actions, insights save to notebook correctly
    - Verify test passes on UNFIXED code
    - _Requirements: 3.5_

  - [x] 2.6 Test navigation and auth preservation
    - Observe: Navigation between workspace pages maintains authentication and context on unfixed code
    - Write property-based test: for all navigation actions, auth and context maintained correctly
    - Verify test passes on UNFIXED code
    - _Requirements: 3.6_

  - [x] 2.7 Test markdown table rendering preservation
    - Observe: Markdown tables render with proper HTML structure and styling on unfixed code
    - Write property-based test: for all responses with markdown tables, HTML structure renders correctly
    - Verify test passes on UNFIXED code
    - _Requirements: 3.7_

  - [x] 2.8 Test severity badge rendering preservation
    - Observe: Severity badges (RED FLAG, AMBER, GREEN CHALLENGE) render with correct styling on unfixed code
    - Write property-based test: for all responses with severity badges, badge styling applies correctly
    - Verify test passes on UNFIXED code
    - _Requirements: 3.8_

---

## Phase 3: Implementation

- [x] 3. Fix all 7 defects in research assistant rendering

  - [x] 3.1 Fix Alpine.js initialization syntax error
    - Change `x-init="try { await init() } catch(e) { console.error('Init error:', e) }"` to `x-init="init()"`
    - Move error handling inside the init() function definition (around line 103)
    - Add try/catch block inside init() function to handle errors gracefully
    - _Bug_Condition: isBugCondition(input) where input.type === 'PageLoad' AND input.hasInvalidAlpineInit_
    - _Expected_Behavior: Alpine.js initializes without syntax errors, reactive features work correctly_
    - _Preservation: All existing Alpine.js reactive features (streaming, modes, instant RAG) continue to work_
    - _Requirements: 2.1, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.2 Fix citation rendering
    - Complete the `renderMarkdownWithCitations()` function at line 390
    - Fix truncated "retur" to complete return statement
    - Ensure function returns `this.renderMarkdown(content)` when no citations exist
    - Ensure citation replacement regex creates proper `<a>` tags with citation-link class
    - _Bug_Condition: isBugCondition(input) where input.type === 'ConversationLoad' AND input.hasCitations AND NOT input.citationsRendered_
    - _Expected_Behavior: Citations render as clickable links [1], [2] that open source modal with filing metadata_
    - _Preservation: Existing source modal functionality and citation click handling continue to work_
    - _Requirements: 2.2_

  - [x] 3.3 Fix chart rendering
    - Improve `renderChart()` function timing and error handling
    - Add retry logic if canvas element not found on first attempt
    - Add console logging to debug chart rendering failures
    - Ensure canvas visibility logic works with Alpine.js reactivity
    - Verify Chart.js is loaded before attempting to render
    - _Bug_Condition: isBugCondition(input) where input.type === 'QueryResponse' AND input.hasVisualizationData AND NOT input.chartRendered_
    - _Expected_Behavior: Chart.js renders bar/line chart with proper styling, legends, and tooltips_
    - _Preservation: Existing peer comparison display functionality continues to work_
    - _Requirements: 2.3_

  - [x] 3.4 Fix markdown formatting
    - Review and test `renderMarkdown()` function
    - Test table parsing logic with various table formats
    - Ensure line break conversion doesn't break code blocks
    - Verify marked.js configuration is correct
    - _Bug_Condition: isBugCondition(input) where input.type === 'MessageDisplay' AND input.hasMarkdown AND input.formattingPoor_
    - _Expected_Behavior: Markdown renders with proper HTML structure, spacing, and styling for tables, code blocks, lists, paragraphs_
    - _Preservation: Existing markdown table rendering and severity badge conversion continue to work_
    - _Requirements: 2.4, 3.7, 3.8_

  - [x] 3.5 Add messages GET endpoint
    - Add `@Get('conversations/:id/messages')` decorator to ResearchAssistantController
    - Implement endpoint handler that calls `researchService.getConversationMessages(conversationId, tenantId)`
    - Return messages in format: `{ success: true, data: messages }`
    - Ensure messages include all fields: id, role, content, sources, citations, visualization, peerComparison
    - Add getConversationMessages method to ResearchAssistantService
    - Query messages table filtered by conversationId and tenantId
    - Order by createdAt ascending
    - Parse JSON fields (sources, citations, visualization, peerComparison)
    - Return array of message objects
    - _Bug_Condition: isBugCondition(input) where input.type === 'APIRequest' AND input.endpoint === '/api/research/conversations/{id}/messages' AND input.method === 'GET' AND input.statusCode === 404_
    - _Expected_Behavior: GET endpoint returns HTTP 200 with JSON array of message objects containing all required fields_
    - _Preservation: Existing POST messages endpoint for sending messages continues to work_
    - _Requirements: 2.5_

  - [x] 3.6 Fix scratchpad endpoint error handling
    - Verify `/api/research/scratchpad/{ticker}` endpoint exists in NotebookService or create it
    - Add graceful error handling for missing scratchpad data (return empty array or null, not 500 error)
    - Add try/catch to handle database errors gracefully
    - Return HTTP 200 with empty array when no scratchpad data exists for ticker
    - _Bug_Condition: isBugCondition(input) where input.type === 'APIRequest' AND input.endpoint === '/api/research/scratchpad/{ticker}' AND input.statusCode === 500_
    - _Expected_Behavior: GET endpoint returns HTTP 200 with scratchpad data or empty array, gracefully handling missing data_
    - _Preservation: Existing scratchpad save functionality continues to work_
    - _Requirements: 2.6, 3.5_

  - [x] 3.7 Add favicon to prevent 404 errors
    - Add `<link rel="icon" href="/fundlens-logo.png" type="image/png">` to HTML head section of research.html
    - Verify fundlens-logo.png exists in public directory
    - Alternative: Create favicon.ico file in public directory if logo doesn't exist
    - _Bug_Condition: isBugCondition(input) where input.type === 'PageLoad' AND input.faviconMissing_
    - _Expected_Behavior: No 404 errors in browser console for favicon_
    - _Preservation: No impact on existing functionality_
    - _Requirements: 2.7_

  - [x] 3.8 Verify Alpine.js initialization fix
    - **Property 1: Expected Behavior** - Alpine.js Initializes Successfully
    - **IMPORTANT**: Re-run the SAME test from task 1.1 - do NOT write a new test
    - The test from task 1.1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run Alpine.js initialization test from step 1.1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1_

  - [x] 3.9 Verify citation rendering fix
    - **Property 1: Expected Behavior** - Citations Render as Clickable Links
    - **IMPORTANT**: Re-run the SAME test from task 1.2 - do NOT write a new test
    - Run citation rendering test from step 1.2
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.2_

  - [x] 3.10 Verify chart rendering fix
    - **Property 1: Expected Behavior** - Charts Render with Chart.js
    - **IMPORTANT**: Re-run the SAME test from task 1.3 - do NOT write a new test
    - Run chart rendering test from step 1.3
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.3_

  - [x] 3.11 Verify markdown formatting fix
    - **Property 1: Expected Behavior** - Markdown Renders with Proper Formatting
    - **IMPORTANT**: Re-run the SAME test from task 1.4 - do NOT write a new test
    - Run markdown formatting test from step 1.4
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.4_

  - [x] 3.12 Verify messages endpoint fix
    - **Property 1: Expected Behavior** - Messages Endpoint Returns 200
    - **IMPORTANT**: Re-run the SAME test from task 1.5 - do NOT write a new test
    - Run messages endpoint test from step 1.5
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.5_

  - [x] 3.13 Verify scratchpad endpoint fix
    - **Property 1: Expected Behavior** - Scratchpad Endpoint Handles Missing Data Gracefully
    - **IMPORTANT**: Re-run the SAME test from task 1.6 - do NOT write a new test
    - Run scratchpad endpoint test from step 1.6
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.6_

  - [x] 3.14 Verify favicon fix
    - **Property 1: Expected Behavior** - No Favicon 404 Errors
    - **IMPORTANT**: Re-run the SAME test from task 1.7 - do NOT write a new test
    - Run favicon test from step 1.7
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.7_

  - [x] 3.15 Verify preservation tests still pass
    - **Property 2: Preservation** - All Existing Functionality Preserved
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run all preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all preservation tests still pass after fixes (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

---

## Phase 4: Checkpoint

- [x] 4. Checkpoint - Ensure all tests pass
  - Verify all 7 bug condition exploration tests now pass (tasks 1.1-1.7)
  - Verify all 8 preservation property tests still pass (task 2.1-2.8)
  - Run full integration test suite to confirm no regressions
  - Test full research flow: load page → send query → receive streaming response → render markdown with citations → click citation → view source modal
  - Test chart rendering flow: send comparison query → receive visualization data → render chart → verify chart displays correctly
  - Test conversation history flow: create conversation → send messages → reload page → load conversation history → verify all messages display correctly
  - Test instant RAG flow: upload document → send query → receive response with citations → verify citations link to uploaded document
  - Test mode switching flow: toggle provocations mode → send query → verify provocations system prompt applied → toggle off → verify default prompt restored
  - Ensure all tests pass, ask the user if questions arise

---

## Summary

This implementation plan follows the bugfix workflow methodology:

1. **Phase 1 (Tasks 1.1-1.7)**: Write 7 exploration tests that FAIL on unfixed code, confirming each bug exists
2. **Phase 2 (Task 2)**: Write preservation tests that PASS on unfixed code, capturing baseline behavior to preserve
3. **Phase 3 (Task 3)**: Implement all 7 fixes, then verify exploration tests now PASS and preservation tests still PASS
4. **Phase 4 (Task 4)**: Final checkpoint to ensure all tests pass and no regressions introduced

The fixes are minimal and targeted:
- Alpine.js: Remove try/catch from x-init attribute, move error handling inside init() function
- Citations: Complete truncated renderMarkdownWithCitations() function
- Charts: Add retry logic and error handling to renderChart() function
- Markdown: Review and test renderMarkdown() function with various formats
- Messages: Add GET endpoint to ResearchAssistantController and service method
- Scratchpad: Add graceful error handling for missing data
- Favicon: Add favicon link to HTML head

All existing functionality (streaming, modes, instant RAG, scratchpad, navigation, tables, badges) is preserved through property-based testing.
