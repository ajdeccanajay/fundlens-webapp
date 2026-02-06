# Requirements Document

## Introduction

This spec addresses a critical data flow bug in the peer comparison feature. The Research_Assistant correctly detects peer comparison intent and identifies peer tickers from tenant deals, but fails to pass the expanded ticker array through the RAG pipeline. The RAG_Service query options only accept a single `ticker` string, so the expanded tickers array built in `sendMessage()` is never threaded to the structured and semantic retrievers. The result is that peer comparison queries return data for only the primary ticker, not the peers.

## Glossary

- **Research_Assistant**: The `research-assistant.service.ts` service that orchestrates query processing in `sendMessage()`
- **RAG_Service**: The `rag.service.ts` service that executes the hybrid retrieval pipeline via its `query()` method
- **Query_Router**: The `query-router.service.ts` service that builds `RetrievalPlan` from detected intent
- **Intent_Detector**: The `intent-detector.service.ts` service that classifies queries and extracts tickers
- **Structured_Retriever**: The `structured-retriever.service.ts` service that queries PostgreSQL for financial metrics (already supports `tickers[]` array)
- **Semantic_Retriever**: The `semantic-retriever.service.ts` service that queries Bedrock KB for narrative chunks (already supports multi-ticker via `retrieveMultipleTickersWithContext()`)
- **Bedrock_Service**: The `bedrock.service.ts` LLM synthesis service that generates the final answer from retrieved metrics and narratives
- **Query_Options**: The options parameter of `RAG_Service.query()`, currently typed as `{ ticker?: string }`
- **RetrievalPlan**: The object produced by Query_Router containing `structuredQuery` and `semanticQuery` with their respective ticker arrays

## Requirements

### Requirement 1: Multi-Ticker RAG Query Options

**User Story:** As a developer, I want the RAG service query interface to accept an array of tickers, so that peer comparison queries can retrieve data for all relevant companies.

#### Acceptance Criteria

1. THE Query_Options interface SHALL include a `tickers` field typed as `string[]` in addition to the existing `ticker` field
2. WHEN `tickers` is provided in Query_Options, THE RAG_Service SHALL use the `tickers` array as the authoritative ticker list for retrieval
3. WHEN only `ticker` is provided (no `tickers`), THE RAG_Service SHALL maintain existing single-ticker behavior

### Requirement 2: Ticker Array Threading from Research Assistant to RAG Service

**User Story:** As a developer, I want the Research Assistant to pass the expanded peer ticker array through to the RAG service, so that retrieval covers all peer companies.

#### Acceptance Criteria

1. WHEN peer comparison is detected and peer tickers are identified, THE Research_Assistant SHALL pass the full tickers array (primary + peers) via the `tickers` field in Query_Options
2. WHEN no peer comparison is detected, THE Research_Assistant SHALL continue passing only the single `ticker` field as before
3. THE Research_Assistant SHALL cap the tickers array at 5 entries (primary + up to 4 peers)

### Requirement 3: RAG Service Ticker Override in Retrieval Plan

**User Story:** As a developer, I want the RAG service to override the intent detector's single ticker with the full tickers array when provided, so that the query router's retrieval plan includes all peer tickers.

#### Acceptance Criteria

1. WHEN `tickers` is provided in Query_Options, THE RAG_Service SHALL override the `intent.ticker` field with the provided `tickers` array before building the retrieval plan
2. WHEN `tickers` is provided, THE RAG_Service SHALL pass the full array to both the Query_Router route call and the intent detection context
3. THE Structured_Retriever SHALL receive the full tickers array in `plan.structuredQuery.tickers` and query metrics for all tickers
4. THE Semantic_Retriever SHALL receive the full tickers array in `plan.semanticQuery.tickers` and retrieve narratives for all tickers

### Requirement 4: Peer-Comparison-Aware Synthesis Prompt

**User Story:** As an analyst, I want the LLM synthesis to produce a structured comparative answer when peer data is present, so that I can see side-by-side analysis across companies.

#### Acceptance Criteria

1. WHEN the RAG_Service retrieves metrics and narratives for multiple tickers, THE Bedrock_Service SHALL receive a peer-comparison-aware system prompt instructing it to produce comparative analysis
2. WHEN generating a peer comparison response, THE Bedrock_Service SHALL organize financial metrics side-by-side across companies (e.g., revenue comparison table)
3. WHEN generating a peer comparison response, THE Bedrock_Service SHALL present risk factors and qualitative insights grouped by company with explicit cross-company commentary
4. IF metrics are available for some peers but not others, THEN THE Bedrock_Service SHALL note data gaps explicitly rather than omitting the company

### Requirement 5: End-to-End Data Flow Integrity

**User Story:** As an analyst, I want peer comparison queries to return data for all identified peers, so that I get a complete comparative analysis.

#### Acceptance Criteria

1. WHEN a peer comparison query is processed for a primary ticker with N identified peers, THE RAG_Service SHALL return metrics attributed to at least 2 distinct tickers (primary + at least one peer)
2. WHEN a peer comparison query completes, THE response sources array SHALL contain entries for each ticker that had available data
3. FOR ALL peer comparison queries where peer data exists in the database, THE final synthesized answer SHALL reference at least the primary ticker and one peer ticker by name
