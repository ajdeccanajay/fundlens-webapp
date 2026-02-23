/**
 * Property-Based Tests for Peer Comparison
 *
 * Feature: rag-chatbot-master-engineering
 * Properties tested:
 * - Property 19: Peer comparison parallel fetch completeness
 * - Property 20: LTM normalization
 * - Property 21: Peer statistics correctness
 *
 * Tests PeerComparisonService methods including compare(), computeLTM(),
 * and buildComparisonResult() (indirectly via compare()).
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { PeerComparisonService } from '../../src/rag/peer-comparison.service';
import { StructuredRetrieverService } from '../../src/rag/structured-retriever.service';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

describe('Property Tests - Peer Comparison', () => {
  let service: PeerComparisonService;
  let retrieverMock: { retrieve: jest.Mock };

  beforeEach(async () => {
    retrieverMock = {
      retrieve: jest.fn().mockResolvedValue({ metrics: [], summary: {} }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeerComparisonService,
        { provide: StructuredRetrieverService, useValue: retrieverMock },
      ],
    }).compile();

    service = module.get(PeerComparisonService);
  });

  // ── Generators ──────────────────────────────────────────────────────────

  /** Generate a valid ticker string */
  const tickerArb = fc.constantFrom(
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'ABNB', 'BKNG',
    'EXPE', 'TRIP', 'COIN', 'TSLA', 'NFLX', 'CRM', 'UBER', 'LYFT',
  );

  /** Generate a unique set of tickers (1-6) */
  const tickerSetArb = fc
    .uniqueArray(tickerArb, { minLength: 1, maxLength: 6 })
    .filter((arr) => arr.length >= 1);

  /** Generate a canonical_id */
  const canonicalIdArb = fc.constantFrom(
    'revenue', 'gross_profit_margin', 'operating_income',
    'ebitda', 'net_income', 'free_cash_flow',
  );

  /** Generate a MetricResolution */
  const metricResolutionArb: fc.Arbitrary<MetricResolution> = canonicalIdArb.map(
    (id) => ({
      canonical_id: id,
      display_name: id.replace(/_/g, ' '),
      type: 'atomic' as const,
      confidence: 'exact' as const,
      fuzzy_score: null,
      original_query: id,
      match_source: 'exact',
      suggestions: null,
      db_column: id,
    }),
  );

  /** Generate a unique set of MetricResolutions (1-4) */
  const metricSetArb = fc
    .uniqueArray(canonicalIdArb, { minLength: 1, maxLength: 4 })
    .map((ids) =>
      ids.map((id) => ({
        canonical_id: id,
        display_name: id.replace(/_/g, ' '),
        type: 'atomic' as const,
        confidence: 'exact' as const,
        fuzzy_score: null,
        original_query: id,
        match_source: 'exact',
        suggestions: null,
        db_column: id,
      })),
    );

  /** Generate a finite numeric value suitable for financial metrics */
  const finiteValueArb = fc.double({
    min: -1e9,
    max: 1e9,
    noNaN: true,
    noDefaultInfinity: true,
  });

  /** Generate a quarterly value (positive, reasonable range) */
  const quarterlyValueArb = fc.double({
    min: 1,
    max: 1e8,
    noNaN: true,
    noDefaultInfinity: true,
  });

  /** Helper to build a MetricResult-like object */
  function makeMetricResult(overrides: Record<string, any> = {}) {
    return {
      ticker: 'ABNB',
      normalizedMetric: 'revenue',
      displayName: 'Revenue',
      rawLabel: 'Revenue',
      value: 1000,
      fiscalPeriod: 'FY2024',
      periodType: 'annual' as const,
      filingType: '10-K',
      statementType: 'income_statement',
      statementDate: new Date('2024-12-31'),
      filingDate: new Date('2025-02-15'),
      confidenceScore: 0.95,
      ...overrides,
    };
  }

  // ── Property 19: Peer comparison parallel fetch completeness ─────────

  describe('Feature: rag-chatbot-master-engineering, Property 19: Peer comparison parallel fetch completeness', () => {
    /**
     * **Validates: Requirements 16.1**
     *
     * For any set of N tickers and M metrics, PeerComparisonService.compare()
     * should produce results covering all N × M combinations (with null values
     * for missing data).
     */

    it('produces one PeerComparisonResult per metric, each with rows for all tickers', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerSetArb,
          metricSetArb,
          async (tickers, metrics) => {
            // Mock retriever to return data for every ticker×metric fetch
            retrieverMock.retrieve.mockImplementation(async (query: any) => {
              const ticker = query.tickers[0];
              const metricRes = query.metrics[0];
              return {
                metrics: [
                  makeMetricResult({
                    ticker,
                    normalizedMetric: metricRes.canonical_id,
                    value: Math.random() * 1000,
                    fiscalPeriod: 'FY2024',
                  }),
                ],
                summary: {},
              };
            });

            const results = await service.compare(tickers, metrics, 'FY2024', 'FY');

            // One result per metric
            expect(results).toHaveLength(metrics.length);

            // Each result has rows for all tickers
            for (const result of results) {
              const rowTickers = result.rows.map((r) => r.ticker);
              for (const ticker of tickers) {
                expect(rowTickers).toContain(ticker);
              }
            }

            retrieverMock.retrieve.mockClear();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('includes null values for tickers with missing data', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerSetArb.filter((t) => t.length >= 2),
          metricSetArb,
          async (tickers, metrics) => {
            // First ticker returns data, rest return empty
            retrieverMock.retrieve.mockImplementation(async (query: any) => {
              const ticker = query.tickers[0];
              if (ticker === tickers[0]) {
                return {
                  metrics: [
                    makeMetricResult({
                      ticker,
                      value: 500,
                      fiscalPeriod: 'FY2024',
                    }),
                  ],
                  summary: {},
                };
              }
              return { metrics: [], summary: {} };
            });

            const results = await service.compare(tickers, metrics, 'FY2024', 'FY');

            // All tickers still present in rows
            for (const result of results) {
              expect(result.rows).toHaveLength(tickers.length);
              // Tickers without data have null values
              for (const row of result.rows) {
                if (row.ticker !== tickers[0]) {
                  expect(row.value).toBeNull();
                }
              }
            }

            retrieverMock.retrieve.mockClear();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('calls retriever exactly N × M times', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerSetArb,
          metricSetArb,
          async (tickers, metrics) => {
            retrieverMock.retrieve.mockResolvedValue({ metrics: [], summary: {} });

            await service.compare(tickers, metrics, 'FY2024', 'FY');

            expect(retrieverMock.retrieve).toHaveBeenCalledTimes(
              tickers.length * metrics.length,
            );

            retrieverMock.retrieve.mockClear();
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // ── Property 20: LTM normalization ──────────────────────────────────

  describe('Feature: rag-chatbot-master-engineering, Property 20: LTM normalization', () => {
    /**
     * **Validates: Requirements 16.2**
     *
     * For any company with 4 consecutive quarterly values, LTM normalization
     * should produce a value equal to the sum of those 4 quarters.
     */

    it('LTM value equals sum of 4 quarterly values', () => {
      fc.assert(
        fc.property(
          tickerArb,
          canonicalIdArb,
          quarterlyValueArb,
          quarterlyValueArb,
          quarterlyValueArb,
          quarterlyValueArb,
          (ticker, metricId, q1, q2, q3, q4) => {
            const raw = {
              ticker,
              metricId,
              annual: null,
              quarterly: [
                makeMetricResult({ ticker, value: q1, fiscalPeriod: 'Q1FY2024', filingType: '10-Q' }),
                makeMetricResult({ ticker, value: q2, fiscalPeriod: 'Q2FY2024', filingType: '10-Q' }),
                makeMetricResult({ ticker, value: q3, fiscalPeriod: 'Q3FY2024', filingType: '10-Q' }),
                makeMetricResult({ ticker, value: q4, fiscalPeriod: 'Q4FY2024', filingType: '10-Q' }),
              ],
            };

            const result = service.computeLTM(raw);

            expect(result.ticker).toBe(ticker);
            expect(result.metricId).toBe(metricId);
            expect(result.period).toBe('LTM');
            expect(result.incomplete).toBeFalsy();

            // LTM = sum of 4 quarters
            const expectedSum = q1 + q2 + q3 + q4;
            expect(result.value).toBeCloseTo(expectedSum, 5);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('takes only the 4 most recent quarters when more are available', () => {
      fc.assert(
        fc.property(
          tickerArb,
          // 5 quarterly values — oldest should be excluded
          fc.tuple(
            quarterlyValueArb,
            quarterlyValueArb,
            quarterlyValueArb,
            quarterlyValueArb,
            quarterlyValueArb,
          ),
          (ticker, [old, q1, q2, q3, q4]) => {
            const raw = {
              ticker,
              metricId: 'revenue',
              annual: null,
              quarterly: [
                makeMetricResult({ ticker, value: old, fiscalPeriod: 'Q4FY2023', filingType: '10-Q' }),
                makeMetricResult({ ticker, value: q1, fiscalPeriod: 'Q1FY2024', filingType: '10-Q' }),
                makeMetricResult({ ticker, value: q2, fiscalPeriod: 'Q2FY2024', filingType: '10-Q' }),
                makeMetricResult({ ticker, value: q3, fiscalPeriod: 'Q3FY2024', filingType: '10-Q' }),
                makeMetricResult({ ticker, value: q4, fiscalPeriod: 'Q4FY2024', filingType: '10-Q' }),
              ],
            };

            const result = service.computeLTM(raw);

            // Should sum the 4 most recent (Q1-Q4 FY2024), excluding Q4FY2023
            const expectedSum = q1 + q2 + q3 + q4;
            expect(result.value).toBeCloseTo(expectedSum, 5);
            expect(result.incomplete).toBeFalsy();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('flags incomplete when fewer than 4 quarters', () => {
      fc.assert(
        fc.property(
          tickerArb,
          fc.integer({ min: 1, max: 3 }),
          quarterlyValueArb,
          (ticker, numQuarters, baseValue) => {
            const quarters = Array.from({ length: numQuarters }, (_, i) =>
              makeMetricResult({
                ticker,
                value: baseValue + i * 10,
                fiscalPeriod: `Q${i + 1}FY2024`,
                filingType: '10-Q',
              }),
            );

            const raw = {
              ticker,
              metricId: 'revenue',
              annual: null,
              quarterly: quarters,
            };

            const result = service.computeLTM(raw);

            expect(result.incomplete).toBe(true);
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // ── Property 21: Peer statistics correctness ────────────────────────

  describe('Feature: rag-chatbot-master-engineering, Property 21: Peer statistics correctness', () => {
    /**
     * **Validates: Requirements 16.3**
     *
     * For any set of peer comparison rows with numeric values, the computed
     * median should equal the statistical median, the mean should equal the
     * arithmetic mean, and ranks should be assigned in descending order of value.
     */

    /** Reference median implementation for verification */
    function referenceMedian(values: number[]): number {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
      }
      return sorted[mid];
    }

    /** Reference mean implementation for verification */
    function referenceMean(values: number[]): number {
      if (values.length === 0) return 0;
      return values.reduce((a, b) => a + b, 0) / values.length;
    }

    it('median matches statistical median, mean matches arithmetic mean', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate 2-6 unique tickers with distinct values
          fc.uniqueArray(tickerArb, { minLength: 2, maxLength: 6 }).chain(
            (tickers) =>
              fc
                .uniqueArray(finiteValueArb, {
                  minLength: tickers.length,
                  maxLength: tickers.length,
                })
                .map((values) => ({ tickers, values })),
          ),
          async ({ tickers, values }) => {
            // Mock retriever to return each ticker with its assigned value
            let callIndex = 0;
            retrieverMock.retrieve.mockImplementation(async (query: any) => {
              const ticker = query.tickers[0];
              const idx = tickers.indexOf(ticker);
              const value = idx >= 0 ? values[idx] : null;
              return {
                metrics: value !== null
                  ? [makeMetricResult({ ticker, value, fiscalPeriod: 'FY2024' })]
                  : [],
                summary: {},
              };
            });

            const metric: MetricResolution = {
              canonical_id: 'revenue',
              display_name: 'Revenue',
              type: 'atomic',
              confidence: 'exact',
              fuzzy_score: null,
              original_query: 'revenue',
              match_source: 'exact',
              suggestions: null,
            };

            const results = await service.compare(tickers, [metric], 'FY2024', 'FY');
            const result = results[0];

            // Verify median
            const expectedMedian = referenceMedian(values);
            expect(result.median).toBeCloseTo(expectedMedian, 5);

            // Verify mean
            const expectedMean = referenceMean(values);
            expect(result.mean).toBeCloseTo(expectedMean, 5);

            retrieverMock.retrieve.mockClear();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('ranks are assigned in descending order of value', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate 2-6 unique tickers with distinct values
          fc.uniqueArray(tickerArb, { minLength: 2, maxLength: 6 }).chain(
            (tickers) =>
              fc
                .uniqueArray(finiteValueArb, {
                  minLength: tickers.length,
                  maxLength: tickers.length,
                })
                .map((values) => ({ tickers, values })),
          ),
          async ({ tickers, values }) => {
            retrieverMock.retrieve.mockImplementation(async (query: any) => {
              const ticker = query.tickers[0];
              const idx = tickers.indexOf(ticker);
              return {
                metrics: [
                  makeMetricResult({
                    ticker,
                    value: values[idx],
                    fiscalPeriod: 'FY2024',
                  }),
                ],
                summary: {},
              };
            });

            const metric: MetricResolution = {
              canonical_id: 'revenue',
              display_name: 'Revenue',
              type: 'atomic',
              confidence: 'exact',
              fuzzy_score: null,
              original_query: 'revenue',
              match_source: 'exact',
              suggestions: null,
            };

            const results = await service.compare(tickers, [metric], 'FY2024', 'FY');
            const rows = results[0].rows;

            // All non-null rows: higher value should have lower (better) rank
            const nonNullRows = rows.filter((r) => r.value !== null);
            for (let i = 0; i < nonNullRows.length; i++) {
              for (let j = i + 1; j < nonNullRows.length; j++) {
                if (nonNullRows[i].value! > nonNullRows[j].value!) {
                  expect(nonNullRows[i].rank).toBeLessThanOrEqual(nonNullRows[j].rank);
                } else if (nonNullRows[i].value! < nonNullRows[j].value!) {
                  expect(nonNullRows[i].rank).toBeGreaterThanOrEqual(nonNullRows[j].rank);
                }
              }
            }

            retrieverMock.retrieve.mockClear();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('null-valued rows get last rank', async () => {
      await fc.assert(
        fc.asyncProperty(
          // At least 2 tickers, first has data, rest don't
          fc.uniqueArray(tickerArb, { minLength: 2, maxLength: 5 }),
          finiteValueArb,
          async (tickers, value) => {
            // Only first ticker has data
            retrieverMock.retrieve.mockImplementation(async (query: any) => {
              const ticker = query.tickers[0];
              if (ticker === tickers[0]) {
                return {
                  metrics: [makeMetricResult({ ticker, value, fiscalPeriod: 'FY2024' })],
                  summary: {},
                };
              }
              return { metrics: [], summary: {} };
            });

            const metric: MetricResolution = {
              canonical_id: 'revenue',
              display_name: 'Revenue',
              type: 'atomic',
              confidence: 'exact',
              fuzzy_score: null,
              original_query: 'revenue',
              match_source: 'exact',
              suggestions: null,
            };

            const results = await service.compare(tickers, [metric], 'FY2024', 'FY');
            const rows = results[0].rows;

            // Null-valued rows should have rank = tickers.length (last)
            for (const row of rows) {
              if (row.value === null) {
                expect(row.rank).toBe(tickers.length);
              }
            }

            retrieverMock.retrieve.mockClear();
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
