# Tasks: Automatic Filing Detection System

## Phase 1: Core Infrastructure (Week 1-2)

### 1. Database Schema & Models
- [x] 1.1 Create filing_detection_state table
  - [x] 1.1.1 Add migration file
  - [x] 1.1.2 Add Prisma model
  - [x] 1.1.3 Add indexes for performance
  - [x] 1.1.4 Test migration on staging
- [x] 1.2 Create filing_notifications table
  - [x] 1.2.1 Add migration file
  - [x] 1.2.2 Add Prisma model
  - [x] 1.2.3 Add indexes (tenant_id, ticker, created_at)
  - [x] 1.2.4 Add foreign key to tenants table
  - [x] 1.2.5 Test migration on staging
- [x] 1.3 Update data_sources metadata structure
  - [x] 1.3.1 Document expected metadata fields
  - [x] 1.3.2 Add validation for filing metadata
  - [x] 1.3.3 Update existing records if needed

### 2. Filing Detector Service
- [x] 2.1 Implement FilingDetectorService
  - [x] 2.1.1 Create service class
  - [x] 2.1.2 Implement detectNewFilings() method
  - [x] 2.1.3 Implement filterNewFilings() method
  - [x] 2.1.4 Implement getDetectionState() method
  - [x] 2.1.5 Implement updateDetectionState() method
- [x] 2.2 Integrate with SEC service
  - [x] 2.2.1 Use existing SecService.getFillings()
  - [x] 2.2.2 Handle rate limiting (10 req/sec)
  - [x] 2.2.3 Add error handling and retries
- [x] 2.3 Unit tests for detector service
  - [x] 2.3.1 Test new filing detection
  - [x] 2.3.2 Test filtering logic
  - [x] 2.3.3 Test detection state updates
  - [x] 2.3.4 Test error handling

### 3. Filing Download Service
- [x] 3.1 Implement FilingDownloadService
  - [x] 3.1.1 Create service class
  - [x] 3.1.2 Implement queueDownload() method
  - [x] 3.1.3 Implement downloadAndProcess() method
  - [x] 3.1.4 Integrate with SECSyncService
  - [x] 3.1.5 Integrate with SECProcessingService
- [x] 3.2 Error handling and retries
  - [x] 3.2.1 Add exponential backoff
  - [x] 3.2.2 Log all errors with context
  - [x] 3.2.3 Handle partial failures
- [x] 3.3 Unit tests for download service
  - [x] 3.3.1 Test download queueing
  - [x] 3.3.2 Test error handling
  - [x] 3.3.3 Test retry logic

## Phase 2: Notification System (Week 3-4)

### 4. Filing Notification Service
- [x] 4.1 Implement FilingNotificationService
  - [x] 4.1.1 Create service class
  - [x] 4.1.2 Implement createNotifications() method
  - [x] 4.1.3 Implement getNotifications() method
  - [x] 4.1.4 Implement dismissNotification() method
  - [x] 4.1.5 Implement expireOldNotifications() cron job
- [x] 4.2 Tenant isolation enforcement
  - [x] 4.2.1 Verify tenant ownership before dismissal
  - [x] 4.2.2 Filter notifications by tenant_id
  - [x] 4.2.3 Add audit logging
- [x] 4.3 Unit tests for notification service
  - [x] 4.3.1 Test notification creation
  - [x] 4.3.2 Test tenant isolation
  - [x] 4.3.3 Test dismissal logic
  - [x] 4.3.4 Test auto-expiry

### 5. API Endpoints
- [x] 5.1 Create FilingNotificationController
  - [x] 5.1.1 GET /api/filings/notifications
  - [x] 5.1.2 DELETE /api/filings/notifications/:id
  - [x] 5.1.3 POST /api/filings/detect (admin only)
  - [x] 5.1.4 GET /api/filings/detection-status (admin only)
  - [x] 5.1.5 GET /api/filings/detection-summary (admin only)
- [x] 5.2 Add TenantGuard to all endpoints
  - [x] 5.2.1 Protect notification endpoints
  - [x] 5.2.2 Protect admin endpoints
  - [x] 5.2.3 Add role-based access control
- [x] 5.3 E2E tests for API endpoints
  - [x] 5.3.1 Test GET notifications
  - [x] 5.3.2 Test DELETE notification
  - [x] 5.3.3 Test tenant isolation
  - [x] 5.3.4 Test admin endpoints

### 6. Detection Scheduler
- [x] 6.1 Implement FilingDetectionScheduler
  - [x] 6.1.1 Create service class
  - [x] 6.1.2 Add @Cron decorator (6 AM ET daily)
  - [x] 6.1.3 Implement runDailyDetection() method
  - [x] 6.1.4 Implement getTrackedTickers() method
  - [x] 6.1.5 Implement summarizeResults() method
- [x] 6.2 Rate limiting and error handling
  - [x] 6.2.1 Add sleep between requests (150ms)
  - [x] 6.2.2 Handle individual ticker failures
  - [x] 6.2.3 Log execution summary
- [x] 6.3 Unit tests for scheduler
  - [x] 6.3.1 Test ticker retrieval
  - [x] 6.3.2 Test rate limiting
  - [x] 6.3.3 Test error isolation

## Phase 3: Integration & Testing (Week 5-6)

### 7. Integration Tests
- [x] 7.1 End-to-end detection flow
  - [x] 7.1.1 Test detection → download → process → notify
  - [x] 7.1.2 Test with multiple tickers
  - [x] 7.1.3 Test with multiple tenants
  - [x] 7.1.4 Verify no duplicate downloads
