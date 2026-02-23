# Design Document: Research Response Formatting Fix

## Overview

This design addresses three interconnected UX bugs in the FundLens Research Assistant response rendering pipeline. The root causes span the backend intent detection and response routing logic, the frontend Chart.js rendering lifecycle, and the markdown parsing during SSE streaming.

The fix involves three targeted changes:

1. **Backend**: Add a multi-ticker guard to `isQuickResponseEligible()` in `ResponseEnrichmentService` so that any query with 2+ tickers is routed through the LLM synthesis path (`HybridSynthesisService`). Also ensure the `IntentDetectorService` consistently sets `needsComparison: true` for multi-ticker queries.
2. **Frontend Chart Rendering**: Replace the single `$nextTick` call in `renderChart()` with a retry loop using `requestAnimationFrame` (max 3 attempts) to handle the Alpine.js reactivity delay where the canvas element may not be in the DOM when Chart.js tries to draw.
3. **Frontend Markdown**: Improve the streaming markdown rendering to buffer tokens at natural breakpoints before invoking `marked.js`, preventing partial-parse artifacts during SSE streaming.

## Architecture

The fix touches three layers of the existing architecture. No new services or modules are introduced.

```mermaid
flowchart TD
    A[User Query: AMZN vs MSFT revenue FY2024] --> B[IntentDetectorService]
    B -->|needsComparison=true, ticker=[ABNB,AMZN,MSFT]| C{isQuickResponseEligible?}
    C -->|false: multi-ticker or needsComparison| D[HybridSynthesisService / LLM Path]
    C -->|true: single ticker, simple lookup| E[Quick Response Path]
    D --> F[RAGResponse with analytical narrative]
    E --> G[RAGResponse with markdown table]
    F --> H[SSE Stream]
    G --> H
    H -->|visualization event| I[renderChart with retry loop]
    H -->|token events| J[Buffered markdown rendering]
    I --> K[Chart.js on canvas]
    J --> L[marked.js → x-html binding]

    style C fill:#fef3c7,stroke:#d97706
    style D fill:#d1fae5,stroke:#059669
    style I fill:#dbeafe,stroke:#1a56db
    style J fill:#dbeafe,stroke:#1a56db
```

## Components and Interfaces

### 1. ResponseEnrichmentService (Modified)

**File**: `src/rag/response-enrichment.service.ts`

**Change**: Update `isQuickResponseEligible()` to reject multi-ticker queries.

```typescript
isQuickResponseEligible(intent: QueryIntent): boolean {
  // Multi-ticker queries must always go through LLM synthesis
  const isMultiTicker = Array.isArray(intent.ticker) && intent.ticker.length > 1;

  return (
    !isMultiTicker &&
    intent.type === 'structured' &&
    intent.confidence > 0.85 &&
    !intent.needsNarrative &&
    !intent.needsTrend &&
    !intent.needsComparison &&
    !intent.needsComputation &&
    intent.periodType !== 'range'
  );
}
```

### 2. IntentDetectorService (Verification)

**File**: `src/rag/intent-detector.service.ts`

The `buildLowConfidenceIntent()` method already sets `needsComparison: Array.isArray(ticker) && ticker.length > 1` for multi-ticker regex fast-path results. The `resolveFromLlmResult()` method already sets `needsComparison = tickers.length > 1 || llmResult.needsComparison`. These are correct. The primary fix is in `ResponseEnrichmentService` which was not checking the ticker array.

### 3. RAGService Quick Response Path (Modified)

**File**: `src/rag/rag.service.ts`

**Change**: Add a degradation notice when LLM synthesis fails and the pipeline falls back to the quick response path for a multi-ticker query.

```typescript
// In the LLM synthesis try/catch block, when synthesis fails for multi-ticker:
catch (synthError) {
  this.logger.warn(`HybridSynthesis failed: ${synthError.message}`);
  const fallbackAnswer = this.responseEnrichment.buildQuickResponse(intent, metrics);
  answer = '⚠️ Analysis temporarily unavailable — showing raw data. Try again for a full comparative analysis.\n\n' + fallbackAnswer.answer;
}
```

### 4. Research Frontend — renderChart (Modified)

**File**: `public/app/deals/research.html`

**Change**: Replace single `$nextTick` with a retry loop using `requestAnimationFrame`.

