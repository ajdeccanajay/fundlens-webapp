/**
 * Reranker Service Unit Tests
 * 
 * Phase 3: Task 13.3, 13.4, 13.5
 * Tests reranking score improvement, fallback safety, and basic functionality
 * 
 * Feature: rag-competitive-intelligence-extraction
 * Requirements: 5A.1, 5A.2, 5A.3, 5A.4, 5A.5
 */

import * as fc from 'fast-check';
import { RerankerService, RerankResult } from '../../src/rag/reranker.service';
import { ChunkResult } from '../../src/rag/bedrock.service';

// Mock the AWS SDK
jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  RerankCommand: jest.fn(),
}));

describe('RerankerService', () => {
  let service: RerankerService;
  let mockClient: any;

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

  beforeEach(() => {
    // Reset environment
    process.env.ENABLE_RERANKING = 'true';
    process.env.AWS_REGION = 'us-east-1';
    
    // Create service
    service = new RerankerService();
    mockClient = (service as any).client;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Task 13.5: Unit Tests for Reranking', () => {
    it('should return original chunks when disabled', async () => {
      process.env.ENABLE_RERANKING = 'false';
      const disabledService = new RerankerService();
      
      const chunks = [
        createMockChunk('Content A', 0.8, 0),
        createMockChunk('Content B', 0.6, 1),
      ];

      const result = await disabledService.rerank('test query', chunks);

      expect(result.reranked).toBe(false);
      expect(result.chunks).toEqual(chunks);
      expect(result.error).toBeUndefined();
    });

    it('should return empty array for empty input', async () => {
      const result = await service.rerank('test query', []);

      expect(result.reranked).toBe(false);
      expect(result.chunks).toEqual([]);
    });

    it('should skip reranking for single chunk', async () => {
      const chunks = [createMockChunk('Single content', 0.9, 0)];

      const result = await service.rerank('test query', chunks);

      expect(result.reranked).toBe(false);
      expect(result.chunks).toEqual(chunks);
    });

    it('should handle reranking API errors gracefully', async () => {
      mockClient.send = jest.fn().mockRejectedValue(new Error('API Error'));

      const chunks = [
        createMockChunk('Content A', 0.8, 0),
        createMockChunk('Content B', 0.6, 1),
      ];

      const result = await service.rerank('test query', chunks);

      // Should fallback to original chunks
      expect(result.reranked).toBe(false);
      expect(result.chunks).toEqual(chunks);
      expect(result.error).toBe('API Error');
    });

    it('should sort reranked chunks by score descending', async () => {
      // Mock successful reranking response
      mockClient.send = jest.fn().mockResolvedValue({
        results: [
          { index: 0, relevanceScore: 0.3 },
          { index: 1, relevanceScore: 0.9 },
          { index: 2, relevanceScore: 0.6 },
        ],
      });

      const chunks = [
        createMockChunk('Content A', 0.5, 0),
        createMockChunk('Content B', 0.5, 1),
        createMockChunk('Content C', 0.5, 2),
      ];

      const result = await service.rerank('test query', chunks);

      expect(result.reranked).toBe(true);
      // Should be sorted: B (0.9), C (0.6), A (0.3)
      expect(result.chunks[0].score).toBe(0.9);
      expect(result.chunks[1].score).toBe(0.6);
      expect(result.chunks[2].score).toBe(0.3);
    });

    it('should respect topN parameter', async () => {
      mockClient.send = jest.fn().mockResolvedValue({
        results: [
          { index: 1, relevanceScore: 0.9 },
          { index: 0, relevanceScore: 0.7 },
        ],
      });

      const chunks = [
        createMockChunk('Content A', 0.5, 0),
        createMockChunk('Content B', 0.5, 1),
        createMockChunk('Content C', 0.5, 2),
      ];

      const result = await service.rerank('test query', chunks, 2);

      expect(result.chunks.length).toBe(2);
    });

    it('should report correct latency', async () => {
      mockClient.send = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({
          results: [
            { index: 0, relevanceScore: 0.8 },
            { index: 1, relevanceScore: 0.6 },
          ],
        }), 50))
      );

      const chunks = [
        createMockChunk('Content A', 0.5, 0),
        createMockChunk('Content B', 0.5, 1),
      ];

      const result = await service.rerank('test query', chunks);

      expect(result.latencyMs).toBeGreaterThanOrEqual(50);
    });

    it('should check if reranking is enabled', () => {
      expect(service.isEnabled()).toBe(true);
      
      process.env.ENABLE_RERANKING = 'false';
      const disabledService = new RerankerService();
      expect(disabledService.isEnabled()).toBe(false);
    });

    it('should return model info', () => {
      const info = service.getModelInfo();
      
      expect(info.enabled).toBe(true);
      expect(info.modelArn).toContain('cohere.rerank');
    });
  });

  describe('Task 13.3: Property Test - Reranking Score Improvement', () => {
    /**
     * Property 12: Reranking Score Improvement
     * Validates: Requirements 5A.1, 5A.2
     * 
     * After reranking, the output should be sorted by score descending.
     * Top-ranked chunks should have higher or equal scores than lower-ranked chunks.
     */
    it('Property 12: Output is always sorted by score descending', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(chunkArbitrary, { minLength: 2, maxLength: 10 }),
          fc.array(fc.float({ min: 0, max: 1, noNaN: true }), { minLength: 2, maxLength: 10 }),
          async (chunks, newScores) => {
            // Ensure we have matching scores for chunks
            const scoresToUse = newScores.slice(0, chunks.length);
            while (scoresToUse.length < chunks.length) {
              scoresToUse.push(Math.random());
            }

            // Mock reranking response
            mockClient.send = jest.fn().mockResolvedValue({
              results: chunks.map((_, i) => ({
                index: i,
                relevanceScore: scoresToUse[i],
              })),
            });

            const result = await service.rerank('test query', chunks);

            if (result.reranked) {
              // Verify sorted descending
              for (let i = 1; i < result.chunks.length; i++) {
                expect(result.chunks[i - 1].score).toBeGreaterThanOrEqual(result.chunks[i].score);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 12b: Reranked output contains same chunks as input', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(chunkArbitrary, { minLength: 2, maxLength: 10 }),
          async (chunks) => {
            // Mock reranking response
            mockClient.send = jest.fn().mockResolvedValue({
              results: chunks.map((_, i) => ({
                index: i,
                relevanceScore: Math.random(),
              })),
            });

            const result = await service.rerank('test query', chunks);

            if (result.reranked) {
              // Same number of chunks
              expect(result.chunks.length).toBe(chunks.length);
              
              // All original content preserved
              const originalContents = new Set(chunks.map(c => c.content));
              const resultContents = new Set(result.chunks.map(c => c.content));
              expect(resultContents).toEqual(originalContents);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Task 13.4: Property Test - Reranking Fallback Safety', () => {
    /**
     * Property 13: Reranking Fallback Safety
     * Validates: Requirements 5A.3
     * 
     * When reranking fails, original chunks should be preserved unchanged.
     */
    it('Property 13: Fallback preserves original chunks exactly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(chunkArbitrary, { minLength: 2, maxLength: 10 }), // Need at least 2 chunks to trigger reranking
          fc.string({ minLength: 5, maxLength: 100 }).filter(s => s.trim().length > 0), // non-empty error message
          async (chunks, errorMessage) => {
            // Mock API failure
            mockClient.send = jest.fn().mockRejectedValue(new Error(errorMessage));

            const result = await service.rerank('test query', chunks);

            // Should not be reranked
            expect(result.reranked).toBe(false);
            
            // Original chunks preserved exactly
            expect(result.chunks).toEqual(chunks);
            
            // Error should be recorded
            expect(result.error).toBe(errorMessage);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 13b: Fallback on empty API response preserves chunks', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(chunkArbitrary, { minLength: 2, maxLength: 10 }),
          async (chunks) => {
            // Mock empty response
            mockClient.send = jest.fn().mockResolvedValue({ results: [] });

            const result = await service.rerank('test query', chunks);

            // Should fallback
            expect(result.reranked).toBe(false);
            expect(result.chunks).toEqual(chunks);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 13c: Disabled service always returns original chunks', async () => {
      process.env.ENABLE_RERANKING = 'false';
      const disabledService = new RerankerService();

      await fc.assert(
        fc.asyncProperty(
          fc.array(chunkArbitrary, { minLength: 0, maxLength: 10 }),
          async (chunks) => {
            const result = await disabledService.rerank('any query', chunks);

            expect(result.reranked).toBe(false);
            expect(result.chunks).toEqual(chunks);
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
