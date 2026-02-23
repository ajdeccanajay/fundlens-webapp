# Implementation Plan

> **Deployment Sequencing**: These three fixes are independent and should ship in this order: Bug 2b (persistence) first — zero behavioral change, purely additive. Bug 3 (citations) second — prompt change, easy to verify. Bug 1 (gibberish detection) last — most edge cases, may need tuning after real usage. See design.md "Deployment Sequencing" section for rationale.

> **PBT Priority Note**: Property-based tests (tasks 1 and 2) are valuable for hardening but generating realistic random financial queries is non-trivial. Prioritize unit tests and integration tests for the pilot timeline. Treat PBT as a follow-up hardening pass.

> **⛔ HARD GATE**: Tasks 1–2 (if executed) are a hard gate before Task 3. Preservation baselines get contaminated if code changes happen first. **DO NOT proceed to Task 3 until Tasks 1–2 are complete or explicitly skipped.** If skipping Tasks 1–2, document the skip decision and proceed directly to Task 3.

- [ ] 1. (Optional — follow-up hardening) Write bug condition exploration tests (BEFORE implementing fixes)
  - **Property 1: Fault Condition** - Gibberish Bypass, Chart Race Condition, Citation Missing
  - **CRITICAL**: These tests MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior — they will validate the fixes when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate all three bugs exist
  - **Scoped PBT Approach**: Scope each property to the concrete failing conditions from the design
  - **Test file**: `test/properties/pipeline-fix-fault-condition.property.spec.ts`
  - **Bug 1 — Gibberish Bypass**: Test that `detectIntent("asdfghjkl", tenantId, "AAPL")` returns `needsClarification = true`. On unfixed code, the unconditional contextTicker override at line ~199 forces `needsClarification = false` for ALL queries, so this will FAIL. Use `isGibberish(query)` pseudocode from design: query must lack 2+ dictionary words AND lack any known financial term. Generate gibberish strings via fast-check (random alphanumeric tokens with no dictionary words) paired with non-null contextTicker values.
  - **Bug 2a — Chart Rendering**: Test that `renderChart()` does NOT invoke Chart.js when `canvas.offsetHeight === 0`. On unfixed code, the retry loop lacks the dimension check, so Chart.js fires into a zero-height canvas — test will FAIL. **jsdom caveat**: `canvas.offsetHeight` is always 0 in jsdom — you cannot test actual DOM measurement in Node.js. Instead, mock the dimension-checking decision logic in isolation: test that the retry-vs-render decision function returns "retry" when given `offsetHeight === 0`, and "render" when given `offsetHeight > 0`. Do NOT test actual DOM measurement. Alternatively, flag Bug 2a as integration-only and skip it in this property test file — the other three sub-properties are straightforward.
  - **Bug 2b — Visualization Persistence**: Test that `saveMessage()` metadata includes `visualization` when `ragResult.visualization` is present. On unfixed code, the metadata object omits `visualization` entirely — test will FAIL. Generate arbitrary visualization payloads `{ chartType, datasets, labels }` and assert `savedMetadata.visualization` is defined.
  - **Bug 3 — Citation Instructions**: Test that `buildStructuredPrompt()` with non-empty narratives produces a prompt containing `[1]` numbered labels AND a citation instruction string. On unfixed code, `formatNarratives()` produces `[TICKER | section | period]` labels and no instruction — test will FAIL. Generate 1–5 narrative chunks and assert prompt contains sequential `[1]`..`[N]` markers and "Reference narrative sources using [1], [2]".
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: All four sub-properties FAIL (this confirms the bugs exist)
  - Document counterexamples found for each bug
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [ ] 2. (Optional — follow-up hardening) Write preservation property tests (BEFORE implementing fixes)
  - **Property 2: Preservation** - Valid Queries, Non-Visualization Messages, No-Narrative Prompts
  - **IMPORTANT**: Follow observation-first methodology — observe behavior on UNFIXED code first
  - **Test file**: `test/properties/pipeline-fix-preservation.property.spec.ts`
  - **Preservation A — Valid Query with contextTicker**: Observe that `detectIntent("What is AAPL revenue?", tenantId, "AAPL")` returns `needsClarification = false` on unfixed code. Write property: for all queries where `isGibberish(query) = false` AND contextTicker is present with ticker-related ambiguityReason, the override SHALL continue to suppress clarification. Generate valid financial queries (containing 2+ dictionary words or a known financial term) paired with contextTicker values.
  - **Preservation B — Non-Visualization Message Metadata**: Observe that `saveMessage()` without visualization produces metadata `{ tickers, intent, processingInfo, latency, cost }` on unfixed code. Write property: for all messages where `ragResult.visualization` is null/undefined, saved metadata SHALL NOT contain a `visualization` key. Generate RAGResponse objects without visualization and assert metadata shape is unchanged.
  - **Preservation C — No-Narrative Prompt**: Observe that `buildStructuredPrompt({ narratives: [] })` produces a prompt without citation instructions on unfixed code. Write property: for all contexts where `narratives` is empty or null, the prompt SHALL NOT contain "Reference narrative sources" or `[1]` markers. Generate FinancialAnalysisContext objects with empty narratives and assert prompt omits citation content.
  - **Existing test files**: Update or coexist with `test/properties/research-assistant-preservation.property.spec.ts` (which covers streaming, markdown tables, severity badges — different scope)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: All preservation tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix for gibberish input bypass, chart rendering race condition + persistence, and missing citation instructions
  > **Implementation order matches deployment sequencing**: 3.1 (persistence, safest one-liner) → 3.2 (citations, easy to verify) → 3.3 (chart rendering) → 3.4 (gibberish detection, most edge cases). See design.md "Deployment Sequencing" for rationale.

  - [x] 3.1 Implement Bug 2b fix: visualization persistence in saveMessage metadata
    - **File**: `src/research/research-assistant.service.ts`
    - In `sendMessage()` at the `saveMessage()` call for assistant messages (line ~620), add `visualization` to metadata:
      - `visualization: ragResult.visualization || undefined`
    - `getConversationMessages()` already reads `metadata.visualization` — no changes needed there
    - _Bug_Condition: ragResult.visualization IS NOT NULL_
    - _Expected_Behavior: metadata.visualization persisted and available on reload_
    - _Preservation: Messages without visualization produce identical metadata_
    - _Requirements: 2.5, 2.6, 3.4_

  - [x] 3.2 Implement Bug 3 fix: numbered narrative labels and citation instruction
    - **File**: `src/rag/hybrid-synthesis.service.ts`
    - In `formatNarratives()` (line ~404): change chunk labels from `[TICKER | section | period]` to `[N] TICKER | section | period` where N is sequential 1-based index
      - Replace `blocks.push(\`[\${attribution}]\n\${content}\`)` with `blocks.push(\`[\${blocks.length + 1}] \${attribution}\n\${content}\`)`
    - In `buildStructuredPrompt()` (line ~189): after adding narrative block to sections, add citation instruction:
      - `'CITATION RULE: Reference narrative sources using [1], [2], etc. notation corresponding to the numbered sources above. Every claim derived from narrative context MUST include a citation marker.'`
      - Only add when `narrativeBlock` is truthy (narratives present)
    - _Bug_Condition: narratives IS NOT NULL AND length(narratives) > 0_
    - _Expected_Behavior: prompt contains [1]..[N] labels AND citation instruction; extractCitations finds matches_
    - _Preservation: No-narrative prompts omit citation instructions entirely_
    - _Requirements: 2.7, 2.8, 3.5, 3.6_
    - **⚠️ Post-deploy**: Run a handful of representative queries manually and compare synthesis quality against pre-fix outputs to verify no regression from the prompt structure change

  - [x] 3.3 Implement Bug 2a fix: chart rendering dimension check
    - **File**: `public/app/deals/research.html`
    - In `renderChart()` retry loop, add `canvas.offsetHeight > 0` check:
      - If canvas exists but `offsetHeight === 0`, increment retry count and schedule retry at 200ms
      - Use `requestAnimationFrame` before first dimension check to ensure Alpine.js has flushed DOM
      - Existing retry limit (5 retries at 200ms) applies to dimension retries as well
    - _Bug_Condition: hasVisualization AND isLiveStreaming AND canvas.offsetHeight === 0_
    - _Expected_Behavior: Chart.js only invoked when canvas has non-zero dimensions_
    - _Preservation: Charts that already have visible canvases render immediately as before_
    - _Requirements: 2.4, 3.3_

  - [x] 3.4 Implement Bug 1 fix: conditional contextTicker override with gibberish detection
    - **File**: `src/rag/intent-detector.service.ts`
    - Add `isGibberish(query: string): boolean` private helper method:
      - Split query into word tokens
      - Return `false` if any token is a known financial term (ticker, metric name, filing type like "10-K", section like "item 7")
      - Return `false` if 2+ tokens are dictionary-recognizable English words
      - Return `true` otherwise (query is gibberish)
    - Replace unconditional override at lines 199–203 with conditional logic:
      - Check `isTickerRelatedAmbiguity`: ambiguityReason is null OR contains "ticker"/"company"/"missing"
      - Only suppress `needsClarification` when `isTickerRelatedAmbiguity && !isGibberish(query)`
    - No changes to `rag.service.ts` — upstream fix makes the second bypass moot
    - _Bug_Condition: isGibberish(query) AND contextTicker IS NOT NULL_
    - _Expected_Behavior: needsClarification = true preserved for gibberish queries_
    - _Preservation: Valid queries with contextTicker continue to suppress clarification_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2_

  - [ ]* 3.5 (Optional — if PBT tasks 1-2 were completed) Verify bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - All Three Bugs Fixed
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - The tests from task 1 encode the expected behavior for each bug
    - When these tests pass, it confirms all three bugs are fixed:
      - Gibberish queries trigger clarification when contextTicker present
      - renderChart waits for non-zero canvas dimensions
      - saveMessage metadata includes visualization
      - buildStructuredPrompt includes numbered labels and citation instruction
    - Run `test/properties/pipeline-fix-fault-condition.property.spec.ts`
    - **EXPECTED OUTCOME**: All tests PASS (confirms bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [ ]* 3.6 (Optional — if PBT tasks 1-2 were completed) Verify preservation tests still pass
    - **Property 2: Preservation** - No Regressions
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run `test/properties/pipeline-fix-preservation.property.spec.ts`
    - **EXPECTED OUTCOME**: All tests PASS (confirms no regressions)
    - Confirm valid queries, non-visualization messages, and no-narrative prompts behave identically to pre-fix baseline

- [x] 4. Checkpoint - Ensure all tests pass
  - Run full property test suite: `pipeline-fix-fault-condition.property.spec.ts` and `pipeline-fix-preservation.property.spec.ts`
  - Run existing preservation tests: `research-assistant-preservation.property.spec.ts`
  - Ensure no regressions in pre-existing test files from a prior spec (research-assistant-rendering-fix — NOT outputs of this spec): `chart-rendering-bugfix.property.spec.ts`, `citation-rendering-bugfix.property.spec.ts`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Manual smoke test checklist (5-minute validation of full SSE→frontend rendering path)
  - **Test A — Gibberish rejection**: From an AAPL workspace, submit "asdfghjkl" as a query. Verify the response triggers a clarification prompt (not a full RAG synthesis).
  - **Test B — Chart persistence**: Run a chart-producing query (e.g., "Show AAPL revenue trend"), wait for the chart to render, then reload the page. Verify the chart re-renders from persisted metadata.
  - **Test C — Citation markers**: Run a narrative query (e.g., "What are AAPL's key risk factors?") and check the response for `[1]`, `[2]` etc. citation markers in the synthesized text.
  - Mark complete when all three manual checks pass.
