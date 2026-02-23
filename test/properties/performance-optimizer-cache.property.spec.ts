/**
 * Property-Based Tests: PerformanceOptimizerService — Cache Properties
 * Feature: multimodal-research-responses
 *
 * Tests cache hit equivalence, TTL selection, LRU eviction, ticker-based
 * invalidation, and TTL expiration properties of the performance optimizer cache.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { PerformanceOptimizerService } from '../../src/rag/performance-optimizer.service';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const TICKERS = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA'];
const FISCAL_PERIODS = ['FY2019', 'FY2020', 'FY2021', 'FY2022', 'FY2023', 'FY2024'];

/** Generate a mock RAGResponse-like object for caching */
const ragResponseArb = fc.record({
  answer: fc.string({ minLength: 1, maxLength: 200 }),
  metrics: fc.array(
    fc.record({
      ticker: fc.constantFrom(...TICKERS),
      normalizedMetric: fc.constantFrom('revenue', 'net_income', 'ebitda'),
      value: fc.double({ min: 1000, max: 1_000_000_000, noNaN: true }),
      fiscalPeriod: fc.constantFrom(...FISCAL_PERIODS),
    }),
    { minLength: 0, maxLength: 5 },
  ),
  sources: fc.array(
    fc.record({
      type: fc.constantFrom('metric', 'narrative'),
      ticker: fc.constantFrom(...TICKERS),
      filingType: fc.constant('10-K'),
      fiscalPeriod: fc.constantFrom(...FISCAL_PERIODS),
    }),
    { minLength: 0, maxLength: 3 },
  ),
  processingInfo: fc.record({
    structuredMetrics: fc.nat({ max: 20 }),
    semanticNarratives: fc.nat({ max: 10 }),
    usedBedrockKB: fc.boolean(),
    usedClaudeGeneration: fc.boolean(),
    hybridProcessing: fc.boolean(),
  }),
});

/** Generate a unique cache key */
const cacheKeyArb = fc.stringMatching(/^rag:[a-z]{3,8}:[a-f0-9]{8,16}$/);

/** Generate a QueryIntent for TTL testing */
const latestIntentArb = fc.oneof(
  fc.record({ periodType: fc.constant('latest') }),
  fc.record({ period: fc.constant('latest') }),
  fc.record({ periodType: fc.constant('latest'), period: fc.constant('latest') }),
);

const historicalIntentArb = fc.record({
  period: fc.constantFrom('FY2020', 'FY2021', 'FY2022', 'FY2023', 'Q1-2024', 'Q4-2023'),
}).filter((intent) => intent.period !== 'latest');

const semanticIntentArb = fc.record({
  type: fc.constant('semantic'),
  // Ensure no period or periodType fields that would match earlier branches
}).map((intent) => ({ ...intent, period: undefined, periodType: undefined }));

// ---------------------------------------------------------------------------
// Property 6: Cache hit returns equivalent response
// **Validates: Requirements 5.2, 5.3**
//
// For any RAGResponse that has been cached, a subsequent cache lookup with
// the same cache key shall return a response where all fields except latency
// and timestamp are deeply equal to the original, and processingInfo.fromCache
// shall be true.
//
// Note: The PerformanceOptimizerService returns the exact cached data object.
// The fromCache flag is set by the RAGService caller, not the optimizer.
// We verify the optimizer's contract: getCachedQuery returns deeply equal data.
// ---------------------------------------------------------------------------

