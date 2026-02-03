/**
 * E2E Tests: Metric Normalization
 * 
 * Feature: metric-normalization-enhancement
 * Property 5: Overall Accuracy
 * Property 9: Fallback Order
 * 
 * Validates: Requirements BR-2.5, FR-1
 * 
 * Tests the complete query flow:
 * User Query → MetricMappingService → Metric Resolution
 */

import { Test, TestingModule } from '@nestjs/testing';
import { MetricMappingService } from '../../src/rag/metric-mapping.service';

describe('Metric Normalization E2E', () => {
  let service: MetricMappingService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricMappingService],
    }).compile();

    service = module.get<MetricMappingService>(MetricMappingService);
    await service.onModuleInit();
  });

  describe('Real-World Query Scenarios', () => {
    it('should resolve AAPL "cost of goods sold" query', async () => {
      const result = await service.resolve('cost of goods sold', 'AAPL');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cost_of_revenue');
      expect(result?.confidence).toBe(1.0);
      expect(result?.method).toBe('exact');
      expect(result?.canonicalName).toContain('Cost');
    });

    it('should resolve AAPL "cost of sales" query', async () => {
      const result = await service.resolve('cost of sales', 'AAPL');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cost_of_revenue');
      expect(result?.confidence).toBe(1.0);
    });

    it('should resolve AAPL "cogs" abbreviation', async () => {
      const result = await service.resolve('cogs', 'AAPL');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cost_of_revenue');
      expect(result?.confidence).toBe(1.0);
    });

    it('should resolve "cash and cash equivalents" query', async () => {
      const result = await service.resolve('cash and cash equivalents');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cash');
      expect(result?.confidence).toBe(1.0);
    });

    it('should resolve "cash equivalents" query', async () => {
      const result = await service.resolve('cash equivalents');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cash');
    });

    it('should resolve MSFT "revenue" query', async () => {
      const result = await service.resolve('revenue', 'MSFT');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('revenue');
      expect(result?.confidence).toBe(1.0);
    });

    it('should resolve JPM "net interest income" query', async () => {
      const result = await service.resolve('net interest income', 'JPM');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('net_interest_income');
      expect(result?.confidence).toBe(1.0);
    });

    it('should resolve "ebitda" query', async () => {
      const result = await service.resolve('ebitda');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('ebitda');
      expect(result?.confidence).toBe(1.0);
    });

    it('should resolve "free cash flow" query', async () => {
      const result = await service.resolve('free cash flow');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('fcf');
      expect(result?.confidence).toBe(1.0);
    });

    it('should resolve "fcf" abbreviation', async () => {
      const result = await service.resolve('fcf');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('fcf');
    });
  });

  describe('Fallback Order Verification', () => {
    it('should try exact match first', async () => {
      const result = await service.resolve('revenue');
      
      expect(result?.method).toBe('exact');
      expect(result?.confidence).toBe(1.0);
    });

    it('should fall back to learned cache when no exact match', async () => {
      // Add to learned cache
      const customMatch = {
        metricId: 'revenue',
        confidence: 0.95,
        method: 'semantic' as const,
        matchedSynonym: 'e2e_test_query_123',
        canonicalName: 'Revenue',
      };
      service.learnQuery('e2e_test_query_123', customMatch);
      
      const result = await service.resolve('e2e_test_query_123');
      
      expect(result?.method).toBe('semantic');
      expect(result?.confidence).toBe(0.95);
    });

    it('should return null when no match found', async () => {
      const result = await service.resolve('this_definitely_does_not_exist_xyz_999');
      
      expect(result).toBeNull();
    });
  });

  describe('Case Variations', () => {
    it('should handle uppercase queries', async () => {
      const result = await service.resolve('COST OF GOODS SOLD');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cost_of_revenue');
    });

    it('should handle mixed case queries', async () => {
      const result = await service.resolve('Cost Of Goods Sold');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cost_of_revenue');
    });

    it('should handle lowercase queries', async () => {
      const result = await service.resolve('cost of goods sold');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cost_of_revenue');
    });
  });

  describe('Whitespace Variations', () => {
    it('should handle extra spaces', async () => {
      const result = await service.resolve('cost  of  goods  sold');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cost_of_revenue');
    });

    it('should handle leading/trailing spaces', async () => {
      const result = await service.resolve('  cost of goods sold  ');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cost_of_revenue');
    });

    it('should handle tabs and newlines', async () => {
      const result = await service.resolve('cost\tof\ngoods\tsold');
      
      expect(result).toBeDefined();
      expect(result?.metricId).toBe('cost_of_revenue');
    });
  });

  describe('Common Financial Metrics', () => {
    const testCases = [
      { query: 'revenue', expectedId: 'revenue' },
      { query: 'net income', expectedId: 'net_income' },
      { query: 'total assets', expectedId: 'total_assets' },
      { query: 'total liabilities', expectedId: 'total_liabilities' },
      { query: 'shareholders equity', expectedId: 'shareholders_equity' },
      { query: 'operating cash flow', expectedId: 'operating_cash_flow' },
      { query: 'capital expenditures', expectedId: 'capex' },
      { query: 'gross profit', expectedId: 'gross_profit' },
      { query: 'operating income', expectedId: 'ebit' }, // operating income = ebit
      { query: 'depreciation and amortization', expectedId: 'depreciation_amortization' },
    ];

    testCases.forEach(({ query, expectedId }) => {
      it(`should resolve "${query}" to "${expectedId}"`, async () => {
        const result = await service.resolve(query);
        
        expect(result).toBeDefined();
        expect(result?.metricId).toBe(expectedId);
        expect(result?.confidence).toBe(1.0);
        expect(result?.method).toBe('exact');
      });
    });
  });

  describe('Performance Under Load', () => {
    it('should handle 1000 queries efficiently', async () => {
      const queries = [
        'revenue',
        'cost of goods sold',
        'net income',
        'cash',
        'total assets',
      ];

      const start = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        const query = queries[i % queries.length];
        await service.resolve(query);
      }
      
      const duration = Date.now() - start;
      const avgDuration = duration / 1000;
      
      // Should average < 1ms per query
      expect(avgDuration).toBeLessThan(1);
    });

    it('should maintain accuracy under load', async () => {
      const queries = [
        { query: 'revenue', expected: 'revenue' },
        { query: 'cogs', expected: 'cost_of_revenue' },
        { query: 'net income', expected: 'net_income' },
        { query: 'cash', expected: 'cash' },
        { query: 'fcf', expected: 'fcf' },
      ];

      let successCount = 0;
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        for (const { query, expected } of queries) {
          const result = await service.resolve(query);
          if (result?.metricId === expected) {
            successCount++;
          }
        }
      }

      const accuracy = successCount / (iterations * queries.length);
      
      // Should maintain 100% accuracy
      expect(accuracy).toBe(1.0);
    });
  });

  describe('Explainability', () => {
    it('should explain how queries match metrics', async () => {
      const explanation = await service.explainMatch('cogs', 'cost_of_revenue');
      
      expect(explanation).toBeDefined();
      expect(explanation?.query).toBe('cogs');
      expect(explanation?.metricId).toBe('cost_of_revenue');
      expect(explanation?.confidence).toBe(1.0);
      expect(explanation?.method).toBe('exact');
      expect(explanation?.matchedSynonym).toBeDefined();
      expect(explanation?.allSynonyms).toBeDefined();
      expect(explanation?.allSynonyms.length).toBeGreaterThan(0);
    });

    it('should provide all synonyms for debugging', () => {
      const synonyms = service.getSynonyms('cost_of_revenue');
      
      expect(synonyms).toBeDefined();
      expect(synonyms.length).toBeGreaterThan(5);
      expect(synonyms.some(s => s.toLowerCase().includes('cogs'))).toBe(true);
      expect(synonyms.some(s => s.toLowerCase().includes('cost of goods sold'))).toBe(true);
    });
  });
});
