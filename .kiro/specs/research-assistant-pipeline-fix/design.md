# Research Assistant Pipeline Fix — Bugfix Design

## Overview

Three bugs in the RAG research assistant pipeline degrade user experience: (1) gibberish queries bypass clarification when a workspace context ticker is present, producing fabricated answers; (2) charts fail to render due to a race condition where Chart.js fires before the canvas has non-zero dimensions, and visualization data is not persisted in message metadata so charts are lost on reload; (3) citations never appear because the synthesis prompt never instructs Claude to use `[N]` markers, so `extractCitations` finds zero matches.

The fix strategy is minimal and targeted: each bug has a single root cause in a single file (or two files for Bug 2), and the fixes are independent of each other.

## Glossary

- **Bug_Condition (C)**: The condition that triggers each bug — gibberish + contextTicker, visualization SSE + zero-height canvas, narratives present but no citation instruction
- **Property (P)**: The desired behavior — clarification for gibberish, chart renders with non-zero dimensions, citations appear in responses
- **Preservation**: Existing behavior that must remain unchanged — valid queries proceed normally, non-visualization messages unaffected, no-narrative queries omit citations
- **`detectIntent()`**: Method in `intent-detector.service.ts` that classifies user queries and determines if clarification is needed
- **`contextTicker`**: The workspace-level ticker symbol that provides company context for queries
- **`ambiguityReason`**: Field in `LlmClassificationResult` that explains why the LLM flagged a query as ambiguous
- **`renderChart()`**: Frontend function in `research.html` that creates Chart.js instances in canvas elements
- **`saveMessage()`**: Method in `research-assistant.service.ts` that persists assistant messages with metadata
- **`buildStructuredPrompt()`**: Method in `hybrid-synthesis.service.ts` that constructs the Claude synthesis prompt
- **`formatNarratives()`**: Method in `hybrid-synthesis.service.ts` that formats narrative chunks for the prompt
- **`extractCitations()`**: Method in `hybrid-synthesis.service.ts` that parses `[N]` patterns from Claude's response

## Bug Details

### Fault Condition

The three bugs manifest under distinct conditions:

**Bug 1** triggers when a user submits a nonsensical query from a workspace with a context ticker. The `detectIntent` method at lines 199–203 unconditionally overrides `needsClarification = false` when `contextTicker` is present, regardless of whether the ambiguity is "missing ticker" or "unintelligible query."

**Bug 2** triggers when a visualization SSE event arrives during live streaming. The `renderChart` function fires inside `$nextTick`, which may execute before Alpine.js has flushed the style change from `height:0;overflow:hidden` to `min-height:200px`, causing Chart.js to render into a zero-height canvas. Additionally, `saveMessage()` omits `visualization` from the metadata object, so charts are permanently lost on page reload.

**Bug 3** triggers when narrative chunks are present in the synthesis context. The `formatNarratives` method labels chunks as `[TICKER | sectionType | fiscalPeriod]` instead of numbered `[1]`, `[2]` references, and the prompt never instructs Claude to use `[N]` citation markers. Since `extractCitations` searches for `\[(\d+)\]` patterns, it finds zero matches.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type { query: string, contextTicker: string | undefined, hasVisualization: boolean, isLiveStreaming: boolean, narratives: ChunkResult[] }
  OUTPUT: { bug1: boolean, bug2_render: boolean, bug2_persist: boolean, bug3: boolean }

  bug1 := isGibberish(input.query) AND input.contextTicker IS NOT NULL
  bug2_render := input.hasVisualization AND input.isLiveStreaming
  bug2_persist := input.hasVisualization
  bug3 := input.narratives IS NOT NULL AND length(input.narratives) > 0

  RETURN { bug1, bug2_render, bug2_persist, bug3 }
END FUNCTION

FUNCTION isGibberish(query: string): boolean
  tokens ← splitIntoWords(query)
  IF containsKnownFinancialTerm(tokens) THEN RETURN false
  dictWordCount ← countDictionaryWords(tokens)
  IF dictWordCount >= 2 THEN RETURN false
  RETURN true
