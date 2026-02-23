/**
 * Property-Based Tests for Computed Metric Routing
 *
 * Feature: rag-chatbot-master-engineering
 * Properties tested:
 * - Property 3: Computed metric routing and result shape
 * - Property 4: Unresolved metric returns null
 *
 * Tests the private getLatestByFilingType() method on StructuredRetrieverService
 * via (service as any) access, matching the pattern used in other property tests.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { StructuredRetrieverService } from '../../src/rag/structured-retriever.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { FormulaResolutionService } from '../../src/rag/metric-resolution/formula-resolution.service';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

describe('Property Tests - Computed Routing', () => {
  let service: StructuredRetrieverService;
  let mockFormulaResolver: { resolveComputed: jest.Mock };
  let mockPrisma: {
    financialMetric: { findMany: jest.Mock };
    calculatedMetric: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };

  /** Access the private method for direct testing */
  const getLatestByFilingType = (
    ticker: string,
    resolution: MetricResolution,
    filingType: string,
  ) => {
    return (service as any).getLatestByFilingType(ticker, resolution, filingType);
  };

  beforeEach(async () => {
    mockFormulaResolver = {
      resolveComputed: jest.fn(),
    };

    mockPrisma = {
      financialMetric: { findMany: jest.fn().mockResolvedValue([]) },
      calculatedMetric: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StructuredRetrieverService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: MetricRegistryService,
          useValue: {
            getSynonymsForDbColumn: jest.fn().mockReturnValue([]),
          },
        },
        { provide: FormulaResolutionService, useValue: mockFormulaResolver },
      ],
    }).compile();

    service = module.get<StructuredRetrieverService>(StructuredRetrieverService);
  });

  // ── Generators ──────────────────────────────────────────────────────────

  /** Generate a valid ticker string (1-5 uppercase letters) */
  const tickerArb = fc.constantFrom(
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'ABNB', 'BKNG',
    'COIN', 'TSLA', 'NFLX', 'CRM', 'UBER', 'LYFT', 'SQ', 'SHOP',
  );

  /** Generate a filing type */
  const filingTypeArb = fc.constantFrom('10-K', '10-Q');

  /** Generate a non-empty display name */
  const displayNameArb = fc.constantFrom(
    'EBITDA Margin', 'Gross Profit Margin', 'Net Income Margin',
    'Return on Equity', 'Debt to Equity', 'Free Cash Flow Margin',
    'Operating Margin', 'Revenue Growth', 'EPS Growth', 'Current Ratio',
  );

  /** Generate a canonical_id (snake_case) */
  const canonicalIdArb = fc.constantFrom(
    'ebitda_margin', 'gross_profit_margin', 'net_income_margin',
    'return_on_equity', 'debt_to_equity', 'free_cash_flow_margin',
    'operating_margin', 'revenue_growth', 'eps_growth', 'current_ratio',
  );

  /** Generate a computed MetricResolution */
  const computedResolutionArb: fc.Arbitrary<MetricResolution> = fc
    .record({
      canonical_id: canonicalIdArb,
      display_name: displayNameArb,
      confidence: fc.constantFrom('exact' as const, 'fuzzy_auto' as const),
    })
    .map(({ canonical_id, display_name, confidence }) => ({
      canonical_id,
      display_name,
      type: 'computed' as const,
      confidence,
      fuzzy_score: null,
      original_query: `what is ${display_name}`,
      match_source: 'test',
      suggestions: null,
      formula: 'a / b * 100',
      dependencies: ['a', 'b'],
    }));

  /** Generate an unresolved MetricResolution */
  const unresolvedResolutionArb: fc.Arbitrary<MetricResolution> = fc
    .record({
      type: fc.constantFrom('atomic' as const, 'computed' as const),
      original_query: fc.string({ minLength: 1, maxLength: 50 }),
    })
    .map(({ type, original_query }) => ({
      canonical_id: '',
      display_name: '',
      type,
      confidence: 'unresolved' as const,
      fuzzy_score: null,
      original_query,
      match_source: 'none',
      suggestions: null,
    }));

  /** Generate a computed value (non-null numeric) */
  const computedValueArb = fc.double({
    min: -1e9,
    max: 1e9,
    noNaN: true,
    noDefaultInfinity: true,
  });

  // ── Property 3: Computed metric routing and result shape ─────────────

  describe('Feature: rag-chatbot-master-engineering, Property 3: Computed metric routing and result shape', () => {
    /**
     * **Validates: Requirements 1.2, 5.1, 5.2, 5.4**
     *
     * For any MetricResolution with `type === 'computed'`, calling
     * `getLatestByFilingType()` should delegate to FormulaResolutionService
     * and, when successful, return a MetricResult with
     * `statementType === 'computed'` and `displayName` matching
     * `resolution.display_name`.
     */

    it('delegates to FormulaResolutionService and returns correct result shape', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          computedResolutionArb,
          filingTypeArb,
          computedValueArb,
          async (ticker, resolution, filingType, value) => {
            // Arrange: FormulaResolutionService returns a successful result
            mockFormulaResolver.resolveComputed.mockResolvedValue({
              canonical_id: resolution.canonical_id,
              display_name: resolution.display_name,
              value,
              formula: resolution.formula ?? '',
              resolved_inputs: {
                dep1: {
                  metric_id: 'dep1',
                  display_name: 'Dep 1',
                  value: 100,
                  source: 'database',
                  period: 'FY2024',
                },
              },
              explanation: null,
              audit_trail: {
                formula: resolution.formula ?? '',
                inputs: {},
                intermediate_steps: [],
                result: value,
                execution_time_ms: 5,
              },
              interpretation: null,
            });

            // Act
            const result = await getLatestByFilingType(ticker, resolution, filingType);

            // Assert: FormulaResolutionService was called
            expect(mockFormulaResolver.resolveComputed).toHaveBeenCalled();
            const lastCall =
              mockFormulaResolver.resolveComputed.mock.calls[
                mockFormulaResolver.resolveComputed.mock.calls.length - 1
              ];
            expect(lastCall[0]).toBe(resolution);
            expect(lastCall[1]).toBe(ticker);

            // Assert: result shape matches requirements
            expect(result).not.toBeNull();
            expect(result.statementType).toBe('computed');
            expect(result.displayName).toBe(resolution.display_name);
            expect(result.ticker).toBe(ticker);
            expect(result.value).toBe(value);

            mockFormulaResolver.resolveComputed.mockClear();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('does not query the database for computed resolutions', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          computedResolutionArb,
          filingTypeArb,
          async (ticker, resolution, filingType) => {
            mockFormulaResolver.resolveComputed.mockResolvedValue({
              canonical_id: resolution.canonical_id,
              display_name: resolution.display_name,
              value: 42.5,
              formula: resolution.formula ?? '',
              resolved_inputs: {},
              explanation: null,
              audit_trail: null,
              interpretation: null,
            });

            mockPrisma.financialMetric.findMany.mockClear();

            await getLatestByFilingType(ticker, resolution, filingType);

            // Prisma should NOT be called for computed metrics
            expect(mockPrisma.financialMetric.findMany).not.toHaveBeenCalled();

            mockFormulaResolver.resolveComputed.mockClear();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('returns null when FormulaResolutionService returns null value', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          computedResolutionArb,
          filingTypeArb,
          async (ticker, resolution, filingType) => {
            mockFormulaResolver.resolveComputed.mockResolvedValue({
              canonical_id: resolution.canonical_id,
              display_name: resolution.display_name,
              value: null,
              formula: resolution.formula ?? '',
              resolved_inputs: {},
              explanation: 'Missing dependency',
              audit_trail: null,
              interpretation: null,
            });

            const result = await getLatestByFilingType(ticker, resolution, filingType);

            expect(result).toBeNull();

            mockFormulaResolver.resolveComputed.mockClear();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('returns null gracefully when FormulaResolutionService throws', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          computedResolutionArb,
          filingTypeArb,
          async (ticker, resolution, filingType) => {
            mockFormulaResolver.resolveComputed.mockRejectedValue(
              new Error('Python bridge unavailable'),
            );

            const result = await getLatestByFilingType(ticker, resolution, filingType);

            // Should not propagate the error — returns null
            expect(result).toBeNull();

            mockFormulaResolver.resolveComputed.mockClear();
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // ── Property 4: Unresolved metric returns null ──────────────────────

  describe('Feature: rag-chatbot-master-engineering, Property 4: Unresolved metric returns null', () => {
    /**
     * **Validates: Requirements 1.3**
     *
     * For any MetricResolution with `confidence === 'unresolved'`,
     * calling `getLatestByFilingType()` should return null without
     * executing a database query.
     */

    it('returns null for unresolved resolutions', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          unresolvedResolutionArb,
          filingTypeArb,
          async (ticker, resolution, filingType) => {
            const result = await getLatestByFilingType(ticker, resolution, filingType);

            expect(result).toBeNull();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('does not execute a database query for unresolved resolutions', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          unresolvedResolutionArb,
          filingTypeArb,
          async (ticker, resolution, filingType) => {
            // When type is 'computed' AND confidence is 'unresolved', the code
            // checks type first and routes to FormulaResolutionService, which
            // will return null for an empty canonical_id. Mock it accordingly.
            mockFormulaResolver.resolveComputed.mockResolvedValue({
              canonical_id: '',
              display_name: '',
              value: null,
              formula: '',
              resolved_inputs: {},
              explanation: 'Metric definition not found',
              audit_trail: null,
              interpretation: null,
            });
            mockPrisma.financialMetric.findMany.mockClear();

            await getLatestByFilingType(ticker, resolution, filingType);

            // The key requirement (1.3): no DATABASE query is executed
            expect(mockPrisma.financialMetric.findMany).not.toHaveBeenCalled();

            mockFormulaResolver.resolveComputed.mockClear();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('returns null regardless of the type field when confidence is unresolved', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          fc.constantFrom('atomic' as const, 'computed' as const),
          filingTypeArb,
          async (ticker, metricType, filingType) => {
            const resolution: MetricResolution = {
              canonical_id: '',
              display_name: '',
              type: metricType,
              confidence: 'unresolved',
              fuzzy_score: null,
              original_query: 'unknown metric query',
              match_source: 'none',
              suggestions: null,
            };

            // When type is 'computed', the code routes to FormulaResolutionService
            // before checking confidence. Mock it to return null for empty canonical_id.
            mockFormulaResolver.resolveComputed.mockResolvedValue({
              canonical_id: '',
              display_name: '',
              value: null,
              formula: '',
              resolved_inputs: {},
              explanation: 'Metric definition not found',
              audit_trail: null,
              interpretation: null,
            });
            mockPrisma.financialMetric.findMany.mockClear();

            const result = await getLatestByFilingType(ticker, resolution, filingType);

            expect(result).toBeNull();
            // No database query should be executed regardless of type
            expect(mockPrisma.financialMetric.findMany).not.toHaveBeenCalled();

            mockFormulaResolver.resolveComputed.mockClear();
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
