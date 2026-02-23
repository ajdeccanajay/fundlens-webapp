/**
 * Property-Based Tests for Graceful Degradation
 *
 * Feature: rag-chatbot-master-engineering, Property 30: Graceful degradation message
 *
 * For any mix of resolved, missing, and unresolved MetricResolutions, the
 * degradation response should: list found metrics, explain each missing metric
 * with a reason, show "Did you mean" for unresolved metrics with suggestions,
 * and suggest rephrasing for unresolved metrics without suggestions.
 *
 * **Validates: Requirements 21.1, 21.2, 21.3**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ResponseEnrichmentService } from '../../src/rag/response-enrichment.service';
import { FinancialCalculatorService } from '../../src/deals/financial-calculator.service';
import { VisualizationGeneratorService } from '../../src/rag/visualization-generator.service';
import { MetricResult } from '../../src/rag/types/query-intent';
import {
  MetricResolution,
  MetricSuggestion,
} from '../../src/rag/metric-resolution/types';

describe('Property Tests - Graceful Degradation (Property 30)', () => {
  let service: ResponseEnrichmentService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResponseEnrichmentService,
        {
          provide: FinancialCalculatorService,
          useValue: {
            getMetricsSummary: jest.fn(),
            formatMetricValue: jest.fn().mockReturnValue('$100M'),
          },
        },
        {
          provide: VisualizationGeneratorService,
          useValue: { generateVisualization: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ResponseEnrichmentService>(ResponseEnrichmentService);
  });

  // ── Generators ──────────────────────────────────────────────────────────

  const tickerArb = fc.constantFrom('AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'ABNB');
  const periodArb = fc.oneof(
    fc.integer({ min: 2020, max: 2026 }).map(y => `FY${y}`),
    fc.tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 2020, max: 2026 }))
      .map(([q, y]) => `Q${q}FY${y}`),
  );

  const canonicalIdArb = fc.constantFrom(
    'revenue', 'net_income', 'ebitda', 'gross_profit', 'operating_income',
    'free_cash_flow', 'total_assets', 'total_debt', 'gross_profit_margin',
  );

  const displayNameArb = fc.constantFrom(
    'Revenue', 'Net Income', 'EBITDA', 'Gross Profit', 'Operating Income',
    'Free Cash Flow', 'Total Assets', 'Total Debt', 'Gross Profit Margin',
  );

  const originalQueryArb = fc.constantFrom(
    'revenue', 'net income', 'ebitda', 'gross margin', 'operating income',
    'free cash flow', 'total assets', 'total debt', 'proved reserves',
    'magic metric', 'xyzzy ratio', 'custom kpi',
  );

  /** Generate a MetricResult that matches a given canonical_id */
  const metricResultArb = (canonicalId: string): fc.Arbitrary<MetricResult> =>
    fc.record({
      ticker: tickerArb,
      normalizedMetric: fc.constant(canonicalId),
      rawLabel: fc.constant(canonicalId),
      value: fc.double({ min: 1e6, max: 1e12, noNaN: true }),
      fiscalPeriod: periodArb,
      periodType: fc.constantFrom('annual', 'quarterly'),
      filingType: fc.constantFrom('10-K', '10-Q'),
      statementType: fc.constantFrom('income_statement', 'balance_sheet', 'cash_flow'),
      statementDate: fc.constant(new Date('2024-12-31')),
      filingDate: fc.constant(new Date('2025-02-15')),
      confidenceScore: fc.double({ min: 0.7, max: 1.0, noNaN: true }),
      displayName: displayNameArb,
    });

  /** Generate a resolved MetricResolution (exact or fuzzy_auto) */
  const resolvedResolutionArb = (): fc.Arbitrary<MetricResolution> =>
    fc.record({
      canonical_id: canonicalIdArb,
      display_name: displayNameArb,
      type: fc.constantFrom('atomic' as const, 'computed' as const),
      confidence: fc.constantFrom('exact' as const, 'fuzzy_auto' as const),
      fuzzy_score: fc.constant(null),
      original_query: originalQueryArb,
      match_source: fc.constant('exact'),
      suggestions: fc.constant(null),
    });

  /** Generate a suggestion */
  const suggestionArb: fc.Arbitrary<MetricSuggestion> = fc.record({
    canonical_id: canonicalIdArb,
    display_name: displayNameArb,
    fuzzy_score: fc.double({ min: 0.3, max: 0.9, noNaN: true }),
  });

  /** Generate an unresolved MetricResolution WITH suggestions */
  const unresolvedWithSuggestionsArb = (): fc.Arbitrary<MetricResolution> =>
    fc.record({
      canonical_id: fc.constant(''),
      display_name: fc.constant(''),
      type: fc.constant('atomic' as const),
      confidence: fc.constant('unresolved' as const),
      fuzzy_score: fc.constant(null),
      original_query: originalQueryArb,
      match_source: fc.constant('none'),
      suggestions: fc.array(suggestionArb, { minLength: 1, maxLength: 3 }),
    });

  /** Generate an unresolved MetricResolution WITHOUT suggestions */
  const unresolvedNoSuggestionsArb = (): fc.Arbitrary<MetricResolution> =>
    fc.record({
      canonical_id: fc.constant(''),
      display_name: fc.constant(''),
      type: fc.constant('atomic' as const),
      confidence: fc.constant('unresolved' as const),
      fuzzy_score: fc.constant(null),
      original_query: originalQueryArb,
      match_source: fc.constant('none'),
      suggestions: fc.constantFrom(null, []),
    });

  // ── Property 30: Graceful degradation message ──────────────────────────

  describe('Property 30: Graceful degradation message', () => {
    /**
     * **Validates: Requirements 21.1, 21.2, 21.3**
     *
     * For any mix of resolved, missing, and unresolved MetricResolutions,
     * the degradation response should: list found metrics, explain each
     * missing metric with a reason, show "Did you mean" for unresolved
     * metrics with suggestions, and suggest rephrasing for unresolved
     * metrics without suggestions.
     */

    it('lists found metrics with "Here\'s what I found:" when foundMetrics is non-empty', () => {
      fc.assert(
        fc.property(
          fc.array(resolvedResolutionArb(), { minLength: 1, maxLength: 5 }).chain(resolutions => {
            // Generate foundMetrics that match the resolutions
            const foundArbs = resolutions.map(r => metricResultArb(r.canonical_id));
            return fc.tuple(
              fc.tuple(...foundArbs),
              fc.constant(resolutions),
            );
          }),
          ([foundMetrics, resolutions]) => {
            const result = service.buildDegradationResponse(
              foundMetrics as unknown as MetricResult[],
              resolutions,
            );
            expect(result).toContain("Here's what I found:");
          },
        ),
        { numRuns: 10 },
      );
    });

    it('explains each missing resolved metric with "not found in our database"', () => {
      // Generate resolved resolutions that have NO matching foundMetrics
      fc.assert(
        fc.property(
          fc.array(resolvedResolutionArb(), { minLength: 1, maxLength: 5 }),
          (missingResolutions) => {
            // Pass empty foundMetrics so all resolved are "missing"
            const result = service.buildDegradationResponse([], missingResolutions);
            for (const r of missingResolutions) {
              const name = r.display_name || r.canonical_id;
              expect(result).toContain(
                `⚠️ ${name}: not found in our database for the requested period`,
              );
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('shows "Did you mean" for unresolved metrics with suggestions', () => {
      fc.assert(
        fc.property(
          fc.array(unresolvedWithSuggestionsArb(), { minLength: 1, maxLength: 3 }),
          (unresolvedMetrics) => {
            const result = service.buildDegradationResponse([], unresolvedMetrics);
            for (const m of unresolvedMetrics) {
              // Should mention the original query
              expect(result).toContain(m.original_query);
              // Should mention "did you mean" with the top suggestion
              expect(result).toContain('did you mean');
              expect(result).toContain(m.suggestions![0].display_name);
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('suggests rephrasing for unresolved metrics without suggestions', () => {
      fc.assert(
        fc.property(
          fc.array(unresolvedNoSuggestionsArb(), { minLength: 1, maxLength: 3 }),
          (unresolvedMetrics) => {
            const result = service.buildDegradationResponse([], unresolvedMetrics);
            for (const m of unresolvedMetrics) {
              expect(result).toContain(m.original_query);
              expect(result.toLowerCase()).toContain('rephras');
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('returns "No data available" when everything is empty', () => {
      const result = service.buildDegradationResponse([], []);
      expect(result).toContain('No data available');
    });

    it('handles mixed scenario: found + missing + unresolved with suggestions + unresolved without suggestions', () => {
      // Use two distinct canonical IDs: one for the found metric, one for the missing
      const foundCanonicalId = 'revenue';
      const missingCanonicalId = 'total_debt';

      fc.assert(
        fc.property(
          // A found metric + its matching resolution
          metricResultArb(foundCanonicalId),
          // An unresolved with suggestions (unique original_query)
          unresolvedWithSuggestionsArb(),
          // An unresolved without suggestions (unique original_query)
          unresolvedNoSuggestionsArb(),
          (foundMetric, unresolvedWithSugg, unresolvedNoSugg) => {
            const foundRes: MetricResolution = {
              canonical_id: foundCanonicalId,
              display_name: 'Revenue',
              type: 'atomic',
              confidence: 'exact',
              fuzzy_score: null,
              original_query: 'revenue',
              match_source: 'exact',
              suggestions: null,
            };
            const missingRes: MetricResolution = {
              canonical_id: missingCanonicalId,
              display_name: 'Total Debt',
              type: 'atomic',
              confidence: 'exact',
              fuzzy_score: null,
              original_query: 'total debt',
              match_source: 'exact',
              suggestions: null,
            };

            const allResolutions = [foundRes, missingRes, unresolvedWithSugg, unresolvedNoSugg];
            const result = service.buildDegradationResponse([foundMetric], allResolutions);

            // Found section present
            expect(result).toContain("Here's what I found:");

            // Missing resolved metric explained (total_debt has no matching foundMetric)
            expect(result).toContain('⚠️ Total Debt: not found in our database');

            // Unresolved with suggestions shows "did you mean"
            expect(result).toContain(unresolvedWithSugg.original_query);
            expect(result).toContain('did you mean');

            // Unresolved without suggestions suggests rephrasing
            expect(result).toContain(unresolvedNoSugg.original_query);
            expect(result.toLowerCase()).toContain('rephras');
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
