/**
 * Integration Tests for Full Intent Detection Flow (Task 8.2)
 *
 * Tests the three-layer detection architecture end-to-end with:
 * - Real FastPathCache (not mocked)
 * - Real metric resolution logic (mocked MetricRegistryService responses)
 * - Mocked external dependencies (BedrockService, PrismaService)
 *
 * Scenarios:
 * 1. Simple query → regex fast-path (no LLM call)
 * 2. Complex query → LLM classification → metric resolution
 * 3. Cache warming: first query invokes LLM, second hits cache
 * 4. Multi-ticker comparison detection
 * 5. Concept query → ConceptRegistryService delegation
 * 6. Graceful degradation when LLM fails
 * 7. Computed metric detection (needsComputation set correctly)
 *
 * Requirements: 1.1, 3.1, 4.1, 5.2, 5.3, 6.1, 12.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { FastPathCache } from '../../src/rag/intent-detection/fast-path-cache';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

describe('Integration: Full Intent Detection Flow (Task 8.2)', () => {
  let service: IntentDetectorService;
  let mockInvokeClaude: ReturnType<typeof vi.fn>;
  let mockLogDetection: ReturnType<typeof vi.fn>;
  let mockMetricResolve: ReturnType<typeof vi.fn>;
  let mockMatchConcept: ReturnType<typeof vi.fn>;
  let mockGetMetricBundle: ReturnType<typeof vi.fn>;
  let mockLogUnrecognizedMetric: ReturnType<typeof vi.fn>;
  let fastPathCache: FastPathCache;

  // --- Helpers ---

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
    mockLogUnrecognizedMetric = vi.fn().mockResolvedValue(undefined);

    mockMetricResolve = vi.fn().mockImplementation((query: string) => {
      const q = query.toLowerCase();
      if (q.includes('revenue') || q === 'total_revenue')
        return buildResolution('total_revenue', 'Revenue', 'exact', 'atomic', 'total_revenue');
      if (q.includes('net income'))
        return buildResolution('net_income', 'Net Income', 'exact', 'atomic', 'net_income');
      if (q.includes('gross margin'))
        return buildResolution('gross_margin', 'Gross Margin', 'exact', 'computed', 'gross_margin');
      if (q.includes('operating margin'))
        return buildResolution('operating_margin', 'Operating Margin', 'exact', 'computed', 'operating_margin');
      if (q.includes('eps') || q.includes('earnings per share'))
        return buildResolution('eps', 'Earnings Per Share', 'exact', 'atomic', 'eps');
      return buildResolution('', '', 'unresolved');
    });

    mockMatchConcept = vi.fn().mockReturnValue(null);
    mockGetMetricBundle = vi.fn().mockReturnValue(null);

    // Use a REAL FastPathCache — this is an integration test
    fastPathCache = new FastPathCache();

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
      matchConcept: mockMatchConcept,
      getMetricBundle: mockGetMetricBundle,
      getAllConceptIds: vi.fn().mockReturnValue([]),
      getConceptById: vi.fn().mockReturnValue(null),
    };
    const mockMetricLearning = {
      logUnrecognizedMetric: mockLogUnrecognizedMetric,
    };

    service = new (IntentDetectorService as any)(
      mockBedrock,
      mockAnalytics,
      mockMetricRegistry,
      mockConceptRegistry,
      mockMetricLearning,
      fastPathCache,
    );
  });

  // ─── 1. Simple query → regex fast-path (no LLM call) ─────────
  // Validates: Req 1.1, 1.2

  describe('simple query → regex fast-path (no LLM call)', () => {
    it('should resolve "AAPL revenue FY2024" via fast-path without LLM', async () => {
      const result = await service.detectIntent('aapl revenue fy2024', 'tenant1');

      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.ticker).toBe('AAPL');
      expect(result.metrics).toContain('total_revenue');
      expect(result.period).toBe('FY2024');
      expect(result.type).toBe('structured');
      expect(mockInvokeClaude).not.toHaveBeenCalled();
    });

    it('should resolve "MSFT net income 2023" via fast-path without LLM', async () => {
      const result = await service.detectIntent('msft net income 2023', 'tenant1');

      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.ticker).toBe('MSFT');
      expect(result.metrics).toContain('net_income');
      expect(mockInvokeClaude).not.toHaveBeenCalled();
    });

    it('should set needsComputation=false for atomic metrics on fast-path', async () => {
      const result = await service.detectIntent('aapl revenue fy2024', 'tenant1');

      expect(result.needsComputation).toBe(false);
      expect(result.needsNarrative).toBe(false);
      expect(result.needsComparison).toBe(false);
      expect(result.needsTrend).toBe(false);
    });
  });

  // ─── 2. Complex query → LLM classification → metric resolution ─
  // Validates: Req 1.1, 5.2

  describe('complex query → LLM classification → metric resolution', () => {
    it('should invoke LLM for a natural language query and resolve metrics', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({
        tickers: ['NVDA'],
        rawMetricPhrases: ['revenue'],
        queryType: 'structured',
        period: 'FY2024',
        confidence: 0.92,
      }));

      const result = await service.detectIntent(
        'what was nvidia revenue last year',
        'tenant1',
      );

      expect(mockInvokeClaude).toHaveBeenCalled();
      expect(result.ticker).toBe('NVDA');
      expect(result.metrics).toContain('total_revenue');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('should log unresolved metrics to MetricLearningService', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({
        tickers: ['AAPL'],
        rawMetricPhrases: ['magic number'],
        queryType: 'structured',
        confidence: 0.85,
      }));

      await service.detectIntent('what is apple magic number', 'tenant1');

      expect(mockLogUnrecognizedMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedMetric: 'magic number',
        }),
      );
    });
  });


  // ─── 3. Cache warming: first query invokes LLM, second hits cache ─
  // Validates: Req 4.1

  describe('cache warming: first query invokes LLM, second hits cache', () => {
    it('should invoke LLM on first call and hit cache on second similar call', async () => {
      // Use a query that WON'T hit the regex fast-path.
      // "what is the revenue outlook for aapl" has no explicit period → regex confidence < 0.9
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({
        tickers: ['AAPL'],
        rawMetricPhrases: ['revenue'],
        queryType: 'structured',
        period: 'FY2024',
        confidence: 0.9,
      }));

      const result1 = await service.detectIntent(
        'what is the revenue outlook for aapl',
        'tenant1',
      );

      expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
      expect(result1.confidence).toBeGreaterThanOrEqual(0.8);

      // Reset the mock call count to verify second call doesn't invoke LLM
      mockInvokeClaude.mockClear();

      // Second call: same pattern with a different ticker.
      // The cache normalizes "aapl" → {TICKER} so "msft" should match the same pattern.
      const result2 = await service.detectIntent(
        'what is the revenue outlook for msft',
        'tenant1',
      );

      // LLM should NOT be called on the second query — cache hit
      expect(mockInvokeClaude).not.toHaveBeenCalled();
      // The result should have the new query preserved
      expect(result2.originalQuery).toBe('what is the revenue outlook for msft');
    });

    it('should NOT cache LLM results with confidence < 0.8', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({
        tickers: ['AAPL'],
        rawMetricPhrases: ['revenue'],
        queryType: 'structured',
        confidence: 0.6,
      }));

      await service.detectIntent('vague question about aapl', 'tenant1');
      expect(mockInvokeClaude).toHaveBeenCalledTimes(1);

      mockInvokeClaude.mockClear();

      // Second call should still invoke LLM since first result wasn't cached
      await service.detectIntent('vague question about msft', 'tenant1');
      expect(mockInvokeClaude).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 4. Multi-ticker comparison detection ─────────────────────
  // Validates: Req 3.1

  describe('multi-ticker comparison detection', () => {
    it('should detect comparison when LLM returns multiple tickers', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({
        tickers: ['NVDA', 'MSFT'],
        rawMetricPhrases: ['revenue'],
        queryType: 'structured',
        needsComparison: true,
        needsPeerComparison: true,
        confidence: 0.9,
      }));

      const result = await service.detectIntent(
        'compare nvda and msft revenue',
        'tenant1',
      );

      expect(result.needsComparison).toBe(true);
      expect(result.ticker).toEqual(expect.arrayContaining(['NVDA', 'MSFT']));
      expect(result.metrics).toContain('total_revenue');
    });

    it('should set needsComparison=true for multi-ticker even without comparison keywords', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({
        tickers: ['AAPL', 'GOOGL'],
        rawMetricPhrases: ['net income'],
        queryType: 'structured',
        needsComparison: false, // LLM didn't flag it, but structural detection should
        confidence: 0.88,
      }));

      const result = await service.detectIntent(
        'aapl googl net income fy2024',
        'tenant1',
      );

      // Structural detection: 2+ tickers → needsComparison = true
      expect(result.needsComparison).toBe(true);
      expect(Array.isArray(result.ticker)).toBe(true);
    });

    it('should delegate multi-ticker queries to LLM (regex returns low confidence)', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({
        tickers: ['NVDA', 'AMD'],
        rawMetricPhrases: ['gross margin'],
        queryType: 'structured',
        needsComparison: true,
        needsComputation: true,
        confidence: 0.9,
      }));

      const result = await service.detectIntent(
        'nvda vs amd gross margin',
        'tenant1',
      );

      // Multi-ticker should have triggered LLM (regex returns 0.5 for multi-ticker)
      expect(mockInvokeClaude).toHaveBeenCalled();
      expect(result.needsComparison).toBe(true);
      expect(result.needsPeerComparison).toBe(true);
    });
  });


  // ─── 5. Concept query → ConceptRegistryService delegation ─────
  // Validates: Req 5.3

  describe('concept query → ConceptRegistryService delegation', () => {
    it('should delegate concept matching to ConceptRegistryService and include metric bundle', async () => {
      // LLM detects a concept match
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({
        tickers: ['AAPL'],
        rawMetricPhrases: [],
        queryType: 'hybrid',
        needsNarrative: true,
        needsComputation: true,
        conceptMatch: 'leverage_profile',
        confidence: 0.9,
      }));

      // ConceptRegistryService returns a concept match
      mockMatchConcept.mockReturnValue({
        concept_id: 'leverage_profile',
        display_name: 'Leverage Profile',
        confidence: 'exact',
        fuzzy_score: null,
        matched_trigger: 'how levered',
      });

      // ConceptRegistryService returns a metric bundle
      mockGetMetricBundle.mockReturnValue({
        concept_id: 'leverage_profile',
        display_name: 'Leverage Profile',
        primary_metrics: ['net_debt_to_ebitda', 'interest_coverage_ratio'],
        secondary_metrics: ['current_ratio'],
        context_prompt: 'Analyze leverage...',
        presentation: { layout: 'profile', include_peer_comparison: false, include_historical_trend: false },
      });

      const result = await service.detectIntent(
        'how levered is apple',
        'tenant1',
      );

      // ConceptRegistryService should have been called
      expect(mockMatchConcept).toHaveBeenCalled();
      expect(mockGetMetricBundle).toHaveBeenCalledWith('leverage_profile');

      // Metrics should include the concept bundle metrics
      expect(result.metrics).toContain('net_debt_to_ebitda');
      expect(result.metrics).toContain('interest_coverage_ratio');
      expect(result.metrics).toContain('current_ratio');
      expect(result.needsComputation).toBe(true);
      expect(result.type).toBe('hybrid');
    });

    it('should handle concept match with no metric bundle gracefully', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({
        tickers: ['MSFT'],
        rawMetricPhrases: [],
        queryType: 'hybrid',
        needsComputation: true,
        conceptMatch: 'unknown_concept',
        confidence: 0.85,
      }));

      mockMatchConcept.mockReturnValue({
        concept_id: 'unknown_concept',
        display_name: 'Unknown',
        confidence: 'fuzzy',
        fuzzy_score: 0.82,
        matched_trigger: 'unknown',
      });

      // No metric bundle found
      mockGetMetricBundle.mockReturnValue(null);

      const result = await service.detectIntent(
        'what is the unknown profile of msft',
        'tenant1',
      );

      expect(result).toBeDefined();
      expect(result.ticker).toBe('MSFT');
      // No metrics from concept bundle, but should still be valid
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });
  });

  // ─── 6. Graceful degradation when LLM fails ──────────────────
  // Validates: Req 12.1

  describe('graceful degradation when LLM fails', () => {
    it('should return semantic fallback when LLM throws and regex confidence < 0.5', async () => {
      mockInvokeClaude.mockRejectedValue(new Error('LLM service unavailable'));

      const result = await service.detectIntent(
        'tell me everything about the market',
        'tenant1',
      );

      expect(result).toBeDefined();
      expect(result.type).toBe('semantic');
      expect(result.needsNarrative).toBe(true);
      expect(result.needsClarification).toBe(true);
      expect(result.originalQuery).toBe('tell me everything about the market');
      expect(mockInvokeClaude).toHaveBeenCalled();
    });

    it('should use regex result as fallback when LLM fails but regex has partial match', async () => {
      mockInvokeClaude.mockRejectedValue(new Error('LLM timeout'));

      // Query with a ticker but no metric/period → regex partial match
      const result = await service.detectIntent(
        'aapl something interesting',
        'tenant1',
      );

      expect(result).toBeDefined();
      expect(result.originalQuery).toBe('aapl something interesting');
      // Should still have the ticker from regex extraction
      expect(result.ticker).toBe('AAPL');
    });

    it('should never return null even on total failure', async () => {
      mockInvokeClaude.mockRejectedValue(new Error('catastrophic failure'));

      const result = await service.detectIntent('', 'tenant1');

      expect(result).not.toBeNull();
      expect(result).not.toBeUndefined();
      expect(typeof result.confidence).toBe('number');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should log fallback detection to analytics', async () => {
      mockInvokeClaude.mockRejectedValue(new Error('LLM error'));

      await service.detectIntent('some query', 'tenant1');

      expect(mockLogDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          detectionMethod: 'fallback',
          success: false,
          errorMessage: 'LLM error',
        }),
      );
    });
  });

  // ─── 7. Computed metric detection (needsComputation) ──────────
  // Validates: Req 6.1

  describe('computed metric detection (needsComputation set correctly)', () => {
    it('should set needsComputation=true when LLM returns a computed metric phrase', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({
        tickers: ['AAPL'],
        rawMetricPhrases: ['gross margin'],
        queryType: 'structured',
        needsComputation: false, // LLM may not flag it, but resolution should
        confidence: 0.9,
      }));

      const result = await service.detectIntent(
        'what is apple gross margin',
        'tenant1',
      );

      // gross_margin resolves as type: 'computed' → needsComputation should be true
      expect(result.metrics).toContain('gross_margin');
      expect(result.needsComputation).toBe(true);
    });

    it('should set needsComputation=true on fast-path for computed metrics', async () => {
      const result = await service.detectIntent(
        'aapl gross margin fy2024',
        'tenant1',
      );

      // Fast-path should detect computed metric type
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.metrics).toContain('gross_margin');
      expect(result.needsComputation).toBe(true);
      expect(mockInvokeClaude).not.toHaveBeenCalled();
    });

    it('should set needsComputation=false for atomic metrics', async () => {
      const result = await service.detectIntent(
        'aapl revenue fy2024',
        'tenant1',
      );

      expect(result.metrics).toContain('total_revenue');
      expect(result.needsComputation).toBe(false);
    });

    it('should set needsComputation=true when concept bundle is resolved', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({
        tickers: ['NVDA'],
        rawMetricPhrases: [],
        queryType: 'hybrid',
        needsNarrative: true,
        needsComputation: false,
        conceptMatch: 'profitability_profile',
        confidence: 0.9,
      }));

      mockMatchConcept.mockReturnValue({
        concept_id: 'profitability_profile',
        display_name: 'Profitability Profile',
        confidence: 'exact',
        fuzzy_score: null,
        matched_trigger: 'profitability',
      });

      mockGetMetricBundle.mockReturnValue({
        concept_id: 'profitability_profile',
        display_name: 'Profitability Profile',
        primary_metrics: ['gross_margin', 'operating_margin'],
        secondary_metrics: ['net_income'],
        context_prompt: 'Analyze profitability...',
        presentation: { layout: 'profile', include_peer_comparison: false, include_historical_trend: false },
      });

      const result = await service.detectIntent(
        'profitability profile of nvda',
        'tenant1',
      );

      // Concept resolution sets needsComputation = true
      expect(result.needsComputation).toBe(true);
      expect(result.metrics).toContain('gross_margin');
      expect(result.metrics).toContain('operating_margin');
    });
  });

  // ─── Cross-cutting: contextTicker merging ─────────────────────

  describe('contextTicker merging across layers', () => {
    it('should merge contextTicker with query tickers on fast-path', async () => {
      const result = await service.detectIntent(
        'revenue fy2024',
        'tenant1',
        'AAPL',
      );

      expect(result.ticker).toBe('AAPL');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(mockInvokeClaude).not.toHaveBeenCalled();
    });

    it('should merge contextTicker with LLM-detected tickers', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({
        tickers: ['MSFT'],
        rawMetricPhrases: ['revenue'],
        queryType: 'structured',
        confidence: 0.9,
      }));

      const result = await service.detectIntent(
        'how does msft revenue compare',
        'tenant1',
        'AAPL',
      );

      // Both contextTicker and LLM-detected ticker should be present
      expect(Array.isArray(result.ticker)).toBe(true);
      expect(result.ticker).toContain('AAPL');
      expect(result.ticker).toContain('MSFT');
      expect(result.needsComparison).toBe(true);
    });
  });

  // ─── Cross-cutting: analytics logging ─────────────────────────

  describe('analytics logging for all detection methods', () => {
    it('should log regex_fast_path for simple queries', async () => {
      await service.detectIntent('aapl revenue fy2024', 'tenant1');

      expect(mockLogDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant1',
          detectionMethod: 'regex_fast_path',
          confidence: expect.any(Number),
        }),
      );
    });

    it('should log llm for complex queries', async () => {
      mockInvokeClaude.mockResolvedValue(buildLlmResponse({ confidence: 0.9 }));

      await service.detectIntent('tell me about apple', 'tenant1');

      expect(mockLogDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          detectionMethod: 'llm',
        }),
      );
    });

    it('should not log analytics when tenantId is undefined', async () => {
      await service.detectIntent('aapl revenue fy2024');

      expect(mockLogDetection).not.toHaveBeenCalled();
    });
  });
});
