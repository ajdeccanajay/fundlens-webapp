import { Test, TestingModule } from '@nestjs/testing';
import { SectionExporterService, AggregatedSection, SectionMetadata } from '../../src/rag/section-exporter.service';
import { PrismaService } from '../../prisma/prisma.service';

// Mock S3 Client
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn(),
  DeleteObjectsCommand: jest.fn(),
  ListObjectsV2Command: jest.fn(),
}));

describe('SectionExporterService', () => {
  let service: SectionExporterService;
  let prismaService: PrismaService;

  // Mock data
  const mockChunks = [
    {
      id: '1',
      ticker: 'AAPL',
      filingType: '10-K',
      sectionType: 'item_1',
      chunkIndex: 0,
      content: 'Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide.',
      s3Path: null,
      bedrockKbId: null,
      dataSourceId: null,
      createdAt: new Date(),
    },
    {
      id: '2',
      ticker: 'AAPL',
      filingType: '10-K',
      sectionType: 'item_1',
      chunkIndex: 1,
      content: 'The Company sells its products through its retail and online stores, and its direct sales force.',
      s3Path: null,
      bedrockKbId: null,
      dataSourceId: null,
      createdAt: new Date(),
    },
    {
      id: '3',
      ticker: 'AAPL',
      filingType: '10-K',
      sectionType: 'item_1a',
      chunkIndex: 0,
      content: 'Risk factors include global economic conditions, competition, and supply chain disruptions that could materially affect operations.',
      s3Path: null,
      bedrockKbId: null,
      dataSourceId: null,
      createdAt: new Date(),
    },
    {
      id: '4',
      ticker: 'AAPL',
      filingType: '10-K',
      sectionType: 'item_7',
      chunkIndex: 0,
      content: 'Management Discussion and Analysis: Revenue increased 8% year-over-year driven by strong iPhone and Services performance.',
      s3Path: null,
      bedrockKbId: null,
      dataSourceId: null,
      createdAt: new Date(),
    },
  ];

  const mockFilingMetadata = [
    {
      id: '1',
      ticker: 'AAPL',
      filingType: '10-K',
      filingDate: new Date('2024-10-31'),
      cik: '0000320193',
      accessionNo: '0000320193-24-000123',
      filingUrl: 'https://sec.gov/...',
      processed: true,
      metricsCount: 100,
      chunksCount: 50,
      createdAt: new Date(),
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SectionExporterService,
        {
          provide: PrismaService,
          useValue: {
            narrativeChunk: {
              findMany: jest.fn(),
              count: jest.fn(),
            },
            filingMetadata: {
              findMany: jest.fn(),
            },
            $queryRaw: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SectionExporterService>(SectionExporterService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getTickersWithChunks', () => {
    it('should return list of unique tickers', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([
        { ticker: 'AAPL' },
        { ticker: 'GOOGL' },
        { ticker: 'MSFT' },
      ]);

      const result = await service.getTickersWithChunks();

      expect(result).toEqual(['AAPL', 'GOOGL', 'MSFT']);
      expect(prismaService.$queryRaw).toHaveBeenCalled();
    });

    it('should return empty array when no chunks exist', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      const result = await service.getTickersWithChunks();

      expect(result).toEqual([]);
    });
  });

  describe('aggregateChunksBySection', () => {
    it('should aggregate chunks by section correctly', async () => {
      (prismaService.narrativeChunk.findMany as jest.Mock).mockResolvedValue(mockChunks);
      (prismaService.filingMetadata.findMany as jest.Mock).mockResolvedValue(mockFilingMetadata);

      const result = await service.aggregateChunksBySection('AAPL');

      // Should have 3 sections: item_1, item_1a, item_7
      expect(result.length).toBe(3);

      // Check item_1 section (should have 2 chunks combined)
      const item1Section = result.find(s => s.metadata.section_type === 'item_1');
      expect(item1Section).toBeDefined();
      expect(item1Section!.metadata.chunk_count).toBe(2);
      expect(item1Section!.content).toContain('Apple Inc.');
      expect(item1Section!.content).toContain('retail and online stores');
    });

    it('should return empty array for ticker with no chunks', async () => {
      (prismaService.narrativeChunk.findMany as jest.Mock).mockResolvedValue([]);
      (prismaService.filingMetadata.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.aggregateChunksBySection('UNKNOWN');

      expect(result).toEqual([]);
    });

    it('should skip sections with content less than 100 characters', async () => {
      const shortChunks = [
        {
          id: '1',
          ticker: 'AAPL',
          filingType: '10-K',
          sectionType: 'item_16',
          chunkIndex: 0,
          content: 'Short content',
          s3Path: null,
          bedrockKbId: null,
          dataSourceId: null,
          createdAt: new Date(),
        },
      ];

      (prismaService.narrativeChunk.findMany as jest.Mock).mockResolvedValue(shortChunks);
      (prismaService.filingMetadata.findMany as jest.Mock).mockResolvedValue(mockFilingMetadata);

      const result = await service.aggregateChunksBySection('AAPL');

      expect(result.length).toBe(0);
    });

    it('should derive fiscal period from filing metadata', async () => {
      (prismaService.narrativeChunk.findMany as jest.Mock).mockResolvedValue(mockChunks);
      (prismaService.filingMetadata.findMany as jest.Mock).mockResolvedValue(mockFilingMetadata);

      const result = await service.aggregateChunksBySection('AAPL');

      // All sections should have FY2024 fiscal period (from Oct 2024 10-K filing)
      for (const section of result) {
        expect(section.metadata.fiscal_period).toBe('FY2024');
      }
    });
  });

  describe('buildSectionKey', () => {
    it('should build correct section key', () => {
      const key = service.buildSectionKey('AAPL', '10-K', 'item_1', 'FY2024');
      expect(key).toBe('AAPL/10-K_FY2024_item_1');
    });

    it('should sanitize special characters', () => {
      const key = service.buildSectionKey('AAPL', '10-K/A', 'item_1a', 'Q3-2024');
      expect(key).toBe('AAPL/10-K_A_Q3-2024_item_1a');
    });
  });

  describe('getSectionTitle', () => {
    it('should return correct titles for 10-K items', () => {
      expect(service.getSectionTitle('item_1')).toBe('Business');
      expect(service.getSectionTitle('item_1a')).toBe('Risk Factors');
      expect(service.getSectionTitle('item_7')).toBe('MD&A');
      expect(service.getSectionTitle('item_8')).toBe('Financial Statements');
    });

    it('should return correct titles for 10-Q items', () => {
      expect(service.getSectionTitle('item_1_p2')).toBe('Legal Proceedings (Part II)');
      expect(service.getSectionTitle('item_1a_p2')).toBe('Risk Factors (Part II)');
    });

    it('should return correct titles for 8-K items', () => {
      expect(service.getSectionTitle('item_2_02')).toBe('Results of Operations');
      expect(service.getSectionTitle('item_8_01')).toBe('Other Events');
    });

    it('should return section type as fallback for unknown sections', () => {
      expect(service.getSectionTitle('unknown_section')).toBe('Unknown Section');
    });
  });

  describe('cleanContent', () => {
    it('should remove HTML tags', () => {
      const content = '<p>Hello <b>World</b></p>';
      const cleaned = service.cleanContent(content);
      expect(cleaned).toBe('Hello World');
    });

    it('should normalize whitespace', () => {
      const content = 'Hello    World\n\n\nTest';
      const cleaned = service.cleanContent(content);
      expect(cleaned).toBe('Hello World Test');
    });

    it('should handle empty content', () => {
      expect(service.cleanContent('')).toBe('');
      expect(service.cleanContent(null as any)).toBe('');
    });

    it('should remove control characters', () => {
      const content = 'Hello\x00World\x1FTest';
      const cleaned = service.cleanContent(content);
      expect(cleaned).toBe('HelloWorldTest');
    });
  });

  describe('uploadSectionsToS3', () => {
    it('should return correct stats in dry run mode', async () => {
      const sections: AggregatedSection[] = [
        {
          key: 'sections/AAPL/10-K_FY2024_item_1.txt',
          content: 'Test content for business section',
          metadata: {
            ticker: 'AAPL',
            filing_type: '10-K',
            section_type: 'item_1',
            section_title: 'Business',
            fiscal_period: 'FY2024',
            filing_date: '2024-10-31',
            chunk_count: 5,
            total_characters: 1000,
          },
        },
      ];

      const result = await service.uploadSectionsToS3(sections, { dryRun: true });

      expect(result.uploaded).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.keys).toContain('sections/AAPL/10-K_FY2024_item_1.txt');
    });
  });

  describe('exportTickerSections', () => {
    it('should export sections and return stats', async () => {
      (prismaService.narrativeChunk.findMany as jest.Mock).mockResolvedValue(mockChunks);
      (prismaService.filingMetadata.findMany as jest.Mock).mockResolvedValue(mockFilingMetadata);

      const result = await service.exportTickerSections('AAPL', { dryRun: true });

      expect(result.ticker).toBe('AAPL');
      expect(result.totalSections).toBe(3);
      expect(result.byFilingType['10-K']).toBe(3);
      expect(result.bySectionType['item_1']).toBe(1);
      expect(result.bySectionType['item_1a']).toBe(1);
      expect(result.bySectionType['item_7']).toBe(1);
    });
  });

  describe('exportAllSections', () => {
    it('should export sections for all tickers', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([
        { ticker: 'AAPL' },
        { ticker: 'GOOGL' },
      ]);
      (prismaService.narrativeChunk.findMany as jest.Mock).mockResolvedValue(mockChunks);
      (prismaService.filingMetadata.findMany as jest.Mock).mockResolvedValue(mockFilingMetadata);

      const result = await service.exportAllSections({ dryRun: true });

      expect(result.totalTickers).toBe(2);
      expect(result.tickerStats.length).toBe(2);
    });

    it('should filter by specific tickers when provided', async () => {
      (prismaService.narrativeChunk.findMany as jest.Mock).mockResolvedValue(mockChunks);
      (prismaService.filingMetadata.findMany as jest.Mock).mockResolvedValue(mockFilingMetadata);

      const result = await service.exportAllSections({
        dryRun: true,
        tickers: ['AAPL'],
      });

      expect(result.totalTickers).toBe(1);
      expect(result.tickerStats[0].ticker).toBe('AAPL');
    });
  });
});
