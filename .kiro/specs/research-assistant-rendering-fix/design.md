# Research Assistant Rendering Fix - Bugfix Design

## Overview

The research assistant page (research.html) has 7 critical defects preventing proper functionality: Alpine.js initialization syntax error, broken citation rendering, non-rendering charts, poor markdown formatting, missing API endpoints, and console errors. This bugfix systematically addresses each defect using minimal, targeted changes to restore full functionality without disrupting existing features like streaming responses, provocations mode, sentiment analysis, instant RAG, and scratchpad integration.

## Glossary

- **Bug_Condition (C)**: The set of conditions that trigger each of the 7 defects
- **Property (P)**: The desired correct behavior for each defect
- **Preservation**: All existing functionality (streaming, modes, instant RAG, scratchpad) that must remain unchanged
- **Alpine.js**: Frontend reactive framework used for state management in research.html
- **SSE (Server-Sent Events)**: Streaming protocol used for real-time message delivery
- **Citation**: Clickable reference link [1], [2], etc. that opens source modal with filing/document details
- **Chart.js**: Visualization library for rendering comparison charts
- **Markdown**: Text formatting syntax used for response rendering
- **Instant RAG**: Document upload feature for Q&A on user-uploaded files

## Bug Details

### Fault Condition

The bugs manifest across 7 distinct conditions:

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type PageLoadEvent | ConversationLoadEvent | QueryEvent | APIRequestEvent
  OUTPUT: boolean
  
  RETURN (
    // Defect 1: Alpine.js syntax error
    (input.type === 'PageLoad' AND input.hasInvalidAlpineInit) OR
    
    // Defect 2: Citations not rendering
    (input.type === 'ConversationLoad' AND input.conversationId === '21f572ba-1c7c-4eb0-8fea-d7ec700b9a55' 
     AND input.hasCitations AND NOT input.citationsRendered) OR
    
    // Defect 3: Charts not rendering
    (input.type === 'QueryResponse' AND input.hasVisualizationData 
     AND NOT input.chartRendered) OR
    
    // Defect 4: Markdown formatting broken
    (input.type === 'MessageDisplay' AND input.hasMarkdown 
     AND input.formattingPoor) OR
    
    // Defect 5: Messages endpoint 404
    (input.type === 'APIRequest' AND input.endpoint === '/api/research/conversations/{id}/messages' 
     AND input.method === 'GET' AND input.statusCode === 404) OR
    
    // Defect 6: Scratchpad endpoint 500
    (input.type === 'APIRequest' AND input.endpoint === '/api/research/scratchpad/{ticker}' 
     AND input.statusCode === 500) OR
    
    // Defect 7: Favicon 404
    (input.type === 'PageLoad' AND input.faviconMissing)
  )
END FUNCTION
```

### Examples

**Defect 1 - Alpine.js Syntax Error:**
- Current: `x-init="try { await init() }"` on line 691 throws "Unexpected token 'try'" error
- Expected: Valid Alpine.js initialization without syntax errors
- Root Cause: Invalid JavaScript syntax in x-init attribute (try/catch not allowed in inline expressions)

**Defect 2 - Citations Not Rendering:**
- Current: Conversation 21f572ba-1c7c-4eb0-8fea-d7ec700b9a55 has citations in data but displays plain text instead of clickable [1], [2] links
- Expected: Citations render as `<a href="#" class="citation-link citation-sec" data-citation-num="1">[1]</a>`
- Root Cause: `renderMarkdownWithCitations()` function incomplete (line 390 truncated with "retur")

**Defect 3 - Charts Not Rendering:**
- Current: Query "AMZN vs MSFT revenue FY2024" returns visualization data but canvas remains empty
- Expected: Chart.js renders bar/line chart with comparison data
- Root Cause: `renderChart()` function may have timing issues or canvas element not found

**Defect 4 - Markdown Formatting:**
- Current: Responses display with poor formatting, broken tables, missing line breaks
- Expected: Proper rendering of tables, code blocks, lists, paragraphs with correct spacing
- Root Cause: `renderMarkdown()` function has complex table parsing logic that may be failing

**Defect 5 - Messages Endpoint 404:**
- Current: `GET /api/research/conversations/{id}/messages` returns 404
- Expected: Returns 200 with array of messages for the conversation
- Root Cause: Backend controller only has POST endpoint for sending messages, missing GET endpoint for loading history

**Defect 6 - Scratchpad Endpoint 500:**
- Current: `GET /api/research/scratchpad/{ticker}` returns 500 error
- Expected: Returns 200 with scratchpad data or gracefully handles missing data
- Root Cause: Endpoint may not exist or has unhandled error condition

**Defect 7 - Favicon 404:**
- Current: Browser console shows 404 for /favicon.ico
- Expected: No 404 errors in console
- Root Cause: Missing favicon file or missing `<link rel="icon">` tag in HTML head

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Streaming responses via SSE must continue to work with token-by-token delivery
- Provocations mode must continue to apply adversarial research analyst system prompt
- Sentiment mode must continue to apply sentiment analysis system prompt
- Instant RAG document upload and Q&A must continue to function
- Scratchpad save functionality must continue to work
- Navigation between workspace pages must maintain authentication
- Markdown table rendering must continue to work
- Severity badge conversion (RED FLAG, AMBER, GREEN CHALLENGE) must continue to work

**Scope:**
All inputs that do NOT trigger the 7 specific bug conditions should be completely unaffected by this fix. This includes:
- New research queries and streaming responses
- Mode toggles (provocations, sentiment)
- Document uploads and instant RAG queries
- Scratchpad interactions
- Settings modal and system prompt customization
- Peer comparison displays
- Source modal interactions

## Hypothesized Root Cause

Based on the bug description and code analysis, the most likely issues are:

1. **Alpine.js Syntax Error (Defect 1)**: The `x-init` attribute on line 691 uses invalid syntax `try { await init() }`. Alpine.js x-init does not support try/catch blocks in inline expressions. The correct syntax should be `x-init="init()" with error handling inside the init() function itself.

