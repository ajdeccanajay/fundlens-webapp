/**
 * Property-Based Tests for FastPathCache
 *
 * These tests verify correctness properties that must hold across all inputs.
 * Uses fast-check to generate random test cases and verify universal properties.
 *
 * Feature: intelligent-intent-detection-system
 * Properties tested:
 * - Property 3: Cache Pattern Normalization Idempotence
 * - Property 4: Cache Template Substitution Correctness
 * - Property 5: Cache Size Invariant
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { FastPathCache } from '../../src/rag/intent-detection/fast-path-cache';
import { QueryIntent } from '../../src/rag/types/query-intent';

/** Known tickers seeded in FastPathCache constructor */
const KNOWN_TICKERS = [
  'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA', 'NVDA',
  'NFLX', 'INTC', 'ORCL', 'ADBE', 'PYPL', 'CSCO', 'SBUX', 'JPM',
  'BAC', 'WFC', 'DIS', 'AMD', 'CRM', 'PFE', 'MRK', 'JNJ', 'UNH',
  'CVS', 'WMT', 'TGT', 'NKE', 'MCD', 'KO', 'PEP', 'HD', 'LOW',
  'RH', 'V', 'MA', 'AMGN', 'CMCSA', 'AVGO', 'COST', 'TMO', 'DHR',
  'LLY', 'ABBV', 'ACN', 'TXN', 'QCOM', 'HON', 'IBM', 'GE', 'CAT',
  'BA', 'MMM', 'GS', 'MS', 'BLK', 'SCHW', 'AXP', 'C', 'USB',
];

/** Periods that the normalizer replaces with {PERIOD} */
const PERIODS = [
  'FY2024', 'FY2023', 'FY2022', 'FY2021', 'FY2020',
  'Q1-2024', 'Q2-2024', 'Q3-2024', 'Q4-2024',
  'Q1-2023', 'Q2-2023', 'Q3-2023', 'Q4-2023',
  '2024', '2023', '2022',
];

/** Query templates — the structural part that stays the same across tickers/periods */
const QUERY_TEMPLATES = [
  '{T} revenue {P}',
  '{T} gross margin {P}',
  '{T} net income {P}',
  'What is {T} revenue for {P}',
  'Show me {T} earnings {P}',
  'Compare {T} and {T2} revenue {P}',
  '{T} operating income {P}',
  '{T} total assets {P}',
  '{T} free cash flow {P}',
];

/** Helper to build a minimal valid QueryIntent */
function makeIntent(overrides: Partial<QueryIntent> = {}): QueryIntent {
  return {
    type: 'structured',
    ticker: 'AAPL',
    metrics: ['total_revenue'],
    period: 'FY2024',
    periodType: 'annual',
    needsNarrative: false,
    needsComparison: false,
    needsComputation: false,
    needsTrend: false,
    confidence: 0.9,
    originalQuery: 'AAPL revenue FY2024',
    ...overrides,
  };
}

/** Arbitrary for generating a known ticker */
const tickerArb = fc.constantFrom(...KNOWN_TICKERS);

/** Arbitrary for generating a period string */
const periodArb = fc.constantFrom(...PERIODS);


