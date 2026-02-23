import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { HaikuIntentParserService } from '../../src/rag/haiku-intent-parser.service';
import { IntentValidatorService, ValidatedQueryIntent } from '../../src/rag/intent-validator.service';
import { QueryIntentObject } from '../../src/rag/types/query-intent-object';

/**
 * Unit tests for IntentDetectorService.detect() — Haiku pipeline happy path.
 * Task 3.5b: normalize query → call Haiku parse → call validator → return ValidatedQueryIntent.
 *
 * No cache wiring (Task 5.1). No fallback wiring (Task 3.5c).
 *
 * Requirements: 10.1, 10.2, 10.4
 */
describe('IntentDetectorService — detect() happy path', () => {
  let service: IntentDetectorService;
  let haikuParser: jest.Mocked<HaikuIntentParserService>;
  let intentValidator: jest.Mocked<IntentValidatorService>;

  /** Helper to build a minimal QIO for mocking Haiku responses */
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

  /** Helper to build a minimal ValidatedQueryIntent for mocking validator responses */
  const buildValidated = (overrides: Partial<ValidatedQueryIntent> = {}): ValidatedQueryIntent => ({
    tickers: ['ABNB'],
    entities: [{
      ticker: 'ABNB',
      company: 'Airbnb',
      confidence: 0.95,
      validated: true,
      source: 'exact_match',
    }],
    metrics: [{
      canonical_id: 'revenue',
      display_name: 'Revenue',
      type: 'atomic',
      confidence: 'exact',
      fuzzy_score: null,
      original_query: 'revenue',
      match_source: 'synonym_index',
      suggestions: null,
      db_column: 'revenue',
    }],
    rawMetrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
    timePeriod: { periodType: 'LATEST_BOTH', specificPeriod: null },
    queryType: 'single_metric',
    needsNarrative: false,
    needsPeerComparison: false,
    needsComputation: false,
    originalQuery: 'abnb revenue',
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentDetectorService,
        { provide: BedrockService, useValue: { invokeModel: jest.fn() } },
        { provide: IntentAnalyticsService, useValue: { logDetection: jest.fn().mockResolvedValue(undefined) } },
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
  });

  // -------------------------------------------------------------------------
  // Happy path: Haiku → validate → return
  // -------------------------------------------------------------------------

  it('should call Haiku parser with normalized query', async () => {
    const qio = buildQIO();
    const validated = buildValidated();
    haikuParser.parse.mockResolvedValue(qio);
    intentValidator.validate.mockResolvedValue(validated);

    await service.detect('  ABNB  Revenue  ');

    // normalizeQuery trims, collapses whitespace, lowercases
    expect(haikuParser.parse).toHaveBeenCalledWith('abnb revenue');
  });

  it('should pass QIO from Haiku to validator', async () => {
    const qio = buildQIO();
    const validated = buildValidated();
    haikuParser.parse.mockResolvedValue(qio);
    intentValidator.validate.mockResolvedValue(validated);

    await service.detect('ABNB revenue');

    expect(intentValidator.validate).toHaveBeenCalledWith(qio);
  });

  it('should return ValidatedQueryIntent from validator', async () => {
    const qio = buildQIO();
    const validated = buildValidated();
    haikuParser.parse.mockResolvedValue(qio);
    intentValidator.validate.mockResolvedValue(validated);

    const result = await service.detect('ABNB revenue');

    expect(result).toBe(validated);
    expect(result.tickers).toEqual(['ABNB']);
    expect(result.queryType).toBe('single_metric');
    expect(result.originalQuery).toBe('abnb revenue');
  });

  it('should handle multi-entity comparative queries', async () => {
    const qio = buildQIO({
      entities: [
        { ticker: 'AMZN', company: 'Amazon', confidence: 0.95 },
        { ticker: 'NVDA', company: 'Nvidia', confidence: 0.9 },
      ],
      query_type: 'comparative',
    });
    const validated = buildValidated({
      tickers: ['AMZN', 'NVDA'],
      entities: [
        { ticker: 'AMZN', company: 'Amazon', confidence: 0.95, validated: true, source: 'exact_match' },
        { ticker: 'NVDA', company: 'Nvidia', confidence: 0.9, validated: true, source: 'exact_match' },
      ],
      queryType: 'comparative',
    });
    haikuParser.parse.mockResolvedValue(qio);
    intentValidator.validate.mockResolvedValue(validated);

    const result = await service.detect('compare amazon and nvidia roic');

    expect(result.tickers).toEqual(['AMZN', 'NVDA']);
    expect(result.queryType).toBe('comparative');
  });

  it('should handle narrative_only queries with no tickers', async () => {
    const qio = buildQIO({
      entities: [],
      metrics: [],
      query_type: 'narrative_only',
      needs_narrative: true,
    });
    const validated = buildValidated({
      tickers: [],
      entities: [],
      metrics: [],
      rawMetrics: [],
      queryType: 'narrative_only',
      needsNarrative: true,
    });
    haikuParser.parse.mockResolvedValue(qio);
    intentValidator.validate.mockResolvedValue(validated);

    const result = await service.detect('What did the 10-K say about risks?');

    expect(result.tickers).toEqual([]);
    expect(result.queryType).toBe('narrative_only');
    expect(result.needsNarrative).toBe(true);
  });

  it('should handle peer_benchmark queries', async () => {
    const qio = buildQIO({
      query_type: 'peer_benchmark',
      needs_peer_comparison: true,
    });
    const validated = buildValidated({
      queryType: 'peer_benchmark',
      needsPeerComparison: true,
    });
    haikuParser.parse.mockResolvedValue(qio);
    intentValidator.validate.mockResolvedValue(validated);

    const result = await service.detect('How does ABNB compare to peers on margins?');

    expect(result.queryType).toBe('peer_benchmark');
    expect(result.needsPeerComparison).toBe(true);
  });

  it('should preserve needsComputation from validator', async () => {
    const qio = buildQIO({ needs_computation: true });
    const validated = buildValidated({ needsComputation: true });
    haikuParser.parse.mockResolvedValue(qio);
    intentValidator.validate.mockResolvedValue(validated);

    const result = await service.detect('What is ABNB ROIC?');

    expect(result.needsComputation).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Haiku null return — fallback wired (Task 3.5c)
  // -------------------------------------------------------------------------

  it('should invoke regexFallback when Haiku returns null (Req 8.1, 8.6)', async () => {
    haikuParser.parse.mockResolvedValue(null);

    const fallbackResult = buildValidated({
      tickers: [],
      entities: [],
      metrics: [],
      rawMetrics: [],
      queryType: 'single_metric',
      timePeriod: { periodType: 'LATEST_BOTH', specificPeriod: null },
      originalQuery: 'some query',
    });

    // Spy on regexFallback to verify it's called and control its return
    jest.spyOn(service, 'regexFallback' as any).mockResolvedValue(fallbackResult);

    const result = await service.detect('some query');

    expect(result).toBe(fallbackResult);
    expect(result.queryType).toBe('single_metric');
    expect(result.timePeriod.periodType).toBe('LATEST_BOTH');
    expect(intentValidator.validate).not.toHaveBeenCalled();
    // regexFallback receives the original query, not the normalized one
    expect((service as any).regexFallback).toHaveBeenCalledWith('some query');
  });

  // -------------------------------------------------------------------------
  // Normalization is applied before Haiku call
  // -------------------------------------------------------------------------

  it('should normalize whitespace/casing variants to the same query (cache dedup)', async () => {
    const qio = buildQIO();
    const validated = buildValidated();
    haikuParser.parse.mockResolvedValue(qio);
    intentValidator.validate.mockResolvedValue(validated);

    await service.detect('ABNB revenue');
    await service.detect('abnb revenue');
    await service.detect('  ABNB  revenue  ');

    // All three normalize to "abnb revenue" → same cache key.
    // Only the first call should reach Haiku; the rest are cache hits (Req 7.5).
    expect(haikuParser.parse).toHaveBeenCalledTimes(1);
    expect(haikuParser.parse).toHaveBeenCalledWith('abnb revenue');
  });

  // -------------------------------------------------------------------------
  // Backward compatibility: ValidatedQueryIntent shape
  // -------------------------------------------------------------------------

  it('should return ValidatedQueryIntent with all required fields (Req 10.1, 10.2)', async () => {
    const qio = buildQIO();
    const validated = buildValidated();
    haikuParser.parse.mockResolvedValue(qio);
    intentValidator.validate.mockResolvedValue(validated);

    const result = await service.detect('ABNB revenue');

    // Verify all fields of ValidatedQueryIntent are present
    expect(result).toHaveProperty('tickers');
    expect(result).toHaveProperty('entities');
    expect(result).toHaveProperty('metrics');
    expect(result).toHaveProperty('rawMetrics');
    expect(result).toHaveProperty('timePeriod');
    expect(result).toHaveProperty('queryType');
    expect(result).toHaveProperty('needsNarrative');
    expect(result).toHaveProperty('needsPeerComparison');
    expect(result).toHaveProperty('needsComputation');
    expect(result).toHaveProperty('originalQuery');
  });

  it('should handle time period range queries', async () => {
    const qio = buildQIO({
      time_period: { type: 'range', value: 5, unit: 'years', raw_text: 'past 5 years' },
      query_type: 'trend_analysis',
    });
    const validated = buildValidated({
      timePeriod: { periodType: 'RANGE', specificPeriod: null, rangeValue: 5, rangeUnit: 'years' },
      queryType: 'trend_analysis',
    });
    haikuParser.parse.mockResolvedValue(qio);
    intentValidator.validate.mockResolvedValue(validated);

    const result = await service.detect("What is C's growth over past five years?");

    expect(result.timePeriod.periodType).toBe('RANGE');
    expect(result.timePeriod.rangeValue).toBe(5);
    expect(result.timePeriod.rangeUnit).toBe('years');
  });
});
