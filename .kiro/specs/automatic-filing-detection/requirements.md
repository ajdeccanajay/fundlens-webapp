# Requirements: Automatic Filing Detection System

## Overview

Implement an intelligent, automated system to detect, download, and process new SEC filings for companies tracked in tenant deals. The system operates transparently in the background, notifying users when new filings are available without disrupting their workflow. The architecture follows the "Process Once, Share Many" principle: download and parse data for ALL tenants (shared data layer), but only make it visible and queryable via tenant-scoped deals (access control layer).

## User Stories

### US-1: Automatic Filing Detection
**As a** portfolio manager  
**I want** the system to automatically detect when companies in my deals file new 10-Ks, 10-Qs, or 8-Ks with the SEC  
**So that** I don't have to manually check EDGAR for updates

**Acceptance Criteria:**
- System checks for new filings daily at 6 AM ET (after market close)
- Detects 10-K, 10-Q, and 8-K filings
- Only checks companies that exist in at least one tenant's deals
- Tracks last check timestamp per ticker
- Handles SEC rate limits (10 requests/second)

### US-2: Background Processing
**As a** equity analyst  
**I want** new filings to be downloaded and processed automatically in the background  
**So that** I can query them immediately when I need them without waiting

**Acceptance Criteria:**
- Downloads raw filing from SEC EDGAR
- Stores in S3 data lake (shared, no tenant_id)
- Extracts financial metrics using Python parser
- Chunks narrative sections for RAG
- Uploads chunks to Bedrock KB
- All processing happens asynchronously
- No impact on user-facing API performance

### US-3: Filing Notifications
**As a** portfolio manager  
**I want** to be notified when new filings are available for my deals  
**So that** I can review them promptly

**Acceptance Criteria:**
- Notification appears in workspace UI for relevant deals
- Shows filing type (10-K, 10-Q, 8-K) and filing date
- Links directly to the deal's workspace
- Notification is tenant-scoped (only shows for deals in my tenant)
- Dismissible by user
- Persists until dismissed or 30 days old

### US-4: Tenant Isolation
**As a** platform administrator  
**I want** filing data to be shared across tenants while maintaining access control  
**So that** we don't duplicate storage but maintain security

**Acceptance Criteria:**
- SEC filing data stored WITHOUT tenant_id (shared data layer)
- Filing notifications stored WITH tenant_id (access control layer)
- Tenant A creating a deal for AAPL does NOT trigger re-download of existing AAPL filings
- Tenant B can access same AAPL filing data via their own deals
- RAG queries filtered by tenant's deals (validateTickerAccess)
- Audit logs track which tenant accessed which filing

### US-5: Incremental Detection
**As a** system administrator  
**I want** the system to only download NEW filings, not re-process existing ones  
**So that** we minimize API calls, storage costs, and processing time

**Acceptance Criteria:**
- Checks filing_metadata table before downloading
- Skips filings that already exist in data_sources
- Updates last_check_date per ticker
- Handles edge cases (filing amended, filing withdrawn)
- Logs skipped filings for monitoring

### US-6: Error Handling & Retry
**As a** system administrator  
**I want** the system to gracefully handle failures and retry intelligently  
**So that** temporary issues don't cause permanent data gaps

**Acceptance Criteria:**
- Retries failed downloads with exponential backoff
- Logs all errors with context (ticker, filing type, error message)
- Alerts on repeated failures (>3 consecutive failures for same ticker)
- Continues processing other tickers if one fails
- Stores partial results (e.g., metrics extracted but narratives failed)

## Functional Requirements

### FR-1: Filing Detection Service
- Query SEC EDGAR API for new filings
- Filter by filing types: 10-K, 10-Q, 8-K
- Check only tickers that exist in deals table
- Compare against existing filing_metadata records
- Return list of new filings to download

### FR-2: Scheduled Detection Job
- Run daily at 6 AM ET (configurable)
- Use NestJS @Cron decorator or AWS EventBridge
- Process all tracked tickers in batches
- Rate limit to 10 requests/second (SEC requirement)
- Log execution time and results

### FR-3: Filing Download & Storage
- Download raw filing from SEC EDGAR
- Store in S3: `public/sec-filings/{ticker}/{filing-type}/{accession-number}/filing.html`
- Create data_source record (visibility='public', owner_tenant_id=NULL)
- Mark as unprocessed initially

### FR-4: Filing Processing Pipeline
- Extract financial metrics (Python parser)
- Chunk narrative sections (500-2000 tokens)
- Store metrics in financial_metrics table (no tenant_id)
- Store narrative chunks in narrative_chunks table (no tenant_id)
- Upload chunks to S3 for Bedrock KB
- Trigger Bedrock KB ingestion job
- Mark data_source as processed