- [x] 7.2 Tenant isolation tests
  - [x] 7.2.1 Verify tenant A cannot access tenant B's notifications
  - [x] 7.2.2 Verify both tenants access same filing data
  - [x] 7.2.3 Verify audit logs track access
- [x] 7.3 Incremental detection tests
  - [x] 7.3.1 Verify existing filings are skipped
  - [x] 7.3.2 Verify detection state is updated
  - [x] 7.3.3 Verify no re-processing

### 8. Property-Based Tests
- [x] 8.1 Property 1: Detection Completeness
  - [x] 8.1.1 Write property test
  - [x] 8.1.2 Run with 100+ iterations
  - [x] 8.1.3 Validate results
- [x] 8.2 Property 3: Tenant Notification Completeness
  - [x] 8.2.1 Write property test
  - [x] 8.2.2 Run with 100+ iterations
  - [x] 8.2.3 Validate results
- [x] 8.3 Property 6: Incremental Detection
  - [x] 8.3.1 Write property test
  - [x] 8.3.2 Run with 100+ iterations
  - [x] 8.3.3 Validate results
- [x] 8.4 Property 9: Rate Limit Compliance
  - [x] 8.4.1 Write property test
  - [x] 8.4.2 Run with 100+ iterations
  - [x] 8.4.3 Validate results

### 9. Performance Testing
- [x] 9.1 Test with 100+ tickers
  - [x] 9.1.1 Measure detection duration
  - [x] 9.1.2 Measure download duration
  - [x] 9.1.3 Measure processing duration
  - [x] 9.1.4 Verify <5 minute total time
- [x] 9.2 Test concurrent processing
  - [x] 9.2.1 Process 10 filings concurrently
  - [x] 9.2.2 Verify no race conditions
  - [x] 9.2.3 Verify no deadlocks
- [x] 9.3 Test rate limiting
  - [x] 9.3.1 Verify <10 req/sec to SEC
  - [x] 9.3.2 Measure actual request rate
  - [x] 9.3.3 Adjust sleep duration if needed

## Phase 4: Frontend Integration & Deployment (Week 7-8)

### 10. Frontend Notification UI
- [x] 10.1 Add notification badge to workspace header
  - [x] 10.1.1 Fetch notification count on load
  - [x] 10.1.2 Display badge with count
  - [x] 10.1.3 Add click handler to show notifications
- [x] 10.2 Create notification dropdown
  - [x] 10.2.1 Design notification card layout
  - [x] 10.2.2 Display filing type, date, ticker
  - [x] 10.2.3 Add "View Deal" link
  - [x] 10.2.4 Add "Dismiss" button
- [x] 10.3 Implement notification polling
  - [x] 10.3.1 Poll every 5 minutes
  - [x] 10.3.2 Update badge count
  - [x] 10.3.3 Show toast for new notifications
- [x] 10.4 Frontend tests
  - [x] 10.4.1 Test notification display
  - [x] 10.4.2 Test dismissal
  - [x] 10.4.3 Test polling

### 11. Monitoring & Observability
- [x] 11.1 Add CloudWatch metrics
  - [x] 11.1.1 detection_duration
  - [x] 11.1.2 download_duration
  - [x] 11.1.3 processing_duration
  - [x] 11.1.4 new_filings_count
  - [x] 11.1.5 error_count
- [x] 11.2 Add CloudWatch alarms
  - [x] 11.2.1 Alert on detection failures
  - [x] 11.2.2 Alert on processing backlog
  - [x] 11.2.3 Alert on rate limit errors
- [x] 11.3 Add structured logging
  - [x] 11.3.1 Log all detection runs
  - [x] 11.3.2 Log all downloads
  - [x] 11.3.3 Log all processing
  - [x] 11.3.4 Log all errors with context

### 12. Deployment
- [ ] 12.1 Deploy to staging
  - [ ] 12.1.1 Run database migrations
  - [ ] 12.1.2 Deploy backend services
  - [ ] 12.1.3 Deploy frontend updates
  - [ ] 12.1.4 Run smoke tests
- [ ] 12.2 Production deployment
  - [ ] 12.2.1 Enable feature flag
  - [ ] 12.2.2 Monitor detection runs
  - [ ] 12.2.3 Monitor error rates
  - [ ] 12.2.4 Monitor user engagement
- [ ] 12.3 Post-deployment validation
  - [ ] 12.3.1 Verify detection runs daily
  - [ ] 12.3.2 Verify notifications created
  - [ ] 12.3.3 Verify tenant isolation
  - [ ] 12.3.4 Gather user feedback

## Success Criteria

- All 12 phases complete
- All unit tests passing (>90% coverage)
- All integration tests passing
- All property-based tests passing
- Detection runs successfully for 7 consecutive days
- 100% of new filings detected within 24 hours
- <1% duplicate downloads
- 95%+ of filings processed within 1 hour
- 99.9% detection job success rate
- Zero critical bugs in production
- Positive user feedback on notifications

## Optional Enhancements (Post-MVP)

- [ ]* Add SQS queue for async downloads
- [ ]* Add continuous polling (every 4 hours)
- [ ]* Add email/Slack notifications
- [ ]* Add historical backfill for new deals
- [ ]* Add filing comparison features
- [ ]* Add predictive filing date estimation
