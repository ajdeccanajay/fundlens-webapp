/**
 * Property-Based Tests for QueryDecomposerService
 *
 * Feature: rag-chatbot-master-engineering
 * Properties tested:
 * - Property 13: Single-intent fast-path
 * - Property 14: Decomposition invariants
 *
 * Tests the QueryDecomposerService decompose() and parseDecomposition() methods.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { QueryDecomposerService } from '../../src/rag/query-decomposer.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { QueryIntent } from '../../src/rag/types/query-intent';

describe('Property Tests - Query Decomposer', () => {
  let service: QueryDecomposerService;
  let mockBedrock: { invokeClaude: jest.Mock };

  beforeEach(async () => {
    mockBedrock = {
      invokeClaude: jest.fn().mockResolvedValue('{}'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryDecomposerService,
        { provide: BedrockService, useValue: mockBedrock },
      ],
    }).compile();

    service = module.get<QueryDecomposerService>(QueryDecomposerService);
  });

  // ── Generators ──────────────────────────────────────────────────────────

  const COMPOUND_MARKERS = ['additionally', 'as well as', 'also', 'and', 'both', 'plus'];

  /**
   * Generate a query string that does NOT contain any compound markers.
   * Uses simple financial query templates that avoid the marker words.
   */
  const queryWithoutCompoundMarkersArb: fc.Arbitrary<string> = fc
    .constantFrom(
      'What is the revenue for ABNB?',
      'Show me MSFT gross margin FY2024',
      'GOOGL operating income latest quarter',
      'Tell me about AAPL risk factors',
      'How much debt does NVDA have?',
      'TSLA free cash flow Q3FY2024',
      'Revenue growth for META',
      'What is AMZN net income?',
      'BKNG EBITDA margin FY2023',
      'Show NFLX subscriber count',
      'CRM revenue breakdown by segment',
      'UBER profitability metrics',
      'What does management say about margins?',
      'Explain the competitive landscape for SHOP',
      'LYFT cost structure FY2024',
      'SQ payment volume trends',
    );

  /**
   * Generate a QueryIntent that is NOT mixed (either purely structured or purely semantic).
   * isSingleIntent returns true when there are no compound markers OR no mixed intent.
   * For Property 13, we need BOTH: no compound markers AND no mixed intent.
   */
  const nonMixedIntentArb: fc.Arbitrary<QueryIntent> = fc
    .record({
      intentType: fc.constantFrom('structured' as const, 'semantic' as const),
      ticker: fc.constantFrom('ABNB', 'MSFT', 'GOOGL', 'AAPL', 'NVDA'),
      period: fc.constantFrom('FY2024', 'Q3FY2024', 'latest'),
    })
    .map(({ intentType, ticker, period }) => {
      if (intentType === 'structured') {
        return {
          type: 'structured',
          ticker,
          metrics: ['revenue'],
          period,
          needsNarrative: false,
          needsComparison: false,
          needsComputation: false,
          needsTrend: false,
          confidence: 0.95,
          originalQuery: 'test query',
        } as QueryIntent;
      }
      // semantic — no metrics, narrative only
      return {
        type: 'semantic',
        ticker,
        metrics: [],
        period,
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.90,
        originalQuery: 'test query',
      } as QueryIntent;
    });

  /**
   * Generate a sub-query count between 1 and 3 (valid range).
   */
  const subQueryCountArb = fc.integer({ min: 1, max: 3 });

  /**
   * Generate a non-empty sub-query string.
   */
  const subQueryTextArb = fc.constantFrom(
    'What is ABNB revenue for FY2024?',
    'What does ABNB management say about margin expansion?',
    'How does ABNB gross margin compare to peers?',
    'What are the key risk factors for MSFT?',
    'Show GOOGL operating income trend over 3 years',
    'What is META free cash flow FY2024?',
  );

  /**
   * Generate a non-empty unifying instruction string.
   */
  const unifyingInstructionArb = fc.constantFrom(
    'Combine quantitative data with qualitative analysis for a complete picture.',
    'Merge the financial metrics with management commentary to assess outlook.',
    'Integrate the structured data findings with narrative context.',
    'Synthesize the peer comparison data with company-specific analysis.',
  );

  /**
   * Generate a valid JSON response string that parseDecomposition would receive
   * from the LLM, containing 1-3 sub-queries and a non-empty unifyingInstruction.
   */
  const validDecompositionResponseArb: fc.Arbitrary<string> = fc
    .record({
      count: subQueryCountArb,
      instruction: unifyingInstructionArb,
    })
    .chain(({ count, instruction }) =>
      fc.tuple(
        ...Array.from({ length: count }, () => subQueryTextArb),
      ).map((subQueries) => JSON.stringify({
        subQueries,
        unifyingInstruction: instruction,
      })),
    );

  // ── Property 13: Single-intent fast-path ────────────────────────────

  describe('Feature: rag-chatbot-master-engineering, Property 13: Single-intent fast-path', () => {
    /**
     * **Validates: Requirements 12.1**
     *
     * For any query with no compound markers (and, also, as well as,
     * additionally, plus, both) AND no mixed intent types,
     * QueryDecomposerService.decompose() should return isDecomposed: false
     * without invoking the LLM.
     */

    it('returns isDecomposed: false for queries without compound markers and non-mixed intents', async () => {
      await fc.assert(
        fc.asyncProperty(
          queryWithoutCompoundMarkersArb,
          nonMixedIntentArb,
          async (query, intent) => {
            mockBedrock.invokeClaude.mockClear();

            const result = await service.decompose(query, intent);

            // Must not be decomposed
            expect(result.isDecomposed).toBe(false);
            expect(result.subQueries).toEqual([]);
            expect(result.originalQuery).toBe(query);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('does not invoke the LLM for single-intent queries', async () => {
      await fc.assert(
        fc.asyncProperty(
          queryWithoutCompoundMarkersArb,
          nonMixedIntentArb,
          async (query, intent) => {
            mockBedrock.invokeClaude.mockClear();

            await service.decompose(query, intent);

            // BedrockService should NOT be called
            expect(mockBedrock.invokeClaude).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('isSingleIntent returns true when query has no compound markers and intent is not mixed', () => {
      fc.assert(
        fc.property(
          queryWithoutCompoundMarkersArb,
          nonMixedIntentArb,
          (query, intent) => {
            const result = service.isSingleIntent(query, intent);
            expect(result).toBe(true);
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // ── Property 14: Decomposition invariants ───────────────────────────

  describe('Feature: rag-chatbot-master-engineering, Property 14: Decomposition invariants', () => {
    /**
     * **Validates: Requirements 12.3, 12.6**
     *
     * For any decomposed query result where isDecomposed === true,
     * the number of sub-queries should be between 1 and 3 inclusive,
     * and unifyingInstruction should be a non-empty string.
     */

    it('parseDecomposition produces 1-3 sub-queries and non-empty unifyingInstruction for valid JSON', () => {
      fc.assert(
        fc.property(
          validDecompositionResponseArb,
          fc.constantFrom(
            'What are ABNB margins and what drives them?',
            'Show MSFT revenue and explain growth factors',
            'GOOGL operating income plus management outlook',
          ),
          (response, query) => {
            const result = service.parseDecomposition(response, query);

            if (result.isDecomposed) {
              // Sub-query count must be between 1 and 3
              expect(result.subQueries.length).toBeGreaterThanOrEqual(1);
              expect(result.subQueries.length).toBeLessThanOrEqual(3);

              // Unifying instruction must be a non-empty string
              expect(typeof result.unifyingInstruction).toBe('string');
              expect(result.unifyingInstruction!.trim().length).toBeGreaterThan(0);

              // Original query preserved
              expect(result.originalQuery).toBe(query);
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('enforces max 3 sub-queries even when LLM returns more', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 4, max: 10 }),
          fc.constantFrom('Combine all results into a unified analysis.'),
          fc.constantFrom('Complex multi-part query about ABNB'),
          (count, instruction, query) => {
            const subQueries = Array.from(
              { length: count },
              (_, i) => `Sub-query ${i + 1} about ABNB revenue`,
            );
            const response = JSON.stringify({ subQueries, unifyingInstruction: instruction });

            const result = service.parseDecomposition(response, query);

            // Even with > 3 sub-queries from LLM, result is capped at 3
            expect(result.isDecomposed).toBe(true);
            expect(result.subQueries.length).toBeLessThanOrEqual(3);
            expect(result.subQueries.length).toBe(3);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('provides a default unifyingInstruction when LLM omits it', () => {
      fc.assert(
        fc.property(
          subQueryCountArb,
          fc.constantFrom('Multi-part query about ABNB'),
          (count, query) => {
            const subQueries = Array.from(
              { length: count },
              (_, i) => `Sub-query ${i + 1}`,
            );
            // No unifyingInstruction in the response
            const response = JSON.stringify({ subQueries });

            const result = service.parseDecomposition(response, query);

            if (result.isDecomposed) {
              // Should have a default non-empty unifying instruction
              expect(typeof result.unifyingInstruction).toBe('string');
              expect(result.unifyingInstruction!.trim().length).toBeGreaterThan(0);
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('decompose() returns valid invariants when LLM returns valid decomposition', async () => {
      await fc.assert(
        fc.asyncProperty(
          validDecompositionResponseArb,
          fc.constantFrom(
            'What are ABNB margins and what does management say about them?',
            'Show MSFT revenue growth and also explain risk factors',
            'GOOGL operating income plus competitive landscape analysis',
          ),
          async (llmResponse, query) => {
            // Set up a hybrid intent with compound markers to trigger LLM path
            const mixedIntent: QueryIntent = {
              type: 'hybrid',
              ticker: 'ABNB',
              metrics: ['revenue'],
              needsNarrative: true,
              needsComparison: false,
              needsComputation: false,
              needsTrend: false,
              confidence: 0.90,
              originalQuery: query,
            };

            mockBedrock.invokeClaude.mockResolvedValue(llmResponse);

            const result = await service.decompose(query, mixedIntent);

            if (result.isDecomposed) {
              // Invariant: 1-3 sub-queries
              expect(result.subQueries.length).toBeGreaterThanOrEqual(1);
              expect(result.subQueries.length).toBeLessThanOrEqual(3);

              // Invariant: non-empty unifying instruction
              expect(typeof result.unifyingInstruction).toBe('string');
              expect(result.unifyingInstruction!.trim().length).toBeGreaterThan(0);
            }

            // Original query always preserved
            expect(result.originalQuery).toBe(query);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('handles markdown-wrapped JSON responses correctly', () => {
      fc.assert(
        fc.property(
          validDecompositionResponseArb,
          fc.constantFrom('Complex query about ABNB'),
          (rawJson, query) => {
            // Wrap in markdown code block like LLMs sometimes do
            const wrappedResponse = '```json\n' + rawJson + '\n```';

            const result = service.parseDecomposition(wrappedResponse, query);

            if (result.isDecomposed) {
              expect(result.subQueries.length).toBeGreaterThanOrEqual(1);
              expect(result.subQueries.length).toBeLessThanOrEqual(3);
              expect(result.unifyingInstruction!.trim().length).toBeGreaterThan(0);
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
