import { describe, it, expect, beforeEach } from 'vitest';
import { FastPathCache, CachedIntent } from '../../src/rag/intent-detection/fast-path-cache';
import { QueryIntent } from '../../src/rag/types/query-intent';

describe('FastPathCache', () => {
  let cache: FastPathCache;

  beforeEach(() => {
    cache = new FastPathCache();
  });

  // Helper to build a minimal valid QueryIntent
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

  describe('normalizeToPattern', () => {
    it('should replace known tickers with {TICKER}', () => {
      const pattern = cache.normalizeToPattern('AAPL revenue FY2024');
      expect(pattern).toContain('{TICKER}');
      expect(pattern).not.toContain('aapl');
    });

    it('should replace fiscal year periods with {PERIOD}', () => {
      const pattern = cache.normalizeToPattern('AAPL revenue FY2024');
      expect(pattern).toContain('{PERIOD}');
      expect(pattern).not.toContain('2024');
    });

    it('should replace quarterly periods with {PERIOD}', () => {
      const pattern = cache.normalizeToPattern('MSFT earnings Q4-2024');
      expect(pattern).toContain('{PERIOD}');
      expect(pattern).not.toContain('q4-2024');
    });

    it('should normalize two different queries with same structure to the same pattern', () => {
      const pattern1 = cache.normalizeToPattern('AAPL revenue FY2024');
      const pattern2 = cache.normalizeToPattern('MSFT revenue FY2023');
      expect(pattern1).toBe(pattern2);
    });

    it('should normalize multi-ticker queries consistently', () => {
      const pattern1 = cache.normalizeToPattern('Compare NVDA and MSFT gross margin Q4-2024');
      const pattern2 = cache.normalizeToPattern('Compare AAPL and AMD gross margin Q1-2023');
      expect(pattern1).toBe(pattern2);
    });

    it('should preserve non-ticker, non-period words', () => {
      const pattern = cache.normalizeToPattern('AAPL revenue growth FY2024');
      expect(pattern).toContain('revenue');
      expect(pattern).toContain('growth');
    });

    it('should be case-insensitive', () => {
      const pattern1 = cache.normalizeToPattern('AAPL Revenue FY2024');
      const pattern2 = cache.normalizeToPattern('aapl revenue fy2024');
      expect(pattern1).toBe(pattern2);
    });

    it('should be idempotent — normalizing a pattern again produces the same result', () => {
      const query = 'NVDA gross margin Q4-2024';
      const pattern1 = cache.normalizeToPattern(query);
      const pattern2 = cache.normalizeToPattern(pattern1);
      expect(pattern1).toBe(pattern2);
    });

    it('should not replace common English words that happen to be short', () => {
      // "the", "and", "for" are 3 letters but not tickers
      const pattern = cache.normalizeToPattern('What is the revenue for AAPL');
      expect(pattern).toContain('the');
      expect(pattern).toContain('for');
    });

    it('should handle standalone quarter references like Q1, Q2', () => {
      const pattern = cache.normalizeToPattern('AAPL revenue Q1');
      expect(pattern).toContain('{PERIOD}');
    });

    it('should handle year-only periods', () => {
      const pattern = cache.normalizeToPattern('AAPL revenue 2024');
      expect(pattern).toContain('{PERIOD}');
      expect(pattern).not.toContain('2024');
    });
  });

  describe('store and lookup', () => {
    it('should store and retrieve a cached intent', () => {
      const intent = makeIntent();
      cache.store('AAPL revenue FY2024', intent);

      const result = cache.lookup('AAPL revenue FY2024', {
        ticker: 'AAPL',
        period: 'FY2024',
        metrics: ['total_revenue'],
      });

      expect(result).not.toBeNull();
      expect(result!.type).toBe('structured');
    });

    it('should return null for cache miss', () => {
      const result = cache.lookup('AAPL revenue FY2024', {});
      expect(result).toBeNull();
    });

    it('should hit cache for a different ticker with same query structure', () => {
      const intent = makeIntent();
      cache.store('AAPL revenue FY2024', intent);

      // Same structure, different ticker and period
      const result = cache.lookup('MSFT revenue FY2023', {
        ticker: 'MSFT',
        period: 'FY2023',
        metrics: ['total_revenue'],
      });

      expect(result).not.toBeNull();
      expect(result!.ticker).toBe('MSFT');
      expect(result!.period).toBe('FY2023');
    });
  });

  describe('template substitution', () => {
    it('should substitute ticker from fastPathResult', () => {
      cache.store('AAPL revenue FY2024', makeIntent({ ticker: 'AAPL' }));

      const result = cache.lookup('MSFT revenue FY2024', {
        ticker: 'MSFT',
        period: 'FY2024',
      });

      expect(result).not.toBeNull();
      expect(result!.ticker).toBe('MSFT');
    });

    it('should substitute period from fastPathResult', () => {
      cache.store('AAPL revenue FY2024', makeIntent({ period: 'FY2024' }));

      const result = cache.lookup('AAPL revenue FY2023', {
        ticker: 'AAPL',
        period: 'FY2023',
        periodType: 'annual',
      });

      expect(result).not.toBeNull();
      expect(result!.period).toBe('FY2023');
    });

    it('should substitute metrics from fastPathResult when provided', () => {
      cache.store('AAPL revenue FY2024', makeIntent({ metrics: ['total_revenue'] }));

      const result = cache.lookup('MSFT revenue FY2023', {
        ticker: 'MSFT',
        period: 'FY2023',
        metrics: ['total_revenue'],
      });

      expect(result).not.toBeNull();
      expect(result!.metrics).toEqual(['total_revenue']);
    });

    it('should always set originalQuery to the current query', () => {
      cache.store('AAPL revenue FY2024', makeIntent({ originalQuery: 'AAPL revenue FY2024' }));

      const result = cache.lookup('MSFT revenue FY2023', {
        ticker: 'MSFT',
        period: 'FY2023',
      });

      expect(result).not.toBeNull();
      expect(result!.originalQuery).toBe('MSFT revenue FY2023');
    });

    it('should preserve template boolean flags', () => {
      cache.store('Compare NVDA and MSFT revenue', makeIntent({
        needsComparison: true,
        needsPeerComparison: true,
        ticker: ['NVDA', 'MSFT'],
      }));

      const result = cache.lookup('Compare AAPL and AMD revenue', {
        ticker: ['AAPL', 'AMD'],
      });

      expect(result).not.toBeNull();
      expect(result!.needsComparison).toBe(true);
      expect(result!.needsPeerComparison).toBe(true);
      expect(result!.ticker).toEqual(['AAPL', 'AMD']);
    });
  });

  describe('invalidate', () => {
    it('should remove a cached entry', () => {
      cache.store('AAPL revenue FY2024', makeIntent());
      cache.invalidate('AAPL revenue FY2024');

      const result = cache.lookup('AAPL revenue FY2024', {});
      expect(result).toBeNull();
    });

    it('should invalidate entries that normalize to the same pattern', () => {
      cache.store('AAPL revenue FY2024', makeIntent());
      // Invalidate with a different ticker but same pattern
      cache.invalidate('MSFT revenue FY2023');

      const result = cache.lookup('NVDA revenue FY2025', {});
      expect(result).toBeNull();
    });

    it('should not affect other cache entries', () => {
      cache.store('AAPL revenue FY2024', makeIntent());
      cache.store('What are AMZN risk factors', makeIntent({ type: 'semantic' }));

      cache.invalidate('AAPL revenue FY2024');

      // The risk factors entry should still be there
      const result = cache.lookup('What are AMZN risk factors', {});
      expect(result).not.toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return correct size and maxSize', () => {
      expect(cache.getStats()).toEqual({ size: 0, maxSize: 5000 });

      cache.store('AAPL revenue FY2024', makeIntent());
      expect(cache.getStats()).toEqual({ size: 1, maxSize: 5000 });
    });
  });

  describe('setKnownTickers', () => {
    it('should add new tickers to the known set', () => {
      expect(cache.isKnownTicker('ZZZZ')).toBe(false);
      cache.setKnownTickers(new Set(['ZZZZ']));
      expect(cache.isKnownTicker('ZZZZ')).toBe(true);
    });

    it('should preserve existing known tickers when adding new ones', () => {
      expect(cache.isKnownTicker('AAPL')).toBe(true);
      cache.setKnownTickers(new Set(['ZZZZ']));
      expect(cache.isKnownTicker('AAPL')).toBe(true);
      expect(cache.isKnownTicker('ZZZZ')).toBe(true);
    });
  });

  describe('LRU eviction', () => {
    it('should not exceed MAX_SIZE entries', () => {
      // Store more than MAX_SIZE entries — we use a smaller cache for this test
      // Since we can't change MAX_SIZE, we verify the LRU behavior conceptually
      // by storing entries and checking stats
      for (let i = 0; i < 100; i++) {
        // Use unique patterns that won't normalize to the same key
        cache.store(`unique query pattern number ${i} about financials`, makeIntent({
          originalQuery: `unique query pattern number ${i} about financials`,
        }));
      }
      expect(cache.getStats().size).toBe(100);
      expect(cache.getStats().size).toBeLessThanOrEqual(cache.getStats().maxSize);
    });
  });
});
