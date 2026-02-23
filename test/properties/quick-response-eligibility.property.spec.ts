/**
 * Property-Based Tests: Quick Response Eligibility
 * Feature: research-response-formatting-fix, Property 1 & 2
 *
 * Property 1: Quick response eligibility rejects multi-ticker and comparison intents
 * Property 2: Quick response eligibility invariant (true implies all conditions hold)
 *
 * Validates: Requirements 1.2, 4.1, 4.2, 4.3
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ResponseEnrichmentService } from '../../src/rag/response-enrichment.service';
import { FinancialCalculatorService } from '../../src/deals/financial-calculator.service';
import { VisualizationGeneratorService } from '../../src/rag/visualization-generator.service';
import { QueryIntent, QueryType, PeriodType } from '../../src/rag/types/query-intent';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const TICKERS = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'ABNB'];

const queryTypeArb: fc.Arbitrary<QueryType> = fc.constantFrom('structured', 'semantic', 'hybrid');

const periodTypeArb: fc.Arbitrary<PeriodType> = fc.constantFrom('annual', 'quarterly', 'latest', 'range');

/** Generate a single ticker string */
const singleTickerArb: fc.Arbitrary<string> = fc.constantFrom(...TICKERS);

/** Generate a multi-ticker array (2+ elements) */
const multiTickerArb: fc.Arbitrary<string[]> = fc.array(singleTickerArb, { minLength: 2, maxLength: 5 });

/** Generate any valid ticker value (string or string[]) */
const anyTickerArb: fc.Arbitrary<string | string[]> = fc.oneof(
  singleTickerArb,
  multiTickerArb,
  fc.constant(undefined) as fc.Arbitrary<any>,
);

/** Generate a full QueryIntent with arbitrary values */
const queryIntentArb: fc.Arbitrary<QueryIntent> = fc.record({
  type: queryTypeArb,
  ticker: anyTickerArb,
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  needsNarrative: fc.boolean(),
  needsComparison: fc.boolean(),
  needsComputation: fc.boolean(),
  needsTrend: fc.boolean(),
  periodType: fc.option(periodTypeArb, { nil: undefined }),
  originalQuery: fc.string({ minLength: 1, maxLength: 100 }),
}) as unknown as fc.Arbitrary<QueryIntent>;

/**
 * Generate a QueryIntent that has multi-ticker (array with 2+ elements)
 * OR needsComparison = true (or both).
 */
const multiTickerOrComparisonIntentArb: fc.Arbitrary<QueryIntent> = fc.oneof(
  // Case 1: multi-ticker array (needsComparison can be anything)
  fc.record({
    type: queryTypeArb,
    ticker: multiTickerArb,
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    needsNarrative: fc.boolean(),
    needsComparison: fc.boolean(),
    needsComputation: fc.boolean(),
    needsTrend: fc.boolean(),
    periodType: fc.option(periodTypeArb, { nil: undefined }),
    originalQuery: fc.string({ minLength: 1, maxLength: 100 }),
  }) as unknown as fc.Arbitrary<QueryIntent>,
  // Case 2: needsComparison = true (ticker can be anything)
  fc.record({
    type: queryTypeArb,
    ticker: anyTickerArb,
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    needsNarrative: fc.boolean(),
    needsComparison: fc.constant(true),
    needsComputation: fc.boolean(),
    needsTrend: fc.boolean(),
    periodType: fc.option(periodTypeArb, { nil: undefined }),
    originalQuery: fc.string({ minLength: 1, maxLength: 100 }),
  }) as unknown as fc.Arbitrary<QueryIntent>,
) as fc.Arbitrary<QueryIntent>;

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Feature: research-response-formatting-fix, Property 1: Quick response eligibility rejects multi-ticker and comparison intents', () => {
  let service: ResponseEnrichmentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResponseEnrichmentService,
        {
          provide: FinancialCalculatorService,
          useValue: {
            getMetricsSummary: jest.fn(),
            formatMetricValue: jest.fn(),
          },
        },
        {
          provide: VisualizationGeneratorService,
          useValue: {
            generateVisualization: jest.fn().mockReturnValue(null),
          },
        },
      ],
    }).compile();

    service = module.get(ResponseEnrichmentService);
  });

  /**
   * **Validates: Requirements 1.2, 4.1, 4.2**
   *
   * For any QueryIntent where ticker is an array with 2+ elements
   * OR needsComparison is true, isQuickResponseEligible() SHALL return false.
   */
  it('should return false for any intent with multi-ticker array or needsComparison=true', () => {
    fc.assert(
      fc.property(
        multiTickerOrComparisonIntentArb,
        (intent) => {
          const result = service.isQuickResponseEligible(intent);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Feature: research-response-formatting-fix, Property 2: Quick response eligibility invariant (true implies all conditions hold)', () => {
  let service: ResponseEnrichmentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResponseEnrichmentService,
        {
          provide: FinancialCalculatorService,
          useValue: {
            getMetricsSummary: jest.fn(),
            formatMetricValue: jest.fn(),
          },
        },
        {
          provide: VisualizationGeneratorService,
          useValue: {
            generateVisualization: jest.fn().mockReturnValue(null),
          },
        },
      ],
    }).compile();

    service = module.get(ResponseEnrichmentService);
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * For any QueryIntent where isQuickResponseEligible() returns true,
   * ALL of the following conditions SHALL hold:
   * - type === 'structured'
   * - confidence > 0.85
   * - needsNarrative === false
   * - needsTrend === false
   * - needsComparison === false
   * - needsComputation === false
   * - periodType !== 'range'
   * - ticker is a single string (not an array)
   */
  it('should guarantee all eligibility conditions hold when result is true', () => {
    fc.assert(
      fc.property(
        queryIntentArb,
        (intent) => {
          const result = service.isQuickResponseEligible(intent);

          if (result === true) {
            expect(intent.type).toBe('structured');
            expect(intent.confidence).toBeGreaterThan(0.85);
            expect(intent.needsNarrative).toBe(false);
            expect(intent.needsTrend).toBe(false);
            expect(intent.needsComparison).toBe(false);
            expect(intent.needsComputation).toBe(false);
            expect(intent.periodType).not.toBe('range');
            // ticker must be a single string, not an array
            expect(Array.isArray(intent.ticker)).toBe(false);
            expect(typeof intent.ticker).toBe('string');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
