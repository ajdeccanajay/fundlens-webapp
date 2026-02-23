# Bugfix Requirements Document

## Introduction

Three critical bugs in the RAG research assistant pipeline cause degraded user experience: (1) gibberish queries produce fabricated answers because the workspace context ticker overrides all clarification checks, bypassing input validation entirely; (2) charts fail to render due to a race condition during live streaming and are lost on page reload because visualization data is not persisted in message metadata; (3) citations never appear because the synthesis prompt never instructs Claude to include `[N]` citation markers, so the extraction logic finds zero matches.

## Bug Analysis

### Current Behavior (Defect)

**Bug 1: Gibberish Input Produces Fabricated Answers**

1.1 WHEN a user submits a nonsensical/gibberish query (e.g., "asdfghjkl xyz") from a workspace with a context ticker THEN the system processes the gibberish as a valid query, retrieves data for the workspace ticker, and synthesizes a full answer from whatever data it finds — producing a fabricated response with no relation to the input

1.2 WHEN the LLM intent classifier returns low confidence and sets `needsClarification = true` for a gibberish query AND a `contextTicker` is provided THEN the `detectIntent` method at line ~207 overrides `needsClarification` to `false`, suppressing the clarification prompt

1.3 WHEN `intent.needsClarification` survives to `rag.service.ts` but `options.ticker` is set from the workspace context THEN the `hasExplicitTicker` check at line ~97 skips clarification a second time, creating a double-bypass where no gibberish query from a workspace context can ever trigger clarification

**Bug 2: Charts Fail to Render and Do Not Persist**

1.4 WHEN a visualization SSE event arrives during live streaming THEN `renderChart` fires inside `$nextTick` which may execute before Alpine.js has applied the style change (from `height:0;overflow:hidden` to `min-height:200px`) to the DOM, causing Chart.js to render into a zero-height container and produce an invisible chart

1.5 WHEN an assistant message with a visualization is saved via `saveMessage()` THEN the metadata object contains only `{ tickers, intent, processingInfo, latency, cost }` — the `visualization` field from `ragResult.visualization` is not included

1.6 WHEN conversation history is loaded via `getConversationMessages()` THEN `metadata.visualization` is always `undefined` because it was never persisted, so charts are permanently lost on page reload

**Bug 3: Citations Never Appear in Responses**

1.7 WHEN `buildStructuredPrompt` in `hybrid-synthesis.service.ts` constructs the synthesis prompt for Claude THEN the prompt instructs "Use ONLY the data provided" but never instructs Claude to include `[N]` citation markers referencing the provided narrative sources

1.8 WHEN `extractCitations` searches Claude's response for `[N]` patterns to map them to narrative chunks THEN it finds zero matches because Claude was never told to include these markers, resulting in an empty citations array sent to the frontend

### Expected Behavior (Correct)

**Bug 1: Input Validation**

2.1 WHEN a user submits a nonsensical/gibberish query from a workspace with a context ticker THEN the system SHALL validate query quality before processing and return a clarification prompt asking the user to rephrase, rather than fabricating an answer

2.2 WHEN the LLM intent classifier returns low confidence for a query AND a `contextTicker` is provided THEN the system SHALL NOT unconditionally override `needsClarification` to `false` — the workspace ticker should provide ticker context but SHALL NOT suppress clarification for genuinely unintelligible queries

2.3 WHEN `intent.needsClarification` is true and the query itself is nonsensical THEN the system SHALL trigger clarification regardless of whether `options.ticker` or `options.tickers` are set, distinguishing between "we don't know the ticker" (workspace context helps) and "we don't understand the query" (workspace context does not help)

#### Implementation Constraints for Bug 1

**Gibberish detection mechanism**: Use a lightweight deterministic heuristic — NOT an additional LLM call. The `isGibberish(query)` function SHALL check:
- Minimum 2 dictionary-recognizable English tokens in the query, OR
- At least one known financial term (metric name, ticker symbol, filing type, section reference) present in the query text
- This keeps detection deterministic and consistent with the "deterministic when you can" principle

**Fix location**: The fix SHALL be applied at the intent detector level only (`intent-detector.service.ts`, line ~207). The override at line ~207 currently reads:
```typescript
if (contextTicker && resolvedIntent.needsClarification) {
  resolvedIntent.needsClarification = false;
}
```
This SHALL be made conditional: only suppress `needsClarification` when the LLM's `ambiguityReason` indicates "missing ticker" or similar ticker-related ambiguity — NOT when the reason indicates an unintelligible/nonsensical query. The LLM classification response already includes `ambiguityReason` and `confidence` fields that provide sufficient signal to distinguish these cases. Once the intent detector correctly preserves `needsClarification = true` for gibberish, the second bypass in `rag.service.ts` (line ~97) becomes a non-issue because clarification is already correctly set upstream.

