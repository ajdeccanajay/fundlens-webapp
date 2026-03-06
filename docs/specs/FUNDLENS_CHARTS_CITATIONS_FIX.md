# FundLens: Charts, Citations & Formatting — Root Cause Analysis & Fixes

**Query tested:** `AAPL vs MSFT revenue FY 2023 - 2024`
**Expected:** Multi-ticker grouped bar or line chart, inline `[1]` `[2]` citations, clean formatting
**Actual:** No chart, no citations, poor formatting

---

## Root Cause #1: SSE Event Serialization (CRITICAL — Affects Both Charts AND Citations)

### Problem

The research assistant controller uses `@Sse()` on a `@Post()` endpoint:

```typescript
// src/research/research-assistant.controller.ts:150-170
@Post('conversations/:id/messages')
@Sse()
sendMessage(...): Observable<MessageEvent> {
    return new Observable((subscriber) => {
        // ...
        subscriber.next({
            data: chunk.data,
            type: chunk.type,  // ← "visualization", "citations", "token", etc.
        } as MessageEvent);
    });
}
```

NestJS `@Sse()` decorator is designed for `@Get()` endpoints and uses `EventSource` protocol. When used on `@Post()`, NestJS may not properly serialize the `type` field as the SSE `event:` line. The `MessageEvent` interface has a `type` property but NestJS's SSE serializer maps it from the `id` or `type` fields inconsistently across versions.

**The frontend expects:**
```
event: visualization
data: {"chartType":"line",...}

event: citations  
data: {"citations":[...]}

event: token
data: {"text":"Revenue for..."}
```

**What likely gets sent:**
```
data: {"chartType":"line",...}

data: {"citations":[...]}

data: {"text":"Revenue for..."}
```

Without the `event:` prefix line, the frontend's parser (`if (line.startsWith('event: '))`) never sets `currentEvent`, so the data lines are parsed with `currentEvent = null` and silently dropped by every `if (currentEvent === 'X')` branch.

### Fix

Replace the `@Sse()` decorator approach with manual SSE streaming (same pattern as `instant-rag.controller.ts` which works correctly):

```typescript
// src/research/research-assistant.controller.ts — REPLACE the sendMessage method

import { Res } from '@nestjs/common';
import { Response } from 'express';

@Post('conversations/:id/messages')
async sendMessage(
    @Param('id') conversationId: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
) {
    // Set SSE headers manually (matching working instant-rag pattern)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    try {
        const stream = this.researchService.sendMessage(conversationId, dto);

        for await (const chunk of stream) {
            // Write proper SSE format: event + data + double newline
            res.write(`event: ${chunk.type}\ndata: ${JSON.stringify(chunk.data)}\n\n`);
        }

        // Send done event
        res.write(`event: done\ndata: ${JSON.stringify({ complete: true })}\n\n`);
        res.end();
    } catch (error) {
        console.error('❌ SSE Error:', error);
        res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
        res.end();
    }
}
```

Also remove the `@Sse()`, `Sse`, `MessageEvent`, and `Observable` imports that are no longer needed.

---

## Root Cause #2: Citations Not Generated for Structured-Only Queries

### Problem

For the query `AAPL vs MSFT revenue FY 2023 - 2024`, intent detection will classify this as:
- `type: "structured"` (numeric metric request)
- `tickers: ["AAPL", "MSFT"]`
- `metrics: ["revenue"]`
- `periodType: "range"`, `periodStart: "FY2023"`, `periodEnd: "FY2024"`
- `needsComparison: true`, `needsTrend: true`

Because it's structured, the **semantic path doesn't execute** (no Bedrock KB retrieval). This means `narratives = []`. Citations are extracted from narratives:

```typescript
// src/rag/hybrid-synthesis.service.ts:542
private extractCitations(response: string, narratives: ChunkResult[]): Citation[] {
    // ...
    const idx = num - 1; // [1] → narratives[0]
    if (idx >= 0 && idx < narratives.length) { // ← narratives is empty!
```

With no narratives, there are no citations to extract, even if the LLM includes `[1]` markers in its response.

