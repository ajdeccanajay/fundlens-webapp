# Implementation Plan: Research Response Formatting Fix

## Overview

Fix three critical UX bugs in the FundLens Research Assistant: (1) multi-ticker queries bypassing LLM synthesis, (2) Chart.js not rendering on canvas, (3) markdown not rendering during streaming. Changes span `ResponseEnrichmentService`, `VisualizationGeneratorService`, `RAGService`, and the `research.html` frontend.

## Tasks

- [x] 1. Fix quick response eligibility to reject multi-ticker queries
  - [x] 1.1 Update `isQuickResponseEligible()` in `src/rag/response-enrichment.service.ts` to check for array ticker
    - Add `const isMultiTicker = Array.isArray(intent.ticker) && intent.ticker.length > 1` guard
    - Add `!isMultiTicker` to the return condition
    - _Requirements: 1.2, 4.1, 4.2, 4.3_
  - [x] 1.2 Write property tests for quick response eligibility
    - Create `test/properties/quick-response-eligibility.property.spec.ts`
    - **Property 1: Quick response eligibility rejects multi-ticker and comparison intents**
    - **Property 2: Quick response eligibility invariant (true implies all conditions hold)**
    - **Validates: Requirements 1.2, 4.1, 4.2, 4.3**
  - [x] 1.3 Write unit tests for quick response eligibility edge cases
    - Create `test/unit/quick-response-eligibility.spec.ts`
    - Test: single ticker with needsComparison=false returns true (when other conditions met)
    - Test: array ticker with 2+ elements returns false
    - Test: array ticker with 1 element — DECISION: treat as ineligible (reject). A single-element array suggests upstream parsing ambiguity; force through LLM path for safety. The guard is `intent.ticker.length > 1` but the eligibility also requires `ticker` to be a string (not an array), so `['AAPL']` returns false.
    - Test: empty array ticker — DECISION: treat as ineligible (reject). `ticker: []` means no ticker was resolved; this should not be eligible for quick response. The string-not-array guard catches this.
    - Test: specific regression case "AMZN vs MSFT revenue FY2024" with ABNB context
    - _Requirements: 4.3_

- [x] 2. Add LLM synthesis fallback degradation notice
  - [x] 2.1 Update `src/rag/rag.service.ts` to prepend degradation notice when HybridSynthesis fails for multi-ticker queries
    - In the catch block of the LLM synthesis try/catch, prepend the notice text
    - Notice: "⚠️ Analysis temporarily unavailable — showing raw data. Try again for a full comparative analysis."
    - _Requirements: 1.5, 5.1, 5.2_
  - [x] 2.2 Write unit tests for degradation notice
    - Create `test/unit/degradation-notice.spec.ts`
    - Test: when synthesis throws, response contains degradation notice text
    - Test: when synthesis succeeds, response does not contain degradation notice
    - _Requirements: 5.1, 5.2_

- [x] 3. Checkpoint - Ensure backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Fix chart rendering with retry loop
  - [x] 4.1 Update `renderChart()` in `public/app/deals/research.html` with requestAnimationFrame retry loop and container guard
    - Replace single `$nextTick` with retry loop: 3 rAF attempts + 1 final setTimeout(100ms) fallback
    - Extract chart initialization into `renderOnCanvas()` helper
    - Add guard for message container existence: before entering the retry loop, verify the message bubble DOM element exists (not just the canvas). If the visualization SSE event arrives before the first markdown flush creates the message bubble, the canvas lookup will fail because its parent container doesn't exist yet. The retry loop should check for the container first, then the canvas inside it.
    - Add console.warn when all retries exhausted
    - _Requirements: 2.1, 2.2, 2.5_
  - [x] 4.2 Write property test for multi-ticker visualization generation
    - Create `test/properties/multi-ticker-visualization.property.spec.ts`
    - **Property 3: Multi-ticker visualization generation**
    - **Validates: Requirements 2.3**

- [x] 5. Fix markdown streaming with buffer strategy
  - [x] 5.1 Add `isMarkdownBreakpoint()` method to the Alpine.js component in `public/app/deals/research.html`
    - Detect breakpoints: `\n\n`, `|\n`, period + capital letter, period + newline
    - For the period + capital letter heuristic: require at least one token of lookahead beyond the period before deciding it's a breakpoint. The regex `/\.\s+[A-Z]/` checks the last 20 chars, but this means the buffer must hold the period AND the next character(s) before flushing. This interacts with the buffer logic — a trailing period at the very end of the current buffer should NOT trigger a flush; wait for the next token to confirm the capital letter follows.
    - Include 200-char safety valve with `_lastMarkdownFlush` counter
    - _Requirements: 3.1_
  - [x] 5.2 Update SSE token handler to buffer content and flush at breakpoints
    - Accumulate tokens in `_rawContent` field
    - Only update `content` (triggering x-html re-render) at breakpoints
    - Reset `_lastMarkdownFlush` on new message initialization, on 'done' event, AND on user abort/cancel of the stream (if supported). A stale counter from an aborted response must not persist into the next query.
    - Flush remaining buffer on 'done' event
    - _Requirements: 3.1, 3.4_
  - [x] 5.3 Cleanup `_rawContent` on stream completion
    - On 'done' event (and on abort/cancel), after flushing the buffer to `content`, delete or null out the `_rawContent` field on the message object. This prevents holding duplicate content in memory for every message in long sessions.
    - _Requirements: 3.1_
  - [x] 5.4 Write property tests for markdown breakpoint detection and table rendering
    - Create `test/properties/markdown-breakpoint.property.spec.ts`
    - **Property 4: Markdown breakpoint detection**
    - **Property 5: Table markdown produces HTML tables**
    - **Validates: Requirements 3.1, 3.2**

- [x] 6. Verify intent comparison flag propagation
  - [x] 6.1 Write property tests for intent comparison flag propagation
    - Create `test/properties/intent-comparison-propagation.property.spec.ts`
    - **Property 6: LLM needsComparison flag propagation**
    - **Property 7: Context ticker merging**
    - **Validates: Requirements 1.1, 1.4, 4.5**

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP (currently: 2.2, 4.2, 5.4)
- Tasks 1.2 and 6.1 are REQUIRED — they validate the core eligibility guard and the upstream comparison flag pipeline, which are the whole point of this fix
- Each task references specific requirements for traceability
- The backend fix (task 1) is the highest-impact change — it routes multi-ticker queries through LLM synthesis
- Frontend fixes (tasks 4, 5) address rendering issues that affect all response types
- Property tests validate universal correctness properties; unit tests cover specific regression cases
- Task 1.3 edge cases: empty array and single-element array tickers are explicitly rejected by the eligibility guard (the guard requires `ticker` to be a string, not an array of any length)
