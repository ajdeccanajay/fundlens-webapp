/**
 * Property-Based Tests for QIO Parsing (Properties 1 and 2)
 *
 * Feature: haiku-first-intent-detection
 *
 * Property 1: QIO JSON Parsing Preserves All Fields With Correct Normalization
 * Property 2: Invalid JSON Always Returns Null
 *
 * **Validates: Requirements 1.2, 1.5, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { HaikuIntentParserService } from '../../src/rag/haiku-intent-parser.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { QIOQueryType } from '../../src/rag/types/query-intent-object';

describe('Property Tests - QIO Parsing', () => {
  let service: HaikuIntentParserService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HaikuIntentParserService,
        {
          provide: BedrockService,
          useValue: { invokeClaude: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<HaikuIntentParserService>(HaikuIntentParserService);
  });

  // --- Constants ---

  const VALID_QUERY_TYPES: QIOQueryType[] = [
    'single_metric', 'multi_metric', 'comparative', 'peer_benchmark',
    'trend_analysis', 'concept_analysis', 'narrative_only', 'modeling',
    'sentiment', 'screening',
  ];

  const VALID_TIME_PERIOD_TYPES = [
    'latest', 'specific_year', 'specific_quarter', 'range', 'ttm', 'ytd',
  ] as const;

  const VALID_TIME_PERIOD_UNITS = ['years', 'quarters', 'months'] as const;

  // --- Generators ---

  /** Generate a random ticker string (1-5 letters, mixed case) */
  const tickerArb = fc.stringMatching(/^[a-zA-Z]{1,5}$/);

  /** Generate a random company name */
  const companyNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z ]{0,20}$/)
    .map(s => s.trim() || 'Company');

  /** Generate a confidence score between 0 and 1 */
  const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

  /** Generate a random entity */
  const entityArb = fc.record({
    ticker: tickerArb,
    company: companyNameArb,
    confidence: confidenceArb,
  });

  /** Generate a random metric raw_name */
  const rawNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z_ ]{0,20}$/)
    .map(s => s.trim() || 'revenue');

  /** Generate a random canonical_guess (mixed case to test lowercasing) */
  const canonicalGuessArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z_]{0,20}$/);

  /** Generate a random metric */
  const metricArb = fc.record({
    raw_name: rawNameArb,
    canonical_guess: canonicalGuessArb,
    is_computed: fc.boolean(),
  });

  /** Generate a random time period */
  const timePeriodArb = fc.record({
    type: fc.constantFrom(...VALID_TIME_PERIOD_TYPES),
    value: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 2030 })),
    unit: fc.oneof(fc.constant(null), fc.constantFrom(...VALID_TIME_PERIOD_UNITS)),
    raw_text: fc.stringMatching(/^[a-zA-Z0-9 ]{0,30}$/),
  });

  /** Generate a valid QIO JSON object */
  const validQioArb = fc.record({
    entities: fc.array(entityArb, { minLength: 0, maxLength: 5 }),
    metrics: fc.array(metricArb, { minLength: 0, maxLength: 5 }),
    time_period: timePeriodArb,
    query_type: fc.constantFrom(...VALID_QUERY_TYPES),
    needs_narrative: fc.boolean(),
    needs_peer_comparison: fc.boolean(),
    needs_computation: fc.boolean(),
    original_query: fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
  });

  // =====================================================================
  // Property 1: QIO JSON Parsing Preserves All Fields With Correct Normalization
  // =====================================================================
  describe('Property 1: QIO JSON Parsing Preserves All Fields With Correct Normalization', () => {
    /**
     * **Validates: Requirements 1.2, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**
     *
     * For any valid QIO JSON object, parseResponse SHALL produce a QueryIntentObject
     * where: all entities are present with tickers normalized to uppercase, all metrics
     * are present with canonical_guess normalized to lowercase, the time_period structure
     * is preserved, the query_type is preserved, all boolean flags are preserved, and
     * the original_query is set to the input query string.
     */

    it('preserves entity count and uppercases all tickers', () => {
      fc.assert(
        fc.property(
          validQioArb,
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
          (qio, originalQuery) => {
            const jsonStr = JSON.stringify(qio);
            const result = service.parseResponse(jsonStr, originalQuery);

            expect(result).not.toBeNull();
            expect(result!.entities.length).toBe(qio.entities.length);

            for (let i = 0; i < qio.entities.length; i++) {
              expect(result!.entities[i].ticker).toBe(qio.entities[i].ticker.toUpperCase().trim());
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('preserves entity company names and clamps confidence to [0, 1]', () => {
      fc.assert(
        fc.property(
          validQioArb,
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
          (qio, originalQuery) => {
            const jsonStr = JSON.stringify(qio);
            const result = service.parseResponse(jsonStr, originalQuery);

            expect(result).not.toBeNull();
            for (let i = 0; i < qio.entities.length; i++) {
              expect(result!.entities[i].company).toBe(qio.entities[i].company.trim());
              expect(result!.entities[i].confidence).toBeGreaterThanOrEqual(0);
              expect(result!.entities[i].confidence).toBeLessThanOrEqual(1);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('preserves metric count and lowercases all canonical_guess values', () => {
      fc.assert(
        fc.property(
          validQioArb,
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
          (qio, originalQuery) => {
            const jsonStr = JSON.stringify(qio);
            const result = service.parseResponse(jsonStr, originalQuery);

            expect(result).not.toBeNull();
            expect(result!.metrics.length).toBe(qio.metrics.length);

            for (let i = 0; i < qio.metrics.length; i++) {
              expect(result!.metrics[i].canonical_guess).toBe(
                qio.metrics[i].canonical_guess.toLowerCase().trim(),
              );
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('preserves metric raw_name and is_computed flag', () => {
      fc.assert(
        fc.property(
          validQioArb,
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
          (qio, originalQuery) => {
            const jsonStr = JSON.stringify(qio);
            const result = service.parseResponse(jsonStr, originalQuery);

            expect(result).not.toBeNull();
            for (let i = 0; i < qio.metrics.length; i++) {
              expect(result!.metrics[i].raw_name).toBe(qio.metrics[i].raw_name.trim());
              expect(result!.metrics[i].is_computed).toBe(Boolean(qio.metrics[i].is_computed));
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('preserves time_period type and structure', () => {
      fc.assert(
        fc.property(
          validQioArb,
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
          (qio, originalQuery) => {
            const jsonStr = JSON.stringify(qio);
            const result = service.parseResponse(jsonStr, originalQuery);

            expect(result).not.toBeNull();
            expect(result!.time_period.type).toBe(qio.time_period.type);
            expect(result!.time_period.raw_text).toBe(qio.time_period.raw_text.trim());

            if (typeof qio.time_period.value === 'number') {
              expect(result!.time_period.value).toBe(qio.time_period.value);
            } else {
              expect(result!.time_period.value).toBeNull();
            }

            if (qio.time_period.unit && ['years', 'quarters', 'months'].includes(qio.time_period.unit)) {
              expect(result!.time_period.unit).toBe(qio.time_period.unit);
            } else {
              expect(result!.time_period.unit).toBeNull();
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('preserves query_type exactly', () => {
      fc.assert(
        fc.property(
          validQioArb,
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
          (qio, originalQuery) => {
            const jsonStr = JSON.stringify(qio);
            const result = service.parseResponse(jsonStr, originalQuery);

            expect(result).not.toBeNull();
            expect(result!.query_type).toBe(qio.query_type);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('preserves all boolean flags', () => {
      fc.assert(
        fc.property(
          validQioArb,
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
          (qio, originalQuery) => {
            const jsonStr = JSON.stringify(qio);
            const result = service.parseResponse(jsonStr, originalQuery);

            expect(result).not.toBeNull();
            expect(result!.needs_narrative).toBe(Boolean(qio.needs_narrative));
            expect(result!.needs_peer_comparison).toBe(Boolean(qio.needs_peer_comparison));
            expect(result!.needs_computation).toBe(Boolean(qio.needs_computation));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('sets original_query to the provided originalQuery parameter, not the JSON field', () => {
      fc.assert(
        fc.property(
          validQioArb,
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
          (qio, originalQuery) => {
            const jsonStr = JSON.stringify(qio);
            const result = service.parseResponse(jsonStr, originalQuery);

            expect(result).not.toBeNull();
            expect(result!.original_query).toBe(originalQuery);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('handles markdown-fenced JSON by stripping fences before parsing', () => {
      fc.assert(
        fc.property(
          validQioArb,
          fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/),
          (qio, originalQuery) => {
            const jsonStr = '```json\n' + JSON.stringify(qio) + '\n```';
            const result = service.parseResponse(jsonStr, originalQuery);

            expect(result).not.toBeNull();
            expect(result!.entities.length).toBe(qio.entities.length);
            expect(result!.metrics.length).toBe(qio.metrics.length);
            expect(result!.query_type).toBe(qio.query_type);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // =====================================================================
  // Property 2: Invalid JSON Always Returns Null
  // =====================================================================
  describe('Property 2: Invalid JSON Always Returns Null', () => {
    /**
     * **Validates: Requirements 1.7**
     *
     * For any string that is not valid JSON or is valid JSON but missing required
     * fields (entities array, metrics array, time_period object, or query_type string),
     * the parseResponse method SHALL return null.
     */

    it('random non-JSON strings always return null', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 200 }).filter(s => {
            try { JSON.parse(s); return false; } catch { return true; }
          }),
          (invalidJson) => {
            const result = service.parseResponse(invalidJson, 'test query');
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('valid JSON missing entities array returns null', () => {
      fc.assert(
        fc.property(
          validQioArb,
          (qio) => {
            const { entities, ...rest } = qio;
            const result = service.parseResponse(JSON.stringify(rest), 'test query');
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('valid JSON missing metrics array returns null', () => {
      fc.assert(
        fc.property(
          validQioArb,
          (qio) => {
            const { metrics, ...rest } = qio;
            const result = service.parseResponse(JSON.stringify(rest), 'test query');
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('valid JSON missing time_period object returns null', () => {
      fc.assert(
        fc.property(
          validQioArb,
          (qio) => {
            const { time_period, ...rest } = qio;
            const result = service.parseResponse(JSON.stringify(rest), 'test query');
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('valid JSON missing query_type returns null', () => {
      fc.assert(
        fc.property(
          validQioArb,
          (qio) => {
            const { query_type, ...rest } = qio;
            const result = service.parseResponse(JSON.stringify(rest), 'test query');
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('valid JSON with invalid query_type value returns null', () => {
      const invalidQueryTypes = fc.stringMatching(/^[a-z_]{3,20}$/)
        .filter(s => !VALID_QUERY_TYPES.includes(s as QIOQueryType));

      fc.assert(
        fc.property(
          validQioArb,
          invalidQueryTypes,
          (qio, badQueryType) => {
            const obj = { ...qio, query_type: badQueryType };
            const result = service.parseResponse(JSON.stringify(obj), 'test query');
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('valid JSON with invalid time_period.type returns null', () => {
      const validTypes = new Set(VALID_TIME_PERIOD_TYPES as readonly string[]);
      const invalidTimePeriodTypes = fc.stringMatching(/^[a-z_]{3,15}$/)
        .filter(s => !validTypes.has(s));

      fc.assert(
        fc.property(
          validQioArb,
          invalidTimePeriodTypes,
          (qio, badType) => {
            const obj = { ...qio, time_period: { ...qio.time_period, type: badType } };
            const result = service.parseResponse(JSON.stringify(obj), 'test query');
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('entities as non-array returns null', () => {
      fc.assert(
        fc.property(
          validQioArb,
          fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
          (qio, badEntities) => {
            const obj = { ...qio, entities: badEntities };
            const result = service.parseResponse(JSON.stringify(obj), 'test query');
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('metrics as non-array returns null', () => {
      fc.assert(
        fc.property(
          validQioArb,
          fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
          (qio, badMetrics) => {
            const obj = { ...qio, metrics: badMetrics };
            const result = service.parseResponse(JSON.stringify(obj), 'test query');
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('time_period as non-object returns null', () => {
      fc.assert(
        fc.property(
          validQioArb,
          fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
          (qio, badTimePeriod) => {
            const obj = { ...qio, time_period: badTimePeriod };
            const result = service.parseResponse(JSON.stringify(obj), 'test query');
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('empty string returns null', () => {
      expect(service.parseResponse('', 'test query')).toBeNull();
    });

    it('plain alphabetic text returns null', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-zA-Z ]{5,50}$/),
          (text) => {
            const result = service.parseResponse(text, 'test query');
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