Additionally, for structured queries, the sources come from `extractSources(metrics, narratives)`. Even though metrics have filing metadata (ticker, filingType, fiscalPeriod), these are NOT formatted as clickable citations.

### Fix

Create structured metric citations from the metric results themselves, not just from narratives:

```typescript
// Add to src/rag/rag.service.ts — after building the response object (~line 820)

// Generate citations from structured metrics when no narrative citations exist
if ((!citations || citations.length === 0) && metrics.length > 0) {
    const metricCitations = this.buildMetricCitations(metrics);
    if (metricCitations.length > 0) {
        citations = metricCitations;
        // Re-inject into the answer text if LLM didn't add markers
        if (answer && !answer.match(/\[\d+\]/)) {
            // Append source reference section
            const sourceRef = metricCitations
                .map((c, i) => `[${i + 1}] ${c.ticker} ${c.filingType} ${c.fiscalPeriod}`)
                .join('\n');
            answer = `${answer}\n\n**Sources:**\n${sourceRef}`;
        }
    }
}
```

Add the helper method:

```typescript
// Add to RAGService class

private buildMetricCitations(metrics: MetricResult[]): any[] {
    const seen = new Set<string>();
    const citations: any[] = [];
    let num = 1;

    for (const metric of metrics) {
        const key = `${metric.ticker}-${metric.filingType}-${metric.fiscalPeriod}`;
        if (seen.has(key)) continue;
        seen.add(key);

        citations.push({
            number: num,
            citationNumber: num,
            type: 'sec_filing',
            sourceType: 'SEC_FILING',
            ticker: metric.ticker,
            filingType: metric.filingType,
            fiscalPeriod: metric.fiscalPeriod,
            section: metric.statementType || 'Financial Statements',
            excerpt: `${metric.rawLabel}: ${this.formatValue(metric.value)} (${metric.fiscalPeriod})`,
            relevanceScore: metric.confidenceScore,
        });
        num++;
    }

    return citations;
}

private formatValue(value: number): string {
    if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
    return `$${value.toFixed(2)}`;
}
```

---

## Root Cause #3: Chart Rendering Timing Race

### Problem

The SSE event order is:
1. `event: source` (filing metadata)
2. `event: citations` (citation objects)  
3. `event: visualization` (chart payload) ← **arrives here**
4. `event: token` (response text, streamed in chunks)
5. `event: done`

When the `visualization` event arrives (step 3), the Alpine template creates the canvas:

```html
<div :style="message.visualization ? 'min-height:200px;' : 'height:0;overflow:hidden;'">
    <canvas :id="'chart-' + message.id" ...></canvas>
</div>
```

The `renderChart()` call happens in `$nextTick` after setting `message.visualization`. But `$nextTick` fires after Alpine's reactive update — which may not have propagated to the DOM yet (Alpine uses microtasks, not macrotasks). The canvas may still have `height:0` from the previous style.

The `renderChart()` function checks `canvas.offsetHeight > 0`:
```javascript
if (canvas && canvas.offsetHeight > 0 && canvas.offsetWidth > 0) {
    doRender(canvas);  // ← This fails because canvas is still hidden
}
```

It then falls back to a MutationObserver with a 5-second timeout. But the observer watches `document.querySelector('[data-message-id="' + messageId + '"]')` — if this container doesn't exist yet (the message was just pushed to the array), the observer also fails.

### Fix

Replace the timing-sensitive approach with a more robust pattern:

