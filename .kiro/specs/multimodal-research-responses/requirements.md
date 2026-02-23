# Requirements Document

## Introduction

The FundLens research assistant currently returns text-only responses. When users ask questions involving financial trends, comparisons, or growth rates (e.g., "What is the revenue and net income trend for AirBnB? Can you show me a chart?"), the system returns markdown text only — no charts, no computed YoY growth, no visual data. This feature adds multi-modal responses with inline charts, computed trend metrics, and re-enables the performance optimizer cache with smart invalidation. The three gaps addressed are: (1) no visualization layer, (2) the FinancialCalculatorService is disconnected from the research pipeline, and (3) the performance optimizer cache is disabled.

## Glossary

- **Research_Assistant**: The tenant-scoped research conversation service (`ResearchAssistantService`) that streams AI responses via SSE
- **RAG_Pipeline**: The hybrid retrieval-augmented generation pipeline (`RAGService`) that retrieves structured metrics and semantic narratives
- **Intent_Detector**: The service (`IntentDetectorService`) that parses natural language queries into `QueryIntent` objects with flags like `needsTrend`, `needsComputation`, `needsComparison`
- **Financial_Calculator**: The existing `FinancialCalculatorService` that computes YoY growth, multi-year summaries, CAGR, and derived metrics — currently only used in deal dashboards
- **Computed_Metrics_Service**: The existing `ComputedMetricsService` that calculates EBITDA, FCF, gross margin, net margin, and TTM values
- **Performance_Optimizer**: The existing `PerformanceOptimizerService` with LRU cache, TTL management, and hit rate tracking — currently disabled in the RAG pipeline
- **Visualization_Payload**: A structured JSON object containing chart type, labels, datasets, and configuration that the frontend uses to render a Chart.js chart
- **Stream_Chunk**: A typed SSE message yielded by the Research_Assistant during streaming, with types including 'token', 'source', 'citations', 'peerComparison', 'done', 'error'
- **Quick_Response**: A fast-path response for simple metric lookups that returns structured data (tables/charts) without waiting for LLM generation
- **Chart_Renderer**: A frontend Alpine.js component that receives a Visualization_Payload and renders an interactive Chart.js chart inline in the conversation

## Requirements

### Requirement 1: Visualization Data Generation

**User Story:** As a financial analyst, I want the research assistant to return chart-ready data alongside text responses, so that I can see visual representations of financial trends and comparisons.

#### Acceptance Criteria

1. WHEN the Intent_Detector identifies a query with `needsTrend` set to true, THE RAG_Pipeline SHALL include a Visualization_Payload in the response containing time-series data with fiscal periods as labels and metric values as datasets
2. WHEN the Intent_Detector identifies a query with `needsComparison` set to true and multiple tickers, THE RAG_Pipeline SHALL include a Visualization_Payload with a grouped bar chart configuration comparing the requested metrics across tickers
3. WHEN the RAG_Pipeline generates a Visualization_Payload, THE Visualization_Payload SHALL contain a chart type (line, bar, or grouped bar), an array of string labels, one or more named datasets with numeric values, and a title string
4. WHEN the RAG_Pipeline has fewer than two data points for a requested trend, THE RAG_Pipeline SHALL omit the Visualization_Payload and return a text-only response
5. WHEN the RAG_Pipeline generates a Visualization_Payload, THE Visualization_Payload SHALL reference the same metric values present in the `metrics` array of the RAGResponse

### Requirement 2: Financial Calculator Integration

**User Story:** As a financial analyst, I want the research assistant to include computed growth rates and derived metrics in responses, so that I can get YoY growth, CAGR, and margin trends without manual calculation.

#### Acceptance Criteria

1. WHEN the Intent_Detector identifies a query with `needsComputation` or `needsTrend` set to true, THE RAG_Pipeline SHALL invoke the Financial_Calculator to compute YoY growth rates for the requested metrics and ticker
2. WHEN the Financial_Calculator returns computed metrics (YoY growth, CAGR, margins), THE RAG_Pipeline SHALL include the computed values in the context provided to the LLM for answer generation
3. WHEN the Financial_Calculator returns YoY growth data for a trend query, THE RAG_Pipeline SHALL include a secondary dataset in the Visualization_Payload representing the growth rate percentages
4. IF the Financial_Calculator fails to compute metrics for a given ticker, THEN THE RAG_Pipeline SHALL proceed with the raw metrics from the Computed_Metrics_Service and log a warning

### Requirement 3: Streaming Visualization Delivery

**User Story:** As a financial analyst, I want charts to appear inline in the conversation as the response streams, so that I see visual data as soon as it is available without waiting for the full text response.

#### Acceptance Criteria

