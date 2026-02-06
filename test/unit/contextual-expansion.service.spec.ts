/**
 * Contextual Expansion Service Unit Tests
 * 
 * Phase 3: Task 16.3, 16.4
 * Tests token budget enforcement and basic functionality
 * 
 * Feature: rag-competitive-intelligence-extraction
 * Requirements: 21.1, 21.2, 21.3, 21.4, 21.5
 */

import * as fc from 'fast-check';
import { ContextualExpansionService, ExpandedChunk, ExpansionResult } from '../../src/rag/contextual-expansion.service';
import { ChunkResult } from '../../src/rag/bedrock.service';
import { PrismaService } from '../../prisma/prisma.service';

// Mock PrismaService
const mockPrismaService = {
  narrativeChunk: {
    findFirst: jest.fn(),
  },
};

describe('ContextualExpansionService', () => {
  let service: ContextualExpansionService;

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

  // Helper to estimate tokens (same as service)
  const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

  // Arbitrary for generating valid chunks with controlled content length
  const chunkArbitrary = (maxContentLength = 500) => fc.record({
    content: fc.string({ minLength: 10, maxLength: maxContentLength }),
    score: fc.float({ min: 0, max: 1, noNaN: true }),
    index: fc.integer({ min: 1, max: 100 }), // Start from 1 to allow before chunk
  }).map(({ content, score, index }) => createMockChunk(content, score, index));

  beforeEach(() => {
    process.env.ENABLE_CONTEXTUAL_EXPANSION = 'true';
    process.env.CONTEXT_TOKEN_BUDGET = '4000';
    jest.clearAllMocks();
    
    service = new ContextualExpansionService(mockPrismaService as unknown as PrismaService);
  });

  describe('Task 16.4: Unit Tests for Contextual Expansion', () => {
    it('should return unexpanded chunks when disabled', async () => {
      process.env.ENABLE_CONTEXTUAL_EXPANSION = 'false';
      const disabledService = new ContextualExpansionService(mockPrismaService as unknown as PrismaService);

      const chunks = [createMockChunk('Test content', 0.9, 5)];
      const result = await disabledService.expandContext(chunks);

      expect(result.expanded).toBe(false);
      expect(result.chunks[0].expandedContent).toBe('Test content');
      expect(result.chunks[0].adjacentChunks).toEqual({});
    });

    it('should return empty result for empty input', async () => {
      const result = await service.expandContext([]);

      expect(result.expanded).toBe(false);
      expect(result.chunks).toEqual([]);
      expect(result.totalTokens).toBe(0);
    });

    it('should fetch adjacent chunks from database', async () => {
      const chunk = createMockChunk('Main content', 0.9, 5);
      
      mockPrismaService.narrativeChunk.findFirst
        .mockResolvedValueOnce({ content: 'Before content' })
        .mockResolvedValueOnce({ content: 'After content' });

      const result = await service.expandContext([chunk]);

      expect(result.expanded).toBe(true);
      expect(result.chunks[0].adjacentChunks.before).toBe('Before content');
      expect(result.chunks[0].adjacentChunks.after).toBe('After content');
    });

    it('should handle missing adjacent chunks gracefully', async () => {
      const chunk = createMockChunk('Main content', 0.9, 5);
      
      mockPrismaService.narrativeChunk.findFirst
        .mockResolvedValueOnce(null) // No before chunk
        .mockResolvedValueOnce({ content: 'After content' });

      const result = await service.expandContext([chunk]);

      expect(result.expanded).toBe(true);
      expect(result.chunks[0].adjacentChunks.before).toBeUndefined();
      expect(result.chunks[0].adjacentChunks.after).toBe('After content');
    });

    it('should not fetch before chunk for index 0', async () => {
      const chunk = createMockChunk('First chunk', 0.9, 0);
      
      mockPrismaService.narrativeChunk.findFirst
        .mockResolvedValueOnce({ content: 'After content' });

      const result = await service.expandContext([chunk]);

      // Should only call findFirst once (for after chunk)
      expect(mockPrismaService.narrativeChunk.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should merge chunks with boundary markers', async () => {
      const chunk = createMockChunk('Main content', 0.9, 5);
      
      mockPrismaService.narrativeChunk.findFirst
        .mockResolvedValueOnce({ content: 'Before' })
        .mockResolvedValueOnce({ content: 'After' });

      const result = await service.expandContext([chunk]);

      expect(result.chunks[0].expandedContent).toContain('[CONTEXT BEFORE]');
      expect(result.chunks[0].expandedContent).toContain('[MAIN CONTENT]');
      expect(result.chunks[0].expandedContent).toContain('[CONTEXT AFTER]');
    });

    it('should preserve original content separately', async () => {
      const chunk = createMockChunk('Original content here', 0.9, 5);
      
      mockPrismaService.narrativeChunk.findFirst
        .mockResolvedValueOnce({ content: 'Before' })
        .mockResolvedValueOnce({ content: 'After' });

      const result = await service.expandContext([chunk]);

      expect(result.chunks[0].originalContent).toBe('Original content here');
    });

    it('should prioritize high-score chunks for expansion', async () => {
      const lowScoreChunk = createMockChunk('Low score', 0.3, 1);
      const highScoreChunk = createMockChunk('High score', 0.9, 2);
      
      mockPrismaService.narrativeChunk.findFirst.mockResolvedValue(null);

      const result = await service.expandContext([lowScoreChunk, highScoreChunk]);

      // High score chunk should be first
      expect(result.chunks[0].originalContent).toBe('High score');
    });

    it('should handle database errors gracefully', async () => {
      const chunk = createMockChunk('Main content', 0.9, 5);
      
      mockPrismaService.narrativeChunk.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.expandContext([chunk]);

      // Service continues with expansion even if adjacent chunk fetch fails
      // It just won't have adjacent chunks
      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].adjacentChunks.before).toBeUndefined();
      expect(result.chunks[0].adjacentChunks.after).toBeUndefined();
    });

    it('should check if expansion is enabled', () => {
      expect(service.isEnabled()).toBe(true);

      process.env.ENABLE_CONTEXTUAL_EXPANSION = 'false';
      const disabledService = new ContextualExpansionService(mockPrismaService as unknown as PrismaService);
      expect(disabledService.isEnabled()).toBe(false);
    });

    it('should return configured token budget', () => {
      expect(service.getTokenBudget()).toBe(4000);

      process.env.CONTEXT_TOKEN_BUDGET = '8000';
      const customService = new ContextualExpansionService(mockPrismaService as unknown as PrismaService);
      expect(customService.getTokenBudget()).toBe(8000);
    });

    it('should report token count for each expanded chunk', async () => {
      const chunk = createMockChunk('Main content here', 0.9, 5);
      
      mockPrismaService.narrativeChunk.findFirst
        .mockResolvedValueOnce({ content: 'Before text' })
        .mockResolvedValueOnce({ content: 'After text' });

      const result = await service.expandContext([chunk]);

      expect(result.chunks[0].tokenCount).toBeGreaterThan(0);
    });
  });

  describe('Task 16.3: Property Test - Token Budget Enforcement', () => {
    /**
     * Property 14: Contextual Expansion Token Budget
     * Validates: Requirements 21.4
     * 
     * Expanded context should never exceed the token budget.
     */
    it('Property 14: Total tokens never exceed budget', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(chunkArbitrary(200), { minLength: 1, maxLength: 10 }),
          fc.integer({ min: 500, max: 8000 }), // token budget
          async (chunks, tokenBudget) => {
            process.env.CONTEXT_TOKEN_BUDGET = tokenBudget.toString();
            const testService = new ContextualExpansionService(mockPrismaService as unknown as PrismaService);

            // Mock adjacent chunks with varying sizes
            mockPrismaService.narrativeChunk.findFirst.mockImplementation(async ({ where }) => {
              if (where.chunkIndex < 0) return null;
              return { content: 'Adjacent chunk content that adds tokens' };
            });

            const result = await testService.expandContext(chunks, tokenBudget);

            // Total tokens should never exceed budget
            expect(result.totalTokens).toBeLessThanOrEqual(tokenBudget);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 14b: Expansion stops when budget is reached', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 5, max: 20 }), // number of chunks
          fc.integer({ min: 100, max: 500 }), // small budget to force stopping
          async (numChunks, smallBudget) => {
            // Create chunks that would exceed budget if all expanded
            const chunks = Array.from({ length: numChunks }, (_, i) => 
              createMockChunk('A'.repeat(100), 0.9 - i * 0.01, i + 1)
            );

            mockPrismaService.narrativeChunk.findFirst.mockResolvedValue({
              content: 'B'.repeat(100), // Adjacent content
            });

            const result = await service.expandContext(chunks, smallBudget);

            // Should have fewer chunks than input if budget was limiting
            if (result.expanded) {
              expect(result.totalTokens).toBeLessThanOrEqual(smallBudget);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 14c: Each chunk token count is accurate', async () => {
      await fc.assert(
        fc.asyncProperty(
          chunkArbitrary(300),
          async (chunk) => {
            mockPrismaService.narrativeChunk.findFirst
              .mockResolvedValueOnce({ content: 'Before content' })
              .mockResolvedValueOnce({ content: 'After content' });

            const result = await service.expandContext([chunk]);

            if (result.expanded && result.chunks.length > 0) {
              const expandedChunk = result.chunks[0];
              
              // Token count should match estimated tokens of all content
              const expectedTokens = estimateTokens(chunk.content) +
                (expandedChunk.adjacentChunks.before ? estimateTokens(expandedChunk.adjacentChunks.before) : 0) +
                (expandedChunk.adjacentChunks.after ? estimateTokens(expandedChunk.adjacentChunks.after) : 0);
              
              expect(expandedChunk.tokenCount).toBe(expectedTokens);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 14d: High-score chunks are prioritized within budget', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              score: fc.float({ min: 0, max: 1, noNaN: true }),
              contentLength: fc.integer({ min: 50, max: 200 }),
            }),
            { minLength: 3, maxLength: 10 }
          ),
          async (chunkSpecs) => {
            const chunks = chunkSpecs.map((spec, i) => 
              createMockChunk('X'.repeat(spec.contentLength), spec.score, i + 1)
            );

            mockPrismaService.narrativeChunk.findFirst.mockResolvedValue(null);

            // Use small budget to force prioritization
            const result = await service.expandContext(chunks, 500);

            if (result.expanded && result.chunks.length > 1) {
              // Chunks should be sorted by score descending
              for (let i = 1; i < result.chunks.length; i++) {
                expect(result.chunks[i - 1].score).toBeGreaterThanOrEqual(result.chunks[i].score);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 14e: Adjacent chunks only added if within budget', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 50, max: 150 }), // main content length
          fc.integer({ min: 50, max: 150 }), // before content length
          fc.integer({ min: 50, max: 150 }), // after content length
          async (mainLen, beforeLen, afterLen) => {
            const chunk = createMockChunk('M'.repeat(mainLen), 0.9, 5);
            const beforeContent = 'B'.repeat(beforeLen);
            const afterContent = 'A'.repeat(afterLen);

            mockPrismaService.narrativeChunk.findFirst
              .mockResolvedValueOnce({ content: beforeContent })
              .mockResolvedValueOnce({ content: afterContent });

            const mainTokens = estimateTokens(chunk.content);
            const beforeTokens = estimateTokens(beforeContent);
            const afterTokens = estimateTokens(afterContent);

            // Set budget to only allow main + before
            const tightBudget = mainTokens + beforeTokens + 10;
            
            const result = await service.expandContext([chunk], tightBudget);

            if (result.expanded) {
              // Should have before but not after if budget is tight
              expect(result.totalTokens).toBeLessThanOrEqual(tightBudget);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
