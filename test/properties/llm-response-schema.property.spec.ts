/**
 * Property-Based Tests for LLM Response Schema Validation
 *
 * Feature: intelligent-intent-detection-system
 * Property 12: LLM Response Schema Validation
 *
 * For any string returned by Claude, the LLM response parser SHALL either
 * produce a valid LlmClassificationResult with all required fields (tickers,
 * rawMetricPhrases, queryType, boolean flags, confidence) populated, or throw
 * a parse error that triggers the fallback path. The parser SHALL never produce
 * a partial result with missing required fields.
 *
 * **Validates: Requirements 9.3**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { LlmDetectionEngine, LlmClassificationResult } from '../../src/rag/intent-detection/llm-detection-engine';
import { BedrockService } from '../../src/rag/bedrock.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { ConceptRegistryService } from '../../src/rag/metric-resolution/concept-registry.service';

// ---------------------------------------------------------------------------
// Mocks — only parseResponse is tested, no LLM invocation needed
// ---------------------------------------------------------------------------

import { vi } from 'vitest';

const mockBedrock = {} as BedrockService;

const mockMetricRegistry = {
  getAllMetrics: vi.fn().mockReturnValue(
    new Map([
      ['total_revenue', { display_name: 'Total Revenue', canonical_id: 'total_revenue', type: 'atomic' }],
      ['net_income', { display_name: 'Net Income', canonical_id: 'net_income', type: 'atomic' }],
    ]),
  ),
} as unknown as MetricRegistryService;

const mockConceptRegistry = {
  getAllConceptIds: vi.fn().mockReturnValue([]),
  getConceptById: vi.fn().mockReturnValue(undefined),
} as unknown as ConceptRegistryService;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const VALID_QUERY_TYPES = ['structured', 'semantic', 'hybrid'] as const;
const VALID_SECTION_TYPES = ['item_1', 'item_1a', 'item_2', 'item_3', 'item_7', 'item_8'];

/** Arbitrary for a valid ticker string (1-5 uppercase letters) */
const tickerArb = fc.constantFrom('AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD', 'JPM', 'BAC');

/** Arbitrary for a valid query type */
const queryTypeArb = fc.constantFrom(...VALID_QUERY_TYPES);

/** Arbitrary for a confidence value in [0, 1] */
const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

/** Arbitrary for a valid LLM JSON response with all required fields */
const validLlmResponseArb = fc.record({
  tickers: fc.array(tickerArb, { minLength: 0, maxLength: 5 }),
  rawMetricPhrases: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 5 }),
  queryType: queryTypeArb,
  period: fc.option(fc.constantFrom('FY2024', 'Q4-2024', 'latest', 'TTM'), { nil: undefined }),
  periodStart: fc.option(fc.constantFrom('FY2020', 'FY2021'), { nil: undefined }),
  periodEnd: fc.option(fc.constantFrom('FY2024', 'FY2023'), { nil: undefined }),
  documentTypes: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 3 }), { nil: undefined }),
  sectionTypes: fc.option(fc.array(fc.constantFrom(...VALID_SECTION_TYPES), { maxLength: 3 }), { nil: undefined }),
  subsectionName: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  needsNarrative: fc.boolean(),
  needsComparison: fc.boolean(),
  needsComputation: fc.boolean(),
  needsTrend: fc.boolean(),
  needsPeerComparison: fc.boolean(),
  needsClarification: fc.boolean(),
  ambiguityReason: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
  conceptMatch: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  confidence: confidenceArb,
});

/** Required fields that must be present in a valid result */
const REQUIRED_BOOLEAN_FIELDS: (keyof LlmClassificationResult)[] = [
  'needsNarrative',
  'needsComparison',
  'needsComputation',
  'needsTrend',
  'needsPeerComparison',
  'needsClarification',
];


/**
 * Validates that a result has all required fields with correct types.
 * This is the core invariant: no partial results with missing required fields.
 */
