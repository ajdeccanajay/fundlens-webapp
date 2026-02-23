/**
 * Property-Based Tests for Intent Comparison Flag Propagation (Properties 6, 7)
 *
 * Feature: research-response-formatting-fix, Property 6: LLM needsComparison flag propagation
 * Feature: research-response-formatting-fix, Property 7: Context ticker merging
 *
 * **Validates: Requirements 1.1, 1.4, 4.5**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { LlmClassificationResult } from '../../src/rag/intent-detection/llm-detection-engine';

describe('Property Tests - Intent Comparison Flag Propagation (Properties 6, 7)', () => {
  let service: IntentDetectorService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentDetectorService,
        { provide: BedrockService, useValue: {} },
        {
          provide: IntentAnalyticsService,
          useValue: { logDetection: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: MetricRegistryService,
          useValue: {
            resolve: jest.fn().mockReturnValue(null),
            resolveMultiple: jest.fn().mockReturnValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);
  });

  // --- Generators ---

  /** Generate a random uppercase ticker (1-5 letters) */
  const tickerArb = fc.stringMatching(/^[A-Z]{1,5}$/).filter(s => s.length >= 1);

  /** Generate a query type */
  const queryTypeArb = fc.constantFrom(
    'structured' as const,
    'semantic' as const,
    'hybrid' as const,
  );

  /** Generate a confidence score between 0 and 1 */
  const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

  /** Generate a base LlmClassificationResult with configurable tickers and needsComparison */
  const baseLlmResultArb = (
    tickers: fc.Arbitrary<string[]>,
    needsComparison: fc.Arbitrary<boolean>,
  ): fc.Arbitrary<LlmClassificationResult> =>
    fc.record({
      tickers,
      rawMetricPhrases: fc.constant([]),
      queryType: queryTypeArb,
      needsNarrative: fc.boolean(),
      needsComparison,
      needsComputation: fc.boolean(),
      needsTrend: fc.boolean(),
      needsPeerComparison: fc.boolean(),
      needsClarification: fc.constant(false),
      confidence: confidenceArb,
    }) as fc.Arbitrary<LlmClassificationResult>;

  /** Generate a simple query string */
  const queryArb = fc.stringMatching(/^[A-Za-z0-9 ]{3,40}$/).filter(s => s.trim().length > 0);


  // =====================================================================
  // Property 6: LLM needsComparison flag propagation
  // =====================================================================
  describe('Feature: research-response-formatting-fix, Property 6: LLM needsComparison flag propagation', () => {
    /**
     * **Validates: Requirements 4.5**
     *
     * For any LlmClassificationResult where needsComparison is true OR
     * tickers.length > 1, the QueryIntent produced by resolveFromLlmResult()
     * SHALL have needsComparison === true.
     */

    it('needsComparison=true in LLM result propagates to QueryIntent', async () => {
      const llmResultArb = baseLlmResultArb(
        fc.array(tickerArb, { minLength: 0, maxLength: 5 }),
        fc.constant(true), // needsComparison always true
      );

      await fc.assert(
        fc.asyncProperty(llmResultArb, queryArb, async (llmResult, query) => {
          const intent = await service.resolveFromLlmResult(llmResult, query);
          expect(intent.needsComparison).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('multiple tickers (length > 1) forces needsComparison=true in QueryIntent', async () => {
      const multiTickerArb = fc.array(tickerArb, { minLength: 2, maxLength: 5 })
        .filter(arr => new Set(arr).size === arr.length); // ensure unique tickers

      const llmResultArb = baseLlmResultArb(
        multiTickerArb,
        fc.boolean(), // needsComparison can be true or false
      );

      await fc.assert(
        fc.asyncProperty(llmResultArb, queryArb, async (llmResult, query) => {
          const intent = await service.resolveFromLlmResult(llmResult, query);
          expect(intent.needsComparison).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('single ticker with needsComparison=false produces needsComparison=false', async () => {
      const singleTickerArb = fc.tuple(tickerArb).map(([t]) => [t]);

      const llmResultArb = baseLlmResultArb(
        singleTickerArb,
        fc.constant(false),
      );

      await fc.assert(
        fc.asyncProperty(llmResultArb, queryArb, async (llmResult, query) => {
          const intent = await service.resolveFromLlmResult(llmResult, query);
          expect(intent.needsComparison).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it('either condition (needsComparison=true OR tickers>1) is sufficient', async () => {
      const llmResultArb = baseLlmResultArb(
        fc.array(tickerArb, { minLength: 0, maxLength: 5 }),
        fc.boolean(),
      );

      await fc.assert(
        fc.asyncProperty(llmResultArb, queryArb, async (llmResult, query) => {
          const intent = await service.resolveFromLlmResult(llmResult, query);

          // The code: needsComparison = tickers.length > 1 || llmResult.needsComparison
          // After context ticker merging, tickers may grow, so we check the merged set
          const mergedTickers = [...new Set(llmResult.tickers)];
          const shouldBeComparison = mergedTickers.length > 1 || llmResult.needsComparison;

          expect(intent.needsComparison).toBe(shouldBeComparison);
        }),
        { numRuns: 100 },
      );
    });
  });

  // =====================================================================
  // Property 7: Context ticker merging
  // =====================================================================
  describe('Feature: research-response-formatting-fix, Property 7: Context ticker merging', () => {
    /**
     * **Validates: Requirements 1.4**
     *
     * For any query with explicitly detected tickers and a contextTicker
     * that differs from all detected tickers, the merged ticker array in
     * the resulting QueryIntent SHALL contain both the contextTicker and
     * all detected tickers.
     */

    it('contextTicker is merged into the ticker array when it differs from detected tickers', async () => {
      // Generate a context ticker and detected tickers that are all different
      const distinctTickersArb = fc.tuple(
        tickerArb,
        fc.array(tickerArb, { minLength: 1, maxLength: 4 }),
      ).filter(([ctx, detected]) => {
        const ctxUpper = ctx.toUpperCase();
        return detected.every(t => t.toUpperCase() !== ctxUpper);
      });

      await fc.assert(
        fc.asyncProperty(
          distinctTickersArb,
          queryArb,
          fc.boolean(),
          async ([contextTicker, detectedTickers], query, needsComparison) => {
            const llmResult: LlmClassificationResult = {
              tickers: detectedTickers,
              rawMetricPhrases: [],
              queryType: 'structured',
              needsNarrative: false,
              needsComparison,
              needsComputation: false,
              needsTrend: false,
              needsPeerComparison: false,
              needsClarification: false,
              confidence: 0.9,
            };

            const intent = await service.resolveFromLlmResult(llmResult, query, contextTicker);

            // The merged ticker should contain the context ticker
            const tickerResult = intent.ticker;
            if (Array.isArray(tickerResult)) {
              expect(tickerResult).toContain(contextTicker.toUpperCase());
              // And all detected tickers
              for (const t of detectedTickers) {
                expect(tickerResult).toContain(t.toUpperCase());
              }
            } else if (typeof tickerResult === 'string') {
              // This can only happen if context + detected = 1 unique ticker total,
              // which our filter prevents, so this branch shouldn't be reached
              fail('Expected array ticker when contextTicker differs from detected tickers');
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('contextTicker is not duplicated when it matches a detected ticker', async () => {
      const tickerWithDuplicateArb = tickerArb.chain(ticker =>
        fc.tuple(
          fc.constant(ticker),
          fc.array(tickerArb, { minLength: 0, maxLength: 3 }).map(others => [ticker, ...others]),
        ),
      );

      await fc.assert(
        fc.asyncProperty(tickerWithDuplicateArb, queryArb, async ([contextTicker, detectedTickers], query) => {
          const llmResult: LlmClassificationResult = {
            tickers: detectedTickers,
            rawMetricPhrases: [],
            queryType: 'structured',
            needsNarrative: false,
            needsComparison: false,
            needsComputation: false,
            needsTrend: false,
            needsPeerComparison: false,
            needsClarification: false,
            confidence: 0.9,
          };

          const intent = await service.resolveFromLlmResult(llmResult, query, contextTicker);

          // The merged set should have no duplicates
          const tickerResult = intent.ticker;
          if (Array.isArray(tickerResult)) {
            const uniqueSet = new Set(tickerResult.map(t => t.toUpperCase()));
            expect(tickerResult.length).toBe(uniqueSet.size);
          }
          // If single string, no duplication possible
        }),
        { numRuns: 100 },
      );
    });

    it('without contextTicker, only detected tickers appear in the result', async () => {
      const llmResultArb = baseLlmResultArb(
        fc.array(tickerArb, { minLength: 1, maxLength: 5 }),
        fc.boolean(),
      );

      await fc.assert(
        fc.asyncProperty(llmResultArb, queryArb, async (llmResult, query) => {
          const intent = await service.resolveFromLlmResult(llmResult, query, undefined);

          const tickerResult = intent.ticker;
          if (Array.isArray(tickerResult)) {
            // All tickers should come from the LLM result
            const uniqueDetected = [...new Set(llmResult.tickers)];
            expect(tickerResult).toEqual(uniqueDetected);
          } else if (typeof tickerResult === 'string') {
            expect(llmResult.tickers).toContain(tickerResult);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('context ticker merging can trigger needsComparison when combined tickers > 1', async () => {
      // Single detected ticker + different context ticker = 2 tickers = needsComparison
      const distinctPairArb = fc.tuple(tickerArb, tickerArb)
        .filter(([ctx, detected]) => ctx.toUpperCase() !== detected.toUpperCase());

      await fc.assert(
        fc.asyncProperty(distinctPairArb, queryArb, async ([contextTicker, detectedTicker], query) => {
          const llmResult: LlmClassificationResult = {
            tickers: [detectedTicker],
            rawMetricPhrases: [],
            queryType: 'structured',
            needsNarrative: false,
            needsComparison: false, // LLM says no comparison
            needsComputation: false,
            needsTrend: false,
            needsPeerComparison: false,
            needsClarification: false,
            confidence: 0.9,
          };

          const intent = await service.resolveFromLlmResult(llmResult, query, contextTicker);

          // After merging, we have 2 tickers, so needsComparison should be true
          expect(intent.needsComparison).toBe(true);
          expect(Array.isArray(intent.ticker)).toBe(true);
          expect((intent.ticker as string[]).length).toBe(2);
        }),
        { numRuns: 100 },
      );
    });
  });
});
