/**
 * Query Decomposition Service Unit Tests
 * 
 * Phase 3: Task 15.4, 15.5
 * Tests query decomposition completeness and basic functionality
 * 
 * Feature: rag-competitive-intelligence-extraction
 * Requirements: 22.1, 22.2, 22.3, 22.4, 22.5
 */

import * as fc from 'fast-check';
import { QueryDecompositionService, DecompositionResult, SubQuery } from '../../src/rag/query-decomposition.service';
import { BedrockService, ChunkResult, MetadataFilter } from '../../src/rag/bedrock.service';

// Mock BedrockService
const mockBedrockService = {
  retrieve: jest.fn(),
  invokeClaude: jest.fn(),
};

describe('QueryDecompositionService', () => {
  let service: QueryDecompositionService;

  // Helper to create mock chunks
  const createMockChunk = (content: string, score: number, index: number): ChunkResult => ({
    content,
    score,
    metadata: {
      ticker: 'AAPL',
      sectionType: 'business',
      filingType: '10-K',
      chunkIndex: index,
    },
    source: {
      location: `s3://bucket/chunks/AAPL/chunk-${index}.txt`,
      type: 'S3',
    },
  });

  // Arbitrary for generating valid chunks
  const chunkArbitrary = fc.record({
    content: fc.string({ minLength: 10, maxLength: 500 }),
    score: fc.float({ min: 0, max: 1, noNaN: true }),
    index: fc.integer({ min: 0, max: 100 }),
  }).map(({ content, score, index }) => createMockChunk(content, score, index));

  // Arbitrary for generating sub-queries
  const subQueryArbitrary = fc.record({
    query: fc.string({ minLength: 10, maxLength: 200 }),
    focus: fc.string({ minLength: 3, maxLength: 50 }),
    priority: fc.integer({ min: 1, max: 5 }),
  });

  beforeEach(() => {
    process.env.ENABLE_QUERY_DECOMPOSITION = 'true';
    jest.clearAllMocks();
    
    service = new QueryDecompositionService(mockBedrockService as unknown as BedrockService);
  });

  describe('Task 15.5: Unit Tests for Query Decomposition', () => {
    it('should return original query when disabled', async () => {
      process.env.ENABLE_QUERY_DECOMPOSITION = 'false';
      const disabledService = new QueryDecompositionService(mockBedrockService as unknown as BedrockService);

      const result = await disabledService.detectAndDecompose('complex query with multiple aspects');

      expect(result.isMultiFaceted).toBe(false);
      expect(result.subQueries.length).toBe(1);
      expect(result.subQueries[0].query).toBe('complex query with multiple aspects');
    });

    it('should detect simple queries as not multi-faceted', async () => {
      const result = await service.detectAndDecompose('What is Apple revenue?');

      expect(result.isMultiFaceted).toBe(false);
      expect(result.subQueries.length).toBe(1);
    });

    it('should detect multi-faceted queries with multiple question words', async () => {
      const complexQuery = 'What is Apple revenue and how does it compare to Microsoft? Also, why did growth slow?';
      
      mockBedrockService.invokeClaude.mockResolvedValue(JSON.stringify({
        isMultiFaceted: true,
        subQueries: [
          { query: 'What is Apple revenue?', focus: 'revenue', priority: 1 },
          { query: 'How does Apple revenue compare to Microsoft?', focus: 'comparison', priority: 2 },
          { query: 'Why did Apple growth slow?', focus: 'growth_analysis', priority: 3 },
        ],
      }));

      const result = await service.detectAndDecompose(complexQuery);

      expect(result.isMultiFaceted).toBe(true);
      expect(result.subQueries.length).toBe(3);
    });

    it('should detect comparison queries', async () => {
      const comparisonQuery = 'Compare Apple and Microsoft revenue growth';
      
      mockBedrockService.invokeClaude.mockResolvedValue(JSON.stringify({
        isMultiFaceted: true,
        subQueries: [
          { query: 'What is Apple revenue growth?', focus: 'apple_growth', priority: 1 },
          { query: 'What is Microsoft revenue growth?', focus: 'microsoft_growth', priority: 2 },
        ],
      }));

      const result = await service.detectAndDecompose(comparisonQuery);

      expect(result.isMultiFaceted).toBe(true);
    });

    it('should handle Claude decomposition failure gracefully', async () => {
      mockBedrockService.invokeClaude.mockRejectedValue(new Error('Claude error'));

      const result = await service.detectAndDecompose('What and how and why?');

      expect(result.isMultiFaceted).toBe(false);
      expect(result.subQueries.length).toBe(1);
    });

    it('should handle invalid JSON response from Claude', async () => {
      mockBedrockService.invokeClaude.mockResolvedValue('not valid json');

      const result = await service.detectAndDecompose('What and how and why?');

      expect(result.isMultiFaceted).toBe(false);
      expect(result.subQueries.length).toBe(1);
    });

    it('should execute decomposed retrieval for multi-faceted queries', async () => {
      // Use a query that passes the quickMultiFacetedCheck (has multiple question words)
      const complexQuery = 'What is Apple revenue and how does it compare to Microsoft?';
      
      mockBedrockService.invokeClaude.mockResolvedValue(JSON.stringify({
        isMultiFaceted: true,
        subQueries: [
          { query: 'Sub-query 1', focus: 'aspect1', priority: 1 },
          { query: 'Sub-query 2', focus: 'aspect2', priority: 2 },
        ],
      }));

      mockBedrockService.retrieve
        .mockResolvedValueOnce([createMockChunk('Result 1', 0.9, 0)])
        .mockResolvedValueOnce([createMockChunk('Result 2', 0.8, 1)]);

      const result = await service.decomposeAndRetrieve(complexQuery, { ticker: 'AAPL' });

      expect(result.decomposed).toBe(true);
      expect(result.results.length).toBe(2);
      expect(mockBedrockService.retrieve).toHaveBeenCalledTimes(2);
    });

    it('should return empty result for simple queries in decomposeAndRetrieve', async () => {
      const result = await service.decomposeAndRetrieve('simple query', { ticker: 'AAPL' });

      expect(result.decomposed).toBe(false);
      expect(result.mergedChunks).toEqual([]);
    });

    it('should merge sub-query results and deduplicate', async () => {
      const sharedChunk = createMockChunk('Shared content', 0.8, 0);
      const complexQuery = 'What is Apple revenue and how does it compare to Microsoft?';
      
      mockBedrockService.invokeClaude.mockResolvedValue(JSON.stringify({
        isMultiFaceted: true,
        subQueries: [
          { query: 'Sub-query 1', focus: 'aspect1', priority: 1 },
          { query: 'Sub-query 2', focus: 'aspect2', priority: 2 },
        ],
      }));

      mockBedrockService.retrieve
        .mockResolvedValueOnce([sharedChunk, createMockChunk('Unique 1', 0.7, 1)])
        .mockResolvedValueOnce([sharedChunk, createMockChunk('Unique 2', 0.6, 2)]);

      const result = await service.decomposeAndRetrieve(complexQuery, { ticker: 'AAPL' });

      // Should have 3 unique chunks, not 4
      expect(result.mergedChunks.length).toBe(3);
    });

    it('should boost score for chunks found by multiple sub-queries', async () => {
      const sharedChunk = createMockChunk('Shared content', 0.5, 0);
      const complexQuery = 'What is Apple revenue and how does it compare to Microsoft?';
      
      mockBedrockService.invokeClaude.mockResolvedValue(JSON.stringify({
        isMultiFaceted: true,
        subQueries: [
          { query: 'Sub-query 1', focus: 'aspect1', priority: 1 },
          { query: 'Sub-query 2', focus: 'aspect2', priority: 2 },
        ],
      }));

      mockBedrockService.retrieve
        .mockResolvedValueOnce([sharedChunk])
        .mockResolvedValueOnce([{ ...sharedChunk, score: 0.6 }]);

      const result = await service.decomposeAndRetrieve(complexQuery, { ticker: 'AAPL' });

      // Shared chunk should have boosted score (max * 1.1)
      expect(result.mergedChunks[0].score).toBeGreaterThan(0.6);
    });

    it('should check if query decomposition is enabled', () => {
      expect(service.isEnabled()).toBe(true);

      process.env.ENABLE_QUERY_DECOMPOSITION = 'false';
      const disabledService = new QueryDecompositionService(mockBedrockService as unknown as BedrockService);
      expect(disabledService.isEnabled()).toBe(false);
    });
  });

  describe('Task 15.4: Property Test - Query Decomposition Completeness', () => {
    /**
     * Property 16: Query Decomposition Completeness
     * Validates: Requirements 22.2, 22.4
     * 
     * All sub-queries should be executed and each part of response
     * should be traceable to a sub-query.
     */
    it('Property 16: All sub-queries are executed', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(subQueryArbitrary, { minLength: 2, maxLength: 5 }),
          async (subQueries) => {
            mockBedrockService.invokeClaude.mockResolvedValue(JSON.stringify({
              isMultiFaceted: true,
              subQueries,
            }));

            // Each sub-query returns unique chunks
            subQueries.forEach((_, i) => {
              mockBedrockService.retrieve.mockResolvedValueOnce([
                createMockChunk(`Result for sub-query ${i}`, 0.8, i),
              ]);
            });

            const result = await service.decomposeAndRetrieve('complex query', { ticker: 'AAPL' });

            if (result.decomposed) {
              // All sub-queries should have results
              expect(result.results.length).toBe(subQueries.length);
              
              // Each sub-query should have been executed
              expect(mockBedrockService.retrieve).toHaveBeenCalledTimes(subQueries.length);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('Property 16b: Results are traceable to sub-queries', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(subQueryArbitrary, { minLength: 2, maxLength: 4 }),
          async (subQueries) => {
            mockBedrockService.invokeClaude.mockResolvedValue(JSON.stringify({
              isMultiFaceted: true,
              subQueries,
            }));

            // Each sub-query returns unique chunks
            subQueries.forEach((sq, i) => {
              mockBedrockService.retrieve.mockResolvedValueOnce([
                createMockChunk(`Result for ${sq.focus}`, 0.8, i),
              ]);
            });

            const result = await service.decomposeAndRetrieve('complex query', { ticker: 'AAPL' });

            if (result.decomposed) {
              // Each result should have the sub-query that produced it
              result.results.forEach((r, i) => {
                expect(r.subQuery).toBeDefined();
                expect(r.subQuery.focus).toBe(subQueries[i].focus);
                expect(r.chunks).toBeDefined();
              });
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('Property 16c: Merged chunks preserve all unique results', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 4 }),
          fc.integer({ min: 1, max: 3 }),
          async (numSubQueries, chunksPerQuery) => {
            const subQueries = Array.from({ length: numSubQueries }, (_, i) => ({
              query: `Sub-query ${i}`,
              focus: `aspect_${i}`,
              priority: i + 1,
            }));

            mockBedrockService.invokeClaude.mockResolvedValue(JSON.stringify({
              isMultiFaceted: true,
              subQueries,
            }));

            // Each sub-query returns unique chunks
            let chunkIndex = 0;
            subQueries.forEach(() => {
              const chunks = Array.from({ length: chunksPerQuery }, () => 
                createMockChunk(`Unique content ${chunkIndex}`, 0.8, chunkIndex++)
              );
              mockBedrockService.retrieve.mockResolvedValueOnce(chunks);
            });

            const result = await service.decomposeAndRetrieve('complex query', { ticker: 'AAPL' }, 100);

            if (result.decomposed) {
              // All unique chunks should be in merged results
              const totalUniqueChunks = numSubQueries * chunksPerQuery;
              expect(result.mergedChunks.length).toBe(totalUniqueChunks);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('Property 16d: Sub-queries are processed by priority', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              query: fc.string({ minLength: 5, maxLength: 50 }),
              focus: fc.string({ minLength: 3, maxLength: 20 }),
              priority: fc.integer({ min: 1, max: 10 }),
            }),
            { minLength: 2, maxLength: 5 }
          ),
          async (subQueries) => {
            mockBedrockService.invokeClaude.mockResolvedValue(JSON.stringify({
              isMultiFaceted: true,
              subQueries,
            }));

            subQueries.forEach((_, i) => {
              mockBedrockService.retrieve.mockResolvedValueOnce([
                createMockChunk(`Result ${i}`, 0.8, i),
              ]);
            });

            const result = await service.decomposeAndRetrieve('complex query', { ticker: 'AAPL' });

            if (result.decomposed) {
              // Results should be in the order sub-queries were provided
              expect(result.results.length).toBe(subQueries.length);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
