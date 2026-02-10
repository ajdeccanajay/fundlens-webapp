# Requirements: Sector-Specific Provocations Enhancement

## Overview

Enhance the Provocations Engine to generate sector-specific, industry-aware provocations that are tailored to each company's unique business model, competitive dynamics, and industry-specific risks. Currently, all companies receive the same 5 generic value investing provocations regardless of sector.

## User Stories

### US-1: Sector Classification
**As a** portfolio manager  
**I want** provocations that are relevant to the company's sector and industry  
**So that** I can focus on material risks specific to that business model

**Acceptance Criteria:**
- System automatically classifies companies by GICS sector/industry
- Sector metadata is stored and retrievable for each ticker
- Fallback to generic provocations if sector cannot be determined

### US-2: Sector-Specific Provocation Templates
**As a** senior equity analyst  
**I want** provocations that address sector-specific metrics and risks  
**So that** I can evaluate companies using industry-appropriate frameworks

**Acceptance Criteria:**
- Technology sector: R&D capitalization, deferred revenue, customer concentration, TAM claims
- Financials sector: Loan loss reserves, NIM trends, credit quality, regulatory capital
- Healthcare sector: Pipeline risk, patent cliffs, pricing pressure, FDA approvals
- Consumer sector: Same-store sales, inventory turns, brand health, channel mix
- Energy sector: Reserve replacement, finding costs, hedging positions, ESG transition
- Industrials sector: Backlog quality, project execution, supply chain, pricing power
- Materials sector: Commodity exposure, capacity utilization, input costs, cyclicality
- Real Estate sector: Occupancy rates, lease terms, cap rates, development pipeline
- Utilities sector: Regulatory ROE, rate cases, CapEx cycles, renewable transition
- Communication Services: Subscriber metrics, ARPU, churn, content costs

### US-3: Multi-Sector Company Handling
**As a** portfolio manager analyzing Amazon (retail + cloud)  
**I want** provocations that cover all relevant business segments  
**So that** I get comprehensive coverage of the company's diverse operations

**Acceptance Criteria:**
- System detects multi-segment companies
- Generates provocations for each major business segment
- Prioritizes provocations by segment revenue contribution

### US-4: Peer Context Integration
**As a** value investor  
**I want** provocations that include peer comparison context  
**So that** I can assess relative performance and competitive positioning

**Acceptance Criteria:**
- Provocations reference peer group metrics where relevant
- Highlight outliers vs peer averages
- Flag competitive dynamics (market share shifts, pricing pressure)

### US-5: Company-Specific Overlays
**As a** research analyst  
**I want** provocations that consider company-specific history  
**So that** I can track recurring issues and management credibility

**Acceptance Criteria:**
- System tracks historical issues (restatements, SEC inquiries, missed guidance)
- Provocations reference past problems if relevant
- Management track record influences credibility scoring

## Functional Requirements

### FR-1: Sector Classification Service
- Integrate with GICS classification system
- Map tickers to sector/industry codes
- Store sector metadata in database
- Support manual override for edge cases

### FR-2: Sector Template Library
- Define 5-7 provocations per major GICS sector
- Templates include sector-specific metrics and risks
- Templates reference appropriate SEC filing sections
- Support template versioning and updates

### FR-3: Dynamic Provocation Selection
- Combine universal + sector-specific + company-specific provocations
- Prioritize by materiality and severity
- Limit to 5-7 total provocations per company
- Cache results for performance

### FR-4: Peer Group Detection
- Identify peer companies by sector/industry
- Retrieve peer financial metrics for comparison
- Calculate peer averages and percentiles
- Flag material deviations from peer norms

### FR-5: Historical Context Tracking
- Store provocation history per ticker
- Track recurring issues across filings
- Maintain management credibility scores
- Surface patterns over time

## Non-Functional Requirements

### NFR-1: Performance
- Sector classification: < 100ms per ticker
- Provocation generation: < 3 seconds per ticker
- Cache sector-specific provocations for 24 hours
- Support batch processing for multiple tickers

### NFR-2: Accuracy
- Sector classification accuracy: > 95%
- Provocation relevance score: > 80% (user feedback)
- Peer group accuracy: > 90%

### NFR-3: Maintainability
- Sector templates stored as configuration (not hardcoded)
- Easy to add new sectors or update templates
- Template changes don't require code deployment
- Comprehensive logging for debugging

### NFR-4: Scalability
- Support 5,000+ tickers
- Handle 11 GICS sectors, 24 industry groups
- Process 100+ concurrent provocation requests
- Efficient database queries with proper indexing

## Data Requirements

### DR-1: Sector Classification Data
- GICS sector codes (11 sectors)
- GICS industry group codes (24 groups)
- GICS industry codes (69 industries)
- Ticker → GICS mapping table

### DR-2: Sector Template Data
- Template definitions per sector
- Metric mappings (sector-specific metric names)
- Risk factor keywords per sector
- SEC section references per sector

### DR-3: Peer Group Data
- Peer company lists per ticker
- Peer financial metrics (revenue, margins, growth rates)
- Peer averages and percentiles
- Peer group update frequency

### DR-4: Historical Context Data
- Past provocations per ticker
- Issue recurrence tracking
- Management guidance vs actuals
- SEC inquiry/restatement history

## Success Metrics

### SM-1: Relevance
- 80%+ of provocations rated "relevant" by users
- < 10% generic fallback usage
- 90%+ sector classification accuracy

### SM-2: Adoption
- 50%+ increase in provocations tab usage
- 30%+ increase in scratchpad saves from provocations
- Positive user feedback scores

### SM-3: Performance
- < 3 second provocation generation time
- 95%+ cache hit rate for repeat requests
- Zero timeout errors

## Out of Scope (Future Enhancements)

- Custom sector definitions by user
- Machine learning for sector classification
- Real-time peer comparison updates
- Integration with external data providers (FactSet, Bloomberg)
- Multi-language support for international filings
- Sector rotation signals
- Macro overlay (interest rates, commodity prices)

## Dependencies

- Existing Provocations Engine (MVP)
- GICS classification data source
- Financial metrics database
- SEC filing data (already available)
- Bedrock LLM service (already integrated)

## Assumptions

- GICS classification data is available and accurate
- Companies can be mapped to primary sector (even if multi-segment)
- Peer groups can be defined by sector/industry + market cap
- Historical data is available for context tracking
- Users understand sector-specific terminology

## Constraints

- Must maintain backward compatibility with existing provocations
- Cannot significantly increase API response times
- Must work with existing database schema (minimal changes)
- Limited to US public companies (SEC filers)
- Dependent on quality of SEC filing data
