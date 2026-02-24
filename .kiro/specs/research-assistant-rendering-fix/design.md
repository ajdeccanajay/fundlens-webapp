# Research Assistant Rendering Fix - Bugfix Design

## Overview

The research assistant fails to render charts, citations, and properly formatted markdown tables when processing multi-ticker comparison queries (e.g., "AAPL vs MSFT revenue FY 2023 - 2024"). The root causes span four critical areas: SSE event serialization in the NestJS controller, citation generation logic for structured-only queries, frontend chart rendering timing with Alpine.js, and markdown table parsing during streaming. This bugfix applies minimal, targeted changes to restore full visualization and citation functionality without disrupting existing streaming, mode switching, or instant RAG features.

## Glossary

- **Bug_Condition (C)**: The set of conditions that trigger rendering failures for charts, citations, and markdown tables
- **Property (P)**: The desired correct behavior for SSE event delivery, citation generation, chart rendering, and markdown formatting
- **Preservation**: All existing functionality (streaming responses, semantic retrieval, single-ticker queries, non-table markdown) that must remain unchanged
- **SSE (Server-Sent Events)**: Streaming protocol requiring `event: type\ndata: payload\n\n` format for proper frontend parsing
- **@Sse() Decorator**: NestJS decorator designed for GET endpoints that may not properly serialize event types on POST endpoints
- **Structured Query**: Intent-detected query requesting numeric metrics without semantic retrieval (no narratives array)
- **Metric Citations**: Citations generated from metric filing metadata when no narrative chunks are available
- **Alpine.js**: Frontend reactive framework that uses microtasks for DOM updates, causing timing issues with immediate canvas rendering
- **Markdown Breakpoint**: Logic that determines when to flush accumulated streaming content for rendering
- **Table Separator Row**: The `|---|---|` row in markdown tables that must arrive before flushing to prevent broken table rendering

## Bug Details

### Fault Condition

The bug manifests when multi-ticker comparison queries are processed, spanning four distinct failure modes:

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type QueryEvent | SSEStreamEvent | CanvasRenderEvent | MarkdownStreamEvent
  OUTPUT: boolean
  
  RETURN (
    // Defect 1: SSE event type not serialized
    (input.type === 'SSEStream' AND input.hasEventType 
     AND input.serializedFormat NOT CONTAINS 'event: ' + input.eventType) OR
    
    // Defect 2: No citations for structured-only queries
    (input.type === 'QueryEvent' AND input.intentType === 'structured' 
     AND input.narratives.length === 0 AND input.metrics.length > 0
     AND input.citations.length === 0) OR
    
    // Defect 3: Chart canvas not visible when renderChart called
    (input.type === 'CanvasRender' AND input.hasVisualizationData
     AND input.canvasElement.offsetHeight === 0) OR
    
    // Defect 4: Markdown table flushed mid-structure
    (input.type === 'MarkdownStream' AND input.content.endsWith('|')
     AND NOT input.content.contains('|---|') 
     AND input.flushTriggered === true)
  )
