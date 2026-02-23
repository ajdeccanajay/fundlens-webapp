# Bugfix Requirements Document

## Introduction

Three interrelated bugs in the FundLens Research Assistant are causing degraded user experience: (1) multi-year fiscal period ranges silently drop the end year, returning incomplete data; (2) charts fail to render on the initial SSE stream, requiring a page refresh; (3) citations never appear in responses despite prompt instructions and extraction logic being present. These bugs have persisted through multiple fix attempts, indicating root causes deeper in the pipeline than previously addressed.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user queries a fiscal year range such as "AAPL vs MSFT revenue FY 2023 - 2024" THEN the system only returns data for FY 2023, completely dropping FY 2024 from the response. The root cause is that `extractPeriod()` in `intent-detector.service.ts` matches the first `FY \d{4}` pattern and returns immediately with a single period (e.g., `FY2023`), never parsing the range endpoint.

1.2 WHEN the intent detector returns a period range with `periodStart` and `periodEnd` fields (e.g., from the LLM detection engine or multi-year regex patterns) THEN the `StructuredRetrieverService.retrieve()` method ignores `periodStart`/`periodEnd` entirely, only filtering on `query.period` as a single exact-match value, resulting in at most one fiscal year of data being returned.

1.3 WHEN a chart-producing query runs for the first time in a conversation THEN the chart does NOT render on the initial page load — only text appears. The user must refresh the page to see the chart. The `renderChart()` function is called via `$nextTick` when the `visualization` SSE event arrives, but the canvas element (rendered by Alpine.js template with `x-show` or `x-if` conditional on `msg.visualization`) may not yet be in the DOM when `renderChart` executes, causing the retry loop to exhaust its 5 attempts (5 × 200ms = 1 second) before Alpine flushes the template.

1.4 WHEN the LLM generates a response using narrative context with numbered source labels ([1], [2], etc.) THEN citations do NOT appear in the rendered response. The `formatNarratives()` method correctly labels narratives as `[1]`, `[2]`, etc. and the `CITATION RULE` instruction is included in the prompt, but the LLM frequently ignores the citation instruction or uses different citation formats, and even when `[N]` markers are present in the response text, the `extractCitations()` method may return an empty array if no narratives were passed to the synthesis context.

1.5 WHEN the RAG pipeline uses the decomposed query path (multi-ticker comparison) THEN the `synthesisContext` passed to `hybridSynthesis.synthesize()` has an empty `narratives` array (set to `[]` on line ~178 of `rag.service.ts`), which means `formatNarratives()` returns `null`, the `CITATION RULE` instruction is never appended to the prompt, and `extractCitations()` receives an empty narratives array — guaranteeing zero citations regardless of what the LLM outputs.

### Expected Behavior (Correct)

2.1 WHEN a user queries a fiscal year range such as "AAPL vs MSFT revenue FY 2023 - 2024" THEN the system SHALL parse both the start year (FY2023) and end year (FY2024) from the query, setting `periodType: 'range'`, `periodStart: 'FY2023'`, and `periodEnd: 'FY2024'` on the intent, and return data for all fiscal years in the range.

2.2 WHEN the intent contains `periodType: 'range'` with `periodStart` and `periodEnd` THEN the `StructuredRetrieverService.retrieve()` method SHALL build a range filter (e.g., `fiscalPeriod IN ['FY2023', 'FY2024']` or a BETWEEN-style comparison) to retrieve metrics for all fiscal periods within the specified range.

2.3 WHEN a chart-producing query runs and the `visualization` SSE event is received THEN the system SHALL render the chart on the first load without requiring a page refresh. The chart rendering pipeline SHALL ensure the canvas element is present in the DOM before attempting to render, using a robust mechanism (e.g., MutationObserver, longer retry with backoff, or ensuring Alpine template flush completes before render).

2.4 WHEN the LLM generates a response using narrative context THEN the system SHALL ensure citations appear in the final rendered response. The citation pipeline SHALL work end-to-end: narratives are labeled in the prompt, the LLM is strongly instructed to use `[N]` markers, `extractCitations()` maps markers to source metadata, the citations array is sent via SSE, and the frontend renders them as clickable links.

2.5 WHEN the RAG pipeline uses the decomposed query path THEN the `synthesisContext` SHALL include the collected narratives from sub-query results (not an empty array), so that `formatNarratives()` can label them, the citation instruction is included in the prompt, and `extractCitations()` can map response markers to actual sources.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user queries a single fiscal year such as "AAPL revenue FY 2024" THEN the system SHALL CONTINUE TO return data for exactly that single fiscal year without treating it as a range.

3.2 WHEN a user queries with relative time expressions such as "past 5 years" or "last 3 years" THEN the system SHALL CONTINUE TO correctly compute the range from the current year and return data for all years in that range.

3.3 WHEN a user queries "latest" or "most recent" data THEN the system SHALL CONTINUE TO use the `retrieveLatest` path and return the most recent available data.

3.4 WHEN a chart renders successfully on page refresh or conversation reload THEN the `renderExistingCharts()` function SHALL CONTINUE TO re-render all charts from stored visualization data.

3.5 WHEN a non-chart query runs (text-only response) THEN the SSE streaming pipeline SHALL CONTINUE TO render text responses correctly with markdown formatting.

3.6 WHEN user-uploaded document citations are present THEN the system SHALL CONTINUE TO extract, store, and render user document citations with green styling and modal display.

3.7 WHEN the RAG pipeline uses the single-intent (non-decomposed) path with narratives THEN the existing citation extraction logic SHALL CONTINUE TO work as before.

3.8 WHEN the quick response path is used for simple structured lookups THEN the system SHALL CONTINUE TO skip LLM synthesis and return data directly without citations.
