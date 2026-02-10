import { Test, TestingModule } from '@nestjs/testing';
import {
  FilingDetectorService,
  SECFiling,
  DetectionResult,
} from '../../src/filings/filing-detector.service';
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
 * Integration Tests: Incremental Detection (Task 7.3)
 *
 * Validates Correctness Property 6 (Incremental Detection):
 *   For any ticker T, if the system has already detected filing F
 *   (exists in data_sources), running detection again SHALL NOT
 *   re-download or re-process F.
 *
 * Validates Correctness Property 7 (Processing Idempotency):
 *   For any filing F, processing F multiple times SHALL produce
 *   the same results.
 *
 * Tests:
 *   7.3.1 - Verify existing filings are skipped
 *   7.3.2 - Verify detection state is updated
 *   7.3.3 - Verify no re-processing
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

function createExistingDataSource(ticker: string, accessionNumber: string, filingType: string = '10-K') {
  return {
    id: `ds-${accessionNumber}`,
    type: 'sec_filing',
    sourceId: `${ticker}-${filingType}-${accessionNumber}`,
    visibility: 'public',
    ownerTenantId: null,
    s3Path: `public/sec-filings/${ticker}/${filingType}/${accessionNumber}`,
    metadata: {
      ticker,
      filingType,
      accessionNumber,
      filingDate: '2024-11-01',
      reportDate: '2024-09-30',
      processed: true,
      downloadedAt: '2024-11-02T06:15:00Z',
      processedAt: '2024-11-02T06:20:00Z',
    },
    createdAt: new Date(),
  };
}

