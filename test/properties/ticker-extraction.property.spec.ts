/**
 * Property-Based Tests for extractTickersFromQuery()
 *
 * Feature: rag-chatbot-master-engineering, Property 7: Ticker extraction pipeline
 *
 * For any query string and a known ticker set, extractTickersFromQuery() should
 * return only uppercase letter sequences (1-5 chars) that are bounded by
 * whitespace/punctuation AND present in the known ticker set. No non-ticker
 * uppercase words (EBITDA, GAAP, CEO) should appear in the result.
 *
 * **Validates: Requirements 6.2, 6.3**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';

describe('Property Tests - Ticker Extraction Pipeline', () => {
  let service: IntentDetectorService;

  /** Access the private method for direct testing */
  const extractTickers = (query: string): string[] => {
    return (service as any).extractTickersFromQuery(query);
  };

  /** Set the knownTickers set directly */
  const setKnownTickers = (tickers: Set<string>): void => {
    (service as any).knownTickers = tickers;
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentDetectorService,
        {
          provide: BedrockService,
          useValue: { generate: jest.fn() },
        },
        {
          provide: IntentAnalyticsService,
          useValue: { logDetection: jest.fn() },
        },
        {
          provide: MetricRegistryService,
          useValue: { resolveMetric: jest.fn(), resolveMultiple: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);
  });

  // --- Generators ---

  const uppercaseLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  /** Generate a valid ticker: 1-5 uppercase letters */
  const tickerArb = fc.integer({ min: 1, max: 5 }).chain(len =>
    fc.array(fc.constantFrom(...uppercaseLetters), { minLength: len, maxLength: len })
      .map(chars => chars.join('')),
  );

  /** Common non-ticker uppercase words that should be rejected */
  const nonTickerWords = [
    'EBITDA', 'GAAP', 'CEO', 'CFO', 'CTO', 'COO', 'FY', 'TTM', 'SEC',
    'IPO', 'PE', 'EPS', 'ROE', 'ROA', 'ROIC', 'WACC', 'DCF', 'LTM',
    'YOY', 'QOQ', 'CAGR', 'SGA', 'FCF', 'EV', 'GDP', 'CPI',
    'AND', 'THE', 'FOR', 'NOT', 'BUT', 'ALL', 'ANY', 'CAN', 'HER',
    'WAS', 'ONE', 'OUR', 'OUT',
  ];

  /** Generate a non-ticker uppercase word from the known list */
  const nonTickerWordArb = fc.constantFrom(...nonTickerWords);

  /** Generate a set of known tickers (1-20 tickers) */
  const knownTickerSetArb = fc.uniqueArray(tickerArb, { minLength: 1, maxLength: 20 })
    .map(arr => new Set(arr));

  describe('Property 7: Ticker extraction pipeline', () => {
    /**
     * **Validates: Requirements 6.2, 6.3**
     *
     * For any query string and a known ticker set, extractTickersFromQuery()
     * should return only uppercase letter sequences (1-5 chars) that are
     * bounded by whitespace/punctuation AND present in the known ticker set.
     */

    it('results only contain strings from the knownTickers set', () => {
      fc.assert(
        fc.property(
          knownTickerSetArb,
          fc.string({ minLength: 0, maxLength: 200 }),
          (knownSet, query) => {
            setKnownTickers(knownSet);
            const results = extractTickers(query);
            for (const ticker of results) {
              expect(knownSet.has(ticker)).toBe(true);
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('results only contain 1-5 uppercase letter sequences', () => {
      fc.assert(
        fc.property(
          knownTickerSetArb,
          fc.string({ minLength: 0, maxLength: 200 }),
          (knownSet, query) => {
            setKnownTickers(knownSet);
            const results = extractTickers(query);
            for (const ticker of results) {
              expect(ticker).toMatch(/^[A-Z]{1,5}$/);
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('non-ticker uppercase words are never returned when not in knownTickers', () => {
      fc.assert(
        fc.property(
          nonTickerWordArb,
          fc.string({ minLength: 0, maxLength: 100 }),
          (nonTicker, queryPart) => {
            // Build a knownTickers set that does NOT contain the non-ticker word
            const safeSet = new Set(['AAPL', 'MSFT', 'GOOGL', 'AMZN']);
            safeSet.delete(nonTicker); // ensure non-ticker word is not in the set
            setKnownTickers(safeSet);

            const query = `What about ${nonTicker} for ${queryPart}`;
            const results = extractTickers(query);
            expect(results).not.toContain(nonTicker);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('known tickers embedded in queries with whitespace boundaries are correctly extracted', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(tickerArb.filter(t => t.length >= 1 && t.length <= 5), { minLength: 1, maxLength: 5 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }).map(s => s.toLowerCase()), { minLength: 0, maxLength: 5 }),
          (tickers, fillerWords) => {
            const knownSet = new Set(tickers);
            setKnownTickers(knownSet);

            // Build a query with tickers separated by spaces and filler words
            const parts: string[] = [];
            for (let i = 0; i < tickers.length; i++) {
              if (i < fillerWords.length) {
                parts.push(fillerWords[i]);
              }
              parts.push(tickers[i]);
            }
            const query = parts.join(' ');

            const results = extractTickers(query);
            // Every ticker in the query that's in the known set should be found
            for (const ticker of tickers) {
              expect(results).toContain(ticker);
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('results contain no duplicates', () => {
      fc.assert(
        fc.property(
          knownTickerSetArb,
          fc.string({ minLength: 0, maxLength: 200 }),
          (knownSet, query) => {
            setKnownTickers(knownSet);
            const results = extractTickers(query);
            const uniqueResults = new Set(results);
            expect(results.length).toBe(uniqueResults.size);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('empty query returns empty results', () => {
      fc.assert(
        fc.property(
          knownTickerSetArb,
          (knownSet) => {
            setKnownTickers(knownSet);
            const results = extractTickers('');
            expect(results).toEqual([]);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('query with no uppercase letters returns empty results', () => {
      fc.assert(
        fc.property(
          knownTickerSetArb,
          fc.string({ minLength: 1, maxLength: 100 }),
          (knownSet, rawQuery) => {
            setKnownTickers(knownSet);
            // Force all lowercase + digits + spaces only
            const query = rawQuery.replace(/[A-Z]/g, 'x').toLowerCase();
            const results = extractTickers(query);
            expect(results).toEqual([]);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('empty knownTickers set always returns empty results', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 200 }),
          (query) => {
            setKnownTickers(new Set());
            const results = extractTickers(query);
            expect(results).toEqual([]);
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
