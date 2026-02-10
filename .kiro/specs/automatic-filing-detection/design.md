# Design Document: Automatic Filing Detection System

## Overview

This design implements an intelligent, event-driven system for automatically detecting, downloading, and processing new SEC filings for companies tracked in tenant deals. The architecture follows the "Process Once, Share Many" principle: filing data is stored in a shared data layer (no tenant_id) but access is controlled via tenant-scoped deals and notifications.

### Design Philosophy

1. **Shared Data Layer**: SEC filings are public data - download once, share across all tenants
2. **Tenant-Scoped Access**: Control visibility via deals and notifications, not data duplication
3. **Event-Driven**: Asynchronous processing with queues and workers
4. **Incremental**: Only detect and process NEW filings
5. **Resilient**: Graceful error handling, automatic retries, comprehensive logging

### Key Architectural Decisions

- **Scheduling**: Daily batch at 6 AM ET (MVP), with option to add continuous polling later
- **Detection Strategy**: Check only tickers that exist in deals table (not all 5,000+ public companies)
- **Storage Pattern**: S3 for raw filings + processed chunks, PostgreSQL for metadata + metrics
- **Notification Pattern**: Tenant-scoped notifications created AFTER successful processing
- **Tenant Isolation**: Enforced via TenantGuard + validateTickerAccess(), not data duplication

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AUTOMATIC FILING DETECTION SYSTEM                         │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    1. DETECTION SCHEDULER                           │    │
│  │  • Daily cron job (6 AM ET)                                         │    │
│  │  • Queries deals table for unique tickers                           │    │
│  │  • Checks filing_detection_state for last check                     │    │
│  │  • Triggers detection for each ticker                               │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                              ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    2. FILING DETECTOR SERVICE                       │    │
│  │  • Queries SEC EDGAR API for new filings                            │    │
│  │  • Filters by filing type (10-K, 10-Q, 8-K)                         │    │
│  │  • Compares against existing filing_metadata                        │    │
│  │  • Returns list of new filings                                      │    │
│  │  • Rate limits to 10 req/sec (SEC requirement)                      │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                              ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    3. FILING DOWNLOAD QUEUE                         │    │
│  │  • SQS queue (or in-memory for MVP)                                 │    │
│  │  • Buffers new filings for download                                 │    │
│  │  • Enables parallel processing                                      │    │
│  │  • Handles retries with exponential backoff                         │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                              ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    4. FILING DOWNLOAD WORKER                        │    │
│  │  • Downloads raw filing from SEC EDGAR                              │    │
│  │  • Stores in S3 (public/sec-filings/...)                            │    │
│  │  • Creates data_source record (visibility='public')                 │    │
│  │  • Triggers processing pipeline                                     │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                              ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    5. FILING PROCESSING PIPELINE                    │    │
│  │  • Extracts metrics (Python parser)                                 │    │
│  │  • Chunks narratives (500-2000 tokens)                              │    │
│  │  • Stores in PostgreSQL (no tenant_id)                              │    │
│  │  • Uploads chunks to S3 for Bedrock KB                              │    │
│  │  • Triggers Bedrock KB ingestion                                    │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                              ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    6. NOTIFICATION SERVICE                          │    │
│  │  • Finds all tenants with deals for ticker                          │    │
│  │  • Creates filing_notification per tenant                           │    │
│  │  • Tenant-scoped (includes tenant_id)                               │    │
│  │  • Exposed via API for UI consumption                               │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DETECTION & PROCESSING FLOW                          │
└─────────────────────────────────────────────────────────────────────────────┘

1. SCHEDULED TRIGGER (6 AM ET Daily)
   ↓
2. GET TRACKED TICKERS
   Query: SELECT DISTINCT ticker FROM deals WHERE ticker IS NOT NULL
   Result: ['AAPL', 'MSFT', 'AMZN', ...]
   ↓
3. FOR EACH TICKER: CHECK FOR NEW FILINGS
   SEC API: GET /cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=10-K|10-Q|8-K
   Filter: filing_date > last_check_date
   ↓
4. COMPARE AGAINST EXISTING FILINGS
   Query: SELECT accession_number FROM filing_metadata WHERE ticker = ? AND filing_type = ?
   Result: New filings = SEC filings - Existing filings
   ↓
5. DOWNLOAD NEW FILINGS
   For each new filing:
     - Download from SEC EDGAR
     - Store in S3: public/sec-filings/{ticker}/{filing-type}/{accession}/filing.html
     - Create data_source (visibility='public', owner_tenant_id=NULL)
   ↓