function assertValidResult(result: LlmClassificationResult): void {
  // tickers: string[]
  expect(Array.isArray(result.tickers)).toBe(true);
  result.tickers.forEach((t) => expect(typeof t).toBe('string'));

  // rawMetricPhrases: string[]
  expect(Array.isArray(result.rawMetricPhrases)).toBe(true);
  result.rawMetricPhrases.forEach((m) => expect(typeof m).toBe('string'));

  // queryType: one of the valid types
  expect(['structured', 'semantic', 'hybrid']).toContain(result.queryType);

  // Boolean flags: must be actual booleans
  for (const field of REQUIRED_BOOLEAN_FIELDS) {
    expect(typeof result[field]).toBe('boolean');
  }

  // confidence: number in [0, 1]
  expect(typeof result.confidence).toBe('number');
  expect(result.confidence).toBeGreaterThanOrEqual(0);
  expect(result.confidence).toBeLessThanOrEqual(1);
  expect(Number.isNaN(result.confidence)).toBe(false);
}

describe('Property Tests - LLM Response Schema Validation', () => {
  let engine: LlmDetectionEngine;

  beforeEach(() => {
    engine = new LlmDetectionEngine(mockBedrock, mockMetricRegistry, mockConceptRegistry);
  });

  /**
   * **Validates: Requirements 9.3**
   *
   * Property 12: For any valid JSON response with all required fields,
   * parseResponse SHALL produce a valid LlmClassificationResult with
   * all required fields populated and correctly typed.
   */
  describe('Property 12: Valid JSON responses produce valid results', () => {
    it('any well-formed LLM response with required fields produces a valid result', () => {
      fc.assert(
        fc.property(validLlmResponseArb, (responseObj) => {
          const responseStr = JSON.stringify(responseObj);
          const result = engine.parseResponse(responseStr, 'test query');
          assertValidResult(result);
        }),
        { numRuns: 100 },
      );
    });

    it('tickers in the result are always uppercased', () => {
      fc.assert(
        fc.property(validLlmResponseArb, (responseObj) => {
          const responseStr = JSON.stringify(responseObj);
          const result = engine.parseResponse(responseStr, 'test query');
          result.tickers.forEach((t) => {
            expect(t).toBe(t.toUpperCase());
          });
        }),
        { numRuns: 100 },
      );
    });

    it('confidence is always clamped to [0, 1] even with out-of-range input', () => {
      fc.assert(
        fc.property(
          validLlmResponseArb,
          fc.double({ min: -100, max: 100, noNaN: true }),
          (responseObj, rawConfidence) => {
            const modified = { ...responseObj, confidence: rawConfidence };
            const responseStr = JSON.stringify(modified);
            const result = engine.parseResponse(responseStr, 'test query');
            expect(result.confidence).toBeGreaterThanOrEqual(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('valid JSON wrapped in markdown code blocks produces a valid result', () => {
      fc.assert(
        fc.property(validLlmResponseArb, (responseObj) => {
          const json = JSON.stringify(responseObj);
          const wrapped = '```json\n' + json + '\n```';
          const result = engine.parseResponse(wrapped, 'test query');
          assertValidResult(result);
        }),
        { numRuns: 10 },
      );
    });

    it('valid JSON with surrounding text produces a valid result', () => {
      fc.assert(
        fc.property(
          validLlmResponseArb,
          fc.string({ minLength: 0, maxLength: 30 }),
          fc.string({ minLength: 0, maxLength: 30 }),
          (responseObj, prefix, suffix) => {
            const json = JSON.stringify(responseObj);
            // Ensure prefix/suffix don't contain { or } which would confuse extraction
            const safePrefix = prefix.replace(/[{}]/g, '') + '\n';
            const safeSuffix = '\n' + suffix.replace(/[{}]/g, '');
            const wrapped = safePrefix + json + safeSuffix;
            const result = engine.parseResponse(wrapped, 'test query');
            assertValidResult(result);
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  /**
   * **Validates: Requirements 9.3**
   *
   * Property 12: For any string that is NOT valid JSON or is missing required
   * fields, parseResponse SHALL either throw a parse error OR produce a valid
   * result via partial extraction. It SHALL never produce a partial result
   * with missing required fields.
   */
  describe('Property 12: Invalid inputs either throw or produce valid results', () => {
    it('random strings either throw or produce a fully valid result (never partial)', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 500 }), (randomStr) => {
          try {
            const result = engine.parseResponse(randomStr, 'test query');
            // If it didn't throw, the result MUST be fully valid
            assertValidResult(result);
          } catch (e) {
            // Throwing is acceptable — it triggers the fallback path
            expect(e).toBeInstanceOf(Error);
          }
        }),
        { numRuns: 10 },
      );
    });

    it('JSON objects missing required fields either throw or produce valid results', () => {
      // Generate JSON objects that are missing one or more required fields
      const partialJsonArb = fc.record({
        tickers: fc.option(fc.array(fc.string(), { maxLength: 3 }), { nil: undefined }),
        rawMetricPhrases: fc.option(fc.array(fc.string(), { maxLength: 3 }), { nil: undefined }),
        queryType: fc.option(fc.constantFrom('structured', 'semantic', 'hybrid', 'invalid', 'unknown'), { nil: undefined }),
        needsNarrative: fc.option(fc.boolean(), { nil: undefined }),
        needsComparison: fc.option(fc.boolean(), { nil: undefined }),
        needsComputation: fc.option(fc.boolean(), { nil: undefined }),
        needsTrend: fc.option(fc.boolean(), { nil: undefined }),
        needsPeerComparison: fc.option(fc.boolean(), { nil: undefined }),
        needsClarification: fc.option(fc.boolean(), { nil: undefined }),
        confidence: fc.option(fc.double({ min: -10, max: 10, noNaN: true }), { nil: undefined }),
      });

      fc.assert(
        fc.property(partialJsonArb, (partialObj) => {
          // Remove undefined keys to simulate missing fields
          const cleaned: Record<string, any> = {};
          for (const [k, v] of Object.entries(partialObj)) {
            if (v !== undefined) cleaned[k] = v;
          }
          const responseStr = JSON.stringify(cleaned);

          try {
            const result = engine.parseResponse(responseStr, 'test query');
            // If it didn't throw, the result MUST be fully valid
            assertValidResult(result);
          } catch (e) {
            // Throwing is acceptable — it triggers the fallback path
            expect(e).toBeInstanceOf(Error);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('non-object JSON values (arrays, numbers, booleans, null) either throw or produce valid results', () => {
      const nonObjectArb = fc.oneof(
        fc.array(fc.anything(), { maxLength: 5 }).map(JSON.stringify),
        fc.double({ noNaN: true }).map(String),
        fc.boolean().map(String),
        fc.constant('null'),
      );

      fc.assert(
        fc.property(nonObjectArb, (responseStr) => {
          try {
            const result = engine.parseResponse(responseStr, 'test query');
            assertValidResult(result);
          } catch (e) {
            expect(e).toBeInstanceOf(Error);
          }
        }),
        { numRuns: 10 },
      );
    });

    it('JSON with wrong field types either throws or produces valid results', () => {
      // Generate JSON where fields have wrong types
      const wrongTypesArb = fc.record({
        tickers: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
        rawMetricPhrases: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
        queryType: fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)),
        needsNarrative: fc.oneof(fc.string(), fc.integer(), fc.array(fc.anything())),
        needsComparison: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
        needsComputation: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
        needsTrend: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
        needsPeerComparison: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
        needsClarification: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
        confidence: fc.oneof(fc.string(), fc.boolean(), fc.constant(null)),
      });

      fc.assert(
        fc.property(wrongTypesArb, (wrongObj) => {
          const responseStr = JSON.stringify(wrongObj);
          try {
            const result = engine.parseResponse(responseStr, 'test query');
            assertValidResult(result);
          } catch (e) {
            expect(e).toBeInstanceOf(Error);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * **Validates: Requirements 9.3**
   *
   * Property 12: Partial extraction results (from malformed responses)
   * must also satisfy all required field constraints — no missing fields.
   */
  describe('Property 12: Partial extraction always produces complete results', () => {
    it('responses with extractable tickers and queryType produce valid results', () => {
      fc.assert(
        fc.property(
          fc.array(tickerArb, { minLength: 0, maxLength: 3 }),
          queryTypeArb,
          confidenceArb,
          fc.string({ minLength: 0, maxLength: 100 }),
          (tickers, queryType, confidence, noise) => {
            // Build a malformed response that has extractable fields via regex
            const tickerStr = tickers.map((t) => `"${t}"`).join(', ');
            const response = `${noise} "tickers": [${tickerStr}], "queryType": "${queryType}", "confidence": ${confidence} ${noise}`;

            try {
              const result = engine.parseResponse(response, 'test query');
              assertValidResult(result);
              // Partial extraction caps confidence at 0.6
              expect(result.confidence).toBeLessThanOrEqual(0.6);
            } catch (e) {
              expect(e).toBeInstanceOf(Error);
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
