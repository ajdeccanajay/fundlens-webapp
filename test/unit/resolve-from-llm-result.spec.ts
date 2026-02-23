/**
 * Unit Tests for resolveFromLlmResult() and hasComparisonConnectors()
 * Tests the post-LLM resolution pipeline added to IntentDetectorService for Task 4.2.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 5.2, 5.3, 5.4, 5.5
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { ConceptRegistryService } from '../../src/rag/metric-resolution/concept-registry.service';
import { MetricLearningService } from '../../src/rag/metric-learning.service';
import { MetricResolution } from '../../src/rag/metric-resolution/types';
import { LlmClassificationResult } from '../../src/rag/intent-detection/llm-detection-engine';

describe('resolveFromLlmResult (Task 4.2)', () => {
  let service: IntentDetectorService;
  let mockMetricResolve: Mock;
  let mockMatchConcept: Mock;
  let mockGetMetricBundle: Mock;
  let mockLogUnrecognizedMetric: Mock;

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

  const unresolvedResult = (): MetricResolution => buildResolution('', '', 'unresolved');

  const baseLlmResult: LlmClassificationResult = {
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
  };

  beforeEach(async () => {
    mockMetricResolve = vi.fn().mockImplementation((query: string) => {
      const q = query.toLowerCase();
      if (q.includes('revenue')) return buildResolution('revenue', 'Revenue', 'exact', 'atomic', 'revenue');
      if (q.includes('net income')) return buildResolution('net_income', 'Net Income', 'exact', 'atomic', 'net_income');
      if (q.includes('gross margin')) return buildResolution('gross_margin', 'Gross Margin', 'exact', 'computed', 'gross_margin');
      if (q.includes('gross profit')) return buildResolution('gross_profit', 'Gross Profit', 'exact', 'atomic', 'gross_profit');
      if (q.includes('ebitda')) return buildResolution('ebitda', 'EBITDA', 'exact', 'atomic', 'ebitda');
      return unresolvedResult();
    });

    mockMatchConcept = vi.fn().mockReturnValue(null);
    mockGetMetricBundle = vi.fn().mockReturnValue(null);
    mockLogUnrecognizedMetric = vi.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentDetectorService,
        { provide: BedrockService, useValue: { invokeClaude: vi.fn().mockResolvedValue('{}') } },
        { provide: IntentAnalyticsService, useValue: { logDetection: vi.fn().mockResolvedValue(undefined) } },
        {
          provide: MetricRegistryService,
          useValue: {
            resolve: mockMetricResolve,
            resolveMultiple: vi.fn().mockReturnValue([]),
            getKnownMetricNames: vi.fn().mockReturnValue(new Map()),
            normalizeMetricName: vi.fn((name: string) => name),
          },
        },
        {
          provide: ConceptRegistryService,
          useValue: {
            matchConcept: mockMatchConcept,
            getMetricBundle: mockGetMetricBundle,
          },
        },
        {
          provide: MetricLearningService,
          useValue: {
            logUnrecognizedMetric: mockLogUnrecognizedMetric,
          },
        },
      ],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);
  });

  // Access the method for direct testing
  const callResolveFromLlmResult = (
    llmResult: LlmClassificationResult,
    query: string,
    contextTicker?: string,
  ) => (service as any).resolveFromLlmResult(llmResult, query, contextTicker);

  const callHasComparisonConnectors = (query: string) =>
    (service as any).hasComparisonConnectors(query);

  // ─── Metric Resolution (Req 5.2) ───────────────────────────────────

  describe('metric resolution through MetricRegistryService', () => {
    it('should resolve raw metric phrases via MetricRegistryService.resolve()', async () => {
      const result = await callResolveFromLlmResult(baseLlmResult, 'AAPL revenue FY2024');
      expect(mockMetricResolve).toHaveBeenCalledWith('revenue');
      expect(result.metrics).toEqual(['revenue']);
    });

    it('should resolve multiple metric phrases', async () => {
      const llmResult = {
        ...baseLlmResult,
        rawMetricPhrases: ['revenue', 'net income'],
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL revenue and net income FY2024');
      expect(result.metrics).toEqual(['revenue', 'net_income']);
    });

    it('should deduplicate resolved metrics', async () => {
      const llmResult = {
        ...baseLlmResult,
        rawMetricPhrases: ['revenue', 'revenue'],
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL revenue FY2024');
      expect(result.metrics).toEqual(['revenue']);
    });

    it('should exclude unresolved metrics from QueryIntent.metrics', async () => {
      const llmResult = {
        ...baseLlmResult,
        rawMetricPhrases: ['revenue', 'xyz_unknown_metric'],
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL revenue and xyz FY2024');
      expect(result.metrics).toEqual(['revenue']);
    });

    it('should return undefined metrics when all phrases are unresolved', async () => {
      const llmResult = {
        ...baseLlmResult,
        rawMetricPhrases: ['xyz_unknown'],
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL xyz FY2024');
      expect(result.metrics).toBeUndefined();
    });

    it('should return undefined metrics when rawMetricPhrases is empty', async () => {
      const llmResult = {
        ...baseLlmResult,
        rawMetricPhrases: [],
      };
      const result = await callResolveFromLlmResult(llmResult, 'What are AAPL risk factors?');
      expect(result.metrics).toBeUndefined();
    });
  });

  // ─── needsComputation for computed metrics (Req 5.2) ───────────────

  describe('needsComputation detection', () => {
    it('should set needsComputation=true when resolved metric has type "computed"', async () => {
      const llmResult = {
        ...baseLlmResult,
        rawMetricPhrases: ['gross margin'],
        needsComputation: false,
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL gross margin FY2024');
      expect(result.needsComputation).toBe(true);
    });

    it('should preserve needsComputation=true from LLM even if no computed metrics resolved', async () => {
      const llmResult = {
        ...baseLlmResult,
        rawMetricPhrases: ['revenue'],
        needsComputation: true,
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL revenue growth FY2024');
      expect(result.needsComputation).toBe(true);
    });

    it('should keep needsComputation=false when all metrics are atomic', async () => {
      const llmResult = {
        ...baseLlmResult,
        rawMetricPhrases: ['revenue'],
        needsComputation: false,
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL revenue FY2024');
      expect(result.needsComputation).toBe(false);
    });
  });

  // ─── Unresolved metric logging (Req 5.4) ───────────────────────────

  describe('unresolved metric logging to MetricLearningService', () => {
    it('should log unresolved metrics to MetricLearningService', async () => {
      const llmResult = {
        ...baseLlmResult,
        rawMetricPhrases: ['xyz_unknown_metric'],
      };
      await callResolveFromLlmResult(llmResult, 'AAPL xyz FY2024');
      expect(mockLogUnrecognizedMetric).toHaveBeenCalledWith({
        tenantId: '',
        ticker: 'AAPL',
        query: 'AAPL xyz FY2024',
        requestedMetric: 'xyz_unknown_metric',
        failureReason: 'LLM detected metric phrase not in MetricRegistryService',
        userMessage: '',
      });
    });

    it('should not log resolved metrics', async () => {
      await callResolveFromLlmResult(baseLlmResult, 'AAPL revenue FY2024');
      expect(mockLogUnrecognizedMetric).not.toHaveBeenCalled();
    });

    it('should use first ticker for unresolved metric logging', async () => {
      const llmResult = {
        ...baseLlmResult,
        tickers: ['NVDA', 'MSFT'],
        rawMetricPhrases: ['xyz_unknown'],
      };
      await callResolveFromLlmResult(llmResult, 'NVDA MSFT xyz');
      expect(mockLogUnrecognizedMetric).toHaveBeenCalledWith(
        expect.objectContaining({ ticker: 'NVDA' }),
      );
    });

    it('should use empty ticker when no tickers present', async () => {
      const llmResult = {
        ...baseLlmResult,
        tickers: [],
        rawMetricPhrases: ['xyz_unknown'],
      };
      await callResolveFromLlmResult(llmResult, 'xyz metric');
      expect(mockLogUnrecognizedMetric).toHaveBeenCalledWith(
        expect.objectContaining({ ticker: '' }),
      );
    });

    it('should handle MetricRegistryService errors gracefully and log unresolved', async () => {
      mockMetricResolve.mockImplementationOnce(() => { throw new Error('Registry error'); });
      const llmResult = {
        ...baseLlmResult,
        rawMetricPhrases: ['revenue'],
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL revenue FY2024');
      // Should not throw, should log unresolved
      expect(mockLogUnrecognizedMetric).toHaveBeenCalled();
      expect(result.metrics).toBeUndefined();
    });
  });

  // ─── Concept matching (Req 5.3) ────────────────────────────────────

  describe('concept matching through ConceptRegistryService', () => {
    it('should match concepts and add metric bundle to resolved metrics', async () => {
      mockMatchConcept.mockReturnValue({
        concept_id: 'leverage_profile',
        display_name: 'Leverage Profile',
        confidence: 'exact',
        fuzzy_score: null,
        matched_trigger: 'how levered',
      });
      mockGetMetricBundle.mockReturnValue({
        concept_id: 'leverage_profile',
        display_name: 'Leverage Profile',
        primary_metrics: ['net_debt_to_ebitda', 'interest_coverage_ratio'],
        secondary_metrics: ['current_ratio'],
        context_prompt: 'Analyze leverage',
        presentation: { layout: 'table', include_peer_comparison: false, include_historical_trend: false },
      });

      const llmResult = {
        ...baseLlmResult,
        rawMetricPhrases: [],
        conceptMatch: 'leverage_profile',
        queryType: 'hybrid' as const,
      };
      const result = await callResolveFromLlmResult(llmResult, 'How levered is Apple?');
      expect(mockMatchConcept).toHaveBeenCalledWith('How levered is Apple?');
      expect(mockGetMetricBundle).toHaveBeenCalledWith('leverage_profile');
      expect(result.metrics).toContain('net_debt_to_ebitda');
      expect(result.metrics).toContain('interest_coverage_ratio');
      expect(result.metrics).toContain('current_ratio');
      expect(result.needsComputation).toBe(true);
    });

    it('should not call ConceptRegistryService when no conceptMatch in LLM result', async () => {
      const llmResult = { ...baseLlmResult, conceptMatch: undefined };
      await callResolveFromLlmResult(llmResult, 'AAPL revenue FY2024');
      expect(mockMatchConcept).not.toHaveBeenCalled();
    });

    it('should deduplicate concept metrics with already-resolved metrics', async () => {
      mockMatchConcept.mockReturnValue({
        concept_id: 'profitability',
        display_name: 'Profitability',
        confidence: 'exact',
        fuzzy_score: null,
        matched_trigger: 'profitability',
      });
      mockGetMetricBundle.mockReturnValue({
        concept_id: 'profitability',
        display_name: 'Profitability',
        primary_metrics: ['revenue', 'gross_margin'],
        secondary_metrics: [],
        context_prompt: '',
        presentation: { layout: 'table', include_peer_comparison: false, include_historical_trend: false },
      });

      const llmResult = {
        ...baseLlmResult,
        rawMetricPhrases: ['revenue'],
        conceptMatch: 'profitability',
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL profitability');
      // 'revenue' should appear only once
      const revenueCount = result.metrics.filter((m: string) => m === 'revenue').length;
      expect(revenueCount).toBe(1);
    });

    it('should handle ConceptRegistryService errors gracefully', async () => {
      mockMatchConcept.mockImplementation(() => { throw new Error('Concept error'); });
      const llmResult = {
        ...baseLlmResult,
        rawMetricPhrases: ['revenue'],
        conceptMatch: 'leverage_profile',
      };
      const result = await callResolveFromLlmResult(llmResult, 'How levered is AAPL?');
      // Should not throw, should still have resolved metrics
      expect(result.metrics).toEqual(['revenue']);
    });

    it('should handle null bundle from getMetricBundle', async () => {
      mockMatchConcept.mockReturnValue({
        concept_id: 'unknown_concept',
        display_name: 'Unknown',
        confidence: 'fuzzy',
        fuzzy_score: 0.85,
        matched_trigger: 'unknown',
      });
      mockGetMetricBundle.mockReturnValue(null);

      const llmResult = {
        ...baseLlmResult,
        rawMetricPhrases: ['revenue'],
        conceptMatch: 'unknown_concept',
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL unknown concept');
      expect(result.metrics).toEqual(['revenue']);
    });
  });

  // ─── Ticker merging with contextTicker (Req 3.3, 8.5) ─────────────

  describe('contextTicker merging', () => {
    it('should merge contextTicker with LLM-detected tickers', async () => {
      const llmResult = { ...baseLlmResult, tickers: ['MSFT'] };
      const result = await callResolveFromLlmResult(llmResult, 'Compare with MSFT', 'AAPL');
      expect(result.ticker).toEqual(expect.arrayContaining(['AAPL', 'MSFT']));
    });

    it('should deduplicate when contextTicker matches LLM ticker', async () => {
      const llmResult = { ...baseLlmResult, tickers: ['AAPL'] };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL revenue', 'AAPL');
      expect(result.ticker).toBe('AAPL');
    });

    it('should uppercase contextTicker', async () => {
      const llmResult = { ...baseLlmResult, tickers: [] };
      const result = await callResolveFromLlmResult(llmResult, 'revenue FY2024', 'aapl');
      expect(result.ticker).toBe('AAPL');
    });

    it('should return single ticker string when only contextTicker present', async () => {
      const llmResult = { ...baseLlmResult, tickers: [] };
      const result = await callResolveFromLlmResult(llmResult, 'revenue FY2024', 'NVDA');
      expect(result.ticker).toBe('NVDA');
      expect(typeof result.ticker).toBe('string');
    });

    it('should return ticker array when contextTicker + LLM tickers > 1', async () => {
      const llmResult = { ...baseLlmResult, tickers: ['MSFT', 'GOOG'] };
      const result = await callResolveFromLlmResult(llmResult, 'Compare MSFT GOOG', 'AAPL');
      expect(Array.isArray(result.ticker)).toBe(true);
      expect(result.ticker).toHaveLength(3);
    });

    it('should return undefined ticker when no tickers at all', async () => {
      const llmResult = { ...baseLlmResult, tickers: [] };
      const result = await callResolveFromLlmResult(llmResult, 'what is revenue?');
      expect(result.ticker).toBeUndefined();
    });
  });

  // ─── Structural comparison detection (Req 3.1, 3.2) ───────────────

  describe('structural comparison detection', () => {
    it('should set needsComparison=true when multiple tickers present (Req 3.1)', async () => {
      const llmResult = {
        ...baseLlmResult,
        tickers: ['NVDA', 'MSFT'],
        needsComparison: false,
      };
      const result = await callResolveFromLlmResult(llmResult, 'NVDA MSFT revenue');
      expect(result.needsComparison).toBe(true);
    });

    it('should preserve needsComparison=true from LLM even with single ticker', async () => {
      const llmResult = {
        ...baseLlmResult,
        tickers: ['AAPL'],
        needsComparison: true,
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL vs peers');
      expect(result.needsComparison).toBe(true);
    });

    it('should set needsPeerComparison=true from LLM result', async () => {
      const llmResult = {
        ...baseLlmResult,
        needsPeerComparison: true,
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL vs competitors');
      expect(result.needsPeerComparison).toBe(true);
    });

    it('should set needsPeerComparison=true when multiple tickers + comparison connectors (Req 3.2)', async () => {
      const llmResult = {
        ...baseLlmResult,
        tickers: ['NVDA', 'MSFT'],
        needsPeerComparison: false,
      };
      const result = await callResolveFromLlmResult(llmResult, 'NVDA vs MSFT revenue');
      expect(result.needsPeerComparison).toBe(true);
    });

    it('should NOT set needsPeerComparison when multiple tickers but no connectors', async () => {
      const llmResult = {
        ...baseLlmResult,
        tickers: ['NVDA', 'MSFT'],
        needsPeerComparison: false,
      };
      const result = await callResolveFromLlmResult(llmResult, 'NVDA MSFT revenue FY2024');
      expect(result.needsPeerComparison).toBe(false);
    });
  });

  // ─── Period resolution with fallback (Req 8.6) ────────────────────

  describe('period resolution with extractPeriod fallback', () => {
    it('should use LLM period when provided', async () => {
      const llmResult = { ...baseLlmResult, period: 'FY2024' };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL revenue FY2024');
      expect(result.period).toBe('FY2024');
    });

    it('should fall back to extractPeriod when LLM period is undefined', async () => {
      const llmResult = { ...baseLlmResult, period: undefined };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL revenue 2024');
      expect(result.period).toBe('FY2024');
    });

    it('should use LLM periodStart/periodEnd when provided', async () => {
      const llmResult = {
        ...baseLlmResult,
        period: undefined,
        periodStart: 'FY2020',
        periodEnd: 'FY2024',
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL revenue trend');
      expect(result.periodStart).toBe('FY2020');
      expect(result.periodEnd).toBe('FY2024');
    });

    it('should fall back to extractPeriod for periodStart/periodEnd', async () => {
      const llmResult = {
        ...baseLlmResult,
        period: undefined,
        periodStart: undefined,
        periodEnd: undefined,
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL revenue past 5 years');
      expect(result.periodStart).toBeDefined();
      expect(result.periodEnd).toBeDefined();
    });

    it('should determine periodType from resolved period', async () => {
      const llmResult = { ...baseLlmResult, period: 'FY2024' };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL revenue FY2024');
      expect(result.periodType).toBe('annual');
    });
  });

  // ─── QueryIntent field passthrough ─────────────────────────────────

  describe('QueryIntent field passthrough from LLM result', () => {
    it('should pass through queryType as type', async () => {
      const llmResult = { ...baseLlmResult, queryType: 'semantic' as const };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL risk factors');
      expect(result.type).toBe('semantic');
    });

    it('should pass through needsNarrative', async () => {
      const llmResult = { ...baseLlmResult, needsNarrative: true };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL risk factors');
      expect(result.needsNarrative).toBe(true);
    });

    it('should pass through needsTrend', async () => {
      const llmResult = { ...baseLlmResult, needsTrend: true };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL revenue trend');
      expect(result.needsTrend).toBe(true);
    });

    it('should pass through needsClarification and ambiguityReason', async () => {
      const llmResult = {
        ...baseLlmResult,
        needsClarification: true,
        ambiguityReason: 'Query is vague',
      };
      const result = await callResolveFromLlmResult(llmResult, 'Tell me about Apple');
      expect(result.needsClarification).toBe(true);
      expect(result.ambiguityReason).toBe('Query is vague');
    });

    it('should pass through documentTypes and sectionTypes', async () => {
      const llmResult = {
        ...baseLlmResult,
        documentTypes: ['10-K'],
        sectionTypes: ['item_1a'],
        subsectionName: 'Market Risk',
      };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL risk factors');
      expect(result.documentTypes).toEqual(['10-K']);
      expect(result.sectionTypes).toEqual(['item_1a']);
      expect(result.subsectionName).toBe('Market Risk');
    });

    it('should pass through confidence', async () => {
      const llmResult = { ...baseLlmResult, confidence: 0.85 };
      const result = await callResolveFromLlmResult(llmResult, 'AAPL revenue FY2024');
      expect(result.confidence).toBe(0.85);
    });

    it('should set originalQuery to the input query', async () => {
      const query = 'AAPL revenue FY2024';
      const result = await callResolveFromLlmResult(baseLlmResult, query);
      expect(result.originalQuery).toBe(query);
    });
  });

  // ─── hasComparisonConnectors ───────────────────────────────────────

  describe('hasComparisonConnectors', () => {
    it('should detect "vs"', () => {
      expect(callHasComparisonConnectors('NVDA vs MSFT')).toBe(true);
    });

    it('should detect "versus"', () => {
      expect(callHasComparisonConnectors('NVDA versus MSFT')).toBe(true);
    });

    it('should detect "compared to"', () => {
      expect(callHasComparisonConnectors('NVDA compared to MSFT')).toBe(true);
    });

    it('should detect "relative to"', () => {
      expect(callHasComparisonConnectors('NVDA relative to MSFT')).toBe(true);
    });

    it('should detect "against"', () => {
      expect(callHasComparisonConnectors('NVDA against MSFT')).toBe(true);
    });

    it('should detect "stack up"', () => {
      expect(callHasComparisonConnectors('How does NVDA stack up to MSFT')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(callHasComparisonConnectors('NVDA VS MSFT')).toBe(true);
      expect(callHasComparisonConnectors('NVDA Versus MSFT')).toBe(true);
    });

    it('should return false when no connectors present', () => {
      expect(callHasComparisonConnectors('NVDA MSFT revenue FY2024')).toBe(false);
    });

    it('should return false for empty query', () => {
      expect(callHasComparisonConnectors('')).toBe(false);
    });
  });
});