6. PROCESS FILINGS
   For each downloaded filing:
     - Extract metrics → financial_metrics table (no tenant_id)
     - Chunk narratives → narrative_chunks table (no tenant_id)
     - Upload chunks to S3 → fundlens-bedrock-chunks/chunks/{ticker}/
     - Trigger Bedrock KB ingestion
   ↓
7. CREATE NOTIFICATIONS
   For each processed filing:
     - Query: SELECT DISTINCT tenant_id FROM deals WHERE ticker = ?
     - For each tenant_id:
       - INSERT INTO filing_notifications (tenant_id, ticker, filing_type, ...)
   ↓
8. UPDATE DETECTION STATE
   UPDATE filing_detection_state SET last_check_date = NOW(), last_filing_date = ?
   WHERE ticker = ?
```

### Tenant Isolation Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SHARED DATA LAYER (No tenant_id)                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │  data_sources    │  │ financial_metrics│  │ narrative_chunks │          │
│  │  (SEC filings)   │  │  (parsed data)   │  │  (RAG content)   │          │
│  │                  │  │                  │  │                  │          │
│  │ visibility:      │  │ ticker: AAPL     │  │ ticker: AAPL     │          │
│  │   'public'       │  │ metric: Revenue  │  │ section: mda     │          │
│  │ owner: NULL      │  │ value: 394.3B    │  │ content: "..."   │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ Access controlled via
                                    │ validateTickerAccess()
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TENANT-SCOPED ACCESS LAYER (With tenant_id)               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │      deals       │  │ filing_notifs    │  │   audit_logs     │          │
│  │                  │  │                  │  │                  │          │
│  │ tenant_id: T1    │  │ tenant_id: T1    │  │ tenant_id: T1    │          │
│  │ ticker: AAPL     │  │ ticker: AAPL     │  │ action: view     │          │
│  │                  │  │ filing: 10-K     │  │ resource: AAPL   │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │      deals       │  │ filing_notifs    │  │   audit_logs     │          │
│  │                  │  │                  │  │                  │          │
│  │ tenant_id: T2    │  │ tenant_id: T2    │  │ tenant_id: T2    │          │
│  │ ticker: AAPL     │  │ ticker: AAPL     │  │ action: view     │          │
│  │                  │  │ filing: 10-K     │  │ resource: AAPL   │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘

KEY PRINCIPLE:
- Both Tenant 1 and Tenant 2 have deals for AAPL
- Both receive notifications when AAPL files a 10-K
- Both access the SAME underlying data (no duplication)
- Access is controlled via validateTickerAccess(ticker, tenant_id)
- Audit logs track which tenant accessed which filing
```

## Components and Interfaces

### 1. Filing Detection Scheduler

```typescript
// src/filings/filing-detection-scheduler.service.ts
@Injectable()
export class FilingDetectionScheduler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly detectorService: FilingDetectorService,
    private readonly logger: Logger,
  ) {}

  /**
   * Daily detection job - runs at 6 AM ET
   */
  @Cron('0 6 * * *', { timeZone: 'America/New_York' })
  async runDailyDetection(): Promise<DetectionSummary> {
    this.logger.log('Starting daily filing detection...');
    const startTime = Date.now();

    // Get all unique tickers from deals
    const trackedTickers = await this.getTrackedTickers();
    this.logger.log(`Checking ${trackedTickers.length} tickers for new filings`);

    const results: DetectionResult[] = [];

    for (const ticker of trackedTickers) {
      try {
        const result = await this.detectorService.detectNewFilings(ticker);
        results.push(result);

        // Rate limiting (SEC: 10 req/sec)
        await this.sleep(150);
      } catch (error) {
        this.logger.error(`Error detecting filings for ${ticker}: ${error.message}`);
        results.push({
          ticker,
          newFilings: 0,
          errors: [error.message],
        });
      }
    }

    const duration = Date.now() - startTime;
    const summary = this.summarizeResults(results, duration);

    this.logger.log(
      `Detection complete: ${summary.totalNewFilings} new filings found in ${duration}ms`,
    );

    return summary;
  }

  /**
   * Get all tickers that have at least one deal
   */
  private async getTrackedTickers(): Promise<string[]> {
    const deals = await this.prisma.deal.findMany({
      where: {
        ticker: { not: null },
      },
      select: { ticker: true },
      distinct: ['ticker'],
    });

    return deals.map(d => d.ticker).filter(Boolean) as string[];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

interface DetectionSummary {
  totalTickers: number;
  totalNewFilings: number;
  successCount: number;
  errorCount: number;
  duration: number;
  results: DetectionResult[];
}

interface DetectionResult {
  ticker: string;
  newFilings: number;
  errors: string[];
}
```

### 2. Filing Detector Service

