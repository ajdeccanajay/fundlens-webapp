/**
 * Property-Based Tests for Cache and Normalization (Properties 6 and 7)
 *
 * Feature: haiku-first-intent-detection
 *
 * Property 6: Query Normalization Produces Same Key For Whitespace and Casing Variants
 * Property 7: Cache Returns Identical Result On Second Call
 *
 * **Validates: Requirements 7.1, 7.2, 7.5**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { HaikuIntentParserService } from '../../src/rag/haiku-intent-parser.service';
import {
  IntentValidatorService,
  ValidatedQueryIntent,
} from '../../src/rag/intent-validator.service';
import { QueryIntentObject, QIOQueryType } from '../../src/rag/types/query-intent-object';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

// =====================================================================
// Property 6: Query Normalization Produces Same Key For Whitespace and Casing Variants
// =====================================================================
describe('Property Tests - Cache and Normalization', () => {
  describe('Property 6: Query Normalization Produces Same Key For Whitespace and Casing Variants', () => {
    /**
     * **Validates: Requirements 7.1, 7.5**
     *
     * For any query string, all whitespace/casing variants of that query
     * (produced by: changing case, adding leading/trailing spaces, inserting
     * extra spaces between words) SHALL produce the same normalized form
     * and therefore the same cache key.
     */

    let service: IntentDetectorService;

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          IntentDetectorService,
          { provide: BedrockService, useValue: {} },
          {
            provide: IntentAnalyticsService,
            useValue: { logDetection: jest.fn().mockResolvedValue(undefined) },
          },
          {
            provide: MetricRegistryService,
            useValue: { resolve: jest.fn(), resolveMultiple: jest.fn() },
          },
        ],
      }).compile();

      service = module.get<IntentDetectorService>(IntentDetectorService);
    });

    /** Generate a query string with at least one word */
    const queryWordArb = fc.stringMatching(/^[a-zA-Z0-9]{1,10}$/);
    const queryArb = fc.array(queryWordArb, { minLength: 1, maxLength: 8 })
      .map(words => words.join(' '));

    /** Create a whitespace variant: add random leading/trailing spaces and double spaces */
    const whitespaceVariantArb = (baseWords: string[]) =>
      fc.tuple(
        fc.integer({ min: 0, max: 5 }),  // leading spaces
        fc.integer({ min: 0, max: 5 }),  // trailing spaces
        fc.array(fc.boolean(), { minLength: baseWords.length - 1, maxLength: baseWords.length - 1 }),
      ).map(([leading, trailing, doubleSpaces]) => {
        let result = ' '.repeat(leading);
        for (let i = 0; i < baseWords.length; i++) {
          result += baseWords[i];
          if (i < baseWords.length - 1) {
            result += doubleSpaces[i] ? '  ' : ' ';
          }
        }
        result += ' '.repeat(trailing);
        return result;
      });

    /** Create a casing variant: randomly change case of each character */
    const casingVariantArb = (base: string) =>
      fc.array(fc.boolean(), { minLength: base.length, maxLength: base.length })
        .map(flags =>
          base.split('').map((ch, i) => flags[i] ? ch.toUpperCase() : ch.toLowerCase()).join(''),
        );

    it('whitespace variants produce the same normalized form', () => {
      fc.assert(
        fc.property(
          fc.array(queryWordArb, { minLength: 1, maxLength: 6 }),
          (words) => {
            const canonical = words.join(' ');
            const normalizedCanonical = service.normalizeQuery(canonical);

            // Generate a few whitespace variants manually
            const variant1 = '  ' + words.join('  ') + '  ';
            const variant2 = words.join('   ');
            const variant3 = '\t' + words.join(' ') + '\n';

            expect(service.normalizeQuery(variant1)).toBe(normalizedCanonical);
            expect(service.normalizeQuery(variant2)).toBe(normalizedCanonical);
            expect(service.normalizeQuery(variant3)).toBe(normalizedCanonical);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('casing variants produce the same normalized form', () => {
      fc.assert(
        fc.property(
          queryArb,
          (query) => {
            const normalizedOriginal = service.normalizeQuery(query);
            const normalizedUpper = service.normalizeQuery(query.toUpperCase());
            const normalizedLower = service.normalizeQuery(query.toLowerCase());

            // Mixed case: alternate upper/lower per character
            const mixed = query.split('').map((ch, i) =>
              i % 2 === 0 ? ch.toUpperCase() : ch.toLowerCase(),
            ).join('');
            const normalizedMixed = service.normalizeQuery(mixed);

            expect(normalizedUpper).toBe(normalizedOriginal);
            expect(normalizedLower).toBe(normalizedOriginal);
            expect(normalizedMixed).toBe(normalizedOriginal);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('whitespace + casing variants produce the same cache key', () => {
      fc.assert(
        fc.property(
          fc.array(queryWordArb, { minLength: 1, maxLength: 6 }),
          (words) => {
            const canonical = words.join(' ');
            const canonicalKey = service.computeCacheKey(service.normalizeQuery(canonical));

            // Whitespace variant
            const wsVariant = '  ' + words.join('   ') + '  ';
            const wsKey = service.computeCacheKey(service.normalizeQuery(wsVariant));

            // Casing variant
            const caseVariant = canonical.toUpperCase();
            const caseKey = service.computeCacheKey(service.normalizeQuery(caseVariant));

            // Combined whitespace + casing variant
            const combinedVariant = '  ' + words.map(w => w.toUpperCase()).join('   ') + '  ';
            const combinedKey = service.computeCacheKey(service.normalizeQuery(combinedVariant));

            expect(wsKey).toBe(canonicalKey);
            expect(caseKey).toBe(canonicalKey);
            expect(combinedKey).toBe(canonicalKey);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('cache key is a 16-character hex string', () => {
      fc.assert(
        fc.property(
          queryArb,
          (query) => {
            const normalized = service.normalizeQuery(query);
            const key = service.computeCacheKey(normalized);

            expect(key).toHaveLength(16);
            expect(key).toMatch(/^[0-9a-f]{16}$/);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('different queries (after normalization) produce different cache keys', () => {
      fc.assert(
        fc.property(
          queryArb,
          queryArb,
          (query1, query2) => {
            const norm1 = service.normalizeQuery(query1);
            const norm2 = service.normalizeQuery(query2);

            // Only check when normalized forms are actually different
            if (norm1 !== norm2) {
              const key1 = service.computeCacheKey(norm1);
              const key2 = service.computeCacheKey(norm2);
              // SHA-256 collision on 16 hex chars is astronomically unlikely
              expect(key1).not.toBe(key2);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });


  // =====================================================================
  // Property 7: Cache Returns Identical Result On Second Call
  // =====================================================================
  describe('Property 7: Cache Returns Identical Result On Second Call', () => {
    /**
     * **Validates: Requirements 7.2**
     *
     * For any query that has been processed through the full pipeline
     * (Haiku + validation) and cached, a subsequent call with the same
     * normalized query SHALL return a ValidatedQueryIntent identical to
     * the first result without invoking Haiku or the validation layer.
     */

    let service: IntentDetectorService;
    let haikuParser: jest.Mocked<HaikuIntentParserService>;
    let intentValidator: jest.Mocked<IntentValidatorService>;

    // --- Helpers ---

    const mockMetric = (canonical_id: string): MetricResolution => ({
      canonical_id,
      display_name: canonical_id.replace(/_/g, ' '),
      type: 'atomic',
      confidence: 'exact',
      fuzzy_score: null,
      original_query: canonical_id,
      match_source: 'synonym_index',
      suggestions: null,
      db_column: canonical_id,
    });

    const ALL_QIO_QUERY_TYPES: QIOQueryType[] = [
      'single_metric', 'multi_metric', 'comparative', 'peer_benchmark',
      'trend_analysis', 'concept_analysis', 'narrative_only', 'modeling',
      'sentiment', 'screening',
    ];

    // --- Generators ---

    /** Generate a random query string (1-6 words) */
    const queryWordArb = fc.stringMatching(/^[a-zA-Z]{2,8}$/);
    const queryArb = fc.array(queryWordArb, { minLength: 1, maxLength: 6 })
      .map(words => words.join(' '));

    /** Generate a random QIO that Haiku would return */
    const qioArb = fc.record({
      entities: fc.array(
        fc.record({
          ticker: fc.stringMatching(/^[A-Z]{1,5}$/).filter(s => s.length > 0),
          company: fc.stringMatching(/^[A-Za-z]{3,10}$/),
          confidence: fc.double({ min: 0.5, max: 1.0, noNaN: true }),
        }),
        { minLength: 1, maxLength: 3 },
      ),
      metrics: fc.array(
        fc.record({
          raw_name: fc.stringMatching(/^[a-z_]{3,12}$/).filter(s => s.length > 0),
          canonical_guess: fc.stringMatching(/^[a-z_]{3,12}$/).filter(s => s.length > 0),
          is_computed: fc.boolean(),
        }),
        { minLength: 1, maxLength: 3 },
      ),
      time_period: fc.record({
        type: fc.constantFrom('latest' as const, 'specific_year' as const, 'range' as const, 'ttm' as const),
        value: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 10 })),
        unit: fc.oneof(fc.constant(null), fc.constantFrom('years' as const, 'quarters' as const)),
        raw_text: fc.constant(''),
      }),
      query_type: fc.constantFrom(...ALL_QIO_QUERY_TYPES),
      needs_narrative: fc.boolean(),
      needs_peer_comparison: fc.boolean(),
      needs_computation: fc.boolean(),
      original_query: fc.constant(''),
    });

    /** Generate a ValidatedQueryIntent from a QIO */
    const validatedFromQio = (qio: QueryIntentObject): ValidatedQueryIntent => ({
      tickers: qio.entities.map(e => e.ticker),
      entities: qio.entities.map(e => ({
        ticker: e.ticker,
        company: e.company,
        confidence: e.confidence,
        validated: true,
        source: 'exact_match' as const,
      })),
      metrics: qio.metrics.map(m => mockMetric(m.canonical_guess)),
      rawMetrics: qio.metrics,
      timePeriod: { periodType: 'LATEST_BOTH', specificPeriod: null },
      queryType: qio.query_type,
      needsNarrative: qio.needs_narrative,
      needsPeerComparison: qio.needs_peer_comparison,
      needsComputation: qio.needs_computation,
      originalQuery: qio.original_query,
    });

    // --- Module setup (fresh per test to reset cache) ---

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          IntentDetectorService,
          { provide: BedrockService, useValue: {} },
          {
            provide: IntentAnalyticsService,
            useValue: { logDetection: jest.fn().mockResolvedValue(undefined) },
          },
          {
            provide: MetricRegistryService,
            useValue: { resolve: jest.fn(), resolveMultiple: jest.fn() },
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

    it('second call returns identical result from cache', async () => {
      // We run fewer iterations here since each iteration involves async calls
      // and module setup, but still meet the 100 minimum via beforeEach reset
      const samples = fc.sample(fc.tuple(queryArb, qioArb), 100);

      for (const [query, qio] of samples) {
        // Reset mocks for each sample
        haikuParser.parse.mockReset();
        intentValidator.validate.mockReset();

        const validated = validatedFromQio(qio);
        haikuParser.parse.mockResolvedValue(qio);
        intentValidator.validate.mockResolvedValue(validated);

        // First call — cache miss, should call Haiku + validator
        const result1 = await service.detect(query);

        // Second call — cache hit, should NOT call Haiku or validator
        const callCountAfterFirst = haikuParser.parse.mock.calls.length;
        const result2 = await service.detect(query);

        // Verify identical result
        expect(result2).toEqual(result1);

        // Verify Haiku was only called once (second call hit cache)
        expect(haikuParser.parse.mock.calls.length).toBe(callCountAfterFirst);
      }
    });

    it('haikuParser.parse() is called exactly once for duplicate queries', async () => {
      const samples = fc.sample(fc.tuple(queryArb, qioArb), 100);

      for (const [query, qio] of samples) {
        // Fresh module per sample to reset cache
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            IntentDetectorService,
            { provide: BedrockService, useValue: {} },
            {
              provide: IntentAnalyticsService,
              useValue: { logDetection: jest.fn().mockResolvedValue(undefined) },
            },
            {
              provide: MetricRegistryService,
              useValue: { resolve: jest.fn(), resolveMultiple: jest.fn() },
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

        const svc = module.get<IntentDetectorService>(IntentDetectorService);
        const parser = module.get(HaikuIntentParserService) as jest.Mocked<HaikuIntentParserService>;
        const validator = module.get(IntentValidatorService) as jest.Mocked<IntentValidatorService>;

        const validated = validatedFromQio(qio);
        parser.parse.mockResolvedValue(qio);
        validator.validate.mockResolvedValue(validated);

        // Call detect() twice with the same query
        await svc.detect(query);
        await svc.detect(query);

        // Haiku should have been called exactly once
        expect(parser.parse).toHaveBeenCalledTimes(1);
      }
    });

    it('whitespace/casing variants of the same query also hit cache', async () => {
      const samples = fc.sample(
        fc.tuple(
          fc.array(fc.stringMatching(/^[a-zA-Z]{2,6}$/), { minLength: 1, maxLength: 4 }),
          qioArb,
        ),
        100,
      );

      for (const [words, qio] of samples) {
        // Fresh module per sample to reset cache
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            IntentDetectorService,
            { provide: BedrockService, useValue: {} },
            {
              provide: IntentAnalyticsService,
              useValue: { logDetection: jest.fn().mockResolvedValue(undefined) },
            },
            {
              provide: MetricRegistryService,
              useValue: { resolve: jest.fn(), resolveMultiple: jest.fn() },
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

        const svc = module.get<IntentDetectorService>(IntentDetectorService);
        const parser = module.get(HaikuIntentParserService) as jest.Mocked<HaikuIntentParserService>;
        const validator = module.get(IntentValidatorService) as jest.Mocked<IntentValidatorService>;

        const validated = validatedFromQio(qio);
        parser.parse.mockResolvedValue(qio);
        validator.validate.mockResolvedValue(validated);

        // First call with canonical form
        const canonical = words.join(' ');
        const result1 = await svc.detect(canonical);

        // Second call with whitespace + casing variant
        const variant = '  ' + words.map(w => w.toUpperCase()).join('   ') + '  ';
        const result2 = await svc.detect(variant);

        // Should return identical result from cache
        expect(result2).toEqual(result1);

        // Haiku should have been called exactly once
        expect(parser.parse).toHaveBeenCalledTimes(1);
      }
    });
  });
});
