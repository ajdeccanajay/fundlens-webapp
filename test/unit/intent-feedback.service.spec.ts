import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntentFeedbackService } from '../../src/rag/intent-detection/intent-feedback.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricLearningService } from '../../src/rag/metric-learning.service';
import { FastPathCache } from '../../src/rag/intent-detection/fast-path-cache';
import { QueryIntent } from '../../src/rag/types/query-intent';

describe('IntentFeedbackService', () => {
  let service: IntentFeedbackService;
  let mockAnalytics: { logDetection: ReturnType<typeof vi.fn> };
  let mockMetricLearning: { logUnrecognizedMetric: ReturnType<typeof vi.fn> };
  let mockFastPathCache: { invalidate: ReturnType<typeof vi.fn> };

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
      confidence: 0.5,
      originalQuery: 'AAPL revenue FY2024',
      ...overrides,
    };
  }

  beforeEach(() => {
    mockAnalytics = {
      logDetection: vi.fn().mockResolvedValue(undefined),
    };
    mockMetricLearning = {
      logUnrecognizedMetric: vi.fn().mockResolvedValue(undefined),
    };
    mockFastPathCache = {
      invalidate: vi.fn(),
    };

    service = new IntentFeedbackService(
      mockAnalytics as unknown as IntentAnalyticsService,
      mockMetricLearning as unknown as MetricLearningService,
      mockFastPathCache as unknown as FastPathCache,
    );
  });

  describe('logLowConfidence', () => {
    it('should log to IntentAnalyticsService with correct parameters', async () => {
      const intent = makeIntent({ confidence: 0.4 });

      await service.logLowConfidence({
        query: 'some vague query',
        intent,
        confidence: 0.4,
        method: 'llm',
        tenantId: 'tenant-1',
      });

      expect(mockAnalytics.logDetection).toHaveBeenCalledOnce();
      expect(mockAnalytics.logDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          query: 'some vague query',
          detectedIntent: intent,
          confidence: 0.4,
          success: false,
        }),
      );
    });

    it('should include detection method in the log', async () => {
      await service.logLowConfidence({
        query: 'test',
        intent: makeIntent(),
        confidence: 0.3,
        method: 'regex_fast_path',
        tenantId: 'tenant-1',
      });

      expect(mockAnalytics.logDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          detectionMethod: 'regex_fast_path',
        }),
      );
    });

    it('should not throw when analytics logging fails', async () => {
      mockAnalytics.logDetection.mockRejectedValue(new Error('DB error'));

      await expect(
        service.logLowConfidence({
          query: 'test',
          intent: makeIntent(),
          confidence: 0.3,
          method: 'llm',
          tenantId: 'tenant-1',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('logCorrection', () => {
    it('should invalidate the cache entry for the original query', async () => {
      await service.logCorrection({
        originalQuery: 'AAPL revnue FY2024',
        correctedQuery: 'AAPL revenue FY2024',
        sessionId: 'session-1',
        tenantId: 'tenant-1',
      });

      expect(mockFastPathCache.invalidate).toHaveBeenCalledOnce();
      expect(mockFastPathCache.invalidate).toHaveBeenCalledWith('AAPL revnue FY2024');
    });

    it('should log the correction pair to IntentAnalyticsService', async () => {
      await service.logCorrection({
        originalQuery: 'AAPL revnue FY2024',
        correctedQuery: 'AAPL revenue FY2024',
        sessionId: 'session-1',
        tenantId: 'tenant-1',
      });

      expect(mockAnalytics.logDetection).toHaveBeenCalledOnce();
      expect(mockAnalytics.logDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          query: 'AAPL revnue FY2024',
          success: false,
        }),
      );
    });

    it('should include corrected query and session in error message', async () => {
      await service.logCorrection({
        originalQuery: 'original',
        correctedQuery: 'corrected',
        sessionId: 'sess-42',
        tenantId: 'tenant-1',
      });

      expect(mockAnalytics.logDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: expect.stringContaining('corrected'),
        }),
      );
      expect(mockAnalytics.logDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: expect.stringContaining('sess-42'),
        }),
      );
    });

    it('should not throw when analytics logging fails', async () => {
      mockAnalytics.logDetection.mockRejectedValue(new Error('DB error'));

      await expect(
        service.logCorrection({
          originalQuery: 'test',
          correctedQuery: 'test2',
          sessionId: 'session-1',
          tenantId: 'tenant-1',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('logMetricSuggestionSelected', () => {
    it('should log to MetricLearningService', async () => {
      await service.logMetricSuggestionSelected({
        originalQuery: 'AAPL gross profit margin',
        selectedMetric: 'gross_margin',
        tenantId: 'tenant-1',
      });

      expect(mockMetricLearning.logUnrecognizedMetric).toHaveBeenCalledOnce();
      expect(mockMetricLearning.logUnrecognizedMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          query: 'AAPL gross profit margin',
          requestedMetric: 'gross_margin',
        }),
      );
    });

    it('should invalidate the cache entry for the original query', async () => {
      await service.logMetricSuggestionSelected({
        originalQuery: 'AAPL gross profit margin',
        selectedMetric: 'gross_margin',
        tenantId: 'tenant-1',
      });

      expect(mockFastPathCache.invalidate).toHaveBeenCalledOnce();
      expect(mockFastPathCache.invalidate).toHaveBeenCalledWith('AAPL gross profit margin');
    });

    it('should not throw when MetricLearningService fails', async () => {
      mockMetricLearning.logUnrecognizedMetric.mockRejectedValue(new Error('DB error'));

      await expect(
        service.logMetricSuggestionSelected({
          originalQuery: 'test',
          selectedMetric: 'test_metric',
          tenantId: 'tenant-1',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('logUnresolvedMetric', () => {
    it('should forward to MetricLearningService with correct parameters', async () => {
      await service.logUnresolvedMetric({
        rawPhrase: 'free cash flow yield',
        query: 'What is NVDA free cash flow yield?',
        tenantId: 'tenant-1',
        ticker: 'NVDA',
      });

      expect(mockMetricLearning.logUnrecognizedMetric).toHaveBeenCalledOnce();
      expect(mockMetricLearning.logUnrecognizedMetric).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        ticker: 'NVDA',
        query: 'What is NVDA free cash flow yield?',
        requestedMetric: 'free cash flow yield',
        failureReason: 'LLM detected metric phrase not in MetricRegistryService',
        userMessage: '',
      });
    });

    it('should not throw when MetricLearningService fails', async () => {
      mockMetricLearning.logUnrecognizedMetric.mockRejectedValue(new Error('DB error'));

      await expect(
        service.logUnresolvedMetric({
          rawPhrase: 'test metric',
          query: 'test query',
          tenantId: 'tenant-1',
          ticker: 'AAPL',
        }),
      ).resolves.not.toThrow();
    });

    it('should not invalidate cache (only corrections invalidate)', async () => {
      await service.logUnresolvedMetric({
        rawPhrase: 'test metric',
        query: 'test query',
        tenantId: 'tenant-1',
        ticker: 'AAPL',
      });

      expect(mockFastPathCache.invalidate).not.toHaveBeenCalled();
    });
  });
});
