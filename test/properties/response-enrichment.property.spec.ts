/**
 * Property-Based Tests: ResponseEnrichmentService — Phase 1 Context Injection
 * Feature: multimodal-research-responses
 *
 * Tests that computeFinancials() returns a MetricsSummary with YoY growth data
 * whenever the FinancialCalculatorService succeeds, ensuring the LLM context
 * will include computed growth values for trend/computation queries.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ResponseEnrichmentService } from '../../src/rag/response-enrichment.service';
import {
  FinancialCalculatorService,
  MetricsSummary,
} from '../../src/deals/financial-calculator.service';
import { VisualizationGeneratorService } from '../../src/rag/visualization-generator.service';
import { QueryIntent, MetricResult } from '../../src/rag/types/query-intent';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const FISCAL_PERIODS = ['FY2019', 'FY2020', 'FY2021', 'FY2022', 'FY2023', 'FY2024'];
const TICKERS = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA'];
const METRIC_NAMES = [
  'revenue', 'net_income', 'gross_profit', 'operating_income',
  'ebitda', 'free_cash_flow', 'gross_margin', 'operating_margin',
];

/** Generate a valid MetricResult */
const metricResultArb = (
  tickerOverride?: fc.Arbitrary<string>,
): fc.Arbitrary<MetricResult> =>
  fc.record({
    ticker: tickerOverride ?? fc.constantFrom(...TICKERS),
    normalizedMetric: fc.constantFrom(...METRIC_NAMES),
    rawLabel: fc.constant('Raw Label'),
    value: fc.double({ min: 1_000, max: 1_000_000_000, noNaN: true }),
    fiscalPeriod: fc.constantFrom(...FISCAL_PERIODS),
    periodType: fc.constant('annual'),
    filingType: fc.constant('10-K'),
    statementType: fc.constant('income_statement'),
    statementDate: fc.date(),
    filingDate: fc.date(),
    confidenceScore: fc.double({ min: 0.5, max: 1, noNaN: true }),
  }) as fc.Arbitrary<MetricResult>;

/** Generate a QueryIntent with needsTrend or needsComputation set to true */
const trendOrComputationIntentArb = (ticker: string): fc.Arbitrary<QueryIntent> =>
  fc.record({
    type: fc.constantFrom('structured', 'hybrid') as fc.Arbitrary<QueryIntent['type']>,
    ticker: fc.constant(ticker),
    metrics: fc.constant(['revenue']),
    needsNarrative: fc.boolean(),
    needsComparison: fc.boolean(),
    // At least one of needsTrend or needsComputation must be true
    needsComputation: fc.boolean(),
    needsTrend: fc.boolean(),
    confidence: fc.double({ min: 0.5, max: 1, noNaN: true }),
    originalQuery: fc.constant(`Show trend for ${ticker}`),
  }).filter(
    (intent) => intent.needsTrend || intent.needsComputation,
  ) as unknown as fc.Arbitrary<QueryIntent>;

