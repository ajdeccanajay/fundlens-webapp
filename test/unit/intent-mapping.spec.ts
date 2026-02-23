import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { ValidatedQueryIntent, MappedTimePeriod } from '../../src/rag/intent-validator.service';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

/**
 * Unit tests for IntentDetectorService.mapToQueryIntent() — QueryIntent mapping layer.
 * Task 3.6: Maps ValidatedQueryIntent to the existing QueryIntent interface.
 *
 * Requirements: 10.1, 10.2, 15.1, 15.2, 15.3, 15.4, 15.5
 */
describe('IntentDetectorService — mapToQueryIntent()', () => {
  let service: IntentDetectorService;

  const mockMetricResolution = (canonical_id: string, type = 'atomic'): MetricResolution => ({
    canonical_id,
    display_name: canonical_id.replace(/_/g, ' '),
    type: type as any,
    confidence: 'exact',
    fuzzy_score: null,
    original_query: canonical_id,
    match_source: 'synonym_index',
    suggestions: null,
    db_column: canonical_id,
  });

  const buildValidated = (overrides: Partial<ValidatedQueryIntent> = {}): ValidatedQueryIntent => ({
    tickers: ['AMZN'],
    entities: [{
      ticker: 'AMZN',
      company: 'Amazon',
      confidence: 0.95,
      validated: true,
      source: 'exact_match',
    }],
    metrics: [mockMetricResolution('revenue')],
    rawMetrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
    timePeriod: { periodType: 'LATEST_BOTH', specificPeriod: null },
    queryType: 'single_metric',
    needsNarrative: false,
    needsPeerComparison: false,
    needsComputation: false,
    originalQuery: 'AMZN revenue',
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentDetectorService,
        { provide: BedrockService, useValue: {} },
        { provide: IntentAnalyticsService, useValue: { logDetection: jest.fn() } },
        { provide: MetricRegistryService, useValue: { resolve: jest.fn(), resolveMultiple: jest.fn() } },
      ],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);
  });

  // ── Requirement 15.1: Single ticker → string ──────────────────────────
  it('should map single ticker to a string (Req 15.1)', () => {
    const validated = buildValidated({ tickers: ['ABNB'] });
    const result = service.mapToQueryIntent(validated);
    expect(result.ticker).toBe('ABNB');
    expect(typeof result.ticker).toBe('string');
  });

  // ── Requirement 15.2: Multiple tickers → string array ─────────────────
  it('should map multiple tickers to a string array (Req 15.2)', () => {
    const validated = buildValidated({
      tickers: ['AMZN', 'NVDA'],
      entities: [
        { ticker: 'AMZN', company: 'Amazon', confidence: 0.95, validated: true, source: 'exact_match' },
        { ticker: 'NVDA', company: 'NVIDIA', confidence: 0.90, validated: true, source: 'exact_match' },
      ],
    });
    const result = service.mapToQueryIntent(validated);
    expect(result.ticker).toEqual(['AMZN', 'NVDA']);
    expect(Array.isArray(result.ticker)).toBe(true);
  });

  // ── Requirement 15.1: No tickers → undefined ──────────────────────────
  it('should set ticker to undefined when no tickers present', () => {
    const validated = buildValidated({ tickers: [], entities: [] });
    const result = service.mapToQueryIntent(validated);
    expect(result.ticker).toBeUndefined();
  });

  // ── Requirement 15.3: Metrics pass-through as canonical IDs ───────────
  it('should map MetricResolution[] to string[] of canonical IDs (Req 15.3)', () => {
    const validated = buildValidated({
      metrics: [
        mockMetricResolution('revenue'),
        mockMetricResolution('ebitda'),
      ],
    });
    const result = service.mapToQueryIntent(validated);
    expect(result.metrics).toEqual(['revenue', 'ebitda']);
  });

  it('should set metrics to undefined when no metrics present', () => {
    const validated = buildValidated({ metrics: [] });
    const result = service.mapToQueryIntent(validated);
    expect(result.metrics).toBeUndefined();
  });

  // ── Requirement 15.4: QueryType mapping ───────────────────────────────
  describe('QueryType mapping (Req 15.4)', () => {
    const structuredTypes = ['single_metric', 'multi_metric', 'comparative', 'trend_analysis', 'screening'] as const;
    const hybridTypes = ['concept_analysis', 'peer_benchmark', 'modeling', 'sentiment'] as const;
    const semanticTypes = ['narrative_only'] as const;

    for (const qioType of structuredTypes) {
      it(`should map ${qioType} → 'structured'`, () => {
        const validated = buildValidated({ queryType: qioType });
        const result = service.mapToQueryIntent(validated);
        expect(result.type).toBe('structured');
      });
    }

    for (const qioType of hybridTypes) {
      it(`should map ${qioType} → 'hybrid'`, () => {
        const validated = buildValidated({ queryType: qioType });
        const result = service.mapToQueryIntent(validated);
        expect(result.type).toBe('hybrid');
      });
    }

    for (const qioType of semanticTypes) {
      it(`should map ${qioType} → 'semantic'`, () => {
        const validated = buildValidated({ queryType: qioType });
        const result = service.mapToQueryIntent(validated);
        expect(result.type).toBe('semantic');
      });
    }
  });

  // ── Requirement 15.5: Pass-through fields ─────────────────────────────
  it('should pass through needsNarrative (Req 15.5)', () => {
    const validated = buildValidated({ needsNarrative: true });
    const result = service.mapToQueryIntent(validated);
    expect(result.needsNarrative).toBe(true);
  });

  it('should pass through needsComputation (Req 15.5)', () => {
    const validated = buildValidated({ needsComputation: true });
    const result = service.mapToQueryIntent(validated);
    expect(result.needsComputation).toBe(true);
  });

  it('should pass through needsPeerComparison (Req 15.5)', () => {
    const validated = buildValidated({ needsPeerComparison: true });
    const result = service.mapToQueryIntent(validated);
    expect(result.needsPeerComparison).toBe(true);
  });

  it('should pass through originalQuery (Req 15.5)', () => {
    const validated = buildValidated({ originalQuery: 'compare amazon and nvidia' });
    const result = service.mapToQueryIntent(validated);
    expect(result.originalQuery).toBe('compare amazon and nvidia');
  });

  // ── needsComparison derived from queryType ────────────────────────────
  it('should set needsComparison=true when queryType is comparative', () => {
    const validated = buildValidated({ queryType: 'comparative' });
    const result = service.mapToQueryIntent(validated);
    expect(result.needsComparison).toBe(true);
  });

  it('should set needsComparison=false when queryType is not comparative', () => {
    const validated = buildValidated({ queryType: 'single_metric' });
    const result = service.mapToQueryIntent(validated);
    expect(result.needsComparison).toBe(false);
  });

  // ── needsTrend derived from queryType ─────────────────────────────────
  it('should set needsTrend=true when queryType is trend_analysis', () => {
    const validated = buildValidated({ queryType: 'trend_analysis' });
    const result = service.mapToQueryIntent(validated);
    expect(result.needsTrend).toBe(true);
  });

  // ── Time period mapping ───────────────────────────────────────────────
  describe('Time period mapping', () => {
    it('should map LATEST_BOTH → periodType=latest', () => {
      const validated = buildValidated({
        timePeriod: { periodType: 'LATEST_BOTH', specificPeriod: null },
      });
      const result = service.mapToQueryIntent(validated);
      expect(result.periodType).toBe('latest');
      expect(result.period).toBeUndefined();
    });

    it('should map SPECIFIC_YEAR → periodType=annual with period', () => {
      const validated = buildValidated({
        timePeriod: { periodType: 'SPECIFIC_YEAR', specificPeriod: 'FY2024' },
      });
      const result = service.mapToQueryIntent(validated);
      expect(result.periodType).toBe('annual');
      expect(result.period).toBe('FY2024');
    });

    it('should map SPECIFIC_QUARTER → periodType=quarterly with period', () => {
      const validated = buildValidated({
        timePeriod: { periodType: 'SPECIFIC_QUARTER', specificPeriod: 'Q3-2024' },
      });
      const result = service.mapToQueryIntent(validated);
      expect(result.periodType).toBe('quarterly');
      expect(result.period).toBe('Q3-2024');
    });

    it('should map RANGE → periodType=range with periodStart/periodEnd', () => {
      const validated = buildValidated({
        timePeriod: { periodType: 'RANGE', specificPeriod: null, rangeValue: 5, rangeUnit: 'years' },
      });
      const result = service.mapToQueryIntent(validated);
      expect(result.periodType).toBe('range');
      expect(result.periodStart).toBeDefined();
      expect(result.periodEnd).toBeDefined();
      // Verify the range spans 5 years
      const startYear = parseInt(result.periodStart!.replace('FY', ''));
      const endYear = parseInt(result.periodEnd!.replace('FY', ''));
      expect(endYear - startYear).toBe(5);
    });

    it('should map TTM → periodType=latest, period=TTM', () => {
      const validated = buildValidated({
        timePeriod: { periodType: 'TTM', specificPeriod: null },
      });
      const result = service.mapToQueryIntent(validated);
      expect(result.periodType).toBe('latest');
      expect(result.period).toBe('TTM');
    });

    it('should map YTD → periodType=latest, period=YTD', () => {
      const validated = buildValidated({
        timePeriod: { periodType: 'YTD', specificPeriod: null },
      });
      const result = service.mapToQueryIntent(validated);
      expect(result.periodType).toBe('latest');
      expect(result.period).toBe('YTD');
    });
  });

  // ── Confidence derivation ─────────────────────────────────────────────
  it('should derive confidence from highest entity confidence', () => {
    const validated = buildValidated({
      entities: [
        { ticker: 'AMZN', company: 'Amazon', confidence: 0.95, validated: true, source: 'exact_match' },
        { ticker: 'NVDA', company: 'NVIDIA', confidence: 0.80, validated: true, source: 'fuzzy_match' },
      ],
    });
    const result = service.mapToQueryIntent(validated);
    expect(result.confidence).toBe(0.95);
  });

  it('should default confidence to 0.5 when no entities', () => {
    const validated = buildValidated({ entities: [] });
    const result = service.mapToQueryIntent(validated);
    expect(result.confidence).toBe(0.5);
  });

  // ── End-to-end mapping scenario ───────────────────────────────────────
  it('should correctly map a full comparative query', () => {
    const validated = buildValidated({
      tickers: ['AMZN', 'NVDA'],
      entities: [
        { ticker: 'AMZN', company: 'Amazon', confidence: 0.95, validated: true, source: 'exact_match' },
        { ticker: 'NVDA', company: 'NVIDIA', confidence: 0.90, validated: true, source: 'exact_match' },
      ],
      metrics: [mockMetricResolution('roic', 'computed'), mockMetricResolution('net_sales')],
      queryType: 'comparative',
      timePeriod: { periodType: 'RANGE', specificPeriod: null, rangeValue: 5, rangeUnit: 'years' },
      needsComputation: true,
      originalQuery: 'compare amazon and nvidia roic and net sales over 5 years',
    });

    const result = service.mapToQueryIntent(validated);

    expect(result.ticker).toEqual(['AMZN', 'NVDA']);
    expect(result.type).toBe('structured');
    expect(result.metrics).toEqual(['roic', 'net_sales']);
    expect(result.periodType).toBe('range');
    expect(result.needsComparison).toBe(true);
    expect(result.needsComputation).toBe(true);
    expect(result.originalQuery).toBe('compare amazon and nvidia roic and net sales over 5 years');
  });
});
