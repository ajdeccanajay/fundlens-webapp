/**
 * Extended IntentAnalyticsService Unit Tests
 * Tests the new detection methods, detectionPath field, and extended realtime metrics.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { QueryIntent } from '../../src/rag/types/query-intent';

describe('IntentAnalyticsService — Extended Detection Methods', () => {
  let service: IntentAnalyticsService;
  let executeRawMock: ReturnType<typeof vi.fn>;
  let queryRawMock: ReturnType<typeof vi.fn>;

  const mockIntent: QueryIntent = {
    type: 'structured',
    ticker: 'AAPL',
    confidence: 0.95,
    originalQuery: 'AAPL revenue FY2024',
    needsNarrative: false,
    needsComparison: false,
    needsComputation: false,
    needsTrend: false,
  };

  beforeEach(() => {
    executeRawMock = vi.fn().mockResolvedValue(undefined);
    queryRawMock = vi.fn().mockResolvedValue([]);

    const mockPrisma = {
      $executeRaw: executeRawMock,
      $queryRaw: queryRawMock,
    };

    // Directly instantiate with mock prisma to avoid NestJS tagged template issues
    service = new IntentAnalyticsService(mockPrisma as any);
  });

  describe('logDetection with new detection methods', () => {
    it('should accept regex_fast_path as detection method', async () => {
      await service.logDetection({
        tenantId: 'tenant-1',
        query: 'AAPL revenue FY2024',
        detectedIntent: mockIntent,
        detectionMethod: 'regex_fast_path',
        confidence: 0.95,
        success: true,
        latencyMs: 5,
      });

      expect(executeRawMock).toHaveBeenCalled();
    });

    it('should accept cache_hit as detection method', async () => {
      await service.logDetection({
        tenantId: 'tenant-1',
        query: 'MSFT revenue FY2023',
        detectedIntent: { ...mockIntent, ticker: 'MSFT' },
        detectionMethod: 'cache_hit',
        confidence: 0.9,
        success: true,
        latencyMs: 3,
      });

      expect(executeRawMock).toHaveBeenCalled();
    });

    it('should accept llm as detection method with cost', async () => {
      await service.logDetection({
        tenantId: 'tenant-1',
        query: 'Compare NVDA and MSFT gross margin',
        detectedIntent: { ...mockIntent, ticker: ['NVDA', 'MSFT'], needsComparison: true },
        detectionMethod: 'llm',
        confidence: 0.88,
        success: true,
        latencyMs: 350,
        llmCostUsd: 0.0002,
      });

      expect(executeRawMock).toHaveBeenCalled();
    });

    it('should accept fallback as detection method', async () => {
      await service.logDetection({
        tenantId: 'tenant-1',
        query: 'some ambiguous query',
        detectedIntent: { ...mockIntent, type: 'semantic', confidence: 0.4 },
        detectionMethod: 'fallback',
        confidence: 0.4,
        success: true,
        errorMessage: 'LLM timeout after 3s',
        latencyMs: 3100,
      });

      expect(executeRawMock).toHaveBeenCalled();
    });

    it('should still accept legacy detection methods (regex, llm, generic)', async () => {
      for (const method of ['regex', 'llm', 'generic'] as const) {
        executeRawMock.mockClear();
        await service.logDetection({
          tenantId: 'tenant-1',
          query: 'test query',
          detectedIntent: mockIntent,
          detectionMethod: method,
          confidence: 0.8,
          success: true,
          latencyMs: 50,
        });
        expect(executeRawMock).toHaveBeenCalled();
      }
    });
  });

  describe('logDetection with detectionPath', () => {
    it('should log detectionPath for LLM detection', async () => {
      await service.logDetection({
        tenantId: 'tenant-1',
        query: 'How levered is Apple?',
        detectedIntent: mockIntent,
        detectionMethod: 'llm',
        confidence: 0.9,
        success: true,
        latencyMs: 400,
        llmCostUsd: 0.0002,
        detectionPath: 'fast_path_miss → cache_miss → llm',
      });

      expect(executeRawMock).toHaveBeenCalled();
    });

    it('should log detectionPath for cache hit', async () => {
      await service.logDetection({
        tenantId: 'tenant-1',
        query: 'MSFT revenue FY2023',
        detectedIntent: mockIntent,
        detectionMethod: 'cache_hit',
        confidence: 0.9,
        success: true,
        latencyMs: 3,
        detectionPath: 'fast_path_miss → cache_hit',
      });

      expect(executeRawMock).toHaveBeenCalled();
    });

    it('should log detectionPath for fallback', async () => {
      await service.logDetection({
        tenantId: 'tenant-1',
        query: 'vague query',
        detectedIntent: { ...mockIntent, type: 'semantic', confidence: 0.3 },
        detectionMethod: 'fallback',
        confidence: 0.3,
        success: true,
        errorMessage: 'LLM timeout',
        latencyMs: 3200,
        detectionPath: 'fast_path_miss → cache_miss → llm_timeout → fallback',
      });

      expect(executeRawMock).toHaveBeenCalled();
    });

    it('should handle missing detectionPath gracefully (null)', async () => {
      await service.logDetection({
        tenantId: 'tenant-1',
        query: 'AAPL revenue FY2024',
        detectedIntent: mockIntent,
        detectionMethod: 'regex_fast_path',
        confidence: 0.95,
        success: true,
        latencyMs: 5,
        // No detectionPath provided
      });

      expect(executeRawMock).toHaveBeenCalled();
    });
  });

  describe('getRealtimeMetrics with extended fields', () => {
    it('should return fast-path hit rate, cache hit rate, LLM invocation rate, correction rate, and estimated monthly cost', async () => {
      const mockMetrics = {
        total: '100',
        regex_count: '10',
        llm_count: '20',
        fast_path_count: '50',
        cache_hit_count: '15',
        fallback_count: '5',
        correction_count: '3',
        avg_conf: '0.82',
        avg_lat: '95',
        llm_cost: '0.004',
      };

      queryRawMock.mockResolvedValue([mockMetrics]);

      const metrics = await service.getRealtimeMetrics('tenant-1');

      // last24Hours
      expect(metrics.last24Hours.totalQueries).toBe(100);
      expect(metrics.last24Hours.fastPathHitRate).toBe(50); // 50/100 * 100
      expect(metrics.last24Hours.cacheHitRate).toBe(15);     // 15/100 * 100
      expect(metrics.last24Hours.llmInvocationRate).toBe(20); // 20/100 * 100
      expect(metrics.last24Hours.correctionRate).toBe(3);     // 3/100 * 100
      expect(metrics.last24Hours.avgConfidence).toBe(0.82);
      expect(metrics.last24Hours.avgLatencyMs).toBe(95);
      expect(metrics.last24Hours.llmCostUsd).toBe(0.004);
      // Monthly cost projection should be > 0
      expect(metrics.last24Hours.estimatedMonthlyLlmCost).toBeGreaterThan(0);

      // last7Days should also have the new fields
      expect(metrics.last7Days.fastPathHitRate).toBeDefined();
      expect(metrics.last7Days.cacheHitRate).toBeDefined();
      expect(metrics.last7Days.llmInvocationRate).toBeDefined();
      expect(metrics.last7Days.correctionRate).toBeDefined();
      expect(metrics.last7Days.estimatedMonthlyLlmCost).toBeDefined();
    });

    it('should handle zero total queries gracefully', async () => {
      const mockMetrics = {
        total: '0',
        regex_count: '0',
        llm_count: '0',
        fast_path_count: '0',
        cache_hit_count: '0',
        fallback_count: '0',
        correction_count: '0',
        avg_conf: null,
        avg_lat: null,
        llm_cost: '0',
      };

      queryRawMock.mockResolvedValue([mockMetrics]);

      const metrics = await service.getRealtimeMetrics('tenant-1');

      expect(metrics.last24Hours.totalQueries).toBe(0);
      expect(metrics.last24Hours.fastPathHitRate).toBe(0);
      expect(metrics.last24Hours.cacheHitRate).toBe(0);
      expect(metrics.last24Hours.llmInvocationRate).toBe(0);
      expect(metrics.last24Hours.correctionRate).toBe(0);
      expect(metrics.last24Hours.estimatedMonthlyLlmCost).toBe(0);
    });

    it('should project monthly LLM cost from 7-day data', async () => {
      const mockMetrics = {
        total: '700',
        regex_count: '100',
        llm_count: '200',
        fast_path_count: '300',
        cache_hit_count: '80',
        fallback_count: '20',
        correction_count: '10',
        avg_conf: '0.85',
        avg_lat: '120',
        llm_cost: '0.04', // $0.04 over 7 days
      };

      queryRawMock.mockResolvedValue([mockMetrics]);

      const metrics = await service.getRealtimeMetrics('tenant-1');

      // 7-day cost: $0.04, monthly projection: 0.04 / 7 * 30 ≈ $0.1714
      expect(metrics.last7Days.estimatedMonthlyLlmCost).toBeGreaterThan(0.1);
      expect(metrics.last7Days.estimatedMonthlyLlmCost).toBeLessThan(0.25);
    });

    it('should preserve legacy regexSuccessRate and llmFallbackRate fields', async () => {
      const mockMetrics = {
        total: '100',
        regex_count: '30',
        llm_count: '20',
        fast_path_count: '40',
        cache_hit_count: '5',
        fallback_count: '5',
        correction_count: '2',
        avg_conf: '0.78',
        avg_lat: '110',
        llm_cost: '0.003',
      };

      queryRawMock.mockResolvedValue([mockMetrics]);

      const metrics = await service.getRealtimeMetrics('tenant-1');

      // Legacy fields still present and correct
      expect(metrics.last24Hours.regexSuccessRate).toBe(30); // 30/100 * 100
      expect(metrics.last24Hours.llmFallbackRate).toBe(20);  // 20/100 * 100
    });
  });

  describe('Error handling', () => {
    it('should not throw when logging with new detection methods fails', async () => {
      executeRawMock.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.logDetection({
          tenantId: 'tenant-1',
          query: 'test',
          detectedIntent: mockIntent,
          detectionMethod: 'regex_fast_path',
          confidence: 0.95,
          success: true,
          latencyMs: 5,
          detectionPath: 'fast_path_hit',
        }),
      ).resolves.not.toThrow();
    });

    it('should throw when getRealtimeMetrics fails', async () => {
      queryRawMock.mockRejectedValue(new Error('DB error'));

      await expect(service.getRealtimeMetrics('tenant-1')).rejects.toThrow('DB error');
    });
  });
});
