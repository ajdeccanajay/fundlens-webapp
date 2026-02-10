import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FilingDetectorService, SECFiling } from '../../src/filings/filing-detector.service';
import { FilingDownloadService } from '../../src/filings/filing-download.service';
import { FilingNotificationService } from '../../src/filings/filing-notification.service';
import { FilingDetectionScheduler } from '../../src/filings/filing-detection-scheduler.service';
import { RateLimiterService } from '../../src/filings/rate-limiter.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SecService } from '../../src/dataSources/sec/sec.service';
import { SECSyncService } from '../../src/s3/sec-sync.service';
import { SECProcessingService } from '../../src/s3/sec-processing.service';
import { DistributedLockService } from '../../src/common/distributed-lock.service';

/**
 * Integration Tests: Tenant Isolation (Task 7.2)
 *
 * Validates Correctness Property 4 (Tenant Isolation in Notifications):
 *   For any tenant T1 and notification N where N.tenant_id = T2 and T1 ≠ T2,
 *   tenant T1 SHALL NOT be able to retrieve, view, or dismiss N.
 *
 * Validates Correctness Property 5 (Shared Data Access):
 *   For any two tenants T1 and T2 that both have deals for ticker T,
 *   querying financial metrics for T SHALL return the same underlying data.
 *
 * Also validates audit logging for all tenant access operations.
 */

// ============================================================
// Shared test helpers
// ============================================================

const TENANT_A = 'tenant-alpha';
const TENANT_B = 'tenant-beta';
const SHARED_TICKER = 'AAPL';
const TENANT_A_ONLY_TICKER = 'MSFT';

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

