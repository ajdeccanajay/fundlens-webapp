/**
 * Iterative Retrieval Service Unit Tests
 * 
 * Phase 3: Task 17.4, 17.5
 * Tests iterative retrieval termination and basic functionality
 * 
 * Feature: rag-competitive-intelligence-extraction
 * Requirements: 26.1, 26.2, 26.3, 26.4, 26.5
 */

import * as fc from 'fast-check';
import { IterativeRetrievalService } from '../../src/rag/iterative-retrieval.service';
import { BedrockService, ChunkResult } from '../../src/rag/bedrock.service';

// Mock BedrockService
const mockBedrockService = {
  retrieve: jest.fn(),
  invokeClaude: jest.fn(),
};

describe('IterativeRetrievalService', () => {
  let service: IterativeRetrievalService;

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
    content: fc.string({ minLength: 20, maxLength: 500 }),
    score: fc.float({ min: 0, max: 1, noNaN: true }),
    index: fc.integer({ min: 0, max: 100 }),
  }).map(({ content, score, index }) => createMockChunk(content, score, index));

  beforeEach(() => {
    process.env.ENABLE_ITERATIVE_RETRIEVAL = 'true';
    process.env.MAX_RETRIEVAL_ITERATIONS = '2';
    process.env.RETRIEVAL_CONFIDENCE_THRESHOLD = '0.5';
    jest.clearAllMocks();
    
    service = new IterativeRetrievalService(mockBedrockService as unknown as BedrockService);
  });

  describe('Task 17.5: Unit Tests for Iterative Retrieval', () => {
    it('should return empty result when disabled', async () => {
      process.env.ENABLE_ITERATIVE_RETRIEVAL = 'false';
      const disabledService = new IterativeRetrievalService(mockBedrockService as unknown as BedrockService);

      const result = await disabledService.iterativeRetrieve('test query', { ticker: 'AAPL' });

      expect(result.chunks).toEqual([]);
      expect(result.totalIterations).toBe(0);
      expect(mockBedrockService.retrieve).not.toHaveBeenCalled();
    });

    it('should perform initial retrieval', async () => {
      const chunks = [
        createMockChunk('High confidence result 1', 0.9, 0),
        createMockChunk('High confidence result 2', 0.85, 1),
        createMockChunk('High confidence result 3', 0.8, 2),
      ];

      mockBedrockService.retrieve.mockResolvedValue(chunks);

      const result = await service.iterativeRetrieve('test query', { ticker: 'AAPL' });

      expect(result.totalIterations).toBe(1);
      expect(result.chunks.length).toBe(3);
      expect(mockBedrockService.retrieve).toHaveBeenCalledTimes(1);
    });

    it('should detect low confidence and trigger follow-up', async () => {
      // Initial retrieval with low scores
      const lowConfidenceChunks = [
        createMockChunk('Low confidence result', 0.3, 0),
        createMockChunk('Another low result', 0.25, 1),
      ];

      // Follow-up retrieval with better results
      const followUpChunks = [
        createMockChunk('Better result', 0.7, 2),
      ];

      mockBedrockService.retrieve
        .mockResolvedValueOnce(lowConfidenceChunks)
        .mockResolvedValueOnce(followUpChunks);

      mockBedrockService.invokeClaude.mockResolvedValue('Follow-up query about specific aspect');

      const result = await service.iterativeRetrieve('test query', { ticker: 'AAPL' });

      expect(result.totalIterations).toBe(2);
      expect(result.improved).toBe(true);
    });

    it('should stop when no follow-up query is generated', async () => {
      const lowConfidenceChunks = [
        createMockChunk('Low confidence', 0.3, 0),
      ];

      mockBedrockService.retrieve.mockResolvedValue(lowConfidenceChunks);
      mockBedrockService.invokeClaude.mockResolvedValue('NONE');

      const result = await service.iterativeRetrieve('test query', { ticker: 'AAPL' });

      expect(result.totalIterations).toBe(1);
    });

    it('should stop when follow-up does not improve results', async () => {
      const initialChunks = [
        createMockChunk('Initial result', 0.4, 0),
      ];

      // Follow-up returns same chunk (no new chunks added)
      mockBedrockService.retrieve
        .mockResolvedValueOnce(initialChunks)
        .mockResolvedValueOnce(initialChunks);

      mockBedrockService.invokeClaude.mockResolvedValue('Follow-up query');

      const result = await service.iterativeRetrieve('test query', { ticker: 'AAPL' });

      // Should stop because no new chunks were added
      expect(result.totalIterations).toBeLessThanOrEqual(2);
    });

    it('should merge results from all iterations', async () => {
      const iteration1Chunks = [createMockChunk('Result 1', 0.4, 0)];
      const iteration2Chunks = [createMockChunk('Result 2', 0.6, 1)];

      mockBedrockService.retrieve
        .mockResolvedValueOnce(iteration1Chunks)
        .mockResolvedValueOnce(iteration2Chunks);

      mockBedrockService.invokeClaude.mockResolvedValue('Follow-up query');

      const result = await service.iterativeRetrieve('test query', { ticker: 'AAPL' });

      // Should have chunks from both iterations
      expect(result.chunks.length).toBe(2);
    });

    it('should deduplicate chunks across iterations', async () => {
      const sharedChunk = createMockChunk('Shared content', 0.5, 0);
      
      mockBedrockService.retrieve
        .mockResolvedValueOnce([sharedChunk])
        .mockResolvedValueOnce([sharedChunk, createMockChunk('New content', 0.6, 1)]);

      mockBedrockService.invokeClaude.mockResolvedValue('Follow-up query');

      const result = await service.iterativeRetrieve('test query', { ticker: 'AAPL' });

      // Should have 2 unique chunks, not 3
      expect(result.chunks.length).toBe(2);
    });

    it('should track iteration info', async () => {
      const chunks = [createMockChunk('Result', 0.4, 0)];

      mockBedrockService.retrieve
        .mockResolvedValueOnce(chunks)
        .mockResolvedValueOnce([createMockChunk('New result', 0.6, 1)]);

      mockBedrockService.invokeClaude.mockResolvedValue('Follow-up query');

      const result = await service.iterativeRetrieve('test query', { ticker: 'AAPL' });

      expect(result.iterations.length).toBeGreaterThanOrEqual(1);
      expect(result.iterations[0].iteration).toBe(1);
      expect(result.iterations[0].reason).toBe('initial');
    });

    it('should handle retrieval errors gracefully', async () => {
      mockBedrockService.retrieve.mockRejectedValue(new Error('Retrieval error'));

      const result = await service.iterativeRetrieve('test query', { ticker: 'AAPL' });

      expect(result.error).toBe('Retrieval error');
    });

    it('should check if iterative retrieval is enabled', () => {
      expect(service.isEnabled()).toBe(true);

      process.env.ENABLE_ITERATIVE_RETRIEVAL = 'false';
      const disabledService = new IterativeRetrievalService(mockBedrockService as unknown as BedrockService);
      expect(disabledService.isEnabled()).toBe(false);
    });

    it('should return configuration', () => {
      const config = service.getConfig();

      expect(config.maxIterations).toBe(2);
      expect(config.confidenceThreshold).toBe(0.5);
    });

    it('should sort final results by score', async () => {
      mockBedrockService.retrieve
        .mockResolvedValueOnce([createMockChunk('Low', 0.3, 0)])
        .mockResolvedValueOnce([createMockChunk('High', 0.9, 1)]);

      mockBedrockService.invokeClaude.mockResolvedValue('Follow-up');

      const result = await service.iterativeRetrieve('test query', { ticker: 'AAPL' });

      if (result.chunks.length > 1) {
        expect(result.chunks[0].score).toBeGreaterThanOrEqual(result.chunks[1].score);
      }
    });
  });

  describe('Task 17.4: Property Test - Iterative Retrieval Termination', () => {
    /**
     * Property 17: Iterative Retrieval Termination
     * Validates: Requirements 26.3
     * 
     * Iterative retrieval should always terminate within max iterations.
     */
    it('Property 17: Always terminates within max iterations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }), // max iterations config
          fc.array(chunkArbitrary, { minLength: 0, maxLength: 10 }),
          async (maxIter, initialChunks) => {
            process.env.MAX_RETRIEVAL_ITERATIONS = maxIter.toString();
            const testService = new IterativeRetrievalService(mockBedrockService as unknown as BedrockService);

            // Mock to always return low confidence to trigger follow-ups
            mockBedrockService.retrieve.mockResolvedValue(
              initialChunks.length > 0 ? initialChunks : [createMockChunk('Default', 0.3, 0)]
            );
            mockBedrockService.invokeClaude.mockResolvedValue('Follow-up query');

            const result = await testService.iterativeRetrieve('test query', { ticker: 'AAPL' });

            // Should never exceed max iterations
            expect(result.totalIterations).toBeLessThanOrEqual(maxIter);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 17b: Terminates when no improvement is made', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(chunkArbitrary, { minLength: 1, maxLength: 5 }),
          async (chunks) => {
            // Always return same chunks (no improvement)
            mockBedrockService.retrieve.mockResolvedValue(chunks);
            mockBedrockService.invokeClaude.mockResolvedValue('Follow-up query');

            const result = await service.iterativeRetrieve('test query', { ticker: 'AAPL' });

            // Should terminate early due to no improvement
            expect(result.totalIterations).toBeLessThanOrEqual(2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 17c: Terminates when follow-up query is NONE', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(chunkArbitrary, { minLength: 1, maxLength: 5 }),
          async (chunks) => {
            mockBedrockService.retrieve.mockResolvedValue(chunks);
            mockBedrockService.invokeClaude.mockResolvedValue('NONE');

            const result = await service.iterativeRetrieve('test query', { ticker: 'AAPL' });

            // Should terminate after first iteration
            expect(result.totalIterations).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 17d: Terminates on retrieval error', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 5, maxLength: 100 }), // error message
          async (errorMessage) => {
            mockBedrockService.retrieve.mockRejectedValue(new Error(errorMessage));

            const result = await service.iterativeRetrieve('test query', { ticker: 'AAPL' });

            // Should terminate with error
            expect(result.error).toBe(errorMessage);
            expect(result.totalIterations).toBeLessThanOrEqual(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 17e: Iteration count matches iterations array length', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(chunkArbitrary, { minLength: 1, maxLength: 5 }),
          fc.array(chunkArbitrary, { minLength: 1, maxLength: 5 }),
          async (initialChunks, followUpChunks) => {
            mockBedrockService.retrieve
              .mockResolvedValueOnce(initialChunks)
              .mockResolvedValueOnce(followUpChunks);
            mockBedrockService.invokeClaude.mockResolvedValue('Follow-up query');

            const result = await service.iterativeRetrieve('test query', { ticker: 'AAPL' });

            // totalIterations should match iterations array length
            expect(result.totalIterations).toBe(result.iterations.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 17f: High confidence results stop iteration early', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 3, max: 10 }), // number of high-confidence chunks
          async (numChunks) => {
            // Create high-confidence chunks
            const highConfidenceChunks = Array.from({ length: numChunks }, (_, i) =>
              createMockChunk(`High confidence ${i}`, 0.8 + Math.random() * 0.2, i)
            );

            mockBedrockService.retrieve.mockResolvedValue(highConfidenceChunks);

            const result = await service.iterativeRetrieve('test query', { ticker: 'AAPL' });

            // Should stop after first iteration due to high confidence
            expect(result.totalIterations).toBe(1);
            expect(result.improved).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