### FR-5: Notification Service
- Create filing_notifications record per tenant that has a deal for the ticker
- Include: ticker, filing_type, filing_date, accession_number, tenant_id
- Expose via API: GET /api/notifications?tenant_id={tenant_id}
- Support dismissal: DELETE /api/notifications/{notification_id}
- Auto-expire after 30 days

### FR-6: Tenant Access Control
- Enforce tenant isolation via TenantGuard
- validateTickerAccess(ticker, tenant_id) checks if tenant has a deal for ticker
- RAG queries filtered by tenant's accessible tickers
- Audit log all filing access with tenant_id

## Non-Functional Requirements

### NFR-1: Performance
- Filing detection: <5 minutes for 100 tickers
- Download & storage: <30 seconds per filing
- Processing: <2 minutes per filing (metrics + narratives)
- Notification creation: <1 second per tenant
- No impact on user-facing API latency

### NFR-2: Reliability
- 99.9% uptime for detection job
- Automatic retry on transient failures
- Graceful degradation (continue processing other tickers if one fails)
- Idempotent operations (safe to re-run)

### NFR-3: Scalability
- Support 1,000+ tracked tickers
- Handle 50+ new filings per day
- Process 10+ concurrent filings
- Scale horizontally (multiple workers)

### NFR-4: Cost Efficiency
- Minimize SEC API calls (incremental detection)
- Avoid duplicate storage (shared data layer)
- Efficient S3 usage (lifecycle policies)
- Optimize Bedrock KB ingestion (batch uploads)

### NFR-5: Observability
- Log all detection runs (tickers checked, new filings found)
- Log all downloads (success, failure, retry count)
- Log all processing (metrics extracted, chunks created)
- Metrics: detection_duration, download_duration, processing_duration
- Alerts: repeated failures, rate limit exceeded, processing backlog

## Data Requirements

### DR-1: Filing Metadata Tracking
- filing_metadata table: ticker, filing_type, accession_number, filing_date, report_date, processed, last_check_date
- Indexes: (ticker, filing_type), (filing_date), (processed)

### DR-2: Filing Notifications
- filing_notifications table: id, tenant_id, ticker, filing_type, filing_date, accession_number, dismissed, created_at
- Indexes: (tenant_id, dismissed), (ticker), (created_at)

### DR-3: Detection State
- filing_detection_state table: ticker, last_check_date, last_filing_date, check_count, consecutive_failures
- Indexes: (ticker), (last_check_date)

### DR-4: Audit Logs
- audit_logs table: tenant_id, user_id, action, resource_type, resource_id, ip_address, timestamp
- Indexes: (tenant_id, timestamp), (resource_type, resource_id)

## Success Metrics

### SM-1: Detection Accuracy
- 100% of new filings detected within 24 hours
- <1% false positives (duplicate detection)
- <0.1% false negatives (missed filings)

### SM-2: Processing Efficiency
- 95%+ of filings processed within 1 hour of detection
- <5% processing failures
- <10% retry rate

### SM-3: User Engagement
- 70%+ of users view notifications within 48 hours
- 50%+ of users click through to deal workspace
- <10% notification dismissal without viewing

### SM-4: System Health
- 99.9% detection job success rate
- <1% SEC API rate limit errors
- <5 minute average detection duration

## Out of Scope (Future Enhancements)

- Real-time filing detection (polling every 15 minutes)
- Email/Slack notifications
- Custom filing type filters per tenant
- Historical backfill for new deals
- Filing comparison (diff between 10-K FY2024 vs FY2023)
- Predictive filing date estimation
- Integration with earnings call transcripts
- Support for international filings (non-SEC)

## Dependencies

- Existing SEC sync service (src/s3/sec-sync.service.ts)
- Existing SEC processing service (src/s3/sec-processing.service.ts)
- Tenant isolation architecture (.kiro/specs/tenant-isolation/design.md)
- Bedrock KB sync service (src/rag/kb-sync.service.ts)
- NestJS @Cron or AWS EventBridge for scheduling

## Assumptions

- SEC EDGAR API is available and reliable
- Filings are available within 24 hours of filing date
- Tenants have at least one deal to trigger detection
- Python parser can handle all filing formats
- Bedrock KB can ingest 100+ chunks per day

## Constraints

- SEC rate limit: 10 requests/second
- S3 storage costs (optimize with lifecycle policies)
- Bedrock KB ingestion limits (check AWS quotas)
- Processing time must not block user-facing APIs
- Must maintain backward compatibility with existing pipeline