**Concrete test cases**:
- `{ query: "asdfghjkl", contextTicker: "AAPL" }` → clarification response
- `{ query: "xyz 123 bbb qqq", contextTicker: "MSFT" }` → clarification response
- `{ query: "revenue", contextTicker: "AAPL" }` → normal response (valid financial term)
- `{ query: "What is the growth rate?", contextTicker: "AAPL" }` → normal response (intelligible query, ticker from context)
- `{ query: "Tell me about Tesla", contextTicker: "TSLA" }` → normal response (vague but intelligible, ticker matches context)

**Bug 2: Chart Rendering and Persistence**

2.4 WHEN a visualization SSE event arrives during live streaming THEN the system SHALL ensure the chart container is visible and has non-zero dimensions in the DOM before invoking Chart.js rendering, using a retry loop: `requestAnimationFrame` → check `canvas.offsetHeight > 0` → if zero, retry up to N times. The existing retry mechanism (5 retries at 200ms) is the right pattern — it needs the dimension check added as an additional retry condition alongside the "canvas not found" check.

2.5 WHEN an assistant message with a visualization is saved via `saveMessage()` THEN the metadata object SHALL include the `visualization` field from `ragResult.visualization` so it is persisted to the database

2.6 WHEN conversation history is loaded via `getConversationMessages()` THEN `metadata.visualization` SHALL contain the persisted visualization data, and charts SHALL render correctly from history

**Concrete test cases for Bug 2**:
- Visualization SSE event arrives → canvas exists but `offsetHeight === 0` → retry fires → Alpine applies style → `offsetHeight > 0` → Chart.js renders successfully
- `saveMessage()` called with `ragResult.visualization = { chartType: 'grouped_bar', datasets: [...] }` → saved metadata includes `visualization` field
- `getConversationMessages()` for a conversation with charts → returned messages include `visualization` data → `renderExistingCharts()` renders them

**Bug 3: Citation Generation**

2.7 WHEN `buildStructuredPrompt` constructs the synthesis prompt and narrative sources are provided THEN the prompt SHALL instruct Claude to reference sources using `[N]` citation markers (e.g., `[1]`, `[2]`) corresponding to the numbered narrative chunks in the prompt. The `formatNarratives` method currently labels chunks as `[TICKER | sectionType | fiscalPeriod]` — these labels SHALL be changed to numbered references `[1]`, `[2]`, etc. and the prompt SHALL include an explicit instruction like: "Reference sources using [1], [2], etc. notation corresponding to the numbered narrative sources above."

2.8 WHEN `extractCitations` processes Claude's response THEN it SHALL find `[N]` markers in the response text and correctly map them to the corresponding narrative chunks, producing a non-empty citations array that the frontend can render as clickable citation links

**Concrete test cases for Bug 3**:
- `{ narratives: [chunk1_AAPL_item7, chunk2_AAPL_item1a] }` → prompt contains "Reference sources using [1], [2]" AND narratives labeled as `[1] AAPL | item_7 | FY2024` and `[2] AAPL | item_1a | FY2024`
- `{ narratives: [] }` → prompt does NOT contain citation instructions (preservation: no-narrative queries unaffected)
- Claude response containing `[1]` and `[2]` markers → `extractCitations` returns 2 citation objects mapped to the correct narrative chunks

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user submits a well-formed financial query (e.g., "What is AAPL's revenue?") from a workspace with a context ticker THEN the system SHALL CONTINUE TO process the query normally and return a data-backed answer without triggering unnecessary clarification

3.2 WHEN a user submits a query that lacks a ticker but is otherwise intelligible (e.g., "What is the revenue growth rate?") from a workspace with a context ticker THEN the system SHALL CONTINUE TO use the workspace ticker to resolve the query without asking for clarification

3.3 WHEN a visualization SSE event arrives and the chart container is already visible and properly sized THEN the system SHALL CONTINUE TO render charts correctly as it does today in the non-race-condition case

3.4 WHEN messages without visualizations are saved and loaded THEN the system SHALL CONTINUE TO load and display them correctly with no changes to existing message rendering

