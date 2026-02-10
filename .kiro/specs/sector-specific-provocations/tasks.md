# Tasks: Sector-Specific Provocations Enhancement

## Phase 1: Core Infrastructure (Week 1-2)

### 1. Sector Classification Service
- [ ] 1.1 Create sector classification service
  - [ ] 1.1.1 Implement GICS sector mapper
  - [ ] 1.1.2 Create sector metadata cache
  - [ ] 1.1.3 Build multi-segment detector
  - [ ] 1.1.4 Add manual override capability
- [ ] 1.2 Database schema for sector data
  - [ ] 1.2.1 Create sector_classifications table
  - [ ] 1.2.2 Create peer_groups table
  - [ ] 1.2.3 Create peer_metrics_cache table
  - [ ] 1.2.4 Add indexes for performance
- [ ] 1.3 Unit tests for sector classification
  - [ ] 1.3.1 Test GICS sector mapping
  - [ ] 1.3.2 Test multi-segment detection
  - [ ] 1.3.3 Test fallback to generic
  - [ ] 1.3.4 Test cache behavior

### 2. Template Library Setup
- [ ] 2.1 Define YAML schema for sector templates
  - [ ] 2.1.1 Create template schema definition
  - [ ] 2.1.2 Add validation rules
  - [ ] 2.1.3 Document template structure
- [ ] 2.2 Create templates for pilot sectors
  - [ ] 2.2.1 Technology sector templates (5 provocations)
  - [ ] 2.2.2 Financials sector templates (5 provocations)
  - [ ] 2.2.3 Healthcare sector templates (5 provocations)
- [ ] 2.3 Build template loader and validator
  - [ ] 2.3.1 Implement YAML loader
  - [ ] 2.3.2 Add template validation
  - [ ] 2.3.3 Implement template caching
  - [ ] 2.3.4 Add hot-reload capability
- [ ] 2.4 Unit tests for template library
  - [ ] 2.4.1 Test template loading
  - [ ] 2.4.2 Test template validation
  - [ ] 2.4.3 Test cache behavior

## Phase 2: Enhanced Provocation Generation (Week 3-4)

### 3. Template Selection Logic
- [ ] 3.1 Implement sector-based template selection
  - [ ] 3.1.1 Create template selection algorithm
  - [ ] 3.1.2 Add multi-segment template merging
  - [ ] 3.1.3 Implement materiality scoring
  - [ ] 3.1.4 Add provocation prioritization
- [ ] 3.2 Modify provocation generator service
  - [ ] 3.2.1 Extend generateValueInvestingProvocations()
  - [ ] 3.2.2 Add generateSectorSpecificProvocations()
  - [ ] 3.2.3 Implement template variable substitution
  - [ ] 3.2.4 Add sector-specific validation
- [ ] 3.3 Unit tests for template selection
  - [ ] 3.3.1 Test sector template selection
  - [ ] 3.3.2 Test multi-segment merging
  - [ ] 3.3.3 Test prioritization logic

### 4. Peer Context Integration
- [ ] 4.1 Build peer group detection service
  - [ ] 4.1.1 Implement peer group algorithm
  - [ ] 4.1.2 Add market cap filtering
  - [ ] 4.1.3 Add revenue filtering
  - [ ] 4.1.4 Implement similarity scoring
- [ ] 4.2 Implement peer metrics aggregation
  - [ ] 4.2.1 Create peer metrics service
  - [ ] 4.2.2 Add average/median calculation
  - [ ] 4.2.3 Add percentile calculation
  - [ ] 4.2.4 Implement caching
- [ ] 4.3 Add outlier detection logic
  - [ ] 4.3.1 Implement standard deviation calculation
  - [ ] 4.3.2 Add outlier flagging (>2 std dev)
  - [ ] 4.3.3 Add materiality assessment
- [ ] 4.4 Integrate peer data into provocations
  - [ ] 4.4.1 Update LLM prompts with peer data
  - [ ] 4.4.2 Add peer comparison to observations
  - [ ] 4.4.3 Include outlier analysis
- [ ] 4.5 Unit tests for peer services
  - [ ] 4.5.1 Test peer group detection
  - [ ] 4.5.2 Test metrics aggregation
  - [ ] 4.5.3 Test outlier detection

## Phase 3: Remaining Sectors & Testing (Week 5-6)

### 5. Complete Sector Coverage
- [ ] 5.1 Add templates for remaining sectors
  - [ ] 5.1.1 Consumer Discretionary/Staples templates
  - [ ] 5.1.2 Energy sector templates
  - [ ] 5.1.3 Industrials sector templates
  - [ ] 5.1.4 Materials sector templates
  - [ ] 5.1.5 Real Estate sector templates
  - [ ] 5.1.6 Utilities sector templates
  - [ ] 5.1.7 Communication Services templates
- [ ] 5.2 Validate templates with test tickers
  - [ ] 5.2.1 Test each sector with 3+ tickers
  - [ ] 5.2.2 Validate output quality
  - [ ] 5.2.3 Refine prompts based on results

