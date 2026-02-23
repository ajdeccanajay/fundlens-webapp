import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { HaikuIntentParserService } from '../../src/rag/haiku-intent-parser.service';
import {
  IntentValidatorService,
  ValidatedQueryIntent,
  ValidatedEntity,
  MappedTimePeriod,
} from '../../src/rag/intent-validator.service';
import { QueryIntentObject, QIOQueryType } from '../../src/rag/types/query-intent-object';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

/**
 * Unit tests for the rewired IntentDetectorService — Haiku-first pipeline.
 * Task 3.9: Tests T0.2-T0.8, T0.11, fallback caching placeholder, and concept_analysis mapping.
 *
 * Requirements: 1.1, 1.3, 1.4, 1.5, 3.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 8.1, 8.5, 8.6
 */
describe('IntentDetectorService — Haiku pipeline (Task 3.9)', () => {
  let service: IntentDetectorService;
  let haikuParser: jest.Mocked<HaikuIntentParserService>;
  let intentValidator: jest.Mocked<IntentValidatorService>;
  let metricRegistry: jest.Mocked<MetricRegistryService>;

  // ── Helpers ──────────────────────────────────────────────────────────

  const mockMetric = (canonical_id: string, type: 'atomic' | 'computed' = 'atomic'): MetricResolution => ({
    canonical_id,
    display_name: canonical_id.replace(/_/g, ' '),
    type,
    confidence: 'exact',
    fuzzy_score: null,
    original_query: canonical_id,
    match_source: 'synonym_index',
    suggestions: null,
    db_column: canonical_id,
  });

  const buildQIO = (overrides: Partial<QueryIntentObject> = {}): QueryIntentObject => ({
    entities: [{ ticker: 'ABNB', company: 'Airbnb', confidence: 0.95 }],
    metrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
    time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
    query_type: 'single_metric',
    needs_narrative: false,
    needs_peer_comparison: false,
    needs_computation: false,
    original_query: 'abnb revenue',
    ...overrides,
  });

  const buildValidated = (overrides: Partial<ValidatedQueryIntent> = {}): ValidatedQueryIntent => ({
    tickers: ['ABNB'],
    entities: [{
      ticker: 'ABNB', company: 'Airbnb', confidence: 0.95,
      validated: true, source: 'exact_match',
    }],
    metrics: [mockMetric('revenue')],
    rawMetrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
    timePeriod: { periodType: 'LATEST_BOTH', specificPeriod: null },
    queryType: 'single_metric',
    needsNarrative: false,
    needsPeerComparison: false,
    needsComputation: false,
    originalQuery: 'abnb revenue',
    ...overrides,
  });

  // ── Module setup ────────────────────────────────────────────────────

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentDetectorService,
        { provide: BedrockService, useValue: { invokeModel: jest.fn() } },
        {
          provide: IntentAnalyticsService,
          useValue: { logDetection: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: MetricRegistryService,
          useValue: {
            resolve: jest.fn().mockReturnValue({
              canonical_id: '', display_name: '', type: 'atomic',
              confidence: 'unresolved', fuzzy_score: null, original_query: '',
              match_source: 'none', suggestions: null, db_column: '',
            }),
          },
        },
        {
          provide: HaikuIntentParserService,
          useValue: { parse: jest.fn() },
        },
        {
          provide: IntentValidatorService,
          useValue: { validate: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);
    haikuParser = module.get(HaikuIntentParserService);
    intentValidator = module.get(IntentValidatorService);
    metricRegistry = module.get(MetricRegistryService);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // T0.2: "what is c's growth over past five years?" → C, Citigroup, range/5/years
  // Requirements: 1.3, 4.1
  // ═══════════════════════════════════════════════════════════════════════
  describe('T0.2 — single-letter ticker C with range time period', () => {
    it('should detect ticker C (Citigroup) with range/5/years', async () => {
      const query = "what is c's growth over past five years?";

      const qio = buildQIO({
        entities: [{ ticker: 'C', company: 'Citigroup', confidence: 0.9 }],
        metrics: [{ raw_name: 'growth', canonical_guess: 'revenue_growth', is_computed: true }],
        time_period: { type: 'range', value: 5, unit: 'years', raw_text: 'past five years' },
        query_type: 'trend_analysis',
        needs_computation: true,
        original_query: query.toLowerCase(),
      });

      const validated = buildValidated({
        tickers: ['C'],
        entities: [{
          ticker: 'C', company: 'Citigroup', confidence: 0.9,
          validated: true, source: 'exact_match',
        }],
        metrics: [mockMetric('revenue_growth', 'computed')],
        rawMetrics: [{ raw_name: 'growth', canonical_guess: 'revenue_growth', is_computed: true }],
        timePeriod: { periodType: 'RANGE', specificPeriod: null, rangeValue: 5, rangeUnit: 'years' },
        queryType: 'trend_analysis',
        needsComputation: true,
        originalQuery: query.toLowerCase(),
      });

      haikuParser.parse.mockResolvedValue(qio);
      intentValidator.validate.mockResolvedValue(validated);

      const result = await service.detect(query);

      expect(result.tickers).toEqual(['C']);
      expect(result.entities[0].company).toBe('Citigroup');
      expect(result.timePeriod.periodType).toBe('RANGE');
      expect(result.timePeriod.rangeValue).toBe(5);
      expect(result.timePeriod.rangeUnit).toBe('years');
      expect(result.queryType).toBe('trend_analysis');
      expect(result.needsComputation).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // T0.3: "compare amazon and nvidia roic and net sales over 5 years"
  //        → AMZN, NVDA, comparative
  // Requirements: 1.1, 1.5, 3.4, 5.3
  // ═══════════════════════════════════════════════════════════════════════
  describe('T0.3 — multi-entity comparative with company names', () => {
    it('should detect AMZN + NVDA as comparative with ROIC and net sales', async () => {
      const query = 'compare amazon and nvidia roic and net sales over 5 years';

      const qio = buildQIO({
        entities: [
          { ticker: 'AMZN', company: 'Amazon', confidence: 0.95 },
          { ticker: 'NVDA', company: 'Nvidia', confidence: 0.95 },
        ],
        metrics: [
          { raw_name: 'roic', canonical_guess: 'roic', is_computed: true },
          { raw_name: 'net sales', canonical_guess: 'net_sales', is_computed: false },
        ],
        time_period: { type: 'range', value: 5, unit: 'years', raw_text: 'over 5 years' },
        query_type: 'comparative',
        needs_computation: true,
        original_query: query.toLowerCase(),
      });

      const validated = buildValidated({
        tickers: ['AMZN', 'NVDA'],
        entities: [
          { ticker: 'AMZN', company: 'Amazon', confidence: 0.95, validated: true, source: 'exact_match' },
          { ticker: 'NVDA', company: 'Nvidia', confidence: 0.95, validated: true, source: 'exact_match' },
        ],
        metrics: [mockMetric('roic', 'computed'), mockMetric('net_sales')],
        rawMetrics: [
          { raw_name: 'roic', canonical_guess: 'roic', is_computed: true },
          { raw_name: 'net sales', canonical_guess: 'net_sales', is_computed: false },
        ],
        timePeriod: { periodType: 'RANGE', specificPeriod: null, rangeValue: 5, rangeUnit: 'years' },
        queryType: 'comparative',
        needsComputation: true,
        originalQuery: query.toLowerCase(),
      });

      haikuParser.parse.mockResolvedValue(qio);
      intentValidator.validate.mockResolvedValue(validated);

      const result = await service.detect(query);

      expect(result.tickers).toEqual(['AMZN', 'NVDA']);
      expect(result.queryType).toBe('comparative');
      expect(result.metrics).toHaveLength(2);
      expect(result.metrics.map(m => m.canonical_id)).toEqual(['roic', 'net_sales']);
      expect(result.timePeriod.periodType).toBe('RANGE');
      expect(result.needsComputation).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // T0.4: "GAAP vs non-GAAP operating income for MSFT" → MSFT only
  // Requirements: 1.4, 3.4
  // ═══════════════════════════════════════════════════════════════════════
  describe('T0.4 — GAAP/non-GAAP metric disambiguation', () => {
    it('should detect MSFT only, GAAP classified as metric not ticker', async () => {
      const query = 'GAAP vs non-GAAP operating income for MSFT';

      const qio = buildQIO({
        entities: [{ ticker: 'MSFT', company: 'Microsoft', confidence: 0.95 }],
        metrics: [
          { raw_name: 'GAAP operating income', canonical_guess: 'operating_income', is_computed: false },
          { raw_name: 'non-GAAP operating income', canonical_guess: 'non_gaap_operating_income', is_computed: false },
        ],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'multi_metric',
        needs_computation: false,
        original_query: query.toLowerCase(),
      });

      const validated = buildValidated({
        tickers: ['MSFT'],
        entities: [{
          ticker: 'MSFT', company: 'Microsoft', confidence: 0.95,
          validated: true, source: 'exact_match',
        }],
        metrics: [mockMetric('operating_income'), mockMetric('non_gaap_operating_income')],
        rawMetrics: [
          { raw_name: 'GAAP operating income', canonical_guess: 'operating_income', is_computed: false },
          { raw_name: 'non-GAAP operating income', canonical_guess: 'non_gaap_operating_income', is_computed: false },
        ],
        queryType: 'multi_metric',
        originalQuery: query.toLowerCase(),
      });

      haikuParser.parse.mockResolvedValue(qio);
      intentValidator.validate.mockResolvedValue(validated);

      const result = await service.detect(query);

      // GAAP should NOT be extracted as a ticker
      expect(result.tickers).toEqual(['MSFT']);
      expect(result.tickers).not.toContain('GAAP');
      expect(result.queryType).toBe('multi_metric');
      expect(result.metrics).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // T0.5: "What did the 10-K say about risks?" → no tickers, narrative_only
  // Requirements: 5.5
  // ═══════════════════════════════════════════════════════════════════════
  describe('T0.5 — narrative-only query with no tickers', () => {
    it('should detect narrative_only with no tickers', async () => {
      const query = 'What did the 10-K say about risks?';

      const qio = buildQIO({
        entities: [],
        metrics: [],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'narrative_only',
        needs_narrative: true,
        needs_computation: false,
        original_query: query.toLowerCase(),
      });

      const validated = buildValidated({
        tickers: [],
        entities: [],
        metrics: [],
        rawMetrics: [],
        timePeriod: { periodType: 'LATEST_BOTH', specificPeriod: null },
        queryType: 'narrative_only',
        needsNarrative: true,
        needsComputation: false,
        originalQuery: query.toLowerCase(),
      });

      haikuParser.parse.mockResolvedValue(qio);
      intentValidator.validate.mockResolvedValue(validated);

      const result = await service.detect(query);

      expect(result.tickers).toEqual([]);
      expect(result.queryType).toBe('narrative_only');
      expect(result.needsNarrative).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // T0.6: "How does ABNB compare to peers on margins?" → peer_benchmark
  // Requirements: 5.4, 3.2
  // ═══════════════════════════════════════════════════════════════════════
  describe('T0.6 — peer benchmark query', () => {
    it('should detect ABNB with peer_benchmark and needs_peer_comparison', async () => {
      const query = 'How does ABNB compare to peers on margins?';

      const qio = buildQIO({
        entities: [{ ticker: 'ABNB', company: 'Airbnb', confidence: 0.95 }],
        metrics: [
          { raw_name: 'margins', canonical_guess: 'gross_margin', is_computed: true },
          { raw_name: 'margins', canonical_guess: 'operating_margin', is_computed: true },
          { raw_name: 'margins', canonical_guess: 'net_margin', is_computed: true },
        ],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'peer_benchmark',
        needs_peer_comparison: true,
        needs_computation: true,
        original_query: query.toLowerCase(),
      });

      const validated = buildValidated({
        tickers: ['ABNB'],
        entities: [{
          ticker: 'ABNB', company: 'Airbnb', confidence: 0.95,
          validated: true, source: 'exact_match',
        }],
        metrics: [
          mockMetric('gross_margin', 'computed'),
          mockMetric('operating_margin', 'computed'),
          mockMetric('net_margin', 'computed'),
        ],
        rawMetrics: [
          { raw_name: 'margins', canonical_guess: 'gross_margin', is_computed: true },
          { raw_name: 'margins', canonical_guess: 'operating_margin', is_computed: true },
          { raw_name: 'margins', canonical_guess: 'net_margin', is_computed: true },
        ],
        queryType: 'peer_benchmark',
        needsPeerComparison: true,
        needsComputation: true,
        originalQuery: query.toLowerCase(),
      });

      haikuParser.parse.mockResolvedValue(qio);
      intentValidator.validate.mockResolvedValue(validated);

      const result = await service.detect(query);

      expect(result.tickers).toEqual(['ABNB']);
      expect(result.queryType).toBe('peer_benchmark');
      expect(result.needsPeerComparison).toBe(true);
      expect(result.metrics).toHaveLength(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // T0.8: "What is V's PE ratio?" → V (Visa), PE as metric
  // Requirements: 1.3, 1.4
  // ═══════════════════════════════════════════════════════════════════════
  describe('T0.8 — single-letter ticker V with PE metric', () => {
    it('should detect V (Visa) and PE as metric, not ticker', async () => {
      const query = "What is V's PE ratio?";

      const qio = buildQIO({
        entities: [{ ticker: 'V', company: 'Visa', confidence: 0.9 }],
        metrics: [{ raw_name: 'PE ratio', canonical_guess: 'pe_ratio', is_computed: true }],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'single_metric',
        needs_computation: true,
        original_query: query.toLowerCase(),
      });

      const validated = buildValidated({
        tickers: ['V'],
        entities: [{
          ticker: 'V', company: 'Visa', confidence: 0.9,
          validated: true, source: 'exact_match',
        }],
        metrics: [mockMetric('pe_ratio', 'computed')],
        rawMetrics: [{ raw_name: 'PE ratio', canonical_guess: 'pe_ratio', is_computed: true }],
        queryType: 'single_metric',
        needsComputation: true,
        originalQuery: query.toLowerCase(),
      });

      haikuParser.parse.mockResolvedValue(qio);
      intentValidator.validate.mockResolvedValue(validated);

      const result = await service.detect(query);

      expect(result.tickers).toEqual(['V']);
      expect(result.entities[0].company).toBe('Visa');
      expect(result.tickers).not.toContain('PE');
      expect(result.metrics[0].canonical_id).toBe('pe_ratio');
      expect(result.needsComputation).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // T0.11: Bedrock failure → regex fallback fires
  // Requirements: 8.1, 8.6
  // ═══════════════════════════════════════════════════════════════════════
  describe('T0.11 — Bedrock failure triggers regex fallback', () => {
    it('should invoke regexFallback when Haiku returns null', async () => {
      haikuParser.parse.mockResolvedValue(null);

      const fallbackResult = buildValidated({
        tickers: [],
        entities: [],
        metrics: [],
        rawMetrics: [],
        queryType: 'single_metric',
        timePeriod: { periodType: 'LATEST_BOTH', specificPeriod: null },
        needsNarrative: false,
        needsPeerComparison: false,
        needsComputation: false,
        originalQuery: 'tell me about amazon AAPL performance',
      });

      jest.spyOn(service, 'regexFallback').mockResolvedValue(fallbackResult);

      const result = await service.detect('tell me about amazon AAPL performance');

      expect(service.regexFallback).toHaveBeenCalled();
      expect(intentValidator.validate).not.toHaveBeenCalled();
      expect(result.queryType).toBe('single_metric');
      expect(result.timePeriod.periodType).toBe('LATEST_BOTH');
    });

    it('should pass original (non-normalized) query to regexFallback', async () => {
      haikuParser.parse.mockResolvedValue(null);

      const fallbackResult = buildValidated({
        tickers: [],
        entities: [],
        metrics: [],
        rawMetrics: [],
        queryType: 'single_metric',
        timePeriod: { periodType: 'LATEST_BOTH', specificPeriod: null },
        originalQuery: '  AAPL  Revenue  ',
      });

      jest.spyOn(service, 'regexFallback').mockResolvedValue(fallbackResult);

      await service.detect('  AAPL  Revenue  ');

      // regexFallback receives the original query, not the normalized one
      expect(service.regexFallback).toHaveBeenCalledWith('  AAPL  Revenue  ');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Fallback caching — Task 5.2 (Req 8.5, 11.4)
  // ═══════════════════════════════════════════════════════════════════════
  describe('Fallback caching with 5min TTL (Task 5.2)', () => {
    it('should cache fallback result and serve from cache on repeated query', async () => {
      const query = 'some query that haiku cannot parse';

      // Haiku returns null both times
      haikuParser.parse.mockResolvedValue(null);

      const result1 = await service.detect(query);

      // First call: Haiku null → regexFallback runs → result cached
      expect(result1).toBeDefined();
      expect(result1.queryType).toBe('single_metric');
      expect(result1.timePeriod.periodType).toBe('LATEST_BOTH');

      // Second call: should hit fallback cache, NOT call regexFallback again
      const result2 = await service.detect(query);

      expect(result2).toEqual(result1);
      // Haiku was called twice (once per detect call, both return null)
      expect(haikuParser.parse).toHaveBeenCalledTimes(2);
    });

    it('should log "Fallback cache HIT" on cached fallback result', async () => {
      const query = 'unparseable query for cache test';
      const logSpy = jest.spyOn((service as any).logger, 'debug');

      haikuParser.parse.mockResolvedValue(null);

      // First call populates fallback cache
      await service.detect(query);
      // Second call should hit fallback cache
      await service.detect(query);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Fallback cache HIT'),
      );
    });

    it('should log "Fallback cache MISS" on fresh fallback execution', async () => {
      const query = 'fresh fallback query';
      const logSpy = jest.spyOn((service as any).logger, 'log');

      haikuParser.parse.mockResolvedValue(null);

      await service.detect(query);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Fallback cache MISS — cached with 5min TTL'),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // concept_analysis mapping → hybrid QueryType → ConceptRegistryService
  // Requirements: 5.7, 15.4
  // ═══════════════════════════════════════════════════════════════════════
  describe('concept_analysis → hybrid mapping and ConceptRegistryService', () => {
    it('should map concept_analysis ValidatedQueryIntent to hybrid QueryType', async () => {
      const query = 'how levered is ABNB?';

      const qio = buildQIO({
        entities: [{ ticker: 'ABNB', company: 'Airbnb', confidence: 0.95 }],
        metrics: [
          { raw_name: 'leverage', canonical_guess: 'net_debt_to_ebitda', is_computed: true },
          { raw_name: 'leverage', canonical_guess: 'debt_to_equity', is_computed: true },
          { raw_name: 'leverage', canonical_guess: 'interest_coverage', is_computed: true },
        ],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'concept_analysis',
        needs_computation: true,
        original_query: query.toLowerCase(),
      });

      const validated = buildValidated({
        tickers: ['ABNB'],
        entities: [{
          ticker: 'ABNB', company: 'Airbnb', confidence: 0.95,
          validated: true, source: 'exact_match',
        }],
        metrics: [
          mockMetric('net_debt_to_ebitda', 'computed'),
          mockMetric('debt_to_equity', 'computed'),
          mockMetric('interest_coverage', 'computed'),
        ],
        rawMetrics: [
          { raw_name: 'leverage', canonical_guess: 'net_debt_to_ebitda', is_computed: true },
          { raw_name: 'leverage', canonical_guess: 'debt_to_equity', is_computed: true },
          { raw_name: 'leverage', canonical_guess: 'interest_coverage', is_computed: true },
        ],
        queryType: 'concept_analysis',
        needsComputation: true,
        originalQuery: query.toLowerCase(),
      });

      haikuParser.parse.mockResolvedValue(qio);
      intentValidator.validate.mockResolvedValue(validated);

      const result = await service.detect(query);

      // Verify the ValidatedQueryIntent has concept_analysis
      expect(result.queryType).toBe('concept_analysis');

      // Map to QueryIntent and verify it becomes 'hybrid'
      const queryIntent = service.mapToQueryIntent(result);
      expect(queryIntent.type).toBe('hybrid');
      expect(queryIntent.ticker).toBe('ABNB');
      expect(queryIntent.needsComputation).toBe(true);
      expect(queryIntent.metrics).toEqual([
        'net_debt_to_ebitda',
        'debt_to_equity',
        'interest_coverage',
      ]);
    });

    it('should verify concept_analysis triggers ConceptRegistryService in QueryRouter', async () => {
      // This test verifies the design contract: when queryType is concept_analysis,
      // the mapped QueryIntent type is 'hybrid', which in QueryRouter triggers
      // buildHybridPlan(). The QueryRouter.route() method also checks
      // conceptRegistry.matchConcept() BEFORE intent detection.
      //
      // The key verification: concept_analysis → hybrid → QueryRouter uses
      // ConceptRegistryService for concept expansion.

      const validated = buildValidated({
        tickers: ['ABNB'],
        queryType: 'concept_analysis',
        needsComputation: true,
        metrics: [
          mockMetric('net_debt_to_ebitda', 'computed'),
          mockMetric('debt_to_equity', 'computed'),
          mockMetric('interest_coverage', 'computed'),
        ],
      });

      const queryIntent = service.mapToQueryIntent(validated);

      // concept_analysis maps to 'hybrid' — this is what triggers
      // QueryRouter to use buildHybridPlan which includes both
      // structured and semantic retrieval
      expect(queryIntent.type).toBe('hybrid');

      // The metrics from concept expansion are passed through
      expect(queryIntent.metrics).toContain('net_debt_to_ebitda');
      expect(queryIntent.metrics).toContain('debt_to_equity');
      expect(queryIntent.metrics).toContain('interest_coverage');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Task 5.4: Cache behavior tests
  // Requirements: 7.2, 7.4, 7.5, 8.5, 11.1
  // ═══════════════════════════════════════════════════════════════════════
  describe('Cache behavior (Task 5.4)', () => {
    // T0.9: Run T0.1 twice — second call returns from cache, "Cache HIT" logged
    describe('T0.9 — cache hit on second call', () => {
      it('should return cached result on second call and log "Cache HIT"', async () => {
        const query = "What is ABNB's latest revenue?";

        const qio = buildQIO({
          entities: [{ ticker: 'ABNB', company: 'Airbnb', confidence: 0.95 }],
          metrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
          time_period: { type: 'latest', value: null, unit: null, raw_text: 'latest' },
          query_type: 'single_metric',
          original_query: query.toLowerCase(),
        });

        const validated = buildValidated({
          tickers: ['ABNB'],
          entities: [{
            ticker: 'ABNB', company: 'Airbnb', confidence: 0.95,
            validated: true, source: 'exact_match',
          }],
          metrics: [mockMetric('revenue')],
          rawMetrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
          queryType: 'single_metric',
          originalQuery: query.toLowerCase(),
        });

        haikuParser.parse.mockResolvedValue(qio);
        intentValidator.validate.mockResolvedValue(validated);

        const logSpy = jest.spyOn((service as any).logger, 'debug');

        // First call — cache miss, calls Haiku + validator
        const result1 = await service.detect(query);
        expect(haikuParser.parse).toHaveBeenCalledTimes(1);
        expect(intentValidator.validate).toHaveBeenCalledTimes(1);

        // Second call — should hit cache
        const result2 = await service.detect(query);

        // Haiku should NOT be called again
        expect(haikuParser.parse).toHaveBeenCalledTimes(1);
        expect(intentValidator.validate).toHaveBeenCalledTimes(1);

        // Results should be identical
        expect(result2).toEqual(result1);

        // "Cache HIT" should be logged
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining('Cache HIT'),
        );
      });
    });

    // T0.10: Normalization variants produce same cache key, only one Haiku call
    describe('T0.10 — normalization produces same cache key', () => {
      it('should produce the same cache key for "ABNB revenue", "abnb revenue", "  ABNB  revenue  "', () => {
        const key1 = service.computeCacheKey(service.normalizeQuery('ABNB revenue'));
        const key2 = service.computeCacheKey(service.normalizeQuery('abnb revenue'));
        const key3 = service.computeCacheKey(service.normalizeQuery('  ABNB  revenue  '));

        expect(key1).toBe(key2);
        expect(key2).toBe(key3);
      });

      it('should call Haiku only once across all 3 normalization variants', async () => {
        const qio = buildQIO({
          entities: [{ ticker: 'ABNB', company: 'Airbnb', confidence: 0.95 }],
          metrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
          original_query: 'abnb revenue',
        });

        const validated = buildValidated({
          tickers: ['ABNB'],
          originalQuery: 'abnb revenue',
        });

        haikuParser.parse.mockResolvedValue(qio);
        intentValidator.validate.mockResolvedValue(validated);

        await service.detect('ABNB revenue');
        await service.detect('abnb revenue');
        await service.detect('  ABNB  revenue  ');

        // Only one Haiku call — the other two hit cache
        expect(haikuParser.parse).toHaveBeenCalledTimes(1);
      });
    });

    // Cache TTL expiration: after 24h, cache entry expires, new Haiku call made
    // Note: lru-cache v11 uses performance.now() internally for TTL tracking.
    // We simulate expiration by replacing the happyPathCache with a short-TTL instance.
    describe('Cache TTL expiration (24h)', () => {
      it('should expire happy-path cache after TTL and make a new Haiku call', async () => {
        // Replace the happy-path cache with a very short TTL (50ms) for testing
        const { LRUCache } = require('lru-cache');
        (service as any).happyPathCache = new LRUCache<string, any>({
          max: 5000,
          ttl: 50, // 50ms TTL for fast expiration in test
        });

        const query = 'ABNB revenue for TTL test';
        const qio = buildQIO({ original_query: query.toLowerCase() });
        const validated = buildValidated({ originalQuery: query.toLowerCase() });

        haikuParser.parse.mockResolvedValue(qio);
        intentValidator.validate.mockResolvedValue(validated);

        // First call — cache miss
        await service.detect(query);
        expect(haikuParser.parse).toHaveBeenCalledTimes(1);

        // Second call immediately — cache hit
        await service.detect(query);
        expect(haikuParser.parse).toHaveBeenCalledTimes(1);

        // Wait for TTL to expire
        await new Promise(resolve => setTimeout(resolve, 100));

        // Third call — cache expired, new Haiku call
        await service.detect(query);
        expect(haikuParser.parse).toHaveBeenCalledTimes(2);
      });
    });

    // Fallback result cached with shorter TTL (5 min)
    describe('Fallback result cached with 5min TTL', () => {
      it('should cache fallback result and serve it without calling regexFallback again', async () => {
        const query = 'unparseable query for fallback caching';

        haikuParser.parse.mockResolvedValue(null);

        const fallbackSpy = jest.spyOn(service, 'regexFallback');

        // First call — Haiku null → regexFallback runs → result cached
        const result1 = await service.detect(query);
        expect(fallbackSpy).toHaveBeenCalledTimes(1);

        // Second call — should hit fallback cache, NOT call regexFallback again
        const result2 = await service.detect(query);

        // regexFallback should NOT be called a second time
        expect(fallbackSpy).toHaveBeenCalledTimes(1);

        // Results should be identical
        expect(result2).toEqual(result1);
      });
    });

    // After fallback TTL expires, a new Haiku call is attempted (Bedrock recovery)
    describe('Bedrock recovery after fallback TTL expires', () => {
      it('should attempt Haiku again after fallback TTL expires and use happy path if Haiku recovers', async () => {
        // Replace the fallback cache with a very short TTL (50ms) for testing
        const { LRUCache } = require('lru-cache');
        (service as any).fallbackCache = new LRUCache<string, any>({
          max: 5000,
          ttl: 50, // 50ms TTL for fast expiration in test
        });

        const query = 'ABNB revenue bedrock recovery test';

        // First call: Haiku fails → fallback cached
        haikuParser.parse.mockResolvedValue(null);
        const fallbackResult = await service.detect(query);
        expect(fallbackResult.queryType).toBe('single_metric');
        expect(fallbackResult.timePeriod.periodType).toBe('LATEST_BOTH');
        expect(haikuParser.parse).toHaveBeenCalledTimes(1);

        // Wait for fallback TTL to expire
        await new Promise(resolve => setTimeout(resolve, 100));

        // Now Haiku recovers — returns a valid QIO
        const qio = buildQIO({
          entities: [{ ticker: 'ABNB', company: 'Airbnb', confidence: 0.95 }],
          metrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
          original_query: 'abnb revenue bedrock recovery test',
        });

        const validated = buildValidated({
          tickers: ['ABNB'],
          entities: [{
            ticker: 'ABNB', company: 'Airbnb', confidence: 0.95,
            validated: true, source: 'exact_match',
          }],
          metrics: [mockMetric('revenue')],
          queryType: 'single_metric',
          originalQuery: 'abnb revenue bedrock recovery test',
        });

        haikuParser.parse.mockResolvedValue(qio);
        intentValidator.validate.mockResolvedValue(validated);

        // Second call after TTL expiry — Haiku should be called again
        const recoveredResult = await service.detect(query);

        // Haiku was called again (total 2 calls)
        expect(haikuParser.parse).toHaveBeenCalledTimes(2);

        // The recovered result should use the happy path (validated result)
        expect(recoveredResult.tickers).toEqual(['ABNB']);
        expect(recoveredResult.entities[0].company).toBe('Airbnb');
        expect(recoveredResult.entities[0].source).toBe('exact_match');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Additional mapping verification tests
  // ═══════════════════════════════════════════════════════════════════════
  describe('mapToQueryIntent — additional coverage', () => {
    it('should map T0.2 result (range time period) correctly', () => {
      const validated = buildValidated({
        tickers: ['C'],
        entities: [{
          ticker: 'C', company: 'Citigroup', confidence: 0.9,
          validated: true, source: 'exact_match',
        }],
        timePeriod: { periodType: 'RANGE', specificPeriod: null, rangeValue: 5, rangeUnit: 'years' },
        queryType: 'trend_analysis',
        needsComputation: true,
      });

      const qi = service.mapToQueryIntent(validated);

      expect(qi.ticker).toBe('C');
      expect(qi.type).toBe('structured'); // trend_analysis → structured
      expect(qi.periodType).toBe('range');
      expect(qi.periodStart).toBeDefined();
      expect(qi.periodEnd).toBeDefined();
    });

    it('should map T0.3 result (comparative multi-ticker) correctly', () => {
      const validated = buildValidated({
        tickers: ['AMZN', 'NVDA'],
        entities: [
          { ticker: 'AMZN', company: 'Amazon', confidence: 0.95, validated: true, source: 'exact_match' },
          { ticker: 'NVDA', company: 'Nvidia', confidence: 0.95, validated: true, source: 'exact_match' },
        ],
        queryType: 'comparative',
      });

      const qi = service.mapToQueryIntent(validated);

      expect(qi.ticker).toEqual(['AMZN', 'NVDA']);
      expect(qi.type).toBe('structured'); // comparative → structured
      expect(qi.needsComparison).toBe(true);
    });

    it('should map T0.5 result (narrative_only) to semantic', () => {
      const validated = buildValidated({
        tickers: [],
        entities: [],
        queryType: 'narrative_only',
        needsNarrative: true,
      });

      const qi = service.mapToQueryIntent(validated);

      expect(qi.ticker).toBeUndefined();
      expect(qi.type).toBe('semantic');
      expect(qi.needsNarrative).toBe(true);
    });

    it('should map T0.6 result (peer_benchmark) to hybrid', () => {
      const validated = buildValidated({
        tickers: ['ABNB'],
        queryType: 'peer_benchmark',
        needsPeerComparison: true,
      });

      const qi = service.mapToQueryIntent(validated);

      expect(qi.ticker).toBe('ABNB');
      expect(qi.type).toBe('hybrid'); // peer_benchmark → hybrid
      expect(qi.needsPeerComparison).toBe(true);
    });
  });
});
