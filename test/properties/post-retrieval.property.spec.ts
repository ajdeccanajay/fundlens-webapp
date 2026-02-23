/**
 * Property-Based Tests for Post-Retrieval Validation
 *
 * Feature: rag-chatbot-master-engineering, Property 28: Post-retrieval confidence threshold
 * Feature: rag-chatbot-master-engineering, Property 29: 8-K warning label
 *
 * Tests the private validateResult() and validateResults() methods on StructuredRetrieverService
 * via (service as any) access.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { StructuredRetrieverService } from '../../src/rag/structured-retriever.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { FormulaResolutionService } from '../../src/rag/metric-resolution/formula-resolution.service';
import { MetricResult } from '../../src/rag/types/query-intent';

describe('Property Tests - Post-Retrieval Validation', () => {
  let service: StructuredRetrieverService;

  const validateResult = (result: MetricResult): MetricResult | null => {
    return (service as any).validateResult(result);
  };

  const validateResults = (results: MetricResult[]): MetricResult[] => {
    return (service as any).validateResults(results);
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StructuredRetrieverService,
        {
          provide: PrismaService,
          useValue: {
            financialMetric: { findMany: jest.fn().mockResolvedValue([]) },
            calculatedMetric: { findMany: jest.fn().mockResolvedValue([]) },
            $queryRaw: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: MetricRegistryService,
          useValue: {
            getSynonymsForDbColumn: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: FormulaResolutionService,
          useValue: {
            resolveComputed: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = module.get<StructuredRetrieverService>(StructuredRetrieverService);
  });

  // --- Generators ---

  /** Generate a valid parseable fiscal period string */
  const parseablePeriodArb = fc.oneof(
    fc.integer({ min: 1900, max: 2100 }).map(y => `FY${y}`),
    fc.tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1900, max: 2100 }))
      .map(([q, y]) => `Q${q}FY${y}`),
    fc.constant('TTM'),
  );

  const tickerArb = fc.constantFrom('AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'ABNB', 'BKNG', 'COIN', 'DVN');
  const metricNameArb = fc.constantFrom('revenue', 'net_income', 'ebitda', 'gross_profit', 'operating_income');
  const statementTypeArb = fc.constantFrom('income_statement', 'balance_sheet', 'cash_flow', 'computed');
  const filingTypeArb = fc.constantFrom('10-K', '10-Q', '8-K');

  /** Build a base MetricResult with overridable fields */
  const baseMetricResultArb = (overrides: Partial<MetricResult> = {}): fc.Arbitrary<MetricResult> =>
    fc.record({
      ticker: tickerArb,
      normalizedMetric: metricNameArb,
      rawLabel: metricNameArb,
      value: fc.double({ min: -1e12, max: 1e12, noNaN: true }),
      fiscalPeriod: parseablePeriodArb,
      periodType: fc.constantFrom('annual', 'quarterly'),
      filingType: filingTypeArb,
      statementType: statementTypeArb,
      statementDate: fc.date().map(d => new Date(d)),
      filingDate: fc.date().map(d => new Date(d)),
      confidenceScore: fc.double({ min: 0.70, max: 1.0, noNaN: true }),
      displayName: metricNameArb.map(m => m.replace(/_/g, ' ')),
    }).map(r => ({ ...r, ...overrides }));

  describe('Property 28: Post-retrieval confidence threshold', () => {
    /**
     * **Validates: Requirements 20.2**
     *
     * For any MetricResult with confidenceScore < 0.70, the post-retrieval
     * validation should exclude it from results (return null).
     */

    it('any MetricResult with confidenceScore < 0.70 is excluded', () => {
      const lowConfidenceArb = baseMetricResultArb().chain(base =>
        fc.double({ min: 0, max: 0.6999, noNaN: true }).map(score => ({
          ...base,
          confidenceScore: score,
        })),
      );

      fc.assert(
        fc.property(lowConfidenceArb, (result) => {
          const validated = validateResult(result);
          expect(validated).toBeNull();
        }),
        { numRuns: 10 },
      );
    });

    it('any MetricResult with confidenceScore >= 0.70 and valid fields is NOT excluded by confidence check', () => {
      const highConfidenceArb = baseMetricResultArb().chain(base =>
        fc.double({ min: 0.70, max: 1.0, noNaN: true }).map(score => ({
          ...base,
          confidenceScore: score,
          // Ensure non-null value and parseable period so only confidence matters
          value: base.value ?? 100,
          filingType: '10-K',
          statementType: 'income_statement',
        })),
      );

      fc.assert(
        fc.property(highConfidenceArb, (result) => {
          const validated = validateResult(result);
          expect(validated).not.toBeNull();
        }),
        { numRuns: 10 },
      );
    });

    it('validateResults filters out all low-confidence results from a batch', () => {
      const mixedArb = fc.tuple(
        fc.array(baseMetricResultArb({ confidenceScore: 0.5 }), { minLength: 1, maxLength: 5 }),
        fc.array(baseMetricResultArb({ confidenceScore: 0.85, filingType: '10-K' }), { minLength: 1, maxLength: 5 }),
      );

      fc.assert(
        fc.property(mixedArb, ([lowConf, highConf]) => {
          const all = [...lowConf, ...highConf];
          const validated = validateResults(all);
          // No low-confidence results should survive
          for (const r of validated) {
            expect(r.confidenceScore).toBeGreaterThanOrEqual(0.70);
          }
          // All high-confidence results should survive (they have valid values and periods)
          expect(validated.length).toBe(highConf.length);
        }),
        { numRuns: 10 },
      );
    });
  });

  describe('Property 29: 8-K warning label', () => {
    /**
     * **Validates: Requirements 20.4**
     *
     * For any MetricResult from an 8-K filing where the metric belongs to the
     * income statement, the displayName should include the warning
     * "⚠️ (press release, unaudited)".
     */

    it('8-K income statement metrics get warning label appended to displayName', () => {
      const eightKIncomeArb = baseMetricResultArb({
        filingType: '8-K',
        statementType: 'income_statement',
      });

      fc.assert(
        fc.property(eightKIncomeArb, (result) => {
          const validated = validateResult(result);
          expect(validated).not.toBeNull();
          expect(validated!.displayName).toContain('⚠️ (press release, unaudited)');
        }),
        { numRuns: 10 },
      );
    });

    it('8-K income statement metrics preserve original displayName before the warning', () => {
      const eightKIncomeArb = baseMetricResultArb({
        filingType: '8-K',
        statementType: 'income_statement',
      });

      fc.assert(
        fc.property(eightKIncomeArb, (result) => {
          const validated = validateResult(result);
          expect(validated).not.toBeNull();
          const originalName = result.displayName ?? result.normalizedMetric;
          expect(validated!.displayName).toContain(originalName);
        }),
        { numRuns: 10 },
      );
    });

    it('non-8-K filings do NOT get warning label', () => {
      const nonEightKArb = baseMetricResultArb({
        filingType: '10-K',
      });

      fc.assert(
        fc.property(nonEightKArb, (result) => {
          const validated = validateResult(result);
          if (validated) {
            expect(validated.displayName).not.toContain('⚠️ (press release, unaudited)');
          }
        }),
        { numRuns: 10 },
      );
    });

    it('8-K non-income-statement metrics do NOT get warning label', () => {
      const eightKNonIncomeArb = baseMetricResultArb({
        filingType: '8-K',
        statementType: 'balance_sheet',
      });

      fc.assert(
        fc.property(eightKNonIncomeArb, (result) => {
          const validated = validateResult(result);
          if (validated) {
            expect(validated.displayName).not.toContain('⚠️ (press release, unaudited)');
          }
        }),
        { numRuns: 10 },
      );
    });
  });
});