// ============================================================
// Main test suite
// ============================================================
describe('Integration: Tenant Isolation (Task 7.2)', () => {
  let notificationService: FilingNotificationService;
  let detectorService: FilingDetectorService;
  let downloadService: FilingDownloadService;

  // Shared mock references
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
    auditLog: {
      create: jest.fn(),
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

    notificationService = module.get<FilingNotificationService>(FilingNotificationService);
    detectorService = module.get<FilingDetectorService>(FilingDetectorService);
    downloadService = module.get<FilingDownloadService>(FilingDownloadService);

    // Reset rate limiter
    const rateLimiter = module.get<RateLimiterService>(RateLimiterService);
    rateLimiter.resetMetrics();
  });

  // ============================================================
  // 7.2.1 Verify tenant A cannot access tenant B's notifications
  // ============================================================
  describe('7.2.1 Tenant A cannot access Tenant B notifications', () => {
    /**
     * Validates Correctness Property 4: Tenant Isolation in Notifications
     * For any tenant T1 and notification N where N.tenant_id = T2 and T1 ≠ T2,
     * tenant T1 SHALL NOT be able to retrieve, view, or dismiss N.
     */

    it('should return only tenant A notifications when tenant A queries', async () => {
      // Setup: Both tenants have notifications, but queries are scoped
      const tenantANotifications = [
        {
          id: 'notif-a1',
          tenantId: TENANT_A,
          ticker: SHARED_TICKER,
          filingType: '10-K',
          filingDate: new Date('2024-11-01'),
          reportDate: new Date('2024-09-30'),
          accessionNumber: '0000320193-24-000123',
          dismissed: false,
          dismissedAt: null,
          createdAt: new Date(),
        },
        {
          id: 'notif-a2',
          tenantId: TENANT_A,
          ticker: TENANT_A_ONLY_TICKER,
          filingType: '10-Q',
          filingDate: new Date('2024-10-15'),
          reportDate: new Date('2024-09-30'),
          accessionNumber: '0000789019-24-000456',
          dismissed: false,
          dismissedAt: null,
          createdAt: new Date(),
        },
      ];

      mockPrisma.filingNotification.findMany.mockResolvedValue(tenantANotifications);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await notificationService.getNotifications(TENANT_A);

      // All returned notifications must belong to tenant A
      expect(result).toHaveLength(2);
      expect(result.every((n) => n.tenantId === TENANT_A)).toBe(true);

      // Verify the Prisma query was scoped to tenant A
      expect(mockPrisma.filingNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_A,
          }),
        }),
      );
    });

    it('should return only tenant B notifications when tenant B queries', async () => {
      const tenantBNotifications = [
        {
          id: 'notif-b1',
          tenantId: TENANT_B,
          ticker: SHARED_TICKER,
          filingType: '10-K',
          filingDate: new Date('2024-11-01'),
          reportDate: new Date('2024-09-30'),
          accessionNumber: '0000320193-24-000123',
          dismissed: false,
          dismissedAt: null,
          createdAt: new Date(),
        },
      ];

      mockPrisma.filingNotification.findMany.mockResolvedValue(tenantBNotifications);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await notificationService.getNotifications(TENANT_B);

      // All returned notifications must belong to tenant B
      expect(result).toHaveLength(1);
      expect(result.every((n) => n.tenantId === TENANT_B)).toBe(true);

      // Verify the Prisma query was scoped to tenant B
      expect(mockPrisma.filingNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_B,
          }),
        }),
      );
    });

    it('should prevent tenant A from dismissing tenant B notification', async () => {
      const tenantBNotificationId = 'notif-b1';

      // findFirst returns null because notification belongs to tenant B, not tenant A
      mockPrisma.filingNotification.findFirst.mockResolvedValue(null);
      mockPrisma.auditLog.create.mockResolvedValue({});

      // Tenant A tries to dismiss tenant B's notification
      await expect(
        notificationService.dismissNotification(tenantBNotificationId, TENANT_A),
      ).rejects.toThrow(NotFoundException);

      // Verify the ownership check queried both id AND tenantId
      expect(mockPrisma.filingNotification.findFirst).toHaveBeenCalledWith({
        where: {
          id: tenantBNotificationId,
          tenantId: TENANT_A,
        },
      });

      // Verify the notification was NOT updated (not dismissed)
      expect(mockPrisma.filingNotification.update).not.toHaveBeenCalled();
    });

    it('should allow tenant A to dismiss only their own notification', async () => {
      const tenantANotificationId = 'notif-a1';

      // findFirst returns the notification because it belongs to tenant A
      mockPrisma.filingNotification.findFirst.mockResolvedValue({
        id: tenantANotificationId,
        tenantId: TENANT_A,
        ticker: SHARED_TICKER,
        filingType: '10-K',
        dismissed: false,
      });
      mockPrisma.filingNotification.update.mockResolvedValue({
        id: tenantANotificationId,
        dismissed: true,
        dismissedAt: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      // Tenant A dismisses their own notification - should succeed
      await notificationService.dismissNotification(tenantANotificationId, TENANT_A);

      // Verify the update was called
      expect(mockPrisma.filingNotification.update).toHaveBeenCalledWith({
        where: { id: tenantANotificationId },
        data: { dismissed: true, dismissedAt: expect.any(Date) },
      });
    });

    it('should scope notification count to the requesting tenant', async () => {
      // Tenant A has 5 notifications
      mockPrisma.filingNotification.count.mockResolvedValue(5);

      const countA = await notificationService.getNotificationCount(TENANT_A);
      expect(countA).toBe(5);
      expect(mockPrisma.filingNotification.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT_A, dismissed: false },
      });

      jest.clearAllMocks();

      // Tenant B has 2 notifications
      mockPrisma.filingNotification.count.mockResolvedValue(2);

      const countB = await notificationService.getNotificationCount(TENANT_B);
      expect(countB).toBe(2);
      expect(mockPrisma.filingNotification.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT_B, dismissed: false },
      });
    });

    it('should create separate notifications per tenant for the same filing', async () => {
      // Both tenants have deals for AAPL
      mockPrisma.deal.findMany.mockResolvedValue([
        { tenantId: TENANT_A },
        { tenantId: TENANT_B },
      ]);

      mockPrisma.filingNotification.create
        .mockResolvedValueOnce({
          id: 'notif-a1',
          tenantId: TENANT_A,
          ticker: SHARED_TICKER,
          filingType: '10-K',
        })
        .mockResolvedValueOnce({
          id: 'notif-b1',
          tenantId: TENANT_B,
          ticker: SHARED_TICKER,
          filingType: '10-K',
        });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const filing = {
        form: '10-K',
        filingDate: new Date('2024-11-01'),
        reportDate: new Date('2024-09-30'),
        accessionNumber: '0000320193-24-000123',
      };

      const count = await notificationService.createNotifications(SHARED_TICKER, filing);

      // Both tenants should receive separate notifications
      expect(count).toBe(2);
      expect(mockPrisma.filingNotification.create).toHaveBeenCalledTimes(2);

      // Verify tenant A got their own notification
      expect(mockPrisma.filingNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_A,
          ticker: SHARED_TICKER,
          filingType: '10-K',
          accessionNumber: '0000320193-24-000123',
        }),
      });

      // Verify tenant B got their own notification
      expect(mockPrisma.filingNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_B,
          ticker: SHARED_TICKER,
          filingType: '10-K',
          accessionNumber: '0000320193-24-000123',
        }),
      });
    });

    it('should not notify tenant B for a ticker only tenant A has deals for', async () => {
      // Only tenant A has a deal for MSFT
      mockPrisma.deal.findMany.mockResolvedValue([
        { tenantId: TENANT_A },
      ]);

      mockPrisma.filingNotification.create.mockResolvedValue({
        id: 'notif-a1',
        tenantId: TENANT_A,
        ticker: TENANT_A_ONLY_TICKER,
        filingType: '10-Q',
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const filing = {
        form: '10-Q',
        filingDate: new Date('2024-10-15'),
        reportDate: new Date('2024-09-30'),
        accessionNumber: '0000789019-24-000456',
      };

      const count = await notificationService.createNotifications(TENANT_A_ONLY_TICKER, filing);

      // Only tenant A should receive a notification
      expect(count).toBe(1);
      expect(mockPrisma.filingNotification.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.filingNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_A,
        }),
      });
    });
  });

  // ============================================================
  // 7.2.2 Verify both tenants access same filing data
  // ============================================================
  describe('7.2.2 Both tenants access same filing data (shared data layer)', () => {
    /**
     * Validates Correctness Property 5: Shared Data Access
     * For any two tenants T1 and T2 that both have deals for ticker T,
     * querying financial metrics for T SHALL return the same underlying data.
     *
     * The "Process Once, Share Many" principle: SEC filings are stored in a
     * shared data layer (no tenant_id) while access is controlled via
     * tenant-scoped deals and notifications.
     */

    it('should detect the same filing once regardless of how many tenants have deals', async () => {
      // Setup: Both tenants have deals for AAPL, but detection runs once
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue(null);

      mockSecService.getCikForTicker.mockResolvedValue({
        ticker: SHARED_TICKER,
        cik: '0000320193',
        cik_numeric: 320193,
        name: 'Apple Inc.',
      });

      // SEC returns one new filing
      mockSecService.getFillings.mockResolvedValue({
        metadata: { cik: '0000320193', ticker: SHARED_TICKER },
        summary: { totalFilings: 1 },
        filings: { tenK: [], tenQ: [], eightK: [] },
        allFilings: [
          {
            form: '10-K',
            filingDate: '2024-11-01',
            reportDate: '2024-09-30',
            accessionNumber: '0000320193-24-000123',
            primaryDocument: 'aapl-20240930.htm',
            url: 'https://www.sec.gov/Archives/edgar/data/320193/filing.htm',
          },
        ],
      });

      // No existing data sources (filing is new)
      mockPrisma.dataSource.findMany.mockResolvedValue([]);
      mockPrisma.filingDetectionState.upsert.mockResolvedValue({
        ticker: SHARED_TICKER,
        lastCheckDate: new Date(),
        checkCount: 1,
        consecutiveFailures: 0,
      });

      // Detect new filings - this runs once for the ticker, not per tenant
      const result = await detectorService.detectNewFilings(SHARED_TICKER, ['10-K']);

      expect(result.ticker).toBe(SHARED_TICKER);
      expect(result.newFilings).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify SEC API was called only once per filing type (not per tenant)
      expect(mockSecService.getFillings).toHaveBeenCalledTimes(1);
    });

    it('should download and process a filing once, then notify both tenants', async () => {
      // Download succeeds (once)
      mockSecSyncService.syncTicker.mockResolvedValue([
        { ticker: SHARED_TICKER, filingType: '10-K', newFilings: 1, skipped: 0, errors: 0 },
      ]);

      // Processing succeeds (once) - shared data layer, no tenant_id
      mockSecProcessingService.processFiling.mockResolvedValue({
        ticker: SHARED_TICKER,
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        metricsExtracted: 45,
        narrativesExtracted: 12,
        processingTime: 1500,
        status: 'success',
        errors: [],
      });

      // Both tenants have deals for AAPL
      mockPrisma.deal.findMany.mockResolvedValue([
        { tenantId: TENANT_A },
        { tenantId: TENANT_B },
      ]);

      mockPrisma.filingNotification.create
        .mockResolvedValueOnce({
          id: 'notif-a1',
          tenantId: TENANT_A,
          ticker: SHARED_TICKER,
          filingType: '10-K',
        })
        .mockResolvedValueOnce({
          id: 'notif-b1',
          tenantId: TENANT_B,
          ticker: SHARED_TICKER,
          filingType: '10-K',
        });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const downloadResult = await downloadService.queueDownload(
        SHARED_TICKER,
        createMockSECFiling(),
      );

      // Filing was downloaded and processed ONCE
      expect(mockSecSyncService.syncTicker).toHaveBeenCalledTimes(1);
      expect(mockSecProcessingService.processFiling).toHaveBeenCalledTimes(1);

      // Both tenants were notified
      expect(downloadResult.notificationsSent).toBe(2);
      expect(mockPrisma.filingNotification.create).toHaveBeenCalledTimes(2);

      // Verify the processing result is shared (same metrics for both tenants)
      expect(downloadResult.processingResult?.metricsExtracted).toBe(45);
      expect(downloadResult.processingResult?.narrativesExtracted).toBe(12);
    });

    it('should store filing data without tenant_id (shared data layer)', async () => {
      // When downloading, the sync service stores data in the shared layer
      mockSecSyncService.syncTicker.mockResolvedValue([
        { ticker: SHARED_TICKER, filingType: '10-K', newFilings: 1, skipped: 0, errors: 0 },
      ]);

      mockSecProcessingService.processFiling.mockResolvedValue({
        ticker: SHARED_TICKER,
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        metricsExtracted: 45,
        narrativesExtracted: 12,
        processingTime: 1500,
        status: 'success',
        errors: [],
      });

      mockPrisma.deal.findMany.mockResolvedValue([
        { tenantId: TENANT_A },
        { tenantId: TENANT_B },
      ]);
      mockPrisma.filingNotification.create.mockResolvedValue({ id: 'notif-1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await downloadService.queueDownload(SHARED_TICKER, createMockSECFiling());

      // Verify syncTicker was called with just the ticker (no tenant_id)
      expect(mockSecSyncService.syncTicker).toHaveBeenCalledWith(
        SHARED_TICKER,
        ['10-K'],
      );

      // Verify processFiling was called with just ticker/type/accession (no tenant_id)
      expect(mockSecProcessingService.processFiling).toHaveBeenCalledWith(
        SHARED_TICKER,
        '10-K',
        '0000320193-24-000123',
      );
    });

    it('should not re-download when second tenant creates a deal for same ticker', async () => {
      // First detection: filing already exists in data_sources (was downloaded for tenant A)
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue({
        ticker: SHARED_TICKER,
        lastCheckDate: new Date('2024-11-02'),
        lastFilingDate: new Date('2024-11-01'),
        checkCount: 1,
        consecutiveFailures: 0,
      });

      mockSecService.getCikForTicker.mockResolvedValue({
        ticker: SHARED_TICKER,
        cik: '0000320193',
        cik_numeric: 320193,
        name: 'Apple Inc.',
      });

      mockSecService.getFillings.mockResolvedValue({
        metadata: { cik: '0000320193', ticker: SHARED_TICKER },
        summary: { totalFilings: 1 },
        filings: { tenK: [], tenQ: [], eightK: [] },
        allFilings: [
          {
            form: '10-K',
            filingDate: '2024-11-01',
            reportDate: '2024-09-30',
            accessionNumber: '0000320193-24-000123',
            primaryDocument: 'aapl-20240930.htm',
            url: 'https://www.sec.gov/Archives/edgar/data/320193/filing.htm',
          },
        ],
      });

      // Filing already exists in shared data layer
      mockPrisma.dataSource.findMany.mockResolvedValue([
        {
          id: '1',
          type: 'sec_filing',
          metadata: {
            ticker: SHARED_TICKER,
            filingType: '10-K',
            accessionNumber: '0000320193-24-000123',
          },
        },
      ]);

      mockPrisma.filingDetectionState.upsert.mockResolvedValue({
        ticker: SHARED_TICKER,
        lastCheckDate: new Date(),
        checkCount: 2,
        consecutiveFailures: 0,
      });

      // Run detection again (e.g., after tenant B creates a deal for AAPL)
      const result = await detectorService.detectNewFilings(SHARED_TICKER, ['10-K']);

      // No new filings detected - the filing already exists in the shared layer
      expect(result.newFilings).toBe(0);
      expect(result.errors).toHaveLength(0);

      // SEC API was queried but no download was triggered
      expect(mockSecService.getFillings).toHaveBeenCalledTimes(1);
    });

    it('should filter data_sources by ticker without tenant_id (shared layer)', async () => {
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue(null);

      mockSecService.getCikForTicker.mockResolvedValue({
        ticker: SHARED_TICKER,
        cik: '0000320193',
        cik_numeric: 320193,
        name: 'Apple Inc.',
      });

      mockSecService.getFillings.mockResolvedValue({
        metadata: { cik: '0000320193', ticker: SHARED_TICKER },
        summary: { totalFilings: 1 },
        filings: { tenK: [], tenQ: [], eightK: [] },
        allFilings: [
          {
            form: '10-K',
            filingDate: '2024-11-01',
            reportDate: '2024-09-30',
            accessionNumber: '0000320193-24-000123',
            primaryDocument: 'aapl-20240930.htm',
            url: 'https://www.sec.gov/Archives/edgar/data/320193/filing.htm',
          },
        ],
      });

      mockPrisma.dataSource.findMany.mockResolvedValue([]);
      mockPrisma.filingDetectionState.upsert.mockResolvedValue({});

      await detectorService.detectNewFilings(SHARED_TICKER, ['10-K']);

      // Verify data_sources query uses type filter (no tenant_id filter)
      expect(mockPrisma.dataSource.findMany).toHaveBeenCalledWith({
        where: {
          type: 'sec_filing',
        },
        select: {
          metadata: true,
        },
      });
    });
  });

  // ============================================================
  // 7.2.3 Verify audit logs track access
  // ============================================================
  describe('7.2.3 Audit logs track access', () => {
    /**
     * Validates that audit logs are created for all tenant access operations:
     * - Notification listing (filing_notification.list)
     * - Notification creation (filing_notification.create)
     * - Notification dismissal (filing_notification.dismiss)
     * - Denied dismissal attempts (filing_notification.dismiss_denied)
     */

    it('should audit log when tenant A lists their notifications', async () => {
      mockPrisma.filingNotification.findMany.mockResolvedValue([
        { id: 'notif-a1', tenantId: TENANT_A, ticker: SHARED_TICKER },
        { id: 'notif-a2', tenantId: TENANT_A, ticker: TENANT_A_ONLY_TICKER },
      ]);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await notificationService.getNotifications(TENANT_A);

      // Verify audit log was created with correct event type and tenant
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'filing_notification.list',
          details: expect.objectContaining({
            tenantId: TENANT_A,
            resource: 'filing_notification',
            count: 2,
            dismissed: false,
          }),
          timestamp: expect.any(Date),
        }),
      });
    });

    it('should audit log when tenant B lists their notifications', async () => {
      mockPrisma.filingNotification.findMany.mockResolvedValue([
        { id: 'notif-b1', tenantId: TENANT_B, ticker: SHARED_TICKER },
      ]);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await notificationService.getNotifications(TENANT_B);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'filing_notification.list',
          details: expect.objectContaining({
            tenantId: TENANT_B,
            count: 1,
          }),
        }),
      });
    });

    it('should audit log notification creation for each tenant separately', async () => {
      // Both tenants have deals for AAPL
      mockPrisma.deal.findMany.mockResolvedValue([
        { tenantId: TENANT_A },
        { tenantId: TENANT_B },
      ]);
      mockPrisma.filingNotification.create.mockResolvedValue({ id: 'notif-1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const filing = {
        form: '10-K',
        filingDate: new Date('2024-11-01'),
        reportDate: new Date('2024-09-30'),
        accessionNumber: '0000320193-24-000123',
      };

      await notificationService.createNotifications(SHARED_TICKER, filing);

      // Audit log should be created for each tenant
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'filing_notification.create',
          details: expect.objectContaining({
            tenantId: TENANT_A,
            ticker: SHARED_TICKER,
            filingType: '10-K',
            accessionNumber: '0000320193-24-000123',
          }),
        }),
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'filing_notification.create',
          details: expect.objectContaining({
            tenantId: TENANT_B,
            ticker: SHARED_TICKER,
            filingType: '10-K',
            accessionNumber: '0000320193-24-000123',
          }),
        }),
      });
    });

    it('should audit log successful notification dismissal', async () => {
      const notificationId = 'notif-a1';

      mockPrisma.filingNotification.findFirst.mockResolvedValue({
        id: notificationId,
        tenantId: TENANT_A,
        ticker: SHARED_TICKER,
        filingType: '10-K',
        dismissed: false,
      });
      mockPrisma.filingNotification.update.mockResolvedValue({
        id: notificationId,
        dismissed: true,
        dismissedAt: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await notificationService.dismissNotification(notificationId, TENANT_A);

      // Verify successful dismissal audit log
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'filing_notification.dismiss',
          details: expect.objectContaining({
            tenantId: TENANT_A,
            notificationId,
            ticker: SHARED_TICKER,
            filingType: '10-K',
          }),
        }),
      });
    });

    it('should audit log denied dismissal attempt (cross-tenant violation)', async () => {
      const tenantBNotificationId = 'notif-b1';

      // Tenant A tries to dismiss tenant B's notification
      mockPrisma.filingNotification.findFirst.mockResolvedValue(null);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await expect(
        notificationService.dismissNotification(tenantBNotificationId, TENANT_A),
      ).rejects.toThrow(NotFoundException);

      // Verify denial audit log was created
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'filing_notification.dismiss_denied',
          details: expect.objectContaining({
            tenantId: TENANT_A,
            notificationId: tenantBNotificationId,
            reason: 'not_found_or_wrong_tenant',
          }),
        }),
      });
    });

    it('should include timestamp in all audit log entries', async () => {
      const beforeTest = new Date();

      mockPrisma.filingNotification.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await notificationService.getNotifications(TENANT_A);

      const auditCall = mockPrisma.auditLog.create.mock.calls[0][0];
      expect(auditCall.data.timestamp).toBeInstanceOf(Date);
      expect(auditCall.data.timestamp.getTime()).toBeGreaterThanOrEqual(
        beforeTest.getTime(),
      );
    });

    it('should not fail main operation if audit logging fails', async () => {
      mockPrisma.filingNotification.findMany.mockResolvedValue([
        { id: 'notif-a1', tenantId: TENANT_A },
      ]);
      // Simulate audit log failure
      mockPrisma.auditLog.create.mockRejectedValue(
        new Error('Database connection lost'),
      );

      // getNotifications should still succeed despite audit log failure
      const result = await notificationService.getNotifications(TENANT_A);
      expect(result).toHaveLength(1);
    });

    it('should audit log dismissed notification queries separately from active', async () => {
      mockPrisma.filingNotification.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});

      // Query active notifications
      await notificationService.getNotifications(TENANT_A, { dismissed: false });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          details: expect.objectContaining({
            dismissed: false,
          }),
        }),
      });

      jest.clearAllMocks();
      mockPrisma.filingNotification.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});

      // Query dismissed notifications
      await notificationService.getNotifications(TENANT_A, { dismissed: true });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          details: expect.objectContaining({
            dismissed: true,
          }),
        }),
      });
    });
  });
});
