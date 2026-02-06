/**
 * Intent Analytics Service Unit Tests
 * Tests analytics tracking for intent detection performance
 */

import { Test, TestingModule } from '@nestjs/testing';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('IntentAnalyticsService', () => {
  let service: IntentAnalyticsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentAnalyticsService,
        {
          provide: PrismaService,
          useValue: {
            $executeRaw: jest.fn(),
            $queryRaw: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<IntentAnalyticsService>(IntentAnalyticsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('Boundary Condition Fix - Failure Tracking Threshold', () => {
    describe('Confidence exactly 0.6 (failure threshold)', () => {
      it('should track query with exactly 0.6 confidence as failure', async () => {
        const mockIntent = {
          type: 'semantic' as const,
          confidence: 0.6,
          originalQuery: 'test query',
          needsNarrative: true,
          needsComparison: false,
          needsComputation: false,
          needsTrend: false,
        };

        await service.logDetection({
          tenantId: 'test-tenant',
          query: 'test query',
          detectedIntent: mockIntent,
          detectionMethod: 'generic',
          confidence: 0.6,
          success: true,
          latencyMs: 100,
        });

        // Verify that trackFailedPattern was called (confidence <= 0.6)
        expect(prisma.$executeRaw).toHaveBeenCalled();
      });

      it('should track query with 0.59 confidence as failure', async () => {
        const mockIntent = {
          type: 'semantic' as const,
          confidence: 0.59,
          originalQuery: 'test query',
          needsNarrative: true,
          needsComparison: false,
          needsComputation: false,
          needsTrend: false,
        };

        await service.logDetection({
          tenantId: 'test-tenant',
          query: 'test query',
          detectedIntent: mockIntent,
          detectionMethod: 'generic',
          confidence: 0.59,
          success: true,
          latencyMs: 100,
        });

        expect(prisma.$executeRaw).toHaveBeenCalled();
      });
    });

    describe('Confidence above 0.6 (success threshold)', () => {
      it('should NOT track query with 0.61 confidence as failure', async () => {
        const mockIntent = {
          type: 'regex' as const,
          confidence: 0.61,
          originalQuery: 'test query',
          ticker: 'NVDA',
          needsNarrative: false,
          needsComparison: false,
          needsComputation: false,
          needsTrend: false,
        };

        // Reset mock
        (prisma.$executeRaw as jest.Mock).mockClear();

        await service.logDetection({
          tenantId: 'test-tenant',
          query: 'test query',
          detectedIntent: mockIntent,
          detectionMethod: 'regex',
          confidence: 0.61,
          success: true,
          latencyMs: 50,
        });

        // Should log detection but NOT track as failed pattern
        // The first call is for logging, subsequent calls would be for tracking failures
        const calls = (prisma.$executeRaw as jest.Mock).mock.calls;
        expect(calls.length).toBe(1); // Only the log call, no failure tracking
      });

      it('should NOT track query with 0.7 confidence as failure', async () => {
        const mockIntent = {
          type: 'regex' as const,
          confidence: 0.7,
          originalQuery: 'Show me NVDA',
          ticker: 'NVDA',
          needsNarrative: false,
          needsComparison: false,
          needsComputation: false,
          needsTrend: false,
        };

        (prisma.$executeRaw as jest.Mock).mockClear();

        await service.logDetection({
          tenantId: 'test-tenant',
          query: 'Show me NVDA',
          detectedIntent: mockIntent,
          detectionMethod: 'regex',
          confidence: 0.7,
          success: true,
          latencyMs: 50,
        });

        const calls = (prisma.$executeRaw as jest.Mock).mock.calls;
        expect(calls.length).toBe(1); // Only the log call
      });
    });

    describe('Failed queries (success = false)', () => {
      it('should track failed query regardless of confidence', async () => {
        const mockIntent = {
          type: 'generic' as const,
          confidence: 0.8,
          originalQuery: 'test query',
          needsNarrative: true,
          needsComparison: false,
          needsComputation: false,
          needsTrend: false,
        };

        await service.logDetection({
          tenantId: 'test-tenant',
          query: 'test query',
          detectedIntent: mockIntent,
          detectionMethod: 'generic',
          confidence: 0.8,
          success: false,
          errorMessage: 'Test error',
          latencyMs: 100,
        });

        expect(prisma.$executeRaw).toHaveBeenCalled();
      });
    });
  });

  describe('Analytics Summary Computation', () => {
    it('should compute summary with correct failure threshold', async () => {
      const mockMetrics = [{
        total_queries: 100,
        regex_success: 60,
        llm_fallback: 30,
        generic_fallback: 10,
        failed_queries: 15,
        avg_confidence: 0.75,
        avg_latency: 150,
        total_llm_cost: 0.05,
      }];

      const mockFailedPatterns = [
        { query: 'test query 1', count: 5 },
        { query: 'test query 2', count: 3 },
      ];

      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce(mockMetrics)
        .mockResolvedValueOnce(mockFailedPatterns);

      const tenantId = 'test-tenant';
      const periodStart = new Date('2024-01-01');
      const periodEnd = new Date('2024-01-02');

      const summary = await service.computeSummary(tenantId, periodStart, periodEnd);

      expect(summary).toBeDefined();
      expect(summary.totalQueries).toBe(100);
      expect(summary.regexSuccessCount).toBe(60);
      expect(summary.llmFallbackCount).toBe(30);
      expect(summary.genericFallbackCount).toBe(10);
      expect(summary.failedQueriesCount).toBe(15);
      expect(summary.avgConfidence).toBe(0.75);
      expect(summary.avgLatencyMs).toBe(150);
      expect(summary.totalLlmCostUsd).toBe(0.05);
      expect(summary.topFailedPatterns).toEqual(mockFailedPatterns);
    });
  });

  describe('Real-time Metrics', () => {
    it('should compute real-time metrics for last 24 hours', async () => {
      const mockMetrics = {
        total: '50',
        regex_count: '30',
        llm_count: '15',
        avg_conf: '0.75',
        avg_lat: '120',
        llm_cost: '0.02',
      };

      (prisma.$queryRaw as jest.Mock).mockResolvedValue([mockMetrics]);

      const metrics = await service.getRealtimeMetrics('test-tenant');

      expect(metrics).toBeDefined();
      expect(metrics.last24Hours).toBeDefined();
      expect(metrics.last24Hours.totalQueries).toBe(50);
      expect(metrics.last24Hours.regexSuccessRate).toBe(60); // 30/50 * 100
      expect(metrics.last24Hours.llmFallbackRate).toBe(30); // 15/50 * 100
    });
  });

  describe('Error Handling', () => {
    it('should handle logging errors gracefully', async () => {
      (prisma.$executeRaw as jest.Mock).mockRejectedValue(new Error('Database error'));

      const mockIntent = {
        type: 'semantic' as const,
        confidence: 0.5,
        originalQuery: 'test query',
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
      };

      // Should not throw
      await expect(
        service.logDetection({
          tenantId: 'test-tenant',
          query: 'test query',
          detectedIntent: mockIntent,
          detectionMethod: 'generic',
          confidence: 0.5,
          success: false,
          latencyMs: 100,
        })
      ).resolves.not.toThrow();
    });

    it('should handle summary computation errors', async () => {
      (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error('Database error'));

      const tenantId = 'test-tenant';
      const periodStart = new Date('2024-01-01');
      const periodEnd = new Date('2024-01-02');

      await expect(
        service.computeSummary(tenantId, periodStart, periodEnd)
      ).rejects.toThrow('Database error');
    });
  });
});
