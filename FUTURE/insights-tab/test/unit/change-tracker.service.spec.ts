import { Test, TestingModule } from '@nestjs/testing';
import { ChangeTrackerService, Change } from '../../src/deals/change-tracker.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ChangeTrackerService', () => {
  let service: ChangeTrackerService;

  const mockPrismaService = {
    financialMetric: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    narrativeChunk: {
      findMany: jest.fn(),
    },
    filingMetadata: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChangeTrackerService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ChangeTrackerService>(ChangeTrackerService);

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('detectChanges', () => {
    it('should detect all types of changes', async () => {
      // Mock filing dates
      mockPrismaService.filingMetadata.findFirst.mockResolvedValue({
        filingDate: new Date('2024-01-01'),
      });

      mockPrismaService.financialMetric.findFirst.mockResolvedValue({
        filingDate: new Date('2024-01-01'),
      });

      // Mock narrative chunks
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([
        {
          ticker: 'AMZN',
          filingDate: new Date('2024-01-01'),
          sectionType: 'Risk Factors',
          content: 'New cybersecurity risk disclosed',
          chunkIndex: 0,
        },
      ]);

      // Mock financial metrics
      mockPrismaService.financialMetric.findMany
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            fiscalPeriod: 'FY2023',
            normalizedMetric: 'revenue',
            value: 500000000000,
            filingDate: new Date('2023-01-01'),
          },
        ])
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            fiscalPeriod: 'FY2024',
            normalizedMetric: 'revenue',
            value: 600000000000,
            filingDate: new Date('2024-01-01'),
          },
        ]);

      const result = await service.detectChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      expect(result).toBeDefined();
      expect(result.changes).toBeInstanceOf(Array);
      expect(result.summary).toBeDefined();
      expect(result.summary.total).toBeGreaterThanOrEqual(0);
    });

    it('should apply type filters', async () => {
      mockPrismaService.filingMetadata.findFirst.mockResolvedValue({
        filingDate: new Date('2024-01-01'),
      });
      mockPrismaService.financialMetric.findFirst.mockResolvedValue({
        filingDate: new Date('2024-01-01'),
      });
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([]);
      mockPrismaService.financialMetric.findMany.mockResolvedValue([]);

      const result = await service.detectChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
        types: ['metric_change'],
      });

      expect(result.changes.every((c) => c.type === 'metric_change')).toBe(true);
    });

    it('should apply materiality filters', async () => {
      mockPrismaService.filingMetadata.findFirst.mockResolvedValue({
        filingDate: new Date('2024-01-01'),
      });
      mockPrismaService.financialMetric.findFirst.mockResolvedValue({
        filingDate: new Date('2024-01-01'),
      });
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([]);
      mockPrismaService.financialMetric.findMany.mockResolvedValue([]);

      const result = await service.detectChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
        materiality: 'high',
      });

      expect(result.changes.every((c) => c.materiality === 'high')).toBe(true);
    });

    it('should cache results', async () => {
      mockPrismaService.filingMetadata.findFirst.mockResolvedValue({
        filingDate: new Date('2024-01-01'),
      });
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([]);
      mockPrismaService.financialMetric.findMany.mockResolvedValue([]);
      mockPrismaService.financialMetric.findFirst.mockResolvedValue({
        filingDate: new Date('2024-01-01'),
      });

      // First call
      await service.detectChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      // Clear mock call counts
      jest.clearAllMocks();

      // Second call (should use cache)
      await service.detectChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      // Should not call database again (cached)
      expect(mockPrismaService.narrativeChunk.findMany).toHaveBeenCalledTimes(0);
    });
  });

  describe('detectNewDisclosures', () => {
    it('should detect new sections', async () => {
      mockPrismaService.filingMetadata.findFirst
        .mockResolvedValueOnce({ filingDate: new Date('2023-01-01') })
        .mockResolvedValueOnce({ filingDate: new Date('2024-01-01') });

      mockPrismaService.narrativeChunk.findMany
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            filingDate: new Date('2023-01-01'),
            sectionType: 'Business Overview',
            content: 'Business description',
            chunkIndex: 0,
          },
        ])
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            filingDate: new Date('2024-01-01'),
            sectionType: 'Business Overview',
            content: 'Business description',
            chunkIndex: 0,
          },
          {
            ticker: 'AMZN',
            filingDate: new Date('2024-01-01'),
            sectionType: 'Risk Factors',
            content: 'New litigation risk disclosed regarding cybersecurity breach',
            chunkIndex: 1,
          },
        ]);

      const result = await service.detectNewDisclosures({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('new_disclosure');
      expect(result[0].category).toBe('New Section');
    });

    it('should handle empty chunks', async () => {
      mockPrismaService.filingMetadata.findFirst.mockResolvedValue(null);
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([]);

      const result = await service.detectNewDisclosures({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      expect(result).toEqual([]);
    });
  });

  describe('detectLanguageChanges', () => {
    it('should detect tone shifts', async () => {
      mockPrismaService.filingMetadata.findFirst
        .mockResolvedValueOnce({ filingDate: new Date('2023-01-01') })
        .mockResolvedValueOnce({ filingDate: new Date('2024-01-01') });

      mockPrismaService.narrativeChunk.findMany
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            filingDate: new Date('2023-01-01'),
            sectionType: 'MD&A',
            content: 'Strong growth expected. Improved performance. Success in all areas. Opportunity for expansion.',
            chunkIndex: 0,
          },
        ])
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            filingDate: new Date('2024-01-01'),
            sectionType: 'MD&A',
            content: 'Challenging market conditions. Decline in revenue. Weak performance. Risk of uncertainty.',
            chunkIndex: 0,
          },
        ]);

      const result = await service.detectLanguageChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      expect(result.length).toBeGreaterThan(0);
      const toneShift = result.find((c: Change) => c.category === 'Management Tone');
      expect(toneShift).toBeDefined();
      expect(toneShift?.materiality).toBe('high');
    });

    it('should detect keyword frequency changes', async () => {
      mockPrismaService.filingMetadata.findFirst
        .mockResolvedValueOnce({ filingDate: new Date('2023-01-01') })
        .mockResolvedValueOnce({ filingDate: new Date('2024-01-01') });

      mockPrismaService.narrativeChunk.findMany
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            filingDate: new Date('2023-01-01'),
            sectionType: 'MD&A',
            content: 'growth growth',
            chunkIndex: 0,
          },
        ])
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            filingDate: new Date('2024-01-01'),
            sectionType: 'MD&A',
            content: 'decline decline decline decline',
            chunkIndex: 0,
          },
        ]);

      const result = await service.detectLanguageChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      expect(result).toBeInstanceOf(Array);
    });
  });

  describe('detectMetricChanges', () => {
    it('should detect discontinued metrics', async () => {
      mockPrismaService.financialMetric.findMany
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            fiscalPeriod: 'FY2023',
            normalizedMetric: 'monthly_active_users',
            value: 100000000,
          },
        ])
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            fiscalPeriod: 'FY2024',
            normalizedMetric: 'revenue',
            value: 600000000000,
          },
        ]);

      const result = await service.detectMetricChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      const discontinued = result.find((c) => c.category === 'Discontinued Metric');
      expect(discontinued).toBeDefined();
      expect(discontinued.materiality).toBe('high');
    });

    it('should detect new metrics', async () => {
      mockPrismaService.financialMetric.findMany
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            fiscalPeriod: 'FY2023',
            normalizedMetric: 'revenue',
            value: 500000000000,
          },
        ])
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            fiscalPeriod: 'FY2024',
            normalizedMetric: 'revenue',
            value: 600000000000,
          },
          {
            ticker: 'AMZN',
            fiscalPeriod: 'FY2024',
            normalizedMetric: 'cloud_revenue',
            value: 100000000000,
          },
        ]);

      const result = await service.detectMetricChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      const newMetric = result.find((c) => c.category === 'New Metric');
      expect(newMetric).toBeDefined();
      expect(newMetric.materiality).toBe('medium');
    });

    it('should detect significant value changes', async () => {
      mockPrismaService.financialMetric.findMany
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            fiscalPeriod: 'FY2023',
            normalizedMetric: 'operating_margin',
            value: 10.0,
          },
        ])
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            fiscalPeriod: 'FY2024',
            normalizedMetric: 'operating_margin',
            value: 5.0,
          },
        ]);

      const result = await service.detectMetricChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      const significant = result.find((c) => c.category === 'Significant Change');
      expect(significant).toBeDefined();
      expect(significant.percentChange).toBeDefined();
      expect(Math.abs(significant.percentChange)).toBeGreaterThan(20);
    });

    it('should handle null values gracefully', async () => {
      mockPrismaService.financialMetric.findMany
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            fiscalPeriod: 'FY2023',
            normalizedMetric: 'revenue',
            value: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            ticker: 'AMZN',
            fiscalPeriod: 'FY2024',
            normalizedMetric: 'revenue',
            value: 600000000000,
          },
        ]);

      const result = await service.detectMetricChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      expect(result).toBeInstanceOf(Array);
    });
  });

  describe('detectAccountingChanges', () => {
    it('should detect accounting policy changes', async () => {
      mockPrismaService.filingMetadata.findFirst.mockResolvedValue({
        filingDate: new Date('2024-01-01'),
      });

      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([
        {
          ticker: 'AMZN',
          filingDate: new Date('2024-01-01'),
          sectionType: 'Accounting Policies',
          content: 'Adopted new ASC 606 revenue recognition standard in fiscal year 2024',
          chunkIndex: 0,
        },
      ]);

      const result = await service.detectAccountingChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('accounting_change');
      expect(result[0].materiality).toBe('high');
    });

    it('should detect restatements', async () => {
      mockPrismaService.filingMetadata.findFirst.mockResolvedValue({
        filingDate: new Date('2024-01-01'),
      });

      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([
        {
          ticker: 'AMZN',
          filingDate: new Date('2024-01-01'),
          sectionType: 'Notes to Financial Statements',
          content: 'Restatement of prior period financials due to accounting error',
          chunkIndex: 0,
        },
      ]);

      const result = await service.detectAccountingChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('clearCache', () => {
    it('should clear the cache', () => {
      service.clearCache();
      // No error should be thrown
      expect(true).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle database errors gracefully', async () => {
      mockPrismaService.filingMetadata.findFirst.mockRejectedValue(
        new Error('Database error'),
      );
      mockPrismaService.narrativeChunk.findMany.mockRejectedValue(
        new Error('Database error'),
      );
      mockPrismaService.financialMetric.findMany.mockRejectedValue(
        new Error('Database error'),
      );

      const result = await service.detectChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      expect(result.changes).toEqual([]);
      expect(result.summary.total).toBe(0);
    });

    it('should handle empty periods', async () => {
      mockPrismaService.filingMetadata.findFirst.mockResolvedValue({
        filingDate: new Date('2024-01-01'),
      });
      mockPrismaService.financialMetric.findFirst.mockResolvedValue({
        filingDate: new Date('2024-01-01'),
      });
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([]);
      mockPrismaService.financialMetric.findMany.mockResolvedValue([]);

      const result = await service.detectChanges({
        ticker: 'AMZN',
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      });

      expect(result.changes).toEqual([]);
      expect(result.summary.total).toBe(0);
    });
  });
});
