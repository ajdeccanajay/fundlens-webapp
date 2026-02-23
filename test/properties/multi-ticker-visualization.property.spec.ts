/**
 * Property-Based Tests for VisualizationGeneratorService.generateVisualization()
 *
 * Feature: research-response-formatting-fix, Property 3: Multi-ticker visualization generation
 *
 * Property 3: For any set of MetricResult[] containing metrics for 2+ distinct
 * tickers and a QueryIntent with needsComparison or needsTrend set,
 * VisualizationGeneratorService.generateVisualization() SHALL return a non-null
 * VisualizationPayload with one dataset per ticker.
 *
 * **Validates: Requirements 2.3**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { VisualizationGeneratorService } from '../../src/rag/visualization-generator.service';
import { QueryIntent, MetricResult } from '../../src/rag/types/query-intent';

describe('Property Tests - Multi-ticker visualization generation', () => {
  let service: VisualizationGeneratorService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VisualizationGeneratorService],
    }).compile();

    service = module.get<VisualizationGeneratorService>(VisualizationGeneratorService);
  });

  // ── Generators ─────────────────────────────────────────────────────

  const TICKER_POOL = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'ABNB', 'NVDA', 'TSLA', 'NFLX', 'BKNG'];

  const tickerArb = fc.constantFrom(...TICKER_POOL);

  const metricNameArb = fc.constantFrom(
    'revenue', 'net_income', 'gross_profit', 'operating_income',
    'ebitda', 'free_cash_flow', 'total_assets', 'total_debt',
  );

  const yearArb = fc.integer({ min: 2018, max: 2026 });
  const quarterArb = fc.integer({ min: 1, max: 4 });

  const fiscalPeriodArb = fc.oneof(
    yearArb.map((y) => `FY${y}`),
    fc.tuple(quarterArb, yearArb).map(([q, y]) => `Q${q}FY${y}`),
  );

  const filingTypeArb = fc.constantFrom('10-K', '10-Q');

  /** Generate a single MetricResult with realistic fields */
  const metricResultForTickerArb = (ticker: string) =>
    fc.tuple(
      metricNameArb,
      fiscalPeriodArb,
      filingTypeArb,
      fc.double({ min: 1e6, max: 1e12, noNaN: true }),
    ).map(([metric, period, filingType, value]) => ({
      ticker,
      normalizedMetric: metric,
      rawLabel: metric,
      value,
      fiscalPeriod: period,
      periodType: period.startsWith('Q') ? 'quarterly' : 'annual',
      filingType,
      statementType: 'income_statement',
      statementDate: new Date('2025-01-01'),
      filingDate: new Date('2025-02-01'),
      confidenceScore: 0.95,
      displayName: metric.replace(/_/g, ' '),
    } as MetricResult));

  /**
   * Generate a MetricResult[] with at least 2 distinct tickers.
   * We pick 2-5 unique tickers, then generate 1-4 metrics per ticker,
   * guaranteeing the total array has metrics for 2+ distinct tickers.
   */
  const multiTickerMetricsArb = fc
    .uniqueArray(tickerArb, { minLength: 2, maxLength: 5 })
    .chain((tickers) =>
      fc.tuple(
        ...tickers.map((t) => fc.array(metricResultForTickerArb(t), { minLength: 1, maxLength: 4 })),
      ).map((arrays) => (arrays as MetricResult[][]).flat()),
    );

  /**
   * Generate a QueryIntent with needsComparison or needsTrend (or both) set to true.
   * The service checks these flags to decide which chart builder to use.
   */
  const comparisonOrTrendIntentArb = fc
    .record({
      needsComparison: fc.boolean(),
      needsTrend: fc.boolean(),
    })
    .filter((flags) => flags.needsComparison || flags.needsTrend)
    .map((flags) => ({
      type: 'structured' as const,
      originalQuery: 'compare tickers',
      needsNarrative: false,
      needsComparison: flags.needsComparison,
      needsComputation: false,
      needsTrend: flags.needsTrend,
      confidence: 0.9,
    } as QueryIntent));

  // ── Property 3 Tests ──────────────────────────────────────────────

  describe('Property 3: Multi-ticker visualization generation', () => {
    /**
     * **Validates: Requirements 2.3**
     */

    it('returns a non-null VisualizationPayload for 2+ ticker metrics with comparison/trend intent', () => {
      fc.assert(
        fc.property(comparisonOrTrendIntentArb, multiTickerMetricsArb, (intent, metrics) => {
          const result = service.generateVisualization(intent, metrics);
          expect(result).not.toBeNull();
          expect(result).toBeDefined();
        }),
        { numRuns: 100 },
      );
    });

    it('produces exactly one dataset per distinct ticker', () => {
      fc.assert(
        fc.property(comparisonOrTrendIntentArb, multiTickerMetricsArb, (intent, metrics) => {
          const result = service.generateVisualization(intent, metrics);
          expect(result).not.toBeNull();

          const distinctTickers = [...new Set(metrics.map((m) => m.ticker))];
          expect(result!.datasets).toBeDefined();
          expect(result!.datasets!.length).toBe(distinctTickers.length);
        }),
        { numRuns: 100 },
      );
    });

    it('each dataset label corresponds to a ticker from the input', () => {
      fc.assert(
        fc.property(comparisonOrTrendIntentArb, multiTickerMetricsArb, (intent, metrics) => {
          const result = service.generateVisualization(intent, metrics);
          expect(result).not.toBeNull();

          const distinctTickers = new Set(metrics.map((m) => m.ticker.toUpperCase()));
          for (const dataset of result!.datasets!) {
            expect(distinctTickers.has(dataset.label.toUpperCase())).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('uses line chart for needsTrend and groupedBar for needsComparison-only', () => {
      fc.assert(
        fc.property(comparisonOrTrendIntentArb, multiTickerMetricsArb, (intent, metrics) => {
          const result = service.generateVisualization(intent, metrics);
          expect(result).not.toBeNull();

          if (intent.needsTrend) {
            // needsTrend takes priority — multi-ticker trend produces a line chart
            expect(result!.chartType).toBe('line');
          } else if (intent.needsComparison) {
            expect(result!.chartType).toBe('groupedBar');
          }
        }),
        { numRuns: 100 },
      );
    });

    it('labels array contains all unique fiscal periods from input metrics', () => {
      fc.assert(
        fc.property(comparisonOrTrendIntentArb, multiTickerMetricsArb, (intent, metrics) => {
          const result = service.generateVisualization(intent, metrics);
          expect(result).not.toBeNull();

          const expectedPeriods = new Set(metrics.map((m) => m.fiscalPeriod));
          const actualLabels = new Set(result!.labels);

          for (const period of expectedPeriods) {
            expect(actualLabels.has(period)).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
