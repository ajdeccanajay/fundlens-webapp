/**
 * Property-Based Tests for buildVisualizationPayload()
 *
 * Feature: rag-chatbot-master-engineering, Property 8: VisualizationPayload population
 *
 * Property 8: VisualizationPayload population — For any non-empty set of
 * MetricResults and an intent with a non-null suggestedChart and non-semantic
 * type, buildVisualizationPayload() should return a VisualizationPayload where
 * every metric's ticker+period combination appears as a row, every distinct
 * metric appears as a column, and periods are sorted ascending.
 *
 * **Validates: Requirements 7.4**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ResponseEnrichmentService } from '../../src/rag/response-enrichment.service';
import { FinancialCalculatorService } from '../../src/deals/financial-calculator.service';
import { VisualizationGeneratorService } from '../../src/rag/visualization-generator.service';
import { QueryIntent, MetricResult } from '../../src/rag/types/query-intent';

describe('Property Tests - VisualizationPayload population', () => {
  let service: ResponseEnrichmentService;

  beforeAll(async () => {
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
            generateVisualization: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ResponseEnrichmentService>(ResponseEnrichmentService);
  });

  // ── Generators ─────────────────────────────────────────────────────

  const tickerArb = fc.constantFrom('AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'ABNB', 'BKNG', 'NVDA', 'COIN', 'TSLA');

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

  const chartTypeArb = fc.constantFrom('line', 'bar', 'grouped_bar', 'stacked_bar', 'table');

  const nonSemanticTypeArb = fc.constantFrom('structured', 'hybrid') as fc.Arbitrary<'structured' | 'hybrid'>;

  /** Generate a single MetricResult with realistic fields */
  const metricResultArb = fc.tuple(
    tickerArb,
    metricNameArb,
    fiscalPeriodArb,
    filingTypeArb,
    fc.double({ min: -1e12, max: 1e12, noNaN: true }),
  ).map(([ticker, metric, period, filingType, value]) => ({
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

  /** Generate a non-empty array of MetricResults */
  const metricsArrayArb = fc.array(metricResultArb, { minLength: 1, maxLength: 20 });

  /** Generate a QueryIntent with non-semantic type and a suggestedChart */
  const intentArb = fc.tuple(nonSemanticTypeArb, chartTypeArb).map(([type, chart]) => ({
    type,
    originalQuery: 'test query',
    needsNarrative: false,
    needsComparison: false,
    needsComputation: false,
    needsTrend: false,
    confidence: 0.9,
    suggestedChart: chart,
  } as QueryIntent));

  // ── Helper: fiscal period sort key (mirrors the service's private method) ──
  function fiscalPeriodSortKey(period: string): number {
    if (!period) return 0;
    if (/TTM/i.test(period)) return 99990000;
    const qtr = period.match(/Q([1-4])[\s\-]?(?:FY)?(\d{4})/i);
    if (qtr) return parseInt(qtr[2], 10) * 10000 + parseInt(qtr[1], 10) * 100;
    const fy = period.match(/(?:FY)(\d{4})/i);
    if (fy) return parseInt(fy[1], 10) * 10000;
    const bare = period.match(/^(\d{4})$/);
    if (bare) return parseInt(bare[1], 10) * 10000;
    return 0;
  }

  // ── Property 8 Tests ──────────────────────────────────────────────

  describe('Property 8: VisualizationPayload population', () => {
    /**
     * **Validates: Requirements 7.4**
     */

    it('returns a defined VisualizationPayload for non-empty metrics with non-semantic intent', () => {
      fc.assert(
        fc.property(intentArb, metricsArrayArb, (intent, metrics) => {
          const result = service.buildVisualizationPayload(intent, metrics);
          expect(result).toBeDefined();
          expect(result!.data).toBeDefined();
          expect(result!.meta).toBeDefined();
        }),
        { numRuns: 10 },
      );
    });

    it('every unique ticker+period combination from input appears as a row', () => {
      fc.assert(
        fc.property(intentArb, metricsArrayArb, (intent, metrics) => {
          const result = service.buildVisualizationPayload(intent, metrics);
          expect(result).toBeDefined();

          // Collect all unique ticker|period keys from input
          const expectedKeys = new Set<string>();
          for (const m of metrics) {
            expectedKeys.add(`${m.ticker}|${m.fiscalPeriod}`);
          }

          // Collect all ticker|period keys from output rows
          const actualKeys = new Set<string>();
          for (const row of result!.data!.rows) {
            actualKeys.add(`${row.ticker}|${row.period}`);
          }

          // Every expected key must appear in the output
          for (const key of expectedKeys) {
            expect(actualKeys.has(key)).toBe(true);
          }
          // No extra rows beyond what the input produces
          expect(actualKeys.size).toBe(expectedKeys.size);
        }),
        { numRuns: 10 },
      );
    });

    it('every distinct normalizedMetric from input appears as a column', () => {
      fc.assert(
        fc.property(intentArb, metricsArrayArb, (intent, metrics) => {
          const result = service.buildVisualizationPayload(intent, metrics);
          expect(result).toBeDefined();

          const expectedMetrics = new Set(metrics.map((m) => m.normalizedMetric));
          const actualColumns = new Set(result!.data!.columns.map((c) => c.canonical_id));

          for (const metric of expectedMetrics) {
            expect(actualColumns.has(metric)).toBe(true);
          }
          expect(actualColumns.size).toBe(expectedMetrics.size);
        }),
        { numRuns: 10 },
      );
    });

    it('periods in rows are sorted ascending by fiscal period sort key', () => {
      fc.assert(
        fc.property(intentArb, metricsArrayArb, (intent, metrics) => {
          const result = service.buildVisualizationPayload(intent, metrics);
          expect(result).toBeDefined();

          const rows = result!.data!.rows;
          for (let i = 1; i < rows.length; i++) {
            const prevKey = fiscalPeriodSortKey(rows[i - 1].period);
            const currKey = fiscalPeriodSortKey(rows[i].period);
            expect(currKey).toBeGreaterThanOrEqual(prevKey);
          }
        }),
        { numRuns: 10 },
      );
    });

    it('meta.tickers contains all unique tickers from input', () => {
      fc.assert(
        fc.property(intentArb, metricsArrayArb, (intent, metrics) => {
          const result = service.buildVisualizationPayload(intent, metrics);
          expect(result).toBeDefined();

          const expectedTickers = new Set(metrics.map((m) => m.ticker));
          const actualTickers = new Set(result!.meta!.tickers);

          for (const ticker of expectedTickers) {
            expect(actualTickers.has(ticker)).toBe(true);
          }
        }),
        { numRuns: 10 },
      );
    });

    it('meta.periods contains all unique periods from input, sorted ascending', () => {
      fc.assert(
        fc.property(intentArb, metricsArrayArb, (intent, metrics) => {
          const result = service.buildVisualizationPayload(intent, metrics);
          expect(result).toBeDefined();

          // All unique periods from input must be present
          const expectedPeriods = new Set(metrics.map((m) => m.fiscalPeriod));
          const actualPeriods = result!.meta!.periods;

          for (const period of expectedPeriods) {
            expect(actualPeriods).toContain(period);
          }

          // Periods must be sorted ascending
          for (let i = 1; i < actualPeriods.length; i++) {
            const prevKey = fiscalPeriodSortKey(actualPeriods[i - 1]);
            const currKey = fiscalPeriodSortKey(actualPeriods[i]);
            expect(currKey).toBeGreaterThanOrEqual(prevKey);
          }
        }),
        { numRuns: 10 },
      );
    });

    it('suggestedChartType matches the intent suggestedChart', () => {
      fc.assert(
        fc.property(intentArb, metricsArrayArb, (intent, metrics) => {
          const result = service.buildVisualizationPayload(intent, metrics);
          expect(result).toBeDefined();
          expect(result!.suggestedChartType).toBe(intent.suggestedChart);
        }),
        { numRuns: 10 },
      );
    });
  });
});