2. **Citations Not Rendering (Defect 2)**: The `renderMarkdownWithCitations()` function at line 390 is truncated with "retur" instead of "return", indicating incomplete code. The function should return the markdown with citation links replaced, but the return statement is missing or malformed.

3. **Charts Not Rendering (Defect 3)**: The `renderChart()` function may have timing issues where the canvas element is not yet in the DOM when Chart.js tries to render. The function uses `$nextTick()` but may need additional checks or retry logic. Also, the canvas visibility logic uses inline styles which may conflict with Alpine.js reactivity.

4. **Markdown Formatting (Defect 4)**: The `renderMarkdown()` function has complex table parsing logic that may be failing on certain table formats. The function also has line break conversion logic that may be too aggressive or not aggressive enough.

5. **Messages Endpoint 404 (Defect 5)**: The backend `ResearchAssistantController` only defines `POST /api/research/conversations/:id/messages` for sending messages (line 128-175), but does NOT define a `GET` endpoint for loading message history. The frontend calls `GET /api/research/conversations/{id}/messages` in `loadConversationHistory()` but this endpoint doesn't exist.

6. **Scratchpad Endpoint 500 (Defect 6)**: The endpoint `/api/research/scratchpad/{ticker}` is referenced in the frontend but may not exist in the backend, or may have unhandled error conditions when no scratchpad data exists for a ticker.

7. **Favicon 404 (Defect 7)**: The HTML head section does not include a `<link rel="icon">` tag, and no favicon.ico file exists in the public directory. Browsers automatically request /favicon.ico if no icon is specified.

## Correctness Properties

Property 1: Fault Condition - Alpine.js Initialization

_For any_ page load event where the research.html page is loaded, the Alpine.js framework SHALL initialize without syntax errors, and the init() function SHALL execute successfully, enabling all reactive features.

**Validates: Requirements 2.1**

Property 2: Fault Condition - Citation Rendering

_For any_ conversation load event where the conversation contains citations in the message data, the citations SHALL render as clickable links with [1], [2], etc. notation that open the source modal when clicked, displaying the correct filing/document metadata.

**Validates: Requirements 2.2**

Property 3: Fault Condition - Chart Rendering

_For any_ query response event where the response contains visualization data (datasets, labels, chartType), the Chart.js library SHALL render the chart on the canvas element with proper styling, legends, and tooltips.

**Validates: Requirements 2.3**

Property 4: Fault Condition - Markdown Formatting

_For any_ message display event where the message content contains markdown syntax (tables, code blocks, lists, paragraphs), the marked.js library SHALL render the markdown with proper HTML structure, spacing, and styling.

**Validates: Requirements 2.4**

Property 5: Fault Condition - Messages Endpoint

_For any_ API request to GET /api/research/conversations/{id}/messages, the backend SHALL return HTTP 200 with a JSON array of message objects containing id, role, content, sources, citations, visualization, and peerComparison fields.

**Validates: Requirements 2.5**

Property 6: Fault Condition - Scratchpad Endpoint

_For any_ API request to GET /api/research/scratchpad/{ticker}, the backend SHALL return HTTP 200 with scratchpad data if it exists, or return HTTP 200 with an empty array if no data exists, gracefully handling the missing data case.