describe('Property Tests - FastPathCache', () => {
  let cache: FastPathCache;

  beforeEach(() => {
    cache = new FastPathCache();
  });

  describe('Property 3: Cache Pattern Normalization Idempotence', () => {
    /**
     * **Validates: Requirements 4.3**
     *
     * For any query string, normalizing it to a pattern and then normalizing
     * the pattern again SHALL produce the same pattern (idempotence).
     * Additionally, two queries that differ only in ticker symbols, period values,
     * or metric names SHALL normalize to the same pattern.
     */

    it('normalizing a pattern twice produces the same result (idempotence)', () => {
      fc.assert(
        fc.property(
          // Generate queries with known tickers and periods embedded
          tickerArb,
          periodArb,
          fc.constantFrom(
            'revenue', 'gross margin', 'net income', 'operating income',
            'total assets', 'free cash flow', 'earnings', 'debt',
          ),
          fc.constantFrom(
            '{T} {M} {P}',
            'What is {T} {M} for {P}',
            'Show me {T} {M} {P}',
            '{T} {M}',
            'Tell me about {T} {M} in {P}',
          ),
          (ticker, period, metric, template) => {
            const query = template
              .replace('{T}', ticker)
              .replace('{M}', metric)
              .replace('{P}', period);

            const pattern1 = cache.normalizeToPattern(query);
            const pattern2 = cache.normalizeToPattern(pattern1);

            expect(pattern2).toBe(pattern1);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('queries differing only in ticker normalize to the same pattern', () => {
      fc.assert(
        fc.property(
          tickerArb,
          tickerArb,
          periodArb,
          fc.constantFrom(
            'revenue', 'gross margin', 'net income', 'earnings',
            'operating income', 'total assets', 'free cash flow',
          ),
          fc.constantFrom(
            '{T} {M} {P}',
            'What is {T} {M} for {P}',
            'Show me {T} {M} {P}',
          ),
          (ticker1, ticker2, period, metric, template) => {
            const query1 = template
              .replace('{T}', ticker1)
              .replace('{M}', metric)
              .replace('{P}', period);
            const query2 = template
              .replace('{T}', ticker2)
              .replace('{M}', metric)
              .replace('{P}', period);

            const pattern1 = cache.normalizeToPattern(query1);
            const pattern2 = cache.normalizeToPattern(query2);

            expect(pattern1).toBe(pattern2);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('queries differing only in period normalize to the same pattern', () => {
      fc.assert(
        fc.property(
          tickerArb,
          periodArb,
          periodArb,
          fc.constantFrom(
            'revenue', 'gross margin', 'net income', 'earnings',
          ),
          (ticker, period1, period2, metric) => {
            const query1 = `${ticker} ${metric} ${period1}`;
            const query2 = `${ticker} ${metric} ${period2}`;

            const pattern1 = cache.normalizeToPattern(query1);
            const pattern2 = cache.normalizeToPattern(query2);

            expect(pattern1).toBe(pattern2);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('queries differing in both ticker and period normalize to the same pattern', () => {
      fc.assert(
        fc.property(
          tickerArb,
          tickerArb,
          periodArb,
          periodArb,
          fc.constantFrom('revenue', 'gross margin', 'net income'),
          (ticker1, ticker2, period1, period2, metric) => {
            const query1 = `${ticker1} ${metric} ${period1}`;
            const query2 = `${ticker2} ${metric} ${period2}`;

            const pattern1 = cache.normalizeToPattern(query1);
            const pattern2 = cache.normalizeToPattern(query2);

            expect(pattern1).toBe(pattern2);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('normalized pattern contains {TICKER} placeholder where tickers were', () => {
      fc.assert(
        fc.property(
          tickerArb,
          periodArb,
          (ticker, period) => {
            const query = `${ticker} revenue ${period}`;
            const pattern = cache.normalizeToPattern(query);

            expect(pattern).toContain('{TICKER}');
            expect(pattern).not.toContain(ticker.toLowerCase());
          },
        ),
        { numRuns: 10 },
      );
    });

    it('normalized pattern contains {PERIOD} placeholder where periods were', () => {
      fc.assert(
        fc.property(
          tickerArb,
          periodArb,
          (ticker, period) => {
            const query = `${ticker} revenue ${period}`;
            const pattern = cache.normalizeToPattern(query);

            expect(pattern).toContain('{PERIOD}');
            // The period digits should be replaced
            const yearMatch = period.match(/\d{4}/);
            if (yearMatch) {
              expect(pattern).not.toContain(yearMatch[0]);
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  describe('Property 4: Cache Template Substitution Correctness', () => {
    /**
     * **Validates: Requirements 1.4, 4.5**
     *
     * For any cached QueryIntent template and any current query with extracted
     * ticker, period, and metric values, substituting the current values into
     * the template SHALL produce a QueryIntent where the ticker matches the
     * current query's ticker, the period matches the current query's period,
     * and the metrics match the current query's resolved metrics.
     */

    it('substituted intent has the current query ticker, period, and metrics', () => {
      fc.assert(
        fc.property(
          // Original query values (stored in cache)
          tickerArb,
          periodArb,
          // Current query values (used for substitution)
          tickerArb,
          periodArb,
          fc.constantFrom(
            ['total_revenue'],
            ['net_income'],
            ['gross_margin'],
            ['operating_income', 'net_income'],
          ),
          (origTicker, origPeriod, curTicker, curPeriod, curMetrics) => {
            // Store original intent in cache
            const origIntent = makeIntent({
              ticker: origTicker,
              period: origPeriod,
              metrics: ['total_revenue'],
              originalQuery: `${origTicker} revenue ${origPeriod}`,
            });
            cache.store(`${origTicker} revenue ${origPeriod}`, origIntent);

            // Look up with current query values
            const result = cache.lookup(`${curTicker} revenue ${curPeriod}`, {
              ticker: curTicker,
              period: curPeriod,
              periodType: 'annual',
              metrics: curMetrics,
            });

            expect(result).not.toBeNull();
            // Ticker must match the current query's ticker
            expect(result!.ticker).toBe(curTicker);
            // Period must match the current query's period
            expect(result!.period).toBe(curPeriod);
            // Metrics must match the current query's resolved metrics
            expect(result!.metrics).toEqual(curMetrics);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('substituted intent always has originalQuery set to the current query', () => {
      fc.assert(
        fc.property(
          tickerArb,
          tickerArb,
          periodArb,
          periodArb,
          (origTicker, curTicker, origPeriod, curPeriod) => {
            const origQuery = `${origTicker} revenue ${origPeriod}`;
            const curQuery = `${curTicker} revenue ${curPeriod}`;

            cache.store(origQuery, makeIntent({
              ticker: origTicker,
              period: origPeriod,
              originalQuery: origQuery,
            }));

            const result = cache.lookup(curQuery, {
              ticker: curTicker,
              period: curPeriod,
            });

            expect(result).not.toBeNull();
            expect(result!.originalQuery).toBe(curQuery);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('substituted intent preserves template boolean flags', () => {
      fc.assert(
        fc.property(
          tickerArb,
          tickerArb,
          periodArb,
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          (origTicker, curTicker, period, needsNarrative, needsComparison, needsComputation, needsTrend) => {
            const origQuery = `${origTicker} revenue ${period}`;

            cache.store(origQuery, makeIntent({
              ticker: origTicker,
              period,
              needsNarrative,
              needsComparison,
              needsComputation,
              needsTrend,
              originalQuery: origQuery,
            }));

            const curQuery = `${curTicker} revenue ${period}`;
            const result = cache.lookup(curQuery, {
              ticker: curTicker,
              period,
            });

            expect(result).not.toBeNull();
            // Boolean flags from the template must be preserved
            expect(result!.needsNarrative).toBe(needsNarrative);
            expect(result!.needsComparison).toBe(needsComparison);
            expect(result!.needsComputation).toBe(needsComputation);
            expect(result!.needsTrend).toBe(needsTrend);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('substituted intent preserves template type classification', () => {
      fc.assert(
        fc.property(
          tickerArb,
          tickerArb,
          periodArb,
          fc.constantFrom('structured' as const, 'semantic' as const, 'hybrid' as const),
          (origTicker, curTicker, period, queryType) => {
            const origQuery = `${origTicker} revenue ${period}`;

            cache.store(origQuery, makeIntent({
              type: queryType,
              ticker: origTicker,
              period,
              originalQuery: origQuery,
            }));

            const curQuery = `${curTicker} revenue ${period}`;
            const result = cache.lookup(curQuery, {
              ticker: curTicker,
              period,
            });

            expect(result).not.toBeNull();
            expect(result!.type).toBe(queryType);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('when fastPathResult has no metrics, template metrics are preserved', () => {
      fc.assert(
        fc.property(
          tickerArb,
          tickerArb,
          periodArb,
          fc.constantFrom(
            ['total_revenue'],
            ['net_income', 'gross_margin'],
            ['operating_income'],
          ),
          (origTicker, curTicker, period, templateMetrics) => {
            const origQuery = `${origTicker} revenue ${period}`;

            cache.store(origQuery, makeIntent({
              ticker: origTicker,
              period,
              metrics: templateMetrics,
              originalQuery: origQuery,
            }));

            const curQuery = `${curTicker} revenue ${period}`;
            // No metrics in fastPathResult — template metrics should be preserved
            const result = cache.lookup(curQuery, {
              ticker: curTicker,
              period,
            });

            expect(result).not.toBeNull();
            expect(result!.metrics).toEqual(templateMetrics);
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  describe('Property 5: Cache Size Invariant', () => {
    /**
     * **Validates: Requirements 4.4**
     *
     * For any sequence of cache store operations, the Fast_Path_Cache SHALL
     * never contain more than 5,000 entries. When the 5,001st entry is stored,
     * the least recently used entry SHALL be evicted.
     */

    it('cache size never exceeds 5,000 entries', () => {
      fc.assert(
        fc.property(
          // Generate a count of entries to store (up to 5,500 to exceed the limit)
          fc.integer({ min: 1, max: 5500 }),
          (count) => {
            const localCache = new FastPathCache();

            for (let i = 0; i < count; i++) {
              // Use unique non-ticker words to create distinct patterns
              // Avoid words that could be mistaken for tickers
              const uniqueWord = `financialquery${i}analysis`;
              localCache.store(
                `${uniqueWord} about something`,
                makeIntent({ originalQuery: `${uniqueWord} about something` }),
              );
            }

            const stats = localCache.getStats();
            expect(stats.size).toBeLessThanOrEqual(5000);
            expect(stats.maxSize).toBe(5000);
          },
        ),
        // Fewer runs since each iteration stores many entries
        { numRuns: 10 },
      );
    });

    it('storing exactly 5,001 entries results in exactly 5,000 in cache', () => {
      const localCache = new FastPathCache();
      const entryCount = 5001;

      for (let i = 0; i < entryCount; i++) {
        const uniqueWord = `uniquepattern${i}data`;
        localCache.store(
          `${uniqueWord} about something`,
          makeIntent({ originalQuery: `${uniqueWord} about something` }),
        );
      }

      const stats = localCache.getStats();
      expect(stats.size).toBe(5000);
    });

    it('LRU eviction removes the least recently used entry', () => {
      const localCache = new FastPathCache();

      // Store the first entry (will be LRU candidate)
      const firstQuery = 'firstentry0 about something';
      localCache.store(firstQuery, makeIntent({ originalQuery: firstQuery }));

      // Fill the cache to capacity with unique entries
      for (let i = 1; i <= 5000; i++) {
        const uniqueWord = `fillentry${i}data`;
        localCache.store(
          `${uniqueWord} about something`,
          makeIntent({ originalQuery: `${uniqueWord} about something` }),
        );
      }

      // The first entry should have been evicted (it was LRU)
      const result = localCache.lookup(firstQuery, {});
      expect(result).toBeNull();

      // The most recent entry should still be present
      const lastQuery = 'fillentry5000data about something';
      const lastResult = localCache.lookup(lastQuery, {});
      expect(lastResult).not.toBeNull();
    });

    it('accessing a cache entry prevents it from being evicted', () => {
      const localCache = new FastPathCache();

      // Store the first entry
      const protectedQuery = 'protectedentry0 about something';
      localCache.store(protectedQuery, makeIntent({ originalQuery: protectedQuery }));

      // Store the second entry (this will be the actual LRU candidate)
      const victimQuery = 'victimentry1 about something';
      localCache.store(victimQuery, makeIntent({ originalQuery: victimQuery }));

      // Access the first entry to make it recently used
      localCache.lookup(protectedQuery, {});

      // Fill the rest of the cache to capacity (entries 2 through 5000)
      for (let i = 2; i <= 5000; i++) {
        const uniqueWord = `fillentry${i}data`;
        localCache.store(
          `${uniqueWord} about something`,
          makeIntent({ originalQuery: `${uniqueWord} about something` }),
        );
      }

      // The protected entry should still be present (it was accessed recently)
      const protectedResult = localCache.lookup(protectedQuery, {});
      expect(protectedResult).not.toBeNull();

      // The victim entry should have been evicted (it was LRU)
      const victimResult = localCache.lookup(victimQuery, {});
      expect(victimResult).toBeNull();
    });

    it('cache size stays bounded under random store/lookup/invalidate sequences', () => {
      fc.assert(
        fc.property(
          // Generate a sequence of operations
          fc.array(
            fc.oneof(
              fc.record({
                op: fc.constant('store' as const),
                id: fc.integer({ min: 0, max: 9999 }),
              }),
              fc.record({
                op: fc.constant('lookup' as const),
                id: fc.integer({ min: 0, max: 9999 }),
              }),
              fc.record({
                op: fc.constant('invalidate' as const),
                id: fc.integer({ min: 0, max: 9999 }),
              }),
            ),
            { minLength: 100, maxLength: 6000 },
          ),
          (operations) => {
            const localCache = new FastPathCache();

            for (const op of operations) {
              const query = `operation${op.id}pattern about something`;
              switch (op.op) {
                case 'store':
                  localCache.store(query, makeIntent({ originalQuery: query }));
                  break;
                case 'lookup':
                  localCache.lookup(query, {});
                  break;
                case 'invalidate':
                  localCache.invalidate(query);
                  break;
              }

              // Invariant: size never exceeds MAX_SIZE
              expect(localCache.getStats().size).toBeLessThanOrEqual(5000);
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
