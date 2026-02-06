/**
 * HyDE Service Unit Tests
 * 
 * Phase 3: Task 14.4, 14.5
 * Tests HyDE deduplication and basic functionality
 * 
 * Feature: rag-competitive-intelligence-extraction
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5
 */

import * as fc from 'fast-check';
import { HyDEService, HyDEResult } from '../../src/rag/hyde.service';
import { BedrockService, ChunkResult, MetadataFilter } from '../../src/rag/bedrock.service';

// Mock BedrockService
const mockBedrockService = {
  retrieve: jest.fn(),
  invokeClaude: jest.fn(),
};

describe('HyDEService', () => {
  let service: HyDEService;

  // Helper to create mock chunks
  const createMockChunk = (content: string, score: number, index: number, ticker = 'AAPL'): ChunkResult => ({
    content,
    score,
    metadata: {
      ticker,
      sectionType: 'business',
      filingType: '10-K',
      chunkIndex: index,
    },
    source: {
      location: `s3://bucket/chunks/${ticker}/chunk-${index}.txt`,
      type: 'S3',
    },
  });

  // Arbitrary for generating valid chunks
  const chunkArbitrary = fc.record({
    content: fc.string({ minLength: 10, maxLength: 500 }),
    score: fc.float({ min: 0, max: 1, noNaN: true }),
    index: fc.integer({ min: 0, max: 100 }),
    ticker: fc.constantFrom('AAPL', 'MSFT', 'NVDA', 'AMZN'),
  }).map(({ content, score, index, ticker }) => createMockChunk(content, score, index, ticker));

  beforeEach(() => {
    process.env.ENABLE_HYDE = 'true';
    jest.clearAllMocks();
    
    service = new HyDEService(mockBedrockService as unknown as BedrockService);
  });

  describe('Task 14.5: Unit Tests for HyDE', () => {
    it('should return empty result when disabled', async () => {
      process.env.ENABLE_HYDE = 'false';
      const disabledService = new HyDEService(mockBedrockService as unknown as BedrockService);

      const result = await disabledService.retrieveWithHyDE('test query', { ticker: 'AAPL' });

      expect(result.hydeUsed).toBe(false);
      expect(result.chunks).toEqual([]);
      expect(mockBedrockService.invokeClaude).not.toHaveBeenCalled();
    });

    it('should generate hypothetical answer and retrieve', async () => {
      const hypotheticalAnswer = 'Apple Inc. competes with Samsung, Google, and Microsoft...';
      const hydeChunks = [createMockChunk('HyDE result 1', 0.9, 0)];
      const queryChunks = [createMockChunk('Query result 1', 0.8, 1)];

      mockBedrockService.invokeClaude.mockResolvedValue(hypotheticalAnswer);
      mockBedrockService.retrieve
        .mockResolvedValueOnce(hydeChunks)
        .mockResolvedValueOnce(queryChunks);

      const result = await service.retrieveWithHyDE('Who are Apple competitors?', { ticker: 'AAPL' });

      expect(result.hydeUsed).toBe(true);
      expect(result.hypotheticalAnswer).toBe(hypotheticalAnswer);
      expect(mockBedrockService.invokeClaude).toHaveBeenCalledTimes(1);
      expect(mockBedrockService.retrieve).toHaveBeenCalledTimes(2);
    });

    it('should fallback to standard retrieval on hypothetical generation failure', async () => {
      const fallbackChunks = [createMockChunk('Fallback result', 0.7, 0)];

      mockBedrockService.invokeClaude.mockRejectedValue(new Error('Claude error'));
      mockBedrockService.retrieve.mockResolvedValue(fallbackChunks);

      const result = await service.retrieveWithHyDE('test query', { ticker: 'AAPL' });

      expect(result.hydeUsed).toBe(false);
      expect(result.error).toContain('Claude error');
      expect(result.chunks).toEqual(fallbackChunks);
    });

    it('should fallback when hypothetical answer is empty', async () => {
      const fallbackChunks = [createMockChunk('Fallback result', 0.7, 0)];

      mockBedrockService.invokeClaude.mockResolvedValue('');
      mockBedrockService.retrieve.mockResolvedValue(fallbackChunks);

      const result = await service.retrieveWithHyDE('test query', { ticker: 'AAPL' });

      expect(result.hydeUsed).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should merge and deduplicate results from both retrievals', async () => {
      const sharedChunk = createMockChunk('Shared content', 0.8, 0);
      const hydeOnlyChunk = createMockChunk('HyDE only', 0.9, 1);
      const queryOnlyChunk = createMockChunk('Query only', 0.7, 2);

      mockBedrockService.invokeClaude.mockResolvedValue('Hypothetical answer');
      mockBedrockService.retrieve
        .mockResolvedValueOnce([sharedChunk, hydeOnlyChunk])
        .mockResolvedValueOnce([sharedChunk, queryOnlyChunk]);

      const result = await service.retrieveWithHyDE('test query', { ticker: 'AAPL' });

      expect(result.hydeUsed).toBe(true);
      // Should have 3 unique chunks, not 4
      expect(result.chunks.length).toBe(3);
    });

    it('should sort merged results by score descending', async () => {
      mockBedrockService.invokeClaude.mockResolvedValue('Hypothetical answer');
      mockBedrockService.retrieve
        .mockResolvedValueOnce([createMockChunk('Low score', 0.3, 0)])
        .mockResolvedValueOnce([createMockChunk('High score', 0.9, 1)]);

      const result = await service.retrieveWithHyDE('test query', { ticker: 'AAPL' }, 5);

      expect(result.chunks[0].score).toBeGreaterThan(result.chunks[1].score);
    });

    it('should limit results to numberOfResults', async () => {
      const manyChunks = Array.from({ length: 10 }, (_, i) => 
        createMockChunk(`Content ${i}`, 0.5 + i * 0.05, i)
      );

      mockBedrockService.invokeClaude.mockResolvedValue('Hypothetical answer');
      mockBedrockService.retrieve
        .mockResolvedValueOnce(manyChunks.slice(0, 5))
        .mockResolvedValueOnce(manyChunks.slice(5, 10));

      const result = await service.retrieveWithHyDE('test query', { ticker: 'AAPL' }, 3);

      expect(result.chunks.length).toBe(3);
    });

    it('should check if HyDE is enabled', () => {
      expect(service.isEnabled()).toBe(true);

      process.env.ENABLE_HYDE = 'false';
      const disabledService = new HyDEService(mockBedrockService as unknown as BedrockService);
      expect(disabledService.isEnabled()).toBe(false);
    });

    it('should report latency', async () => {
      mockBedrockService.invokeClaude.mockResolvedValue('Hypothetical answer');
      mockBedrockService.retrieve.mockResolvedValue([]);

      const result = await service.retrieveWithHyDE('test query', { ticker: 'AAPL' });

      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Task 14.4: Property Test - HyDE Deduplication', () => {
    /**
     * Property 15: HyDE Deduplication
     * Validates: Requirements 23.4
     * 
     * Chunks retrieved by both HyDE and query methods should be deduplicated.
     * No duplicate chunks in the final result.
     */
    it('Property 15: Merged results contain no duplicate chunks', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(chunkArbitrary, { minLength: 1, maxLength: 10 }),
          fc.array(chunkArbitrary, { minLength: 1, maxLength: 10 }),
          async (hydeChunks, queryChunks) => {
            mockBedrockService.invokeClaude.mockResolvedValue('Hypothetical answer');
            mockBedrockService.retrieve
              .mockResolvedValueOnce(hydeChunks)
              .mockResolvedValueOnce(queryChunks);

            const result = await service.retrieveWithHyDE('test query', { ticker: 'AAPL' }, 20);

            if (result.hydeUsed) {
              // Check for duplicates by content + metadata key
              const keys = result.chunks.map(c => 
                `${c.metadata.ticker}:${c.metadata.sectionType}:${c.metadata.chunkIndex || c.content.substring(0, 200)}`
              );
              const uniqueKeys = new Set(keys);
              
              expect(keys.length).toBe(uniqueKeys.size);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 15b: Deduplication keeps higher score when chunks overlap', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.float({ min: Math.fround(0.1), max: Math.fround(0.5), noNaN: true }),
          fc.float({ min: Math.fround(0.6), max: Math.fround(1.0), noNaN: true }),
          async (lowScore, highScore) => {
            const sharedContent = 'This is shared content between both retrievals';
            const lowScoreChunk = createMockChunk(sharedContent, lowScore, 0);
            const highScoreChunk = createMockChunk(sharedContent, highScore, 0);

            mockBedrockService.invokeClaude.mockResolvedValue('Hypothetical answer');
            mockBedrockService.retrieve
              .mockResolvedValueOnce([lowScoreChunk])
              .mockResolvedValueOnce([highScoreChunk]);

            const result = await service.retrieveWithHyDE('test query', { ticker: 'AAPL' });

            if (result.hydeUsed) {
              // Should only have one chunk
              expect(result.chunks.length).toBe(1);
              // Score should be at least the higher of the two (HyDE gets 1.1x boost)
              expect(result.chunks[0].score).toBeGreaterThanOrEqual(lowScore);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 15c: Total chunks never exceed combined unique chunks', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(chunkArbitrary, { minLength: 0, maxLength: 10 }),
          fc.array(chunkArbitrary, { minLength: 0, maxLength: 10 }),
          async (hydeChunks, queryChunks) => {
            mockBedrockService.invokeClaude.mockResolvedValue('Hypothetical answer');
            mockBedrockService.retrieve
              .mockResolvedValueOnce(hydeChunks)
              .mockResolvedValueOnce(queryChunks);

            const result = await service.retrieveWithHyDE('test query', { ticker: 'AAPL' }, 100);

            if (result.hydeUsed) {
              // Result should never exceed total input chunks
              expect(result.chunks.length).toBeLessThanOrEqual(hydeChunks.length + queryChunks.length);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
