import { Test, TestingModule } from '@nestjs/testing';
import { CompTableService } from '../../src/deals/comp-table.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

describe('CompTableService', () => {
  let service: CompTableService;

  const mockPrismaService = {
    deal: {
      findFirst: jest.fn(),
    },
    financialMetric: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompTableService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<CompTableService>(CompTableService);

    // Clear mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildCompTable', () => {
    it('should build comp table for multiple companies', async () => {
      // Given: Multiple companies with metric data
      mockPrismaService.deal.findFirst
        .mockResolvedValueOnce({
          id: 'deal-1',
          ticker: 'AMZN',
          companyName: 'Amazon',
        })
        .mockResolvedValueOnce({
          id: 'deal-2',
          ticker: 'GOOGL',
          companyName: 'Alphabet',
        })
        .mockResolvedValueOnce({
          id: 'deal-3',
          ticker: 'META',
          companyName: 'Meta',
        });

      // Mock revenue data for each company
      mockPrismaService.financialMetric.findFirst
        // AMZN revenue
        .mockResolvedValueOnce({
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: new Decimal('574785000000'),
          statementType: 'income_statement',
        })
        // GOOGL revenue
        .mockResolvedValueOnce({
          ticker: 'GOOGL',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: new Decimal('307394000000'),
          statementType: 'income_statement',
        })
        // META revenue
        .mockResolvedValueOnce({
          ticker: 'META',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: new Decimal('134902000000'),
          statementType: 'income_statement',
        });

      // When: Build comp table
      const result = await service.buildCompTable({
        companies: ['AMZN', 'GOOGL', 'META'],
        metrics: ['revenue'],
        period: 'FY2024',
      });

      // Then: Should return comp table with all companies
      expect(result.rows).toHaveLength(3);
      expect(result.headers).toEqual(['Ticker', 'Company', 'revenue']);

      // Check AMZN row
      const amznRow = result.rows.find((r) => r.ticker === 'AMZN');
      expect(amznRow).toBeDefined();
      expect(amznRow.companyName).toBe('Amazon');
      expect(amznRow.values.revenue).toBe(574785000000);

      // Check summary stats
      expect(result.summary.median.revenue).toBeDefined();
      expect(result.summary.mean.revenue).toBeDefined();
      expect(result.summary.percentiles.revenue).toBeDefined();
    });

    it('should calculate percentiles correctly', async () => {
      // Given: Three companies with different revenue values
      mockPrismaService.deal.findFirst
        .mockResolvedValueOnce({
          ticker: 'SMALL',
          companyName: 'Small Corp',
        })
        .mockResolvedValueOnce({
          ticker: 'MEDIUM',
          companyName: 'Medium Corp',
        })
        .mockResolvedValueOnce({
          ticker: 'LARGE',
          companyName: 'Large Corp',
        });

      mockPrismaService.financialMetric.findFirst
        .mockResolvedValueOnce({
          ticker: 'SMALL',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: new Decimal('1000000000'), // $1B
        })
        .mockResolvedValueOnce({
          ticker: 'MEDIUM',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: new Decimal('5000000000'), // $5B
        })
        .mockResolvedValueOnce({
          ticker: 'LARGE',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: new Decimal('10000000000'), // $10B
        });

      // When: Build comp table
      const result = await service.buildCompTable({
        companies: ['SMALL', 'MEDIUM', 'LARGE'],
        metrics: ['revenue'],
        period: 'FY2024',
      });

      // Then: Percentiles should be calculated correctly
      const smallRow = result.rows.find((r) => r.ticker === 'SMALL');
      const mediumRow = result.rows.find((r) => r.ticker === 'MEDIUM');
      const largeRow = result.rows.find((r) => r.ticker === 'LARGE');

      // Percentile calculation: rank / total * 100
      // SMALL: 0 values below it, so 0/3 * 100 = 0%
      // MEDIUM: 1 value below it, so 1/3 * 100 = 33.33%
      // LARGE: 2 values below it, so 2/3 * 100 = 66.67%
      expect(smallRow.percentiles.revenue).toBeCloseTo(0, 1); // Smallest
      expect(mediumRow.percentiles.revenue).toBeCloseTo(33.33, 1); // Middle
      expect(largeRow.percentiles.revenue).toBeCloseTo(66.67, 1); // Largest
    });

    it('should identify outliers (top/bottom quartile)', async () => {
      // Given: Five companies with varying revenue
      const companies = ['A', 'B', 'C', 'D', 'E'];
      const revenues = [1000, 2000, 3000, 4000, 5000]; // Evenly distributed

      for (let i = 0; i < companies.length; i++) {
        mockPrismaService.deal.findFirst.mockResolvedValueOnce({
          ticker: companies[i],
          companyName: `Company ${companies[i]}`,
        });

        mockPrismaService.financialMetric.findFirst.mockResolvedValueOnce({
          ticker: companies[i],
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: new Decimal(revenues[i] * 1000000),
        });
      }

      // When: Build comp table
      const result = await service.buildCompTable({
        companies,
        metrics: ['revenue'],
        period: 'FY2024',
      });

      // Then: Top and bottom quartile should be outliers
      const companyA = result.rows.find((r) => r.ticker === 'A');
      const companyC = result.rows.find((r) => r.ticker === 'C');
      const companyE = result.rows.find((r) => r.ticker === 'E');

      expect(companyA.outliers).toContain('revenue'); // Bottom quartile
      expect(companyC.outliers).not.toContain('revenue'); // Middle
      expect(companyE.outliers).toContain('revenue'); // Top quartile
    });

    it('should handle multiple metrics', async () => {
      // Given: Company with multiple metrics
      mockPrismaService.deal.findFirst.mockResolvedValue({
        ticker: 'AMZN',
        companyName: 'Amazon',
      });

      mockPrismaService.financialMetric.findFirst
        .mockResolvedValueOnce({
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: new Decimal('574785000000'),
        })
        .mockResolvedValueOnce({
          ticker: 'AMZN',
          normalizedMetric: 'gross_profit',
          fiscalPeriod: 'FY2024',
          value: new Decimal('270458000000'),
        })
        .mockResolvedValueOnce({
          ticker: 'AMZN',
          normalizedMetric: 'operating_income',
          fiscalPeriod: 'FY2024',
          value: new Decimal('36852000000'),
        });

      // When: Build comp table with multiple metrics
      const result = await service.buildCompTable({
        companies: ['AMZN'],
        metrics: ['revenue', 'gross_profit', 'operating_income'],
        period: 'FY2024',
      });

      // Then: Should include all metrics
      expect(result.headers).toEqual([
        'Ticker',
        'Company',
        'revenue',
        'gross_profit',
        'operating_income',
      ]);

      const row = result.rows[0];
      expect(row.values.revenue).toBe(574785000000);
      expect(row.values.gross_profit).toBe(270458000000);
      expect(row.values.operating_income).toBe(36852000000);
    });

    it('should handle missing data gracefully', async () => {
      // Given: Two companies, one with partial data
      mockPrismaService.deal.findFirst
        .mockResolvedValueOnce({
          ticker: 'AMZN',
          companyName: 'Amazon',
        })
        .mockResolvedValueOnce({
          ticker: 'GOOGL',
          companyName: 'Alphabet',
        });

      mockPrismaService.financialMetric.findFirst
        // AMZN has both metrics
        .mockResolvedValueOnce({
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: new Decimal('574785000000'),
        })
        .mockResolvedValueOnce({
          ticker: 'AMZN',
          normalizedMetric: 'gross_profit',
          fiscalPeriod: 'FY2024',
          value: new Decimal('270458000000'),
        })
        // GOOGL has revenue but missing gross_profit
        .mockResolvedValueOnce({
          ticker: 'GOOGL',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: new Decimal('307394000000'),
        })
        .mockResolvedValueOnce(null); // Missing gross_profit

      // When: Build comp table
      const result = await service.buildCompTable({
        companies: ['AMZN', 'GOOGL'],
        metrics: ['revenue', 'gross_profit'],
        period: 'FY2024',
      });

      // Then: Should handle missing data
      expect(result.rows).toHaveLength(2);
      
      const amznRow = result.rows.find((r) => r.ticker === 'AMZN');
      const googlRow = result.rows.find((r) => r.ticker === 'GOOGL');
      
      expect(amznRow.values.revenue).toBe(574785000000);
      expect(amznRow.values.gross_profit).toBe(270458000000);
      expect(googlRow.values.revenue).toBe(307394000000);
      expect(googlRow.values.gross_profit).toBeNull();
    });

    it('should skip companies with no data', async () => {
      // Given: One company with data, one without
      mockPrismaService.deal.findFirst
        .mockResolvedValueOnce({
          ticker: 'AMZN',
          companyName: 'Amazon',
        })
        .mockResolvedValueOnce(null); // No deal for INVALID

      mockPrismaService.financialMetric.findFirst.mockResolvedValueOnce({
        ticker: 'AMZN',
        normalizedMetric: 'revenue',
        fiscalPeriod: 'FY2024',
        value: new Decimal('574785000000'),
      });

      // When: Build comp table
      const result = await service.buildCompTable({
        companies: ['AMZN', 'INVALID'],
        metrics: ['revenue'],
        period: 'FY2024',
      });

      // Then: Should only include AMZN
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].ticker).toBe('AMZN');
    });

    it('should throw error if no companies have data', async () => {
      // Given: No companies with data
      mockPrismaService.deal.findFirst.mockResolvedValue(null);

      // When/Then: Should throw error
      await expect(
        service.buildCompTable({
          companies: ['INVALID1', 'INVALID2'],
          metrics: ['revenue'],
          period: 'FY2024',
        }),
      ).rejects.toThrow('No data found for any of the specified companies');
    });

    it('should use cache for repeated requests', async () => {
      // Given: Initial request
      mockPrismaService.deal.findFirst.mockResolvedValue({
        ticker: 'AMZN',
        companyName: 'Amazon',
      });

      mockPrismaService.financialMetric.findFirst.mockResolvedValue({
        ticker: 'AMZN',
        normalizedMetric: 'revenue',
        fiscalPeriod: 'FY2024',
        value: new Decimal('574785000000'),
      });

      const options = {
        companies: ['AMZN'],
        metrics: ['revenue'],
        period: 'FY2024',
      };

      // When: Make first request
      await service.buildCompTable(options);

      // Clear mock call history
      jest.clearAllMocks();

      // Make second request
      const result = await service.buildCompTable(options);

      // Then: Should use cache (no Prisma calls)
      expect(mockPrismaService.deal.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaService.financialMetric.findFirst).not.toHaveBeenCalled();
      expect(result.rows).toHaveLength(1);
    });
  });

  describe('calculateSummaryStats', () => {
    it('should calculate median correctly', async () => {
      // Given: Rows with values
      const rows = [
        {
          ticker: 'A',
          companyName: 'Company A',
          values: { revenue: 1000 },
          percentiles: {},
          outliers: [],
        },
        {
          ticker: 'B',
          companyName: 'Company B',
          values: { revenue: 2000 },
          percentiles: {},
          outliers: [],
        },
        {
          ticker: 'C',
          companyName: 'Company C',
          values: { revenue: 3000 },
          percentiles: {},
          outliers: [],
        },
      ];

      // When: Calculate summary stats
      const summary = service.calculateSummaryStats(rows, ['revenue']);

      // Then: Median should be 2000
      expect(summary.median.revenue).toBe(2000);
    });

    it('should calculate mean correctly', async () => {
      // Given: Rows with values
      const rows = [
        {
          ticker: 'A',
          companyName: 'Company A',
          values: { revenue: 1000 },
          percentiles: {},
          outliers: [],
        },
        {
          ticker: 'B',
          companyName: 'Company B',
          values: { revenue: 2000 },
          percentiles: {},
          outliers: [],
        },
        {
          ticker: 'C',
          companyName: 'Company C',
          values: { revenue: 3000 },
          percentiles: {},
          outliers: [],
        },
      ];

      // When: Calculate summary stats
      const summary = service.calculateSummaryStats(rows, ['revenue']);

      // Then: Mean should be 2000
      expect(summary.mean.revenue).toBe(2000);
    });

    it('should calculate percentiles (p25, p50, p75)', async () => {
      // Given: Rows with values
      const rows = [
        {
          ticker: 'A',
          companyName: 'Company A',
          values: { revenue: 1000 },
          percentiles: {},
          outliers: [],
        },
        {
          ticker: 'B',
          companyName: 'Company B',
          values: { revenue: 2000 },
          percentiles: {},
          outliers: [],
        },
        {
          ticker: 'C',
          companyName: 'Company C',
          values: { revenue: 3000 },
          percentiles: {},
          outliers: [],
        },
        {
          ticker: 'D',
          companyName: 'Company D',
          values: { revenue: 4000 },
          percentiles: {},
          outliers: [],
        },
      ];

      // When: Calculate summary stats
      const summary = service.calculateSummaryStats(rows, ['revenue']);

      // Then: Percentiles should be calculated
      expect(summary.percentiles.revenue.p25).toBe(1750);
      expect(summary.percentiles.revenue.p50).toBe(2500);
      expect(summary.percentiles.revenue.p75).toBe(3250);
    });

    it('should handle null values', async () => {
      // Given: Rows with some null values
      const rows = [
        {
          ticker: 'A',
          companyName: 'Company A',
          values: { revenue: 1000 },
          percentiles: {},
          outliers: [],
        },
        {
          ticker: 'B',
          companyName: 'Company B',
          values: { revenue: null },
          percentiles: {},
          outliers: [],
        },
        {
          ticker: 'C',
          companyName: 'Company C',
          values: { revenue: 3000 },
          percentiles: {},
          outliers: [],
        },
      ];

      // When: Calculate summary stats
      const summary = service.calculateSummaryStats(rows, ['revenue']);

      // Then: Should ignore null values
      expect(summary.median.revenue).toBe(2000);
      expect(summary.mean.revenue).toBe(2000);
    });
  });

  describe('calculatePercentile', () => {
    it('should calculate 50th percentile (median)', () => {
      const values = [1, 2, 3, 4, 5];
      const result = service.calculatePercentile(values, 50);
      expect(result).toBe(3);
    });

    it('should calculate 25th percentile', () => {
      const values = [1, 2, 3, 4, 5];
      const result = service.calculatePercentile(values, 25);
      expect(result).toBe(2);
    });

    it('should calculate 75th percentile', () => {
      const values = [1, 2, 3, 4, 5];
      const result = service.calculatePercentile(values, 75);
      expect(result).toBe(4);
    });

    it('should handle even number of values', () => {
      const values = [1, 2, 3, 4];
      const result = service.calculatePercentile(values, 50);
      expect(result).toBe(2.5);
    });

    it('should handle single value', () => {
      const values = [42];
      const result = service.calculatePercentile(values, 50);
      expect(result).toBe(42);
    });
  });

  describe('clearCache', () => {
    it('should clear the cache', async () => {
      // Given: Cached data
      mockPrismaService.deal.findFirst.mockResolvedValue({
        ticker: 'AMZN',
        companyName: 'Amazon',
      });

      mockPrismaService.financialMetric.findFirst.mockResolvedValue({
        ticker: 'AMZN',
        normalizedMetric: 'revenue',
        fiscalPeriod: 'FY2024',
        value: new Decimal('574785000000'),
      });

      const options = {
        companies: ['AMZN'],
        metrics: ['revenue'],
        period: 'FY2024',
      };

      await service.buildCompTable(options);

      // When: Clear cache
      service.clearCache();

      // Clear mock history
      jest.clearAllMocks();

      // Make another request
      await service.buildCompTable(options);

      // Then: Should make new Prisma calls (not using cache)
      expect(mockPrismaService.deal.findFirst).toHaveBeenCalled();
      expect(mockPrismaService.financialMetric.findFirst).toHaveBeenCalled();
    });
  });
});