describe('Property 6: Cache hit returns equivalent response', () => {
  let service: PerformanceOptimizerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PerformanceOptimizerService],
    }).compile();
    service = module.get(PerformanceOptimizerService);
  });

  afterEach(() => {
    service.clearCache();
  });

  it('cached response is deeply equal to original on cache hit', () => {
    fc.assert(
      fc.property(
        cacheKeyArb,
        ragResponseArb,
        fc.integer({ min: 60, max: 86400 }),
        (key, response, ttl) => {
          service.clearCache();

          // Cache the response
          service.cacheQuery(key, response, ttl);

          // Retrieve it
          const cached = service.getCachedQuery<typeof response>(key);

          // Must not be null (cache hit)
          expect(cached).not.toBeNull();

          // All fields must be deeply equal to the original
          expect(cached!.answer).toEqual(response.answer);
          expect(cached!.metrics).toEqual(response.metrics);
          expect(cached!.sources).toEqual(response.sources);
          expect(cached!.processingInfo).toEqual(response.processingInfo);

          // Full deep equality
          expect(cached).toEqual(response);
        },
      ),
      { numRuns: 10 },
    );
  });

  it('cache hit increments hit counter in metrics', () => {
    fc.assert(
      fc.property(
        cacheKeyArb,
        ragResponseArb,
        (key, response) => {
          service.clearCache();

          service.cacheQuery(key, response, 3600);

          const metricsBefore = service.getCacheMetrics();
          const hitsBefore = metricsBefore.hits;

          service.getCachedQuery(key);

          const metricsAfter = service.getCacheMetrics();
          expect(metricsAfter.hits).toBe(hitsBefore + 1);
        },
      ),
      { numRuns: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: TTL selection by query type
// **Validates: Requirements 5.4**
//
// For any QueryIntent, getCacheTTL() shall return 3600 for intents targeting
// the latest period, 86400 for historical period intents, and 21600 for
// semantic-type intents.
// ---------------------------------------------------------------------------

describe('Property 7: TTL selection by query type', () => {
  let service: PerformanceOptimizerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PerformanceOptimizerService],
    }).compile();
    service = module.get(PerformanceOptimizerService);
  });

  it('returns 3600 for latest period intents', () => {
    fc.assert(
      fc.property(latestIntentArb, (intent) => {
        const ttl = service.getCacheTTL(intent);
        expect(ttl).toBe(3600);
      }),
      { numRuns: 10 },
    );
  });

  it('returns 86400 for historical period intents', () => {
    fc.assert(
      fc.property(historicalIntentArb, (intent) => {
        const ttl = service.getCacheTTL(intent);
        expect(ttl).toBe(86400);
      }),
      { numRuns: 10 },
    );
  });

  it('returns 21600 for semantic-type intents', () => {
    fc.assert(
      fc.property(semanticIntentArb, (intent) => {
        const ttl = service.getCacheTTL(intent);
        expect(ttl).toBe(21600);
      }),
      { numRuns: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: LRU eviction on max size
// **Validates: Requirements 5.5**
//
// For any sequence of N cache insertions where N exceeds maxSize, the cache
// size shall never exceed maxSize, and the evicted entry shall be the one
// with the oldest access timestamp (least recently used).
// ---------------------------------------------------------------------------

describe('Property 8: LRU eviction on max size', () => {
  let service: PerformanceOptimizerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PerformanceOptimizerService],
    }).compile();
    service = module.get(PerformanceOptimizerService);
  });

  afterEach(() => {
    service.clearCache();
  });

  it('cache size never exceeds maxSize after N insertions', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }), // maxSize
        fc.integer({ min: 1, max: 15 }),  // extra insertions beyond maxSize
        (maxSize, extra) => {
          // Create a fresh service instance per run to avoid stale config/state
          const freshService = new PerformanceOptimizerService();
          freshService.configure({ maxSize });

          const totalInsertions = maxSize + extra;

          // Use a controlled time to ensure distinct timestamps
          const OriginalDate = Date;
          let fakeTime = 1_000_000_000_000;
          // @ts-ignore - override global Date for deterministic timestamps
          global.Date = class extends OriginalDate {
            constructor(...args: any[]) {
              if (args.length === 0) {
                super(fakeTime);
              } else {
                // @ts-ignore
                super(...args);
              }
            }
            static now() { return fakeTime; }
          } as any;

          try {
            for (let i = 0; i < totalInsertions; i++) {
              fakeTime = 1_000_000_000_000 + i * 1000; // 1s apart
              const key = `key-${i}`;
              freshService.cacheQuery(key, { data: `value-${i}` }, 3600);

              // Invariant: cache size never exceeds maxSize
              const metrics = freshService.getCacheMetrics();
              expect(metrics.size).toBeLessThanOrEqual(maxSize);
            }

            // Final size should be exactly maxSize
            const finalMetrics = freshService.getCacheMetrics();
            expect(finalMetrics.size).toBe(maxSize);

            // Evictions should equal the number of extra insertions
            expect(finalMetrics.evictions).toBe(extra);
          } finally {
            global.Date = OriginalDate;
          }
        },
      ),
      { numRuns: 10 },
    );
  });

  it('evicts the entry with the oldest timestamp (LRU)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }), // maxSize
        (maxSize) => {
          // Create a fresh service instance per run
          const freshService = new PerformanceOptimizerService();
          freshService.configure({ maxSize });

          // Use a controlled time to ensure distinct timestamps
          const OriginalDate = Date;
          let fakeTime = 1_000_000_000_000;
          // @ts-ignore
          global.Date = class extends OriginalDate {
            constructor(...args: any[]) {
              if (args.length === 0) {
                super(fakeTime);
              } else {
                // @ts-ignore
                super(...args);
              }
            }
            static now() { return fakeTime; }
          } as any;

          try {
            // Insert maxSize entries with staggered timestamps
            for (let i = 0; i < maxSize; i++) {
              fakeTime = 1_000_000_000_000 + i * 1000; // 1s apart
              freshService.cacheQuery(`key-${i}`, { data: `value-${i}` }, 3600);
            }

            // Advance time slightly for lookups (still within TTL)
            fakeTime = 1_000_000_000_000 + maxSize * 1000;

            // All entries should be present
            for (let i = 0; i < maxSize; i++) {
              expect(freshService.getCachedQuery(`key-${i}`)).not.toBeNull();
            }

            // Insert one more — should evict key-0 (oldest timestamp)
            fakeTime = 1_000_000_000_000 + (maxSize + 1) * 1000;
            freshService.cacheQuery('key-overflow', { data: 'overflow' }, 3600);

            // key-0 should be evicted (it had the earliest timestamp)
            expect(freshService.getCachedQuery('key-0')).toBeNull();

            // All other original keys should still be present
            for (let i = 1; i < maxSize; i++) {
              expect(freshService.getCachedQuery(`key-${i}`)).not.toBeNull();
            }

            // The new key should be present
            expect(freshService.getCachedQuery('key-overflow')).not.toBeNull();

            // Size should still be maxSize
            expect(freshService.getCacheMetrics().size).toBeLessThanOrEqual(maxSize);
          } finally {
            global.Date = OriginalDate;
          }
        },
      ),
      { numRuns: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Ticker-based cache invalidation
// **Validates: Requirements 6.1, 6.2**
//
// For any cache state containing entries for multiple tickers, calling
// invalidateByTicker(ticker) shall remove exactly those entries whose
// ticker field matches the specified ticker, leave all other entries intact,
// and increment the eviction counter by the number of removed entries.
// ---------------------------------------------------------------------------

describe('Property 9: Ticker-based cache invalidation', () => {
  let service: PerformanceOptimizerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PerformanceOptimizerService],
    }).compile();
    service = module.get(PerformanceOptimizerService);
  });

  afterEach(() => {
    service.clearCache();
  });

  it('removes exactly the entries for the target ticker and leaves others intact', () => {
    fc.assert(
      fc.property(
        // Target ticker to invalidate
        fc.constantFrom(...TICKERS),
        // Entries for the target ticker (1-5 entries)
        fc.array(
          fc.record({
            keySuffix: fc.stringMatching(/^[a-f0-9]{4,8}$/),
            data: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        // Entries for other tickers (1-5 entries)
        fc.array(
          fc.record({
            ticker: fc.constantFrom(...TICKERS),
            keySuffix: fc.stringMatching(/^[a-f0-9]{4,8}$/),
            data: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (targetTicker, targetEntries, otherEntries) => {
          // Fresh service per run to avoid stale eviction counters
          const freshService = new PerformanceOptimizerService();

          // Filter other entries to exclude the target ticker
          const filteredOther = otherEntries.filter(
            (e) => e.ticker.toUpperCase() !== targetTicker.toUpperCase(),
          );

          // Insert target ticker entries
          const targetKeys: string[] = [];
          for (let i = 0; i < targetEntries.length; i++) {
            const key = `target-${targetEntries[i].keySuffix}-${i}`;
            targetKeys.push(key);
            freshService.cacheQuery(key, { data: targetEntries[i].data }, 3600, targetTicker);
          }

          // Insert other ticker entries
          const otherKeys: string[] = [];
          for (let i = 0; i < filteredOther.length; i++) {
            const key = `other-${filteredOther[i].keySuffix}-${i}`;
            otherKeys.push(key);
            freshService.cacheQuery(key, { data: filteredOther[i].data }, 3600, filteredOther[i].ticker);
          }

          const evictionsBefore = freshService.getCacheMetrics().evictions;
          const sizeBefore = freshService.getCacheMetrics().size;

          // Invalidate the target ticker
          const removed = freshService.invalidateByTicker(targetTicker);

          // Should remove exactly the target entries
          expect(removed).toBe(targetEntries.length);

          // Eviction counter should increment by the number removed
          const evictionsAfter = freshService.getCacheMetrics().evictions;
          expect(evictionsAfter).toBe(evictionsBefore + targetEntries.length);

          // Cache size should decrease by the number removed
          const sizeAfter = freshService.getCacheMetrics().size;
          expect(sizeAfter).toBe(sizeBefore - targetEntries.length);

          // Target entries should be gone
          for (const key of targetKeys) {
            expect(freshService.getCachedQuery(key)).toBeNull();
          }

          // Other entries should still be present
          for (const key of otherKeys) {
            expect(freshService.getCachedQuery(key)).not.toBeNull();
          }
        },
      ),
      { numRuns: 10 },
    );
  });

  it('returns 0 and does not modify cache when ticker has no entries', () => {
    fc.assert(
      fc.property(
        // Ticker to invalidate (not present in cache)
        fc.constantFrom('ZZZZ', 'XXXX', 'YYYY'),
        // Entries for other tickers
        fc.array(
          fc.record({
            ticker: fc.constantFrom(...TICKERS),
            keySuffix: fc.stringMatching(/^[a-f0-9]{4,8}$/),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (missingTicker, entries) => {
          // Fresh service per run
          const freshService = new PerformanceOptimizerService();

          // Insert entries for known tickers
          for (let i = 0; i < entries.length; i++) {
            freshService.cacheQuery(`key-${i}`, { data: i }, 3600, entries[i].ticker);
          }

          const sizeBefore = freshService.getCacheMetrics().size;
          const evictionsBefore = freshService.getCacheMetrics().evictions;

          const removed = freshService.invalidateByTicker(missingTicker);

          expect(removed).toBe(0);
          expect(freshService.getCacheMetrics().size).toBe(sizeBefore);
          expect(freshService.getCacheMetrics().evictions).toBe(evictionsBefore);
        },
      ),
      { numRuns: 10 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 10: TTL expiration
// **Validates: Requirements 6.4**
//
// For any cached entry, the PerformanceOptimizerService shall return the
// entry on lookup if within TTL, and return null if TTL exceeded.
// ---------------------------------------------------------------------------

describe('Property 10: TTL expiration', () => {
  let service: PerformanceOptimizerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PerformanceOptimizerService],
    }).compile();
    service = module.get(PerformanceOptimizerService);
  });

  afterEach(() => {
    service.clearCache();
  });

  it('returns cached entry when within TTL', () => {
    fc.assert(
      fc.property(
        cacheKeyArb,
        ragResponseArb,
        fc.integer({ min: 60, max: 86400 }), // TTL in seconds
        (key, response, ttl) => {
          service.clearCache();

          // Cache with a generous TTL — lookup should succeed immediately
          service.cacheQuery(key, response, ttl);

          const cached = service.getCachedQuery<typeof response>(key);

          // Within TTL: must return the cached data
          expect(cached).not.toBeNull();
          expect(cached).toEqual(response);
        },
      ),
      { numRuns: 10 },
    );
  });

  it('returns null when TTL has expired', () => {
    fc.assert(
      fc.property(
        cacheKeyArb,
        ragResponseArb,
        fc.integer({ min: 1, max: 3600 }), // TTL in seconds
        (key, response, ttl) => {
          const freshService = new PerformanceOptimizerService();

          // Cache the entry now
          freshService.cacheQuery(key, response, ttl);

          // Override Date.now to simulate time passing beyond TTL
          // The getCachedQuery method uses: Date.now() - entry.timestamp.getTime()
          // entry.timestamp was set via new Date() at insertion time
          const insertionTime = Date.now();
          const originalDateNow = Date.now;
          Date.now = () => insertionTime + (ttl + 1) * 1000;

          const cached = freshService.getCachedQuery<typeof response>(key);

          // Restore Date.now
          Date.now = originalDateNow;

          // TTL exceeded: must return null
          expect(cached).toBeNull();
        },
      ),
      { numRuns: 10 },
    );
  });

  it('expired entries are removed from cache on lookup', () => {
    fc.assert(
      fc.property(
        cacheKeyArb,
        ragResponseArb,
        fc.integer({ min: 1, max: 3600 }), // TTL in seconds
        (key, response, ttl) => {
          const freshService = new PerformanceOptimizerService();

          // Cache with given TTL
          freshService.cacheQuery(key, response, ttl);

          const sizeBefore = freshService.getCacheMetrics().size;
          expect(sizeBefore).toBe(1);

          // Override Date.now to simulate time passing beyond TTL
          const insertionTime = Date.now();
          const originalDateNow = Date.now;
          Date.now = () => insertionTime + (ttl + 1) * 1000;

          // Lookup triggers expiry removal
          freshService.getCachedQuery(key);

          // Restore Date.now
          Date.now = originalDateNow;

          const sizeAfter = freshService.getCacheMetrics().size;
          expect(sizeAfter).toBe(0);
        },
      ),
      { numRuns: 10 },
    );
  });
});