```javascript
// Replace renderChart in research.html

renderChart(messageIndex, payload) {
    console.log('[renderChart] Called with messageIndex:', messageIndex, 'payload:', payload?.chartType, payload?.title);
    if (!payload || !payload.datasets || payload.datasets.length === 0) {
        console.warn('[renderChart] Invalid payload - no datasets');
        return;
    }

    var messageId = this.researchMessages[messageIndex]?.id;
    if (!messageId) {
        console.warn('[renderChart] No messageId found for index:', messageIndex);
        return;
    }

    var canvasId = 'chart-' + messageId;
    var self = this;
    var attempts = 0;
    var maxAttempts = 20; // 20 * 100ms = 2 seconds

    function tryRender() {
        attempts++;
        var canvas = document.getElementById(canvasId);
        
        if (canvas && canvas.offsetHeight > 0 && canvas.offsetWidth > 0) {
            doRender(canvas);
            return;
        }

        if (attempts < maxAttempts) {
            setTimeout(tryRender, 100);
        } else {
            console.error('[renderChart] Canvas never became visible after ' + maxAttempts + ' attempts:', canvasId);
        }
    }

    function doRender(canvas) {
        try {
            if (typeof Chart === 'undefined') {
                console.warn('[renderChart] Chart.js not loaded');
                return;
            }
            var existingChart = Chart.getChart(canvas);
            if (existingChart) existingChart.destroy();

            var chartType = payload.chartType === 'groupedBar' || payload.chartType === 'grouped_bar' ? 'bar' : payload.chartType;
            var datasets = payload.datasets.map(function(ds, idx) {
                var colors = ['#1a56db', '#7c3aed', '#059669', '#dc2626', '#d97706', '#0891b2'];
                var color = colors[idx % colors.length];
                return {
                    label: ds.label,
                    data: ds.data,
                    backgroundColor: chartType === 'line' ? 'transparent' : color + 'CC',
                    borderColor: color,
                    borderWidth: chartType === 'line' ? 2.5 : 1,
                    tension: 0.3,
                    pointRadius: chartType === 'line' ? 4 : 0,
                    pointHoverRadius: 6,
                    fill: false,
                };
            });

            new Chart(canvas, {
                type: chartType,
                data: { labels: payload.labels, datasets: datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    aspectRatio: 2,
                    plugins: {
                        title: {
                            display: true,
                            text: payload.title,
                            font: { size: 14, weight: '600' },
                            color: '#111827',
                            padding: { bottom: 16 }
                        },
                        legend: {
                            display: datasets.length > 1,
                            position: 'bottom',
                            labels: { font: { size: 11 }, usePointStyle: true, padding: 16 }
                        },
                        tooltip: {
                            backgroundColor: '#1e293b',
                            titleFont: { size: 12 },
                            bodyFont: { size: 12 },
                            padding: 12,
                            cornerRadius: 8,
                            callbacks: {
                                label: function(context) {
                                    var val = context.parsed.y;
                                    if (payload.options?.percentage) return context.dataset.label + ': ' + (val * 100).toFixed(1) + '%';
                                    if (payload.options?.currency) {
                                        if (Math.abs(val) >= 1e9) return context.dataset.label + ': $' + (val / 1e9).toFixed(1) + 'B';
                                        if (Math.abs(val) >= 1e6) return context.dataset.label + ': $' + (val / 1e6).toFixed(1) + 'M';
                                        return context.dataset.label + ': $' + val.toLocaleString();
                                    }
                                    return context.dataset.label + ': ' + val.toLocaleString();
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            ticks: {
                                callback: function(value) {
                                    if (payload.options?.percentage) return (value * 100).toFixed(0) + '%';
                                    if (payload.options?.currency) {
                                        if (Math.abs(value) >= 1e9) return '$' + (value / 1e9).toFixed(0) + 'B';
                                        if (Math.abs(value) >= 1e6) return '$' + (value / 1e6).toFixed(0) + 'M';
                                        return '$' + value.toLocaleString();
                                    }
                                    return value;
                                }
                            }
                        }
                    }
                }
            });
            console.log('[renderChart] Chart rendered successfully:', canvasId);
        } catch (e) {
            console.error('[renderChart] Error rendering chart:', e);
        }
    }

    // Start polling after a short delay to let Alpine update the DOM
    setTimeout(tryRender, 50);
},
```

---

## Root Cause #4: Formatting Issues — Markdown Flushing

### Problem

The `isMarkdownBreakpoint()` function flushes content at sentence boundaries. But for structured responses with tables, the content often looks like:

```
| Metric | AAPL FY2023 | AAPL FY2024 | MSFT FY2023 | MSFT FY2024 |
|--------|-------------|-------------|-------------|-------------|
| Revenue | $383.3B | $391.0B | $211.9B | $245.1B |
```

