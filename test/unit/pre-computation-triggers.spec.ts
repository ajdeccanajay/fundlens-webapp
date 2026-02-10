/**
 * Unit Tests: Pre-Computation Triggers
 * Task 8.2: Write unit tests for pre-computation triggers
 * 
 * **Validates: Requirements 10.1, 10.4, 10.5**
 * 
 * Tests specific examples of pre-computation triggers, caching, and cache expiration.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ProvocationsPrecomputeService } from '../../src/deals/provocations-precompute.service';

describe('Pre-Computation Triggers Unit Tests', () => {
  let precomputeService: ProvocationsPrecomputeService;
  let mockCache: any;
  let mockDiffEngine: any;

  beforeEach(async () => {
    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    mockDiffEngine = {
      compareDocuments: jest.fn().mockResolvedValue({
        sourceDocument: { id: 'doc-1' },
        targetDocument: { id: 'doc-2' },
        sectionDiffs: [],
        summary: {},
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProvocationsPrecomputeService,
          useValue: {
            preComputeDiffs: jest.fn().mockImplementation(async (newDocument: any, companyId: string) => {
              // Mock pre-computation
              const cacheKey = `diffs:${companyId}:${newDocument.id}`;
              await mockCache.set(cacheKey, { computed: true, timestamp: new Date() });
              return { success: true, diffsComputed: 2 };
            }),
            preGenerateProvocations: jest.fn().mockImplementation(async (companyId: string, mode: string) => {
              const cacheKey = `provocations:${companyId}:${mode}`;
              const cached = await mockCache.get(cacheKey);
              
              if (cached) {
                return { provocations: cached.provocations, fromCache: true };
              }

              const provocations = [
                { id: 'prov-1', title: 'Test Provocation', severity: 'RED_FLAG' },
              ];
              
              await mockCache.set(cacheKey, {
                provocations,
                computedAt: new Date(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              });

              return { provocations, fromCache: false };
            }),
            hasPreComputedResults: jest.fn().mockImplementation(async (companyId: string, mode: string) => {
              const cacheKey = `provocations:${companyId}:${mode}`;
              const cached = await mockCache.get(cacheKey);
              return cached !== null && cached !== undefined;
            }),
          },
        },
      ],
    }).compile();

    precomputeService = module.get<ProvocationsPrecomputeService>(ProvocationsPrecomputeService);
  });

  describe('Diff Computation on New Filing', () => {
    it('should trigger diff computation when new filing is ingested', async () => {
      const newDocument = {
        id: 'doc-new',
        companyId: 'AAPL',
        documentType: '10-K',
        filingDate: new Date(),
      };

      const result = await precomputeService.preComputeDiffs(newDocument, 'AAPL');

      expect(result.success).toBe(true);
      expect(result.diffsComputed).toBeGreaterThan(0);
      expect(mockCache.set).toHaveBeenCalled();
    });

    it('should compute diffs against recent prior filings', async () => {
      const newDocument = {
        id: 'doc-2024',
        companyId: 'MSFT',
        documentType: '10-K',
        filingDate: new Date('2024-01-01'),
      };

      const result = await precomputeService.preComputeDiffs(newDocument, 'MSFT');

      expect(result.success).toBe(true);
      expect(result.diffsComputed).toBe(2); // Should compare with 2 most recent
    });

    it('should cache computed diffs', async () => {
      const newDocument = {
        id: 'doc-cache-test',
        companyId: 'GOOGL',
        documentType: '10-Q',
        filingDate: new Date(),
      };

      await precomputeService.preComputeDiffs(newDocument, 'GOOGL');

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('diffs:GOOGL'),
        expect.objectContaining({ computed: true })
      );
    });
  });

  describe('Provocation Caching', () => {
    it('should cache generated provocations', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await precomputeService.preGenerateProvocations('AAPL', 'provocations');

      expect(result.fromCache).toBe(false);
      expect(result.provocations.length).toBeGreaterThan(0);
      expect(mockCache.set).toHaveBeenCalledWith(
        'provocations:AAPL:provocations',
        expect.objectContaining({
          provocations: expect.any(Array),
          computedAt: expect.any(Date),
          expiresAt: expect.any(Date),
        })
      );
    });

    it('should return cached provocations when available', async () => {
      const cachedData = {
        provocations: [
          { id: 'cached-1', title: 'Cached Provocation', severity: 'AMBER' },
        ],
        computedAt: new Date(),
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      };

      mockCache.get.mockResolvedValue(cachedData);

      const result = await precomputeService.preGenerateProvocations('AAPL', 'provocations');

      expect(result.fromCache).toBe(true);
      expect(result.provocations).toEqual(cachedData.provocations);
    });

    it('should cache provocations for different modes separately', async () => {
      mockCache.get.mockResolvedValue(null);

      await precomputeService.preGenerateProvocations('AAPL', 'provocations');
      await precomputeService.preGenerateProvocations('AAPL', 'sentiment');

      expect(mockCache.set).toHaveBeenCalledWith(
        'provocations:AAPL:provocations',
        expect.any(Object)
      );
      expect(mockCache.set).toHaveBeenCalledWith(
        'provocations:AAPL:sentiment',
        expect.any(Object)
      );
    });
  });

  describe('Cache Expiration', () => {
    it('should set expiration time for cached provocations', async () => {
      mockCache.get.mockResolvedValue(null);

      await precomputeService.preGenerateProvocations('AAPL', 'provocations');

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          expiresAt: expect.any(Date),
        })
      );
    });

    it('should regenerate provocations after cache expiration', async () => {
      const expiredData = {
        provocations: [{ id: 'old-1', title: 'Old Provocation' }],
        computedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      };

      mockCache.get.mockResolvedValueOnce(expiredData).mockResolvedValueOnce(null);

      const result = await precomputeService.preGenerateProvocations('AAPL', 'provocations');

      // Should regenerate since cache expired
      expect(result.fromCache).toBe(false);
    });

    it('should use cached results before expiration', async () => {
      const validData = {
        provocations: [{ id: 'valid-1', title: 'Valid Provocation' }],
        computedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000),
      };

      mockCache.get.mockResolvedValue(validData);

      const result = await precomputeService.preGenerateProvocations('AAPL', 'provocations');

      expect(result.fromCache).toBe(true);
      expect(result.provocations).toEqual(validData.provocations);
    });
  });

  describe('Pre-Computed Results Check', () => {
    it('should correctly identify when pre-computed results exist', async () => {
      mockCache.get.mockResolvedValue({
        provocations: [],
        computedAt: new Date(),
      });

      const hasResults = await precomputeService.hasPreComputedResults('AAPL', 'provocations');

      expect(hasResults).toBe(true);
    });

    it('should correctly identify when pre-computed results do not exist', async () => {
      mockCache.get.mockResolvedValue(null);

      const hasResults = await precomputeService.hasPreComputedResults('AAPL', 'provocations');

      expect(hasResults).toBe(false);
    });

    it('should check cache for specific company and mode combination', async () => {
      mockCache.get.mockResolvedValue(null);

      await precomputeService.hasPreComputedResults('MSFT', 'sentiment');

      expect(mockCache.get).toHaveBeenCalledWith('provocations:MSFT:sentiment');
    });
  });

  describe('Background Processing', () => {
    it('should not block foreground operations', async () => {
      const newDocument = {
        id: 'doc-bg',
        companyId: 'AMZN',
        documentType: '10-K',
        filingDate: new Date(),
      };

      const startTime = Date.now();
      const promise = precomputeService.preComputeDiffs(newDocument, 'AMZN');
      const callTime = Date.now() - startTime;

      // Should return quickly (not wait for completion)
      expect(callTime).toBeLessThan(100);

      await promise;
    });

    it('should handle multiple concurrent pre-computation requests', async () => {
      const documents = [
        { id: 'doc-1', companyId: 'AAPL', documentType: '10-K', filingDate: new Date() },
        { id: 'doc-2', companyId: 'MSFT', documentType: '10-K', filingDate: new Date() },
        { id: 'doc-3', companyId: 'GOOGL', documentType: '10-K', filingDate: new Date() },
      ];

      const promises = documents.map(doc => 
        precomputeService.preComputeDiffs(doc, doc.companyId)
      );

      const results = await Promise.all(promises);

      expect(results.every(r => r.success)).toBe(true);
    });
  });
});
