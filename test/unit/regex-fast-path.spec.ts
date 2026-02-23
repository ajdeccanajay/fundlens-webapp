/**
 * Regex Fast-Path Unit Tests
 * Tests the regexFastPath(), extractMetricCandidatesSimple(), and buildLowConfidenceIntent()
 * methods added to IntentDetectorService for Task 4.1.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 6.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

describe('regexFastPath (Task 4.1)', () => {
  let service: IntentDetectorService;
  let mockMetricResolve: ReturnType<typeof vi.fn>;

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

  beforeEach(async () => {
    mockMetricResolve = vi.fn().mockImplementation((query: string) => {
      const q = query.toLowerCase();
      if (q.includes('revenue')) return buildResolution('revenue', 'Revenue', 'exact', 'atomic', 'revenue');
      if (q.includes('net income')) return buildResolution('net_income', 'Net Income', 'exact', 'atomic', 'net_income');
      if (q.includes('gross margin')) return buildResolution('gross_margin', 'Gross Margin', 'exact', 'computed', 'gross_margin');
      if (q.includes('gross profit')) return buildResolution('gross_profit', 'Gross Profit', 'exact', 'atomic', 'gross_profit');
      if (q.includes('ebitda')) return buildResolution('ebitda', 'EBITDA', 'exact', 'atomic', 'ebitda');
      if (q.includes('operating income')) return buildResolution('operating_income', 'Operating Income', 'exact', 'atomic', 'operating_income');
      if (q.includes('free cash flow') || q === 'fcf') return buildResolution('free_cash_flow', 'Free Cash Flow', 'exact', 'atomic', 'free_cash_flow');
      // Fuzzy match — should NOT qualify for fast-path
      if (q.includes('rev')) return buildResolution('revenue', 'Revenue', 'fuzzy_auto', 'atomic', 'revenue');
      return unresolvedResult();
    });

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
      ],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);
  });

  // Access private methods for direct testing
  const callRegexFastPath = (query: string, contextTicker?: string) =>
    (service as any).regexFastPath(query, contextTicker);

  const callExtractMetricCandidatesSimple = (query: string) =>
    (service as any).extractMetricCandidatesSimple(query);

  const callBuildLowConfidenceIntent = (
    query: string,
    ticker: any,
    metrics: string[],
    periodResult: any,
    confidence: number,
  ) => (service as any).buildLowConfidenceIntent(query, ticker, metrics, periodResult, confidence);

  describe('regexFastPath — high confidence (Req 2.1)', () => {
    it('should return confidence >= 0.9 for single ticker + exact metric + period', () => {
      const result = callRegexFastPath('aapl revenue fy2024');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.ticker).toBe('AAPL');
      expect(result.metrics).toContain('revenue');
      expect(result.period).toBe('FY2024');
      expect(result.type).toBe('structured');
    });

    it('should return confidence 0.95 for simple metric query with year', () => {
      const result = callRegexFastPath('msft net income 2024');
      expect(result.confidence).toBe(0.95);
      expect(result.ticker).toBe('MSFT');
      expect(result.metrics).toContain('net_income');
      expect(result.period).toBe('FY2024');
    });

    it('should return confidence 0.95 with contextTicker + metric + period', () => {
      const result = callRegexFastPath('revenue fy2024', 'NVDA');
      expect(result.confidence).toBe(0.95);
      expect(result.ticker).toBe('NVDA');
      expect(result.metrics).toContain('revenue');
    });
  });

  describe('regexFastPath — multi-ticker (Req 2.7)', () => {
    it('should return confidence 0.5 for multi-ticker queries', () => {
      const result = callRegexFastPath('aapl msft revenue fy2024');
      expect(result.confidence).toBe(0.5);
      expect(Array.isArray(result.ticker)).toBe(true);
      expect(result.needsComparison).toBe(true);
    });

    it('should return confidence 0.5 for comparison queries', () => {
      const result = callRegexFastPath('nvda amd revenue');
      expect(result.confidence).toBe(0.5);
    });
  });

  describe('regexFastPath — partial matches (Req 2.5)', () => {
    it('should return low confidence when missing period', () => {
      const result = callRegexFastPath('aapl revenue');
      expect(result.confidence).toBeLessThan(0.9);
      // ticker (0.3) + metric (0.3) = 0.6
      expect(result.confidence).toBeCloseTo(0.6, 1);
    });

    it('should return low confidence when missing metric', () => {
      const result = callRegexFastPath('aapl fy2024');
      expect(result.confidence).toBeLessThan(0.9);
      // ticker (0.3) + period (0.2) = 0.5
      expect(result.confidence).toBeCloseTo(0.5, 1);
    });

    it('should return low confidence when missing ticker', () => {
      const result = callRegexFastPath('revenue fy2024');
      expect(result.confidence).toBeLessThan(0.9);
      // metric (0.3) + period (0.2) = 0.5
      expect(result.confidence).toBeCloseTo(0.5, 1);
    });

    it('should return 0 confidence for empty query', () => {
      const result = callRegexFastPath('');
      expect(result.confidence).toBe(0);
    });
  });

  describe('regexFastPath — exact match only (Req 2.3)', () => {
    it('should NOT qualify for fast-path with fuzzy metric match', () => {
      // "rev" resolves as fuzzy_auto, not exact
      const result = callRegexFastPath('aapl rev fy2024');
      expect(result.confidence).toBeLessThan(0.9);
    });

    it('should NOT qualify for fast-path with unresolved metric', () => {
      const result = callRegexFastPath('aapl xyz_metric fy2024');
      expect(result.confidence).toBeLessThan(0.9);
    });
  });

  describe('regexFastPath — computed metric detection (Req 6.6)', () => {
    it('should set needsComputation=true when metric is computed', () => {
      const result = callRegexFastPath('aapl gross margin fy2024');
      expect(result.confidence).toBe(0.95);
      expect(result.needsComputation).toBe(true);
    });

    it('should set needsComputation=false when metric is atomic', () => {
      const result = callRegexFastPath('aapl revenue fy2024');
      expect(result.confidence).toBe(0.95);
      expect(result.needsComputation).toBe(false);
    });
  });

  describe('regexFastPath — boolean flags from components (Req 6.6)', () => {
    it('should set type=structured when metrics are present', () => {
      const result = callRegexFastPath('aapl revenue fy2024');
      expect(result.type).toBe('structured');
    });

    it('should set needsNarrative=false for fast-path hits', () => {
      const result = callRegexFastPath('aapl revenue fy2024');
      expect(result.needsNarrative).toBe(false);
    });

    it('should set needsComparison=false for single-ticker fast-path', () => {
      const result = callRegexFastPath('aapl revenue fy2024');
      expect(result.needsComparison).toBe(false);
    });

    it('should set needsTrend=false for fast-path (no keyword detection)', () => {
      const result = callRegexFastPath('aapl revenue fy2024');
      expect(result.needsTrend).toBe(false);
    });

    it('should set needsPeerComparison=false for fast-path', () => {
      const result = callRegexFastPath('aapl revenue fy2024');
      expect(result.needsPeerComparison).toBe(false);
    });
  });

  describe('regexFastPath — preserved method usage (Req 2.2, 2.4)', () => {
    it('should use extractTicker for ticker detection', () => {
      const result = callRegexFastPath('nvda revenue fy2024');
      expect(result.ticker).toBe('NVDA');
    });

    it('should use extractPeriod for period detection', () => {
      const result = callRegexFastPath('aapl revenue q4 2024');
      expect(result.period).toBeDefined();
    });

    it('should use determinePeriodType for period classification', () => {
      const result = callRegexFastPath('aapl revenue fy2024');
      expect(result.periodType).toBe('annual');
    });

    it('should merge contextTicker via extractTicker', () => {
      const result = callRegexFastPath('revenue fy2024', 'TSLA');
      expect(result.ticker).toBe('TSLA');
      expect(result.confidence).toBe(0.95);
    });
  });

  describe('regexFastPath — originalQuery preservation', () => {
    it('should preserve the original query string', () => {
      const original = 'AAPL Revenue FY2024';
      const result = callRegexFastPath(original);
      expect(result.originalQuery).toBe(original);
    });

    it('should preserve original query in low-confidence results', () => {
      const original = 'some random query';
      const result = callRegexFastPath(original);
      expect(result.originalQuery).toBe(original);
    });
  });

  describe('extractMetricCandidatesSimple', () => {
    it('should extract metric phrases from simple queries', () => {
      const candidates = callExtractMetricCandidatesSimple('aapl revenue fy2024');
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.some((c: string) => c.includes('revenue'))).toBe(true);
    });

    it('should generate 1-3 word phrases', () => {
      const candidates = callExtractMetricCandidatesSimple('gross profit margin analysis');
      candidates.forEach((c: string) => {
        const wordCount = c.split(' ').length;
        expect(wordCount).toBeLessThanOrEqual(3);
        expect(wordCount).toBeGreaterThanOrEqual(1);
      });
    });

    it('should strip stopwords', () => {
      const candidates = callExtractMetricCandidatesSimple('what is the revenue for this company');
      candidates.forEach((c: string) => {
        expect(c).not.toMatch(/^(what|is|the|for|this)$/);
      });
    });

    it('should return empty array for empty query', () => {
      const candidates = callExtractMetricCandidatesSimple('');
      expect(candidates).toEqual([]);
    });

    it('should deduplicate candidates', () => {
      const candidates = callExtractMetricCandidatesSimple('revenue revenue revenue');
      const unique = new Set(candidates);
      expect(candidates.length).toBe(unique.size);
    });
  });

  describe('buildLowConfidenceIntent', () => {
    it('should build a valid QueryIntent with given confidence', () => {
      const result = callBuildLowConfidenceIntent(
        'test query',
        'AAPL',
        ['revenue'],
        { period: 'FY2024' },
        0.5,
      );
      expect(result.confidence).toBe(0.5);
      expect(result.ticker).toBe('AAPL');
      expect(result.metrics).toEqual(['revenue']);
      expect(result.originalQuery).toBe('test query');
    });

    it('should set type=structured when metrics present', () => {
      const result = callBuildLowConfidenceIntent('q', 'AAPL', ['revenue'], {}, 0.3);
      expect(result.type).toBe('structured');
    });

    it('should set type=semantic when no metrics', () => {
      const result = callBuildLowConfidenceIntent('q', 'AAPL', [], {}, 0.3);
      expect(result.type).toBe('semantic');
      expect(result.needsNarrative).toBe(true);
    });

    it('should set needsComparison=true for multi-ticker', () => {
      const result = callBuildLowConfidenceIntent('q', ['AAPL', 'MSFT'], [], {}, 0.5);
      expect(result.needsComparison).toBe(true);
    });

    it('should clamp confidence to [0, 1]', () => {
      const result1 = callBuildLowConfidenceIntent('q', undefined, [], {}, -0.5);
      expect(result1.confidence).toBe(0);

      const result2 = callBuildLowConfidenceIntent('q', undefined, [], {}, 1.5);
      expect(result2.confidence).toBe(1);
    });

    it('should handle undefined ticker', () => {
      const result = callBuildLowConfidenceIntent('q', undefined, [], {}, 0.2);
      expect(result.ticker).toBeUndefined();
    });

    it('should include period info from periodResult', () => {
      const result = callBuildLowConfidenceIntent(
        'q', 'AAPL', [], { period: 'FY2024', periodType: 'annual' as const }, 0.3,
      );
      expect(result.period).toBe('FY2024');
      expect(result.periodType).toBe('annual');
    });
  });
});
