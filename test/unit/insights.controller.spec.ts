import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { InsightsController } from '../../src/deals/insights.controller';
import { InsightsService } from '../../src/deals/insights.service';

describe('InsightsController', () => {
  let controller: InsightsController;
  let service: InsightsService;

  const mockInsightsService = {
    getComprehensiveInsights: jest.fn(),
    getTrends: jest.fn(),
    getRisks: jest.fn(),
    getGuidance: jest.fn(),
    getHeroMetrics: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InsightsController],
      providers: [
        {
          provide: InsightsService,
          useValue: mockInsightsService,
        },
      ],
    }).compile();

    controller = module.get<InsightsController>(InsightsController);
    service = module.get<InsightsService>(InsightsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getInsights', () => {
    it('should return comprehensive insights', async () => {
      const mockInsights = {
        heroMetrics: [
          {
            name: 'Revenue',
            value: 394328000000,
            change: 11043000000,
            changePercent: 2.88,
            trend: 'increasing' as const,
            isKeyDriver: true,
          },
        ],
        trends: [],
        risks: [],
        guidance: {
          text: null,
          sentiment: null,
          confidenceScore: null,
        },
        dataQuality: {
          metricsCount: 1,
          trendsCount: 0,
          risksCount: 0,
          hasGuidance: false,
        },
      };

      mockInsightsService.getComprehensiveInsights.mockResolvedValue(mockInsights);

      const result = await controller.getInsights('deal-123', 'FY2024');

      expect(result).toEqual(mockInsights);
      expect(service.getComprehensiveInsights).toHaveBeenCalledWith('deal-123', 'FY2024');
    });

    it('should throw 404 when insights not found', async () => {
      mockInsightsService.getComprehensiveInsights.mockRejectedValue(
        new Error('Deal not found')
      );

      await expect(controller.getInsights('deal-123', 'FY2024')).rejects.toThrow(
        new HttpException('Insights not found for this deal and period', HttpStatus.NOT_FOUND)
      );
    });

    it('should throw 500 on service error', async () => {
      mockInsightsService.getComprehensiveInsights.mockRejectedValue(
        new Error('Database error')
      );

      await expect(controller.getInsights('deal-123', 'FY2024')).rejects.toThrow(
        new HttpException('Failed to load insights', HttpStatus.INTERNAL_SERVER_ERROR)
      );
    });

    it('should preserve HttpException from service', async () => {
      const httpException = new HttpException('Custom error', HttpStatus.BAD_REQUEST);
      mockInsightsService.getComprehensiveInsights.mockRejectedValue(httpException);

      await expect(controller.getInsights('deal-123', 'FY2024')).rejects.toThrow(httpException);
    });
  });

  describe('getTrends', () => {
    it('should return trends', async () => {
      const mockTrends = [
        {
          metric: 'revenue',
          direction: 'increasing',
          magnitude: 15.0,
          drivers: ['strong iPhone sales'],
          context: 'Revenue increased by 15%',
        },
      ];

      mockInsightsService.getTrends.mockResolvedValue(mockTrends);

      const result = await controller.getTrends('deal-123', 'FY2024');

      expect(result).toEqual(mockTrends);
      expect(service.getTrends).toHaveBeenCalledWith('deal-123', 'FY2024');
    });

    it('should throw 500 on service error', async () => {
      mockInsightsService.getTrends.mockRejectedValue(new Error('Database error'));

      await expect(controller.getTrends('deal-123', 'FY2024')).rejects.toThrow(
        new HttpException('Failed to load trends', HttpStatus.INTERNAL_SERVER_ERROR)
      );
    });
  });

  describe('getRisks', () => {
    it('should return risks', async () => {
      const mockRisks = [
        {
          title: 'Supply chain disruptions',
          severity: 'high',
          description: 'We face significant risk from...',
          mentions: 3,
          category: 'operational',
        },
      ];

      mockInsightsService.getRisks.mockResolvedValue(mockRisks);

      const result = await controller.getRisks('deal-123', 'FY2024');

      expect(result).toEqual(mockRisks);
      expect(service.getRisks).toHaveBeenCalledWith('deal-123', 'FY2024');
    });

    it('should throw 500 on service error', async () => {
      mockInsightsService.getRisks.mockRejectedValue(new Error('Database error'));

      await expect(controller.getRisks('deal-123', 'FY2024')).rejects.toThrow(
        new HttpException('Failed to load risks', HttpStatus.INTERNAL_SERVER_ERROR)
      );
    });
  });

  describe('getGuidance', () => {
    it('should return guidance', async () => {
      const mockGuidance = {
        text: 'We expect revenue growth of 10-12% next year',
        sentiment: 'positive',
        confidenceScore: 85.0,
      };

      mockInsightsService.getGuidance.mockResolvedValue(mockGuidance);

      const result = await controller.getGuidance('deal-123', 'FY2024');

      expect(result).toEqual(mockGuidance);
      expect(service.getGuidance).toHaveBeenCalledWith('deal-123', 'FY2024');
    });

    it('should throw 500 on service error', async () => {
      mockInsightsService.getGuidance.mockRejectedValue(new Error('Database error'));

      await expect(controller.getGuidance('deal-123', 'FY2024')).rejects.toThrow(
        new HttpException('Failed to load guidance', HttpStatus.INTERNAL_SERVER_ERROR)
      );
    });
  });

  describe('getHeroMetrics', () => {
    it('should return hero metrics', async () => {
      const mockMetrics = [
        {
          name: 'Revenue',
          value: 394328000000,
          change: 11043000000,
          changePercent: 2.88,
          trend: 'increasing' as const,
          isKeyDriver: true,
        },
      ];

      mockInsightsService.getHeroMetrics.mockResolvedValue(mockMetrics);

      const result = await controller.getHeroMetrics('deal-123', 'FY2024');

      expect(result).toEqual(mockMetrics);
      expect(service.getHeroMetrics).toHaveBeenCalledWith('deal-123', 'FY2024');
    });

    it('should throw 500 on service error', async () => {
      mockInsightsService.getHeroMetrics.mockRejectedValue(new Error('Database error'));

      await expect(controller.getHeroMetrics('deal-123', 'FY2024')).rejects.toThrow(
        new HttpException('Failed to load hero metrics', HttpStatus.INTERNAL_SERVER_ERROR)
      );
    });
  });
});