**Validates: Requirements 2.6**

Property 7: Fault Condition - Favicon

_For any_ page load event, the browser SHALL NOT generate a 404 error for favicon.ico, either by serving a valid favicon file or by specifying a favicon link in the HTML head.

**Validates: Requirements 2.7**

Property 8: Preservation - Streaming Responses

_For any_ new research query submitted by the user, the system SHALL continue to stream responses via SSE with token-by-token delivery, exactly as it did before the fix.

**Validates: Requirements 3.1**

Property 9: Preservation - Mode Functionality

_For any_ user interaction with provocations or sentiment mode toggles, the system SHALL continue to apply the correct system prompts and display preset questions, exactly as it did before the fix.

**Validates: Requirements 3.2, 3.3**

Property 10: Preservation - Instant RAG

_For any_ document upload and instant RAG query, the system SHALL continue to process documents and enable document-based Q&A, exactly as it did before the fix.

**Validates: Requirements 3.4**

Property 11: Preservation - Scratchpad Save

_For any_ user action to save a message to scratchpad, the system SHALL continue to save insights to the notebook, exactly as it did before the fix.

**Validates: Requirements 3.5**

Property 12: Preservation - Navigation and Auth

_For any_ navigation between workspace pages, the system SHALL continue to maintain authentication state and context, exactly as it did before the fix.

**Validates: Requirements 3.6**

Property 13: Preservation - Table and Badge Rendering

_For any_ response containing markdown tables or severity badges, the system SHALL continue to render them with proper HTML structure and styling, exactly as it did before the fix.

**Validates: Requirements 3.7, 3.8**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `public/app/deals/research.html`

**Function**: Alpine.js initialization (line 691)

**Specific Changes**:
1. **Fix Alpine.js Syntax Error**: Change `x-init="try { await init() } catch(e) { console.error('Init error:', e) }"` to `x-init="init()"` and move error handling inside the init() function itself
   - Remove try/catch from inline x-init attribute
   - Add try/catch inside the init() function definition (around line 103)

2. **Fix Citation Rendering**: Complete the `renderMarkdownWithCitations()` function (line 390)
   - The function is truncated with "retur" - complete the return statement
   - Ensure the function returns `this.renderMarkdown(content)` when no citations exist
   - Ensure citation replacement regex works correctly

3. **Fix Chart Rendering**: Improve `renderChart()` function timing and error handling
   - Add retry logic if canvas element not found on first attempt
   - Add console logging to debug chart rendering failures
   - Ensure canvas visibility logic works with Alpine.js reactivity
   - Verify Chart.js is loaded before attempting to render

4. **Fix Markdown Formatting**: Review and test `renderMarkdown()` function
   - Test table parsing logic with various table formats
   - Ensure line break conversion doesn't break code blocks
   - Verify marked.js configuration is correct

**File**: `src/research/research-assistant.controller.ts`

**Function**: Add GET messages endpoint

**Specific Changes**:
5. **Add Messages GET Endpoint**: Create new endpoint to load conversation message history
   - Add `@Get('conversations/:id/messages')` decorator
   - Call `researchService.getConversationMessages(conversationId)` 
   - Return messages in format: `{ success: true, data: messages }`
   - Ensure messages include all fields: id, role, content, sources, citations, visualization, peerComparison

**File**: `src/research/research-assistant.service.ts`

**Function**: Add getConversationMessages method

**Specific Changes**:
6. **Implement getConversationMessages**: Add service method to fetch messages from database
   - Query messages table filtered by conversationId and tenantId
   - Order by createdAt ascending
   - Parse JSON fields (sources, citations, visualization, peerComparison)
   - Return array of message objects

**File**: `src/research/notebook.service.ts` or create new scratchpad controller

**Function**: Add or fix scratchpad GET endpoint

