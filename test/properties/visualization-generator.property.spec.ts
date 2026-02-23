/**
 * Property-Based Tests: VisualizationGeneratorService
 * Feature: multimodal-research-responses
 *
 * Tests the core visualization generation logic across randomly generated
 * QueryIntent + MetricResult[] inputs using fast-check.
 */

import * as fc from 'fast-check';
import { VisualizationGeneratorService } from '../../src/rag/visualization-generator.service';
import { QueryIntent, MetricResult } from '../../src/rag/types/query-intent';
import { VisualizationPayload } from '../../src/rag/types/visualization';
import { MetricsSummary } from '../../src/deals/financial-calculator.service';

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
  metricOverride?: fc.Arbitrary<string>,
  periodOverride?: fc.Arbitrary<string>,
) =>
  fc.record({
    ticker: tickerOverride ?? fc.constantFrom(...TICKERS),
    normalizedMetric: metricOverride ?? fc.constantFrom(...METRIC_NAMES),
    rawLabel: fc.constant('Raw Label'),
    value: fc.double({ min: 1_000, max: 1_000_000_000, noNaN: true }),
    fiscalPeriod: periodOverride ?? fc.constantFrom(...FISCAL_PERIODS),
    periodType: fc.constant('annual'),
    filingType: fc.constant('10-K'),
    statementType: fc.constant('income_statement'),
    statementDate: fc.date(),
    filingDate: fc.date(),
    confidenceScore: fc.double({ min: 0.5, max: 1, noNaN: true }),
  }) as fc.Arbitrary<MetricResult>;

/** Generate a base QueryIntent (fields we don't care about get defaults) */
const baseIntent = (overrides: Partial<QueryIntent> = {}): fc.Arbitrary<QueryIntent> =>
  fc.record({
    type: fc.constant(overrides.type ?? 'structured'),
    ticker: fc.constant(overrides.ticker ?? 'AAPL'),
    metrics: fc.constant(overrides.metrics ?? ['revenue']),
    needsNarrative: fc.constant(overrides.needsNarrative ?? false),
    needsComparison: fc.constant(overrides.needsComparison ?? false),
    needsComputation: fc.constant(overrides.needsComputation ?? false),
    needsTrend: fc.constant(overrides.needsTrend ?? false),
    confidence: fc.constant(overrides.confidence ?? 0.9),
    originalQuery: fc.constant(overrides.originalQuery ?? 'test query'),
  }) as unknown as fc.Arbitrary<QueryIntent>;


// ---------------------------------------------------------------------------
// Service instance (no DI needed — pure logic, no external deps)
// ---------------------------------------------------------------------------

const service = new VisualizationGeneratorService();

// ---------------------------------------------------------------------------
// Property 1: Trend visualization generation
// **Validates: Requirements 1.1**
//
// For any QueryIntent with needsTrend=true and MetricResult[] containing ≥2
// data points for the same metric across different fiscal periods, the service
// shall produce a VisualizationPayload with chartType 'line', labels matching
// the fiscal periods in chronological order, and at least one dataset whose
// values correspond to the metric values.
// ---------------------------------------------------------------------------