// ============================================================
// Main test suite
// ============================================================
describe('Integration: Incremental Detection (Task 7.3)', () => {
  let detectorService: FilingDetectorService;
  let downloadService: FilingDownloadService;
  let notificationService: FilingNotificationService;
  let scheduler: FilingDetectionScheduler;
  let rateLimiter: RateLimiterService;

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

    detectorService = module.get<FilingDetectorService>(FilingDetectorService);
    downloadService = module.get<FilingDownloadService>(FilingDownloadService);
    notificationService = module.get<FilingNotificationService>(FilingNotificationService);
    scheduler = module.get<FilingDetectionScheduler>(FilingDetectionScheduler);
    rateLimiter = module.get<RateLimiterService>(RateLimiterService);

    // Reset rate limiter for clean state
    rateLimiter.resetMetrics();

    // Default CIK lookup
    mockSecService.getCikForTicker.mockResolvedValue({
      ticker: 'AAPL',
      cik: '0000320193',
      cik_numeric: 320193,
      name: 'Apple Inc.',
    });
  });

  // ============================================================
  // 7.3.1 Verify existing filings are skipped
  // ============================================================
  describe('7.3.1 Verify existing filings are skipped', () => {
    /**
     * Validates Correctness Property 6: Incremental Detection
     * If the system has already detected filing F (exists in data_sources),
     * running detection again SHALL NOT re-download or re-process F.
     */

    it('should return 0 new filings when all SEC filings already exist in data_sources', async () => {
      // Setup: detection state exists from a previous run
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-10-15'),
        lastFilingDate: new Date('2024-11-01'),
        checkCount: 3,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // SEC returns 2 filings
      const secFilings = [
        {
          form: '10-K',
          filingDate: '2024-11-01',
          reportDate: '2024-09-30',
          accessionNumber: '0000320193-24-000123',
          primaryDocument: 'aapl-20240930.htm',
          url: 'https://www.sec.gov/Archives/edgar/data/320193/filing1.htm',
        },
        {
          form: '10-Q',
          filingDate: '2024-08-01',
          reportDate: '2024-06-30',
          accessionNumber: '0000320193-24-000456',
          primaryDocument: 'aapl-20240630.htm',
          url: 'https://www.sec.gov/Archives/edgar/data/320193/filing2.htm',
        },
      ];

      mockSecService.getFillings.mockImplementation(async (_cik: string, opts: any) => {
        if (opts.formType === '10-K') {
          return createMockFilingsResponse([secFilings[0]], '10-K');
        }
        if (opts.formType === '10-Q') {
          return createMockFilingsResponse([secFilings[1]], '10-Q');
        }
        return createMockFilingsResponse([], opts.formType);
      });

      // Both filings already exist in data_sources
      mockPrisma.dataSource.findMany.mockResolvedValue([
        createExistingDataSource('AAPL', '0000320193-24-000123', '10-K'),
        createExistingDataSource('AAPL', '0000320193-24-000456', '10-Q'),
      ]);

      mockPrisma.filingDetectionState.upsert.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        checkCount: 4,
        consecutiveFailures: 0,
      });

      const result = await detectorService.detectNewFilings('AAPL');

      expect(result.ticker).toBe('AAPL');
      expect(result.newFilings).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should skip existing filings and only return truly new ones', async () => {
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-10-01'),
        lastFilingDate: new Date('2024-08-01'),
        checkCount: 5,
        consecutiveFailures: 0,
      });

      // SEC returns 3 filings
      const secFilings = [
        {
          form: '10-K',
          filingDate: '2024-11-01',
          reportDate: '2024-09-30',
          accessionNumber: '0000320193-24-000789',
          primaryDocument: 'aapl-20240930.htm',
          url: 'https://www.sec.gov/Archives/edgar/data/320193/new-filing.htm',
        },
        {
          form: '10-K',
          filingDate: '2023-11-01',
          reportDate: '2023-09-30',
          accessionNumber: '0000320193-23-000123',
          primaryDocument: 'aapl-20230930.htm',
          url: 'https://www.sec.gov/Archives/edgar/data/320193/old-filing1.htm',
        },
        {
          form: '10-K',
          filingDate: '2022-11-01',
          reportDate: '2022-09-30',
          accessionNumber: '0000320193-22-000456',
          primaryDocument: 'aapl-20220930.htm',
          url: 'https://www.sec.gov/Archives/edgar/data/320193/old-filing2.htm',
        },
      ];

      mockSecService.getFillings.mockImplementation(async (_cik: string, opts: any) => {
        if (opts.formType === '10-K') {
          return createMockFilingsResponse(secFilings, '10-K');
        }
        return createMockFilingsResponse([], opts.formType);
      });

      // 2 of the 3 filings already exist
      mockPrisma.dataSource.findMany.mockResolvedValue([
        createExistingDataSource('AAPL', '0000320193-23-000123', '10-K'),
        createExistingDataSource('AAPL', '0000320193-22-000456', '10-K'),
      ]);

      mockPrisma.filingDetectionState.upsert.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        checkCount: 6,
        consecutiveFailures: 0,
      });

      const result = await detectorService.detectNewFilings('AAPL', ['10-K']);

      // Only the new filing should be detected
      expect(result.newFilings).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should correctly filter by accession number across multiple filing types', async () => {
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue(null);

      // SEC returns filings of different types
      mockSecService.getFillings.mockImplementation(async (_cik: string, opts: any) => {
        if (opts.formType === '10-K') {
          return createMockFilingsResponse([{
            form: '10-K',
            filingDate: '2024-11-01',
            reportDate: '2024-09-30',
            accessionNumber: '0000320193-24-000111',
            primaryDocument: 'aapl-10k.htm',
            url: 'https://www.sec.gov/Archives/edgar/data/320193/10k.htm',
          }], '10-K');
        }
        if (opts.formType === '10-Q') {
          return createMockFilingsResponse([{
            form: '10-Q',
            filingDate: '2024-08-01',
            reportDate: '2024-06-30',
            accessionNumber: '0000320193-24-000222',
            primaryDocument: 'aapl-10q.htm',
            url: 'https://www.sec.gov/Archives/edgar/data/320193/10q.htm',
          }], '10-Q');
        }
        if (opts.formType === '8-K') {
          return createMockFilingsResponse([{
            form: '8-K',
            filingDate: '2024-10-15',
            reportDate: '2024-10-15',
            accessionNumber: '0000320193-24-000333',
            primaryDocument: 'aapl-8k.htm',
            url: 'https://www.sec.gov/Archives/edgar/data/320193/8k.htm',
          }], '8-K');
        }
        return createMockFilingsResponse([], opts.formType);
      });

      // 10-K and 8-K already exist, only 10-Q is new
      mockPrisma.dataSource.findMany.mockResolvedValue([
        createExistingDataSource('AAPL', '0000320193-24-000111', '10-K'),
        createExistingDataSource('AAPL', '0000320193-24-000333', '8-K'),
      ]);

      mockPrisma.filingDetectionState.upsert.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        checkCount: 1,
        consecutiveFailures: 0,
      });

      const result = await detectorService.detectNewFilings('AAPL');

      // Only the 10-Q should be new (10-K and 8-K already exist)
      expect(result.newFilings).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle empty SEC response gracefully', async () => {
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-11-01'),
        checkCount: 10,
        consecutiveFailures: 0,
      });

      // SEC returns no filings for any type
      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse([], '10-K'),
      );

      mockPrisma.dataSource.findMany.mockResolvedValue([]);

      mockPrisma.filingDetectionState.upsert.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        checkCount: 11,
        consecutiveFailures: 0,
      });

      const result = await detectorService.detectNewFilings('AAPL');

      expect(result.newFilings).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ============================================================
  // 7.3.2 Verify detection state is updated
  // ============================================================
  describe('7.3.2 Verify detection state is updated', () => {
    /**
     * Validates that detection state (last_check_date, check_count,
     * consecutive_failures) is properly updated after each detection run.
     * This state drives incremental detection by tracking what has been checked.
     */

    it('should create detection state on first run for a new ticker', async () => {
      // No previous detection state
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue(null);

      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse([{
          form: '10-K',
          filingDate: '2024-11-01',
          reportDate: '2024-09-30',
          accessionNumber: '0000320193-24-000123',
          primaryDocument: 'aapl-20240930.htm',
          url: 'https://www.sec.gov/Archives/edgar/data/320193/filing.htm',
        }], '10-K'),
      );

      mockPrisma.dataSource.findMany.mockResolvedValue([]);
      mockPrisma.filingDetectionState.upsert.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        lastFilingDate: new Date('2024-11-01'),
        checkCount: 1,
        consecutiveFailures: 0,
      });

      await detectorService.detectNewFilings('AAPL', ['10-K']);

      // Verify upsert was called to create/update detection state
      expect(mockPrisma.filingDetectionState.upsert).toHaveBeenCalledWith({
        where: { ticker: 'AAPL' },
        create: expect.objectContaining({
          ticker: 'AAPL',
          lastCheckDate: expect.any(Date),
          checkCount: 1,
          consecutiveFailures: 0,
        }),
        update: expect.objectContaining({
          lastCheckDate: expect.any(Date),
          checkCount: 1,
          consecutiveFailures: 0,
        }),
      });
    });

    it('should increment check_count on each detection run', async () => {
      // Previous state with checkCount = 5
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-10-15'),
        lastFilingDate: new Date('2024-08-01'),
        checkCount: 5,
        consecutiveFailures: 0,
      });

      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse([], '10-K'),
      );
      mockPrisma.dataSource.findMany.mockResolvedValue([]);
      mockPrisma.filingDetectionState.upsert.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        checkCount: 6,
        consecutiveFailures: 0,
      });

      await detectorService.detectNewFilings('AAPL', ['10-K']);

      // checkCount should be incremented from 5 to 6
      expect(mockPrisma.filingDetectionState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            checkCount: 6,
          }),
        }),
      );
    });

    it('should update lastCheckDate to current time on each run', async () => {
      const beforeRun = new Date();

      mockPrisma.filingDetectionState.findUnique.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-10-01'),
        checkCount: 3,
        consecutiveFailures: 0,
      });

      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse([], '10-K'),
      );
      mockPrisma.dataSource.findMany.mockResolvedValue([]);
      mockPrisma.filingDetectionState.upsert.mockResolvedValue({});

      await detectorService.detectNewFilings('AAPL', ['10-K']);

      const upsertCall = mockPrisma.filingDetectionState.upsert.mock.calls[0][0];
      const updatedCheckDate = upsertCall.update.lastCheckDate;

      expect(updatedCheckDate).toBeInstanceOf(Date);
      expect(updatedCheckDate.getTime()).toBeGreaterThanOrEqual(beforeRun.getTime());
    });

    it('should reset consecutiveFailures to 0 on successful detection', async () => {
      // Previous state had 2 consecutive failures
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-10-15'),
        checkCount: 8,
        consecutiveFailures: 2,
      });

      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse([], '10-K'),
      );
      mockPrisma.dataSource.findMany.mockResolvedValue([]);
      mockPrisma.filingDetectionState.upsert.mockResolvedValue({});

      await detectorService.detectNewFilings('AAPL', ['10-K']);

      // consecutiveFailures should be reset to 0
      expect(mockPrisma.filingDetectionState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            consecutiveFailures: 0,
          }),
        }),
      );
    });

    it('should increment consecutiveFailures on detection failure', async () => {
      // Previous state with 1 consecutive failure
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-10-15'),
        checkCount: 7,
        consecutiveFailures: 1,
      });

      // CIK lookup fails (non-retryable)
      mockSecService.getCikForTicker.mockRejectedValue(
        new Error('CIK not found for ticker AAPL'),
      );

      mockPrisma.filingDetectionState.upsert.mockResolvedValue({});

      const result = await detectorService.detectNewFilings('AAPL', ['10-K'], 0);

      expect(result.errors.length).toBeGreaterThan(0);

      // consecutiveFailures should be incremented from 1 to 2
      expect(mockPrisma.filingDetectionState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            consecutiveFailures: 2,
          }),
        }),
      );
    });

    it('should update lastFilingDate when new filings are found', async () => {
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-10-01'),
        lastFilingDate: new Date('2024-08-01'),
        checkCount: 4,
        consecutiveFailures: 0,
      });

      const newFilingDate = '2024-11-15';

      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse([{
          form: '10-K',
          filingDate: newFilingDate,
          reportDate: '2024-09-30',
          accessionNumber: '0000320193-24-000999',
          primaryDocument: 'aapl-20240930.htm',
          url: 'https://www.sec.gov/Archives/edgar/data/320193/filing.htm',
        }], '10-K'),
      );

      mockPrisma.dataSource.findMany.mockResolvedValue([]);
      mockPrisma.filingDetectionState.upsert.mockResolvedValue({});

      await detectorService.detectNewFilings('AAPL', ['10-K']);

      // lastFilingDate should be updated to the new filing's date
      const upsertCall = mockPrisma.filingDetectionState.upsert.mock.calls[0][0];
      const updatedFilingDate = upsertCall.update.lastFilingDate;
      expect(updatedFilingDate).toEqual(new Date(newFilingDate));
    });

    it('should preserve detection state across multiple sequential runs', async () => {
      // Run 1: First detection
      mockPrisma.filingDetectionState.findUnique.mockResolvedValueOnce(null);
      mockSecService.getFillings.mockResolvedValueOnce(
        createMockFilingsResponse([{
          form: '10-K',
          filingDate: '2024-11-01',
          reportDate: '2024-09-30',
          accessionNumber: '0000320193-24-000123',
          primaryDocument: 'aapl.htm',
          url: 'https://www.sec.gov/filing1.htm',
        }], '10-K'),
      );
      mockPrisma.dataSource.findMany.mockResolvedValueOnce([]);
      mockPrisma.filingDetectionState.upsert.mockResolvedValueOnce({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        checkCount: 1,
        consecutiveFailures: 0,
      });

      const result1 = await detectorService.detectNewFilings('AAPL', ['10-K']);
      expect(result1.newFilings).toBe(1);

      // Verify first run created state with checkCount = 1
      expect(mockPrisma.filingDetectionState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ checkCount: 1 }),
          update: expect.objectContaining({ checkCount: 1 }),
        }),
      );

      // Run 2: Second detection - filing now exists
      mockPrisma.filingDetectionState.findUnique.mockResolvedValueOnce({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        checkCount: 1,
        consecutiveFailures: 0,
      });
      mockSecService.getFillings.mockResolvedValueOnce(
        createMockFilingsResponse([{
          form: '10-K',
          filingDate: '2024-11-01',
          reportDate: '2024-09-30',
          accessionNumber: '0000320193-24-000123',
          primaryDocument: 'aapl.htm',
          url: 'https://www.sec.gov/filing1.htm',
        }], '10-K'),
      );
      mockPrisma.dataSource.findMany.mockResolvedValueOnce([
        createExistingDataSource('AAPL', '0000320193-24-000123', '10-K'),
      ]);
      mockPrisma.filingDetectionState.upsert.mockResolvedValueOnce({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        checkCount: 2,
        consecutiveFailures: 0,
      });

      const result2 = await detectorService.detectNewFilings('AAPL', ['10-K']);
      expect(result2.newFilings).toBe(0);

      // Verify second run incremented checkCount to 2
      const secondUpsertCall = mockPrisma.filingDetectionState.upsert.mock.calls[1][0];
      expect(secondUpsertCall.update.checkCount).toBe(2);
    });
  });

  // ============================================================
  // 7.3.3 Verify no re-processing
  // ============================================================
  describe('7.3.3 Verify no re-processing', () => {
    /**
     * Validates Correctness Property 6 & 7:
     * - Property 6: Already-detected filings SHALL NOT be re-downloaded or re-processed
     * - Property 7: Processing idempotency - processing F multiple times produces same results
     *
     * Tests the full pipeline to ensure that when detection finds 0 new filings,
     * no download or processing is triggered.
     */

    it('should not trigger download when detection finds 0 new filings', async () => {
      // Setup: detection state exists, all filings already in data_sources
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-11-01'),
        lastFilingDate: new Date('2024-11-01'),
        checkCount: 10,
        consecutiveFailures: 0,
      });

      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse([{
          form: '10-K',
          filingDate: '2024-11-01',
          reportDate: '2024-09-30',
          accessionNumber: '0000320193-24-000123',
          primaryDocument: 'aapl-20240930.htm',
          url: 'https://www.sec.gov/Archives/edgar/data/320193/filing.htm',
        }], '10-K'),
      );

      // Filing already exists
      mockPrisma.dataSource.findMany.mockResolvedValue([
        createExistingDataSource('AAPL', '0000320193-24-000123', '10-K'),
      ]);

      mockPrisma.filingDetectionState.upsert.mockResolvedValue({});

      // Run detection
      const result = await detectorService.detectNewFilings('AAPL', ['10-K']);
      expect(result.newFilings).toBe(0);

      // Verify NO download or processing was triggered
      expect(mockSecSyncService.syncTicker).not.toHaveBeenCalled();
      expect(mockSecSyncService.syncFilingType).not.toHaveBeenCalled();
      expect(mockSecProcessingService.processFiling).not.toHaveBeenCalled();
      expect(mockPrisma.filingNotification.create).not.toHaveBeenCalled();
    });

    it('should not create duplicate notifications for already-processed filings', async () => {
      // Setup: Run the scheduler with a ticker where all filings exist
      mockPrisma.deal.findMany.mockImplementation(async (args: any) => {
        if (args?.distinct) {
          return [{ ticker: 'AAPL' }];
        }
        return [{ tenantId: 'tenant-1' }];
      });

      // Detection finds 0 new filings
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-11-01'),
        checkCount: 5,
        consecutiveFailures: 0,
      });

      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse([{
          form: '10-K',
          filingDate: '2024-11-01',
          reportDate: '2024-09-30',
          accessionNumber: '0000320193-24-000123',
          primaryDocument: 'aapl.htm',
          url: 'https://www.sec.gov/filing.htm',
        }], '10-K'),
      );

      mockPrisma.dataSource.findMany.mockResolvedValue([
        createExistingDataSource('AAPL', '0000320193-24-000123', '10-K'),
      ]);

      mockPrisma.filingDetectionState.upsert.mockResolvedValue({});

      // Run the scheduler
      const summary = await scheduler.runDailyDetection();

      expect(summary.totalNewFilings).toBe(0);

      // No notifications should be created
      expect(mockPrisma.filingNotification.create).not.toHaveBeenCalled();

      // No downloads or processing should occur
      expect(mockSecSyncService.syncTicker).not.toHaveBeenCalled();
      expect(mockSecSyncService.syncFilingType).not.toHaveBeenCalled();
      expect(mockSecProcessingService.processFiling).not.toHaveBeenCalled();
    });

    it('should only download and process the new filing when mix of old and new exist', async () => {
      // First: detect filings (1 new, 1 existing)
      mockPrisma.filingDetectionState.findUnique.mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-10-01'),
        checkCount: 3,
        consecutiveFailures: 0,
      });

      const existingAccession = '0000320193-24-000123';
      const newAccession = '0000320193-24-000789';

      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse([
          {
            form: '10-K',
            filingDate: '2024-11-01',
            reportDate: '2024-09-30',
            accessionNumber: existingAccession,
            primaryDocument: 'aapl-old.htm',
            url: 'https://www.sec.gov/old.htm',
          },
          {
            form: '10-K',
            filingDate: '2024-11-15',
            reportDate: '2024-09-30',
            accessionNumber: newAccession,
            primaryDocument: 'aapl-new.htm',
            url: 'https://www.sec.gov/new.htm',
          },
        ], '10-K'),
      );

      // Only the first filing exists
      mockPrisma.dataSource.findMany.mockResolvedValue([
        createExistingDataSource('AAPL', existingAccession, '10-K'),
      ]);

      mockPrisma.filingDetectionState.upsert.mockResolvedValue({});

      const result = await detectorService.detectNewFilings('AAPL', ['10-K']);

      // Only 1 new filing detected
      expect(result.newFilings).toBe(1);

      // Now simulate the download service processing only the new filing
      mockSecSyncService.syncTicker.mockResolvedValue([
        { ticker: 'AAPL', filingType: '10-K', newFilings: 1, skipped: 0, errors: 0 },
      ]);

      mockSecProcessingService.processFiling.mockResolvedValue({
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: newAccession,
        metricsExtracted: 30,
        narrativesExtracted: 8,
        processingTime: 1200,
        status: 'success',
        errors: [],
      });

      mockPrisma.deal.findMany.mockResolvedValue([{ tenantId: 'tenant-1' }]);
      mockPrisma.filingNotification.create.mockResolvedValue({
        id: 'notif-1',
        tenantId: 'tenant-1',
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: newAccession,
      });

      const downloadResult = await downloadService.queueDownload(
        'AAPL',
        createMockSECFiling({ accessionNumber: newAccession }),
      );

      expect(downloadResult.downloadSuccess).toBe(true);
      expect(downloadResult.processingResult?.accessionNumber).toBe(newAccession);
      expect(downloadResult.notificationsSent).toBe(1);

      // Processing was called exactly once (for the new filing only)
      expect(mockSecProcessingService.processFiling).toHaveBeenCalledTimes(1);
      expect(mockSecProcessingService.processFiling).toHaveBeenCalledWith(
        'AAPL',
        '10-K',
        newAccession,
      );
    });

    it('should produce consistent results when running detection multiple times', async () => {
      const accession = '0000320193-24-000123';

      // Run 1: Filing is new
      mockPrisma.filingDetectionState.findUnique.mockResolvedValueOnce(null);
      mockSecService.getFillings.mockResolvedValue(
        createMockFilingsResponse([{
          form: '10-K',
          filingDate: '2024-11-01',
          reportDate: '2024-09-30',
          accessionNumber: accession,
          primaryDocument: 'aapl.htm',
          url: 'https://www.sec.gov/filing.htm',
        }], '10-K'),
      );
      mockPrisma.dataSource.findMany.mockResolvedValueOnce([]);
      mockPrisma.filingDetectionState.upsert.mockResolvedValue({});

      const run1 = await detectorService.detectNewFilings('AAPL', ['10-K']);
      expect(run1.newFilings).toBe(1);

      // Run 2: Same filing now exists in data_sources
      mockPrisma.filingDetectionState.findUnique.mockResolvedValueOnce({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        checkCount: 1,
        consecutiveFailures: 0,
      });
      mockPrisma.dataSource.findMany.mockResolvedValueOnce([
        createExistingDataSource('AAPL', accession, '10-K'),
      ]);

      const run2 = await detectorService.detectNewFilings('AAPL', ['10-K']);
      expect(run2.newFilings).toBe(0);

      // Run 3: Same state, still 0 new filings
      mockPrisma.filingDetectionState.findUnique.mockResolvedValueOnce({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        checkCount: 2,
        consecutiveFailures: 0,
      });
      mockPrisma.dataSource.findMany.mockResolvedValueOnce([
        createExistingDataSource('AAPL', accession, '10-K'),
      ]);

      const run3 = await detectorService.detectNewFilings('AAPL', ['10-K']);
      expect(run3.newFilings).toBe(0);

      // Runs 2 and 3 should produce the same result (idempotent)
      expect(run2.newFilings).toBe(run3.newFilings);
      expect(run2.errors).toEqual(run3.errors);
    });

    it('should not re-process filings for different tickers independently', async () => {
      // AAPL: all filings exist (should skip)
      // MSFT: has a new filing (should process)

      // AAPL detection
      mockPrisma.filingDetectionState.findUnique.mockResolvedValueOnce({
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-11-01'),
        checkCount: 5,
        consecutiveFailures: 0,
      });

      mockSecService.getCikForTicker.mockImplementation(async (ticker: string) => {
        const cikMap: Record<string, string> = { AAPL: '0000320193', MSFT: '0000789019' };
        return {
          ticker,
          cik: cikMap[ticker],
          cik_numeric: parseInt(cikMap[ticker]),
          name: `${ticker} Inc.`,
        };
      });

      mockSecService.getFillings.mockImplementation(async (cik: string, opts: any) => {
        if (cik === '0000320193' && opts.formType === '10-K') {
          return createMockFilingsResponse([{
            form: '10-K',
            filingDate: '2024-11-01',
            reportDate: '2024-09-30',
            accessionNumber: '0000320193-24-000123',
            primaryDocument: 'aapl.htm',
            url: 'https://www.sec.gov/aapl.htm',
          }], '10-K');
        }
        if (cik === '0000789019' && opts.formType === '10-K') {
          return createMockFilingsResponse([{
            form: '10-K',
            filingDate: '2024-11-10',
            reportDate: '2024-09-30',
            accessionNumber: '0000789019-24-000456',
            primaryDocument: 'msft.htm',
            url: 'https://www.sec.gov/msft.htm',
          }], '10-K');
        }
        return createMockFilingsResponse([], opts.formType);
      });

      // AAPL filing exists, MSFT filing does not
      mockPrisma.dataSource.findMany.mockResolvedValue([
        createExistingDataSource('AAPL', '0000320193-24-000123', '10-K'),
      ]);

      mockPrisma.filingDetectionState.upsert.mockResolvedValue({});

      // Detect AAPL - should find 0 new
      const aaplResult = await detectorService.detectNewFilings('AAPL', ['10-K']);
      expect(aaplResult.newFilings).toBe(0);

      // Detect MSFT - should find 1 new
      mockPrisma.filingDetectionState.findUnique.mockResolvedValueOnce(null);
      const msftResult = await detectorService.detectNewFilings('MSFT', ['10-K']);
      expect(msftResult.newFilings).toBe(1);

      // Only MSFT should trigger download/processing (not AAPL)
      // The detector service itself doesn't call download, but the scheduler would
      // Verify that AAPL detection didn't trigger any side effects
      expect(aaplResult.errors).toHaveLength(0);
      expect(msftResult.errors).toHaveLength(0);
    });
  });

  // ============================================================
  // End of main describe block
  // ============================================================
});
