/**
 * Property-Based Tests for QueryIntent Mapping (Property 9)
 *
 * Feature: haiku-first-intent-detection, Property 9: ValidatedQueryIntent Maps Correctly To QueryIntent
 *
 * **Validates: Requirements 10.1, 10.2, 15.1, 15.2, 15.3, 15.4, 15.5**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { ValidatedQueryIntent, ValidatedEntity, MappedTimePeriod } from '../../src/rag/intent-validator.service';
import { MetricResolution } from '../../src/rag/metric-resolution/types';
import { QIOQueryType } from '../../src/rag/types/query-intent-object';

describe('Property Tests - QueryIntent Mapping (Property 9)', () => {
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
          useValue: {
            resolve: jest.fn(),
            resolveMultiple: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);
  });

  // --- Constants ---

  const ALL_QIO_QUERY_TYPES: QIOQueryType[] = [
    'single_metric', 'multi_metric', 'comparative', 'peer_benchmark',
    'trend_analysis', 'concept_analysis', 'narrative_only', 'modeling',
    'sentiment', 'screening',
  ];

  const STRUCTURED_TYPES: QIOQueryType[] = [
    'single_metric', 'multi_metric', 'comparative', 'trend_analysis', 'screening',
  ];

  const HYBRID_TYPES: QIOQueryType[] = [
    'concept_analysis', 'peer_benchmark', 'modeling', 'sentiment',
  ];

  const SEMANTIC_TYPES: QIOQueryType[] = ['narrative_only'];

  const PERIOD_TYPES = ['LATEST_BOTH', 'SPECIFIC_YEAR', 'SPECIFIC_QUARTER', 'RANGE', 'TTM', 'YTD'] as const;

  // --- Generators ---

  /** Generate a random uppercase ticker (1-5 letters) */
  const tickerArb = fc.stringMatching(/^[A-Z]{1,5}$/).filter(s => s.length > 0);

  /** Generate a random company name */
  const companyNameArb = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,15}$/)
    .map(s => s.trim() || 'Company');

  /** Generate a random confidence score */
  const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

  /** Generate a ValidatedEntity */
  const validatedEntityArb = fc.record({
    ticker: tickerArb,
    company: companyNameArb,
    confidence: confidenceArb,
    validated: fc.constant(true),
    source: fc.constantFrom('exact_match' as const, 'fuzzy_match' as const),
  });

  /** Generate a MetricResolution */
  const metricResolutionArb = fc.record({
    canonical_id: fc.stringMatching(/^[a-z][a-z_]{2,20}$/).filter(s => s.length > 0),
    display_name: fc.stringMatching(/^[A-Za-z][A-Za-z ]{2,20}$/).map(s => s.trim() || 'Revenue'),
    type: fc.constantFrom('atomic' as const, 'computed' as const),
    confidence: fc.constantFrom('exact' as const, 'fuzzy_auto' as const, 'unresolved' as const),
    fuzzy_score: fc.oneof(fc.constant(null), fc.double({ min: 0, max: 1, noNaN: true })),
    original_query: fc.stringMatching(/^[a-z ]{1,20}$/).map(s => s.trim() || 'revenue'),
    match_source: fc.constant('synonym_index'),
    suggestions: fc.constant(null),
  });

  /** Generate a MappedTimePeriod */
  const mappedTimePeriodArb = fc.constantFrom(...PERIOD_TYPES).chain(periodType => {
    switch (periodType) {
      case 'LATEST_BOTH':
        return fc.constant({ periodType, specificPeriod: null } as MappedTimePeriod);
      case 'SPECIFIC_YEAR':
        return fc.integer({ min: 2000, max: 2030 }).map(year => ({
          periodType,
          specificPeriod: `FY${year}`,
        } as MappedTimePeriod));
      case 'SPECIFIC_QUARTER':
        return fc.tuple(
          fc.integer({ min: 1, max: 4 }),
          fc.integer({ min: 2000, max: 2030 }),
        ).map(([q, year]) => ({
          periodType,
          specificPeriod: `Q${q}-${year}`,
        } as MappedTimePeriod));
      case 'RANGE':
        return fc.integer({ min: 1, max: 10 }).map(rangeValue => ({
          periodType,
          specificPeriod: null,
          rangeValue,
          rangeUnit: 'years',
        } as MappedTimePeriod));
      case 'TTM':
        return fc.constant({ periodType, specificPeriod: null } as MappedTimePeriod);
      case 'YTD':
        return fc.constant({ periodType, specificPeriod: null } as MappedTimePeriod);
      default:
        return fc.constant({ periodType: 'LATEST_BOTH', specificPeriod: null } as MappedTimePeriod);
    }
  });

  /** Generate a random ValidatedQueryIntent */
  const validatedQueryIntentArb = fc.record({
    tickers: fc.array(tickerArb, { minLength: 0, maxLength: 5 }),
    entities: fc.array(validatedEntityArb, { minLength: 0, maxLength: 5 }),
    metrics: fc.array(metricResolutionArb, { minLength: 0, maxLength: 5 }),
    rawMetrics: fc.constant([]),
    timePeriod: mappedTimePeriodArb,
    queryType: fc.constantFrom(...ALL_QIO_QUERY_TYPES),
    needsNarrative: fc.boolean(),
    needsPeerComparison: fc.boolean(),
    needsComputation: fc.boolean(),
    originalQuery: fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
  }).map(v => {
    // Ensure entities match tickers for consistency
    const entities: ValidatedEntity[] = v.tickers.map((ticker, i) => ({
      ticker,
      company: v.entities[i]?.company || 'Company',
      confidence: v.entities[i]?.confidence ?? 0.9,
      validated: true,
      source: (v.entities[i]?.source || 'exact_match') as 'exact_match' | 'fuzzy_match',
    }));
    return { ...v, entities } as ValidatedQueryIntent;
  });

  // =====================================================================
  // Property 9: ValidatedQueryIntent Maps Correctly To QueryIntent
  // =====================================================================
  describe('Property 9: ValidatedQueryIntent Maps Correctly To QueryIntent', () => {
    /**
     * **Validates: Requirements 10.1, 10.2, 15.1, 15.2, 15.3, 15.4, 15.5**
     *
     * For any ValidatedQueryIntent, the mapping to QueryIntent SHALL:
     * - set ticker to a single string when tickers has length 1
     * - set ticker to an array when tickers has length > 1
     * - pass through metrics as canonical ID strings
     * - map queryType to the correct QueryType enum value
     * - preserve needsNarrative, needsComputation, needsPeerComparison, and originalQuery
     */

    it('single ticker maps to a string, multiple tickers map to an array (Req 15.1, 15.2)', () => {
      fc.assert(
        fc.property(validatedQueryIntentArb, (validated) => {
          const result = service.mapToQueryIntent(validated);

          if (validated.tickers.length === 0) {
            expect(result.ticker).toBeUndefined();
          } else if (validated.tickers.length === 1) {
            expect(typeof result.ticker).toBe('string');
            expect(result.ticker).toBe(validated.tickers[0]);
          } else {
            expect(Array.isArray(result.ticker)).toBe(true);
            expect(result.ticker).toEqual(validated.tickers);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('metrics are mapped to canonical_id strings (Req 15.3)', () => {
      fc.assert(
        fc.property(validatedQueryIntentArb, (validated) => {
          const result = service.mapToQueryIntent(validated);

          if (validated.metrics.length === 0) {
            expect(result.metrics).toBeUndefined();
          } else {
            expect(result.metrics).toEqual(
              validated.metrics.map(m => m.canonical_id),
            );
          }
        }),
        { numRuns: 100 },
      );
    });

    it('queryType maps to correct QueryType enum (Req 15.4)', () => {
      fc.assert(
        fc.property(validatedQueryIntentArb, (validated) => {
          const result = service.mapToQueryIntent(validated);

          if (STRUCTURED_TYPES.includes(validated.queryType)) {
            expect(result.type).toBe('structured');
          } else if (HYBRID_TYPES.includes(validated.queryType)) {
            expect(result.type).toBe('hybrid');
          } else if (SEMANTIC_TYPES.includes(validated.queryType)) {
            expect(result.type).toBe('semantic');
          }
        }),
        { numRuns: 100 },
      );
    });

    it('needsNarrative is preserved (Req 15.5)', () => {
      fc.assert(
        fc.property(validatedQueryIntentArb, (validated) => {
          const result = service.mapToQueryIntent(validated);
          expect(result.needsNarrative).toBe(validated.needsNarrative);
        }),
        { numRuns: 100 },
      );
    });

    it('needsComputation is preserved (Req 15.5)', () => {
      fc.assert(
        fc.property(validatedQueryIntentArb, (validated) => {
          const result = service.mapToQueryIntent(validated);
          expect(result.needsComputation).toBe(validated.needsComputation);
        }),
        { numRuns: 100 },
      );
    });

    it('needsPeerComparison is preserved (Req 15.5)', () => {
      fc.assert(
        fc.property(validatedQueryIntentArb, (validated) => {
          const result = service.mapToQueryIntent(validated);
          expect(result.needsPeerComparison).toBe(validated.needsPeerComparison);
        }),
        { numRuns: 100 },
      );
    });

    it('originalQuery is preserved (Req 15.5)', () => {
      fc.assert(
        fc.property(validatedQueryIntentArb, (validated) => {
          const result = service.mapToQueryIntent(validated);
          expect(result.originalQuery).toBe(validated.originalQuery);
        }),
        { numRuns: 100 },
      );
    });

    it('needsComparison is true iff queryType is comparative', () => {
      fc.assert(
        fc.property(validatedQueryIntentArb, (validated) => {
          const result = service.mapToQueryIntent(validated);
          expect(result.needsComparison).toBe(validated.queryType === 'comparative');
        }),
        { numRuns: 100 },
      );
    });

    it('needsTrend is true iff queryType is trend_analysis', () => {
      fc.assert(
        fc.property(validatedQueryIntentArb, (validated) => {
          const result = service.mapToQueryIntent(validated);
          expect(result.needsTrend).toBe(validated.queryType === 'trend_analysis');
        }),
        { numRuns: 100 },
      );
    });

    it('result always has a valid QueryType (structured, semantic, or hybrid)', () => {
      fc.assert(
        fc.property(validatedQueryIntentArb, (validated) => {
          const result = service.mapToQueryIntent(validated);
          expect(['structured', 'semantic', 'hybrid']).toContain(result.type);
        }),
        { numRuns: 100 },
      );
    });

    it('time period mapping produces valid periodType', () => {
      fc.assert(
        fc.property(validatedQueryIntentArb, (validated) => {
          const result = service.mapToQueryIntent(validated);
          // periodType should be one of the valid PeriodType values or undefined
          if (result.periodType) {
            expect(['annual', 'quarterly', 'latest', 'range']).toContain(result.periodType);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('RANGE time period produces periodStart and periodEnd', () => {
      const rangeValidatedArb = validatedQueryIntentArb.map(v => ({
        ...v,
        timePeriod: {
          periodType: 'RANGE',
          specificPeriod: null,
          rangeValue: 5,
          rangeUnit: 'years',
        } as MappedTimePeriod,
      }));

      fc.assert(
        fc.property(rangeValidatedArb, (validated) => {
          const result = service.mapToQueryIntent(validated);
          expect(result.periodType).toBe('range');
          expect(result.periodStart).toBeDefined();
          expect(result.periodEnd).toBeDefined();
        }),
        { numRuns: 100 },
      );
    });

    it('confidence is derived from highest entity confidence or defaults to 0.5', () => {
      fc.assert(
        fc.property(validatedQueryIntentArb, (validated) => {
          const result = service.mapToQueryIntent(validated);

          if (validated.entities.length === 0) {
            expect(result.confidence).toBe(0.5);
          } else {
            const maxConfidence = Math.max(...validated.entities.map(e => e.confidence));
            expect(result.confidence).toBeCloseTo(maxConfidence, 10);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