describe('Property 1: Trend visualization generation', () => {
  it('should produce a line chart with chronologically ordered labels for trend queries with ≥2 data points', () => {
    fc.assert(
      fc.property(
        // Generate 2-6 distinct fiscal periods for a single ticker + metric
        fc.uniqueArray(fc.constantFrom(...FISCAL_PERIODS), { minLength: 2, maxLength: 6 }).chain(
          (periods) => {
            const ticker = fc.constantFrom(...TICKERS);
            const metric = fc.constantFrom(...METRIC_NAMES);
            return fc.tuple(
              ticker,
              metric,
              fc.constant(periods),
              fc.array(
                fc.double({ min: 1_000, max: 1_000_000_000, noNaN: true }),
                { minLength: periods.length, maxLength: periods.length },
              ),
            );
          },
        ),
        ([ticker, metricName, periods, values]) => {
          const metrics: MetricResult[] = periods.map((period, i) => ({
            ticker,
            normalizedMetric: metricName,
            rawLabel: 'Raw',
            value: values[i],
            fiscalPeriod: period,
            periodType: 'annual',
            filingType: '10-K',
            statementType: 'income_statement',
            statementDate: new Date(),
            filingDate: new Date(),
            confidenceScore: 0.95,
          }));

          const intent: QueryIntent = {
            type: 'structured',
            ticker,
            metrics: [metricName],
            needsNarrative: false,
            needsComparison: false,
            needsComputation: false,
            needsTrend: true,
            confidence: 0.9,
            originalQuery: `Show ${metricName} trend for ${ticker}`,
          };

          const result = service.generateVisualization(intent, metrics);

          // Must produce a payload
          expect(result).not.toBeNull();
          const payload = result as VisualizationPayload;

          // Chart type must be 'line'
          expect(payload.chartType).toBe('line');

          // Labels must be in chronological (ascending) order
          const sortedPeriods = [...periods].sort((a, b) => a.localeCompare(b));
          expect(payload.labels).toEqual(sortedPeriods);

          // At least one dataset
          expect(payload.datasets.length).toBeGreaterThanOrEqual(1);

          // Primary dataset values must match the metric values (sorted by period)
          const expectedValues = sortedPeriods.map((p) => {
            const idx = periods.indexOf(p);
            return values[idx];
          });
          expect(payload.datasets[0].data).toEqual(expectedValues);
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);
});


// ---------------------------------------------------------------------------
// Property 2: Comparison visualization generation
// **Validates: Requirements 1.2**
//
// For any QueryIntent with needsComparison=true and MetricResult[] spanning
// ≥2 distinct tickers, the service shall produce a VisualizationPayload with
// chartType 'groupedBar' and datasets covering each ticker present in the
// input metrics.
// ---------------------------------------------------------------------------

describe('Property 2: Comparison visualization generation', () => {
  it('should produce a groupedBar chart with one dataset per ticker for comparison queries', () => {
    fc.assert(
      fc.property(
        // Pick 2-4 distinct tickers
        fc.uniqueArray(fc.constantFrom(...TICKERS), { minLength: 2, maxLength: 4 }).chain(
          (tickers) => {
            const metric = fc.constantFrom(...METRIC_NAMES);
            const period = fc.constantFrom(...FISCAL_PERIODS);
            return fc.tuple(
              fc.constant(tickers),
              metric,
              period,
              fc.array(
                fc.double({ min: 1_000, max: 1_000_000_000, noNaN: true }),
                { minLength: tickers.length, maxLength: tickers.length },
              ),
            );
          },
        ),
        ([tickers, metricName, period, values]) => {
          const metrics: MetricResult[] = tickers.map((ticker, i) => ({
            ticker,
            normalizedMetric: metricName,
            rawLabel: 'Raw',
            value: values[i],
            fiscalPeriod: period,
            periodType: 'annual',
            filingType: '10-K',
            statementType: 'income_statement',
            statementDate: new Date(),
            filingDate: new Date(),
            confidenceScore: 0.95,
          }));

          const intent: QueryIntent = {
            type: 'structured',
            ticker: tickers,
            metrics: [metricName],
            needsNarrative: false,
            needsComparison: true,
            needsComputation: false,
            needsTrend: false,
            confidence: 0.9,
            originalQuery: `Compare ${metricName} for ${tickers.join(' vs ')}`,
          };

          const result = service.generateVisualization(intent, metrics);

          // Must produce a payload
          expect(result).not.toBeNull();
          const payload = result as VisualizationPayload;

          // Chart type must be 'groupedBar'
          expect(payload.chartType).toBe('groupedBar');

          // Must have one dataset per ticker
          expect(payload.datasets.length).toBe(tickers.length);

          // Each dataset label should be one of the input tickers (uppercased)
          const datasetLabels = payload.datasets.map((d) => d.label);
          for (const ticker of tickers) {
            expect(datasetLabels).toContain(ticker.toUpperCase());
          }
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);
});


// ---------------------------------------------------------------------------
// Property 3: Visualization-metric value consistency
// **Validates: Requirements 1.5**
//
// For any VisualizationPayload produced by the service, every numeric value
// in every dataset shall be present in the input MetricResult[] array's value
// field or in the MetricsSummary computed values (YoY growth). No fabricated
// values shall appear in the payload.
// ---------------------------------------------------------------------------

describe('Property 3: Visualization-metric value consistency', () => {
  it('should only contain values from the input metrics or computed YoY growth — no fabricated values', () => {
    fc.assert(
      fc.property(
        // Generate a trend scenario (single ticker, multiple periods)
        fc.uniqueArray(fc.constantFrom(...FISCAL_PERIODS), { minLength: 2, maxLength: 6 }).chain(
          (periods) => {
            const ticker = fc.constantFrom(...TICKERS);
            const metric = fc.constantFrom('revenue', 'net_income');
            return fc.tuple(
              ticker,
              metric,
              fc.constant(periods),
              fc.array(
                fc.double({ min: 1_000, max: 1_000_000_000, noNaN: true }),
                { minLength: periods.length, maxLength: periods.length },
              ),
            );
          },
        ),
        ([ticker, metricName, periods, values]) => {
          const metrics: MetricResult[] = periods.map((period, i) => ({
            ticker,
            normalizedMetric: metricName,
            rawLabel: 'Raw',
            value: values[i],
            fiscalPeriod: period,
            periodType: 'annual',
            filingType: '10-K',
            statementType: 'income_statement',
            statementDate: new Date(),
            filingDate: new Date(),
            confidenceScore: 0.95,
          }));

          const intent: QueryIntent = {
            type: 'structured',
            ticker,
            metrics: [metricName],
            needsNarrative: false,
            needsComparison: false,
            needsComputation: false,
            needsTrend: true,
            confidence: 0.9,
            originalQuery: `Show ${metricName} trend for ${ticker}`,
          };

          const result = service.generateVisualization(intent, metrics);
          if (!result) return; // null is acceptable (insufficient data)

          // Collect all allowed values: metric values + 0 (default for missing YoY)
          const allowedValues = new Set(values);
          allowedValues.add(0); // default fill for missing YoY growth periods

          // Every value in every dataset must come from the input
          for (const dataset of result.datasets) {
            for (const val of dataset.data) {
              expect(allowedValues.has(val)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);

  it('should only contain values from metrics or MetricsSummary YoY growth when summary is provided', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...FISCAL_PERIODS), { minLength: 2, maxLength: 5 }).chain(
          (periods) =>
            fc.tuple(
              fc.constant(periods),
              fc.array(
                fc.double({ min: 1_000, max: 1_000_000_000, noNaN: true }),
                { minLength: periods.length, maxLength: periods.length },
              ),
              fc.array(
                fc.double({ min: -50, max: 100, noNaN: true }),
                { minLength: periods.length, maxLength: periods.length },
              ),
            ),
        ),
        ([periods, values, growthValues]) => {
          const ticker = 'AAPL';
          const metricName = 'revenue';

          const metrics: MetricResult[] = periods.map((period, i) => ({
            ticker,
            normalizedMetric: metricName,
            rawLabel: 'Raw',
            value: values[i],
            fiscalPeriod: period,
            periodType: 'annual',
            filingType: '10-K',
            statementType: 'income_statement',
            statementDate: new Date(),
            filingDate: new Date(),
            confidenceScore: 0.95,
          }));

          const yoyGrowth = periods.map((period, i) => ({
            period,
            value: growthValues[i],
          }));

          const summary: MetricsSummary = {
            ticker: 'AAPL',
            isPublic: true,
            calculationDate: new Date(),
            metrics: {
              revenue: { yoyGrowth },
            },
          };

          const intent: QueryIntent = {
            type: 'structured',
            ticker,
            metrics: [metricName],
            needsNarrative: false,
            needsComparison: false,
            needsComputation: false,
            needsTrend: true,
            confidence: 0.9,
            originalQuery: `Show revenue trend for AAPL`,
          };

          const result = service.generateVisualization(intent, metrics, summary);
          if (!result) return;

          // Collect all allowed values
          const allowedValues = new Set([...values, ...growthValues, 0]);

          for (const dataset of result.datasets) {
            for (const val of dataset.data) {
              expect(allowedValues.has(val)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);
});


// ---------------------------------------------------------------------------
// Property 4: YoY growth secondary dataset inclusion
// **Validates: Requirements 2.3**
//
// For any trend query where the MetricsSummary includes a non-empty yoyGrowth
// array for the requested metric, the VisualizationPayload shall contain a
// secondary dataset with yAxisID set to a secondary axis identifier and values
// matching the YoY growth percentages.
// ---------------------------------------------------------------------------

describe('Property 4: YoY growth secondary dataset inclusion', () => {
  it('should include a secondary YoY growth dataset with yAxisID when MetricsSummary has yoyGrowth', () => {
    fc.assert(
      fc.property(
        // Generate 2-5 distinct periods with matching YoY growth data
        fc.uniqueArray(fc.constantFrom(...FISCAL_PERIODS), { minLength: 2, maxLength: 5 }).chain(
          (periods) =>
            fc.tuple(
              fc.constant(periods),
              fc.array(
                fc.double({ min: 1_000, max: 1_000_000_000, noNaN: true }),
                { minLength: periods.length, maxLength: periods.length },
              ),
              // YoY growth values — at least one non-zero to trigger inclusion
              fc.tuple(
                fc.double({ min: 1, max: 100, noNaN: true }),
                fc.array(
                  fc.double({ min: -50, max: 100, noNaN: true }),
                  { minLength: Math.max(0, periods.length - 1), maxLength: Math.max(0, periods.length - 1) },
                ),
              ).map(([first, rest]) => [first, ...rest]),
            ),
        ),
        ([periods, values, growthValues]) => {
          const ticker = 'AAPL';
          const metricName = 'revenue';

          const metrics: MetricResult[] = periods.map((period, i) => ({
            ticker,
            normalizedMetric: metricName,
            rawLabel: 'Raw',
            value: values[i],
            fiscalPeriod: period,
            periodType: 'annual',
            filingType: '10-K',
            statementType: 'income_statement',
            statementDate: new Date(),
            filingDate: new Date(),
            confidenceScore: 0.95,
          }));

          // Build yoyGrowth aligned with the periods
          const yoyGrowth = periods.map((period, i) => ({
            period,
            value: growthValues[i],
          }));

          const summary: MetricsSummary = {
            ticker: 'AAPL',
            isPublic: true,
            calculationDate: new Date(),
            metrics: {
              revenue: { yoyGrowth },
            },
          };

          const intent: QueryIntent = {
            type: 'structured',
            ticker,
            metrics: [metricName],
            needsNarrative: false,
            needsComparison: false,
            needsComputation: false,
            needsTrend: true,
            confidence: 0.9,
            originalQuery: `Show revenue trend for AAPL`,
          };

          const result = service.generateVisualization(intent, metrics, summary);
          expect(result).not.toBeNull();
          const payload = result as VisualizationPayload;

          // Must have at least 2 datasets (primary metric + YoY growth)
          expect(payload.datasets.length).toBeGreaterThanOrEqual(2);

          // Find the YoY growth dataset
          const yoyDataset = payload.datasets.find((d) => d.yAxisID !== undefined);
          expect(yoyDataset).toBeDefined();
          expect(yoyDataset!.yAxisID).toBe('yoy');
          expect(yoyDataset!.label).toContain('YoY');

          // The growth values in the dataset should match the input yoyGrowth
          // (aligned to the sorted period labels)
          const sortedPeriods = [...periods].sort((a, b) => a.localeCompare(b));
          const expectedGrowth = sortedPeriods.map((p) => {
            const match = yoyGrowth.find((g) => g.period === p);
            return match ? match.value : 0;
          });
          expect(yoyDataset!.data).toEqual(expectedGrowth);

          // dualAxis option should be enabled
          expect(payload.options?.dualAxis).toBe(true);
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);

  it('should NOT include a YoY growth dataset when MetricsSummary has no yoyGrowth', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...FISCAL_PERIODS), { minLength: 2, maxLength: 5 }).chain(
          (periods) =>
            fc.tuple(
              fc.constant(periods),
              fc.array(
                fc.double({ min: 1_000, max: 1_000_000_000, noNaN: true }),
                { minLength: periods.length, maxLength: periods.length },
              ),
            ),
        ),
        ([periods, values]) => {
          const ticker = 'AAPL';
          const metricName = 'revenue';

          const metrics: MetricResult[] = periods.map((period, i) => ({
            ticker,
            normalizedMetric: metricName,
            rawLabel: 'Raw',
            value: values[i],
            fiscalPeriod: period,
            periodType: 'annual',
            filingType: '10-K',
            statementType: 'income_statement',
            statementDate: new Date(),
            filingDate: new Date(),
            confidenceScore: 0.95,
          }));

          // Summary with empty yoyGrowth
          const summary: MetricsSummary = {
            ticker: 'AAPL',
            isPublic: true,
            calculationDate: new Date(),
            metrics: {
              revenue: { yoyGrowth: [] },
            },
          };

          const intent: QueryIntent = {
            type: 'structured',
            ticker,
            metrics: [metricName],
            needsNarrative: false,
            needsComparison: false,
            needsComputation: false,
            needsTrend: true,
            confidence: 0.9,
            originalQuery: `Show revenue trend for AAPL`,
          };

          const result = service.generateVisualization(intent, metrics, summary);
          if (!result) return;

          // Should only have the primary dataset — no YoY secondary
          expect(result.datasets.length).toBe(1);
          expect(result.datasets.every((d) => d.yAxisID === undefined)).toBe(true);
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);
});
