import { Test, TestingModule } from '@nestjs/testing';
import { PerformanceOptimizerService } from '../../src/rag/performance-optimizer.service';

describe('Cache Invalidation', () => {
  let service: PerformanceOptimizerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PerformanceOptimizerService],
    }).compile();

    service = module.get<PerformanceOptimizerService>(PerformanceOptimizerService);
  });

  afterEach(() => {
    service.clearCache();
  });

  describe('invalidateByTicker removes correct entries', () => {
    it('should remove all cache entries for the specified ticker and leave others intact', () => {
      // Cache entries for multiple tickers
      service.cacheQuery('query-nvda-revenue', { answer: 'NVDA revenue is $60B' }, 3600, 'NVDA');
      service.cacheQuery('query-nvda-income', { answer: 'NVDA net income is $30B' }, 3600, 'NVDA');
      service.cacheQuery('query-aapl-revenue', { answer: 'AAPL revenue is $380B' }, 3600, 'AAPL');
      service.cacheQuery('query-msft-revenue', { answer: 'MSFT revenue is $210B' }, 3600, 'MSFT');

      expect(service.getCacheMetrics().size).toBe(4);

      const removed = service.invalidateByTicker('NVDA');

      expect(removed).toBe(2);
      expect(service.getCacheMetrics().size).toBe(2);

      // NVDA entries gone
      expect(service.getCachedQuery('query-nvda-revenue')).toBeNull();
      expect(service.getCachedQuery('query-nvda-income')).toBeNull();

      // Other tickers untouched
      expect(service.getCachedQuery('query-aapl-revenue')).toEqual({ answer: 'AAPL revenue is $380B' });
      expect(service.getCachedQuery('query-msft-revenue')).toEqual({ answer: 'MSFT revenue is $210B' });
    });

    it('should be case-insensitive for ticker matching', () => {
      service.cacheQuery('key1', { data: 'test' }, 3600, 'nvda');

      const removed = service.invalidateByTicker('NVDA');

      expect(removed).toBe(1);
      expect(service.getCachedQuery('key1')).toBeNull();
    });

    it('should increment the eviction counter by the number of removed entries', () => {
      service.cacheQuery('key1', { data: '1' }, 3600, 'AAPL');
      service.cacheQuery('key2', { data: '2' }, 3600, 'AAPL');
      service.cacheQuery('key3', { data: '3' }, 3600, 'AAPL');

      const evictionsBefore = service.getCacheMetrics().evictions;
      service.invalidateByTicker('AAPL');
      const evictionsAfter = service.getCacheMetrics().evictions;

      expect(evictionsAfter - evictionsBefore).toBe(3);
    });
  });

  describe('invalidateByTicker with unknown ticker returns 0', () => {
    it('should return 0 when ticker has no cache entries', () => {
      service.cacheQuery('key1', { data: '1' }, 3600, 'NVDA');
      service.cacheQuery('key2', { data: '2' }, 3600, 'AAPL');

      const removed = service.invalidateByTicker('TSLA');

      expect(removed).toBe(0);
      expect(service.getCacheMetrics().size).toBe(2);
    });

    it('should return 0 on an empty cache', () => {
      const removed = service.invalidateByTicker('NVDA');
      expect(removed).toBe(0);
    });

    it('should not change the eviction counter for unknown ticker', () => {
      service.cacheQuery('key1', { data: '1' }, 3600, 'NVDA');

      const evictionsBefore = service.getCacheMetrics().evictions;
      service.invalidateByTicker('UNKNOWN');
      const evictionsAfter = service.getCacheMetrics().evictions;

      expect(evictionsAfter).toBe(evictionsBefore);
    });
  });

  describe('integration with ingestion pipeline trigger', () => {
    it('should invalidate stale cache entries when simulating a filing ingestion', () => {
      // Simulate cached RAG responses for AAPL
      service.cacheQuery('aapl-revenue-trend', { answer: 'AAPL revenue grew 8%' }, 3600, 'AAPL');
      service.cacheQuery('aapl-margin-analysis', { answer: 'AAPL gross margin is 45%' }, 3600, 'AAPL');
      service.cacheQuery('nvda-revenue-trend', { answer: 'NVDA revenue grew 120%' }, 3600, 'NVDA');

      // Simulate what ComprehensiveSECPipelineService and SecProcessingService do
      // after successful filing ingestion: call invalidateByTicker(ticker)
      const invalidated = service.invalidateByTicker('AAPL');

      expect(invalidated).toBe(2);

      // AAPL cache is cleared — next query will go through full RAG pipeline
      expect(service.getCachedQuery('aapl-revenue-trend')).toBeNull();
      expect(service.getCachedQuery('aapl-margin-analysis')).toBeNull();

      // NVDA cache is still valid
      expect(service.getCachedQuery('nvda-revenue-trend')).toEqual({ answer: 'NVDA revenue grew 120%' });
    });

    it('should allow re-caching after invalidation', () => {
      service.cacheQuery('aapl-revenue', { answer: 'old data' }, 3600, 'AAPL');
      service.invalidateByTicker('AAPL');

      // After ingestion completes, new queries get cached with fresh data
      service.cacheQuery('aapl-revenue', { answer: 'new data after filing' }, 3600, 'AAPL');

      expect(service.getCachedQuery('aapl-revenue')).toEqual({ answer: 'new data after filing' });
    });
  });
});
