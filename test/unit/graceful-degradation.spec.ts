/**
 * Unit Tests: ResponseEnrichmentService.buildDegradationResponse()
 *
 * Validates Requirements 21.1, 21.2, 21.3 — context-aware degradation responses
 * that list found metrics, explain missing metrics, and handle unresolved metrics.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ResponseEnrichmentService } from '../../src/rag/response-enrichment.service';
import { FinancialCalculatorService } from '../../src/deals/financial-calculator.service';
import { VisualizationGeneratorService } from '../../src/rag/visualization-generator.service';
import { MetricResult } from '../../src/rag/types/query-intent';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

describe('ResponseEnrichmentService.buildDegradationResponse', () => {
  let service: ResponseEnrichmentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResponseEnrichmentService,
        {
          provide: FinancialCalculatorService,
          useValue: {
            getMetricsSummary: jest.fn(),
            formatMetricValue: jest.fn((v: number, metric: string) => {
              if (metric.includes('margin')) return `${v.toFixed(1)}%`;
              return `$${(v / 1_000_000).toFixed(1)}M`;
            }),
          },
        },
        {
          provide: VisualizationGeneratorService,
          useValue: { generateVisualization: jest.fn().mockReturnValue(null) },
        },
      ],
    }).compile();

    service = module.get(ResponseEnrichmentService);
  });

  // Helper to build a MetricResult
  function makeMetricResult(overrides: Partial<MetricResult> = {}): MetricResult {
    return {
      ticker: 'ABNB',
      normalizedMetric: 'revenue',
      rawLabel: 'Revenue',
      value: 10_500_000_000,
      fiscalPeriod: 'FY2024',
      periodType: 'annual',
      filingType: '10-K',
      statementType: 'income_statement',
      statementDate: new Date('2024-12-31'),
      filingDate: new Date('2025-02-15'),
      confidenceScore: 0.95,
      displayName: 'Revenue',
      ...overrides,
    };
  }

  // Helper to build a MetricResolution
  function makeResolution(overrides: Partial<MetricResolution> = {}): MetricResolution {
    return {
      canonical_id: 'revenue',
      display_name: 'Revenue',
      type: 'atomic',
      confidence: 'exact',
      fuzzy_score: null,
      original_query: 'revenue',
      match_source: 'exact',
      suggestions: null,
      ...overrides,
    };
  }

  // ── Req 21.1: List found metrics and explain missing ──────────

  it('should list found metrics with ticker, value, and period', () => {
    const found = [makeMetricResult()];
    const resolutions = [makeResolution()];

    const result = service.buildDegradationResponse(found, resolutions);

    expect(result).toContain("Here's what I found:");
    expect(result).toContain('Revenue');
    expect(result).toContain('ABNB');
    expect(result).toContain('FY2024');
  });

  it('should explain missing resolved metrics not found in DB', () => {
    const found = [makeMetricResult()];
    const resolutions = [
      makeResolution(),
      makeResolution({
        canonical_id: 'gross_profit_margin',
        display_name: 'Gross Profit Margin',
        original_query: 'gross margin',
      }),
    ];

    const result = service.buildDegradationResponse(found, resolutions);

    expect(result).toContain("Here's what I found:");
    expect(result).toContain('⚠️ Gross Profit Margin: not found in our database for the requested period');
  });

  // ── Req 21.2: Unresolved with suggestions → "Did you mean?" ──

  it('should show "Did you mean" for unresolved metrics with suggestions', () => {
    const found: MetricResult[] = [];
    const resolutions = [
      makeResolution({
        canonical_id: '',
        display_name: '',
        confidence: 'unresolved',
        original_query: 'proved reserves',
        suggestions: [
          { canonical_id: 'total_reserves', display_name: 'Total Reserves', fuzzy_score: 0.8 },
          { canonical_id: 'reserve_ratio', display_name: 'Reserve Replacement Ratio', fuzzy_score: 0.6 },
        ],
      }),
    ];

    const result = service.buildDegradationResponse(found, resolutions);

    expect(result).toContain('proved reserves');
    expect(result).toContain('Total Reserves');
  });

  // ── Req 21.3: Unresolved with no suggestions → suggest rephrasing ──

  it('should suggest rephrasing for unresolved metrics with no suggestions', () => {
    const found: MetricResult[] = [];
    const resolutions = [
      makeResolution({
        canonical_id: '',
        display_name: '',
        confidence: 'unresolved',
        original_query: 'xyzzy metric',
        suggestions: [],
      }),
    ];

    const result = service.buildDegradationResponse(found, resolutions);

    expect(result).toContain('xyzzy metric');
    expect(result).toMatch(/rephras/i);
  });

  // ── Mixed scenario: some found, some missing, some unresolved ──

  it('should handle mixed scenario with found, missing, and unresolved metrics', () => {
    const found = [makeMetricResult()];
    const resolutions = [
      makeResolution(), // revenue — found
      makeResolution({
        canonical_id: 'ebitda',
        display_name: 'EBITDA',
        original_query: 'ebitda',
      }), // resolved but missing from DB
      makeResolution({
        canonical_id: '',
        display_name: '',
        confidence: 'unresolved',
        original_query: 'magic number',
        suggestions: [
          { canonical_id: 'net_income', display_name: 'Net Income', fuzzy_score: 0.5 },
        ],
      }),
    ];

    const result = service.buildDegradationResponse(found, resolutions);

    // Found section
    expect(result).toContain("Here's what I found:");
    expect(result).toContain('Revenue');

    // Missing section
    expect(result).toContain('⚠️ EBITDA: not found in our database for the requested period');

    // Unresolved section
    expect(result).toContain('magic number');
    expect(result).toContain('Net Income');
  });

  // ── Edge: everything missing (no resolutions at all) ──

  it('should return comprehensive no-data message when no resolutions provided', () => {
    const result = service.buildDegradationResponse([], []);

    expect(result).toContain('No data available');
  });

  // ── Edge: all metrics found, no missing or unresolved ──

  it('should only list found metrics when all resolutions are satisfied', () => {
    const found = [
      makeMetricResult(),
      makeMetricResult({
        normalizedMetric: 'net_income',
        displayName: 'Net Income',
        value: 2_000_000_000,
      }),
    ];
    const resolutions = [
      makeResolution(),
      makeResolution({
        canonical_id: 'net_income',
        display_name: 'Net Income',
        original_query: 'net income',
      }),
    ];

    const result = service.buildDegradationResponse(found, resolutions);

    expect(result).toContain("Here's what I found:");
    expect(result).not.toContain('⚠️');
    expect(result).not.toContain('Did you mean');
    expect(result).not.toContain('rephras');
  });
});
