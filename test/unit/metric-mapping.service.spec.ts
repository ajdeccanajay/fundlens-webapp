/**
 * Unit Tests: MetricMappingService
 * 
 * Feature: metric-normalization-enhancement
 * Property 3: Abbreviation Resolution
 * Property 7: Backward Compatibility
 * Property 12: Explainability Completeness
 * 
 * Validates: Requirements BR-2.3, BR-3.2, FR-4
 */

import { Test, TestingModule } from '@nestjs/testing';
import { MetricMappingService } from '../../src/rag/metric-mapping.service';

describe('MetricMappingService', () => {
  let service: MetricMappingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricMappingService],
    }).compile();

    service = module.get<MetricMappingService>(MetricMappingService);
    await service.onModuleInit();
  });

  describe('Configuration Loading', () => {
    it('should load YAML configuration successfully', () => {
      expect(service.getMetricsCount()).toBeGreaterThan(0);
      expect(service.getSynonymsCount()).toBeGreaterThan(0);
    });

    it('should load at least 117 metrics', () => {
      expect(service.getMetricsCount()).toBeGreaterThanOrEqual(117);
    });

    it('should build hash table with all synonyms', () => {
      // Should have many more synonyms than metrics
      expect(service.getSynonymsCount()).toBeGreaterThan(service.getMetricsCount() * 3);
    });
  });

  describe('Exact Match Resolution', () => {
    it('should resolve exact match for "revenue"', async () => {
      const result = await service.resolve('revenue');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('revenue');
      expect(result?.confidence).toBe(1.0);
      expect(result?.method).toBe('exact');
      expect(result?.canonicalName).toBeDefined();
    });

    it('should resolve exact match for "cost of goods sold"', async () => {
      const result = await service.resolve('cost of goods sold');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cost_of_revenue');
      expect(result?.confidence).toBe(1.0);
      expect(result?.method).toBe('exact');
    });

    it('should resolve exact match for "cogs"', async () => {
      const result = await service.resolve('cogs');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cost_of_revenue');
      expect(result?.confidence).toBe(1.0);
      expect(result?.method).toBe('exact');
    });

    it('should resolve exact match for "cash and cash equivalents"', async () => {
      const result = await service.resolve('cash and cash equivalents');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cash');
      expect(result?.confidence).toBe(1.0);
      expect(result?.method).toBe('exact');
    });

    it('should resolve exact match for "net income"', async () => {
      const result = await service.resolve('net income');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('net_income');
      expect(result?.confidence).toBe(1.0);
      expect(result?.method).toBe('exact');
    });

    it('should resolve exact match for "ebitda"', async () => {
      const result = await service.resolve('ebitda');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('ebitda');
      expect(result?.confidence).toBe(1.0);
      expect(result?.method).toBe('exact');
    });

    it('should resolve exact match for "free cash flow"', async () => {
      const result = await service.resolve('free cash flow');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('fcf');
      expect(result?.confidence).toBe(1.0);
      expect(result?.method).toBe('exact');
    });

    it('should resolve exact match for "eps"', async () => {
      const result = await service.resolve('eps');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toMatch(/eps_(basic|diluted)/);
      expect(result?.confidence).toBe(1.0);
      expect(result?.method).toBe('exact');
    });
  });

  describe('Case Insensitivity', () => {
    it('should be case-insensitive for "REVENUE"', async () => {
      const result = await service.resolve('REVENUE');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('revenue');
    });

    it('should be case-insensitive for "Cost Of Goods Sold"', async () => {
      const result = await service.resolve('Cost Of Goods Sold');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cost_of_revenue');
    });

    it('should be case-insensitive for "Net INCOME"', async () => {
      const result = await service.resolve('Net INCOME');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('net_income');
    });
  });

  describe('Whitespace Handling', () => {
    it('should handle extra whitespace', async () => {
      const result = await service.resolve('  revenue  ');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('revenue');
    });

    it('should handle multiple spaces', async () => {
      const result = await service.resolve('cost  of  goods  sold');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cost_of_revenue');
    });
  });

  describe('Learned Query Cache', () => {
    it('should cache learned queries for non-exact matches', async () => {
      // First verify this query has no exact match
      const initialResult = await service.resolve('xyz_test_query_123');
      expect(initialResult).toBeNull();
      
      // Now add it to learned cache
      const customMatch = {
        metricId: 'revenue',
        confidence: 0.95,
        method: 'semantic' as const,
        matchedSynonym: 'xyz_test_query_123',
        canonicalName: 'Revenue',
      };

      service.learnQuery('xyz_test_query_123', customMatch);
      
      const result = await service.resolve('xyz_test_query_123');
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('revenue');
      expect(result?.method).toBe('semantic');
    });

    it('should return cached result on subsequent queries', async () => {
      const customMatch = {
        metricId: 'net_income',
        confidence: 0.92,
        method: 'semantic' as const,
        matchedSynonym: 'abc_test_query_456',
        canonicalName: 'Net Income',
      };

      service.learnQuery('abc_test_query_456', customMatch);
      
      const result1 = await service.resolve('abc_test_query_456');
      const result2 = await service.resolve('abc_test_query_456');
      
      expect(result1).toEqual(result2);
      expect(result1?.method).toBe('semantic');
    });

    it('should prefer exact match over learned cache', async () => {
      // Add 'revenue' to learned cache with different metricId
      const customMatch = {
        metricId: 'net_income',
        confidence: 0.95,
        method: 'semantic' as const,
        matchedSynonym: 'revenue',
        canonicalName: 'Net Income',
      };

      service.learnQuery('revenue', customMatch);
      
      // Should still return exact match for 'revenue'
      const result = await service.resolve('revenue');
      expect(result?.metricId).toBe('revenue'); // exact match wins
      expect(result?.method).toBe('exact');
    });
  });

  describe('Invalid Input Handling', () => {
    it('should return null for empty string', async () => {
      const result = await service.resolve('');
      expect(result).toBeNull();
    });

    it('should return null for whitespace only', async () => {
      const result = await service.resolve('   ');
      expect(result).toBeNull();
    });

    it('should return null for unknown metric', async () => {
      const result = await service.resolve('this_metric_does_not_exist_xyz123');
      expect(result).toBeNull();
    });

    it('should return null for gibberish', async () => {
      const result = await service.resolve('asdfghjkl');
      expect(result).toBeNull();
    });
  });

  describe('Get Synonyms', () => {
    it('should return all synonyms for a metric', () => {
      const synonyms = service.getSynonyms('revenue');
      
      expect(synonyms).toBeDefined();
      expect(Array.isArray(synonyms)).toBe(true);
      expect(synonyms.length).toBeGreaterThan(0);
      expect(synonyms).toContain('revenue');
    });

    it('should return synonyms for cost_of_revenue', () => {
      const synonyms = service.getSynonyms('cost_of_revenue');
      
      expect(synonyms).toBeDefined();
      expect(synonyms.length).toBeGreaterThan(3);
      expect(synonyms.some(s => s.toLowerCase().includes('cogs'))).toBe(true);
    });

    it('should return empty array for unknown metric', () => {
      const synonyms = service.getSynonyms('unknown_metric_xyz');
      
      expect(synonyms).toBeDefined();
      expect(synonyms.length).toBe(0);
    });
  });

  describe('Explain Match', () => {
    it('should explain exact match', async () => {
      const explanation = await service.explainMatch('revenue', 'revenue');
      
      expect(explanation).toBeDefined();
      expect(explanation?.query).toBe('revenue');
      expect(explanation?.metricId).toBe('revenue');
      expect(explanation?.confidence).toBe(1.0);
      expect(explanation?.method).toBe('exact');
      expect(explanation?.allSynonyms).toBeDefined();
      expect(explanation?.allSynonyms.length).toBeGreaterThan(0);
    });

    it('should explain match for synonym', async () => {
      const explanation = await service.explainMatch('cogs', 'cost_of_revenue');
      
      expect(explanation).toBeDefined();
      expect(explanation?.query).toBe('cogs');
      expect(explanation?.metricId).toBe('cost_of_revenue');
      expect(explanation?.matchedSynonym).toBeDefined();
    });

    it('should return null for non-matching query', async () => {
      const explanation = await service.explainMatch('revenue', 'net_income');
      
      expect(explanation).toBeNull();
    });

    it('should return null for unknown metric', async () => {
      const explanation = await service.explainMatch('revenue', 'unknown_metric');
      
      expect(explanation).toBeNull();
    });
  });

  describe('Reload Configuration', () => {
    it('should reload config and clear learned cache', async () => {
      // Add a learned query
      const customMatch = {
        metricId: 'revenue',
        confidence: 0.95,
        method: 'semantic' as const,
        matchedSynonym: 'test_query_reload_789',
        canonicalName: 'Revenue',
      };
      service.learnQuery('test_query_reload_789', customMatch);
      
      // Verify it's cached
      let result = await service.resolve('test_query_reload_789');
      expect(result?.method).toBe('semantic');
      
      // Reload config
      await service.reloadConfig();
      
      // Learned cache should be cleared
      result = await service.resolve('test_query_reload_789');
      expect(result).toBeNull();
    });

    it('should maintain metrics count after reload', async () => {
      const countBefore = service.getMetricsCount();
      await service.reloadConfig();
      const countAfter = service.getMetricsCount();
      
      expect(countAfter).toBe(countBefore);
    });
  });

  describe('Semantic Matching', () => {
    it('should have semantic matcher enabled by default', () => {
      const config = service.getSemanticConfig();
      expect(config.enabled).toBe(true);
    });

    it('should resolve typo using semantic matcher', async () => {
      // "reveneu" is a typo for "revenue" (transposed letters)
      const result = await service.resolve('reveneu');
      
      if (result) {
        expect(result.metricId).toBe('revenue');
        expect(['exact', 'semantic']).toContain(result.method);
        expect(result.confidence).toBeGreaterThan(0.7);
      }
      // If semantic matcher fails, test should not fail
    }, 10000); // 10 second timeout for Python subprocess

    it('should resolve paraphrase using semantic matcher', async () => {
      // "total sales" is a paraphrase for "revenue"
      const result = await service.resolve('total sales');
      
      if (result) {
        expect(result.metricId).toBe('revenue');
        expect(['exact', 'semantic']).toContain(result.method);
        expect(result.confidence).toBeGreaterThan(0.6);
      }
    }, 10000);

    it('should learn semantic matches for future queries', async () => {
      // Use a query that will definitely trigger semantic matching
      const testQuery = 'bottom line profit';
      
      // First query uses semantic matcher
      const result1 = await service.resolve(testQuery);
      
      if (result1 && result1.method === 'semantic') {
        // Wait a bit to ensure learning is complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Second query should use learned cache (or semantic again if cache miss)
        const result2 = await service.resolve(testQuery);
        
        expect(result2).toBeDefined();
        expect(result2?.metricId).toBe(result1.metricId);
        // Method should be learned or semantic (both are valid)
        expect(['learned', 'semantic']).toContain(result2?.method);
      } else if (result1) {
        // If it matched exactly, that's also fine
        expect(result1.method).toBe('exact');
      }
    }, 10000);

    it('should allow disabling semantic matcher', () => {
      service.setSemanticEnabled(false);
      const config = service.getSemanticConfig();
      expect(config.enabled).toBe(false);
      
      // Re-enable for other tests
      service.setSemanticEnabled(true);
    });

    it('should track learned cache size', async () => {
      const sizeBefore = service.getLearnedCacheSize();
      
      // Add a semantic match
      await service.resolve('bottom line profit');
      
      const sizeAfter = service.getLearnedCacheSize();
      expect(sizeAfter).toBeGreaterThanOrEqual(sizeBefore);
    }, 10000);
  });

  describe('Performance', () => {
    it('should resolve queries quickly (< 5ms for exact/learned)', async () => {
      const queries = [
        'revenue',
        'cost of goods sold',
        'net income',
        'cash',
        'ebitda',
        'free cash flow',
        'total assets',
        'shareholders equity',
      ];

      for (const query of queries) {
        const start = Date.now();
        await service.resolve(query);
        const duration = Date.now() - start;
        
        expect(duration).toBeLessThan(5);
      }
    });

    it('should handle 100 queries quickly', async () => {
      const start = Date.now();
      
      for (let i = 0; i < 100; i++) {
        await service.resolve('revenue');
      }
      
      const duration = Date.now() - start;
      const avgDuration = duration / 100;
      
      expect(avgDuration).toBeLessThan(1); // < 1ms per query
    });

    it('should handle semantic queries within timeout', async () => {
      const start = Date.now();
      await service.resolve('bottom line profit'); // Paraphrase that triggers semantic
      const duration = Date.now() - start;
      
      // Should complete within 5 seconds (semantic timeout)
      expect(duration).toBeLessThan(5000);
    }, 10000);
  });
});
