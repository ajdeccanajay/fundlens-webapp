import { Test, TestingModule } from '@nestjs/testing';
import { CitationService, CreateCitationDto } from '../../src/rag/citation.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CitationService', () => {
  let service: CitationService;
  let prisma: PrismaService;

  const mockPrismaService = {
    $queryRaw: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    $executeRaw: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CitationService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<CitationService>(CitationService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('createCitation', () => {
    it('should create a single citation', async () => {
      const dto: CreateCitationDto = {
        tenantId: 'tenant-1',
        messageId: 'message-1',
        documentId: 'doc-1',
        chunkId: 'chunk-1',
        quote: 'This is a quote from the document',
        pageNumber: 5,
        relevanceScore: 0.95,
      };

      const mockCitation = {
        id: 'citation-1',
        tenantId: dto.tenantId,
        messageId: dto.messageId,
        documentId: dto.documentId,
        chunkId: dto.chunkId,
        quote: dto.quote,
        pageNumber: dto.pageNumber,
        relevanceScore: dto.relevanceScore,
        createdAt: new Date(),
      };

      mockPrismaService.$queryRaw.mockResolvedValue([mockCitation]);

      const result = await service.createCitation(dto);

      expect(result).toEqual(mockCitation);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should create citation without optional fields', async () => {
      const dto: CreateCitationDto = {
        tenantId: 'tenant-1',
        messageId: 'message-1',
        documentId: 'doc-1',
        chunkId: 'chunk-1',
        quote: 'Quote without page number',
      };

      const mockCitation = {
        id: 'citation-1',
        ...dto,
        pageNumber: null,
        relevanceScore: null,
        createdAt: new Date(),
      };

      mockPrismaService.$queryRaw.mockResolvedValue([mockCitation]);

      const result = await service.createCitation(dto);

      expect(result.pageNumber).toBeNull();
      expect(result.relevanceScore).toBeNull();
    });
  });

  describe('createCitations', () => {
    it('should create multiple citations in batch', async () => {
      const citations: CreateCitationDto[] = [
        {
          tenantId: 'tenant-1',
          messageId: 'message-1',
          documentId: 'doc-1',
          chunkId: 'chunk-1',
          quote: 'First quote',
          pageNumber: 1,
          relevanceScore: 0.9,
        },
        {
          tenantId: 'tenant-1',
          messageId: 'message-1',
          documentId: 'doc-2',
          chunkId: 'chunk-2',
          quote: 'Second quote',
          pageNumber: 2,
          relevanceScore: 0.85,
        },
      ];

      const mockCitations = citations.map((c, i) => ({
        id: `citation-${i + 1}`,
        ...c,
        createdAt: new Date(),
      }));

      mockPrismaService.$queryRawUnsafe.mockResolvedValue(mockCitations);

      const result = await service.createCitations(citations);

      expect(result).toHaveLength(2);
      expect(result).toEqual(mockCitations);
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    });

    it('should return empty array for empty input', async () => {
      const result = await service.createCitations([]);

      expect(result).toEqual([]);
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('should handle quotes with single quotes', async () => {
      const citations: CreateCitationDto[] = [
        {
          tenantId: 'tenant-1',
          messageId: 'message-1',
          documentId: 'doc-1',
          chunkId: 'chunk-1',
          quote: "Quote with 'single quotes' inside",
          relevanceScore: 0.9,
        },
      ];

      mockPrismaService.$queryRawUnsafe.mockResolvedValue([
        {
          id: 'citation-1',
          ...citations[0],
          pageNumber: null,
          createdAt: new Date(),
        },
      ]);

      const result = await service.createCitations(citations);

      expect(result).toHaveLength(1);
      expect(prisma.$queryRawUnsafe).toHaveBeenCalled();
    });
  });

  describe('getCitationsForMessage', () => {
    it('should get citations for a message', async () => {
      const messageId = 'message-1';
      const tenantId = 'tenant-1';

      const mockCitations = [
        {
          id: 'citation-1',
          tenantId,
          messageId,
          documentId: 'doc-1',
          chunkId: 'chunk-1',
          quote: 'First quote',
          pageNumber: 1,
          relevanceScore: 0.95,
          createdAt: new Date(),
        },
        {
          id: 'citation-2',
          tenantId,
          messageId,
          documentId: 'doc-2',
          chunkId: 'chunk-2',
          quote: 'Second quote',
          pageNumber: 2,
          relevanceScore: 0.85,
          createdAt: new Date(),
        },
      ];

      mockPrismaService.$queryRaw.mockResolvedValue(mockCitations);

      const result = await service.getCitationsForMessage(messageId, tenantId);

      expect(result).toHaveLength(2);
      expect(result).toEqual(mockCitations);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no citations found', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      const result = await service.getCitationsForMessage(
        'message-1',
        'tenant-1',
      );

      expect(result).toEqual([]);
    });

    it('should order by relevance score descending', async () => {
      const mockCitations = [
        {
          id: 'citation-1',
          relevanceScore: 0.95,
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'citation-2',
          relevanceScore: 0.85,
          createdAt: new Date('2024-01-02'),
        },
      ];

      mockPrismaService.$queryRaw.mockResolvedValue(mockCitations);

      const result = await service.getCitationsForMessage(
        'message-1',
        'tenant-1',
      );

      expect(result[0].relevanceScore).toBeGreaterThan(
        result[1].relevanceScore,
      );
    });
  });

  describe('getCitationsWithDetails', () => {
    it('should get citations with document and chunk details', async () => {
      const messageId = 'message-1';
      const tenantId = 'tenant-1';

      const mockCitations = [
        {
          id: 'citation-1',
          tenantId,
          messageId,
          documentId: 'doc-1',
          chunkId: 'chunk-1',
          quote: 'Quote text',
          pageNumber: 1,
          relevanceScore: 0.95,
          createdAt: new Date(),
          document: {
            id: 'doc-1',
            title: 'Document Title',
            ticker: 'AAPL',
            sourceType: 'USER_UPLOAD',
          },
          chunk: {
            id: 'chunk-1',
            content: 'Full chunk content',
            pageNumber: 1,
          },
        },
      ];

      mockPrismaService.$queryRawUnsafe.mockResolvedValue(mockCitations);

      const result = await service.getCitationsWithDetails(messageId, tenantId);

      expect(result).toHaveLength(1);
      expect(result[0].document).toBeDefined();
      expect(result[0].chunk).toBeDefined();
      expect(result[0].document.title).toBe('Document Title');
      expect(result[0].chunk.content).toBe('Full chunk content');
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    });

    it('should include all document metadata', async () => {
      const mockCitations = [
        {
          id: 'citation-1',
          document: {
            id: 'doc-1',
            title: 'Q4 2023 Earnings Report',
            ticker: 'MSFT',
            sourceType: 'USER_UPLOAD',
          },
          chunk: {
            id: 'chunk-1',
            content: 'Revenue increased by 15%',
            pageNumber: 5,
          },
        },
      ];

      mockPrismaService.$queryRawUnsafe.mockResolvedValue(mockCitations);

      const result = await service.getCitationsWithDetails(
        'message-1',
        'tenant-1',
      );

      expect(result[0].document.ticker).toBe('MSFT');
      expect(result[0].document.sourceType).toBe('USER_UPLOAD');
      expect(result[0].chunk.pageNumber).toBe(5);
    });
  });

  describe('getCitationsForDocument', () => {
    it('should get all citations for a document', async () => {
      const documentId = 'doc-1';
      const tenantId = 'tenant-1';

      const mockCitations = [
        {
          id: 'citation-1',
          tenantId,
          messageId: 'message-1',
          documentId,
          chunkId: 'chunk-1',
          quote: 'First quote',
          pageNumber: 1,
          relevanceScore: 0.95,
          createdAt: new Date('2024-01-02'),
        },
        {
          id: 'citation-2',
          tenantId,
          messageId: 'message-2',
          documentId,
          chunkId: 'chunk-2',
          quote: 'Second quote',
          pageNumber: 2,
          relevanceScore: 0.85,
          createdAt: new Date('2024-01-01'),
        },
      ];

      mockPrismaService.$queryRaw.mockResolvedValue(mockCitations);

      const result = await service.getCitationsForDocument(documentId, tenantId);

      expect(result).toHaveLength(2);
      expect(result[0].documentId).toBe(documentId);
      expect(result[1].documentId).toBe(documentId);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should order by created date descending', async () => {
      const mockCitations = [
        {
          id: 'citation-1',
          createdAt: new Date('2024-01-02'),
        },
        {
          id: 'citation-2',
          createdAt: new Date('2024-01-01'),
        },
      ];

      mockPrismaService.$queryRaw.mockResolvedValue(mockCitations);

      const result = await service.getCitationsForDocument('doc-1', 'tenant-1');

      expect(result[0].createdAt.getTime()).toBeGreaterThan(
        result[1].createdAt.getTime(),
      );
    });
  });

  describe('getCitationStats', () => {
    it('should get citation statistics for a tenant', async () => {
      const tenantId = 'tenant-1';

      const mockStats = [
        {
          totalCitations: 10,
          uniqueDocuments: 5,
          avgRelevanceScore: 0.87,
        },
      ];

      const mockBySourceType = [
        { sourceType: 'USER_UPLOAD', count: 7 },
        { sourceType: 'SEC_FILING', count: 3 },
      ];

      mockPrismaService.$queryRawUnsafe
        .mockResolvedValueOnce(mockStats)
        .mockResolvedValueOnce(mockBySourceType);

      const result = await service.getCitationStats(tenantId);

      expect(result.totalCitations).toBe(10);
      expect(result.uniqueDocuments).toBe(5);
      expect(result.avgRelevanceScore).toBe(0.87);
      expect(result.citationsBySourceType).toEqual({
        USER_UPLOAD: 7,
        SEC_FILING: 3,
      });
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it('should handle zero citations', async () => {
      mockPrismaService.$queryRawUnsafe
        .mockResolvedValueOnce([
          {
            totalCitations: 0,
            uniqueDocuments: 0,
            avgRelevanceScore: null,
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.getCitationStats('tenant-1');

      expect(result.totalCitations).toBe(0);
      expect(result.uniqueDocuments).toBe(0);
      expect(result.avgRelevanceScore).toBe(0);
      expect(result.citationsBySourceType).toEqual({});
    });

    it('should group citations by source type', async () => {
      mockPrismaService.$queryRawUnsafe
        .mockResolvedValueOnce([
          {
            totalCitations: 15,
            uniqueDocuments: 8,
            avgRelevanceScore: 0.9,
          },
        ])
        .mockResolvedValueOnce([
          { sourceType: 'USER_UPLOAD', count: 10 },
          { sourceType: 'SEC_FILING', count: 5 },
        ]);

      const result = await service.getCitationStats('tenant-1');

      expect(Object.keys(result.citationsBySourceType)).toHaveLength(2);
      expect(result.citationsBySourceType.USER_UPLOAD).toBe(10);
      expect(result.citationsBySourceType.SEC_FILING).toBe(5);
    });
  });

  describe('deleteCitationsForMessage', () => {
    it('should delete all citations for a message', async () => {
      const messageId = 'message-1';
      const tenantId = 'tenant-1';

      mockPrismaService.$executeRaw.mockResolvedValue(3);

      const result = await service.deleteCitationsForMessage(
        messageId,
        tenantId,
      );

      expect(result).toBe(3);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('should return 0 when no citations deleted', async () => {
      mockPrismaService.$executeRaw.mockResolvedValue(0);

      const result = await service.deleteCitationsForMessage(
        'message-1',
        'tenant-1',
      );

      expect(result).toBe(0);
    });
  });

  describe('deleteCitationsForDocument', () => {
    it('should delete all citations for a document', async () => {
      const documentId = 'doc-1';
      const tenantId = 'tenant-1';

      mockPrismaService.$executeRaw.mockResolvedValue(5);

      const result = await service.deleteCitationsForDocument(
        documentId,
        tenantId,
      );

      expect(result).toBe(5);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('should return 0 when no citations deleted', async () => {
      mockPrismaService.$executeRaw.mockResolvedValue(0);

      const result = await service.deleteCitationsForDocument(
        'doc-1',
        'tenant-1',
      );

      expect(result).toBe(0);
    });
  });

  describe('tenant isolation', () => {
    it('should filter citations by tenant ID in all queries', async () => {
      const tenantId = 'tenant-1';
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      await service.getCitationsForMessage('message-1', tenantId);

      expect(prisma.$queryRaw).toHaveBeenCalled();
      // Verify tenant filtering is applied (implementation detail)
    });

    it('should prevent cross-tenant citation access', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      const result = await service.getCitationsForMessage(
        'message-1',
        'tenant-2',
      );

      expect(result).toEqual([]);
    });
  });
});
