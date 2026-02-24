# Bugfix Requirements Document

## Introduction

The research assistant fails to render charts, citations, and properly formatted markdown tables when processing multi-ticker comparison queries (e.g., "AAPL vs MSFT revenue FY 2023 - 2024"). This impacts the user experience by preventing visualization of comparative data, removing source attribution, and producing malformed table output. The root causes span SSE event serialization, citation generation logic, frontend rendering timing, and markdown parsing.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the backend sends SSE events with visualization or citation data THEN the `@Sse()` decorator fails to serialize the `type` field as proper SSE `event:` lines, causing the frontend to receive only `data: {...}` without event type information

1.2 WHEN a structured-only query (no semantic retrieval) is processed THEN no citations are generated because the narratives array is empty, even though metrics contain filing metadata

1.3 WHEN the frontend attempts to render a chart THEN the canvas element may not be visible due to Alpine.js DOM update timing, causing `renderChart()` to fail silently

1.4 WHEN markdown table content is being streamed THEN `isMarkdownBreakpoint()` flushes mid-table upon detecting `|` at line end, breaking table rendering before the separator row arrives

### Expected Behavior (Correct)

2.1 WHEN the backend sends SSE events with visualization or citation data THEN the system SHALL properly serialize events in SSE format with `event: visualization\ndata: {...}` or `event: citations\ndata: {...}` so the frontend can distinguish event types

2.2 WHEN a structured-only query returns metrics with filing metadata THEN the system SHALL generate citations from the metric metadata even when the narratives array is empty, SHALL include a `formatValue()` helper method that formats large numbers with B/M/K suffixes (e.g., 1000000000 → "1.0B"), and SHALL append a source reference section to the answer when no citation markers exist: `\n\n**Sources:**\n[1] AAPL 10-K FY2023\n[2] MSFT 10-K FY2023...`

2.3 WHEN the frontend receives a visualization event THEN the system SHALL use a polling retry mechanism to wait for the canvas element to become visible before calling `renderChart()`

2.4 WHEN markdown table content is being streamed THEN the system SHALL only flush when text ends with `|\n\n` (table followed by double newline), preserving table integrity until the complete table structure is received

### Unchanged Behavior (Regression Prevention)

3.1 WHEN single-ticker queries are processed THEN the system SHALL CONTINUE TO render charts, citations, and markdown correctly as before

3.2 WHEN semantic retrieval returns narrative chunks THEN the system SHALL CONTINUE TO generate citations from the narratives array as before

3.3 WHEN non-table markdown content is streamed THEN the system SHALL CONTINUE TO flush at appropriate breakpoints (paragraphs, headers, lists) as before

3.4 WHEN the canvas element is immediately visible THEN the system SHALL CONTINUE TO render charts without delay as before

3.5 WHEN SSE events with `chunk.type === undefined` are sent THEN the system SHALL CONTINUE TO handle them gracefully by treating them as generic data events, ensuring backward compatibility with SSE events that don't have an explicit type field
