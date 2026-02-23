/**
 * Property-Based Tests for Ticker Validation (Property 3)
 *
 * Feature: haiku-first-intent-detection
 *
 * Property 3: Ticker Validation Produces Correct Outcome For All Entity Types
 *   - Exact matches get source "exact_match" with original confidence
 *   - Fuzzy matches get source "fuzzy_match" with confidence * 0.8
 *   - Unknown entities are excluded
 *   - Deduplication keeps highest confidence per ticker
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.9, 14.1**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { IntentValidatorService } from '../../src/rag/intent-validator.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { MetricResolution } from '../../src/rag/metric-resolution/types';
import {
  QueryIntentObject,
  QueryIntentEntity,
  QueryIntentMetric,
  QueryIntentTimePeriod,
} from '../../src/rag/types/query-intent-object';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal QIO with the given entities. */
function buildQIO(entities: QueryIntentEntity[]): QueryIntentObject {
  return {
    entities,
    metrics: [],
    time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
    query_type: 'single_metric',
    needs_narrative: false,
    needs_peer_comparison: false,
    needs_computation: false,
    original_query: 'test query',
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Property Tests - Ticker Validation (Property 3)', () => {
  let service: IntentValidatorService;

  // A subset of known tickers/companies from the base reference list
  const KNOWN_ENTRIES: Array<{ ticker: string; company: string }> = [
    { ticker: 'AAPL', company: 'Apple' },
    { ticker: 'AMZN', company: 'Amazon' },
    { ticker: 'MSFT', company: 'Microsoft' },
    { ticker: 'GOOGL', company: 'Alphabet' },
    { ticker: 'META', company: 'Meta Platforms' },
    { ticker: 'TSLA', company: 'Tesla' },
    { ticker: 'NVDA', company: 'Nvidia' },
    { ticker: 'JPM', company: 'JPMorgan Chase' },
    { ticker: 'C', company: 'Citigroup' },
    { ticker: 'V', company: 'Visa' },
    { ticker: 'T', company: 'AT&T' },
    { ticker: 'F', company: 'Ford' },
    { ticker: 'ABNB', company: 'Airbnb' },
    { ticker: 'NFLX', company: 'Netflix' },
    { ticker: 'DIS', company: 'Disney' },
  ];

  // Tickers that do NOT exist in the base reference list
  const UNKNOWN_TICKERS = ['ZZZZZ', 'XXXXX', 'QQQZZ', 'ABCDE', 'FGHIJ', 'LMNOP', 'RSTUV'];

  // Company names that do NOT match any known company (via substring)
  const UNKNOWN_COMPANIES = [
    'Zephyr Dynamics Corp',
    'Quantum Nebula Holdings',
    'Starlight Ventures LLC',
    'Obsidian Peak Industries',
    'Crimson Wave Technologies',
  ];

  beforeAll(async () => {
    const metricRegistryMock = {
      resolve: jest.fn().mockReturnValue({
        canonical_id: '',
        display_name: '',
        type: 'atomic',
        confidence: 'unresolved',
        fuzzy_score: null,
        original_query: '',
        match_source: 'none',
        suggestions: null,
      }),
    } as any;

    const prismaMock = {
      financialMetric: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentValidatorService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: MetricRegistryService, useValue: metricRegistryMock },
      ],
    }).compile();

    service = module.get<IntentValidatorService>(IntentValidatorService);
    await service.onModuleInit();
  });

  // --- Generators ---

  const confidenceArb = fc.double({ min: 0.1, max: 1.0, noNaN: true });

  const knownEntryArb = fc.constantFrom(...KNOWN_ENTRIES);

  /** Entity with a known ticker → exact match candidate */
  const exactMatchEntityArb = fc.tuple(knownEntryArb, confidenceArb).map(
    ([entry, confidence]) => ({
      ticker: entry.ticker,
      company: entry.company,
      confidence,
    }),
  );

  /** Entity with unknown ticker but known company name → fuzzy match candidate */
  const fuzzyMatchEntityArb = fc.tuple(
    knownEntryArb,
    fc.constantFrom(...UNKNOWN_TICKERS),
    confidenceArb,
  ).map(([entry, unknownTicker, confidence]) => ({
    ticker: unknownTicker,
    company: entry.company,
    confidence,
    _expectedTicker: entry.ticker,
  }));

  /** Entity with unknown ticker AND unknown company → should be excluded */
  const unknownEntityArb = fc.tuple(
    fc.constantFrom(...UNKNOWN_TICKERS),
    fc.constantFrom(...UNKNOWN_COMPANIES),
    confidenceArb,
  ).map(([ticker, company, confidence]) => ({
    ticker,
    company,
    confidence,
  }));

  // =====================================================================
  // Property 3: Ticker Validation Produces Correct Outcome For All Entity Types
  // =====================================================================

  describe('Property 3: Ticker Validation Produces Correct Outcome For All Entity Types', () => {
    /**
     * **Validates: Requirements 6.1, 6.2**
     *
     * Entities with tickers in the known set are marked as validated
     * with source "exact_match" and original confidence preserved.
     */
    it('exact matches get source "exact_match" with original confidence', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(exactMatchEntityArb, { minLength: 1, maxLength: 5 }),
          async (entities) => {
            const qio = buildQIO(entities);
            const result = await service.validate(qio);

            for (const entity of result.entities) {
              expect(entity.validated).toBe(true);
              expect(entity.source).toBe('exact_match');

              // After deduplication, the highest confidence for this ticker is kept
              const allMatchingConfidences = entities
                .filter((e) => e.ticker.toUpperCase() === entity.ticker)
                .map((e) => e.confidence);
              const maxConfidence = Math.max(...allMatchingConfidences);
              expect(entity.confidence).toBeCloseTo(maxConfidence, 10);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 6.3, 6.4, 14.1**
     *
     * Entities with unknown tickers but known company names get
     * source "fuzzy_match" with confidence reduced by exactly 20%.
     */
    it('fuzzy matches get source "fuzzy_match" with confidence * 0.8', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fuzzyMatchEntityArb, { minLength: 1, maxLength: 3 }),
          async (entities) => {
            const qioEntities = entities.map((e) => ({
              ticker: e.ticker,
              company: e.company,
              confidence: e.confidence,
            }));
            const qio = buildQIO(qioEntities);
            const result = await service.validate(qio);

            for (const validatedEntity of result.entities) {
              expect(validatedEntity.validated).toBe(true);
              expect(validatedEntity.source).toBe('fuzzy_match');

              // Find originals that mapped to this validated ticker
              const matchingOriginals = entities.filter(
                (e) => e._expectedTicker === validatedEntity.ticker,
              );

              if (matchingOriginals.length > 0) {
                // After deduplication, highest (confidence * 0.8) is kept
                const maxReducedConfidence = Math.max(
                  ...matchingOriginals.map((e) => e.confidence * 0.8),
                );
                expect(validatedEntity.confidence).toBeCloseTo(maxReducedConfidence, 10);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 6.5**
     *
     * Entities with unknown tickers and unknown company names
     * are excluded from the validated output.
     */
    it('unknown entities are excluded from validated output', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(unknownEntityArb, { minLength: 1, maxLength: 5 }),
          async (entities) => {
            const qio = buildQIO(entities);
            const result = await service.validate(qio);

            expect(result.entities).toHaveLength(0);
            expect(result.tickers).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 6.9**
     *
     * Duplicate tickers are deduplicated keeping the entry
     * with the highest confidence.
     */
    it('deduplication keeps highest confidence per ticker', async () => {
      await fc.assert(
        fc.asyncProperty(
          knownEntryArb,
          fc.array(confidenceArb, { minLength: 2, maxLength: 5 }),
          async (entry, confidences) => {
            const entities = confidences.map((conf) => ({
              ticker: entry.ticker,
              company: entry.company,
              confidence: conf,
            }));

            const qio = buildQIO(entities);
            const result = await service.validate(qio);

            // Should be deduplicated to exactly 1 entity
            expect(result.entities).toHaveLength(1);
            expect(result.tickers).toHaveLength(1);
            expect(result.entities[0].ticker).toBe(entry.ticker);

            const maxConfidence = Math.max(...confidences);
            expect(result.entities[0].confidence).toBeCloseTo(maxConfidence, 10);
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.9, 14.1**
     *
     * Mixed entity types: exact matches, fuzzy matches, and unknowns
     * are all handled correctly in a single validation call.
     */
    it('mixed entity types are all handled correctly together', async () => {
      await fc.assert(
        fc.asyncProperty(
          exactMatchEntityArb,
          fuzzyMatchEntityArb,
          unknownEntityArb,
          async (exactEntity, fuzzyEntity, unknownEntity) => {
            const qioEntities = [
              { ticker: exactEntity.ticker, company: exactEntity.company, confidence: exactEntity.confidence },
              { ticker: fuzzyEntity.ticker, company: fuzzyEntity.company, confidence: fuzzyEntity.confidence },
              { ticker: unknownEntity.ticker, company: unknownEntity.company, confidence: unknownEntity.confidence },
            ];

            const qio = buildQIO(qioEntities);
            const result = await service.validate(qio);

            // Unknown entity should never appear in output
            const unknownInResult = result.entities.find(
              (e) => UNKNOWN_TICKERS.includes(e.ticker),
            );
            expect(unknownInResult).toBeUndefined();

            // Exact match entity should be present with exact_match source
            const exactInResult = result.entities.find(
              (e) => e.ticker === exactEntity.ticker.toUpperCase() && e.source === 'exact_match',
            );
            if (exactInResult) {
              expect(exactInResult.validated).toBe(true);
            }

            // Fuzzy match entity should be present (unless deduped with exact)
            const fuzzyExpectedTicker = fuzzyEntity._expectedTicker;
            if (fuzzyExpectedTicker !== exactEntity.ticker) {
              const fuzzyInResult = result.entities.find(
                (e) => e.ticker === fuzzyExpectedTicker && e.source === 'fuzzy_match',
              );
              if (fuzzyInResult) {
                expect(fuzzyInResult.confidence).toBeCloseTo(fuzzyEntity.confidence * 0.8, 10);
              }
            }

            // Total validated entities: at most 2 (exact + fuzzy), at least 1 (exact)
            expect(result.entities.length).toBeGreaterThanOrEqual(1);
            expect(result.entities.length).toBeLessThanOrEqual(2);
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 6.1, 6.2, 14.1**
     *
     * The tickers array always matches the validated entities array,
     * and all tickers are uppercase.
     */
    it('tickers array matches validated entities and all tickers are uppercase', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(exactMatchEntityArb, { minLength: 1, maxLength: 5 }),
          async (entities) => {
            const qio = buildQIO(entities);
            const result = await service.validate(qio);

            expect(result.tickers).toHaveLength(result.entities.length);
            for (const entity of result.entities) {
              expect(result.tickers).toContain(entity.ticker);
              expect(entity.ticker).toBe(entity.ticker.toUpperCase());
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});


// ===========================================================================
// Property 4: Metric Resolution Tries Canonical Guess Then Raw Name
// ===========================================================================

/**
 * **Validates: Requirements 6.6**
 *
 * Property 4: Metric Resolution Tries Canonical Guess Then Raw Name
 *
 * For any QIO metric where the canonical_guess resolves via MetricRegistryService,
 * the IntentValidatorService SHALL use that resolution. For any QIO metric where
 * the canonical_guess does not resolve but the raw_name does, the IntentValidatorService
 * SHALL use the raw_name resolution. The number of resolved metrics in the output
 * SHALL equal the number of input metrics (unresolved metrics get placeholder resolutions).
 */
describe('Property 4: Metric Resolution Tries Canonical Guess Then Raw Name', () => {
  // We need a fresh service per test with a custom MetricRegistryService mock
  // that tracks call order.

  function buildResolved(query: string, canonicalId: string): MetricResolution {
    return {
      canonical_id: canonicalId,
      display_name: canonicalId.replace(/_/g, ' '),
      type: 'atomic',
      confidence: 'exact',
      fuzzy_score: null,
      original_query: query,
      match_source: `synonym:${query}`,
      suggestions: null,
    };
  }

  function buildUnresolved(query: string): MetricResolution {
    return {
      canonical_id: '',
      display_name: '',
      type: 'atomic',
      confidence: 'unresolved',
      fuzzy_score: null,
      original_query: query,
      match_source: 'none',
      suggestions: null,
    };
  }

  /** Arbitrary for a single metric with random names */
  const metricArb = fc.record({
    raw_name: fc.stringMatching(/^[a-z_]{3,15}$/),
    canonical_guess: fc.stringMatching(/^[a-z_]{3,15}$/),
    is_computed: fc.boolean(),
  });

  /**
   * For each metric, we randomly decide one of 3 resolution scenarios:
   * - 'canonical_resolves': canonical_guess resolves → raw_name should NOT be called
   * - 'raw_resolves': canonical_guess unresolved, raw_name resolves
   * - 'both_unresolved': both unresolved → placeholder returned
   */
  const scenarioArb = fc.constantFrom('canonical_resolves', 'raw_resolves', 'both_unresolved') as fc.Arbitrary<'canonical_resolves' | 'raw_resolves' | 'both_unresolved'>;

  it('resolution order: canonical_guess first, then raw_name fallback; output count equals input count', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(metricArb, scenarioArb), { minLength: 1, maxLength: 6 }),
        async (metricScenarios) => {
          const metrics: QueryIntentMetric[] = metricScenarios.map(([m]) => m);
          const scenarios = metricScenarios.map(([, s]) => s);

          // Track calls to resolve()
          const resolveCalls: string[] = [];

          const metricRegistryMock = {
            resolve: jest.fn().mockImplementation((query: string) => {
              resolveCalls.push(query);

              // Find which metric this call belongs to by matching against
              // canonical_guess or raw_name in order
              for (let i = 0; i < metrics.length; i++) {
                const metric = metrics[i];
                const scenario = scenarios[i];

                if (query === metric.canonical_guess) {
                  if (scenario === 'canonical_resolves') {
                    return buildResolved(query, `resolved_${metric.canonical_guess}`);
                  }
                  // canonical doesn't resolve
                  return buildUnresolved(query);
                }

                if (query === metric.raw_name) {
                  if (scenario === 'raw_resolves') {
                    return buildResolved(query, `resolved_${metric.raw_name}`);
                  }
                  // raw doesn't resolve either
                  return buildUnresolved(query);
                }
              }

              return buildUnresolved(query);
            }),
          } as any;

          const prismaMock = {
            financialMetric: {
              findMany: jest.fn().mockResolvedValue([]),
            },
          } as any;

          const module: TestingModule = await Test.createTestingModule({
            providers: [
              IntentValidatorService,
              { provide: PrismaService, useValue: prismaMock },
              { provide: MetricRegistryService, useValue: metricRegistryMock },
            ],
          }).compile();

          const svc = module.get<IntentValidatorService>(IntentValidatorService);
          await svc.onModuleInit();

          const qio: QueryIntentObject = {
            entities: [],
            metrics,
            time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
            query_type: 'single_metric',
            needs_narrative: false,
            needs_peer_comparison: false,
            needs_computation: false,
            original_query: 'test query',
          };

          resolveCalls.length = 0;
          const result = await svc.validate(qio);

          // Output metric count MUST equal input metric count
          expect(result.metrics).toHaveLength(metrics.length);

          // Verify resolution order for each metric
          for (let i = 0; i < metrics.length; i++) {
            const metric = metrics[i];
            const scenario = scenarios[i];
            const resolved = result.metrics[i];

            if (scenario === 'canonical_resolves') {
              // canonical_guess resolved → result should have the canonical resolution
              expect(resolved.confidence).not.toBe('unresolved');
              expect(resolved.canonical_id).toBe(`resolved_${metric.canonical_guess}`);
            } else if (scenario === 'raw_resolves') {
              // canonical_guess unresolved, raw_name resolved
              expect(resolved.confidence).not.toBe('unresolved');
              expect(resolved.canonical_id).toBe(`resolved_${metric.raw_name}`);
            } else {
              // both_unresolved → placeholder
              expect(resolved.confidence).toBe('unresolved');
            }
          }

          // Verify canonical_guess is always tried first:
          // For each metric, the canonical_guess call should appear before the raw_name call
          // (if raw_name was called at all)
          for (const metric of metrics) {
            const canonicalIdx = resolveCalls.indexOf(metric.canonical_guess);
            const rawIdx = resolveCalls.indexOf(metric.raw_name);

            // canonical_guess should always be called
            expect(canonicalIdx).toBeGreaterThanOrEqual(0);

            // If raw_name was also called, it should come after canonical_guess
            if (rawIdx >= 0 && metric.canonical_guess !== metric.raw_name) {
              expect(rawIdx).toBeGreaterThan(canonicalIdx);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('when canonical_guess resolves, raw_name is NOT called for that metric', async () => {
    await fc.assert(
      fc.asyncProperty(
        metricArb.filter((m) => m.canonical_guess !== m.raw_name),
        async (metric) => {
          const resolveCalls: string[] = [];

          const metricRegistryMock = {
            resolve: jest.fn().mockImplementation((query: string) => {
              resolveCalls.push(query);
              if (query === metric.canonical_guess) {
                return buildResolved(query, `resolved_canonical`);
              }
              return buildUnresolved(query);
            }),
          } as any;

          const prismaMock = {
            financialMetric: { findMany: jest.fn().mockResolvedValue([]) },
          } as any;

          const module: TestingModule = await Test.createTestingModule({
            providers: [
              IntentValidatorService,
              { provide: PrismaService, useValue: prismaMock },
              { provide: MetricRegistryService, useValue: metricRegistryMock },
            ],
          }).compile();

          const svc = module.get<IntentValidatorService>(IntentValidatorService);
          await svc.onModuleInit();

          const qio: QueryIntentObject = {
            entities: [],
            metrics: [metric],
            time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
            query_type: 'single_metric',
            needs_narrative: false,
            needs_peer_comparison: false,
            needs_computation: false,
            original_query: 'test',
          };

          resolveCalls.length = 0;
          await svc.validate(qio);

          // canonical_guess was called
          expect(resolveCalls).toContain(metric.canonical_guess);
          // raw_name was NOT called since canonical resolved
          expect(resolveCalls).not.toContain(metric.raw_name);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ===========================================================================
// Property 5: Time Period Mapping Covers All 6 Types Correctly
// ===========================================================================

/**
 * **Validates: Requirements 6.7**
 *
 * Property 5: Time Period Mapping Covers All 6 Types Correctly
 *
 * For any QIO time_period with type in {latest, specific_year, specific_quarter,
 * range, ttm, ytd}, the IntentValidatorService mapTimePeriod method SHALL produce
 * a MappedTimePeriod with the correct periodType mapping:
 * latest→LATEST_BOTH, specific_year→SPECIFIC_YEAR, specific_quarter→SPECIFIC_QUARTER,
 * range→RANGE, ttm→TTM, ytd→YTD.
 */
describe('Property 5: Time Period Mapping Covers All 6 Types Correctly', () => {
  let service: IntentValidatorService;

  beforeAll(async () => {
    const metricRegistryMock = {
      resolve: jest.fn().mockReturnValue({
        canonical_id: '',
        display_name: '',
        type: 'atomic',
        confidence: 'unresolved',
        fuzzy_score: null,
        original_query: '',
        match_source: 'none',
        suggestions: null,
      }),
    } as any;

    const prismaMock = {
      financialMetric: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentValidatorService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: MetricRegistryService, useValue: metricRegistryMock },
      ],
    }).compile();

    service = module.get<IntentValidatorService>(IntentValidatorService);
    await service.onModuleInit();
  });

  const EXPECTED_MAPPING: Record<string, string> = {
    latest: 'LATEST_BOTH',
    specific_year: 'SPECIFIC_YEAR',
    specific_quarter: 'SPECIFIC_QUARTER',
    range: 'RANGE',
    ttm: 'TTM',
    ytd: 'YTD',
  };

  // --- Generators for each time period type ---

  const latestArb: fc.Arbitrary<QueryIntentTimePeriod> = fc.record({
    type: fc.constant('latest' as const),
    value: fc.constant(null),
    unit: fc.constant(null),
    raw_text: fc.constantFrom('latest', 'most recent', ''),
  });

  const specificYearArb: fc.Arbitrary<QueryIntentTimePeriod> = fc.record({
    type: fc.constant('specific_year' as const),
    value: fc.integer({ min: 2000, max: 2030 }),
    unit: fc.constant(null),
    raw_text: fc.integer({ min: 2000, max: 2030 }).map((y) => `FY${y}`),
  });

  const specificQuarterArb: fc.Arbitrary<QueryIntentTimePeriod> = fc.record({
    type: fc.constant('specific_quarter' as const),
    value: fc.integer({ min: 1, max: 4 }),
    unit: fc.constant('quarters' as const),
    raw_text: fc.tuple(
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 2020, max: 2030 }),
    ).map(([q, y]) => `Q${q} ${y}`),
  });

  const rangeArb: fc.Arbitrary<QueryIntentTimePeriod> = fc.record({
    type: fc.constant('range' as const),
    value: fc.integer({ min: 1, max: 20 }),
    unit: fc.constantFrom('years' as const, 'quarters' as const, 'months' as const),
    raw_text: fc.tuple(
      fc.integer({ min: 1, max: 20 }),
      fc.constantFrom('years', 'quarters', 'months'),
    ).map(([v, u]) => `past ${v} ${u}`),
  });

  const ttmArb: fc.Arbitrary<QueryIntentTimePeriod> = fc.record({
    type: fc.constant('ttm' as const),
    value: fc.constant(null),
    unit: fc.constant(null),
    raw_text: fc.constantFrom('TTM', 'trailing twelve months', 'ttm'),
  });

  const ytdArb: fc.Arbitrary<QueryIntentTimePeriod> = fc.record({
    type: fc.constant('ytd' as const),
    value: fc.constant(null),
    unit: fc.constant(null),
    raw_text: fc.constantFrom('YTD', 'year to date', 'ytd'),
  });

  /** Arbitrary that generates any of the 6 time period types */
  const anyTimePeriodArb: fc.Arbitrary<QueryIntentTimePeriod> = fc.oneof(
    latestArb,
    specificYearArb,
    specificQuarterArb,
    rangeArb,
    ttmArb,
    ytdArb,
  );

  it('all 6 time period types map to the correct PeriodType', () => {
    fc.assert(
      fc.property(anyTimePeriodArb, (timePeriod) => {
        const mapped = service.mapTimePeriod(timePeriod);

        // Core property: periodType matches the expected mapping
        expect(mapped.periodType).toBe(EXPECTED_MAPPING[timePeriod.type]);
      }),
      { numRuns: 100 },
    );
  });

  it('specific_year maps with specificPeriod set to the year string', () => {
    fc.assert(
      fc.property(specificYearArb, (timePeriod) => {
        const mapped = service.mapTimePeriod(timePeriod);

        expect(mapped.periodType).toBe('SPECIFIC_YEAR');
        expect(mapped.specificPeriod).toBe(String(timePeriod.value));
      }),
      { numRuns: 100 },
    );
  });

  it('specific_quarter maps with specificPeriod set to raw_text', () => {
    fc.assert(
      fc.property(specificQuarterArb, (timePeriod) => {
        const mapped = service.mapTimePeriod(timePeriod);

        expect(mapped.periodType).toBe('SPECIFIC_QUARTER');
        expect(mapped.specificPeriod).toBe(timePeriod.raw_text);
      }),
      { numRuns: 100 },
    );
  });

  it('range maps with rangeValue and rangeUnit preserved', () => {
    fc.assert(
      fc.property(rangeArb, (timePeriod) => {
        const mapped = service.mapTimePeriod(timePeriod);

        expect(mapped.periodType).toBe('RANGE');
        expect(mapped.rangeValue).toBe(timePeriod.value);
        expect(mapped.rangeUnit).toBe(timePeriod.unit);
      }),
      { numRuns: 100 },
    );
  });

  it('latest, ttm, and ytd all have specificPeriod null', () => {
    const nullSpecificArb = fc.oneof(latestArb, ttmArb, ytdArb);

    fc.assert(
      fc.property(nullSpecificArb, (timePeriod) => {
        const mapped = service.mapTimePeriod(timePeriod);

        expect(mapped.periodType).toBe(EXPECTED_MAPPING[timePeriod.type]);
        expect(mapped.specificPeriod).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