```typescript
// src/filings/filing-detector.service.ts
@Injectable()
export class FilingDetectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secService: SecService,
    private readonly downloadService: FilingDownloadService,
    private readonly logger: Logger,
  ) {}

  /**
   * Detect new filings for a ticker
   */
  async detectNewFilings(
    ticker: string,
    filingTypes: string[] = ['10-K', '10-Q', '8-K'],
  ): Promise<DetectionResult> {
    this.logger.log(`Detecting new filings for ${ticker}...`);

    // Get last check date
    const detectionState = await this.getDetectionState(ticker);
    const lastCheckDate = detectionState?.lastCheckDate;

    // Get CIK for ticker
    const { cik } = await this.secService.getCikForTicker(ticker);

    // Query SEC EDGAR for filings since last check
    const allFilings: SECFiling[] = [];
    for (const filingType of filingTypes) {
      const filings = await this.secService.getFillings(cik, {
        formType: filingType,
        startDate: lastCheckDate?.toISOString().split('T')[0],
      });
      allFilings.push(...filings.allFilings);
    }

    // Filter out filings we already have
    const newFilings = await this.filterNewFilings(ticker, allFilings);

    this.logger.log(`Found ${newFilings.length} new filings for ${ticker}`);

    // Queue downloads
    for (const filing of newFilings) {
      await this.downloadService.queueDownload(ticker, filing);
    }

    // Update detection state
    await this.updateDetectionState(ticker, {
      lastCheckDate: new Date(),
      lastFilingDate: newFilings[0]?.filingDate,
      checkCount: (detectionState?.checkCount || 0) + 1,
      consecutiveFailures: 0,
    });

    return {
      ticker,
      newFilings: newFilings.length,
      errors: [],
    };
  }

  /**
   * Filter out filings that already exist in database
   */
  private async filterNewFilings(
    ticker: string,
    filings: SECFiling[],
  ): Promise<SECFiling[]> {
    const existingAccessions = await this.prisma.dataSource.findMany({
      where: {
        type: 'sec_filing',
        metadata: {
          path: ['ticker'],
          equals: ticker,
        },
      },
      select: {
        metadata: true,
      },
    });

    const existingSet = new Set(
      existingAccessions.map(ds => (ds.metadata as any).accessionNumber),
    );

    return filings.filter(f => !existingSet.has(f.accessionNumber));
  }

  /**
   * Get detection state for ticker
   */
  private async getDetectionState(ticker: string): Promise<any> {
    return this.prisma.filingDetectionState.findUnique({
      where: { ticker },
    });
  }

  /**
   * Update detection state
   */
  private async updateDetectionState(
    ticker: string,
    data: Partial<FilingDetectionState>,
  ): Promise<void> {
    await this.prisma.filingDetectionState.upsert({
      where: { ticker },
      create: {
        ticker,
        ...data,
      },
      update: data,
    });
  }
}

interface SECFiling {
  accessionNumber: string;
  filingDate: Date;
  reportDate: Date;
  form: string;
  url: string;
  primaryDocument: string;
}

interface FilingDetectionState {
  ticker: string;
  lastCheckDate: Date;
  lastFilingDate?: Date;
  checkCount: number;
  consecutiveFailures: number;
}
```

### 3. Filing Download Service

