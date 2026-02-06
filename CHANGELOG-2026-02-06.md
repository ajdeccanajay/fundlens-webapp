# Changelog - February 6, 2026

## Demo Prep & Hedge Fund Presentation Day

### RAG System Enhancements
- Enhanced RAG service with investment-grade synthesis and multi-ticker peer comparison support
- Extended intent detector with peer comparison detection, confidence threshold fixes, and cross-industry query patterns
- Added query router service for intelligent query routing
- Improved Bedrock service with better model handling and response parsing
- Enhanced semantic retriever with contextual expansion and better ticker filtering
- Improved structured retriever with multi-ticker support
- Added RAG controller endpoints and module wiring

### Multi-Ticker Peer Comparison (New Feature)
- Peer comparison intent detection in intent detector
- Peer discovery from tenant deals via LLM identification
- Multi-ticker RAG retrieval (max 5 tickers per query)
- Frontend "Create Deal" buttons for missing peer tickers
- Spec complete: `.kiro/specs/multi-ticker-peer-comparison/`

### Research Assistant Improvements
- Enhanced research assistant with peer comparison, streaming fixes, and source attribution
- Fixed streaming response handling for workspace research
- Fixed sources display in research assistant responses
- Added citation rendering improvements

### Confidence Threshold & Intent Detection
- Fixed confidence calculation boundary conditions
- Added metric learning service for adaptive confidence
- Added performance monitor and optimizer services
- Property-based tests for intent detector confidence
- Cross-industry e2e test coverage

### Frontend Updates
- Workspace.html: peer comparison UI, citation improvements, enhanced qualitative tab
- Research index: improved layout and interaction patterns

### Specs & Documentation
- New specs: confidence-threshold-fix, investment-grade-rag-synthesis, multi-ticker-peer-comparison, peer-comparison-rag-retrieval-fix, rag-robustness-enhancement
- Platform projects tracker updated with qualitative cache refresh TODO
- Demo prep guide for hedge fund presentation

### Testing
- New unit tests for intent detector, advanced retrieval services, bedrock citation parsing
- Property-based tests for intent detector confidence
- E2e tests for cross-industry intent detection
- RAG clarification tests

### Known Issue: Qualitative Cache Expiry
- Qualitative "instant" answers expired for COST, AMGN, INTU, AAPL, GOOG, INTC
- Still valid: NVDA (Feb 10), AMZN (Feb 9), CMCSA (Feb 7)
- Fix: Re-run `POST /api/financial-calculator/qualitative/precompute/:ticker` for expired tickers
