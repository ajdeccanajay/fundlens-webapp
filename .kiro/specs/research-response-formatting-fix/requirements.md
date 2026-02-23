# Requirements Document

## Introduction

This specification addresses three critical UX bugs in the FundLens Research Assistant response rendering pipeline. When a user asks a multi-ticker comparison query (e.g., "AMZN vs MSFT revenue FY2024") from within a workspace context (e.g., ABNB), the system currently: (1) bypasses the LLM synthesis path and returns raw metric data instead of analytical narrative, (2) fails to render Chart.js visualizations on the canvas element, and (3) does not properly render markdown formatting in the response text. These issues stem from the quick-response eligibility logic in `ResponseEnrichmentService`, the Alpine.js/Chart.js rendering lifecycle in the frontend, and markdown parsing edge cases during SSE streaming.

## Glossary

- **Quick_Response_Path**: The code path in `ResponseEnrichmentService.isQuickResponseEligible()` that skips LLM invocation and returns a raw markdown table for simple structured lookups.
- **LLM_Synthesis_Path**: The code path through `HybridSynthesisService.synthesize()` that invokes Claude to generate analytical narrative responses with comparisons, insights, and context.
- **Intent_Detector**: The `IntentDetectorService` that classifies user queries and sets flags like `needsComparison`, `needsTrend`, and `needsNarrative` on the `QueryIntent` object.
- **Response_Enrichment_Service**: The `ResponseEnrichmentService` that owns the quick-response eligibility check, markdown table builder, and visualization attachment logic.
- **Visualization_Generator**: The `VisualizationGeneratorService` that produces `VisualizationPayload` objects for Chart.js rendering.
- **Research_Frontend**: The Alpine.js-based frontend in `research.html` that handles SSE streaming, markdown rendering via `marked.js`, and Chart.js chart rendering.
- **Context_Ticker**: The workspace ticker (e.g., ABNB) passed as `contextTicker` to the intent detector, representing the company the user is currently researching.
- **Multi_Ticker_Query**: A query that references two or more ticker symbols, either explicitly (e.g., "AMZN vs MSFT") or implicitly via the context ticker plus query tickers.
- **SSE_Stream**: The Server-Sent Events stream used to deliver response tokens, sources, citations, visualization payloads, and completion signals from backend to frontend.

## Requirements

### Requirement 1: Multi-Ticker Queries Route Through LLM Synthesis

**User Story:** As a research analyst, I want multi-ticker comparison queries to produce analytical narrative responses with insights, so that I receive meaningful comparative analysis rather than raw data tables.

#### Acceptance Criteria

1. WHEN the Intent_Detector detects two or more tickers in a query, THE Intent_Detector SHALL set `needsComparison` to `true` on the resulting `QueryIntent` object.
2. WHEN the `QueryIntent` has `needsComparison` set to `true`, THE Response_Enrichment_Service SHALL return `false` from `isQuickResponseEligible()`.
3. WHEN a Multi_Ticker_Query is processed, THE RAG pipeline SHALL route the query through the LLM_Synthesis_Path to generate an analytical response.
4. WHEN the Context_Ticker differs from the tickers explicitly named in the query, THE Intent_Detector SHALL include the Context_Ticker in the merged ticker array.
5. IF the LLM_Synthesis_Path fails for a Multi_Ticker_Query, THEN THE RAG pipeline SHALL fall back to the quick response path and return the markdown table with a degradation notice.

### Requirement 2: Chart Visualization Renders Correctly

**User Story:** As a research analyst, I want comparison and trend charts to render visually in the response, so that I can quickly interpret financial data across tickers.

#### Acceptance Criteria