**Specific Changes**:
7. **Fix Scratchpad Endpoint**: Ensure `/api/research/scratchpad/{ticker}` endpoint exists and handles missing data gracefully
   - If endpoint doesn't exist, create it
   - Return empty array or null when no scratchpad data exists (don't throw 500 error)
   - Add try/catch to handle database errors gracefully

**File**: `public/app/deals/research.html`

**Function**: HTML head section

**Specific Changes**:
8. **Add Favicon**: Add favicon link to HTML head or create favicon.ico file
   - Option A: Add `<link rel="icon" href="/fundlens-logo.png" type="image/png">` to head
   - Option B: Create a favicon.ico file in public directory
   - Option A is simpler and reuses existing logo

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate each bug on unfixed code, then verify each fix works correctly and preserves existing behavior.

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate each of the 7 bugs BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that trigger each bug condition and observe the failures on UNFIXED code to understand the root causes.

**Test Cases**:
1. **Alpine.js Init Test**: Load research.html and check browser console for "Unexpected token 'try'" error (will fail on unfixed code)
2. **Citation Rendering Test**: Load conversation 21f572ba-1c7c-4eb0-8fea-d7ec700b9a55 and verify citations are plain text, not clickable links (will fail on unfixed code)
3. **Chart Rendering Test**: Send query "AMZN vs MSFT revenue FY2024" and verify canvas remains empty despite visualization data (will fail on unfixed code)
4. **Markdown Formatting Test**: Send query that returns tables and verify poor formatting (will fail on unfixed code)
5. **Messages Endpoint Test**: Call GET /api/research/conversations/{id}/messages and verify 404 response (will fail on unfixed code)
6. **Scratchpad Endpoint Test**: Call GET /api/research/scratchpad/AAPL and verify 500 response (will fail on unfixed code)
7. **Favicon Test**: Load research.html and check browser console for favicon.ico 404 error (will fail on unfixed code)

**Expected Counterexamples**:
- Alpine.js throws syntax error on page load
- Citations display as plain text [1], [2] instead of clickable links
- Charts don't render despite visualization data being present
- Markdown tables have broken formatting
- GET messages endpoint returns 404
- GET scratchpad endpoint returns 500
- Browser console shows favicon 404 error

### Fix Checking

**Goal**: Verify that for all inputs where each bug condition holds, the fixed code produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedCode(input)
  ASSERT expectedBehavior(result)
END FOR
```

**Test Cases**:
1. **Alpine.js Init Fix**: Load research.html and verify no console errors, Alpine.js initializes successfully
2. **Citation Rendering Fix**: Load conversation with citations and verify clickable [1], [2] links that open source modal
3. **Chart Rendering Fix**: Send comparison query and verify Chart.js renders visualization with proper styling
4. **Markdown Formatting Fix**: Send query with tables and verify proper HTML table structure with borders and spacing
5. **Messages Endpoint Fix**: Call GET /api/research/conversations/{id}/messages and verify 200 response with message array
6. **Scratchpad Endpoint Fix**: Call GET /api/research/scratchpad/AAPL and verify 200 response (empty array if no data)
7. **Favicon Fix**: Load research.html and verify no 404 errors in browser console

### Preservation Checking

**Goal**: Verify that for all inputs where the bug conditions do NOT hold, the fixed code produces the same result as the original code.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalCode(input) = fixedCode(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-buggy scenarios, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Streaming Preservation**: Send new research query and verify SSE streaming works exactly as before
2. **Provocations Mode Preservation**: Toggle provocations mode and verify system prompt and preset questions work exactly as before
3. **Sentiment Mode Preservation**: Toggle sentiment mode and verify system prompt works exactly as before
4. **Instant RAG Preservation**: Upload document and send instant RAG query, verify processing works exactly as before
5. **Scratchpad Save Preservation**: Save message to scratchpad and verify it saves to notebook exactly as before
6. **Navigation Preservation**: Navigate between workspace pages and verify auth and context maintained exactly as before
7. **Table Rendering Preservation**: Send query with markdown table and verify HTML table structure exactly as before
8. **Badge Rendering Preservation**: Send query with RED FLAG, AMBER, GREEN CHALLENGE and verify badge styling exactly as before

### Unit Tests

- Test Alpine.js initialization without syntax errors
- Test citation link generation with various citation formats
- Test Chart.js rendering with different chart types (bar, line, grouped)
- Test markdown rendering with tables, code blocks, lists, paragraphs
- Test GET messages endpoint returns correct data structure
- Test GET scratchpad endpoint handles missing data gracefully
- Test favicon link exists in HTML head

### Property-Based Tests

- Generate random conversation IDs and verify messages endpoint returns valid data or 404 for non-existent conversations
- Generate random ticker symbols and verify scratchpad endpoint returns valid data or empty array
- Generate random markdown content and verify rendering produces valid HTML
- Generate random visualization payloads and verify Chart.js renders without errors
- Generate random citation arrays and verify all citations become clickable links

### Integration Tests

- Test full research flow: load page → send query → receive streaming response → render markdown with citations → click citation → view source modal
- Test chart rendering flow: send comparison query → receive visualization data → render chart → verify chart displays correctly
- Test conversation history flow: create conversation → send messages → reload page → load conversation history → verify all messages display correctly
- Test instant RAG flow: upload document → send query → receive response with citations → verify citations link to uploaded document
- Test mode switching flow: toggle provocations mode → send query → verify provocations system prompt applied → toggle off → verify default prompt restored
