# Requirements Document

## Introduction

This specification addresses a critical bug where the FundLens workspace has a hard fork in query routing: when an Instant RAG session is active, ALL queries go to the Instant RAG endpoint (session docs only, no full RAG pipeline). When no session is active, ALL queries go through the Research Assistant (full RAG pipeline with intent detection, structured metrics, Bedrock KB — but no session docs). Users cannot get both in a single query.

The fix eliminates this fork by always routing through the full RAG pipeline and injecting active session document content into the existing merge step. This is a minimal-latency change — session documents are already in memory, and the merge infrastructure (`mergeAndRerankResults()`) already exists. No new services, endpoints, or retrieval paths are needed.

## Glossary

- **RAG_Service**: The main retrieval-augmented generation service (`src/rag/rag.service.ts`) that handles workspace research queries by combining structured metrics from PostgreSQL, semantic narratives from Bedrock KB, and user-uploaded document chunks via `mergeAndRerankResults()`.
- **Instant_RAG_Service**: The session-based document processing and Q&A service (`src/instant-rag/instant-rag.service.ts`) that stores uploaded documents in memory and provides `getSessionDocuments()` and `getDocumentContent()` accessors.
- **Research_Assistant**: The service (`src/research/research-assistant.service.ts`) that orchestrates research conversations, calling `RAG_Service.query()` for each user message.
- **Document_RAG_Service**: The service (`src/rag/document-rag.service.ts`) that provides `mergeAndRerankResults()` for combining and reranking chunks from multiple sources.
- **Session_Manager**: The service (`src/instant-rag/session-manager.service.ts`) that manages Instant RAG session lifecycle, including `getActiveSession(tenantId, dealId, userId)`.
- **Workspace_Frontend**: The workspace HTML page (`public/app/deals/workspace.html`) that currently forks query routing based on session state.

## Requirements

### Requirement 1: Unified Query Routing

**User Story:** As an equity research analyst, I want all my research queries to go through the full RAG pipeline regardless of whether I have uploaded documents, so that I always get structured metrics, SEC narratives, and session documents in a single response.

#### Acceptance Criteria

1. WHEN the Workspace_Frontend sends a research query and an active Instant RAG session exists, THEN THE Workspace_Frontend SHALL route the query through the Research Assistant endpoint instead of the Instant RAG query endpoint
2. WHEN the Workspace_Frontend sends a research query with an active session, THEN THE Workspace_Frontend SHALL include the Instant RAG session ID in the request context alongside existing fields (tickers, provocationsMode)
3. WHEN the Instant RAG session expires or ends, THEN THE Workspace_Frontend SHALL stop including the session ID in subsequent research queries

### Requirement 2: Session Document Injection into RAG Pipeline

**User Story:** As an equity research analyst, I want my uploaded session documents to be included in the main RAG retrieval alongside SEC filings, so that cross-source questions return complete answers.

#### Acceptance Criteria

1. WHEN the Research_Assistant receives a query with a session ID in the context, THEN THE Research_Assistant SHALL pass the session ID to RAG_Service.query() options
2. WHEN the RAG_Service receives a query with a session ID, THEN THE RAG_Service SHALL retrieve session document content from Instant_RAG_Service.getSessionDocuments()
3. WHEN session documents are retrieved, THEN THE RAG_Service SHALL convert session document text into chunks and merge them with Bedrock KB narrative chunks using Document_RAG_Service.mergeAndRerankResults()
4. WHEN no session ID is provided or no session documents exist, THEN THE RAG_Service SHALL proceed with the standard retrieval flow without modification

### Requirement 3: Cross-Source Citation Attribution

**User Story:** As an equity research analyst, I want citations to clearly indicate whether information came from my uploaded document or from SEC filings, so that I can verify sources and assess credibility.

#### Acceptance Criteria

1. WHEN the merged context includes session document chunks, THEN THE RAG_Service SHALL label each chunk with source type "Uploaded Document" and include the original filename in the LLM prompt context
2. WHEN the merged context includes Bedrock KB chunks, THEN THE RAG_Service SHALL label each chunk with source type "SEC Filing" in the LLM prompt context
3. WHEN citations are extracted from the LLM response, THEN THE RAG_Service SHALL include source type and filename in the citation metadata streamed to the Workspace_Frontend
4. THE Workspace_Frontend SHALL display the source type label alongside each citation in the research response

### Requirement 4: Graceful Degradation

**User Story:** As an equity research analyst, I want the system to still return useful results even if session document retrieval fails, so that my research workflow is not interrupted.

#### Acceptance Criteria

1. IF the session ID is invalid or the session has expired, THEN THE RAG_Service SHALL log a warning and proceed with the standard retrieval flow
2. IF the Instant_RAG_Service document retrieval throws an error, THEN THE RAG_Service SHALL log the error and proceed with Bedrock KB results only
3. IF the session document content is empty, THEN THE RAG_Service SHALL skip session document merging and proceed with Bedrock KB results only
4. WHEN graceful degradation occurs, THEN THE RAG_Service SHALL include a metadata flag indicating session documents were unavailable
