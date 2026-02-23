import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';

/**
 * Unit tests for IntentDetectorService — normalizeQuery() and regexFallback()
 * Task 3.5a: Standalone private methods, no wiring into detect() yet.
 *
 * Requirements: 8.2, 8.3, 8.4
 */
describe('IntentDetectorService — normalizeQuery & regexFallback', () => {
  let service: IntentDetectorService;
  let metricRegistry: jest.Mocked<MetricRegistryService>;

  const buildResolution = (
    canonicalId: string,
    displayName: string,
    confidence: 'exact' | 'fuzzy_auto' | 'unresolved',
    type: 'atomic' | 'computed' = 'atomic',
    dbColumn?: string,
  ) => ({
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

  const unresolvedResult = () => buildResolution('', '', 'unresolved');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentDetectorService,
        { provide: BedrockService, useValue: { invokeModel: jest.fn() } },
        { provide: IntentAnalyticsService, useValue: { logDetection: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: MetricRegistryService,
          useValue: {
            resolve: jest.fn().mockReturnValue(unresolvedResult()),
            resolveMultiple: jest.fn().mockReturnValue([]),
            getKnownMetricNames: jest.fn().mockReturnValue(new Map()),
            normalizeMetricName: jest.fn((name: string) => name),
          },
        },
      ],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);
    metricRegistry = module.get(MetricRegistryService);

    // Seed knownTickers for fallback tests
    (service as any).knownTickers = new Set(['AAPL', 'AMZN', 'NVDA', 'MSFT', 'C', 'V', 'ABNB']);
  });

  // -------------------------------------------------------------------------
  // normalizeQuery
  // -------------------------------------------------------------------------
  describe('normalizeQuery', () => {
    it('should trim leading and trailing whitespace', () => {
      expect((service as any).normalizeQuery('  ABNB revenue  ')).toBe('abnb revenue');
    });

    it('should collapse multiple spaces to a single space', () => {
      expect((service as any).normalizeQuery('ABNB   revenue')).toBe('abnb revenue');
    });

    it('should lowercase the entire query', () => {
      expect((service as any).normalizeQuery('ABNB Revenue')).toBe('abnb revenue');
    });

    it('should produce the same result for whitespace/casing variants (Req 7.5)', () => {
      const variants = [
        'ABNB revenue',
        'abnb revenue',
        '  ABNB  revenue  ',
        'Abnb Revenue',
        '\tABNB\trevenue\t',
      ];
      const normalized = variants.map(v => (service as any).normalizeQuery(v));
      expect(new Set(normalized).size).toBe(1);
    });

    it('should handle empty string', () => {
      expect((service as any).normalizeQuery('')).toBe('');
    });

    it('should handle single word', () => {
      expect((service as any).normalizeQuery('AAPL')).toBe('aapl');
    });

    it('should collapse tabs and newlines', () => {
      expect((service as any).normalizeQuery('ABNB\n\trevenue')).toBe('abnb revenue');
    });
  });

  // -------------------------------------------------------------------------
  // regexFallback
  // -------------------------------------------------------------------------
  describe('regexFallback', () => {
    it('should extract known uppercase tickers from query (Req 8.2)', async () => {
      const result = await (service as any).regexFallback('What is AAPL revenue?');
      expect(result.tickers).toContain('AAPL');
    });

    it('should NOT extract lowercase tickers', async () => {
      const result = await (service as any).regexFallback('what is aapl revenue?');
      expect(result.tickers).not.toContain('AAPL');
      expect(result.tickers).not.toContain('aapl');
    });

    it('should NOT extract company names like "amazon"', async () => {
      const result = await (service as any).regexFallback('what is amazon revenue?');
      expect(result.tickers).toHaveLength(0);
    });

    it('should extract multiple known tickers', async () => {
      const result = await (service as any).regexFallback('Compare AAPL and NVDA revenue');
      expect(result.tickers).toContain('AAPL');
      expect(result.tickers).toContain('NVDA');
      expect(result.tickers).toHaveLength(2);
    });

    it('should filter out unknown uppercase words (e.g., ROIC, GAAP)', async () => {
      const result = await (service as any).regexFallback('What is ROIC for AAPL?');
      expect(result.tickers).toContain('AAPL');
      expect(result.tickers).not.toContain('ROIC');
    });

    it('should extract single-letter tickers when uppercase (Req 8.2)', async () => {
      const result = await (service as any).regexFallback('What is C revenue?');
      expect(result.tickers).toContain('C');
    });

    it('should default timePeriod to LATEST_BOTH (Req 8.4)', async () => {
      const result = await (service as any).regexFallback('AAPL revenue');
      expect(result.timePeriod.periodType).toBe('LATEST_BOTH');
      expect(result.timePeriod.specificPeriod).toBeNull();
    });

    it('should default queryType to single_metric (Req 8.4)', async () => {
      const result = await (service as any).regexFallback('AAPL revenue');
      expect(result.queryType).toBe('single_metric');
    });

    it('should set all boolean flags to false (Req 8.4)', async () => {
      const result = await (service as any).regexFallback('AAPL revenue');
      expect(result.needsNarrative).toBe(false);
      expect(result.needsPeerComparison).toBe(false);
      expect(result.needsComputation).toBe(false);
    });

    it('should preserve the original query', async () => {
      const query = 'What is AAPL revenue over 5 years?';
      const result = await (service as any).regexFallback(query);
      expect(result.originalQuery).toBe(query);
    });

    it('should resolve metrics via MetricRegistryService exact matching (Req 8.3)', async () => {
      metricRegistry.resolve.mockImplementation((q: string) => {
        if (q.includes('revenue')) {
          return buildResolution('revenue', 'Revenue', 'exact');
        }
        return unresolvedResult();
      });

      const result = await (service as any).regexFallback('What is AAPL revenue?');
      expect(result.metrics.length).toBeGreaterThanOrEqual(1);
      expect(result.metrics[0].canonical_id).toBe('revenue');
    });

    it('should NOT include fuzzy-matched metrics (exact only)', async () => {
      metricRegistry.resolve.mockReturnValue(buildResolution('revenue', 'Revenue', 'fuzzy_auto'));

      const result = await (service as any).regexFallback('What is AAPL revnue?');
      expect(result.metrics).toHaveLength(0);
    });

    it('should return empty tickers and metrics for uninterpretable queries', async () => {
      const result = await (service as any).regexFallback('tell me something interesting');
      expect(result.tickers).toHaveLength(0);
      expect(result.metrics).toHaveLength(0);
    });

    it('should not duplicate tickers', async () => {
      // Query with AAPL appearing twice
      const result = await (service as any).regexFallback('AAPL revenue and AAPL margins');
      const aaplCount = result.tickers.filter((t: string) => t === 'AAPL').length;
      expect(aaplCount).toBe(1);
    });

    it('should return ValidatedQueryIntent shape with entities array', async () => {
      const result = await (service as any).regexFallback('AAPL revenue');
      expect(result.entities).toBeDefined();
      expect(result.entities.length).toBe(result.tickers.length);
      if (result.entities.length > 0) {
        expect(result.entities[0].ticker).toBe('AAPL');
        expect(result.entities[0].source).toBe('exact_match');
        expect(result.entities[0].validated).toBe(true);
      }
    });
  });
});
