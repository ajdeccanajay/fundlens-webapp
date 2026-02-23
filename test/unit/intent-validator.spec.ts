/**
 * Unit tests for IntentValidatorService
 *
 * Tests: exact ticker match, fuzzy match by company name, ticker miss,
 * entity deduplication, metric resolution fallback, all 6 time period
 * mappings, and needs_computation correction.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9, 14.1, 14.2
 */

import { Test, TestingModule } from '@nestjs/testing';
import { IntentValidatorService } from '../../src/rag/intent-validator.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { MetricResolution } from '../../src/rag/metric-resolution/types';
import { QueryIntentObject } from '../../src/rag/types/query-intent-object';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildQIO(overrides: Partial<QueryIntentObject> = {}): QueryIntentObject {
  return {
    entities: [],
    metrics: [],
    time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
    query_type: 'single_metric',
    needs_narrative: false,
    needs_peer_comparison: false,
    needs_computation: false,
    original_query: 'test query',
    ...overrides,
  };
}

function buildResolved(canonical_id: string, type: 'atomic' | 'computed' = 'atomic'): MetricResolution {
  return {
    canonical_id,
    display_name: canonical_id.replace(/_/g, ' '),
    type,
    confidence: 'exact',
    fuzzy_score: null,
    original_query: canonical_id,
    match_source: 'synonym_index',
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('IntentValidatorService', () => {
  let service: IntentValidatorService;
  let metricRegistryMock: jest.Mocked<MetricRegistryService>;

  beforeEach(async () => {
    metricRegistryMock = {
      resolve: jest.fn(),
      resolveMultiple: jest.fn(),
      onModuleInit: jest.fn(),
      rebuildIndex: jest.fn(),
      getStats: jest.fn(),
      getMetricById: jest.fn(),
      getSynonymsForDbColumn: jest.fn(),
      getAllMetrics: jest.fn(),
      getTopologicalOrder: jest.fn(),
      getDependencyGraph: jest.fn(),
      getKnownMetricNames: jest.fn(),
      normalizeMetricName: jest.fn(),
      preloadClientOverlay: jest.fn(),
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

    // Initialize ticker data (loads base reference list)
    await service.onModuleInit();
  });

  // -------------------------------------------------------------------------
  // Exact ticker match (Req 6.1, 6.2)
  // -------------------------------------------------------------------------

  describe('exact ticker match', () => {
    it('should validate AMZN as exact_match with original confidence', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved('revenue'));

      const qio = buildQIO({
        entities: [{ ticker: 'AMZN', company: 'Amazon', confidence: 0.95 }],
      });

      const result = await service.validate(qio);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]).toEqual({
        ticker: 'AMZN',
        company: 'Amazon',
        confidence: 0.95,
        validated: true,
        source: 'exact_match',
      });
      expect(result.tickers).toEqual(['AMZN']);
    });

    it('should normalize lowercase ticker to uppercase for exact match', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      const qio = buildQIO({
        entities: [{ ticker: 'amzn', company: 'Amazon', confidence: 0.9 }],
      });

      const result = await service.validate(qio);

      expect(result.entities[0].ticker).toBe('AMZN');
      expect(result.entities[0].source).toBe('exact_match');
    });

    it('should validate single-letter ticker C (Citigroup)', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      const qio = buildQIO({
        entities: [{ ticker: 'C', company: 'Citigroup', confidence: 0.92 }],
      });

      const result = await service.validate(qio);

      expect(result.entities[0].ticker).toBe('C');
      expect(result.entities[0].source).toBe('exact_match');
      expect(result.entities[0].confidence).toBe(0.92);
    });
  });

  // -------------------------------------------------------------------------
  // Fuzzy match by company name (Req 6.3, 6.4, 14.1)
  // -------------------------------------------------------------------------

  describe('fuzzy match by company name', () => {
    it('should fuzzy match "Amazon" to AMZN with 80% confidence when ticker not found', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      const qio = buildQIO({
        entities: [{ ticker: 'AMAZN', company: 'Amazon', confidence: 0.9 }],
      });

      const result = await service.validate(qio);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].ticker).toBe('AMZN');
      expect(result.entities[0].source).toBe('fuzzy_match');
      expect(result.entities[0].confidence).toBeCloseTo(0.72); // 0.9 * 0.8
    });

    it('should fuzzy match partial company name "Airbnb Inc" to ABNB', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      const qio = buildQIO({
        entities: [{ ticker: 'AIRB', company: 'Airbnb Inc', confidence: 0.85 }],
      });

      const result = await service.validate(qio);

      expect(result.entities[0].ticker).toBe('ABNB');
      expect(result.entities[0].source).toBe('fuzzy_match');
      expect(result.entities[0].confidence).toBeCloseTo(0.68); // 0.85 * 0.8
    });
  });

  // -------------------------------------------------------------------------
  // Ticker miss (Req 6.5)
  // -------------------------------------------------------------------------

  describe('ticker miss', () => {
    it('should exclude entity when neither exact nor fuzzy match succeeds', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      const qio = buildQIO({
        entities: [{ ticker: 'ZZZZZ', company: 'Unknown Corp', confidence: 0.8 }],
      });

      const result = await service.validate(qio);

      expect(result.entities).toHaveLength(0);
      expect(result.tickers).toHaveLength(0);
    });

    it('should exclude entity with empty company name and unknown ticker', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      const qio = buildQIO({
        entities: [{ ticker: 'XYZ123', company: '', confidence: 0.5 }],
      });

      const result = await service.validate(qio);

      expect(result.entities).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Entity deduplication (Req 6.9)
  // -------------------------------------------------------------------------

  describe('entity deduplication', () => {
    it('should deduplicate entities by ticker keeping highest confidence', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      const qio = buildQIO({
        entities: [
          { ticker: 'AMZN', company: 'Amazon', confidence: 0.7 },
          { ticker: 'AMZN', company: 'Amazon.com', confidence: 0.95 },
          { ticker: 'NVDA', company: 'Nvidia', confidence: 0.9 },
        ],
      });

      const result = await service.validate(qio);

      expect(result.entities).toHaveLength(2);
      const amzn = result.entities.find((e) => e.ticker === 'AMZN');
      expect(amzn!.confidence).toBe(0.95);
      expect(result.tickers).toEqual(expect.arrayContaining(['AMZN', 'NVDA']));
    });
  });

  // -------------------------------------------------------------------------
  // Metric resolution (Req 6.6)
  // -------------------------------------------------------------------------

  describe('metric resolution', () => {
    it('should resolve metric via canonical_guess first', async () => {
      const resolved = buildResolved('revenue');
      metricRegistryMock.resolve.mockReturnValueOnce(resolved);

      const qio = buildQIO({
        metrics: [{ raw_name: 'rev', canonical_guess: 'revenue', is_computed: false }],
      });

      const result = await service.validate(qio);

      expect(metricRegistryMock.resolve).toHaveBeenCalledWith('revenue');
      expect(result.metrics[0].canonical_id).toBe('revenue');
    });

    it('should fallback to raw_name when canonical_guess is unresolved', async () => {
      metricRegistryMock.resolve
        .mockReturnValueOnce(buildUnresolved('ebitda_margin'))  // canonical_guess fails
        .mockReturnValueOnce(buildResolved('ebitda_margin'));    // raw_name succeeds

      const qio = buildQIO({
        metrics: [{ raw_name: 'EBITDA margin', canonical_guess: 'ebitda_margin', is_computed: true }],
      });

      const result = await service.validate(qio);

      expect(metricRegistryMock.resolve).toHaveBeenCalledTimes(2);
      expect(metricRegistryMock.resolve).toHaveBeenCalledWith('ebitda_margin');
      expect(metricRegistryMock.resolve).toHaveBeenCalledWith('EBITDA margin');
      expect(result.metrics[0].canonical_id).toBe('ebitda_margin');
    });

    it('should return unresolved when both canonical_guess and raw_name fail', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved('unknown_metric'));

      const qio = buildQIO({
        metrics: [{ raw_name: 'magic number', canonical_guess: 'unknown_metric', is_computed: false }],
      });

      const result = await service.validate(qio);

      expect(result.metrics[0].confidence).toBe('unresolved');
    });

    it('should preserve rawMetrics in output', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildResolved('revenue'));

      const rawMetrics = [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }];
      const qio = buildQIO({ metrics: rawMetrics });

      const result = await service.validate(qio);

      expect(result.rawMetrics).toEqual(rawMetrics);
    });
  });

  // -------------------------------------------------------------------------
  // needs_computation correction (Req 6.6 — design doc)
  // -------------------------------------------------------------------------

  describe('needs_computation correction', () => {
    it('should force needs_computation=true when any resolved metric has type=computed', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildResolved('gross_margin', 'computed'));

      const qio = buildQIO({
        metrics: [{ raw_name: 'gross margin', canonical_guess: 'gross_margin', is_computed: false }],
        needs_computation: false, // Haiku said false
      });

      const result = await service.validate(qio);

      expect(result.needsComputation).toBe(true);
    });

    it('should preserve needs_computation=true from Haiku even if no computed metrics resolved', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildResolved('revenue', 'atomic'));

      const qio = buildQIO({
        metrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
        needs_computation: true,
      });

      const result = await service.validate(qio);

      expect(result.needsComputation).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Time period mapping (Req 6.7)
  // -------------------------------------------------------------------------

  describe('time period mapping', () => {
    it('should map latest → LATEST_BOTH', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      const qio = buildQIO({
        time_period: { type: 'latest', value: null, unit: null, raw_text: 'latest' },
      });

      const result = await service.validate(qio);
      expect(result.timePeriod.periodType).toBe('LATEST_BOTH');
      expect(result.timePeriod.specificPeriod).toBeNull();
    });

    it('should map specific_year → SPECIFIC_YEAR with year value', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      const qio = buildQIO({
        time_period: { type: 'specific_year', value: 2024, unit: null, raw_text: 'FY2024' },
      });

      const result = await service.validate(qio);
      expect(result.timePeriod.periodType).toBe('SPECIFIC_YEAR');
      expect(result.timePeriod.specificPeriod).toBe('2024');
    });

    it('should map specific_quarter → SPECIFIC_QUARTER with raw_text', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      const qio = buildQIO({
        time_period: { type: 'specific_quarter', value: 3, unit: 'quarters', raw_text: 'Q3 2024' },
      });

      const result = await service.validate(qio);
      expect(result.timePeriod.periodType).toBe('SPECIFIC_QUARTER');
      expect(result.timePeriod.specificPeriod).toBe('Q3 2024');
    });

    it('should map range → RANGE with value and unit', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      const qio = buildQIO({
        time_period: { type: 'range', value: 5, unit: 'years', raw_text: 'past 5 years' },
      });

      const result = await service.validate(qio);
      expect(result.timePeriod.periodType).toBe('RANGE');
      expect(result.timePeriod.rangeValue).toBe(5);
      expect(result.timePeriod.rangeUnit).toBe('years');
    });

    it('should map ttm → TTM', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      const qio = buildQIO({
        time_period: { type: 'ttm', value: null, unit: null, raw_text: 'trailing twelve months' },
      });

      const result = await service.validate(qio);
      expect(result.timePeriod.periodType).toBe('TTM');
    });

    it('should map ytd → YTD', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      const qio = buildQIO({
        time_period: { type: 'ytd', value: null, unit: null, raw_text: 'year to date' },
      });

      const result = await service.validate(qio);
      expect(result.timePeriod.periodType).toBe('YTD');
    });
  });

  // -------------------------------------------------------------------------
  // Low confidence warning (Req 14.2)
  // -------------------------------------------------------------------------

  describe('low confidence warning', () => {
    it('should still include entity with confidence below 0.5 after fuzzy match', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      // confidence 0.5 * 0.8 = 0.4 (below 0.5 threshold)
      const qio = buildQIO({
        entities: [{ ticker: 'AMAZN', company: 'Amazon', confidence: 0.5 }],
      });

      const result = await service.validate(qio);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].confidence).toBeCloseTo(0.4);
      expect(result.entities[0].validated).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Pass-through fields
  // -------------------------------------------------------------------------

  describe('pass-through fields', () => {
    it('should pass through queryType, needsNarrative, needsPeerComparison, originalQuery', async () => {
      metricRegistryMock.resolve.mockReturnValue(buildUnresolved(''));

      const qio = buildQIO({
        query_type: 'peer_benchmark',
        needs_narrative: true,
        needs_peer_comparison: true,
        original_query: 'how does ABNB compare to peers?',
      });

      const result = await service.validate(qio);

      expect(result.queryType).toBe('peer_benchmark');
      expect(result.needsNarrative).toBe(true);
      expect(result.needsPeerComparison).toBe(true);
      expect(result.originalQuery).toBe('how does ABNB compare to peers?');
    });
  });
});