```typescript
// src/filings/filing-download.service.ts
@Injectable()
export class FilingDownloadService {
  constructor(
    private readonly secSyncService: SECSyncService,
    private readonly secProcessingService: SECProcessingService,
    private readonly notificationService: FilingNotificationService,
    private readonly logger: Logger,
  ) {}

  /**
   * Queue a filing for download and processing
   */
  async queueDownload(ticker: string, filing: SECFiling): Promise<void> {
    this.logger.log(
      `Queuing download: ${ticker} ${filing.form} ${filing.accessionNumber}`,
    );

    // For MVP: process synchronously
    // For production: use SQS queue
    try {
      await this.downloadAndProcess(ticker, filing);
    } catch (error) {
      this.logger.error(
        `Error downloading ${ticker} ${filing.form}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Download and process a filing
   */
  private async downloadAndProcess(
    ticker: string,
    filing: SECFiling,
  ): Promise<void> {
    // 1. Download raw filing
    await this.secSyncService.downloadAndStore(ticker, filing.form, filing);

    // 2. Process filing (extract metrics + narratives)
    const processingResult = await this.secProcessingService.processFiling(
      ticker,
      filing.form,
      filing.accessionNumber,
    );

    if (processingResult.status === 'success') {
      // 3. Create notifications for all tenants with deals for this ticker
      await this.notificationService.createNotifications(ticker, filing);

      this.logger.log(
        `Successfully processed ${ticker} ${filing.form} ${filing.accessionNumber}`,
      );
    } else {
      this.logger.error(
        `Processing failed for ${ticker} ${filing.form}: ${processingResult.errors.join(', ')}`,
      );
    }
  }
}
```

### 4. Filing Notification Service

```typescript
// src/filings/filing-notification.service.ts
@Injectable()
export class FilingNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
  ) {}

  /**
   * Create notifications for all tenants with deals for this ticker
   */
  async createNotifications(
    ticker: string,
    filing: SECFiling,
  ): Promise<number> {
    // Find all tenants that have deals for this ticker
    const deals = await this.prisma.deal.findMany({
      where: { ticker },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });

    const tenantIds = deals.map(d => d.tenantId);

    this.logger.log(
      `Creating notifications for ${ticker} ${filing.form} for ${tenantIds.length} tenants`,
    );

    // Create notification for each tenant
    const notifications = await Promise.all(
      tenantIds.map(tenantId =>
        this.prisma.filingNotification.create({
          data: {
            tenantId,
            ticker,
            filingType: filing.form,
            filingDate: filing.filingDate,
            reportDate: filing.reportDate,
            accessionNumber: filing.accessionNumber,
            dismissed: false,
          },
        }),
      ),
    );

    return notifications.length;
  }

  /**
   * Get notifications for a tenant
   */
  async getNotifications(
    tenantId: string,
    options?: { dismissed?: boolean; limit?: number },
  ): Promise<FilingNotification[]> {
    return this.prisma.filingNotification.findMany({
      where: {
        tenantId,
        dismissed: options?.dismissed ?? false,
      },
      orderBy: { filingDate: 'desc' },
      take: options?.limit || 50,
    });
  }

  /**
   * Dismiss a notification
   */
  async dismissNotification(
    notificationId: string,
    tenantId: string,
  ): Promise<void> {
    // Verify ownership before dismissing
    const notification = await this.prisma.filingNotification.findFirst({
      where: {
        id: notificationId,
        tenantId,
      },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.filingNotification.update({
      where: { id: notificationId },
      data: { dismissed: true, dismissedAt: new Date() },
    });
  }

  /**
   * Auto-expire old notifications (30 days)
   */
  @Cron('0 0 * * *') // Daily at midnight
  async expireOldNotifications(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await this.prisma.filingNotification.updateMany({
      where: {
        createdAt: { lt: thirtyDaysAgo },
        dismissed: false,
      },
      data: { dismissed: true, dismissedAt: new Date() },
    });

    this.logger.log(`Auto-expired ${result.count} old notifications`);
    return result.count;
  }
}

interface FilingNotification {
  id: string;
  tenantId: string;
  ticker: string;
  filingType: string;
  filingDate: Date;
  reportDate: Date;
  accessionNumber: string;
  dismissed: boolean;
  dismissedAt?: Date;
  createdAt: Date;
}
```

## Database Schema

```sql
-- Filing detection state (tracks last check per ticker)
CREATE TABLE filing_detection_state (
  ticker VARCHAR(20) PRIMARY KEY,
  last_check_date TIMESTAMP NOT NULL DEFAULT NOW(),
  last_filing_date TIMESTAMP,
  check_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_filing_detection_last_check ON filing_detection_state(last_check_date);

-- Filing notifications (tenant-scoped)
CREATE TABLE filing_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticker VARCHAR(20) NOT NULL,
  filing_type VARCHAR(10) NOT NULL,
  filing_date DATE NOT NULL,
  report_date DATE,
  accession_number VARCHAR(50) NOT NULL,
  dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_filing_notifs_tenant ON filing_notifications(tenant_id, dismissed);
CREATE INDEX idx_filing_notifs_ticker ON filing_notifications(ticker);
CREATE INDEX idx_filing_notifs_created ON filing_notifications(created_at);

-- Extend existing data_sources table to track filing metadata
-- (Already exists, just documenting expected structure)
-- data_sources.metadata should include:
-- {
--   "ticker": "AAPL",
--   "filingType": "10-K",
--   "accessionNumber": "0000320193-24-000123",
--   "filingDate": "2024-11-01",
--   "reportDate": "2024-09-30",
--   "processed": true,
--   "downloadedAt": "2024-11-02T06:15:00Z",
--   "processedAt": "2024-11-02T06:20:00Z"
-- }
```

## API Endpoints

```typescript
// Get notifications for current tenant
GET /api/filings/notifications
Query params: ?dismissed=false&limit=50
Response: FilingNotification[]

// Dismiss a notification
DELETE /api/filings/notifications/:notificationId
Response: { success: true }

// Manually trigger detection for a ticker (admin only)
POST /api/filings/detect
Body: { ticker: "AAPL" }
Response: DetectionResult

// Get detection status for all tickers (admin only)
GET /api/filings/detection-status
Response: FilingDetectionState[]

// Get detection summary (admin only)
GET /api/filings/detection-summary
Response: DetectionSummary
```

## Correctness Properties

### Property 1: Detection Completeness
*For any* ticker T with at least one deal, if a new filing F is published to SEC EDGAR, the system SHALL detect F within 24 hours of publication.
**Validates: Requirements US-1, FR-1**

### Property 2: No Duplicate Downloads
*For any* filing F with accession number A, the system SHALL download F at most once, regardless of how many tenants have deals for F's ticker.
**Validates: Requirements US-5, FR-3**

### Property 3: Tenant Notification Completeness
*For any* successfully processed filing F for ticker T, the system SHALL create a notification for every tenant that has at least one deal where deal.ticker = T.
**Validates: Requirements US-3, FR-5**

### Property 4: Tenant Isolation in Notifications
*For any* tenant T1 and notification N where N.tenant_id = T2 and T1 ≠ T2, tenant T1 SHALL NOT be able to retrieve, view, or dismiss N.
**Validates: Requirements US-4, FR-6**

### Property 5: Shared Data Access
*For any* two tenants T1 and T2 that both have deals for ticker T, querying financial metrics for T SHALL return the same underlying data (same data_source records).
**Validates: Requirements US-4, NFR-4**

### Property 6: Incremental Detection
*For any* ticker T, if the system has already detected filing F (exists in data_sources), running detection again SHALL NOT re-download or re-process F.
**Validates: Requirements US-5, FR-1**

### Property 7: Processing Idempotency
*For any* filing F, processing F multiple times SHALL produce the same financial_metrics and narrative_chunks records (idempotent operation).
**Validates: Requirements NFR-2**

### Property 8: Notification Expiry
*For any* notification N created at time T, if N is not dismissed by time T+30 days, the system SHALL automatically mark N as dismissed.
**Validates: Requirements US-3 (Acceptance Criteria 5)**

### Property 9: Rate Limit Compliance
*For any* detection run, the system SHALL NOT exceed 10 requests per second to the SEC EDGAR API.
**Validates: Requirements US-1 (Acceptance Criteria 5), NFR-4**

### Property 10: Error Isolation
*For any* ticker T1 where detection or processing fails, the system SHALL continue processing other tickers T2, T3, ... without interruption.
**Validates: Requirements US-6, NFR-2**

## Testing Strategy

### Unit Tests
- FilingDetectionScheduler: Test cron scheduling, ticker retrieval
- FilingDetectorService: Test new filing detection, filtering logic
- FilingDownloadService: Test download queueing, error handling
- FilingNotificationService: Test notification creation, dismissal, expiry

### Integration Tests
- End-to-end detection flow: Trigger detection → Download → Process → Notify
- Tenant isolation: Verify tenant A cannot access tenant B's notifications
- Shared data access: Verify both tenants access same filing data
- Incremental detection: Verify no duplicate downloads

### Property-Based Tests
- Property 1: Detection Completeness
- Property 3: Tenant Notification Completeness
- Property 6: Incremental Detection
- Property 9: Rate Limit Compliance

## Deployment Strategy

### Phase 1: MVP (Week 1-2)
- Implement detection scheduler (daily at 6 AM ET)
- Implement filing detector service
- Implement download service (synchronous)
- Implement notification service
- Deploy to staging, test with 10 tickers

### Phase 2: Production Rollout (Week 3-4)
- Deploy to production with feature flag
- Monitor detection runs for 1 week
- Validate notification accuracy
- Gather user feedback

### Phase 3: Optimization (Week 5-6)
- Add SQS queue for async downloads
- Implement retry logic with exponential backoff
- Add CloudWatch metrics and alarms
- Optimize database queries

### Phase 4: Enhancements (Future)
- Add continuous polling (every 4 hours)
- Add email/Slack notifications
- Add historical backfill for new deals
- Add filing comparison features

## Success Metrics

- 100% of new filings detected within 24 hours
- <1% duplicate downloads
- 95%+ of filings processed within 1 hour
- 99.9% detection job success rate
- 70%+ of users view notifications within 48 hours

## Future Enhancements

- Real-time detection (polling every 15 minutes)
- Email/Slack notifications
- Custom filing type filters per tenant
- Historical backfill for new deals
- Filing comparison (diff between periods)
- Predictive filing date estimation
- Integration with earnings call transcripts
