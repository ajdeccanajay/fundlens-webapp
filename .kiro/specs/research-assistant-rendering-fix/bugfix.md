# Bugfix Requirements Document

## Introduction

The research assistant page (research.html) has multiple critical rendering and functionality issues affecting user experience. These issues include Alpine.js initialization errors, missing citations, non-rendering charts, poor formatting, and API endpoint failures. This bugfix addresses the systematic failures preventing proper display and interaction with research responses.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the research.html page loads THEN Alpine.js throws "Unexpected token 'try'" error from line 103 due to invalid `x-init="try { await init() }"` syntax

1.2 WHEN viewing conversation ID 21f572ba-1c7c-4eb0-8fea-d7ec700b9a55 THEN citations that previously worked no longer display as clickable [1], [2], etc. links in responses

1.3 WHEN querying "AMZN vs MSFT revenue FY2024" or similar comparison queries THEN charts/visualizations do not render despite visualization data being present

1.4 WHEN responses are displayed THEN markdown formatting is broken or suboptimal, resulting in poor readability

1.5 WHEN the page attempts to fetch conversation messages THEN GET /api/research/conversations/{id}/messages returns 404 error

1.6 WHEN the page attempts to fetch scratchpad data THEN GET /api/research/scratchpad/{ticker} returns 500 error

1.7 WHEN the page loads THEN browser console shows 404 error for missing favicon.ico

### Expected Behavior (Correct)

2.1 WHEN the research.html page loads THEN Alpine.js SHALL initialize without syntax errors using valid Alpine.js initialization syntax

2.2 WHEN viewing any conversation with citations THEN citations SHALL render as clickable links with [1], [2], etc. notation that open source modals when clicked

2.3 WHEN querying comparison data like "AMZN vs MSFT revenue FY2024" THEN charts SHALL display with proper visualization of the comparison data using Chart.js

2.4 WHEN responses are displayed THEN markdown SHALL render correctly with proper formatting including tables, code blocks, lists, and paragraph breaks

2.5 WHEN the page attempts to fetch conversation messages THEN GET /api/research/conversations/{id}/messages SHALL return 200 with valid message data

2.6 WHEN the page attempts to fetch scratchpad data THEN GET /api/research/scratchpad/{ticker} SHALL return 200 with valid scratchpad data or gracefully handle missing data

2.7 WHEN the page loads THEN no 404 errors SHALL appear in the console for favicon.ico

### Unchanged Behavior (Regression Prevention)

3.1 WHEN users send new research queries THEN the system SHALL CONTINUE TO process queries and stream responses via SSE

3.2 WHEN users interact with the provocations mode THEN the system SHALL CONTINUE TO apply the provocations system prompt

3.3 WHEN users interact with the sentiment mode THEN the system SHALL CONTINUE TO apply the sentiment analysis system prompt

3.4 WHEN users upload instant RAG documents THEN the system SHALL CONTINUE TO process and enable document-based Q&A

3.5 WHEN users save messages to scratchpad THEN the system SHALL CONTINUE TO save insights to the notebook

3.6 WHEN users navigate between workspace pages THEN the system SHALL CONTINUE TO maintain authentication and context

3.7 WHEN responses contain tables THEN the system SHALL CONTINUE TO render markdown tables with proper HTML table structure

3.8 WHEN responses contain severity badges (RED FLAG, AMBER, GREEN CHALLENGE) THEN the system SHALL CONTINUE TO convert them to styled badge components