The markdown table rendering has issues:
1. Tables are flushed mid-row (the `|` character at end of line triggers flush, but the separator row may not have arrived yet)
2. `renderMarkdown()` uses `marked.parse()` but also has a custom `tryRenderMarkdownTable()` that runs first — these can conflict

### Fix

Improve the markdown breakpoint detection to not flush mid-table:

```javascript
// Replace isMarkdownBreakpoint in research.html

isMarkdownBreakpoint(text) {
    if (!text) return false;
    
    // Never flush mid-table: if text ends with a table row but the
    // separator row (|---|) hasn't appeared yet, wait
    var lines = text.split('\n');
    var lastNonEmpty = '';
    for (var i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim()) { lastNonEmpty = lines[i].trim(); break; }
    }
    
    // If we're inside a table (line starts/ends with |), only flush 
    // after a complete table (double newline after table)
    if (lastNonEmpty.startsWith('|') || lastNonEmpty.endsWith('|')) {
        // Only flush if text ends with table followed by double newline
        if (text.endsWith('|\n\n')) return true;
        return false;  // Wait for more table rows
    }
    
    // Flush at double newline (paragraph boundary)
    if (text.endsWith('\n\n')) return true;
    
    // Flush at sentence boundary with lookahead
    if (/\.\s+[A-Z]/.test(text.slice(-20)) || text.endsWith('.\n')) return true;
    
    // Safety valve: flush every 300 chars (increased from 200 for tables)
    var lastFlush = this._lastMarkdownFlush || 0;
    if (text.length - lastFlush > 300) {
        this._lastMarkdownFlush = text.length;
        return true;
    }
    return false;
},
```

---

## Root Cause #5: `done` Event Not Streamed by Service

### Problem

Looking at the research assistant service's generator, the `done` event is NOT yielded:

```typescript
// src/research/research-assistant.service.ts — stream generator
// ... yields source, citations, visualization, tokens
// But never yields: { type: 'done', data: { complete: true } }
```

The controller wraps with `subscriber.complete()` which closes the Observable, but with manual SSE (the fix for Root Cause #1), we need to explicitly send the `done` event. The current code relies on the stream ending naturally, but the frontend needs the `done` event to finalize the message.

### Fix

Add a `done` yield at the end of the generator in `research-assistant.service.ts`:

```typescript
// At the end of the sendMessage generator, after all token yields:

yield {
    type: 'done' as const,
    data: { complete: true },
};
```

Actually, looking more carefully, the controller fix in Root Cause #1 already adds the done event after the stream ends. So this is covered.

---

## Summary: Implementation Order

1. **Fix #1 (SSE Controller)** — Replace `@Sse()` decorator with manual `res.write()` SSE streaming. This is the most impactful fix — it likely unblocks both charts AND citations.

2. **Fix #3 (Chart Timing)** — Replace MutationObserver with polling retry loop for canvas readiness.

3. **Fix #2 (Metric Citations)** — Generate citations from structured metrics when no narratives available.

4. **Fix #4 (Markdown Tables)** — Fix flush breakpoint detection to not cut tables mid-render.

**Fix #1 alone may resolve 80%+ of the issues.** Start there and test before applying the others.

---

## Quick Test After Fix #1

After applying the SSE controller fix, test with browser DevTools Network tab:

1. Open the research page for AAPL
2. Send: `AAPL vs MSFT revenue FY 2023 - 2024`
3. In Network tab, find the POST request to `/api/research/conversations/{id}/messages`
4. Check the Response tab — you should see:
   ```
   event: source
   data: {"title":"AAPL 10-K",...}
   
   event: visualization  
   data: {"chartType":"line","title":"Revenue Trend...",...}
   
   event: citations
   data: {"citations":[{"number":1,...}]}
   
   event: token
   data: {"text":"Based on..."}
   ```

If you see `event:` lines, the fix is working. If you only see `data:` lines without `event:`, the NestJS serialization is still stripping event types.
