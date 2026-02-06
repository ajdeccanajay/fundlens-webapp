# Implementation Plan: Multi-Ticker Peer Comparison

## Overview

Minimal implementation that extends existing services to support peer comparison queries. Total estimated effort: ~4-6 hours.

## Tasks

- [x] 1. Extend Intent Detector for Peer Comparison
  - [x] 1.1 Add `needsPeerComparison` field to QueryIntent interface
    - Add optional boolean field to existing interface in intent-detector.service.ts
    - _Requirements: 1.1, 1.2_
  
  - [x] 1.2 Add peer detection logic to detectWithRegex method
    - Add `needsPeerComparison()` private method with peer keywords (peers, competitors, peer group, comparable, comps)
    - Call from `detectWithRegex()` and set flag on intent
    - _Requirements: 1.1_
  
  - [ ]* 1.3 Write property test for peer intent detection
    - **Property 1: Peer intent detection with ticker extraction**
    - **Validates: Requirements 1.1, 1.2**

- [x] 2. Add Peer Identification to Research Assistant
  - [x] 2.1 Add `identifyPeersFromDeals()` method to research-assistant.service.ts
    - Inject DealService into constructor
    - Call `getAllDeals()` to get tenant's available tickers
    - Use Claude to identify relevant peers from available list
    - Return `{ found: string[], missing: string[], rationale: string }`
    - _Requirements: 2.1, 2.2, 2.3_
  
  - [ ]* 2.2 Write property test for peer identification
    - **Property 2: Peer identification returns valid subset**
    - **Validates: Requirements 2.2**

- [x] 3. Extend sendMessage for Multi-Ticker Queries
  - [x] 3.1 Detect peer comparison intent in sendMessage
    - Check `intent.needsPeerComparison` flag
    - Call `identifyPeersFromDeals()` when true
    - _Requirements: 2.1_
  
  - [x] 3.2 Expand RAG query with peer tickers
    - Combine primary ticker with found peers (max 5 total)
    - Pass expanded ticker array to RAG service
    - _Requirements: 3.1, 3.2_
  
  - [x] 3.3 Add peer metadata to response
    - Include `peerComparison` object in response with peersIncluded and missingPeers
    - _Requirements: 4.1, 4.2_
  
  - [ ]* 3.4 Write property test for ticker count limit
    - **Property 3: Multi-ticker query bounded to 5**
    - **Validates: Requirements 3.1**

- [x] 4. Checkpoint - Backend Complete
  - Ensure all backend tests pass, ask the user if questions arise.

- [x] 5. Frontend: Display Peer Comparison Results
  - [x] 5.1 Update research message template in workspace.html
    - Add conditional block to show "Peers Included" indicator
    - Add "Create Deal" buttons for missing peers
    - Wire button click to deal creation with pre-filled ticker
    - _Requirements: 4.3_
  
  - [x] 5.2 Add createDealForTicker helper method
    - Navigate to deal creation with ticker parameter
    - _Requirements: 4.3_

- [x] 6. Final Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property tests
- No new database tables or migrations required
- Leverages existing `getAllDeals()` and RAG infrastructure
- LLM calls use existing BedrockService