END FUNCTION
```

### Examples

**Defect 1 - SSE Event Serialization:**
- Current: Backend sends `data: {"chartType":"line",...}\n\ndata: {"citations":[...]}\n\n` without event type prefixes
- Expected: Backend sends `event: visualization\ndata: {"chartType":"line",...}\n\nevent: citations\ndata: {"citations":[...]}\n\n`
- Root Cause: `@Sse()` decorator on POST endpoint doesn't properly serialize MessageEvent.type field as SSE `event:` line
- Impact: Frontend SSE parser never sets `currentEvent` variable, so all `if (currentEvent === 'visualization')` branches are skipped

**Defect 2 - Metric Citations Missing:**
- Current: Query "AAPL vs MSFT revenue FY 2023 - 2024" returns metrics but `citations = []` because `narratives = []`
- Expected: Citations generated from metric filing metadata: `[{number: 1, ticker: 'AAPL', filingType: '10-K', fiscalPeriod: 'FY2023', ...}]`, with `formatValue()` helper formatting large numbers (e.g., 1000000000 → "1.0B"), and source reference section appended when no citation markers exist
- Root Cause: `extractCitations()` only processes narratives array, ignoring metric metadata even when metrics contain filing information
- Impact: No clickable [1], [2] citation links in response, no source attribution for structured data

**Defect 3 - Chart Rendering Timing:**
- Current: `renderChart()` called in `$nextTick` but canvas still has `height:0` from Alpine's previous style, Chart.js fails silently
- Expected: Chart renders after canvas becomes visible with proper dimensions
- Root Cause: Alpine.js uses microtasks for reactivity, `$nextTick` fires before DOM style propagation, MutationObserver fallback fails if message container doesn't exist yet
- Impact: Visualization data arrives but chart never displays, canvas remains empty

**Defect 4 - Markdown Table Flushing:**
- Current: Table row `| Metric | AAPL | MSFT |` triggers flush because line ends with `|`, but separator row `|---|---|` hasn't arrived yet
- Expected: Table flushed only after complete structure when text ends with `|\n\n` (table followed by double newline)
- Root Cause: `isMarkdownBreakpoint()` detects `|` at line end as sentence boundary, doesn't recognize mid-table state
- Impact: Broken table rendering with missing rows or malformed HTML structure

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Single-ticker queries must continue to render charts, citations, and markdown correctly
- Semantic retrieval with narrative chunks must continue to generate citations from narratives array
- Non-table markdown content (paragraphs, headers, lists, code blocks) must continue to flush at appropriate breakpoints
- Canvas elements that are immediately visible must continue to render charts without delay
- SSE streaming for token-by-token response delivery must continue to work
- Provocations mode, sentiment mode, and instant RAG must continue to function
- Scratchpad save functionality must continue to work

**Scope:**
All inputs that do NOT involve multi-ticker structured queries with charts and tables should be completely unaffected by this fix. This includes:
- Single-ticker queries with semantic retrieval
- Queries without visualization data
- Queries without markdown tables
- Instant RAG document-based queries
- Mode toggles and system prompt customization
- Navigation and authentication flows

## Hypothesized Root Cause

Based on the detailed fix specifications, the root causes are:

1. **SSE Event Serialization (Defect 1)**: The `@Sse()` decorator in NestJS is designed for `@Get()` endpoints using EventSource protocol. When applied to `@Post()` endpoints, NestJS may not properly serialize the `MessageEvent.type` field as the SSE `event:` line. The decorator expects Observable<MessageEvent> but the serialization logic doesn't consistently map the `type` property to the `event:` prefix in the SSE format. The frontend parser expects `event: visualization` followed by `data: {...}`, but receives only `data: {...}` lines, causing all event-specific handling to be skipped.

2. **Metric Citations Missing (Defect 2)**: For structured queries like "AAPL vs MSFT revenue FY 2023 - 2024", intent detection classifies the query as `type: "structured"` which bypasses semantic retrieval (no Bedrock KB call). This results in `narratives = []`. The `extractCitations()` function only processes the narratives array: `const idx = num - 1; if (idx >= 0 && idx < narratives.length)`. With empty narratives, no citations are extracted even though the metrics array contains filing metadata (ticker, filingType, fiscalPeriod). The system has the source information but doesn't format it as clickable citations.

3. **Chart Rendering Timing (Defect 3)**: The SSE event order is: source → citations → visualization → tokens → done. When the visualization event arrives, Alpine.js sets `message.visualization = payload` which triggers the template to change the canvas style from `height:0` to `min-height:200px`. The `renderChart()` call happens in `$nextTick()`, but Alpine.js uses microtasks for reactivity which may not have propagated to the DOM yet. The canvas check `if (canvas.offsetHeight > 0)` fails because the style hasn't updated. The MutationObserver fallback watches for the message container `[data-message-id="..."]` but if the message was just pushed to the array, the container may not exist yet, causing the observer to fail as well.

4. **Markdown Table Flushing (Defect 4)**: The `isMarkdownBreakpoint()` function flushes content at sentence boundaries, detecting patterns like `.\s+[A-Z]` or line endings. For markdown tables, the content arrives as: `| Metric | AAPL | MSFT |\n` followed by `|--------|------|------|\n` followed by data rows. The function detects the `|` at the end of the first line and triggers a flush before the separator row arrives. Without the separator row, the markdown parser can't recognize the table structure, resulting in broken rendering. The function doesn't distinguish between mid-table state and complete table state.

## Correctness Properties

Property 1: Fault Condition - SSE Event Type Serialization

_For any_ SSE stream event where the backend sends visualization or citation data with an explicit event type, the serialized SSE format SHALL include `event: {type}\n` before the `data: {payload}\n` line, enabling the frontend parser to distinguish event types and route data to the correct handlers.

**Validates: Requirements 2.1**

Property 2: Fault Condition - Metric Citation Generation

_For any_ structured query that returns metrics with filing metadata but no narrative chunks, the system SHALL generate citations from the metric metadata (ticker, filingType, fiscalPeriod) and format them as clickable citation objects with number, sourceType, excerpt, and relevanceScore fields.

**Validates: Requirements 2.2**

Property 3: Fault Condition - Chart Canvas Visibility

_For any_ visualization event where the chart data arrives before the canvas element is visible in the DOM, the system SHALL use a polling retry mechanism (20 attempts × 100ms) to wait for the canvas to become visible before calling Chart.js render, ensuring charts display correctly regardless of Alpine.js timing.

**Validates: Requirements 2.3**

Property 4: Fault Condition - Markdown Table Integrity

_For any_ markdown stream event where table content is being delivered, the system SHALL NOT flush at markdown breakpoints that occur within table structures (lines ending with `|`), and SHALL only flush when text ends with `|\n\n` (table followed by double newline), preserving table integrity during streaming.

**Validates: Requirements 2.4**

Property 5: Preservation - Single-Ticker Query Rendering

_For any_ single-ticker query with semantic retrieval, the system SHALL continue to render charts, citations, and markdown exactly as before the fix, with no changes to event handling, citation extraction, or rendering timing.

**Validates: Requirements 3.1**

Property 6: Preservation - Narrative Citation Extraction

_For any_ query where semantic retrieval returns narrative chunks, the system SHALL continue to generate citations from the narratives array exactly as before the fix, with no changes to the citation extraction logic.

**Validates: Requirements 3.2**

Property 7: Preservation - Non-Table Markdown Flushing

_For any_ markdown stream event containing non-table content (paragraphs, headers, lists, code blocks), the system SHALL continue to flush at appropriate breakpoints (double newlines, sentence boundaries) exactly as before the fix.

**Validates: Requirements 3.3**

Property 8: Preservation - Immediate Canvas Rendering

_For any_ visualization event where the canvas element is immediately visible (offsetHeight > 0 on first check), the system SHALL continue to render charts without delay exactly as before the fix.

**Validates: Requirements 3.4**

Property 9: Preservation - Generic SSE Events

_For any_ SSE event with `chunk.type === undefined`, the system SHALL continue to handle it gracefully by treating it as a generic data event for backward compatibility, exactly as before the fix.

**Validates: Requirements 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/research/research-assistant.controller.ts`

