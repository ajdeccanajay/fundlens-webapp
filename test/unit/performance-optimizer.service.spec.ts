import { Test, TestingModule } from '@nestjs/testing';
import { PerformanceOptimizerService } from '../../src/rag/performance-optimizer.service';

describe('PerformanceOptimizerService', () => {
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

  describe('Cache Operations', () => {
    it('should generate consistent cache keys', () => {
      const query = 'What is NVDA revenue?';
      const key1 = service.generateCacheKey(query);
      const key2 = service.generateCacheKey(query);
      
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different queries', () => {
      const key1 = service.generateCacheKey('NVDA revenue');
      const key2 = service.generateCacheKey('AAPL revenue');
      
      expect(key1).not.toBe(key2);
    });

    it('should cache and retrieve query results', () => {
      const key = service.generateCacheKey('test query');
      const data = { answer: 'test answer' };
      
      service.cacheQuery(key, data, 3600);
      const cached = service.getCachedQuery(key);
      
      expect(cached).toEqual(data);
    });

    it('should return null for cache miss', () => {
      const cached = service.getCachedQuery('nonexistent-key');
      expect(cached).toBeNull();
    });

    it('should track cache hits and misses', () => {
      const key = service.generateCacheKey('test');
      service.cacheQuery(key, { data: 'test' }, 3600);
      
      service.getCachedQuery(key); // hit
      service.getCachedQuery('missing'); // miss
      
      const metrics = service.getCacheMetrics();
      expect(metrics.hits).toBe(1);
      expect(metrics.misses).toBe(1);
      expect(metrics.hitRate).toBe(0.5);
    });

    it('should evict oldest entry when cache is full', () => {
      // Clear cache first
      service.clearCache();
      service.configure({ maxSize: 2 });
      
      service.cacheQuery('key1', { data: '1' }, 3600);
      expect(service.getCacheMetrics().size).toBe(1);
      
      service.cacheQuery('key2', { data: '2' }, 3600);
      expect(service.getCacheMetrics().size).toBe(2);
      
      // Add a small delay to ensure timestamps are different
      const now = Date.now();
      while (Date.now() - now < 10) {
        // Wait 10ms
      }
      
      service.cacheQuery('key3', { data: '3' }, 3600);
      
      const metrics = service.getCacheMetrics();
      expect(metrics.size).toBe(2); // Should maintain max size
      expect(metrics.evictions).toBe(1); // Should have evicted one
      
      // Verify key1 was evicted (oldest)
      expect(service.getCachedQuery('key1')).toBeNull();
      expect(service.getCachedQuery('key2')).not.toBeNull();
      expect(service.getCachedQuery('key3')).not.toBeNull();
    });
  });

  describe('TTL Configuration', () => {
    it('should return correct TTL for latest queries', () => {
      const intent = { periodType: 'latest' };
      const ttl = service.getCacheTTL(intent);
      expect(ttl).toBe(3600); // 1 hour
    });

    it('should return correct TTL for historical queries', () => {
      const intent = { period: 'FY2023' };
      const ttl = service.getCacheTTL(intent);
      expect(ttl).toBe(86400); // 24 hours
    });

    it('should return correct TTL for semantic queries', () => {
      const intent = { type: 'semantic' };
      const ttl = service.getCacheTTL(intent);
      expect(ttl).toBe(21600); // 6 hours
    });
  });

  describe('Complexity Assessment', () => {
    it('should assess simple query as simple', () => {
      const intent = {
        ticker: 'NVDA',
        metrics: ['Revenue'],
        type: 'structured',
      };
      
      const complexity = service.assessComplexity(intent);
      expect(complexity.level).toBe('simple');
    });

    it('should assess multi-company query as complex', () => {
      const intent = {
        ticker: ['NVDA', 'AAPL', 'MSFT'],
        metrics: ['Revenue'],
        type: 'structured',
      };
      
      const complexity = service.assessComplexity(intent);
      expect(complexity.score).toBeGreaterThanOrEqual(30);
      expect(complexity.factors).toContain('Multi-company comparison');
    });

    it('should assess computation query as complex', () => {
      const intent = {
        ticker: 'NVDA',
        metrics: ['Revenue', 'Net_Income'],
        needsComputation: true,
        type: 'hybrid',
      };
      
      const complexity = service.assessComplexity(intent);
      expect(complexity.score).toBeGreaterThanOrEqual(20);
      expect(complexity.factors).toContain('Requires computation');
    });

    it('should assess hybrid query correctly', () => {
      const intent = {
        ticker: 'NVDA',
        metrics: ['Revenue'],
        type: 'hybrid',
      };
      
      const complexity = service.assessComplexity(intent);
      expect(complexity.score).toBeGreaterThan(0);
      expect(complexity.factors).toContain('Hybrid query (metrics + narrative)');
    });
  });

  describe('Model Tier Selection', () => {
    it('should select Haiku for simple queries', () => {
      const complexity = { level: 'simple' as const, factors: [], estimatedTokens: 100, score: 10 };
      const tier = service.selectModelTier(complexity);
      expect(tier).toBe('haiku');
    });

    it('should select Sonnet for medium queries', () => {
      const complexity = { level: 'medium' as const, factors: [], estimatedTokens: 500, score: 30 };
      const tier = service.selectModelTier(complexity);
      expect(tier).toBe('sonnet');
    });

    it('should select Opus for complex queries', () => {
      const complexity = { level: 'complex' as const, factors: [], estimatedTokens: 1000, score: 60 };
      const tier = service.selectModelTier(complexity);
      expect(tier).toBe('opus');
    });

    it('should return correct model IDs', () => {
      expect(service.getModelId('haiku')).toContain('haiku');
      expect(service.getModelId('sonnet')).toContain('sonnet');
      expect(service.getModelId('opus')).toContain('opus');
    });
  });

  describe('LLM Usage Decision', () => {
    it('should skip LLM for simple metric lookups', () => {
      const intent = { type: 'structured', needsNarrative: false };
      const metrics = [{ value: 100 }];
      const narratives = [];
      
      const shouldUse = service.shouldUseLLM(intent, metrics, narratives);
      expect(shouldUse).toBe(false);
    });

    it('should skip LLM when no data found', () => {
      const intent = { type: 'structured' };
      const metrics = [];
      const narratives = [];
      
      const shouldUse = service.shouldUseLLM(intent, metrics, narratives);
      expect(shouldUse).toBe(false);
    });

    it('should use LLM for hybrid queries', () => {
      const intent = { type: 'hybrid' };
      const metrics = [{ value: 100 }];
      const narratives = [{ content: 'text' }];
      
      const shouldUse = service.shouldUseLLM(intent, metrics, narratives);
      expect(shouldUse).toBe(true);
    });

    it('should use LLM when narrative needed', () => {
      const intent = { type: 'structured', needsNarrative: true };
      const metrics = [{ value: 100 }];
      const narratives = [];
      
      const shouldUse = service.shouldUseLLM(intent, metrics, narratives);
      expect(shouldUse).toBe(true);
    });
  });

  describe('Token Budget Management', () => {
    it('should enforce token budget', () => {
      const chunks = [
        { content: 'a'.repeat(1000), score: 0.9 },
        { content: 'b'.repeat(1000), score: 0.8 },
        { content: 'c'.repeat(1000), score: 0.7 },
      ];
      
      const selected = service.enforceTokenBudget(chunks, 500);
      
      // Should select highest scoring chunks that fit
      expect(selected.length).toBeLessThan(chunks.length);
      expect(selected[0].score).toBe(0.9);
    });

    it('should sort by relevance score', () => {
      const chunks = [
        { content: 'a'.repeat(100), score: 0.5 },
        { content: 'b'.repeat(100), score: 0.9 },
        { content: 'c'.repeat(100), score: 0.7 },
      ];
      
      const selected = service.enforceTokenBudget(chunks, 1000);
      
      expect(selected[0].score).toBe(0.9);
      expect(selected[1].score).toBe(0.7);
      expect(selected[2].score).toBe(0.5);
    });
  });

  describe('Optimization Decisions', () => {
    it('should make comprehensive optimization decisions', () => {
      const query = 'What is NVDA revenue?';
      const intent = {
        ticker: 'NVDA',
        metrics: ['Revenue'],
        type: 'structured',
      };
      
      const decisions = service.makeOptimizationDecisions(query, intent);
      
      expect(decisions.useCache).toBe(true);
      expect(decisions.cacheKey).toBeDefined();
      expect(decisions.modelTier).toBeDefined();
      expect(decisions.maxTokens).toBeGreaterThan(0);
      expect(decisions.reasoning).toBeInstanceOf(Array);
      expect(decisions.reasoning.length).toBeGreaterThan(0);
    });

    it('should enable parallel execution for hybrid queries', () => {
      const intent = { type: 'hybrid' };
      const decisions = service.makeOptimizationDecisions('test', intent);
      
      expect(decisions.parallelExecution).toBe(true);
    });

    it('should disable parallel execution for non-hybrid queries', () => {
      const intent = { type: 'structured' };
      const decisions = service.makeOptimizationDecisions('test', intent);
      
      expect(decisions.parallelExecution).toBe(false);
    });
  });

  describe('Parallel Execution', () => {
    it('should execute tasks in parallel', async () => {
      const task1 = Promise.resolve('result1');
      const task2 = Promise.resolve('result2');
      const task3 = Promise.resolve('result3');
      
      const results = await service.executeParallel([task1, task2, task3]);
      
      expect(results).toEqual(['result1', 'result2', 'result3']);
    });

    it('should handle errors gracefully in safe mode', async () => {
      const task1 = Promise.resolve('result1');
      const task2 = Promise.reject(new Error('failed'));
      const task3 = Promise.resolve('result3');
      
      const results = await service.executeParallelSafe([task1, task2, task3]);
      
      expect(results[0]).toBe('result1');
      expect(results[1]).toBeNull();
      expect(results[2]).toBe('result3');
    });
  });

  describe('Configuration', () => {
    it('should allow cache configuration', () => {
      service.configure({
        enabled: false,
        maxSize: 500,
      });
      
      const key = service.generateCacheKey('test');
      service.cacheQuery(key, { data: 'test' }, 3600);
      
      // Cache disabled, should return null
      const cached = service.getCachedQuery(key);
      expect(cached).toBeNull();
    });
  });

  describe('Summary', () => {
    it('should generate summary', () => {
      service.cacheQuery('key1', { data: '1' }, 3600);
      service.getCachedQuery('key1');
      service.getCachedQuery('missing');
      
      const summary = service.getSummary();
      
      expect(summary).toContain('Cache Hit Rate');
      expect(summary).toContain('Cache Size');
      expect(summary).toContain('TTL Configuration');
    });
  });
});