/** Generate a MetricsSummary with YoY growth data */
const metricsSummaryArb = (ticker: string): fc.Arbitrary<MetricsSummary> =>
  fc.record({
    ticker: fc.constant(ticker.toUpperCase()),
    isPublic: fc.constant(true),
    calculationDate: fc.date(),
    metrics: fc.record({
      revenue: fc.record({
        ttm: fc.option(fc.double({ min: 1_000, max: 1_000_000_000, noNaN: true }), { nil: undefined }),
        annual: fc.array(
          fc.record({
            period: fc.constantFrom(...FISCAL_PERIODS),
            value: fc.double({ min: 1_000, max: 1_000_000_000, noNaN: true }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        cagr: fc.option(fc.double({ min: -50, max: 100, noNaN: true }), { nil: undefined }),
        yoyGrowth: fc.array(
          fc.record({
            period: fc.constantFrom(...FISCAL_PERIODS),
            value: fc.double({ min: -80, max: 200, noNaN: true }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
      }),
    }),
  }) as unknown as fc.Arbitrary<MetricsSummary>;

// ---------------------------------------------------------------------------
// Property 14: Phase 1 computed summary injected into LLM context
// **Validates: Requirements 2.2**
//
// For any query where intent.needsTrend or intent.needsComputation is true
// and ResponseEnrichmentService.computeFinancials() returns a non-undefined
// MetricsSummary, the LLM context passed to BedrockService.generate() shall
// include the computed YoY growth values from that summary.
//
// Since we cannot test the full RAG pipeline integration in a property test,
// we verify the contract that computeFinancials() upholds:
// 1. When the calculator succeeds, it returns a MetricsSummary (not undefined)
// 2. The returned MetricsSummary contains the exact YoY growth data from the
//    calculator — this is the data that gets injected into LLM context
// 3. When the calculator fails, it returns undefined (graceful degradation)
// ---------------------------------------------------------------------------

describe('Property 14: Phase 1 computed summary injected into LLM context', () => {
  let service: ResponseEnrichmentService;
  let financialCalculator: jest.Mocked<FinancialCalculatorService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResponseEnrichmentService,
        {
          provide: FinancialCalculatorService,
          useValue: {
            getMetricsSummary: jest.fn(),
            formatMetricValue: jest.fn((v: number) => `$${v.toFixed(2)}`),
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
    financialCalculator = module.get(FinancialCalculatorService);
  });

  it('should return a MetricsSummary with YoY growth data when calculator succeeds for trend/computation queries', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Pick a ticker, then generate intent + summary for that ticker
        fc.constantFrom(...TICKERS).chain((ticker) =>
          fc.tuple(
            trendOrComputationIntentArb(ticker),
            fc.array(metricResultArb(fc.constant(ticker)), { minLength: 1, maxLength: 6 }),
            metricsSummaryArb(ticker),
          ),
        ),
        async ([intent, metrics, expectedSummary]) => {
          // Mock the calculator to return the generated summary
          financialCalculator.getMetricsSummary.mockResolvedValue(expectedSummary);

          const result = await service.computeFinancials(intent, metrics);

          // 1. Must return a defined MetricsSummary (not undefined)
          expect(result).toBeDefined();
          expect(result).not.toBeUndefined();

          // 2. The returned summary IS the exact object from the calculator
          //    — this is what gets injected into LLM context
          expect(result).toBe(expectedSummary);

          // 3. The summary contains YoY growth data that the LLM will reference
          expect(result!.metrics.revenue).toBeDefined();
          expect(result!.metrics.revenue!.yoyGrowth).toBeDefined();
          expect(result!.metrics.revenue!.yoyGrowth!.length).toBeGreaterThan(0);

          // 4. Each YoY growth entry has a period and numeric value
          for (const entry of result!.metrics.revenue!.yoyGrowth!) {
            expect(typeof entry.period).toBe('string');
            expect(typeof entry.value).toBe('number');
            expect(Number.isFinite(entry.value)).toBe(true);
          }

          // 5. The calculator was called with the correct ticker
          const expectedTicker = Array.isArray(intent.ticker)
            ? intent.ticker[0]
            : intent.ticker;
          expect(financialCalculator.getMetricsSummary).toHaveBeenCalledWith(expectedTicker);
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);

  it('should return undefined when calculator fails — graceful degradation for LLM context', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...TICKERS).chain((ticker) =>
          fc.tuple(
            trendOrComputationIntentArb(ticker),
            fc.array(metricResultArb(fc.constant(ticker)), { minLength: 1, maxLength: 4 }),
          ),
        ),
        async ([intent, metrics]) => {
          // Mock the calculator to throw an error
          financialCalculator.getMetricsSummary.mockRejectedValue(
            new Error('Calculator unavailable'),
          );

          const result = await service.computeFinancials(intent, metrics);

          // Must return undefined — pipeline continues without computed data
          expect(result).toBeUndefined();
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);

  it('should return undefined when intent has no ticker — no computation possible', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          type: fc.constantFrom('structured', 'hybrid') as fc.Arbitrary<QueryIntent['type']>,
          ticker: fc.constant(undefined),
          metrics: fc.constant(['revenue']),
          needsNarrative: fc.boolean(),
          needsComparison: fc.boolean(),
          needsComputation: fc.constant(true),
          needsTrend: fc.boolean(),
          confidence: fc.double({ min: 0.5, max: 1, noNaN: true }),
          originalQuery: fc.constant('Show revenue trend'),
        }) as unknown as fc.Arbitrary<QueryIntent>,
        fc.array(metricResultArb(), { minLength: 1, maxLength: 4 }),
        async (intent, metrics) => {
          const result = await service.computeFinancials(intent, metrics);

          // No ticker means no computation — must return undefined
          expect(result).toBeUndefined();

          // Calculator should NOT have been called
          expect(financialCalculator.getMetricsSummary).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);
});
