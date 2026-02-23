/**
 * Property-Based Tests for Ingestion Validation
 *
 * Feature: rag-chatbot-master-engineering, Property 24: Range check validation
 * Feature: rag-chatbot-master-engineering, Property 25: Sign convention correction
 * Feature: rag-chatbot-master-engineering, Property 26: Cross-statement reconciliation
 * Feature: rag-chatbot-master-engineering, Property 27: XBRL tag mapping
 *
 * Tests the IngestionValidationService methods:
 * - checkRange() — flags values >5σ from historical mean
 * - verifySignConvention() — corrects sign based on YAML/static conventions
 * - reconcileCrossStatement() — flags IS vs CF net income discrepancies
 * - mapXbrlTag() — maps XBRL tags to canonical_id via MetricRegistry
 */

import * as fc from 'fast-check';
import {
  IngestionValidationService,
  ValidationFlag,
} from '../../src/s3/ingestion-validation.service';

describe('Property Tests - Ingestion Validation', () => {
  let service: IngestionValidationService;
  let mockPrisma: any;
  let mockRegistry: any;

  beforeEach(() => {
    mockPrisma = {
      financialMetric: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    mockRegistry = {
      getMetricById: jest.fn().mockReturnValue(undefined),
      resolve: jest.fn().mockReturnValue({ confidence: 'unresolved' }),
    };
    service = new IngestionValidationService(mockPrisma as any, mockRegistry as any);
  });

  // --- Generators ---

  const tickerArb = fc.constantFrom('AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'ABNB');
  const metricNameArb = fc.constantFrom('revenue', 'net_income', 'gross_profit', 'operating_income', 'total_assets');

  /**
   * Generate a historical series of 8+ values with a tight distribution (low stddev)
   * so we can reliably produce outliers that exceed 5σ.
   */
  const tightHistoricalSeriesArb = fc
    .tuple(
      fc.double({ min: 1e6, max: 1e12, noNaN: true, noDefaultInfinity: true }),
      fc.array(
        fc.double({ min: -0.02, max: 0.02, noNaN: true, noDefaultInfinity: true }),
        { minLength: 8, maxLength: 12 },
      ),
    )
    .map(([baseMean, perturbations]) =>
      perturbations.map((p) => baseMean * (1 + p)),
    );

  /**
   * Compute mean and stddev from a series of values.
   */
  function computeStats(values: number[]): { mean: number; stdDev: number } {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return { mean, stdDev: Math.sqrt(variance) };
  }

  // =========================================================================
  // Property 24: Range check validation
  // =========================================================================
  describe('Property 24: Range check validation', () => {
    /**
     * **Validates: Requirements 19.2**
     *
     * For any metric value and a historical series of 8+ periods, if the value
     * deviates more than 5 standard deviations from the historical mean, the
     * ingestion pipeline should flag it with a low confidence score.
     */

    it('flags values >5σ from historical mean with low confidence', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          metricNameArb,
          tightHistoricalSeriesArb,
          fc.double({ min: 6, max: 50, noNaN: true, noDefaultInfinity: true }),
          async (ticker, metric, historicalValues, sigmaMultiplier) => {
            const { mean, stdDev } = computeStats(historicalValues);

            // Skip degenerate cases where stdDev is 0 (handled separately by the service)
            if (stdDev === 0) return;

            // Create an outlier value that is > 5σ from the mean
            const outlierValue = mean + stdDev * sigmaMultiplier;

            // Mock the DB to return historical values
            mockPrisma.financialMetric.findMany.mockResolvedValue(
              historicalValues.map((v) => ({ value: v })),
            );

            const flags: ValidationFlag[] = [];
            const result = await service.checkRange(ticker, metric, outlierValue, flags);

            // The range check should flag this as an outlier
            expect(result).toBe(true);
            expect(flags.some((f) => f.rule === 'range_check')).toBe(true);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('does NOT flag values within 5σ of historical mean', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          metricNameArb,
          tightHistoricalSeriesArb,
          fc.double({ min: 0, max: 4.9, noNaN: true, noDefaultInfinity: true }),
          async (ticker, metric, historicalValues, sigmaMultiplier) => {
            const { mean, stdDev } = computeStats(historicalValues);

            if (stdDev === 0) return;

            // Create a value within 5σ of the mean
            const normalValue = mean + stdDev * sigmaMultiplier;

            mockPrisma.financialMetric.findMany.mockResolvedValue(
              historicalValues.map((v) => ({ value: v })),
            );

            const flags: ValidationFlag[] = [];
            const result = await service.checkRange(ticker, metric, normalValue, flags);

            expect(result).toBe(false);
            expect(flags.some((f) => f.rule === 'range_check')).toBe(false);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('range check failure sets confidence to LOW_CONFIDENCE (0.3) in full validate()', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          tightHistoricalSeriesArb,
          fc.double({ min: 6, max: 50, noNaN: true, noDefaultInfinity: true }),
          async (ticker, historicalValues, sigmaMultiplier) => {
            const { mean, stdDev } = computeStats(historicalValues);
            if (stdDev === 0) return;

            const outlierValue = mean + stdDev * sigmaMultiplier;

            mockPrisma.financialMetric.findMany.mockResolvedValue(
              historicalValues.map((v) => ({ value: v })),
            );

            const result = await service.validate({
              ticker,
              normalizedMetric: 'revenue',
              rawLabel: 'Revenue',
              value: outlierValue,
              fiscalPeriod: 'FY2024',
              filingType: '10-K',
              statementType: 'income_statement',
              confidenceScore: 0.95,
            });

            expect(result.confidenceScore).toBe(0.3);
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // =========================================================================
  // Property 25: Sign convention correction
  // =========================================================================
  describe('Property 25: Sign convention correction', () => {
    /**
     * **Validates: Requirements 19.3**
     *
     * For any metric with a defined sign_convention in the YAML registry,
     * if the stored value has the wrong sign, the ingestion pipeline should
     * invert it.
     */

    /** Metrics with 'positive' convention from the static SIGN_CONVENTIONS map */
    const positiveConventionMetrics = fc.constantFrom(
      'revenue', 'gross_profit', 'operating_income', 'net_income',
      'total_assets', 'cost_of_goods_sold', 'interest_expense',
      'income_taxes', 'depreciation_amortization', 'operating_cash_flow',
    );

    it('inverts negative values for metrics with positive sign convention', () => {
      fc.assert(
        fc.property(
          positiveConventionMetrics,
          fc.double({ min: -1e12, max: -0.01, noNaN: true, noDefaultInfinity: true }),
          (metricId, negativeValue) => {
            const flags: ValidationFlag[] = [];
            const corrected = service.verifySignConvention(negativeValue, metricId, flags);

            // Value should be inverted to positive
            expect(corrected).toBe(-negativeValue);
            expect(corrected).toBeGreaterThan(0);
            // A sign_convention flag should be raised
            expect(flags.some((f) => f.rule === 'sign_convention')).toBe(true);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('does NOT change positive values for metrics with positive sign convention', () => {
      fc.assert(
        fc.property(
          positiveConventionMetrics,
          fc.double({ min: 0.01, max: 1e12, noNaN: true, noDefaultInfinity: true }),
          (metricId, positiveValue) => {
            const flags: ValidationFlag[] = [];
            const result = service.verifySignConvention(positiveValue, metricId, flags);

            expect(result).toBe(positiveValue);
            expect(flags.some((f) => f.rule === 'sign_convention')).toBe(false);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('uses YAML registry sign_convention when defined', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 3, maxLength: 20 }).filter((s) => /^[a-z_]+$/.test(s)),
          fc.double({ min: -1e12, max: -0.01, noNaN: true, noDefaultInfinity: true }),
          fc.constantFrom('positive' as const, 'negative' as const),
          (metricId, value, convention) => {
            // Mock the YAML registry to return a sign_convention
            mockRegistry.getMetricById.mockReturnValue({ sign_convention: convention });

            const flags: ValidationFlag[] = [];
            const result = service.verifySignConvention(value, metricId, flags);

            if (convention === 'positive') {
              // Negative value with positive convention → should invert
              expect(result).toBe(-value);
              expect(flags.some((f) => f.rule === 'sign_convention')).toBe(true);
            } else {
              // Negative value with negative convention → should keep
              expect(result).toBe(value);
              expect(flags.some((f) => f.rule === 'sign_convention')).toBe(false);
            }

            // Reset mock for next iteration
            mockRegistry.getMetricById.mockReturnValue(undefined);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('does not modify values for metrics without any sign convention', () => {
      fc.assert(
        fc.property(
          fc.double({ min: -1e12, max: 1e12, noNaN: true, noDefaultInfinity: true }),
          (value) => {
            // Use a metric name that has no convention in the static map
            // and mock registry returns undefined
            mockRegistry.getMetricById.mockReturnValue(undefined);

            const flags: ValidationFlag[] = [];
            const result = service.verifySignConvention(value, 'some_unknown_metric_xyz', flags);

            expect(result).toBe(value);
            expect(flags.some((f) => f.rule === 'sign_convention')).toBe(false);
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // =========================================================================
  // Property 26: Cross-statement reconciliation
  // =========================================================================
  describe('Property 26: Cross-statement reconciliation', () => {
    /**
     * **Validates: Requirements 19.4**
     *
     * For any pair of net income values from income statement and cash flow
     * statement for the same ticker and period, if they differ beyond rounding
     * tolerance ($1M), the system should flag the discrepancy and prefer the
     * income statement value.
     */

    const ROUNDING_TOLERANCE = 1_000_000;

    it('flags discrepancy when IS and CF net income differ beyond $1M tolerance', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          fc.constantFrom('FY2024', 'FY2023', 'Q1FY2024', 'Q3FY2025'),
          fc.double({ min: 1e6, max: 1e12, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: ROUNDING_TOLERANCE + 1, max: 1e10, noNaN: true, noDefaultInfinity: true }),
          async (ticker, period, isValue, discrepancy) => {
            const cfValue = isValue + discrepancy;

            // Mock: we're writing the IS value, counterpart is CF
            mockPrisma.financialMetric.findFirst.mockResolvedValue({
              value: cfValue,
              statementType: 'cash_flow',
            });

            const flags: ValidationFlag[] = [];
            await service.reconcileCrossStatement(
              ticker, period, isValue, 'income_statement', flags,
            );

            expect(flags.some((f) => f.rule === 'cross_statement_reconciliation')).toBe(true);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('prefers income statement value when writing from cash_flow side', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          fc.constantFrom('FY2024', 'FY2023', 'Q1FY2024'),
          fc.double({ min: 1e6, max: 1e12, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: ROUNDING_TOLERANCE + 1, max: 1e10, noNaN: true, noDefaultInfinity: true }),
          async (ticker, period, isValue, discrepancy) => {
            const cfValue = isValue + discrepancy;

            // Mock: we're writing the CF value, counterpart is IS
            mockPrisma.financialMetric.findFirst.mockResolvedValue({
              value: isValue,
              statementType: 'income_statement',
            });

            const flags: ValidationFlag[] = [];
            const result = await service.reconcileCrossStatement(
              ticker, period, cfValue, 'cash_flow', flags,
            );

            // Should prefer the IS value (the counterpart)
            expect(result).toBe(isValue);
            expect(flags.some((f) => f.rule === 'cross_statement_reconciliation')).toBe(true);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('does NOT flag when difference is within rounding tolerance', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          fc.constantFrom('FY2024', 'FY2023'),
          fc.double({ min: 1e6, max: 1e12, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 0, max: ROUNDING_TOLERANCE - 1, noNaN: true, noDefaultInfinity: true }),
          async (ticker, period, isValue, smallDiff) => {
            const cfValue = isValue + smallDiff;

            mockPrisma.financialMetric.findFirst.mockResolvedValue({
              value: cfValue,
              statementType: 'cash_flow',
            });

            const flags: ValidationFlag[] = [];
            const result = await service.reconcileCrossStatement(
              ticker, period, isValue, 'income_statement', flags,
            );

            expect(flags.some((f) => f.rule === 'cross_statement_reconciliation')).toBe(false);
            // Original value preserved
            expect(result).toBe(isValue);
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // =========================================================================
  // Property 27: XBRL tag mapping
  // =========================================================================
  describe('Property 27: XBRL tag mapping', () => {
    /**
     * **Validates: Requirements 19.5**
     *
     * For any XBRL tag that exists in the MetricRegistry's YAML definitions,
     * the ingestion pipeline should map it to the correct canonical_id.
     */

    /** Known XBRL tags and their expected canonical_id mappings */
    const knownXbrlMappings = fc.constantFrom(
      { tag: 'us-gaap:Revenues', canonicalId: 'revenue' },
      { tag: 'us-gaap:SalesRevenueNet', canonicalId: 'revenue' },
      { tag: 'us-gaap:NetIncomeLoss', canonicalId: 'net_income' },
      { tag: 'us-gaap:GrossProfit', canonicalId: 'gross_profit' },
      { tag: 'us-gaap:OperatingIncomeLoss', canonicalId: 'operating_income' },
      { tag: 'us-gaap:CostOfGoodsSold', canonicalId: 'cost_of_goods_sold' },
      { tag: 'us-gaap:EarningsPerShareBasic', canonicalId: 'eps_basic' },
      { tag: 'us-gaap:Assets', canonicalId: 'total_assets' },
    );

    it('maps known XBRL tags to the correct canonical_id', () => {
      fc.assert(
        fc.property(knownXbrlMappings, ({ tag, canonicalId }) => {
          // Mock the registry to resolve this XBRL tag
          mockRegistry.resolve.mockReturnValue({
            confidence: 'exact',
            canonical_id: canonicalId,
          });

          const flags: ValidationFlag[] = [];
          const result = service.mapXbrlTag(tag, 'some_metric', flags);

          expect(result.canonicalId).toBe(canonicalId);
          expect(result.xbrlTag).toBe(tag);
          expect(flags.some((f) => f.rule === 'xbrl_mapping')).toBe(true);

          // Reset mock
          mockRegistry.resolve.mockReturnValue({ confidence: 'unresolved' });
        }),
        { numRuns: 10 },
      );
    });

    it('preserves raw XBRL tag in result alongside canonical_id', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 5, maxLength: 50 }).filter((s) => s.includes(':')),
          fc.string({ minLength: 3, maxLength: 30 }),
          (xbrlTag, canonicalId) => {
            mockRegistry.resolve.mockReturnValue({
              confidence: 'exact',
              canonical_id: canonicalId,
            });

            const flags: ValidationFlag[] = [];
            const result = service.mapXbrlTag(xbrlTag, 'metric', flags);

            // Both raw tag and canonical_id should be stored
            expect(result.xbrlTag).toBe(xbrlTag);
            expect(result.canonicalId).toBe(canonicalId);

            mockRegistry.resolve.mockReturnValue({ confidence: 'unresolved' });
          },
        ),
        { numRuns: 10 },
      );
    });

    it('returns null canonicalId for unresolved XBRL tags but preserves raw tag', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 5, maxLength: 50 }).filter((s) => s.includes(':')),
          (xbrlTag) => {
            // Registry cannot resolve this tag
            mockRegistry.resolve.mockReturnValue({ confidence: 'unresolved' });

            const flags: ValidationFlag[] = [];
            const result = service.mapXbrlTag(xbrlTag, 'metric', flags);

            expect(result.canonicalId).toBeNull();
            expect(result.xbrlTag).toBe(xbrlTag);

            // Should still log an xbrl_mapping flag (info level)
            expect(flags.some((f) => f.rule === 'xbrl_mapping')).toBe(true);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('returns both nulls when no XBRL tag is provided', () => {
      fc.assert(
        fc.property(metricNameArb, (metric) => {
          const flags: ValidationFlag[] = [];
          const result = service.mapXbrlTag(undefined, metric, flags);

          expect(result.canonicalId).toBeNull();
          expect(result.xbrlTag).toBeNull();
          expect(flags).toHaveLength(0);
        }),
        { numRuns: 10 },
      );
    });
  });
});