END FUNCTION
```

### Examples

- `{ query: "asdfghjkl", contextTicker: "AAPL" }` → Bug 1: system fabricates answer instead of asking for clarification
- `{ query: "xyz 123 bbb qqq", contextTicker: "MSFT" }` → Bug 1: gibberish processed as valid query
- Visualization SSE arrives, canvas `offsetHeight === 0` → Bug 2: Chart.js renders invisible chart
- `saveMessage()` called with `ragResult.visualization = { chartType: 'grouped_bar', ... }` → Bug 2: visualization not in persisted metadata
- `getConversationMessages()` for conversation with charts → Bug 2: `metadata.visualization` is `undefined`
- `buildStructuredPrompt()` with 3 narrative chunks → Bug 3: prompt contains `[AAPL | item_7 | FY2024]` labels, no `[1]` numbering, no citation instruction → Claude produces no `[N]` markers → `extractCitations` returns `[]`

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Well-formed financial queries (e.g., "What is AAPL's revenue?") from a workspace with a context ticker must continue to process normally without triggering clarification
- Queries that lack a ticker but are otherwise intelligible (e.g., "What is the revenue growth rate?") from a workspace must continue to use the workspace ticker
- Charts that render successfully in the non-race-condition case (canvas already visible) must continue to work
- Messages without visualizations must save and load identically
- Queries with only quantitative data (no narratives) must continue to return answers without citations
- Synthesis prompts for queries with no narrative context must continue to omit citation instructions

**Scope:**
All inputs that do NOT match the bug conditions should be completely unaffected by these fixes. This includes:
- Intelligible queries with or without context tickers
- Mouse/keyboard interactions unrelated to chart rendering
- Messages without visualization data
- Queries that produce only structured metric results (no narratives)

## Hypothesized Root Cause

Based on code analysis, the root causes are:

1. **Bug 1 — Unconditional contextTicker Override**: In `intent-detector.service.ts` lines 199–203, the code:
   ```typescript
   if (contextTicker && resolvedIntent.needsClarification) {
     resolvedIntent.needsClarification = false;
     resolvedIntent.ambiguityReason = undefined;
   }
   ```
   This treats ALL clarification needs as "missing ticker" problems. It does not inspect `ambiguityReason` to distinguish "missing ticker" from "unintelligible query." The LLM already provides `ambiguityReason` in its classification result, but the override ignores it entirely.

2. **Bug 2a — Race Condition in renderChart**: The existing retry loop checks whether the canvas element exists and whether Chart.js is loaded, but does NOT check whether the canvas has non-zero dimensions (`canvas.offsetHeight > 0`). When Alpine.js hasn't yet flushed the style change, the canvas exists but has zero height.

3. **Bug 2b — Missing Visualization in saveMessage Metadata**: In `research-assistant.service.ts`, the `saveMessage()` call for assistant messages constructs metadata as:
   ```typescript
   metadata: { tickers, intent, processingInfo, latency, cost }
   ```
   The `visualization` field from `ragResult.visualization` is simply not included. The `getConversationMessages()` method already reads `metadata.visualization` — it just finds `undefined`.

4. **Bug 3 — No Citation Instruction in Prompt**: In `hybrid-synthesis.service.ts`, `formatNarratives()` labels chunks as `[TICKER | sectionType | fiscalPeriod]` (line 430). The `buildStructuredPrompt()` method never adds an instruction telling Claude to use `[N]` citation markers. Meanwhile, `extractCitations()` correctly parses `\[(\d+)\]` patterns — it just never finds any because Claude was never told to produce them.

## Correctness Properties

Property 1: Fault Condition — Gibberish Queries Trigger Clarification

_For any_ input where the query is gibberish (isGibberish returns true) and a contextTicker is present, the fixed `detectIntent` function SHALL preserve `needsClarification = true` and NOT override it to false, resulting in a clarification response to the user.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — Valid Queries With Context Ticker Proceed Normally

_For any_ input where the query is NOT gibberish (isGibberish returns false) and a contextTicker is present with a ticker-related ambiguityReason, the fixed `detectIntent` function SHALL continue to override `needsClarification = false`, preserving the existing behavior where workspace context resolves ticker ambiguity.

**Validates: Requirements 3.1, 3.2**

Property 3: Fault Condition — Charts Render With Non-Zero Dimensions

_For any_ visualization SSE event arriving during live streaming, the fixed `renderChart` function SHALL wait (via requestAnimationFrame + retry loop with dimension check) until `canvas.offsetHeight > 0` before invoking Chart.js, ensuring the chart is visible.

**Validates: Requirements 2.4**

Property 4: Fault Condition — Visualization Data Persisted in Metadata

_For any_ assistant message where `ragResult.visualization` is not null, the fixed `saveMessage` call SHALL include `visualization: ragResult.visualization` in the metadata object, ensuring charts survive page reload.

**Validates: Requirements 2.5, 2.6**

Property 5: Preservation — Messages Without Visualization Unaffected

_For any_ assistant message where `ragResult.visualization` is null or undefined, the fixed `saveMessage` call SHALL produce the same metadata as the original, preserving existing message persistence behavior.

**Validates: Requirements 3.4**

Property 6: Fault Condition — Prompt Includes Citation Instructions When Narratives Present

_For any_ synthesis context where narratives are present (length > 0), the fixed `buildStructuredPrompt` SHALL include numbered `[1]`, `[2]`, etc. labels in the narrative section AND an explicit citation instruction, enabling `extractCitations` to find matches in Claude's response.

**Validates: Requirements 2.7, 2.8**

Property 7: Preservation — No-Narrative Queries Omit Citation Instructions

_For any_ synthesis context where narratives are empty or null, the fixed `buildStructuredPrompt` SHALL produce the same prompt as the original, with no citation instructions added.

**Validates: Requirements 3.5, 3.6**


## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

### Bug 1: Gibberish Input Bypass

**File**: `src/rag/intent-detector.service.ts`

**Function**: `detectIntent()` — lines 192–203

**Specific Changes**:

1. **Add `isGibberish()` helper method**: A lightweight deterministic heuristic that checks:
   - Whether the query contains at least one known financial term (metric name, ticker symbol, filing type like "10-K", section reference like "item 7")
   - Whether the query contains at least 2 dictionary-recognizable English words
   - Returns `true` if neither condition is met

2. **Make contextTicker override conditional on ambiguityReason**: Replace the unconditional override at lines 199–203:
   ```typescript
   // BEFORE (buggy):
   if (contextTicker && resolvedIntent.needsClarification) {
     resolvedIntent.needsClarification = false;
     resolvedIntent.ambiguityReason = undefined;
   }

   // AFTER (fixed):
   if (contextTicker && resolvedIntent.needsClarification) {
     const isTickerRelatedAmbiguity = !resolvedIntent.ambiguityReason ||
       resolvedIntent.ambiguityReason.toLowerCase().includes('ticker') ||
       resolvedIntent.ambiguityReason.toLowerCase().includes('company') ||
       resolvedIntent.ambiguityReason.toLowerCase().includes('missing');
     
     if (isTickerRelatedAmbiguity && !isGibberish(query)) {
       resolvedIntent.needsClarification = false;
       resolvedIntent.ambiguityReason = undefined;
     }
   }
   ```

3. **No changes to `rag.service.ts`**: The second bypass at line ~97 becomes moot once the upstream fix correctly preserves `needsClarification = true` for gibberish queries.

### Bug 2: Chart Rendering Race Condition and Persistence

**File 1**: `public/app/deals/research.html`

**Function**: `renderChart()` — existing retry loop

**Specific Changes**:

1. **Add `requestAnimationFrame` before first dimension check**: Ensures Alpine.js has flushed DOM changes before measuring canvas dimensions.

2. **Add `canvas.offsetHeight > 0` check to retry condition**: The existing retry loop (5 retries at 200ms) already checks for canvas existence and Chart.js availability. Add dimension check as an additional condition:
   ```javascript
   // Inside retry loop, add this check alongside existing checks:
   if (canvas.offsetHeight === 0) {
     // Canvas exists but has zero height — Alpine hasn't flushed yet, retry
     retryCount++;
     setTimeout(() => tryRender(), 200);
     return;
   }
   ```

**File 2**: `src/research/research-assistant.service.ts`

**Function**: `sendMessage()` — the `saveMessage()` call for assistant messages (line ~620)

**Specific Changes**:

3. **Add `visualization` to metadata object**:
   ```typescript
   // BEFORE:
   metadata: {
     tickers,
     intent: ragResult.intent,
     processingInfo: ragResult.processingInfo,
     latency: ragResult.latency,
     cost: ragResult.cost,
   },

   // AFTER:
   metadata: {
     tickers,
     intent: ragResult.intent,
     processingInfo: ragResult.processingInfo,
     latency: ragResult.latency,
     cost: ragResult.cost,
     visualization: ragResult.visualization || undefined,
   },
   ```

### Bug 3: Missing Citation Instructions

**File**: `src/rag/hybrid-synthesis.service.ts`

**Function 1**: `formatNarratives()` — line 404

**Specific Changes**:

1. **Change chunk labels from descriptive to numbered**: Replace `[TICKER | sectionType | fiscalPeriod]` with `[1] TICKER | sectionType | fiscalPeriod`, `[2] ...`, etc.:
   ```typescript
   // BEFORE:
   blocks.push(`[${attribution}]\n${content}`);

   // AFTER:
   const index = blocks.length + 1;
   blocks.push(`[${index}] ${attribution}\n${content}`);
   ```

> **⚠️ Synthesis Quality Risk**: Changing `formatNarratives()` to use numbered labels alters the prompt structure Claude receives. While `[1] AAPL | item_7 | FY2024` is better than `[AAPL | item_7 | FY2024]` for citation purposes, this also changes the information Claude uses to attribute context. The numbered format is a net improvement, but LLM output quality shifts cannot be caught by formal preservation tests. **After deploying this fix, run a handful of representative queries manually and compare synthesis quality against pre-fix outputs** to verify no regression in answer coherence or attribution accuracy.

**Function 2**: `buildStructuredPrompt()` — line 189

**Specific Changes**:

2. **Add citation instruction when narratives are present**: After the narrative block is added to the prompt, inject a citation instruction:
   ```typescript
   if (narrativeBlock) {
     sections.push('=== NARRATIVE CONTEXT ===', narrativeBlock, '');
     sections.push(
       'CITATION RULE: Reference narrative sources using [1], [2], etc. notation ' +
       'corresponding to the numbered sources above. Every claim derived from ' +
       'narrative context MUST include a citation marker.'
     );
   }
   ```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that exercise each bug condition on the UNFIXED code to observe failures and confirm root causes.

**Test Cases**:
1. **Gibberish with contextTicker**: Call `detectIntent("asdfghjkl", tenantId, "AAPL")` — expect `needsClarification = true` but observe `false` (will fail on unfixed code)
2. **Chart render with zero-height canvas**: Simulate visualization SSE event with canvas `offsetHeight === 0` — expect retry, observe immediate render failure (will fail on unfixed code)
3. **Visualization persistence**: Call `saveMessage()` with `ragResult.visualization` present — expect visualization in metadata, observe it missing (will fail on unfixed code)
4. **Citation generation**: Call `buildStructuredPrompt()` with narratives — expect `[1]`, `[2]` labels and citation instruction, observe `[AAPL | item_7 | FY2024]` labels and no instruction (will fail on unfixed code)

**Expected Counterexamples**:
- `detectIntent("asdfghjkl", t, "AAPL")` returns `{ needsClarification: false }` — confirms unconditional override
- `formatNarratives([chunk1, chunk2])` returns `[AAPL | item_7 | FY2024]\ncontent...` — confirms no numbered labels
- `buildStructuredPrompt({ narratives: [chunk1] })` does not contain "Reference sources using [1]" — confirms no citation instruction

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
// Bug 1
FOR ALL input WHERE isGibberish(input.query) AND input.contextTicker IS NOT NULL DO
  result := detectIntent'(input.query, tenantId, input.contextTicker)
  ASSERT result.needsClarification = true
END FOR

// Bug 2 (persistence)
FOR ALL input WHERE input.ragResult.visualization IS NOT NULL DO
  savedMessage := saveMessage'(conversationId, 'assistant', content, { metadata with visualization })
  loadedMessage := getConversationMessages'(conversationId)
  ASSERT loadedMessage.visualization IS NOT NULL
END FOR

// Bug 3
FOR ALL input WHERE length(input.narratives) > 0 DO
  prompt := buildStructuredPrompt'(input)
  ASSERT prompt CONTAINS '[1]'
  ASSERT prompt CONTAINS 'Reference narrative sources using [1], [2]'
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
// Bug 1 preservation
FOR ALL input WHERE NOT isGibberish(input.query) AND input.contextTicker IS NOT NULL DO
  ASSERT detectIntent(input) = detectIntent'(input)
END FOR

// Bug 2 preservation
FOR ALL input WHERE input.ragResult.visualization IS NULL DO
  ASSERT saveMessage(input) = saveMessage'(input)
END FOR

// Bug 3 preservation
FOR ALL input WHERE length(input.narratives) = 0 DO
  ASSERT buildStructuredPrompt(input) = buildStructuredPrompt'(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for valid queries, non-visualization messages, and no-narrative prompts, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Valid Query Preservation**: Verify `detectIntent("What is AAPL revenue?", t, "AAPL")` continues to return `needsClarification = false` after fix
2. **Ticker-Ambiguity Preservation**: Verify `detectIntent("What is the growth rate?", t, "AAPL")` with ambiguityReason containing "ticker" continues to suppress clarification
3. **Non-Visualization Message Preservation**: Verify `saveMessage()` without visualization produces identical metadata
4. **No-Narrative Prompt Preservation**: Verify `buildStructuredPrompt({ narratives: [] })` produces identical prompt

### Unit Tests

- Test `isGibberish()` with gibberish inputs ("asdfghjkl", "xyz 123 bbb"), valid financial terms ("revenue", "10-K"), and edge cases ("a", "the", single financial term)
- Test `detectIntent()` conditional override logic with various `ambiguityReason` values
- Test `formatNarratives()` produces numbered `[1]`, `[2]` labels
- Test `buildStructuredPrompt()` includes citation instruction when narratives present, omits when absent
- Test `saveMessage()` metadata includes `visualization` when present, omits when absent

### Property-Based Tests

> **Note on PBT feasibility**: The property-based tests below are valuable for hardening but may be aspirational for the pilot timeline. Generating "random valid financial queries" that are guaranteed non-gibberish is non-trivial — the generator needs to produce syntactically and semantically plausible financial language, which is a design challenge in itself. **Prioritize unit tests and integration tests first.** Treat PBT as a follow-up hardening pass once the fixes are validated through deterministic tests.

- Generate random gibberish strings and verify `isGibberish()` returns true; generate random valid financial queries and verify it returns false
- Generate random `ambiguityReason` values and verify the conditional override logic correctly distinguishes ticker-related from non-ticker-related ambiguity
- Generate random narrative chunk arrays and verify `formatNarratives()` always produces sequential numbered labels `[1]` through `[N]`
- Generate random `FinancialAnalysisContext` objects with and without narratives and verify citation instruction presence/absence

### Integration Tests

- End-to-end test: submit gibberish query from workspace → verify clarification response returned
- End-to-end test: submit valid query from workspace → verify normal response returned
- End-to-end test: query that produces visualization → verify chart data persisted → reload conversation → verify chart renders from history
- End-to-end test: query that produces narrative synthesis → verify response contains `[1]`, `[2]` citation markers → verify `extractCitations` returns non-empty array

## Deployment Sequencing

These three fixes are independent and can ship separately. The recommended deployment order minimizes risk by shipping the safest changes first:

1. **Bug 2b (Visualization Persistence) — Ship First**: Zero behavioral change for existing messages. This is purely additive — it adds a `visualization` field to saved metadata that was previously omitted. No existing code paths are altered, no prompt changes, no heuristic tuning. Lowest risk.

2. **Bug 3 (Citation Instructions) — Ship Second**: Changes the prompt structure by switching to numbered narrative labels and adding a citation instruction. Easy to verify — run a few representative queries and confirm citations appear in responses. The prompt change is well-scoped and the `extractCitations` regex is already correct. Manual verification of synthesis quality is recommended post-deploy (see note in Fix Implementation above) since formal tests cannot catch LLM output quality shifts.

3. **Bug 1 (Gibberish Detection) — Ship Last**: Has the most edge cases around the gibberish/valid boundary. The `isGibberish()` heuristic needs to correctly classify queries like "revenue" (valid — single financial term), "Tell me about Tesla" (valid — intelligible English), and "asdfghjkl xyz" (gibberish). If the heuristic needs tuning after real usage, shipping it last means the other two fixes are already live and unaffected.
