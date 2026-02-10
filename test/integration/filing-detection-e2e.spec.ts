import { Test, TestingModule } from '@nestjs/testing';
import { FilingDetectorService, SECFiling, DetectionResult } from '../../src/filings/filing-detector.service';
import { FilingDownloadService, DownloadResult } from '../../src/filings/filing-download.service';
import { FilingNotificationService } from '../../src/filings/filing-notification.service';
import { FilingDetectionScheduler, DetectionSummary } from '../../src/filings/filing-detection-scheduler.service';
import { RateLimiterService } from '../../src/filings/rate-limiter.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SecService } from '../../src/dataSources/sec/sec.service';
import { SECSyncService } from '../../src/s3/sec-sync.service';
import { SECProcessingService } from '../../src/s3/sec-processing.service';
import { DistributedLockService } from '../../src/common/distributed-lock.service';

/**
 * Integration Tests: End-to-End Filing Detection Flow (Task 7.1)
 *
 * Tests the full pipeline: detection → download → process → notify
 * Uses mocked external dependencies (SEC API, S3, database) but real service interactions.
 * Validates the orchestration between FilingDetectorService, FilingDownloadService,
 * FilingNotificationService, and FilingDetectionScheduler.
 */

// ============================================================
// Shared test helpers and mock factories
// ============================================================

function createMockSECFiling(overrides: Partial<SECFiling> = {}): SECFiling {
  return {
    accessionNumber: '0000320193-24-000123',
    filingDate: new Date('2024-11-01'),
    reportDate: new Date('2024-09-30'),
    form: '10-K',
    url: 'https://www.sec.gov/Archives/edgar/data/320193/filing.htm',
    primaryDocument: 'filing.htm',
    ...overrides,
  };
}

function createMockFilingsResponse(
  filings: Array<{
    form: string;
    filingDate: string;
    reportDate: string;
    accessionNumber: string;
    primaryDocument: string;
    url: string;
  }>,
  formType: string = '10-K',
) {
  return {
    metadata: {
      cik: '0000320193',
      ticker: 'AAPL',
      companyName: 'Apple Inc.',
      dateRange: { startDate: undefined, endDate: undefined },
      formType,
      includeOlderPages: false,
    },
    summary: {
      totalFilings: filings.length,
      filingsInDateRange: filings.length,
      finalResults: filings.length,
      tenKCount: filings.filter((f) => f.form === '10-K').length,
      tenQCount: filings.filter((f) => f.form === '10-Q').length,
      eightKCount: filings.filter((f) => f.form === '8-K').length,
    },
    filings: { tenK: [], tenQ: [], eightK: [] },
    allFilings: filings.map((f) => ({ ...f, items: undefined })),
  };
}

