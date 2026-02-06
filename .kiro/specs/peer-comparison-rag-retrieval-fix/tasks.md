# Implementation Plan: Peer Comparison RAG Retrieval Fix

## Overview

Surgical fix to connect the broken data flow in peer comparison queries. Three files, ~30 lines of changes. The downstream retrievers already support multi-ticker — we just need to thread the tickers array through the middle layer and add a comparison-aware synthesis prompt.

## Tasks

- [x] 1. Add tickers array support to RAG service query options
  - [x] 1.1 Add `tickers?: string[]` to the options parameter of `RAGService.query()` in `src/rag/rag.service.ts`
    - Add the field to the inline options type
    - After intent detection, if `options.tickers` is provided and non-empty, override `intent.ticker` with the array
    - Guard: `if (options?.tickers && options.tickers.length > 0) { intent.ticker = options.tickers; }`
    - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2_

  - [ ]* 1.2 Write property tests for tickers override and backward compatibility
    - **Property 1: Tickers array overrides intent ticker**
    - **Validates: Requirements 1.2, 3.1**
    - **Property 3: Single-ticker backward compatibility**
    - **Validates: Requirements 1.3**

- [x] 2. Thread tickers array from Research Assistant to RAG service
  - [x] 2.1 Update the `ragService.query()` call in `sendMessage()` in `src/research/research-assistant.service.ts`
    - Add `tickers: tickers.length > 1 ? tickers : undefined` to the options object
    - This passes the expanded peer tickers array only when multiple tickers are present
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 2.2 Write property test for ticker cap
    - **Property 4: Ticker array capped at 5**
    - **Validates: Requirements 2.3**

- [x] 3. Add peer-comparison-aware synthesis prompt
  - [x] 3.1 Add `isPeerComparison?: boolean` to the generate context in `src/rag/bedrock.service.ts`
    - Add the field to the context parameter type of `generate()`
    - In `buildUserMessage()`, when `isPeerComparison` is true, append comparison-specific instructions (side-by-side tables, per-company risk grouping, data gap notes, comparative summary)
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 3.2 Pass `isPeerComparison` flag from RAG service to Bedrock
    - In `rag.service.ts`, before calling `this.bedrock.generate()`, detect multi-ticker: `const isPeerComparison = Array.isArray(intent.ticker) && intent.ticker.length > 1`
    - Pass `isPeerComparison` in the generate context object
    - _Requirements: 4.1_

- [x] 4. Checkpoint - Verify data flow end-to-end
  - Ensure all tests pass, ask the user if questions arise.
  - Manually verify with a peer comparison query that RAG logs show multiple tickers in the retrieval plan

- [ ]* 5. Write integration and property tests
  - [ ]* 5.1 Write property test for retrieval plan threading
    - **Property 2: Retrieval plan contains full tickers array**
    - **Validates: Requirements 3.2, 3.3, 3.4**

  - [ ]* 5.2 Write property test for sources completeness
    - **Property 5: Sources reflect all queried tickers with data**
    - **Validates: Requirements 5.2**

  - [ ]* 5.3 Write unit tests for end-to-end peer comparison flow
    - Mock deals with multi-ticker data, send peer comparison query, verify response contains metrics for multiple tickers
    - Verify backward compat: single-ticker query produces identical behavior
    - _Requirements: 5.1, 5.2, 5.3_

- [ ] 6. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property/unit tests
- No new files, services, or migrations
- Downstream retrievers (structured + semantic) already support multi-ticker — no changes needed there
- The query router already handles `string | string[]` via `normalizeTickers()` — no changes needed there
- Total code changes: ~30 lines across 3 files
