import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ContextController } from '../../src/deals/context.controller';
import { FootnoteLinkingService } from '../../src/deals/footnote-linking.service';
import { MDAIntelligenceService } from '../../src/deals/mda-intelligence.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantGuard } from '../../src/tenant/tenant.guard';

describe('ContextController', () => {
  let controller: ContextController;
  let footnoteLinkingService: FootnoteLinkingService;
  let mdaIntelligenceService: MDAIntelligenceService;
  let prismaService: PrismaService;

  const mockFootnoteLinkingService = {
    getFootnoteReferencesForMetric: jest.fn(),
  };

  const mockMDAIntelligenceService = {};

  const mockPrismaService = {
    financialMetric: {
      findUnique: jest.fn(),
    },
    mdaInsight: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContextController],
      providers: [
        {
          provide: FootnoteLinkingService,
          useValue: mockFootnoteLinkingService,
        },
        {
          provide: MDAIntelligenceService,
          useValue: mockMDAIntelligenceService,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ContextController>(ContextController);
    footnoteLinkingService = module.get<FootnoteLinkingService>(FootnoteLinkingService);
    mdaIntelligenceService = module.get<MDAIntelligenceService>(MDAIntelligenceService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getContext', () => {
    it('should return complete context for a metric', async () => {
      const mockMetric = {
        id: 'metric-123',
        normalizedMetric: 'revenue',
        value: 394328000000,
        fiscalPeriod: 'FY2024',
      };

      const mockFootnotes = [
        {
          footnoteNumber: '1',
          sectionTitle: 'Revenue Recognition',
          footnoteText: 'The Company recognizes revenue...',
          contextType: 'accounting_policy',
          extractedData: { tables: [], lists: [] },
        },
      ];

      const mockMdaInsights = {
        trends: [
          {
            metric: 'revenue',
            direction: 'increasing',
            context: 'Revenue increased by 15%',
          },
        ],
        risks: [],
      };

      mockPrismaService.financialMetric.findUnique.mockResolvedValue(mockMetric);
      mockFootnoteLinkingService.getFootnoteReferencesForMetric.mockResolvedValue(
        mockFootnotes,
      );
      mockPrismaService.mdaInsight.findFirst.mockResolvedValue(mockMdaInsights);

      const result = await controller.getContext('deal-123', 'metric-123');

      expect(result.metric.name).toBe('revenue');
      expect(result.footnotes.length).toBe(1);
      expect(result.footnotes[0].title).toBe('Revenue Recognition');
      expect(result.mdaQuotes.length).toBeGreaterThan(0);
    });

    it('should throw 404 when metric not found', async () => {
      mockPrismaService.financialMetric.findUnique.mockResolvedValue(null);

      await expect(controller.getContext('deal-123', 'metric-999')).rejects.toThrow(
        new HttpException('Metric not found', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw 500 on service error', async () => {
      mockPrismaService.financialMetric.findUnique.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(controller.getContext('deal-123', 'metric-123')).rejects.toThrow(
        new HttpException('Failed to load context', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });

  describe('getFootnotes', () => {
    it('should return footnotes for a metric', async () => {
      const mockFootnotes = [
        {
          footnoteNumber: '1',
          sectionTitle: 'Revenue Recognition',
          footnoteText: 'The Company recognizes revenue...',
          contextType: 'accounting_policy',
          extractedData: { tables: [], lists: [] },
        },
        {
          footnoteNumber: '2',
          sectionTitle: 'Segment Information',
          footnoteText: 'Revenue by segment...',
          contextType: 'segment_breakdown',
          extractedData: { tables: [{ headers: [], rows: [] }], lists: [] },
        },
      ];

      mockFootnoteLinkingService.getFootnoteReferencesForMetric.mockResolvedValue(
        mockFootnotes,
      );

      const result = await controller.getFootnotes('deal-123', 'metric-123');

      expect(result.footnotes.length).toBe(2);
      expect(result.footnotes[0].title).toBe('Revenue Recognition');
      expect(result.metadata.count).toBe(2);
    });

    it('should throw 500 on service error', async () => {
      mockFootnoteLinkingService.getFootnoteReferencesForMetric.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(controller.getFootnotes('deal-123', 'metric-123')).rejects.toThrow(
        new HttpException('Failed to load footnotes', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });

  describe('getMdaQuotes', () => {
    it('should return MD&A quotes for a metric', async () => {
      const mockMetric = {
        id: 'metric-123',
        normalizedMetric: 'revenue',
        fiscalPeriod: 'FY2024',
      };

      const mockMdaInsights = {
        trends: [
          {
            metric: 'revenue',
            direction: 'increasing',
            context: 'Revenue increased by 15% due to strong iPhone sales',
          },
        ],
        risks: [
          {
            title: 'Revenue Risk',
            description: 'Revenue may be impacted by supply chain issues',
            severity: 'medium',
          },
        ],
      };

      mockPrismaService.financialMetric.findUnique.mockResolvedValue(mockMetric);
      mockPrismaService.mdaInsight.findFirst.mockResolvedValue(mockMdaInsights);

      const result = await controller.getMdaQuotes('deal-123', 'metric-123');

      expect(result.quotes.length).toBeGreaterThan(0);
      expect(result.metadata.count).toBeGreaterThan(0);
    });

    it('should throw 404 when metric not found', async () => {
      mockPrismaService.financialMetric.findUnique.mockResolvedValue(null);

      await expect(controller.getMdaQuotes('deal-123', 'metric-999')).rejects.toThrow(
        new HttpException('Metric not found', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw 500 on service error', async () => {
      mockPrismaService.financialMetric.findUnique.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(controller.getMdaQuotes('deal-123', 'metric-123')).rejects.toThrow(
        new HttpException('Failed to load MD&A quotes', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });
});
