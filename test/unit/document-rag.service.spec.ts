import { Test, TestingModule } from '@nestjs/testing';
import { DocumentRAGService } from '../../src/rag/document-rag.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from '../../src/rag/bedrock.service';

describe('DocumentRAGService', () => {
  let service: DocumentRAGService;
  let prismaService: jest.Mocked<PrismaService>;
  let bedrockService: jest.Mocked<BedrockService>;

  const mockEmbedding = new Array(1536).fill(0.1);

  const mockUserDocChunks = [
    {
      id: 'chunk-1',
      documentId: 'doc-1',
      content: 'Revenue increased to $2.5B in Q4 2023',
      pageNumber: 5,
      ticker: 'AAPL',
      filename: 'pitch-deck.pdf',
      score: 0.95,
    },
    {
      id: 'chunk-2',
      documentId: 'doc-1',
      content: 'EBITDA margin improved from 18% to 21%',
      pageNumber: 6,
      ticker: 'AAPL',
      filename: 'pitch-deck.pdf',
      score: 0.88,
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentRAGService,
        {
          provide: PrismaService,
          useValue: {
            $queryRawUnsafe: jest.fn(),
            document: {
              count: jest.fn(),
            },
            documentChunk: {
              count: jest.fn(),
            },
          },
        },
        {
          provide: BedrockService,
          useValue: {
            generateEmbedding: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DocumentRAGService>(DocumentRAGService);
    prismaService = module.get(PrismaService) as jest.Mocked<PrismaService>;
    bedrockService = module.get(BedrockService) as jest.Mocked<BedrockService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('searchUserDocuments', () => {
    it('should search user documents with tenant filter', async () => {
      bedrockService.generateEmbedding.mockResolvedValue(mockEmbedding);
      prismaService.$queryRawUnsafe.mockResolvedValue(mockUserDocChunks);

      const result = await service.searchUserDocuments('revenue growth', {
        tenantId: 'tenant-123',
        topK: 5,
      });

      expect(bedrockService.generateEmbedding).toHaveBeenCalledWith(
        'revenue growth',
      );
      expect(prismaService.$queryRawUnsafe).toHaveBeenCalled();
      expect(result.chunks).toHaveLength(2);
      expect(result.totalFound).toBe(2);
      expect(result.avgScore).toBeCloseTo(0.915, 2);
    });

    it('should filter by ticker when provided', async () => {
      bedrockService.generateEmbedding.mockResolvedValue(mockEmbedding);
      prismaService.$queryRawUnsafe.mockResolvedValue([mockUserDocChunks[0]]);

      const result = await service.searchUserDocuments('revenue', {
        tenantId: 'tenant-123',
        ticker: 'AAPL',
        topK: 5,
      });

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].ticker).toBe('AAPL');
    });

    it('should filter by minimum score', async () => {
      const lowScoreChunks = [
        { ...mockUserDocChunks[0], score: 0.95 },
        { ...mockUserDocChunks[1], score: 0.65 }, // Below threshold
      ];

      bedrockService.generateEmbedding.mockResolvedValue(mockEmbedding);
      prismaService.$queryRawUnsafe.mockResolvedValue(lowScoreChunks);

      const result = await service.searchUserDocuments('revenue', {
        tenantId: 'tenant-123',
        minScore: 0.7,
      });

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].score).toBeGreaterThanOrEqual(0.7);
    });

    it('should return empty result when no chunks found', async () => {
      bedrockService.generateEmbedding.mockResolvedValue(mockEmbedding);
      prismaService.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.searchUserDocuments('nonexistent', {
        tenantId: 'tenant-123',
      });

      expect(result.chunks).toHaveLength(0);
      expect(result.totalFound).toBe(0);
      expect(result.avgScore).toBe(0);
    });

    it('should handle errors gracefully', async () => {
      bedrockService.generateEmbedding.mockRejectedValue(
        new Error('Bedrock API error'),
      );

      await expect(
        service.searchUserDocuments('query', {
          tenantId: 'tenant-123',
        }),
      ).rejects.toThrow('Bedrock API error');
    });

    it('should search across all tickers when ticker is null', async () => {
      bedrockService.generateEmbedding.mockResolvedValue(mockEmbedding);
      prismaService.$queryRawUnsafe.mockResolvedValue(mockUserDocChunks);

      const result = await service.searchUserDocuments('revenue', {
        tenantId: 'tenant-123',
        ticker: null,
      });

      expect(result.chunks.length).toBeGreaterThan(0);
      // Verify SQL query doesn't include ticker filter
      const sqlCall = prismaService.$queryRawUnsafe.mock.calls[0][0] as string;
      expect(sqlCall).not.toContain('AND c.ticker = $3');
    });
  });

  describe('mergeAndRerankResults', () => {
    const mockSECChunks = [
      {
        id: 'sec-chunk-1',
        content: 'SEC filing content',
        score: 0.92,
      },
      {
        id: 'sec-chunk-2',
        content: 'More SEC content',
        score: 0.85,
      },
    ];

    it('should merge and rerank results by score', () => {
      const result = service.mergeAndRerankResults(
        mockUserDocChunks,
        mockSECChunks,
        5,
      );

      expect(result).toHaveLength(4);
      // Should be sorted by score descending
      expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
      expect(result[1].score).toBeGreaterThanOrEqual(result[2].score);
    });

    it('should limit results to topK', () => {
      const result = service.mergeAndRerankResults(
        mockUserDocChunks,
        mockSECChunks,
        2,
      );

      expect(result).toHaveLength(2);
      expect(result[0].score).toBe(0.95); // Highest score
    });

    it('should tag chunks with source type', () => {
      const result = service.mergeAndRerankResults(
        mockUserDocChunks,
        mockSECChunks,
        5,
      );

      const userChunk = result.find((c) => c.source === 'user_document');
      const secChunk = result.find((c) => c.source === 'sec_filing');

      expect(userChunk).toBeDefined();
      expect(userChunk.sourceType).toBe('USER_UPLOAD');
      expect(secChunk).toBeDefined();
      expect(secChunk.sourceType).toBe('SEC_FILING');
    });

    it('should handle empty arrays', () => {
      const result = service.mergeAndRerankResults([], [], 5);
      expect(result).toHaveLength(0);
    });
  });

  describe('buildContextFromChunks', () => {
    it('should build formatted context string', () => {
      const context = service.buildContextFromChunks(mockUserDocChunks);

      expect(context).toContain('[1] pitch-deck.pdf');
      expect(context).toContain('[AAPL]');
      expect(context).toContain('(Page 5)');
      expect(context).toContain('Revenue increased to $2.5B');
      expect(context).toContain('---');
    });

    it('should handle chunks without page numbers', () => {
      const chunksWithoutPages = [
        { ...mockUserDocChunks[0], pageNumber: null },
      ];

      const context = service.buildContextFromChunks(chunksWithoutPages);

      expect(context).not.toContain('(Page');
      expect(context).toContain('[1] pitch-deck.pdf');
    });

    it('should handle chunks without ticker', () => {
      const chunksWithoutTicker = [
        { ...mockUserDocChunks[0], ticker: null },
      ];

      const context = service.buildContextFromChunks(chunksWithoutTicker);

      expect(context).not.toContain('[AAPL]');
      expect(context).toContain('[1] pitch-deck.pdf');
    });

    it('should return empty string for empty array', () => {
      const context = service.buildContextFromChunks([]);
      expect(context).toBe('');
    });
  });

  describe('extractCitationsFromChunks', () => {
    it('should extract citations with all metadata', () => {
      const citations = service.extractCitationsFromChunks(mockUserDocChunks);

      expect(citations).toHaveLength(2);
      expect(citations[0]).toEqual({
        citationNumber: 1,
        documentId: 'doc-1',
        chunkId: 'chunk-1',
        filename: 'pitch-deck.pdf',
        ticker: 'AAPL',
        pageNumber: 5,
        snippet: 'Revenue increased to $2.5B in Q4 2023...',
        score: 0.95,
      });
    });

    it('should truncate long snippets', () => {
      const longChunk = {
        ...mockUserDocChunks[0],
        content: 'A'.repeat(300),
      };

      const citations = service.extractCitationsFromChunks([longChunk]);

      expect(citations[0].snippet.length).toBeLessThanOrEqual(203); // 200 + '...'
      expect(citations[0].snippet).toContain('...');
    });

    it('should number citations sequentially', () => {
      const citations = service.extractCitationsFromChunks(mockUserDocChunks);

      expect(citations[0].citationNumber).toBe(1);
      expect(citations[1].citationNumber).toBe(2);
    });

    it('should return empty array for empty input', () => {
      const citations = service.extractCitationsFromChunks([]);
      expect(citations).toEqual([]);
    });
  });

  describe('getDocumentStats', () => {
    it('should return document statistics for tenant', async () => {
      prismaService.document.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8) // indexed
        .mockResolvedValueOnce(2); // processing

      prismaService.documentChunk.count.mockResolvedValue(150);

      const stats = await service.getDocumentStats('tenant-123');

      expect(stats).toEqual({
        totalDocuments: 10,
        totalChunks: 150,
        indexedDocuments: 8,
        processingDocuments: 2,
      });
    });

    it('should filter by ticker when provided', async () => {
      prismaService.document.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(1);

      prismaService.documentChunk.count.mockResolvedValue(75);

      const stats = await service.getDocumentStats('tenant-123', 'AAPL');

      expect(stats.totalDocuments).toBe(5);
      expect(prismaService.document.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          ticker: 'AAPL',
        }),
      });
    });

    it('should handle zero documents', async () => {
      prismaService.document.count.mockResolvedValue(0);
      prismaService.documentChunk.count.mockResolvedValue(0);

      const stats = await service.getDocumentStats('tenant-123');

      expect(stats).toEqual({
        totalDocuments: 0,
        totalChunks: 0,
        indexedDocuments: 0,
        processingDocuments: 0,
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle full search and citation flow', async () => {
      bedrockService.generateEmbedding.mockResolvedValue(mockEmbedding);
      prismaService.$queryRawUnsafe.mockResolvedValue(mockUserDocChunks);

      // Search
      const searchResult = await service.searchUserDocuments('revenue', {
        tenantId: 'tenant-123',
        ticker: 'AAPL',
      });

      // Build context
      const context = service.buildContextFromChunks(searchResult.chunks);

      // Extract citations
      const citations = service.extractCitationsFromChunks(searchResult.chunks);

      expect(searchResult.chunks).toHaveLength(2);
      expect(context).toContain('Revenue increased');
      expect(citations).toHaveLength(2);
      expect(citations[0].citationNumber).toBe(1);
    });

    it('should handle cross-ticker search', async () => {
      const multiTickerChunks = [
        { ...mockUserDocChunks[0], ticker: 'AAPL' },
        { ...mockUserDocChunks[1], ticker: 'MSFT' },
      ];

      bedrockService.generateEmbedding.mockResolvedValue(mockEmbedding);
      prismaService.$queryRawUnsafe.mockResolvedValue(multiTickerChunks);

      const result = await service.searchUserDocuments('revenue', {
        tenantId: 'tenant-123',
        ticker: null, // Search all tickers
      });

      expect(result.chunks).toHaveLength(2);
      expect(result.chunks[0].ticker).toBe('AAPL');
      expect(result.chunks[1].ticker).toBe('MSFT');
    });
  });
});