3.5 WHEN the RAG pipeline processes queries that only return structured metrics (no narratives) THEN the system SHALL CONTINUE TO return answers without citations, as there are no narrative sources to cite

3.6 WHEN the synthesis prompt is built for queries with only quantitative data and no narrative context THEN the system SHALL CONTINUE TO omit citation instructions since there are no narrative sources to reference

---

## Bug Condition Derivation

### Bug 1: Gibberish Input Bypass

```pascal
FUNCTION isGibberish(query: string): boolean
  INPUT: query string
  OUTPUT: boolean — true if query is nonsensical
  
  tokens ← splitIntoWords(query)
  
  // Check 1: At least one known financial term (ticker, metric, filing type, section)
  IF containsKnownFinancialTerm(tokens) THEN RETURN false
  
  // Check 2: At least 2 dictionary-recognizable English words
  dictWordCount ← countDictionaryWords(tokens)
  IF dictWordCount >= 2 THEN RETURN false
  
  // Neither condition met — query is gibberish
  RETURN true
END FUNCTION

FUNCTION isBugCondition_InputValidation(X)
  INPUT: X of type { query: string, contextTicker: string | undefined }
  OUTPUT: boolean
  
  // Bug triggers when query is nonsensical AND workspace ticker is present
  RETURN isGibberish(X.query) AND X.contextTicker IS NOT NULL
END FUNCTION
```

```pascal
// Property: Fix Checking — Gibberish queries should trigger clarification
FOR ALL X WHERE isBugCondition_InputValidation(X) DO
  result ← sendMessage'(X)
  ASSERT result.needsClarification = true OR result.type = 'clarification'
END FOR
```

```pascal
// Property: Preservation Checking — Valid queries unaffected
FOR ALL X WHERE NOT isBugCondition_InputValidation(X) DO
  ASSERT sendMessage(X) = sendMessage'(X)
END FOR
```

**Fix location**: `intent-detector.service.ts` line ~207 only. Make the `contextTicker` override conditional on `ambiguityReason` indicating a ticker-related issue (not an unintelligible query). The `rag.service.ts` bypass becomes moot once the upstream fix is in place.

### Bug 2: Chart Rendering Race Condition and Persistence

```pascal
FUNCTION isBugCondition_ChartRendering(X)
  INPUT: X of type { hasVisualization: boolean, isLiveStreaming: boolean }
  OUTPUT: boolean
  
  RETURN X.hasVisualization AND X.isLiveStreaming
END FUNCTION
```

```pascal
// Property: Fix Checking — Charts render with correct dimensions
FOR ALL X WHERE isBugCondition_ChartRendering(X) DO
  result ← renderChart'(X)
  ASSERT result.canvas.offsetHeight > 0 AND result.chartRendered = true
END FOR
```

```pascal
FUNCTION isBugCondition_ChartPersistence(X)
  INPUT: X of type { ragResult: RAGResponse }
  OUTPUT: boolean
  
  RETURN X.ragResult.visualization IS NOT NULL
END FUNCTION
```

```pascal
// Property: Fix Checking — Visualization persisted in metadata
FOR ALL X WHERE isBugCondition_ChartPersistence(X) DO
  savedMessage ← saveMessage'(X)
  loadedMessage ← getConversationMessages'(X.conversationId)
  ASSERT loadedMessage.visualization = X.ragResult.visualization
END FOR
```

```pascal
// Property: Preservation Checking — Messages without visualization unaffected
FOR ALL X WHERE NOT isBugCondition_ChartPersistence(X) DO
  ASSERT saveMessage(X) = saveMessage'(X)
END FOR
```

### Bug 3: Missing Citation Instructions

```pascal
FUNCTION isBugCondition_Citations(X)
  INPUT: X of type FinancialAnalysisContext
  OUTPUT: boolean
  
  RETURN X.narratives IS NOT NULL AND length(X.narratives) > 0
END FUNCTION
```

```pascal
// Property: Fix Checking — Prompt includes citation instructions when narratives present
FOR ALL X WHERE isBugCondition_Citations(X) DO
  prompt ← buildStructuredPrompt'(X)
  ASSERT prompt CONTAINS citation_instruction_pattern
  
  response ← synthesize'(X)
  ASSERT length(response.citations) > 0
END FOR
```

```pascal
// Property: Preservation Checking — No-narrative queries unaffected
FOR ALL X WHERE NOT isBugCondition_Citations(X) DO
  ASSERT buildStructuredPrompt(X) = buildStructuredPrompt'(X)
END FOR
```
