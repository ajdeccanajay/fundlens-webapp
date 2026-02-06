# Requirements Document

## Introduction

Enable peer comparison queries in the research assistant by expanding beyond single-ticker RAG. When analysts ask "How does NVDA compare to its peers?", detect the intent, check tenant's existing deals for peer data, and either do multi-ticker retrieval or provide actionable guidance.

## Glossary

- **Research_Assistant**: The existing research-assistant.service.ts that processes queries
- **Intent_Detector**: The existing intent-detector.service.ts for query classification
- **Deal_Service**: The existing deal.service.ts with getAllDeals() method

## Requirements

### Requirement 1: Peer Comparison Intent Detection

**User Story:** As an analyst, I want the system to detect peer comparison queries automatically.

#### Acceptance Criteria

1. WHEN a query contains comparison keywords (compare, peers, competitors, vs, versus), THE Research_Assistant SHALL detect peer_comparison intent
2. WHEN peer comparison intent is detected, THE Research_Assistant SHALL extract the primary ticker and flag for peer lookup

### Requirement 2: Peer Discovery from Tenant Deals

**User Story:** As an analyst, I want the system to find peer data from my existing deals.

#### Acceptance Criteria

1. WHEN peer comparison is detected, THE Research_Assistant SHALL call getAllDeals() to get tenant's available tickers
2. THE Research_Assistant SHALL use LLM to identify which of the tenant's tickers are relevant peers for the primary company
3. IF no peers exist in tenant deals, THEN THE Research_Assistant SHALL use LLM to suggest 2-3 peer tickers to add

### Requirement 3: Multi-Ticker RAG Retrieval

**User Story:** As an analyst, I want to compare data across multiple companies in one query.

#### Acceptance Criteria

1. WHEN peers are found in tenant deals, THE Research_Assistant SHALL execute RAG queries for primary + peer tickers (max 5 total)
2. THE Research_Assistant SHALL merge results with clear company attribution in the synthesized response
3. IF a peer ticker has no data, THEN THE Research_Assistant SHALL note the gap and continue with available data

### Requirement 4: Actionable Fallback

**User Story:** As an analyst, I want guidance when peer data isn't available.

#### Acceptance Criteria

1. WHEN peers are NOT in tenant deals, THE Research_Assistant SHALL return single-ticker analysis plus suggested peers to add
2. THE Research_Assistant SHALL include structured metadata with missing peer tickers for frontend to render "Create Deal" buttons
3. THE Workspace_Frontend SHALL display "Create Deal" buttons for missing peers in the response