```javascript
renderChart(messageIndex, payload) {
    if (!payload || !payload.datasets || payload.datasets.length === 0) return;
    var messageId = this.researchMessages[messageIndex]?.id;
    if (!messageId) return;
    var canvasId = 'chart-' + messageId;
    var self = this;
    var maxRetries = 3;
    var attempt = 0;

    function tryRender() {
        // Guard: check that the message container (bubble) exists first.
        // The visualization SSE event may arrive before the first markdown
        // flush creates the message bubble in the DOM. If the container
        // doesn't exist, the canvas inside it certainly won't either.
        var messageContainer = document.querySelector('[data-message-id="' + messageId + '"]');
        if (!messageContainer) {
            attempt++;
            if (attempt < maxRetries) {
                requestAnimationFrame(tryRender);
                return;
            }
            setTimeout(function() {
                var containerRetry = document.querySelector('[data-message-id="' + messageId + '"]');
                if (!containerRetry) {
                    console.warn('Message container not found after all retry attempts: ' + messageId);
                    return;
                }
                var canvasRetry = document.getElementById(canvasId);
                if (!canvasRetry) {
                    console.warn('Chart canvas not found after all retry attempts: ' + canvasId);
                    return;
                }
                renderOnCanvas(canvasRetry);
            }, 100);
            return;
        }

        var canvas = document.getElementById(canvasId);
        if (!canvas) {
            attempt++;
            if (attempt < maxRetries) {
                requestAnimationFrame(tryRender);
                return;
            }
            setTimeout(function() {
                var canvasRetry = document.getElementById(canvasId);
                if (!canvasRetry) {
                    console.warn('Chart canvas not found after all retry attempts: ' + canvasId);
                    return;
                }
                renderOnCanvas(canvasRetry);
            }, 100);
            return;
        }
        renderOnCanvas(canvas);
    }

    function renderOnCanvas(canvas) {
        var existingChart = Chart.getChart(canvas);
        if (existingChart) existingChart.destroy();
        // ... existing Chart.js initialization code ...
    }

    this.$nextTick(function() {
        requestAnimationFrame(tryRender);
    });
}
```

### 5. Research Frontend — Markdown Streaming Buffer (Modified)

**File**: `public/app/deals/research.html`

**Change**: The current SSE handler appends each token directly to `message.content` and Alpine.js reactively re-renders via `x-html="renderMarkdownWithCitations(...)"`. The `renderMarkdown()` function already handles table fixup and markdown parsing robustly. The issue is that during streaming, partial markdown fragments (e.g., half a table row, unclosed `**`) cause `marked.js` to produce broken HTML.

The fix adds a lightweight buffer that delays the `x-html` update until a natural breakpoint is reached:

```javascript
// When initializing a new assistant message, reset the buffer state:
self.researchMessages.push({
    id: Date.now() + 1, role: 'assistant', content: '', sources: [],
    citations: [], visualization: null, _rawContent: '', _lastMarkdownFlush: 0
});

// In SSE token handler:
if (currentEvent === 'token' && data.text) {
    self.researchMessages[assistantMessageIndex]._rawContent =
        (self.researchMessages[assistantMessageIndex]._rawContent || '') + data.text;

    // Only update rendered content at natural breakpoints
    var raw = self.researchMessages[assistantMessageIndex]._rawContent;
    if (self.isMarkdownBreakpoint(raw)) {
        self.researchMessages[assistantMessageIndex].content = raw;
        self.$nextTick(function() { self.scrollResearchToBottom(); });
    }
}

// On 'done' event (or abort/cancel), flush remaining buffer, reset state, and clean up:
if (currentEvent === 'done') {
    var remaining = self.researchMessages[assistantMessageIndex]._rawContent;
    if (remaining) {
        self.researchMessages[assistantMessageIndex].content = remaining;
    }
    // Clean up transient buffer fields to avoid holding duplicate content in memory
    delete self.researchMessages[assistantMessageIndex]._rawContent;
    self.researchMessages[assistantMessageIndex]._lastMarkdownFlush = 0;
}

// On abort/cancel (if supported), same cleanup:
// Reset _lastMarkdownFlush and delete _rawContent so stale state
// doesn't persist into the next query.
```

```javascript
isMarkdownBreakpoint(text) {
    if (!text) return false;
    // Flush at double newline (paragraph boundary)
    if (text.endsWith('\n\n')) return true;
    // Flush at end of table row
    if (text.endsWith('|\n')) return true;
    // Flush at sentence boundary: period followed by capital letter or newline.
    // IMPORTANT: This requires one token of lookahead beyond the period.
    // A trailing period at the very end of the buffer should NOT trigger a flush —
    // we need to see the next character to confirm it's a capital letter.
    // The regex checks the last 20 chars for .\s+[A-Z], which means the capital
    // letter must already be in the buffer (not just the period).
    if (/\.\s+[A-Z]/.test(text.slice(-20)) || text.endsWith('.\n')) return true;
    // A bare trailing period (text.endsWith('.')) does NOT flush — wait for lookahead.
    // Flush every 200 chars as a safety valve
    var lastFlush = this._lastMarkdownFlush || 0;
    if (text.length - lastFlush > 200) {
        this._lastMarkdownFlush = text.length;
        return true;
    }
    return false;
}
```

## Data Models

No new data models are introduced. The existing types are sufficient:

- **QueryIntent** (`src/rag/types/query-intent.ts`): Already has `ticker: string | string[]`, `needsComparison: boolean`, and all required flags.
- **VisualizationPayload** (`src/rag/types/visualization.ts`): Already supports `chartType`, `datasets`, `labels`, and `options` for Chart.js rendering.
- **RAGResponse** (`src/rag/types/query-intent.ts`): Already has `answer: string`, `visualization?: VisualizationPayload`, and `processingInfo`.