### 6. Historical Context Overlay
- [ ] 6.1 Track recurring issues per ticker
  - [ ] 6.1.1 Implement issue tracking
  - [ ] 6.1.2 Add recurrence detection
  - [ ] 6.1.3 Store historical provocations
- [ ] 6.2 Build management credibility scoring
  - [ ] 6.2.1 Extract forward-looking statements
  - [ ] 6.2.2 Compare to actual results
  - [ ] 6.2.3 Calculate accuracy score
- [ ] 6.3 Add historical context to provocations
  - [ ] 6.3.1 Include recurring issue flags
  - [ ] 6.3.2 Add credibility scores
  - [ ] 6.3.3 Reference past problems

### 7. Comprehensive Testing
- [ ] 7.1 Property-based tests
  - [ ] 7.1.1 Property 1: Sector Classification Accuracy
  - [ ] 7.1.2 Property 4: Sector-Specific Template Selection
  - [ ] 7.1.3 Property 9: Provocation Count Constraint
  - [ ] 7.1.4 Property 11: Peer Group Relevance
- [ ] 7.2 Integration tests
  - [ ] 7.2.1 End-to-end sector-specific flow
  - [ ] 7.2.2 Multi-segment company handling
  - [ ] 7.2.3 Peer comparison integration
  - [ ] 7.2.4 Cache behavior validation
- [ ] 7.3 Performance testing
  - [ ] 7.3.1 Test with 100+ tickers
  - [ ] 7.3.2 Measure sector classification time
  - [ ] 7.3.3 Measure provocation generation time
  - [ ] 7.3.4 Validate cache hit rates

## Phase 4: Frontend Integration & Deployment (Week 7-8)

### 8. API Endpoints
- [ ] 8.1 Add sector classification endpoint
  - [ ] 8.1.1 GET /api/sectors/:ticker
  - [ ] 8.1.2 Add error handling
  - [ ] 8.1.3 Add caching
- [ ] 8.2 Update provocations endpoint
  - [ ] 8.2.1 Modify GET /api/provocations/:ticker/value-investing
  - [ ] 8.2.2 Add GET /api/provocations/:ticker/sector-specific
  - [ ] 8.2.3 Add sector context to responses
- [ ] 8.3 Add peer comparison endpoint
  - [ ] 8.3.1 GET /api/peers/:ticker
  - [ ] 8.3.2 GET /api/peers/:ticker/metrics
  - [ ] 8.3.3 Add error handling
- [ ] 8.4 Add sector metadata endpoint
  - [ ] 8.4.1 GET /api/sectors/:sectorCode/metadata
  - [ ] 8.4.2 Add caching
- [ ] 8.5 E2E tests for API endpoints
  - [ ] 8.5.1 Test sector classification endpoint
  - [ ] 8.5.2 Test sector-specific provocations endpoint
  - [ ] 8.5.3 Test peer comparison endpoint

### 9. Frontend Updates
- [ ] 9.1 Display sector badge in workspace
  - [ ] 9.1.1 Add sector badge component
  - [ ] 9.1.2 Fetch sector classification on load
  - [ ] 9.1.3 Style sector badge
- [ ] 9.2 Show peer comparison in provocations
  - [ ] 9.2.1 Add peer comparison section
  - [ ] 9.2.2 Display outlier indicators
  - [ ] 9.2.3 Add tooltips for peer data
- [ ] 9.3 Add sector filter to provocations tab
  - [ ] 9.3.1 Add filter dropdown
  - [ ] 9.3.2 Implement filter logic
  - [ ] 9.3.3 Update URL params
- [ ] 9.4 Update scratchpad with sector context
  - [ ] 9.4.1 Include sector in saved items
  - [ ] 9.4.2 Add sector badge to scratchpad cards
- [ ] 9.5 Frontend testing
  - [ ] 9.5.1 Test sector badge display
  - [ ] 9.5.2 Test peer comparison rendering
  - [ ] 9.5.3 Test filter functionality

### 10. Deployment & Monitoring
- [ ] 10.1 Deploy to staging
  - [ ] 10.1.1 Run database migrations
  - [ ] 10.1.2 Deploy backend services
  - [ ] 10.1.3 Deploy frontend updates
  - [ ] 10.1.4 Run smoke tests
- [ ] 10.2 Production deployment
  - [ ] 10.2.1 Enable feature flag
  - [ ] 10.2.2 Monitor error rates
  - [ ] 10.2.3 Monitor performance metrics
  - [ ] 10.2.4 Track user engagement
- [ ] 10.3 Post-deployment validation
  - [ ] 10.3.1 Test with production data
  - [ ] 10.3.2 Validate cache behavior
  - [ ] 10.3.3 Check all 11 sectors
  - [ ] 10.3.4 Gather user feedback

## Success Criteria

- All 11 GICS sectors have 5+ provocation templates
- Sector classification accuracy >95%
- Provocation generation time <3 seconds
- Cache hit rate >95% for repeat requests
- 80%+ of provocations rated "relevant" by users
- Zero critical bugs in production
- All E2E tests passing
