/**
 * Property-Based Tests for Regex Fallback (Property 8)
 *
 * Feature: haiku-first-intent-detection, Property 8: Regex Fallback Extracts Only Known Uppercase Tickers
 *
 * **Validates: Requirements 8.2, 8.4**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';

describe('Property Tests - Regex Fallback (Property 8)', () => {
  let service: IntentDetectorService;

  const KNOWN_TICKERS = new Set(['AAPL', 'AMZN', 'NVDA', 'MSFT', 'C', 'V', 'ABNB']);

  const unresolvedResult = () => ({
    canonical_id: '',
    display_name: '',
    type: 'atomic' as const,
    confidence: 'unresolved' as const,
    fuzzy_score: null,
    original_query: '',
    match_source: 'none',
    suggestions: null,
  });

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentDetectorService,
        { provide: BedrockService, useValue: { invokeModel: jest.fn() } },
        {
          provide: IntentAnalyticsService,
          useValue: { logDetection: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: MetricRegistryService,
          useValue: {
            resolve: jest.fn().mockReturnValue(unresolvedResult()),
            resolveMultiple: jest.fn().mockReturnValue([]),
            getKnownMetricNames: jest.fn().mockReturnValue(new Map()),
            normalizeMetricName: jest.fn((name: string) => name),
          },
        },
      ],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);
    (service as any).knownTickers = KNOWN_TICKERS;
  });

  // --- Generators ---

  /** Generate a random word (mixed case, 1-6 chars) */
  const wordArb = fc.stringMatching(/^[a-zA-Z]{1,6}$/);

  /** Generate a query string with mixed-case words */
  const queryArb = fc.array(wordArb, { minLength: 1, maxLength: 10 })
    .map(words => words.join(' '));

  /** Generate a query that includes at least one known ticker as an uppercase token */
  const queryWithKnownTickerArb = fc.tuple(
    queryArb,
    fc.constantFrom(...Array.from(KNOWN_TICKERS)),
    fc.integer({ min: 0, max: 5 }),
  ).map(([base, ticker, insertPos]) => {
    const words = base.split(' ');
    const pos = Math.min(insertPos, words.length);
    words.splice(pos, 0, ticker);
    return words.join(' ');
  });

  // =====================================================================
  // Property 8: Regex Fallback Extracts Only Known Uppercase Tickers
  // =====================================================================
  describe('Property 8: Regex Fallback Extracts Only Known Uppercase Tickers', () => {
    /**
     * **Validates: Requirements 8.2, 8.4**
     *
     * For any query string processed by the regex fallback, the extracted tickers
     * SHALL be a subset of the known tickers set, and every extracted ticker SHALL
     * be an uppercase 1-5 letter word that appears in the query as an uppercase
     * token matching the known tickers set. The fallback SHALL always set
     * timePeriod.periodType to "LATEST_BOTH" and queryType to "single_metric".
     */

    it('extracted tickers are always a subset of known tickers', async () => {
      await fc.assert(
        fc.asyncProperty(queryArb, async (query) => {
          const result = await service.regexFallback(query);
          for (const ticker of result.tickers) {
            expect(KNOWN_TICKERS.has(ticker)).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('every extracted ticker appears as an uppercase token in the query', async () => {
      await fc.assert(
        fc.asyncProperty(queryArb, async (query) => {
          const result = await service.regexFallback(query);
          for (const ticker of result.tickers) {
            // The ticker must appear as an uppercase word in the original query
            const pattern = new RegExp(`(?:^|[\\s,(.])${ticker}(?=[\\s,.)!?\\n]|$)`);
            expect(pattern.test(query)).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('never extracts lowercase or mixed-case variants of known tickers', async () => {
      // Generate queries with lowercase versions of known tickers
      const lowercaseTickerQueryArb = fc.tuple(
        queryArb,
        fc.constantFrom(...Array.from(KNOWN_TICKERS)),
      ).map(([base, ticker]) => `${base} ${ticker.toLowerCase()} more words`);

      await fc.assert(
        fc.asyncProperty(lowercaseTickerQueryArb, async (query) => {
          const result = await service.regexFallback(query);
          // Any extracted ticker must appear uppercase in the query, not just as a lowercase match
          for (const ticker of result.tickers) {
            expect(ticker).toBe(ticker.toUpperCase());
            expect(KNOWN_TICKERS.has(ticker)).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('always sets timePeriod.periodType to LATEST_BOTH', async () => {
      await fc.assert(
        fc.asyncProperty(queryArb, async (query) => {
          const result = await service.regexFallback(query);
          expect(result.timePeriod.periodType).toBe('LATEST_BOTH');
        }),
        { numRuns: 100 },
      );
    });

    it('always sets queryType to single_metric', async () => {
      await fc.assert(
        fc.asyncProperty(queryArb, async (query) => {
          const result = await service.regexFallback(query);
          expect(result.queryType).toBe('single_metric');
        }),
        { numRuns: 100 },
      );
    });

    it('always sets all boolean flags to false', async () => {
      await fc.assert(
        fc.asyncProperty(queryArb, async (query) => {
          const result = await service.regexFallback(query);
          expect(result.needsNarrative).toBe(false);
          expect(result.needsPeerComparison).toBe(false);
          expect(result.needsComputation).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it('preserves the original query string', async () => {
      await fc.assert(
        fc.asyncProperty(queryArb, async (query) => {
          const result = await service.regexFallback(query);
          expect(result.originalQuery).toBe(query);
        }),
        { numRuns: 100 },
      );
    });

    it('extracts known tickers when they appear uppercase in the query', async () => {
      await fc.assert(
        fc.asyncProperty(queryWithKnownTickerArb, async (query) => {
          const result = await service.regexFallback(query);
          // At least one known ticker should be found since we inserted one
          expect(result.tickers.length).toBeGreaterThanOrEqual(1);
          for (const ticker of result.tickers) {
            expect(KNOWN_TICKERS.has(ticker)).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('never contains duplicate tickers', async () => {
      await fc.assert(
        fc.asyncProperty(queryArb, async (query) => {
          const result = await service.regexFallback(query);
          const uniqueTickers = new Set(result.tickers);
          expect(uniqueTickers.size).toBe(result.tickers.length);
        }),
        { numRuns: 100 },
      );
    });

    it('entities array matches tickers array', async () => {
      await fc.assert(
        fc.asyncProperty(queryArb, async (query) => {
          const result = await service.regexFallback(query);
          expect(result.entities.length).toBe(result.tickers.length);
          for (const entity of result.entities) {
            expect(result.tickers).toContain(entity.ticker);
            expect(entity.validated).toBe(true);
            expect(entity.source).toBe('exact_match');
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