1. THE Research_Assistant SHALL support a new Stream_Chunk type called 'visualization' that carries a Visualization_Payload
2. WHEN the RAG_Pipeline produces a Visualization_Payload, THE Research_Assistant SHALL yield a 'visualization' Stream_Chunk before yielding the first 'token' chunk
3. WHEN the Research_Assistant yields a 'visualization' Stream_Chunk, THE Stream_Chunk data field SHALL contain a valid Visualization_Payload with chart type, labels, datasets, and title
4. IF the RAG_Pipeline produces no Visualization_Payload, THEN THE Research_Assistant SHALL stream the response using only existing chunk types without yielding a 'visualization' chunk

### Requirement 4: Frontend Chart Rendering

**User Story:** As a financial analyst, I want to see interactive charts rendered inline in the research conversation, so that I can visually analyze trends and comparisons alongside the text explanation.

#### Acceptance Criteria

1. WHEN the frontend receives a 'visualization' Stream_Chunk, THE Chart_Renderer SHALL render a Chart.js chart inline in the assistant message area
2. WHEN the Chart_Renderer renders a line chart, THE Chart_Renderer SHALL display data points with tooltips showing the exact value and fiscal period
3. WHEN the Chart_Renderer renders a bar chart, THE Chart_Renderer SHALL display labeled bars with tooltips showing the exact value
4. WHEN the Chart_Renderer renders a chart, THE Chart_Renderer SHALL use a responsive canvas that fits within the message container width
5. WHEN the user hovers over a data point on a rendered chart, THE Chart_Renderer SHALL display a tooltip with the metric name, value, and period
6. THE Chart_Renderer SHALL apply consistent color schemes across all chart types using the FundLens design system palette

### Requirement 5: Performance Optimizer Cache Re-enablement

**User Story:** As a financial analyst, I want repeated queries to return faster, so that I do not wait for full RAG processing on questions I have already asked.

#### Acceptance Criteria

1. THE Performance_Optimizer cache SHALL be re-enabled in the RAG_Pipeline for both the cache lookup step and the cache storage step
2. WHEN a cache hit occurs, THE RAG_Pipeline SHALL return the cached RAGResponse with updated latency and timestamp fields
3. WHEN a cached response is returned, THE RAGResponse processingInfo SHALL include `fromCache: true`
4. THE Performance_Optimizer SHALL use a TTL of 3600 seconds for queries targeting the latest fiscal period, 86400 seconds for historical period queries, and 21600 seconds for semantic queries
5. WHEN the cache reaches its maximum size, THE Performance_Optimizer SHALL evict the least recently used entry

### Requirement 6: Cache Invalidation Strategy

**User Story:** As a financial analyst, I want the cache to serve fresh data after new filings are ingested, so that I never see stale financial metrics.

#### Acceptance Criteria

1. WHEN a new SEC filing is ingested for a ticker, THE Performance_Optimizer SHALL invalidate all cache entries whose cache key contains that ticker
2. WHEN a cache entry is invalidated, THE Performance_Optimizer SHALL remove the entry from the cache and increment the eviction counter
3. THE Performance_Optimizer SHALL expose a method to invalidate cache entries by ticker that can be called from the ingestion pipeline
4. WHEN no invalidation event occurs, THE Performance_Optimizer SHALL serve cached entries until their TTL expires

### Requirement 7: Quick Response Path

**User Story:** As a financial analyst, I want simple metric lookups to return instantly with structured data, so that I do not wait for LLM generation when the answer is a straightforward number or table.

#### Acceptance Criteria

1. WHEN the Intent_Detector classifies a query as 'structured' type with confidence above 0.85 and `needsNarrative` set to false, THE RAG_Pipeline SHALL use the Quick_Response path
2. WHEN the Quick_Response path is used, THE RAG_Pipeline SHALL return a response containing the structured metrics and an auto-generated text summary without invoking the LLM
3. WHEN the Quick_Response path generates a text summary, THE RAG_Pipeline SHALL format the metrics into a readable markdown table with ticker, metric name, value, and fiscal period columns
4. WHEN the Quick_Response path is used for a trend query, THE RAG_Pipeline SHALL include a Visualization_Payload alongside the markdown table
5. WHEN the Quick_Response path is used, THE RAGResponse processingInfo SHALL include `usedClaudeGeneration: false`

### Requirement 8: Workspace Chat Visualization Support

**User Story:** As a financial analyst working in a deal workspace, I want the same chart rendering capabilities in workspace chat, so that I get consistent multi-modal responses across both research and workspace contexts.

#### Acceptance Criteria

1. WHEN the workspace chat frontend receives a 'visualization' Stream_Chunk, THE workspace Chart_Renderer SHALL render a Chart.js chart inline in the assistant message area
2. THE workspace Chart_Renderer SHALL use the same rendering logic and color scheme as the research page Chart_Renderer
3. WHEN the workspace chat renders a chart, THE Chart_Renderer SHALL fit the chart within the workspace message container width
