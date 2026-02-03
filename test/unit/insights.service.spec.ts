import { Test, TestingModule } from '@nestjs/testing';
import { InsightsService } from '../../src/deals/insights.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MDAIntelligenceService } from '../../src/deals/mda-intelligence.service';
import { MetricHierarchyService } from '../../src/deals/metric-hierarchy.service';

describe('InsightsService', () => {
  let service: InsightsService;
  let prisma: PrismaService;
  let mdaService: MDAIntelligenceService;
  let hierarchyService: MetricHierarchyService;

  const mockDeal = {
    id: 'deal-123',
    ticker: 'AAPL',
    name: 'Apple Inc.',
    tenantId: 'tenant-123',
  };

  const mockMetrics = [
    {
      id: 'metric-1',
      ticker: 'AAPL',
      normalizedMetric: 'revenue',
      value: 394328000000,
      fiscalPeriod: 'FY2024',
    },
    {
      id: 'metric-2',
      ticker: 'AAPL',
      normalizedMetric: 'net_income',
      value: 99803000000,
      fiscalPeriod: 'FY2024',
    },
  ];

  const mockPreviousMetrics = [
    {
      id: 'metric-3',
      ticker: 'AAPL',
      normalizedMetric: 'revenue',
      value: 383285000000,
      fiscalPeriod: 'FY2023',
    },
    {
      id: 'metric-4',
      ticker: 'AAPL',
      normalizedMetric: 'net_income',
      value: 96995000000,
      fiscalPeriod: 'FY2023',
    },
  ];

  const mockMdaInsights = {
    id: 'mda-1',
    dealId: 'deal-123',
    ticker: 'AAPL',
    fiscalPeriod: 'FY2024',
    trends: [
      {
        metric: 'revenue',
        direction: 'increasing',
        magnitude: 15.0,
        drivers: ['strong iPhone sales', 'new market expansion'],
        context: 'Revenue increased by 15% due to...',
      },
    ],
    risks: [
      {
        title: 'Supply chain disruptions',
        severity: 'high',
        description: 'We face significant risk from...',
        mentions: 3,
        category: 'operational',
      },
      {
        title: 'Market competition',
        severity: 'medium',
        description: 'Increased competition in...',
        mentions: 2,
        category: 'market',
      },
    ],
    guidance: 'We expect revenue growth of 10-12% next year',
    guidanceSentiment: 'positive',
    confidenceScore: 85.0,
  };

  const mockHierarchy = [
    {
      id: 'hier-1',
      dealId: 'deal-123',
      metricName: 'revenue',
      isKeyDriver: true,
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InsightsService,
        {
          provide: PrismaService,
          useValue: {
            deal: {
              findUnique: jest.fn(),
            },
            financialMetric: {
              findMany: jest.fn(),
            },
            mdaInsight: {
              findUnique: jest.fn(),
            },
            metricHierarchy: {
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: MDAIntelligenceService,
          useValue: {},
        },
        {
          provide: MetricHierarchyService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<InsightsService>(InsightsService);
    prisma = module.get<PrismaService>(PrismaService);
    mdaService = module.get<MDAIntelligenceService>(MDAIntelligenceService);
    hierarchyService = module.get<MetricHierarchyService>(MetricHierarchyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getComprehensiveInsights', () => {
    it('should return comprehensive insights with all data', async () => {
      jest.spyOn(prisma.deal, 'findUnique').mockResolvedValue(mockDeal as any);
      jest.spyOn(prisma.financialMetric, 'findMany')
        .mockResolvedValueOnce(mockMetrics as any)
        .mockResolvedValueOnce(mockPreviousMetrics as any);
      jest.spyOn(prisma.mdaInsight, 'findUnique').mockResolvedValue(mockMdaInsights as any);
      jest.spyOn(prisma.metricHierarchy, 'findMany').mockResolvedValue(mockHierarchy as any);

      const result = await service.getComprehensiveInsights('deal-123', 'FY2024');

      expect(result).toBeDefined();
      expect(result.heroMetrics).toHaveLength(2);
      expect(result.trends).toHaveLength(1);
      expect(result.risks).toHaveLength(2);
      expect(result.guidance.text).toBe('We expect revenue growth of 10-12% next year');
      expect(result.dataQuality.metricsCount).toBe(2);
      expect(result.dataQuality.trendsCount).toBe(1);
      expect(result.dataQuality.risksCount).toBe(2);
      expect(result.dataQuality.hasGuidance).toBe(true);
    });

    it('should handle missing MD&A insights', async () => {
      jest.spyOn(prisma.deal, 'findUnique').mockResolvedValue(mockDeal as any);
      jest.spyOn(prisma.financialMetric, 'findMany')
        .mockResolvedValueOnce(mockMetrics as any)
        .mockResolvedValueOnce(mockPreviousMetrics as any);
      jest.spyOn(prisma.mdaInsight, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.metricHierarchy, 'findMany').mockResolvedValue(mockHierarchy as any);

      const result = await service.getComprehensiveInsights('deal-123', 'FY2024');

      expect(result.trends).toEqual([]);
      expect(result.risks).toEqual([]);
      expect(result.guidance.text).toBeNull();
      expect(result.dataQuality.hasGuidance).toBe(false);
    });

    it('should throw error for non-existent deal', async () => {
      jest.spyOn(prisma.deal, 'findUnique').mockResolvedValue(null);

      await expect(
        service.getComprehensiveInsights('invalid-deal', 'FY2024'),
      ).rejects.toThrow('Deal not found');
    });
  });

  describe('getHeroMetrics', () => {
    it('should return top 6 metrics with YoY change', async () => {
      jest.spyOn(prisma.deal, 'findUnique').mockResolvedValue(mockDeal as any);
      jest.spyOn(prisma.financialMetric, 'findMany')
        .mockResolvedValueOnce(mockMetrics as any)
        .mockResolvedValueOnce(mockPreviousMetrics as any);
      jest.spyOn(prisma.metricHierarchy, 'findMany').mockResolvedValue(mockHierarchy as any);

      const result = await service.getHeroMetrics('deal-123', 'FY2024');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Revenue');
      expect(result[0].value).toBe(394328000000);
      expect(result[0].change).toBeGreaterThan(0);
      expect(result[0].changePercent).toBeCloseTo(2.88, 1);
      expect(result[0].trend).toBe('increasing');
      expect(result[0].isKeyDriver).toBe(true);
    });

    it('should handle missing previous period data', async () => {
      jest.spyOn(prisma.deal, 'findUnique').mockResolvedValue(mockDeal as any);
      jest.spyOn(prisma.financialMetric, 'findMany')
        .mockResolvedValueOnce(mockMetrics as any)
        .mockResolvedValueOnce([]);
      jest.spyOn(prisma.metricHierarchy, 'findMany').mockResolvedValue([]);

      const result = await service.getHeroMetrics('deal-123', 'FY2024');

      expect(result).toHaveLength(2);
      expect(result[0].change).toBe(0);
      expect(result[0].changePercent).toBe(0);
      expect(result[0].trend).toBe('stable');
    });

    it('should sort by key drivers first, then by value', async () => {
      const multipleMetrics = [
        { ...mockMetrics[0], value: 100000 },
        { ...mockMetrics[1], value: 500000 },
      ];
      const multipleHierarchy = [
        { ...mockHierarchy[0], metricName: 'net_income', isKeyDriver: true },
      ];

      jest.spyOn(prisma.deal, 'findUnique').mockResolvedValue(mockDeal as any);
      jest.spyOn(prisma.financialMetric, 'findMany')
        .mockResolvedValueOnce(multipleMetrics as any)
        .mockResolvedValueOnce([]);
      jest.spyOn(prisma.metricHierarchy, 'findMany').mockResolvedValue(multipleHierarchy as any);

      const result = await service.getHeroMetrics('deal-123', 'FY2024');

      expect(result[0].isKeyDriver).toBe(true);
      expect(result[0].name).toBe('Net Income');
    });

    it('should return empty array for deal without ticker', async () => {
      jest.spyOn(prisma.deal, 'findUnique').mockResolvedValue({ ...mockDeal, ticker: null } as any);

      const result = await service.getHeroMetrics('deal-123', 'FY2024');

      expect(result).toEqual([]);
    });
  });

  describe('getTrends', () => {
    it('should return trends from MD&A insights', async () => {
      jest.spyOn(prisma.mdaInsight, 'findUnique').mockResolvedValue(mockMdaInsights as any);

      const result = await service.getTrends('deal-123', 'FY2024');

      expect(result).toHaveLength(1);
      expect(result[0].metric).toBe('revenue');
      expect(result[0].direction).toBe('increasing');
    });

    it('should return empty array when no MD&A insights', async () => {
      jest.spyOn(prisma.mdaInsight, 'findUnique').mockResolvedValue(null);

      const result = await service.getTrends('deal-123', 'FY2024');

      expect(result).toEqual([]);
    });
  });

  describe('getRisks', () => {
    it('should return risks sorted by severity', async () => {
      jest.spyOn(prisma.mdaInsight, 'findUnique').mockResolvedValue(mockMdaInsights as any);

      const result = await service.getRisks('deal-123', 'FY2024');

      expect(result).toHaveLength(2);
      expect(result[0].severity).toBe('high');
      expect(result[1].severity).toBe('medium');
    });

    it('should return empty array when no MD&A insights', async () => {
      jest.spyOn(prisma.mdaInsight, 'findUnique').mockResolvedValue(null);

      const result = await service.getRisks('deal-123', 'FY2024');

      expect(result).toEqual([]);
    });
  });

  describe('getGuidance', () => {
    it('should return guidance with sentiment', async () => {
      jest.spyOn(prisma.mdaInsight, 'findUnique').mockResolvedValue(mockMdaInsights as any);

      const result = await service.getGuidance('deal-123', 'FY2024');

      expect(result.text).toBe('We expect revenue growth of 10-12% next year');
      expect(result.sentiment).toBe('positive');
      expect(result.confidenceScore).toBe(85.0);
    });

    it('should return null values when no MD&A insights', async () => {
      jest.spyOn(prisma.mdaInsight, 'findUnique').mockResolvedValue(null);

      const result = await service.getGuidance('deal-123', 'FY2024');

      expect(result.text).toBeNull();
      expect(result.sentiment).toBeNull();
      expect(result.confidenceScore).toBeNull();
    });
  });

  describe('getPreviousPeriod', () => {
    it('should handle FY format', () => {
      const result = (service as any).getPreviousPeriod('FY2024');
      expect(result).toBe('FY2023');
    });

    it('should handle Q4 format', () => {
      const result = (service as any).getPreviousPeriod('Q4 2024');
      expect(result).toBe('Q3 2024');
    });

    it('should handle Q1 format (rolls to previous year)', () => {
      const result = (service as any).getPreviousPeriod('Q1 2024');
      expect(result).toBe('Q4 2023');
    });

    it('should handle year format', () => {
      const result = (service as any).getPreviousPeriod('2024');
      expect(result).toBe('2023');
    });

    it('should return same period for unknown format', () => {
      const result = (service as any).getPreviousPeriod('Unknown');
      expect(result).toBe('Unknown');
    });
  });

  describe('formatMetricName', () => {
    it('should format known metric names', () => {
      expect((service as any).formatMetricName('revenue')).toBe('Revenue');
      expect((service as any).formatMetricName('net_income')).toBe('Net Income');
      expect((service as any).formatMetricName('gross_profit')).toBe('Gross Profit');
    });

    it('should return original name for unknown metrics', () => {
      expect((service as any).formatMetricName('unknown_metric')).toBe('unknown_metric');
    });
  });
});