The only addition is a transient `_rawContent` field on the frontend message object used for streaming buffer purposes (not persisted). This field is deleted on stream completion ('done' event) and on abort/cancel to prevent holding duplicate content in memory across long sessions.


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Quick response eligibility rejects multi-ticker and comparison intents

*For any* `QueryIntent` where `ticker` is an array with 2+ elements OR `needsComparison` is `true`, `isQuickResponseEligible()` SHALL return `false`.

**Validates: Requirements 1.2, 4.1, 4.2**

### Property 2: Quick response eligibility invariant

*For any* `QueryIntent` where `isQuickResponseEligible()` returns `true`, ALL of the following conditions SHALL hold: `type === 'structured'`, `confidence > 0.85`, `needsNarrative === false`, `needsTrend === false`, `needsComparison === false`, `needsComputation === false`, `periodType !== 'range'`, and `ticker` is a single string (not an array). Conversely (contrapositive of Property 1), if `isQuickResponseEligible()` returns `true`, then `needsComparison` SHALL be `false` and `ticker` SHALL not be an array.

**Validates: Requirements 4.3**

### Property 3: Multi-ticker visualization generation

*For any* set of `MetricResult[]` containing metrics for 2+ distinct tickers and a `QueryIntent` with `needsComparison` or `needsTrend` set, `VisualizationGeneratorService.generateVisualization()` SHALL return a non-null `VisualizationPayload` with one dataset per ticker.

**Validates: Requirements 2.3**

### Property 4: Markdown breakpoint detection

*For any* string ending in `\n\n` (double newline), `|\n` (table row end), or `.\n` (period + newline), `isMarkdownBreakpoint()` SHALL return `true`. For strings ending in a period followed by a capital letter within the last 20 characters, `isMarkdownBreakpoint()` SHALL also return `true`. For strings ending in abbreviation-like patterns (e.g., "Inc.", "Corp.", "vs.") not followed by a capital letter, `isMarkdownBreakpoint()` SHALL return `false` (unless the 200-char safety valve triggers).

**Validates: Requirements 3.1**

### Property 5: Table markdown produces HTML tables

*For any* valid pipe-delimited markdown table string (with header row, separator row, and at least one data row), `renderMarkdown()` SHALL produce output containing an HTML `<table>` element.

**Validates: Requirements 3.2**

### Property 6: LLM needsComparison flag propagation

*For any* `LlmClassificationResult` where `needsComparison` is `true` or `tickers.length > 1`, the `QueryIntent` produced by `resolveFromLlmResult()` SHALL have `needsComparison === true`.

**Validates: Requirements 4.5**

### Property 7: Context ticker merging

*For any* query with explicitly detected tickers and a `contextTicker` that differs from all detected tickers, the merged ticker array in the resulting `QueryIntent` SHALL contain both the `contextTicker` and all detected tickers.

**Validates: Requirements 1.4**

## Error Handling

| Scenario | Behavior | Requirement |
|---|---|---|
| LLM synthesis fails for multi-ticker query | Fall back to quick response path with degradation notice prepended | Req 1.5, 5.1-5.4 |
| Canvas element not found after 3 retries | Log warning to console, skip chart rendering, display text response normally | Req 2.5 |
| Markdown parser encounters malformed syntax | Fall back to raw text with `<br>` line breaks | Req 3.5 |
| FinancialCalculatorService fails during computeFinancials | Return undefined, pipeline continues with raw metrics (existing behavior) | Existing Req 2.4 |
| SSE stream interrupted mid-token | Flush remaining `_rawContent` buffer to `content` on stream end | Req 3.1 |

## Testing Strategy

### Property-Based Testing

- **Library**: `fast-check` (already used in the project)
- **Framework**: Jest (already used in the project)
- **Minimum iterations**: 100 per property test
- **Tag format**: `Feature: research-response-formatting-fix, Property N: {title}`

Each correctness property above maps to a single property-based test. The generators will produce random `QueryIntent` objects, `MetricResult[]` arrays, `LlmClassificationResult` objects, and markdown strings to exercise the properties across a wide range of inputs.

### Unit Tests

Unit tests complement property tests by covering:
- Specific regression examples (e.g., "AMZN vs MSFT revenue FY2024" with ABNB context ticker)
- Edge cases: empty ticker arrays, single-ticker queries, queries with `needsComparison` but single ticker
- Degradation notice text content verification
- Frontend `isMarkdownBreakpoint()` edge cases (empty string, string with only whitespace, very long strings)

### Test File Organization

| Test File | Tests |
|---|---|
| `test/properties/quick-response-eligibility.property.spec.ts` | Properties 1, 2 |
| `test/properties/multi-ticker-visualization.property.spec.ts` | Property 3 |
| `test/properties/markdown-breakpoint.property.spec.ts` | Properties 4, 5 |
| `test/properties/intent-comparison-propagation.property.spec.ts` | Properties 6, 7 |
| `test/unit/quick-response-eligibility.spec.ts` | Unit tests for isQuickResponseEligible edge cases (including empty/single-element array decisions) |
| `test/unit/chart-render-retry.spec.ts` | Unit tests for renderChart retry logic (including container guard) |
| `test/unit/degradation-notice.spec.ts` | Unit tests for fallback degradation notice |
