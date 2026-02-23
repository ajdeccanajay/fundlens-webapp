/**
 * Unit Tests for detectIntent() three-layer flow (Task 4.3)
 *
 * Tests the rewritten detectIntent() method with:
 * - Layer 1: Regex fast-path (confidence >= 0.9 → return immediately)
 * - Layer 2: FastPathCache lookup (cache hit → return)
 * - Layer 3: LLM classification → resolveFromLlmResult → cache if >= 0.8
 * - Fallback: LLM failure → degraded regex result
 * - needsClarification when confidence < 0.7
 * - Analytics logging for all detection methods
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 7.1, 8.1, 8.2, 11.1, 12.1, 12.2, 12.3, 12.4, 12.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { FastPathCache } from '../../src/rag/intent-detection/fast-path-cache';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

describe('detectIntent three-layer flow (Task 4.3)', () => {
  let service: IntentDetectorService;
  let mockInvokeClaude: ReturnType<typeof vi.fn>;
  let mockLogDetection: ReturnType<typeof vi.fn>;
  let mockMetricResolve: ReturnType<typeof vi.fn>;
  let mockCacheLookup: ReturnType<typeof vi.fn>;
  let mockCacheStore: ReturnType<typeof vi.fn>;
  let fastPathCache: FastPathCache;

  const buildResolution = (
    canonicalId: string,
    displayName: string,
    confidence: 'exact' | 'fuzzy_auto' | 'unresolved',
    type: 'atomic' | 'computed' = 'atomic',
    dbColumn?: string,
  ): MetricResolution => ({
    canonical_id: canonicalId,
    display_name: displayName,
    type,
    confidence,
    fuzzy_score: confidence === 'fuzzy_auto' ? 0.88 : null,
    original_query: canonicalId,
    match_source: confidence === 'unresolved' ? 'none' : 'synonym_index',
    suggestions: null,
    db_column: dbColumn || canonicalId,
  });

  // Build a valid LLM JSON response string
  const buildLlmResponse = (overrides: Record<string, any> = {}): string => {
    const base = {
      tickers: ['AAPL'],
      rawMetricPhrases: ['revenue'],
      queryType: 'structured',
      period: 'FY2024',
      needsNarrative: false,
      needsComparison: false,
      needsComputation: false,
      needsTrend: false,
      needsPeerComparison: false,
      needsClarification: false,
      confidence: 0.9,
      ...overrides,
    };
    return JSON.stringify(base);
  };

  beforeEach(() => {
    mockInvokeClaude = vi.fn().mockResolvedValue(buildLlmResponse());
    mockLogDetection = vi.fn().mockResolvedValue(undefined);
    mockMetricResolve = vi.fn().mockImplementation((query: string) => {
      const q = query.toLowerCase();
      if (q.includes('revenue')) return buildResolution('revenue', 'Revenue', 'exact', 'atomic', 'revenue');
      if (q.includes('net income')) return buildResolution('net_income', 'Net Income', 'exact', 'atomic', 'net_income');
      if (q.includes('gross margin')) return buildResolution('gross_margin', 'Gross Margin', 'exact', 'computed', 'gross_margin');
      return buildResolution('', '', 'unresolved');
    });

    fastPathCache = new FastPathCache();
    mockCacheLookup = vi.spyOn(fastPathCache, 'lookup');
    mockCacheStore = vi.spyOn(fastPathCache, 'store');

    const mockBedrock = { invokeClaude: mockInvokeClaude };
    const mockAnalytics = { logDetection: mockLogDetection };
    const mockMetricRegistry = {
      resolve: mockMetricResolve,
      resolveMultiple: vi.fn().mockReturnValue([]),
      getKnownMetricNames: vi.fn().mockReturnValue(new Map()),
      normalizeMetricName: vi.fn((name: string) => name),
      getAllMetrics: vi.fn().mockReturnValue(new Map()),
    };
    const mockConceptRegistry = {
      matchConcept: vi.fn().mockReturnValue(null),
      getMetricBundle: vi.fn().mockReturnValue(null),
      getAllConceptIds: vi.fn().mockReturnValue([]),
      getConceptById: vi.fn().mockReturnValue(null),
    };
    const mockMetricLearning = {
      logUnrecognizedMetric: vi.fn().mockResolvedValue(undefined),
    };

    // Directly instantiate the service with mocks (bypassing NestJS DI)
    service = new (IntentDetectorService as any)(
      mockBedrock,
      mockAnalytics,
      mockMetricRegistry,
      mockConceptRegistry,
      mockMetricLearning,
      fastPathCache,
    );
  });

  // ─── Layer 1: Regex Fast-Path ──────────────────────────────────

  describe('Layer 1: Regex fast-path (Req 1.2)', () => {
    it('should return immediately when regex confidence >= 0.9 (simple query)', async () => {
      const result = await service.detectIntent('aapl revenue fy2024', 'tenant1');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.ticker).toBe('AAPL');
      expect(result.metrics).toContain('revenue');
      // LLM should NOT be called
      expect(mockInvokeClaude).not.toHaveBeenCalled();
      // Cache should NOT be checked
      expect(mockCacheLookup).not.toHaveBeenCalled();
    });

    it('should log regex_fast_path detection to analytics', async () => {
      await service.detectIntent('aapl revenue fy2024', 'tenant1');
      expect(mockLogDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant1',
          detectionMethod: expect.stringContaining('regex_fast_path'),
        }),
      );
    });

    it('should not log analytics when tenantId is undefined', async () => {
      await service.detectIntent('aapl revenue fy2024');
      expect(mockLogDetection).not.toHaveBeenCalled();
    });
  });

  // ─── Layer 2: Cache Hit ───────────────────────────────────────

  describe('Layer 2: Cache hit (Req 1.3, 4.2)', () => {
    it('should return cached result when cache hits (low-confidence regex query)', async () => {
      // Mock cache to return a result for a query that won't hit fast-path
      mockCacheLookup.mockReturnValueOnce({
        type: 'structured',
        ticker: 'AAPL',
        metrics: ['revenue'],
        period: 'FY2024',
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.92,
        originalQuery: 'what about apple revenue',
      });

      const result = await service.detectIntent('what about apple revenue', 'tenant1');

      // Cache was checked
      expect(mockCacheLookup).toHaveBeenCalled();
      // LLM should NOT be called since cache hit
      expect(mockInvokeClaude).not.toHaveBeenCalled();
      // Result should come from cache
      expect(result.confidence).toBe(0.92);
    });

    it('should log cache_hit detection to analytics', async () => {
      mockCacheLookup.mockReturnValueOnce({
        type: 'structured',
        ticker: 'AAPL',
        metrics: ['revenue'],
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.92,
        originalQuery: 'what about apple revenue',
      });

      await service.detectIntent('what about apple revenue', 'tenant1');

      expect(mockLogDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          detectionMethod: expect.stringContaining('cache_hit'),
        }),
      );
    });
  });

  // ─── Layer 3: LLM Classification ─────────────────────────────

  describe('Layer 3: LLM classification (Req 1.5)', () => {
    it('should invoke LLM when regex and cache both miss', async () => {
      mockCacheLookup.mockReturnValue(null);
      await service.detectIntent('tell me about apple', 'tenant1');
      expect(mockInvokeClaude).toHaveBeenCalled();
    });

    it('should cache LLM result when confidence >= 0.8', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({ confidence: 0.85 }));
      mockCacheLookup.mockReturnValue(null);
      await service.detectIntent('tell me about apple', 'tenant1');
      expect(mockCacheStore).toHaveBeenCalled();
    });

    it('should NOT cache LLM result when confidence < 0.8', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({ confidence: 0.6 }));
      mockCacheLookup.mockReturnValue(null);
      await service.detectIntent('tell me about apple', 'tenant1');
      expect(mockCacheStore).not.toHaveBeenCalled();
    });

    it('should log llm detection to analytics', async () => {
      mockCacheLookup.mockReturnValue(null);
      await service.detectIntent('tell me about apple', 'tenant1');
      expect(mockLogDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          detectionMethod: expect.stringContaining('llm'),
        }),
      );
    });
  });

  // ─── Fallback: LLM Failure ────────────────────────────────────

  describe('Fallback: LLM failure (Req 12.1, 12.4)', () => {
    it('should return fallback intent when LLM throws', async () => {
      mockInvokeClaude.mockRejectedValue(new Error('LLM timeout'));
      mockCacheLookup.mockReturnValue(null);
      const result = await service.detectIntent('tell me about apple', 'tenant1');
      expect(result).toBeDefined();
      expect(result.originalQuery).toBe('tell me about apple');
    });

    it('should return semantic fallback when LLM fails and regex confidence < 0.5', async () => {
      mockInvokeClaude.mockRejectedValue(new Error('LLM error'));
      mockCacheLookup.mockReturnValue(null);
      const result = await service.detectIntent('xyz', 'tenant1');
      expect(result).toBeDefined();
      expect(result.type).toBe('semantic');
      expect(result.needsNarrative).toBe(true);
      expect(result.originalQuery).toBe('xyz');
    });

    it('should log fallback detection to analytics with error message', async () => {
      mockInvokeClaude.mockRejectedValue(new Error('LLM timeout'));
      mockCacheLookup.mockReturnValue(null);
      await service.detectIntent('tell me about apple', 'tenant1');
      expect(mockLogDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          detectionMethod: expect.stringContaining('fallback'),
          success: false,
        }),
      );
    });
  });

  // ─── needsClarification ───────────────────────────────────────

  describe('needsClarification for low confidence (Req 12.2)', () => {
    it('should set needsClarification when LLM confidence < 0.7', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({ confidence: 0.5 }));
      mockCacheLookup.mockReturnValue(null);
      const result = await service.detectIntent('tell me about apple', 'tenant1');
      expect(result.needsClarification).toBe(true);
      expect(result.ambiguityReason).toBeDefined();
    });

    it('should NOT set needsClarification when LLM confidence >= 0.7', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({ confidence: 0.85 }));
      mockCacheLookup.mockReturnValue(null);
      const result = await service.detectIntent('tell me about apple', 'tenant1');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      // needsClarification should not be forced true by the detectIntent flow
      expect(result.needsClarification).toBeFalsy();
    });

    it('should set needsClarification on fallback when confidence < 0.7', async () => {
      mockInvokeClaude.mockRejectedValue(new Error('LLM error'));
      mockCacheLookup.mockReturnValue(null);
      const result = await service.detectIntent('xyz', 'tenant1');
      if (result.confidence < 0.7) {
        expect(result.needsClarification).toBe(true);
      }
    });
  });

  // ─── Method Signature Preservation (Req 8.2) ─────────────────

  describe('method signature preservation (Req 8.2)', () => {
    it('should accept (query) only', async () => {
      const result = await service.detectIntent('aapl revenue fy2024');
      expect(result).toBeDefined();
      expect(result.originalQuery).toBe('aapl revenue fy2024');
    });

    it('should accept (query, tenantId)', async () => {
      const result = await service.detectIntent('aapl revenue fy2024', 'tenant1');
      expect(result).toBeDefined();
    });

    it('should accept (query, tenantId, contextTicker)', async () => {
      const result = await service.detectIntent('revenue fy2024', 'tenant1', 'AAPL');
      expect(result).toBeDefined();
      expect(result.ticker).toBe('AAPL');
    });

    it('should always return a valid QueryIntent (never null)', async () => {
      mockInvokeClaude.mockRejectedValue(new Error('fail'));
      mockCacheLookup.mockReturnValue(null);
      const result = await service.detectIntent('');
      expect(result).toBeDefined();
      expect(result.type).toBeDefined();
      expect(typeof result.confidence).toBe('number');
      expect(typeof result.needsNarrative).toBe('boolean');
      expect(typeof result.needsComparison).toBe('boolean');
      expect(typeof result.needsComputation).toBe('boolean');
      expect(typeof result.needsTrend).toBe('boolean');
    });
  });

  // ─── Three-Layer Ordering ─────────────────────────────────────

  describe('three-layer ordering (Req 1.1)', () => {
    it('should skip cache and LLM when regex fast-path succeeds', async () => {
      await service.detectIntent('aapl revenue fy2024', 'tenant1');
      expect(mockCacheLookup).not.toHaveBeenCalled();
      expect(mockInvokeClaude).not.toHaveBeenCalled();
    });

    it('should skip LLM when cache hits', async () => {
      mockCacheLookup.mockReturnValueOnce({
        type: 'structured',
        ticker: 'AAPL',
        metrics: ['revenue'],
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.92,
        originalQuery: 'complex query',
      });
      await service.detectIntent('complex query', 'tenant1');
      expect(mockInvokeClaude).not.toHaveBeenCalled();
    });

    it('should check cache before LLM when regex confidence < 0.9', async () => {
      mockCacheLookup.mockReturnValue(null);
      await service.detectIntent('tell me about apple', 'tenant1');
      // Cache should be checked first
      expect(mockCacheLookup).toHaveBeenCalled();
      // Then LLM should be called
      expect(mockInvokeClaude).toHaveBeenCalled();
    });
  });

  // ─── High Confidence LLM Result Gets Cached ───────────────────

  describe('caching behavior (Req 4.1)', () => {
    it('should cache LLM result with confidence >= 0.8', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({ confidence: 0.9 }));
      mockCacheLookup.mockReturnValue(null);
      await service.detectIntent('what is apple revenue trend', 'tenant1');
      expect(mockCacheStore).toHaveBeenCalled();
    });

    it('should NOT cache LLM result with confidence < 0.8', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({ confidence: 0.5 }));
      mockCacheLookup.mockReturnValue(null);
      await service.detectIntent('what is apple revenue trend', 'tenant1');
      expect(mockCacheStore).not.toHaveBeenCalled();
    });
  });
});
