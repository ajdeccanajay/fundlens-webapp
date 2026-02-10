import { Test, TestingModule } from '@nestjs/testing';
import { FilingDetectorService } from '../../src/filings/filing-detector.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SecService } from '../../src/dataSources/sec/sec.service';
import { RateLimiterService } from '../../src/filings/rate-limiter.service';

describe('FilingDetectorService', () => {
  let service: FilingDetectorService;
  let prisma: PrismaService;
  let secService: SecService;
  let rateLimiter: RateLimiterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilingDetectorService,
        {
          provide: PrismaService,
          useValue: {
            filingDetectionState: {
              findUnique: jest.fn(),
              upsert: jest.fn(),
            },
            dataSource: {
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: SecService,
          useValue: {
            getCikForTicker: jest.fn(),
            getFillings: jest.fn(),
          },
        },
        {
          provide: RateLimiterService,
          useValue: {
            waitForRateLimit: jest.fn().mockResolvedValue(undefined),
            getMetrics: jest.fn().mockReturnValue({
              totalRequests: 0,
              totalDelays: 0,
              totalDelayTime: 0,
              averageDelayTime: 0,
              requestsLastSecond: 0,
              requestsLastMinute: 0,
              currentTokens: 9,
              maxRequestsPerSecond: 9,
              minDelayMs: 111,
              isCompliant: true,
            }),
            logMetrics: jest.fn(),
            resetMetrics: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FilingDetectorService>(FilingDetectorService);
    prisma = module.get<PrismaService>(PrismaService);
    secService = module.get<SecService>(SecService);
    rateLimiter = module.get<RateLimiterService>(RateLimiterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('detectNewFilings', () => {
    it('should detect new filings for a ticker', async () => {
      // Mock detection state (no previous check)
      jest.spyOn(prisma.filingDetectionState, 'findUnique').mockResolvedValue(null);

      // Mock CIK lookup
      jest.spyOn(secService, 'getCikForTicker').mockResolvedValue({
        ticker: 'AAPL',
        cik: '0000320193',
        cik_numeric: 320193,
        name: 'Apple Inc.',
      });

      // Mock SEC filings response
      jest.spyOn(secService, 'getFillings').mockResolvedValue({
        metadata: {
          cik: '0000320193',
          ticker: 'AAPL',
          companyName: 'Apple Inc.',
          dateRange: { startDate: undefined, endDate: undefined },
          formType: '10-K',
          includeOlderPages: false,
        },
        summary: {
          totalFilings: 1,
          filingsInDateRange: 1,
          finalResults: 1,
          tenKCount: 1,
          tenQCount: 0,
          eightKCount: 0,
        },
        filings: {
          tenK: [
            {
              form: '10-K',
              filingDate: '2024-11-01',
              reportDate: '2024-09-30',
              accessionNumber: '0000320193-24-000123',
              primaryDocument: 'aapl-20240930.htm',
              items: undefined,
              url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240930.htm',
            },
          ],
          tenQ: [],
          eightK: [],
        },
        allFilings: [
          {
            form: '10-K',
            filingDate: '2024-11-01',
            reportDate: '2024-09-30',
            accessionNumber: '0000320193-24-000123',
            primaryDocument: 'aapl-20240930.htm',
            items: undefined,
            url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240930.htm',
          },
        ],
      });

      // Mock no existing data sources
      jest.spyOn(prisma.dataSource, 'findMany').mockResolvedValue([]);

      // Mock upsert
      jest.spyOn(prisma.filingDetectionState, 'upsert').mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        lastFilingDate: new Date('2024-11-01'),
        checkCount: 1,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.detectNewFilings('AAPL', ['10-K']);

      expect(result.ticker).toBe('AAPL');
      expect(result.newFilings).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.rateLimitMetrics).toBeDefined();
      expect(result.rateLimitMetrics?.isCompliant).toBe(true);
      expect(secService.getCikForTicker).toHaveBeenCalledWith('AAPL');
      expect(secService.getFillings).toHaveBeenCalledWith('0000320193', {
        formType: '10-K',
        startDate: undefined,
        includeOlderPages: false,
      });
      expect(rateLimiter.waitForRateLimit).toHaveBeenCalled();
    });

    it('should filter out existing filings', async () => {
      // Mock detection state
      jest.spyOn(prisma.filingDetectionState, 'findUnique').mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-10-01'),
        lastFilingDate: new Date('2024-09-30'),
        checkCount: 5,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Mock CIK lookup
      jest.spyOn(secService, 'getCikForTicker').mockResolvedValue({
        ticker: 'AAPL',
        cik: '0000320193',
        cik_numeric: 320193,
        name: 'Apple Inc.',
      });

      // Mock SEC filings response with 2 filings
      jest.spyOn(secService, 'getFillings').mockResolvedValue({
        metadata: {
          cik: '0000320193',
          ticker: 'AAPL',
          companyName: 'Apple Inc.',
          dateRange: { startDate: '2024-10-01', endDate: undefined },
          formType: '10-K',
          includeOlderPages: false,
        },
        summary: {
          totalFilings: 2,
          filingsInDateRange: 2,
          finalResults: 2,
          tenKCount: 2,
          tenQCount: 0,
          eightKCount: 0,
        },
        filings: {
          tenK: [],
          tenQ: [],
          eightK: [],
        },
        allFilings: [
          {
            form: '10-K',
            filingDate: '2024-11-01',
            reportDate: '2024-09-30',
            accessionNumber: '0000320193-24-000123',
            primaryDocument: 'aapl-20240930.htm',
            items: undefined,
            url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240930.htm',
          },
          {
            form: '10-K',
            filingDate: '2024-10-15',
            reportDate: '2024-09-30',
            accessionNumber: '0000320193-24-000124',
            primaryDocument: 'aapl-20240930-amended.htm',
            items: undefined,
            url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000124/aapl-20240930-amended.htm',
          },
        ],
      });

      // Mock existing data source (first filing already exists)
      jest.spyOn(prisma.dataSource, 'findMany').mockResolvedValue([
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
            filingDate: '2024-11-01',
            reportDate: '2024-09-30',
            processed: true,
          },
          createdAt: new Date(),
        },
      ]);

      // Mock upsert
      jest.spyOn(prisma.filingDetectionState, 'upsert').mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        lastFilingDate: new Date('2024-10-15'),
        checkCount: 6,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.detectNewFilings('AAPL', ['10-K']);

      expect(result.ticker).toBe('AAPL');
      expect(result.newFilings).toBe(1); // Only 1 new filing (second one)
      expect(result.errors).toHaveLength(0);
      expect(rateLimiter.waitForRateLimit).toHaveBeenCalled();
    });

    it('should handle multiple filing types', async () => {
      // Mock detection state
      jest.spyOn(prisma.filingDetectionState, 'findUnique').mockResolvedValue(null);

      // Mock CIK lookup
      jest.spyOn(secService, 'getCikForTicker').mockResolvedValue({
        ticker: 'AAPL',
        cik: '0000320193',
        cik_numeric: 320193,
        name: 'Apple Inc.',
      });

      // Mock SEC filings response for each filing type
      jest
        .spyOn(secService, 'getFillings')
        .mockResolvedValueOnce({
          // 10-K
          metadata: {
            cik: '0000320193',
            ticker: 'AAPL',
            companyName: 'Apple Inc.',
            dateRange: { startDate: undefined, endDate: undefined },
            formType: '10-K',
            includeOlderPages: false,
          },
          summary: {
            totalFilings: 1,
            filingsInDateRange: 1,
            finalResults: 1,
            tenKCount: 1,
            tenQCount: 0,
            eightKCount: 0,
          },
          filings: { tenK: [], tenQ: [], eightK: [] },
          allFilings: [
            {
              form: '10-K',
              filingDate: '2024-11-01',
              reportDate: '2024-09-30',
              accessionNumber: '0000320193-24-000123',
              primaryDocument: 'aapl-20240930.htm',
              items: undefined,
              url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240930.htm',
            },
          ],
        })
        .mockResolvedValueOnce({
          // 10-Q
          metadata: {
            cik: '0000320193',
            ticker: 'AAPL',
            companyName: 'Apple Inc.',
            dateRange: { startDate: undefined, endDate: undefined },
            formType: '10-Q',
            includeOlderPages: false,
          },
          summary: {
            totalFilings: 1,
            filingsInDateRange: 1,
            finalResults: 1,
            tenKCount: 0,
            tenQCount: 1,
            eightKCount: 0,
          },
          filings: { tenK: [], tenQ: [], eightK: [] },
          allFilings: [
            {
              form: '10-Q',
              filingDate: '2024-08-01',
              reportDate: '2024-06-30',
              accessionNumber: '0000320193-24-000100',
              primaryDocument: 'aapl-20240630.htm',
              items: undefined,
              url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000100/aapl-20240630.htm',
            },
          ],
        })
        .mockResolvedValueOnce({
          // 8-K
          metadata: {
            cik: '0000320193',
            ticker: 'AAPL',
            companyName: 'Apple Inc.',
            dateRange: { startDate: undefined, endDate: undefined },
            formType: '8-K',
            includeOlderPages: false,
          },
          summary: {
            totalFilings: 0,
            filingsInDateRange: 0,
            finalResults: 0,
            tenKCount: 0,
            tenQCount: 0,
            eightKCount: 0,
          },
          filings: { tenK: [], tenQ: [], eightK: [] },
          allFilings: [],
        });

      // Mock no existing data sources
      jest.spyOn(prisma.dataSource, 'findMany').mockResolvedValue([]);

      // Mock upsert
      jest.spyOn(prisma.filingDetectionState, 'upsert').mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        lastFilingDate: new Date('2024-11-01'),
        checkCount: 1,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.detectNewFilings('AAPL', ['10-K', '10-Q', '8-K']);

      expect(result.ticker).toBe('AAPL');
      expect(result.newFilings).toBe(2); // 1 10-K + 1 10-Q
      expect(result.errors).toHaveLength(0);
      expect(secService.getFillings).toHaveBeenCalledTimes(3);
      expect(rateLimiter.waitForRateLimit).toHaveBeenCalledTimes(3); // Once per filing type
    });

    it('should handle errors gracefully', async () => {
      // Mock detection state
      jest.spyOn(prisma.filingDetectionState, 'findUnique').mockResolvedValue(null);

      // Mock CIK lookup failure
      jest.spyOn(secService, 'getCikForTicker').mockRejectedValue(new Error('Ticker not found'));

      // Mock upsert
      jest.spyOn(prisma.filingDetectionState, 'upsert').mockResolvedValue({
        ticker: 'INVALID',
        lastCheckDate: new Date(),
        lastFilingDate: null,
        checkCount: 1,
        consecutiveFailures: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.detectNewFilings('INVALID');

      expect(result.ticker).toBe('INVALID');
      expect(result.newFilings).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Ticker not found');
    });

    it('should use last check date for forward-looking detection', async () => {
      const lastCheckDate = new Date('2024-10-01');

      // Mock detection state with previous check
      jest.spyOn(prisma.filingDetectionState, 'findUnique').mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate,
        lastFilingDate: new Date('2024-09-30'),
        checkCount: 5,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Mock CIK lookup
      jest.spyOn(secService, 'getCikForTicker').mockResolvedValue({
        ticker: 'AAPL',
        cik: '0000320193',
        cik_numeric: 320193,
        name: 'Apple Inc.',
      });

      // Mock SEC filings response
      jest.spyOn(secService, 'getFillings').mockResolvedValue({
        metadata: {
          cik: '0000320193',
          ticker: 'AAPL',
          companyName: 'Apple Inc.',
          dateRange: { startDate: '2024-10-01', endDate: undefined },
          formType: '10-K',
          includeOlderPages: false,
        },
        summary: {
          totalFilings: 0,
          filingsInDateRange: 0,
          finalResults: 0,
          tenKCount: 0,
          tenQCount: 0,
          eightKCount: 0,
        },
        filings: { tenK: [], tenQ: [], eightK: [] },
        allFilings: [],
      });

      // Mock no existing data sources
      jest.spyOn(prisma.dataSource, 'findMany').mockResolvedValue([]);

      // Mock upsert
      jest.spyOn(prisma.filingDetectionState, 'upsert').mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        lastFilingDate: new Date('2024-09-30'),
        checkCount: 6,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.detectNewFilings('AAPL', ['10-K']);

      // Verify that startDate was passed to getFillings
      expect(secService.getFillings).toHaveBeenCalledWith('0000320193', {
        formType: '10-K',
        startDate: '2024-10-01', // Should use last check date
        includeOlderPages: false,
      });
    });

    it('should call rate limiter before each SEC API request', async () => {
      // Mock detection state
      jest.spyOn(prisma.filingDetectionState, 'findUnique').mockResolvedValue(null);

      // Mock CIK lookup
      jest.spyOn(secService, 'getCikForTicker').mockResolvedValue({
        ticker: 'AAPL',
        cik: '0000320193',
        cik_numeric: 320193,
        name: 'Apple Inc.',
      });

      // Mock SEC filings response for each filing type
      jest.spyOn(secService, 'getFillings').mockResolvedValue({
        metadata: {
          cik: '0000320193',
          ticker: 'AAPL',
          companyName: 'Apple Inc.',
          dateRange: { startDate: undefined, endDate: undefined },
          formType: '10-K',
          includeOlderPages: false,
        },
        summary: {
          totalFilings: 0,
          filingsInDateRange: 0,
          finalResults: 0,
          tenKCount: 0,
          tenQCount: 0,
          eightKCount: 0,
        },
        filings: { tenK: [], tenQ: [], eightK: [] },
        allFilings: [],
      });

      // Mock no existing data sources
      jest.spyOn(prisma.dataSource, 'findMany').mockResolvedValue([]);

      // Mock upsert
      jest.spyOn(prisma.filingDetectionState, 'upsert').mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        lastFilingDate: null,
        checkCount: 1,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Reset rate limiter mock
      jest.spyOn(rateLimiter, 'waitForRateLimit').mockClear();

      await service.detectNewFilings('AAPL', ['10-K', '10-Q', '8-K']);

      // Should call rate limiter once per filing type (3 times)
      expect(rateLimiter.waitForRateLimit).toHaveBeenCalledTimes(3);
    });

    it('should include rate limit metrics in result', async () => {
      // Mock detection state
      jest.spyOn(prisma.filingDetectionState, 'findUnique').mockResolvedValue(null);

      // Mock CIK lookup
      jest.spyOn(secService, 'getCikForTicker').mockResolvedValue({
        ticker: 'AAPL',
        cik: '0000320193',
        cik_numeric: 320193,
        name: 'Apple Inc.',
      });

      // Mock SEC filings response
      jest.spyOn(secService, 'getFillings').mockResolvedValue({
        metadata: {
          cik: '0000320193',
          ticker: 'AAPL',
          companyName: 'Apple Inc.',
          dateRange: { startDate: undefined, endDate: undefined },
          formType: '10-K',
          includeOlderPages: false,
        },
        summary: {
          totalFilings: 0,
          filingsInDateRange: 0,
          finalResults: 0,
          tenKCount: 0,
          tenQCount: 0,
          eightKCount: 0,
        },
        filings: { tenK: [], tenQ: [], eightK: [] },
        allFilings: [],
      });

      // Mock no existing data sources
      jest.spyOn(prisma.dataSource, 'findMany').mockResolvedValue([]);

      // Mock upsert
      jest.spyOn(prisma.filingDetectionState, 'upsert').mockResolvedValue({
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        lastFilingDate: null,
        checkCount: 1,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Mock rate limiter metrics
      jest.spyOn(rateLimiter, 'getMetrics').mockReturnValue({
        totalRequests: 3,
        totalDelays: 0,
        totalDelayTime: 0,
        averageDelayTime: 0,
        requestsLastSecond: 3,
        requestsLastMinute: 3,
        currentTokens: 6,
        maxRequestsPerSecond: 9,
        minDelayMs: 111,
        isCompliant: true,
      });

      const result = await service.detectNewFilings('AAPL', ['10-K']);

      expect(result.rateLimitMetrics).toBeDefined();
      expect(result.rateLimitMetrics?.requestsLastSecond).toBe(3);
      expect(result.rateLimitMetrics?.totalDelays).toBe(0);
      expect(result.rateLimitMetrics?.isCompliant).toBe(true);
    });
  });

  describe('getRateLimitMetrics', () => {
    it('should return rate limit metrics', () => {
      const mockMetrics = {
        totalRequests: 10,
        totalDelays: 2,
        totalDelayTime: 500,
        averageDelayTime: 250,
        requestsLastSecond: 5,
        requestsLastMinute: 10,
        currentTokens: 4,
        maxRequestsPerSecond: 9,
        minDelayMs: 111,
        isCompliant: true,
      };

      jest.spyOn(rateLimiter, 'getMetrics').mockReturnValue(mockMetrics);

      const metrics = service.getRateLimitMetrics();

      expect(metrics).toEqual(mockMetrics);
      expect(rateLimiter.getMetrics).toHaveBeenCalled();
    });
  });

  describe('logRateLimitMetrics', () => {
    it('should call rate limiter logMetrics', () => {
      service.logRateLimitMetrics();

      expect(rateLimiter.logMetrics).toHaveBeenCalled();
    });
  });

  describe('filterNewFilings', () => {
    it('should return empty array when no filings provided', async () => {
      const result = await service['filterNewFilings']('AAPL', []);
      expect(result).toEqual([]);
    });

    it('should filter out existing filings correctly', async () => {
      const filings = [
        {
          accessionNumber: '0000320193-24-000123',
          filingDate: new Date('2024-11-01'),
          reportDate: new Date('2024-09-30'),
          form: '10-K',
          url: 'https://example.com/filing1',
          primaryDocument: 'doc1.htm',
        },
        {
          accessionNumber: '0000320193-24-000124',
          filingDate: new Date('2024-10-15'),
          reportDate: new Date('2024-09-30'),
          form: '10-K',
          url: 'https://example.com/filing2',
          primaryDocument: 'doc2.htm',
        },
      ];

      // Mock existing data source (first filing exists)
      jest.spyOn(prisma.dataSource, 'findMany').mockResolvedValue([
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

      const result = await service['filterNewFilings']('AAPL', filings);

      expect(result).toHaveLength(1);
      expect(result[0].accessionNumber).toBe('0000320193-24-000124');
    });
  });

  describe('getDetectionState', () => {
    it('should return detection state if exists', async () => {
      const mockState = {
        ticker: 'AAPL',
        lastCheckDate: new Date('2024-10-01'),
        lastFilingDate: new Date('2024-09-30'),
        checkCount: 5,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prisma.filingDetectionState, 'findUnique').mockResolvedValue(mockState);

      const result = await service['getDetectionState']('AAPL');

      expect(result).toEqual(mockState);
      expect(prisma.filingDetectionState.findUnique).toHaveBeenCalledWith({
        where: { ticker: 'AAPL' },
      });
    });

    it('should return null if no detection state exists', async () => {
      jest.spyOn(prisma.filingDetectionState, 'findUnique').mockResolvedValue(null);

      const result = await service['getDetectionState']('NEWCO');

      expect(result).toBeNull();
    });
  });

  describe('updateDetectionState', () => {
    it('should create new detection state if not exists', async () => {
      const mockState = {
        ticker: 'AAPL',
        lastCheckDate: new Date(),
        lastFilingDate: new Date('2024-11-01'),
        checkCount: 1,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prisma.filingDetectionState, 'upsert').mockResolvedValue(mockState);

      await service['updateDetectionState']('AAPL', {
        lastCheckDate: mockState.lastCheckDate,
        lastFilingDate: mockState.lastFilingDate,
        checkCount: 1,
        consecutiveFailures: 0,
      });

      expect(prisma.filingDetectionState.upsert).toHaveBeenCalledWith({
        where: { ticker: 'AAPL' },
        create: {
          ticker: 'AAPL',
          lastCheckDate: mockState.lastCheckDate,
          lastFilingDate: mockState.lastFilingDate,
          checkCount: 1,
          consecutiveFailures: 0,
        },
        update: {
          lastCheckDate: mockState.lastCheckDate,
          lastFilingDate: mockState.lastFilingDate,
          checkCount: 1,
          consecutiveFailures: 0,
        },
      });
    });

    it('should handle errors gracefully', async () => {
      jest
        .spyOn(prisma.filingDetectionState, 'upsert')
        .mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(
        service['updateDetectionState']('AAPL', {
          lastCheckDate: new Date(),
          checkCount: 1,
          consecutiveFailures: 0,
        }),
      ).resolves.not.toThrow();
    });
  });
});