**Function**: `sendMessage()` (lines 150-170)

**Specific Changes**:
1. **Replace @Sse() with Manual SSE Streaming**: Remove `@Sse()` decorator and Observable pattern, replace with manual `res.write()` approach
   - Remove imports: `@Sse()`, `Sse`, `MessageEvent`, `Observable` from `@nestjs/common` and `rxjs`
   - Add imports: `@Res()` from `@nestjs/common`, `Response` from `express`
   - Change method signature to `async sendMessage(..., @Res() res: Response)`
   - Set SSE headers manually: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`
   - Replace `subscriber.next()` with `res.write(\`event: ${chunk.type}\ndata: ${JSON.stringify(chunk.data)}\n\n\`)`
   - Add done event: `res.write('event: done\ndata: {"complete":true}\n\n')` before `res.end()`
   - Add error handling: catch errors and send `event: error\ndata: {...}\n\n` before ending stream

**File**: `src/rag/rag.service.ts`

**Function**: Citation generation logic (around line 820)

**Specific Changes**:
2. **Generate Metric Citations for Structured Queries**: Add fallback citation generation from metrics when narratives array is empty
   - After building response object, check: `if ((!citations || citations.length === 0) && metrics.length > 0)`
   - Call new helper method: `const metricCitations = this.buildMetricCitations(metrics)`
   - If metricCitations has items, set `citations = metricCitations`
   - If answer doesn't contain `[1]` markers, append source reference section: `\n\n**Sources:**\n[1] AAPL 10-K FY2023\n[2] MSFT 10-K FY2023`

3. **Add buildMetricCitations Helper Method**: Create method to format metric metadata as citation objects
   - Input: `metrics: MetricResult[]`
   - Output: `Citation[]` with fields: number, citationNumber, type, sourceType, ticker, filingType, fiscalPeriod, section, excerpt, relevanceScore
   - Use Set to deduplicate by `${ticker}-${filingType}-${fiscalPeriod}` key
   - Format excerpt: `${rawLabel}: ${formatValue(value)} (${fiscalPeriod})`
   - Assign sequential citation numbers starting from 1

4. **Add formatValue Helper Method**: Create method to format large numbers with B/M/K suffixes
   - Input: `value: number`
   - Output: `string` formatted as currency with appropriate suffix
   - Logic: if abs(value) >= 1e9 return `${(value/1e9).toFixed(1)}B`, if >= 1e6 return `${(value/1e6).toFixed(1)}M`, if >= 1e3 return `${(value/1e3).toFixed(1)}K`, else return `${value.toFixed(2)}`

4. **Add formatValue Helper Method**: Create method to format large numbers with B/M/K suffixes
   - Input: `value: number`
   - Output: `string` formatted as currency with appropriate suffix
   - Logic: if abs(value) >= 1e9 return `${(value/1e9).toFixed(1)}B`, if >= 1e6 return `${(value/1e6).toFixed(1)}M`, if >= 1e3 return `${(value/1e3).toFixed(1)}K`, else return `${value.toFixed(2)}`

**File**: `public/app/deals/research.html`

**Function**: `renderChart()` (around line 450)

**Specific Changes**:
5. **Replace MutationObserver with Polling Retry Loop**: Change chart rendering timing strategy to be more robust
   - Remove MutationObserver logic and 5-second timeout
   - Add polling variables: `var attempts = 0; var maxAttempts = 20;`
   - Create `tryRender()` function that checks canvas visibility and increments attempts
   - If canvas visible (offsetHeight > 0 && offsetWidth > 0), call `doRender(canvas)` and return
   - If attempts < maxAttempts, call `setTimeout(tryRender, 100)` to retry after 100ms
   - If maxAttempts reached, log error: `Canvas never became visible after 20 attempts`
   - Start polling with initial delay: `setTimeout(tryRender, 50)` to let Alpine update DOM first
   - Keep existing `doRender()` function with Chart.js rendering logic unchanged

**File**: `public/app/deals/research.html`

**Function**: `isMarkdownBreakpoint()` (around line 380)

**Specific Changes**:
6. **Improve Table Detection Logic**: Prevent flushing mid-table by detecting table state
   - Add logic to find last non-empty line: iterate backwards through `text.split('\n')` to find `lastNonEmpty`
   - Check if inside table: `if (lastNonEmpty.startsWith('|') || lastNonEmpty.endsWith('|'))`
   - If inside table, only flush if text ends with `|\n\n` (table followed by double newline): `if (text.endsWith('|\n\n')) return true; else return false;`
   - Keep existing flush logic for non-table content: double newline, sentence boundary with lookahead
   - Increase safety valve from 200 to 300 chars to accommodate larger tables: `if (text.length - lastFlush > 300)`
   - Store last flush position: `this._lastMarkdownFlush = text.length`

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that trigger each bug condition and observe the failures on UNFIXED code to understand the root causes.

**Test Cases**:
1. **SSE Serialization Test**: Send query "AAPL vs MSFT revenue FY 2023 - 2024", inspect Network tab Response, verify only `data:` lines without `event:` prefixes (will fail on unfixed code)
2. **Metric Citations Test**: Send structured query, inspect response object, verify `citations = []` even though `metrics.length > 0` (will fail on unfixed code)
3. **Chart Timing Test**: Send comparison query, add console.log in renderChart, verify canvas.offsetHeight === 0 on first check (will fail on unfixed code)
4. **Table Flushing Test**: Send query that returns markdown table, observe DOM updates, verify table rows appear separately before separator row (will fail on unfixed code)

**Expected Counterexamples**:
- SSE stream contains only `data: {...}` lines without `event: visualization` or `event: citations` prefixes
- Structured queries return metrics with filing metadata but citations array is empty
- Chart rendering fails because canvas element has height 0 when Chart.js tries to render
- Markdown tables are flushed mid-structure, causing broken HTML table rendering

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedFunction(input)
  ASSERT expectedBehavior(result)
END FOR
```

**Test Cases**:
1. **SSE Serialization Fix**: Send comparison query, inspect Network tab, verify `event: visualization\ndata: {...}\n\nevent: citations\ndata: {...}\n\n` format
2. **Metric Citations Fix**: Send structured query, verify citations array populated from metric metadata with ticker, filingType, fiscalPeriod
3. **Chart Timing Fix**: Send comparison query, verify chart renders successfully after polling retry finds visible canvas
4. **Table Flushing Fix**: Send query with markdown table, verify table rendered as complete HTML structure with all rows and separator

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-buggy scenarios, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Single-Ticker Preservation**: Send single-ticker query with semantic retrieval, verify charts and citations render exactly as before
2. **Narrative Citations Preservation**: Send query that triggers semantic retrieval, verify citations extracted from narratives array exactly as before
3. **Non-Table Markdown Preservation**: Send query with paragraphs and lists, verify flushing at appropriate breakpoints exactly as before
4. **Immediate Canvas Preservation**: Send query where canvas is immediately visible, verify chart renders without delay exactly as before
5. **Generic SSE Events Preservation**: Send SSE events without explicit type field, verify processed as generic data events exactly as before

### Unit Tests

- Test SSE format with manual res.write() includes proper `event:` and `data:` lines
- Test buildMetricCitations() generates citation objects from metric metadata
- Test formatValue() formats numbers with B/M/K suffixes correctly
- Test polling retry loop finds canvas after Alpine.js DOM update
- Test isMarkdownBreakpoint() doesn't flush mid-table but flushes after complete table

### Property-Based Tests

- Generate random metric arrays and verify buildMetricCitations() produces valid citation objects
- Generate random markdown content with tables and verify flushing preserves table integrity
- Generate random visualization payloads and verify polling retry eventually renders chart
- Generate random SSE event types and verify proper serialization format

### Integration Tests

- Test full multi-ticker comparison flow: send query → receive SSE stream with proper event types → render chart → display citations → verify markdown table formatting
- Test structured query flow: send metric query → verify citations generated from metrics → verify clickable citation links → verify source modal displays filing metadata
- Test chart rendering flow: send visualization data → verify polling retry waits for canvas → verify Chart.js renders with proper styling and legends
- Test markdown streaming flow: send response with table → verify table not flushed mid-structure → verify complete table rendered with proper HTML