// ============================================================
// 7.1.1 Test detection → download → process → notify
// ============================================================
describe('Integration: End-to-End Filing Detection Flow', () => {
  let detectorService: FilingDetectorService;
  let downloadService: FilingDownloadService;
  let notificationService: FilingNotificationService;
  let scheduler: FilingDetectionScheduler;
  let prisma: PrismaService;
  let secService: SecService;
  let secSyncService: SECSyncService;
  let secProcessingService: SECProcessingService;
  let rateLimiter: RateLimiterService;

  // Shared mock references for assertions
  const mockPrisma = {
    filingDetectionState: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    dataSource: {
      findMany: jest.fn(),
    },
    deal: {
      findMany: jest.fn(),
    },
    filingNotification: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    s3SyncState: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const mockSecService = {
    getCikForTicker: jest.fn(),
    getFillings: jest.fn(),
  };

  const mockSecSyncService = {
    syncTicker: jest.fn(),
    syncFilingType: jest.fn(),
  };

  const mockSecProcessingService = {
    processFiling: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilingDetectorService,
        FilingDownloadService,
        FilingNotificationService,
        FilingDetectionScheduler,
        RateLimiterService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SecService, useValue: mockSecService },
        { provide: SECSyncService, useValue: mockSecSyncService },
        { provide: SECProcessingService, useValue: mockSecProcessingService },
        { provide: DistributedLockService, useValue: { withLock: jest.fn().mockImplementation((_key: string, cb: () => Promise<any>) => cb()), tryAcquire: jest.fn().mockResolvedValue(true), release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    detectorService = module.get<FilingDetectorService>(FilingDetectorService);
    downloadService = module.get<FilingDownloadService>(FilingDownloadService);
    notificationService = module.get<FilingNotificationService>(FilingNotificationService);
    scheduler = module.get<FilingDetectionScheduler>(FilingDetectionScheduler);
    prisma = module.get<PrismaService>(PrismaService);
    secService = module.get<SecService>(SecService);
    secSyncService = module.get<SECSyncService>(SECSyncService);
    secProcessingService = module.get<SECProcessingService>(SECProcessingService);
    rateLimiter = module.get<RateLimiterService>(RateLimiterService);

    // Reset rate limiter for clean state
    rateLimiter.resetMetrics();
  });

  // ============================================================
  // 7.1.1 Test detection → download → process → notify
  // ============================================================
  describe('7.1.1 Detection → Download → Process → Notify', () => {
    it('should execute the full pipeline: detect new filing, download, process, and notify tenants', async () => {
      // Setup: AAPL has a new 10-K filing, tenant-1 has a deal for AAPL
      const aaplFiling = {
        form: '10-K',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        accessionNumber: '0000320193-24-000123',
        primaryDocument: 'aapl-20240930.htm',
        url: 'https://www.sec.gov/Archives/edgar/data/320193/filing.htm',
      };

      // 1. Detector: no previous detection state
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue(null);

      // 2. Detector: CIK lookup
      mockSecService.getCikForTicker.mockResolvedValue({
        ticker: 'AAPL',
        cik: '0000320193',
        cik_numeric: 320193,
        name: 'Apple Inc.',
      });

      // 3. Detector: SEC returns one new filing
      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse([aaplFiling], '10-K'),
      );

      // 4. Detector: no existing data sources (filing is new)
      mockPrisma.dataSource.findMany.mockResolvedValue([]);

      // 5. Detector: upsert detection state
      mockPrisma.filingDetectionState.upsert.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        lastFilingDate: new Date('2024-11-01'),
        checkCount: 1,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Step 1: Detect new filings
      const detectionResult = await detectorService.detectNewFilings('AAPL', ['10-K']);

      expect(detectionResult.ticker).toBe('AAPL');
      expect(detectionResult.newFilings).toBe(1);
      expect(detectionResult.errors).toHaveLength(0);

      // Step 2: Download and process via download service
      // Mock sync (download)
      mockSecSyncService.syncTicker.mockResolvedValue([
        { ticker: 'AAPL', filingType: '10-K', newFilings: 1, skipped: 0, errors: 0 },
      ]);

      // Mock processing
      mockSecProcessingService.processFiling.mockResolvedValue({
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        metricsExtracted: 45,
        narrativesExtracted: 12,
        processingTime: 1500,
        status: 'success',
        errors: [],
      });

      // Mock tenant deals for notification
      mockPrisma.deal.findMany.mockResolvedValue([
        { tenantId: 'tenant-1' },
      ]);

      // Mock notification creation
      mockPrisma.filingNotification.create.mockResolvedValue({
        id: 'notif-1',
        tenantId: 'tenant-1',
        ticker: 'AAPL',
        filingType: '10-K',
        filingDate: new Date('2024-11-01'),
        reportDate: new Date('2024-09-30'),
        accessionNumber: '0000320193-24-000123',
        dismissed: false,
        dismissedAt: null,
        createdAt: new Date(),
      });

      const downloadResult = await downloadService.queueDownload(
        'AAPL',
        createMockSECFiling({
          accessionNumber: '0000320193-24-000123',
          form: '10-K',
        }),
      );

      // Verify full pipeline completed
      expect(downloadResult.downloadSuccess).toBe(true);
      expect(downloadResult.processingResult).toBeDefined();
      expect(downloadResult.processingResult?.status).toBe('success');
      expect(downloadResult.processingResult?.metricsExtracted).toBe(45);
      expect(downloadResult.processingResult?.narrativesExtracted).toBe(12);
      expect(downloadResult.notificationsSent).toBe(1);
      expect(downloadResult.errors).toHaveLength(0);

      // Verify SEC sync was called
      expect(mockSecSyncService.syncTicker).toHaveBeenCalledWith('AAPL', ['10-K']);

      // Verify processing was called
      expect(mockSecProcessingService.processFiling).toHaveBeenCalledWith(
        'AAPL',
        '10-K',
        '0000320193-24-000123',
      );

      // Verify notification was created for tenant-1
      expect(mockPrisma.filingNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          ticker: 'AAPL',
          filingType: '10-K',
          accessionNumber: '0000320193-24-000123',
          dismissed: false,
        }),
      });
    });

    it('should handle partial processing failure gracefully', async () => {
      // Setup: download succeeds, processing partially fails
      mockSecSyncService.syncTicker.mockResolvedValue([
        { ticker: 'AAPL', filingType: '10-K', newFilings: 1, skipped: 0, errors: 0 },
      ]);

      mockSecProcessingService.processFiling.mockResolvedValue({
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        metricsExtracted: 45,
        narrativesExtracted: 0,
        processingTime: 800,
        status: 'partial',
        errors: ['Narrative extraction failed: parser timeout'],
      });

      // Notifications should still be sent for partial success
      mockPrisma.deal.findMany.mockResolvedValue([{ tenantId: 'tenant-1' }]);
      mockPrisma.filingNotification.create.mockResolvedValue({
        id: 'notif-1',
        tenantId: 'tenant-1',
        ticker: 'AAPL',
        filingType: '10-K',
        filingDate: new Date('2024-11-01'),
        reportDate: new Date('2024-09-30'),
        accessionNumber: '0000320193-24-000123',
        dismissed: false,
        dismissedAt: null,
        createdAt: new Date(),
      });

      const result = await downloadService.queueDownload(
        'AAPL',
        createMockSECFiling(),
      );

      expect(result.downloadSuccess).toBe(true);
      expect(result.processingResult?.status).toBe('partial');
      // Notifications still sent for partial success
      expect(result.notificationsSent).toBe(1);
      // Errors are tracked
      expect(result.errors.some((e) => e.includes('partial'))).toBe(true);
    });

    it('should skip notifications when processing completely fails', async () => {
      mockSecSyncService.syncTicker.mockResolvedValue([
        { ticker: 'AAPL', filingType: '10-K', newFilings: 1, skipped: 0, errors: 0 },
      ]);

      mockSecProcessingService.processFiling.mockResolvedValue({
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        metricsExtracted: 0,
        narrativesExtracted: 0,
        processingTime: 200,
        status: 'failed',
        errors: ['Parser crashed'],
      });

      const result = await downloadService.queueDownload(
        'AAPL',
        createMockSECFiling(),
      );

      expect(result.downloadSuccess).toBe(true);
      expect(result.processingResult?.status).toBe('failed');
      // No notifications sent when processing fails completely
      expect(result.notificationsSent).toBe(0);
      expect(mockPrisma.filingNotification.create).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // 7.1.2 Test with multiple tickers
  // ============================================================
  describe('7.1.2 Multiple Tickers', () => {
    it('should detect and process filings for multiple tickers independently', async () => {
      // Setup: AAPL and MSFT both have new filings
      const tickers = ['AAPL', 'MSFT'];
      const cikMap: Record<string, string> = {
        AAPL: '0000320193',
        MSFT: '0000789019',
      };

      // Mock deals for both tickers
      mockPrisma.deal.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.ticker && !args?.select) {
          // This is the notification service looking for tenants with deals for a ticker
          return [{ tenantId: 'tenant-1' }];
        }
        if (args?.distinct) {
          // This is the scheduler looking for tracked tickers
          return tickers.map((t) => ({ ticker: t }));
        }
        return [];
      });

      // Mock no previous detection state for either ticker
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue(null);

      // Mock CIK lookups
      mockSecService.getCikForTicker.mockImplementation(async (ticker: string) => ({
        ticker,
        cik: cikMap[ticker],
        cik_numeric: parseInt(cikMap[ticker]),
        name: `${ticker} Inc.`,
      }));

      // Mock SEC filings for each ticker
      mockSecService.getFillings.mockImplementation(async (cik: string, opts: any) => {
        const ticker = cik === '0000320193' ? 'AAPL' : 'MSFT';
        const formType = opts.formType;

        if (formType === '10-K') {
          return createMockFilingsResponse(
            [
              {
                form: '10-K',
                filingDate: '2024-11-01',
                reportDate: '2024-09-30',
                accessionNumber: `${cik}-24-000123`,
                primaryDocument: `${ticker.toLowerCase()}-20240930.htm`,
                url: `https://www.sec.gov/Archives/edgar/data/${cik}/filing.htm`,
              },
            ],
            '10-K',
          );
        }
        return createMockFilingsResponse([], formType);
      });

      // Mock no existing data sources
      mockPrisma.dataSource.findMany.mockResolvedValue([]);

      // Mock upsert
      mockPrisma.filingDetectionState.upsert.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        lastFilingDate: new Date('2024-11-01'),
        checkCount: 1,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Detect for AAPL
      const aaplResult = await detectorService.detectNewFilings('AAPL', ['10-K', '10-Q', '8-K']);
      expect(aaplResult.ticker).toBe('AAPL');
      expect(aaplResult.newFilings).toBe(1);
      expect(aaplResult.errors).toHaveLength(0);

      // Detect for MSFT
      const msftResult = await detectorService.detectNewFilings('MSFT', ['10-K', '10-Q', '8-K']);
      expect(msftResult.ticker).toBe('MSFT');
      expect(msftResult.newFilings).toBe(1);
      expect(msftResult.errors).toHaveLength(0);

      // Verify CIK lookups were made for both tickers
      expect(mockSecService.getCikForTicker).toHaveBeenCalledWith('AAPL');
      expect(mockSecService.getCikForTicker).toHaveBeenCalledWith('MSFT');

      // Verify SEC API was called for each ticker × filing type
      expect(mockSecService.getFillings).toHaveBeenCalledTimes(6); // 2 tickers × 3 filing types
    });

    it('should continue processing other tickers when one fails (error isolation)', async () => {
      // AAPL fails, MSFT succeeds
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue(null);

      // AAPL CIK lookup fails
      mockSecService.getCikForTicker.mockImplementation(async (ticker: string) => {
        if (ticker === 'AAPL') {
          throw new Error('CIK not found for ticker AAPL');
        }
        return {
          ticker: 'MSFT',
          cik: '0000789019',
          cik_numeric: 789019,
          name: 'Microsoft Corp.',
        };
      });

      // MSFT has filings
      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse(
          [
            {
              form: '10-K',
              filingDate: '2024-11-01',
              reportDate: '2024-09-30',
              accessionNumber: '0000789019-24-000456',
              primaryDocument: 'msft-20240930.htm',
              url: 'https://www.sec.gov/Archives/edgar/data/789019/filing.htm',
            },
          ],
          '10-K',
        ),
      );

      mockPrisma.dataSource.findMany.mockResolvedValue([]);
      mockPrisma.filingDetectionState.upsert.mockResolvedValue({
        ticker: 'MSFT',
        lastCheckDate: new Date(),
        lastFilingDate: new Date('2024-11-01'),
        checkCount: 1,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // AAPL should fail gracefully (after retries)
      const aaplResult = await detectorService.detectNewFilings('AAPL', ['10-K'], 0);
      expect(aaplResult.ticker).toBe('AAPL');
      expect(aaplResult.newFilings).toBe(0);
      expect(aaplResult.errors.length).toBeGreaterThan(0);

      // MSFT should succeed independently
      const msftResult = await detectorService.detectNewFilings('MSFT', ['10-K']);
      expect(msftResult.ticker).toBe('MSFT');
      expect(msftResult.newFilings).toBe(1);
      expect(msftResult.errors).toHaveLength(0);
    });
  });

  // ============================================================
  // 7.1.3 Test with multiple tenants
  // ============================================================
  describe('7.1.3 Multiple Tenants', () => {
    it('should create notifications for all tenants that have deals for the same ticker', async () => {
      // Setup: AAPL filing, tenant-1 and tenant-2 both have AAPL deals
      const filing: SECFiling = createMockSECFiling({
        accessionNumber: '0000320193-24-000123',
        form: '10-K',
      });

      // Both tenants have deals for AAPL
      mockPrisma.deal.findMany.mockResolvedValue([
        { tenantId: 'tenant-1' },
        { tenantId: 'tenant-2' },
      ]);

      // Mock notification creation for each tenant
      mockPrisma.filingNotification.create
        .mockResolvedValueOnce({
          id: 'notif-1',
          tenantId: 'tenant-1',
          ticker: 'AAPL',
          filingType: '10-K',
          filingDate: filing.filingDate,
          reportDate: filing.reportDate,
          accessionNumber: filing.accessionNumber,
          dismissed: false,
          dismissedAt: null,
          createdAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'notif-2',
          tenantId: 'tenant-2',
          ticker: 'AAPL',
          filingType: '10-K',
          filingDate: filing.filingDate,
          reportDate: filing.reportDate,
          accessionNumber: filing.accessionNumber,
          dismissed: false,
          dismissedAt: null,
          createdAt: new Date(),
        });

      const count = await notificationService.createNotifications('AAPL', {
        form: filing.form,
        filingDate: filing.filingDate,
        reportDate: filing.reportDate,
        accessionNumber: filing.accessionNumber,
      });

      // Both tenants should receive notifications
      expect(count).toBe(2);
      expect(mockPrisma.filingNotification.create).toHaveBeenCalledTimes(2);

      // Verify tenant-1 notification
      expect(mockPrisma.filingNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          ticker: 'AAPL',
          filingType: '10-K',
        }),
      });

      // Verify tenant-2 notification
      expect(mockPrisma.filingNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-2',
          ticker: 'AAPL',
          filingType: '10-K',
        }),
      });
    });

    it('should only notify tenants that have deals for the specific ticker', async () => {
      // tenant-1 has AAPL deal, tenant-2 has MSFT deal (not AAPL)
      mockPrisma.deal.findMany.mockResolvedValue([
        { tenantId: 'tenant-1' },
        // tenant-2 NOT included because they don't have an AAPL deal
      ]);

      mockPrisma.filingNotification.create.mockResolvedValue({
        id: 'notif-1',
        tenantId: 'tenant-1',
        ticker: 'AAPL',
        filingType: '10-K',
        filingDate: new Date('2024-11-01'),
        reportDate: new Date('2024-09-30'),
        accessionNumber: '0000320193-24-000123',
        dismissed: false,
        dismissedAt: null,
        createdAt: new Date(),
      });

      const count = await notificationService.createNotifications('AAPL', {
        form: '10-K',
        filingDate: new Date('2024-11-01'),
        reportDate: new Date('2024-09-30'),
        accessionNumber: '0000320193-24-000123',
      });

      // Only tenant-1 should receive notification
      expect(count).toBe(1);
      expect(mockPrisma.filingNotification.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.filingNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
        }),
      });
    });

    it('should handle full pipeline with multiple tenants via download service', async () => {
      // Download succeeds
      mockSecSyncService.syncTicker.mockResolvedValue([
        { ticker: 'AAPL', filingType: '10-K', newFilings: 1, skipped: 0, errors: 0 },
      ]);

      // Processing succeeds
      mockSecProcessingService.processFiling.mockResolvedValue({
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        metricsExtracted: 45,
        narrativesExtracted: 12,
        processingTime: 1500,
        status: 'success',
        errors: [],
      });

      // Three tenants have AAPL deals
      mockPrisma.deal.findMany.mockResolvedValue([
        { tenantId: 'tenant-1' },
        { tenantId: 'tenant-2' },
        { tenantId: 'tenant-3' },
      ]);

      mockPrisma.filingNotification.create.mockResolvedValue({
        id: 'notif-x',
        tenantId: 'tenant-x',
        ticker: 'AAPL',
        filingType: '10-K',
        filingDate: new Date('2024-11-01'),
        reportDate: new Date('2024-09-30'),
        accessionNumber: '0000320193-24-000123',
        dismissed: false,
        dismissedAt: null,
        createdAt: new Date(),
      });

      const result = await downloadService.queueDownload(
        'AAPL',
        createMockSECFiling(),
      );

      expect(result.downloadSuccess).toBe(true);
      expect(result.processingResult?.status).toBe('success');
      expect(result.notificationsSent).toBe(3);
      expect(mockPrisma.filingNotification.create).toHaveBeenCalledTimes(3);
    });
  });

  // ============================================================
  // 7.1.4 Verify no duplicate downloads
  // ============================================================
  describe('7.1.4 No Duplicate Downloads', () => {
    it('should skip filings that already exist in data_sources', async () => {
      // Setup: AAPL has 2 filings from SEC, but 1 already exists in data_sources
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue(null);

      mockSecService.getCikForTicker.mockResolvedValue({
        ticker: 'AAPL',
        cik: '0000320193',
        cik_numeric: 320193,
        name: 'Apple Inc.',
      });

      // SEC returns 2 filings
      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse(
          [
            {
              form: '10-K',
              filingDate: '2024-11-01',
              reportDate: '2024-09-30',
              accessionNumber: '0000320193-24-000123',
              primaryDocument: 'aapl-20240930.htm',
              url: 'https://www.sec.gov/Archives/edgar/data/320193/filing1.htm',
            },
            {
              form: '10-K',
              filingDate: '2023-11-01',
              reportDate: '2023-09-30',
              accessionNumber: '0000320193-23-000456',
              primaryDocument: 'aapl-20230930.htm',
              url: 'https://www.sec.gov/Archives/edgar/data/320193/filing2.htm',
            },
          ],
          '10-K',
        ),
      );

      // First filing already exists in data_sources
      mockPrisma.dataSource.findMany.mockResolvedValue([
        {
          id: '1',
          type: 'sec_filing',
          sourceId: 'AAPL-10-K-0000320193-24-000123',
          visibility: 'public',
          ownerTenantId: null,
          s3Path: 'public/sec-filings/AAPL/10-K/0000320193-24-000123',
          metadata: {
            ticker: 'AAPL',
            filingType: '10-K',
            accessionNumber: '0000320193-24-000123',
          },
          createdAt: new Date(),
        },
      ]);

      mockPrisma.filingDetectionState.upsert.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        lastFilingDate: new Date('2023-11-01'),
        checkCount: 1,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await detectorService.detectNewFilings('AAPL', ['10-K']);

      // Only 1 new filing (the second one), first was filtered out
      expect(result.newFilings).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect zero new filings when all filings already exist', async () => {
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-10-01'),
        lastFilingDate: new Date('2024-09-30'),
        checkCount: 5,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockSecService.getCikForTicker.mockResolvedValue({
        ticker: 'AAPL',
        cik: '0000320193',
        cik_numeric: 320193,
        name: 'Apple Inc.',
      });

      // SEC returns 1 filing
      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse(
          [
            {
              form: '10-K',
              filingDate: '2024-11-01',
              reportDate: '2024-09-30',
              accessionNumber: '0000320193-24-000123',
              primaryDocument: 'aapl-20240930.htm',
              url: 'https://www.sec.gov/Archives/edgar/data/320193/filing.htm',
            },
          ],
          '10-K',
        ),
      );

      // Filing already exists
      mockPrisma.dataSource.findMany.mockResolvedValue([
        {
          id: '1',
          type: 'sec_filing',
          sourceId: 'AAPL-10-K-0000320193-24-000123',
          visibility: 'public',
          ownerTenantId: null,
          s3Path: 'public/sec-filings/AAPL/10-K/0000320193-24-000123',
          metadata: {
            ticker: 'AAPL',
            filingType: '10-K',
            accessionNumber: '0000320193-24-000123',
          },
          createdAt: new Date(),
        },
      ]);

      mockPrisma.filingDetectionState.upsert.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        lastFilingDate: new Date('2024-09-30'),
        checkCount: 6,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await detectorService.detectNewFilings('AAPL', ['10-K']);

      expect(result.newFilings).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should not re-download when running detection twice for the same ticker', async () => {
      // First run: filing is new
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue(null);

      mockSecService.getCikForTicker.mockResolvedValue({
        ticker: 'AAPL',
        cik: '0000320193',
        cik_numeric: 320193,
        name: 'Apple Inc.',
      });

      const filingData = {
        form: '10-K',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        accessionNumber: '0000320193-24-000123',
        primaryDocument: 'aapl-20240930.htm',
        url: 'https://www.sec.gov/Archives/edgar/data/320193/filing.htm',
      };

      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse([filingData], '10-K'),
      );

      // First run: no existing data sources
      mockPrisma.dataSource.findMany.mockResolvedValueOnce([]);

      mockPrisma.filingDetectionState.upsert.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        lastFilingDate: new Date('2024-11-01'),
        checkCount: 1,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const firstResult = await detectorService.detectNewFilings('AAPL', ['10-K']);
      expect(firstResult.newFilings).toBe(1);

      // Second run: filing now exists in data_sources (was downloaded)
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        lastFilingDate: new Date('2024-11-01'),
        checkCount: 1,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockPrisma.dataSource.findMany.mockResolvedValueOnce([
        {
          id: '1',
          type: 'sec_filing',
          sourceId: 'AAPL-10-K-0000320193-24-000123',
          visibility: 'public',
          ownerTenantId: null,
          s3Path: 'public/sec-filings/AAPL/10-K/0000320193-24-000123',
          metadata: {
            ticker: 'AAPL',
            filingType: '10-K',
            accessionNumber: '0000320193-24-000123',
          },
          createdAt: new Date(),
        },
      ]);

      const secondResult = await detectorService.detectNewFilings('AAPL', ['10-K']);

      // Second run should find zero new filings
      expect(secondResult.newFilings).toBe(0);
      expect(secondResult.errors).toHaveLength(0);
    });
  });
});
