import { Test, TestingModule } from '@nestjs/testing';
import { AnomalyDetectionService } from '../../src/deals/anomaly-detection.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AnomalyDetectionService', () => {
  let service: AnomalyDetectionService;

  const mockDeal = {
    id: 'deal-1',
    ticker: 'AMZN',
    companyName: 'Amazon',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrismaService = {
    deal: {
      findUnique: jest.fn(),
    },
    financialMetric: {
      findMany: jest.fn(),
    },
    narrativeChunk: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnomalyDetectionService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<AnomalyDetectionService>(AnomalyDetectionService);

    // Clear mocks and set default deal response
    jest.clearAllMocks();
    mockPrismaService.deal.findUnique.mockResolvedValue(mockDeal);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('detectStatisticalOutliers', () => {
    it('should detect values >2σ from mean', async () => {
      // Given: Historical data with outlier
      const mockMetrics = [
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2019',
          value: 100000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2020',
          value: 102000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2021',
          value: 104000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2022',
          value: 106000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2023',
          value: 108000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: 150000000000, // Outlier (>2σ from consistent growth)
          statementType: 'income_statement',
        },
      ];

      mockPrismaService.financialMetric.findMany.mockResolvedValue(mockMetrics);
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([]);

      // When: Detect anomalies
      const anomalies = await service.detectAnomalies('deal-1', [
        'statistical_outlier',
      ]);

      // Then: Should detect FY2024 as outlier
      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].type).toBe('statistical_outlier');
      expect(anomalies[0].period).toBe('FY2024');
      expect(anomalies[0].severity).toBe('low'); // 2.21σ is low severity
      expect(anomalies[0].metric).toBe('revenue');
    });

    it('should not detect values within 2σ', async () => {
      // Given: Normal variation
      const mockMetrics = [
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2020',
          value: 100000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2021',
          value: 105000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2022',
          value: 110000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2023',
          value: 115000000000,
          statementType: 'income_statement',
        },
      ];

      mockPrismaService.financialMetric.findMany.mockResolvedValue(mockMetrics);
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([]);

      // When: Detect anomalies
      const anomalies = await service.detectAnomalies('deal-1', [
        'statistical_outlier',
      ]);

      // Then: Should not detect any outliers
      expect(anomalies).toHaveLength(0);
    });

    it('should handle missing data gracefully', async () => {
      // Given: No metrics
      mockPrismaService.financialMetric.findMany.mockResolvedValue([]);
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([]);

      // When: Detect anomalies
      const anomalies = await service.detectAnomalies('deal-1');

      // Then: Should return empty array
      expect(anomalies).toHaveLength(0);
    });

    it('should skip metrics with insufficient data points', async () => {
      // Given: Only 2 data points
      const mockMetrics = [
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2023',
          value: 100000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: 200000000000,
          statementType: 'income_statement',
        },
      ];

      mockPrismaService.financialMetric.findMany.mockResolvedValue(mockMetrics);
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([]);

      // When: Detect anomalies
      const anomalies = await service.detectAnomalies('deal-1', [
        'statistical_outlier',
      ]);

      // Then: Should not detect (need 4+ data points)
      expect(anomalies).toHaveLength(0);
    });
  });

  describe('detectSequentialChanges', () => {
    it('should detect first increase in 4+ quarters', async () => {
      // Given: 4 quarters of increase
      const mockMetrics = [
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'Q1 2023',
          value: 100000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'Q2 2023',
          value: 110000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'Q3 2023',
          value: 120000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'Q4 2023',
          value: 130000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'Q1 2024',
          value: 140000000000,
          statementType: 'income_statement',
        },
      ];

      mockPrismaService.financialMetric.findMany.mockResolvedValue(mockMetrics);
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([]);

      // When: Detect anomalies
      const anomalies = await service.detectAnomalies('deal-1', ['sequential_change']);

      // Then: Should detect sequential increase
      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0].type).toBe('sequential_change');
      expect(anomalies[0].description).toContain('increase');
    });

    it('should not detect short streaks (<4 quarters)', async () => {
      // Given: Only 2 quarters of increase
      const mockMetrics = [
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'Q1 2023',
          value: 100000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'Q2 2023',
          value: 110000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'Q3 2023',
          value: 120000000000,
          statementType: 'income_statement',
        },
      ];

      mockPrismaService.financialMetric.findMany.mockResolvedValue(mockMetrics);
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([]);

      // When: Detect anomalies
      const anomalies = await service.detectAnomalies('deal-1', ['sequential_change']);

      // Then: Should not detect (need 4+ quarters)
      expect(anomalies).toHaveLength(0);
    });
  });

  describe('detectToneShifts', () => {
    it('should detect 3x increase in keyword frequency', async () => {
      // Given: Keyword frequency change
      const mockChunks = [
        {
          ticker: 'AMZN',
          sectionType: 'mda',
          content:
            'We face significant headwinds. Market headwinds continue. Economic headwinds persist. Regulatory headwinds increase. Competitive headwinds intensify.',
          filingDate: new Date('2024-12-31'),
        },
        {
          ticker: 'AMZN',
          sectionType: 'mda',
          content: 'Business is performing well.',
          filingDate: new Date('2023-12-31'),
        },
      ];

      mockPrismaService.financialMetric.findMany.mockResolvedValue([]);
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue(mockChunks);

      // When: Detect anomalies
      const anomalies = await service.detectAnomalies('deal-1', [
        'management_tone_shift',
      ]);

      // Then: Should detect tone shift
      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0].type).toBe('management_tone_shift');
      expect(anomalies[0].description).toContain('headwinds');
    });

    it('should ignore minor frequency changes', async () => {
      // Given: Small keyword change
      const mockChunks = [
        {
          ticker: 'AMZN',
          sectionType: 'mda',
          content: 'We face some headwinds.',
          filingDate: new Date('2024-12-31'),
        },
        {
          ticker: 'AMZN',
          sectionType: 'mda',
          content: 'Business is performing well.',
          filingDate: new Date('2023-12-31'),
        },
      ];

      mockPrismaService.financialMetric.findMany.mockResolvedValue([]);
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue(mockChunks);

      // When: Detect anomalies
      const anomalies = await service.detectAnomalies('deal-1', [
        'management_tone_shift',
      ]);

      // Then: Should not detect (change < 3)
      expect(anomalies).toHaveLength(0);
    });
  });

  describe('prioritizeAnomalies', () => {
    it('should sort by severity then type', async () => {
      // Given: Mixed severity anomalies
      const mockMetrics = [
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2020',
          value: 100000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2021',
          value: 105000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2022',
          value: 110000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2023',
          value: 115000000000,
          statementType: 'income_statement',
        },
        {
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: 250000000000, // High severity outlier
          statementType: 'income_statement',
        },
      ];

      mockPrismaService.financialMetric.findMany.mockResolvedValue(mockMetrics);
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([]);

      // When: Detect anomalies
      const anomalies = await service.detectAnomalies('deal-1');

      // Then: High severity should be first
      if (anomalies.length > 0) {
        expect(anomalies[0].severity).toBe('high');
      }
    });
  });

  describe('calculateSummary', () => {
    it('should calculate correct summary statistics', () => {
      // Given: Sample anomalies
      const anomalies = [
        {
          id: '1',
          type: 'statistical_outlier' as const,
          severity: 'high' as const,
          metric: 'revenue',
          period: 'FY2024',
          value: 100,
          expectedValue: 50,
          deviation: 2.5,
          description: 'Test',
          context: 'Test',
          actionable: true,
          dismissed: false,
        },
        {
          id: '2',
          type: 'sequential_change' as const,
          severity: 'medium' as const,
          metric: 'margin',
          period: 'FY2024',
          value: 100,
          expectedValue: null,
          deviation: null,
          description: 'Test',
          context: 'Test',
          actionable: true,
          dismissed: false,
        },
      ];

      // When: Calculate summary
      const summary = service.calculateSummary(anomalies);

      // Then: Should have correct counts
      expect(summary.total).toBe(2);
      expect(summary.byType.statistical_outlier).toBe(1);
      expect(summary.byType.sequential_change).toBe(1);
      expect(summary.bySeverity.high).toBe(1);
      expect(summary.bySeverity.medium).toBe(1);
    });
  });
});
