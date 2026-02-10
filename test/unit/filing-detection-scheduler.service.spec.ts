import { Test, TestingModule } from '@nestjs/testing';
import { FilingDetectionScheduler } from '../../src/filings/filing-detection-scheduler.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SECSyncService } from '../../src/s3/sec-sync.service';
import { SECProcessingService } from '../../src/s3/sec-processing.service';
import { FilingNotificationService } from '../../src/filings/filing-notification.service';
import { FilingDetectorService } from '../../src/filings/filing-detector.service';
import { DistributedLockService } from '../../src/common/distributed-lock.service';

describe('FilingDetectionScheduler', () => {
  let service: FilingDetectionScheduler;
  let prisma: PrismaService;
  let secSyncService: SECSyncService;
  let secProcessingService: SECProcessingService;
  let notificationService: FilingNotificationService;
  let detectorService: FilingDetectorService;

  const mockPrismaService = {
    deal: {
      findMany: jest.fn(),
    },
    dataSource: {
      findMany: jest.fn(),
    },
    filingDetectionState: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const mockSECSyncService = {
    syncTicker: jest.fn(),
    syncFilingType: jest.fn(),
  };

  const mockSECProcessingService = {
    processFiling: jest.fn(),
  };

  const mockNotificationService = {
    createNotifications: jest.fn(),
  };

  const mockDetectorService = {
    detectNewFilings: jest.fn(),
    getNewFilingsForDownload: jest.fn(),
    logRateLimitMetrics: jest.fn(),
  };

  // Lock always acquired in tests — withLock executes the callback
  const mockLockService = {
    withLock: jest.fn().mockImplementation((_key: string, cb: () => Promise<any>) => cb()),
    tryAcquire: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilingDetectionScheduler,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: SECSyncService,
          useValue: mockSECSyncService,
        },
        {
          provide: SECProcessingService,
          useValue: mockSECProcessingService,
        },
        {
          provide: FilingNotificationService,
          useValue: mockNotificationService,
        },
        {
          provide: FilingDetectorService,
          useValue: mockDetectorService,
        },
        {
          provide: DistributedLockService,
          useValue: mockLockService,
        },
      ],
    }).compile();

    service = module.get<FilingDetectionScheduler>(FilingDetectionScheduler);
    prisma = module.get<PrismaService>(PrismaService);
    secSyncService = module.get<SECSyncService>(SECSyncService);
    secProcessingService = module.get<SECProcessingService>(SECProcessingService);
    notificationService = module.get<FilingNotificationService>(FilingNotificationService);
    detectorService = module.get<FilingDetectorService>(FilingDetectorService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('runDailyDetection', () => {
    it('should detect and process new filings for all tracked tickers', async () => {
      const mockDeals = [
        { ticker: 'AAPL' },
        { ticker: 'MSFT' },
        { ticker: 'AMZN' },
      ];

      mockPrismaService.deal.findMany.mockResolvedValue(mockDeals);

      // Mock detector service - returns detection results
      mockDetectorService.detectNewFilings.mockResolvedValue({
        ticker: 'AAPL',
        newFilings: 1,
        errors: [],
      });
      mockDetectorService.getNewFilingsForDownload.mockResolvedValue([
        {
          accessionNumber: '0000320193-24-000123',
          filingDate: new Date('2024-11-01'),
          reportDate: new Date('2024-09-30'),
          form: '10-K',
          url: null,
          primaryDocument: 'filing.html',
        },
      ]);

      // Mock sync and processing
      mockSECSyncService.syncFilingType.mockResolvedValue(undefined);
      mockSECProcessingService.processFiling.mockResolvedValue({
        status: 'success',
        errors: [],
      });
      mockNotificationService.createNotifications.mockResolvedValue(2);

      const summary = await service.runDailyDetection();

      expect(summary).not.toBeNull();
      expect(summary!.totalTickers).toBe(3);
      expect(mockPrismaService.deal.findMany).toHaveBeenCalled();
      expect(mockDetectorService.detectNewFilings).toHaveBeenCalledTimes(3);
    });

    it('should handle errors for individual tickers without stopping', async () => {
      const mockDeals = [
        { ticker: 'AAPL' },
        { ticker: 'INVALID' },
        { ticker: 'MSFT' },
      ];

      mockPrismaService.deal.findMany.mockResolvedValue(mockDeals);

      // First ticker succeeds with no new filings
      mockDetectorService.detectNewFilings
        .mockResolvedValueOnce({ ticker: 'AAPL', newFilings: 0, errors: [] })
        // Second ticker fails
        .mockRejectedValueOnce(new Error('Ticker not found'))
        // Third ticker succeeds
        .mockResolvedValueOnce({ ticker: 'MSFT', newFilings: 0, errors: [] });

      const summary = await service.runDailyDetection();

      expect(summary).not.toBeNull();
      expect(summary!.totalTickers).toBe(3);
      expect(summary!.errorCount).toBe(1);
      expect(mockDetectorService.detectNewFilings).toHaveBeenCalledTimes(3);
    });

    it('should return null when distributed lock is not acquired', async () => {
      // Simulate another container holding the lock
      mockLockService.withLock.mockResolvedValueOnce(null);

      const result = await service.runDailyDetection();

      expect(result).toBeNull();
      // Core detection logic should NOT have run
      expect(mockPrismaService.deal.findMany).not.toHaveBeenCalled();
      expect(mockDetectorService.detectNewFilings).not.toHaveBeenCalled();
    });

    it('should log rate limit metrics after detection', async () => {
      mockPrismaService.deal.findMany.mockResolvedValue([{ ticker: 'AAPL' }]);
      mockDetectorService.detectNewFilings.mockResolvedValue({
        ticker: 'AAPL',
        newFilings: 0,
        errors: [],
      });

      await service.runDailyDetection();

      expect(mockDetectorService.logRateLimitMetrics).toHaveBeenCalled();
    });
  });

  describe('triggerDetectionForTicker', () => {
    it('should manually trigger detection for a specific ticker', async () => {
      const ticker = 'AAPL';

      mockDetectorService.detectNewFilings.mockResolvedValue({
        ticker,
        newFilings: 1,
        errors: [],
      });
      mockDetectorService.getNewFilingsForDownload.mockResolvedValue([
        {
          accessionNumber: '0000320193-24-000123',
          filingDate: new Date('2024-11-01'),
          reportDate: new Date('2024-09-30'),
          form: '10-K',
          url: null,
          primaryDocument: 'filing.html',
        },
      ]);

      mockSECSyncService.syncFilingType.mockResolvedValue(undefined);
      mockSECProcessingService.processFiling.mockResolvedValue({
        status: 'success',
        errors: [],
      });
      mockNotificationService.createNotifications.mockResolvedValue(2);

      const result = await service.triggerDetectionForTicker(ticker);

      expect(result.ticker).toBe(ticker);
      expect(result.newFilings).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockDetectorService.detectNewFilings).toHaveBeenCalledWith(ticker);
    });

    it('should handle processing failures gracefully', async () => {
      const ticker = 'AAPL';

      mockDetectorService.detectNewFilings.mockResolvedValue({
        ticker,
        newFilings: 1,
        errors: [],
      });
      mockDetectorService.getNewFilingsForDownload.mockResolvedValue([
        {
          accessionNumber: '0000320193-24-000123',
          filingDate: new Date('2024-11-01'),
          reportDate: new Date('2024-09-30'),
          form: '10-K',
          url: null,
          primaryDocument: 'filing.html',
        },
      ]);

      mockSECSyncService.syncFilingType.mockResolvedValue(undefined);
      mockSECProcessingService.processFiling.mockResolvedValue({
        status: 'failed',
        errors: ['Python parser failed'],
      });

      const result = await service.triggerDetectionForTicker(ticker);

      expect(result.ticker).toBe(ticker);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(mockNotificationService.createNotifications).not.toHaveBeenCalled();
    });
  });

  describe('detection state management', () => {
    it('should get detection status for all tickers', async () => {
      const mockStates = [
        {
          ticker: 'AAPL',
          lastCheckDate: new Date('2024-11-01'),
          lastFilingDate: new Date('2024-10-30'),
          checkCount: 10,
          consecutiveFailures: 0,
        },
      ];

      mockPrismaService.filingDetectionState.findMany.mockResolvedValue(mockStates);

      const states = await service.getDetectionStatus();

      expect(states).toEqual(mockStates);
      expect(mockPrismaService.filingDetectionState.findMany).toHaveBeenCalledWith({
        orderBy: { lastCheckDate: 'desc' },
      });
    });

    it('should get detection summary', async () => {
      mockPrismaService.deal.findMany.mockResolvedValue([
        { ticker: 'AAPL' },
        { ticker: 'MSFT' },
        { ticker: 'AMZN' },
      ]);

      mockPrismaService.filingDetectionState.findMany.mockResolvedValue([
        {
          ticker: 'AAPL',
          lastCheckDate: new Date('2024-11-01'),
          consecutiveFailures: 0,
        },
        {
          ticker: 'MSFT',
          lastCheckDate: new Date('2024-10-31'),
          consecutiveFailures: 2,
        },
      ]);

      const summary = await service.getDetectionSummary();

      expect(summary.trackedTickers).toBe(3);
      expect(summary.tickersWithState).toBe(2);
      expect(summary.tickersNeverChecked).toBe(1); // AMZN
      expect(summary.tickersWithFailures).toBe(1); // MSFT
      expect(summary.lastCheckDate).toEqual(new Date('2024-11-01'));
    });
  });
});