1. WHEN a `visualization` SSE event is received by the Research_Frontend, THE Research_Frontend SHALL ensure the canvas DOM element is present and visible before invoking Chart.js.
2. WHEN the canvas element is not yet in the DOM after `$nextTick`, THE Research_Frontend SHALL retry rendering asynchronously using `requestAnimationFrame` with a maximum of 3 retry attempts at approximately 50ms intervals, without blocking SSE stream processing.
3. WHEN a Multi_Ticker_Query produces metrics for two or more tickers, THE Visualization_Generator SHALL generate a grouped bar or line chart payload with one dataset per ticker.
4. WHEN a chart is successfully rendered, THE Research_Frontend SHALL display the chart above the response text within the assistant message bubble.
5. IF the canvas element cannot be found after 3 retry attempts, THEN THE Research_Frontend SHALL log a warning to the console and skip chart rendering without breaking the response text display.

### Requirement 3: Markdown Formatting Renders Correctly

**User Story:** As a research analyst, I want response text with markdown headers, bold text, and tables to render as formatted HTML, so that the analysis is readable and well-structured.

#### Acceptance Criteria

1. WHEN the Research_Frontend receives streamed tokens containing markdown syntax, THE Research_Frontend SHALL accumulate tokens and parse the content using `marked.js` only at natural breakpoints (double newline, end of table row, or sentence boundary) to avoid parsing incomplete markdown fragments.
2. WHEN the response contains pipe-delimited table syntax, THE Research_Frontend SHALL ensure the table has a proper separator row and render it as an HTML table element.
3. WHEN the response contains `###` headers or `**bold**` text, THE Research_Frontend SHALL render them as the corresponding HTML elements (`<h3>`, `<strong>`).
4. WHEN markdown content is set via Alpine.js `x-html` binding during streaming, THE Research_Frontend SHALL call the `renderMarkdownWithCitations()` function for each content update at the breakpoints defined in criterion 3.1.
5. IF the markdown parser encounters malformed syntax, THEN THE Research_Frontend SHALL fall back to displaying the raw text with line breaks preserved.

### Requirement 4: Quick Response Eligibility Guards

**User Story:** As a system maintainer, I want the quick response eligibility logic to have clear, testable guards that prevent multi-ticker and comparison queries from bypassing the LLM, so that the routing logic is robust and predictable.

#### Acceptance Criteria

1. THE Response_Enrichment_Service SHALL return `false` from `isQuickResponseEligible()` when the `QueryIntent` contains an array ticker (multiple tickers).
2. THE Response_Enrichment_Service SHALL return `false` from `isQuickResponseEligible()` when `needsComparison` is `true`.
3. THE Response_Enrichment_Service SHALL return `true` from `isQuickResponseEligible()` only when all of the following hold: `type` is `'structured'`, `confidence` exceeds 0.85, `needsNarrative` is `false`, `needsTrend` is `false`, `needsComparison` is `false`, `needsComputation` is `false`, `periodType` is not `'range'`, and `ticker` is a single string (not an array).
4. WHEN `isQuickResponseEligible()` returns `false`, THE RAG pipeline SHALL proceed to the LLM_Synthesis_Path.
5. WHEN the LLM Detection Engine (Haiku classifier) sets `needsComparison` in its structured output, THE Intent_Detector SHALL propagate that flag to the final `QueryIntent` object, ensuring the downstream eligibility guard in the Response_Enrichment_Service respects the LLM classifier's determination.

### Requirement 5: LLM Synthesis Fallback Degradation Notice

**User Story:** As a research analyst, I want to understand when the system falls back to raw data instead of analytical narrative, so that I know the response quality is degraded and can retry or adjust my query.

#### Acceptance Criteria

1. WHEN the LLM_Synthesis_Path fails and the RAG pipeline falls back to the quick response markdown table, THE RAG pipeline SHALL prepend an inline degradation notice to the response text.
2. THE degradation notice SHALL read: "⚠️ Analysis temporarily unavailable — showing raw data. Try again for a full comparative analysis."
3. WHEN the degradation notice is displayed, THE Research_Frontend SHALL render it as a styled warning banner above the markdown table within the assistant message bubble.
4. THE degradation notice SHALL be visually distinct from the response content, using an amber background and warning icon consistent with the existing severity badge styling.
