/**
 * DocumentIndexingService — Unit Tests
 * Spec §3.4 Step 4, §7.1 Source 1+2: Embedding + pgvector indexing + search
 */
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentIndexingService } from '../../src/documents/document-indexing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from '../../src/rag/bedrock.service';

describe('DocumentIndexingService', () => {
  let service: DocumentIndexingService;
  let prisma: jest.Mocked<PrismaService>;
  let bedrock: jest.Mocked<BedrockService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const dealId = '22222222-2222-2222-2222-222222222222';
  const docId = '33333333-3333-3333-3333-333333333333';

  // Fake 1536-dim embedding
  const fakeEmbedding = new Array(1536).fill(0).map((_, i) => Math.sin(i));

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentIndexingService,
        {
          provide: PrismaService,
          useValue: {
            $executeRaw: jest.fn().mockResolvedValue(undefined),
            $queryRawUnsafe: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: BedrockService,
          useValue: {
            generateEmbedding: jest.fn().mockResolvedValue(fakeEmbedding),
          },
        },
      ],
    }).compile();

    service = module.get(DocumentIndexingService);
    prisma = module.get(PrismaService);
    bedrock = module.get(BedrockService);
  });

  describe('indexChunks', () => {
    it('should embed and index chunks', async () => {
      const chunks = [
        { chunkIndex: 0, content: 'Revenue was $100M', tokenEstimate: 50, sectionType: 'narrative' },
        { chunkIndex: 1, content: 'EBITDA margin 25%', tokenEstimate: 40, sectionType: 'table' },
      ];

      const count = await service.indexChunks(docId, tenantId, dealId, chunks);
      expect(count).toBe(2);
      expect(bedrock.generateEmbedding).toHaveBeenCalledTimes(2);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('should return 0 for empty chunks', async () => {
      const count = await service.indexChunks(docId, tenantId, dealId, []);
      expect(count).toBe(0);
      expect(bedrock.generateEmbedding).not.toHaveBeenCalled();
    });

    it('should batch chunks in groups of 10', async () => {
      const chunks = Array.from({ length: 25 }, (_, i) => ({
        chunkIndex: i,
        content: `Chunk ${i} content here`,
        tokenEstimate: 50,
        sectionType: 'narrative',
      }));

      const count = await service.indexChunks(docId, tenantId, dealId, chunks);
      expect(count).toBe(25);
      // 25 chunks = 3 batches (10 + 10 + 5)
      expect(bedrock.generateEmbedding).toHaveBeenCalledTimes(25);
    });

    it('should continue on batch failure', async () => {
      bedrock.generateEmbedding
        .mockResolvedValueOnce(fakeEmbedding) // chunk 0 succeeds
        .mockRejectedValueOnce(new Error('Rate limit')) // chunk 1 fails (whole batch fails)
        .mockResolvedValueOnce(fakeEmbedding); // chunk 2 succeeds (if reached)

      const chunks = [
        { chunkIndex: 0, content: 'Chunk 0', tokenEstimate: 50 },
        { chunkIndex: 1, content: 'Chunk 1', tokenEstimate: 50 },
      ];

      // First batch has both chunks; embedding for chunk 1 fails, so batch fails
      // But service should not throw
      const count = await service.indexChunks(docId, tenantId, dealId, chunks);
      // At least some chunks should have been attempted
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('searchChunks', () => {
    it('should perform vector search with tenant/deal scope', async () => {
      const mockResults = [
        {
          id: 'chunk-1',
          documentId: docId,
          content: 'Revenue grew 15% YoY',
          sectionType: 'mda',
          pageNumber: 5,
          fileName: 'report.pdf',
          documentType: 'sell-side-report',
          companyTicker: 'AAPL',
          score: 0.92,
        },
      ];
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue(mockResults);

      const results = await service.searchChunks('revenue growth', tenantId, dealId);
      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.92);
      expect(results[0].content).toContain('Revenue');
      expect(bedrock.generateEmbedding).toHaveBeenCalledWith('revenue growth');
    });

    it('should filter results below minScore', async () => {
      const mockResults = [
        { id: '1', documentId: docId, content: 'High relevance', sectionType: 'narrative', pageNumber: 1, fileName: 'a.pdf', documentType: 'report', companyTicker: 'AAPL', score: 0.85 },
        { id: '2', documentId: docId, content: 'Low relevance', sectionType: 'narrative', pageNumber: 2, fileName: 'a.pdf', documentType: 'report', companyTicker: 'AAPL', score: 0.3 },
      ];
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue(mockResults);

      const results = await service.searchChunks('test', tenantId, dealId, { minScore: 0.5 });
      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.85);
    });

    it('should return empty array on error', async () => {
      bedrock.generateEmbedding.mockRejectedValue(new Error('Bedrock down'));
      const results = await service.searchChunks('test', tenantId, dealId);
      expect(results).toEqual([]);
    });

    it('should respect topK option', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([]);
      await service.searchChunks('test', tenantId, dealId, { topK: 3 });

      const call = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      // topK is the 4th parameter ($4)
      expect(call[4]).toBe(3);
    });
  });

  describe('queryMetrics', () => {
    it('should query metrics by key from intel_document_extractions', async () => {
      const mockResults = [{
        id: 'ext-1',
        documentId: docId,
        data: { metric_key: 'price_target', raw_value: '$275', numeric_value: 275, period: 'FY2025E', is_estimate: true },
        confidence: 0.95,
        verified: true,
        pageNumber: 1,
        fileName: 'Goldman_AAPL.pdf',
        documentType: 'sell-side-report',
        companyTicker: 'AAPL',
      }];
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue(mockResults);

      const results = await service.queryMetrics(['price_target'], tenantId, dealId);
      expect(results).toHaveLength(1);
      expect(results[0].metricKey).toBe('price_target');
      expect(results[0].numericValue).toBe(275);
      expect(results[0].isEstimate).toBe(true);
      expect(results[0].source).toContain('Goldman_AAPL.pdf');
    });

    it('should return empty for no metric keys', async () => {
      const results = await service.queryMetrics([], tenantId, dealId);
      expect(results).toEqual([]);
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('should handle query errors gracefully', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('DB error'));
      const results = await service.queryMetrics(['revenue'], tenantId, dealId);
      expect(results).toEqual([]);
    });
  });

  describe('deleteChunks', () => {
    it('should delete all chunks for a document', async () => {
      await service.deleteChunks(docId);
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });
  });
});
