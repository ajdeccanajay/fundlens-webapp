import { Test, TestingModule } from '@nestjs/testing';
import { ResponseEnrichmentService } from '../../src/rag/response-enrichment.service';
import {
  FinancialCalculatorService,
  MetricsSummary,
} from '../../src/deals/financial-calculator.service';
import { VisualizationGeneratorService } from '../../src/rag/visualization-generator.service';
import { QueryIntent, MetricResult, RAGResponse } from '../../src/rag/types/query-intent';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

/**
 * Unit tests for ResponseEnrichmentService.
 * Validates: Requirements 2.1, 2.2, 2.4, 7.1
 */

function makeIntent(overrides: Partial<QueryIntent> = {}): QueryIntent {
  return {
    type: 'structured',
    ticker: 'AAPL',
    needsNarrative: false,
    needsComparison: false,
    needsComputation: false,
    needsTrend: false,
    confidence: 0.9,
    originalQuery: 'test query',
    ...overrides,
  };
}

function makeMetric(overrides: Partial<MetricResult> = {}): MetricResult {
  return {
    ticker: 'AAPL',
    normalizedMetric: 'revenue',
    rawLabel: 'Revenue',
    value: 1000000,
    fiscalPeriod: 'FY2023',
    periodType: 'annual',
    filingType: '10-K',
    statementType: 'income_statement',
    statementDate: new Date('2023-12-31'),
    filingDate: new Date('2024-02-15'),
    confidenceScore: 0.95,
    ...overrides,
  };
}

function makeRAGResponse(overrides: Partial<RAGResponse> = {}): RAGResponse {
  return {
    answer: 'Test answer',
    intent: makeIntent(),
    metrics: [],
    sources: [],
    timestamp: new Date(),
    latency: 100,
    cost: 0,
    processingInfo: {
      structuredMetrics: 0,
      semanticNarratives: 0,
      userDocumentChunks: 0,
      usedBedrockKB: false,
      usedClaudeGeneration: true,
      hybridProcessing: false,
    },
    ...overrides,
  };
}

function makeSummary(): MetricsSummary {
  return {
    ticker: 'AAPL',
    isPublic: true,
    calculationDate: new Date(),
    metrics: {
      revenue: {
        ttm: 400000000000,
        annual: [
          { period: 'FY2022', value: 380000000000 },
          { period: 'FY2023', value: 400000000000 },
        ],
        yoyGrowth: [{ period: 'FY2023', value: 5.26 }],
      },
    },
  };
}

describe('ResponseEnrichmentService', () => {
  let service: ResponseEnrichmentService;
  let financialCalculator: jest.Mocked<FinancialCalculatorService>;
  let visualizationGenerator: jest.Mocked<VisualizationGeneratorService>;

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
            generateVisualization: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ResponseEnrichmentService);
    financialCalculator = module.get(FinancialCalculatorService);
    visualizationGenerator = module.get(VisualizationGeneratorService);
  });

  describe('computeFinancials', () => {
    it('should call FinancialCalculatorService when needsTrend is true', async () => {
      const intent = makeIntent({ needsTrend: true, ticker: 'AAPL' });
      const metrics = [makeMetric()];
      const summary = makeSummary();
      financialCalculator.getMetricsSummary.mockResolvedValue(summary);

      const result = await service.computeFinancials(intent, metrics);

      expect(financialCalculator.getMetricsSummary).toHaveBeenCalledWith('AAPL');
      expect(result).toBe(summary);
    });

    it('should return undefined when calculator fails', async () => {
      const intent = makeIntent({ needsTrend: true, ticker: 'AAPL' });
      const metrics = [makeMetric()];
      financialCalculator.getMetricsSummary.mockRejectedValue(
        new Error('Python calculator unavailable'),
      );

      const result = await service.computeFinancials(intent, metrics);

      expect(result).toBeUndefined();
    });
  });

  describe('enrichResponse', () => {
    it('should attach visualization to response', () => {
      const response = makeRAGResponse();
      const intent = makeIntent({ needsTrend: true });
      const metrics = [
        makeMetric({ fiscalPeriod: 'FY2022', value: 380000000000 }),
        makeMetric({ fiscalPeriod: 'FY2023', value: 400000000000 }),
      ];
      const vizPayload = {
        chartType: 'line' as const,
        title: 'AAPL Revenue Trend',
        labels: ['FY2022', 'FY2023'],
        datasets: [{ label: 'Revenue', data: [380000000000, 400000000000] }],
      };
      visualizationGenerator.generateVisualization.mockReturnValue(vizPayload);

      const enriched = service.enrichResponse(response, intent, metrics);

      expect(enriched.visualization).toEqual(vizPayload);
      expect(enriched.answer).toBe(response.answer);
    });
  });

  describe('isQuickResponseEligible', () => {
    it('should return correct boolean based on intent properties', () => {
      // Eligible: structured, high confidence, no narrative
      expect(
        service.isQuickResponseEligible(
          makeIntent({ type: 'structured', confidence: 0.9, needsNarrative: false }),
        ),
      ).toBe(true);

      // Not eligible: semantic type
      expect(
        service.isQuickResponseEligible(
          makeIntent({ type: 'semantic', confidence: 0.9, needsNarrative: false }),
        ),
      ).toBe(false);

      // Not eligible: low confidence
      expect(
        service.isQuickResponseEligible(
          makeIntent({ type: 'structured', confidence: 0.5, needsNarrative: false }),
        ),
      ).toBe(false);

      // Not eligible: needs narrative
      expect(
        service.isQuickResponseEligible(
          makeIntent({ type: 'structured', confidence: 0.9, needsNarrative: true }),
        ),
      ).toBe(false);
    });
  });

  describe('buildQuickResponse', () => {
    it('should produce markdown table with no LLM', async () => {
      const intent = makeIntent({
        type: 'structured',
        confidence: 0.95,
        needsNarrative: false,
        ticker: 'AAPL',
      });
      const metrics = [
        makeMetric({ ticker: 'AAPL', normalizedMetric: 'revenue', value: 400000000000, fiscalPeriod: 'FY2023' }),
        makeMetric({ ticker: 'AAPL', normalizedMetric: 'revenue', value: 380000000000, fiscalPeriod: 'FY2022' }),
      ];
      financialCalculator.getMetricsSummary.mockResolvedValue(makeSummary());
      visualizationGenerator.generateVisualization.mockReturnValue(null);

      const result = await service.buildQuickResponse(intent, metrics);

      // Should contain markdown table structure
      expect(result.answer).toContain('| Ticker | Metric | Value | Period |');
      expect(result.answer).toContain('AAPL');
      expect(result.answer).toContain('Revenue');
      // No LLM invocation
      expect(result.processingInfo?.usedClaudeGeneration).toBe(false);
    });
  });

  // ── Graceful Degradation (Req 9.1–9.4) ──────────────────────

  describe('buildUnresolvedMessage', () => {
    const makeResolution = (overrides: Partial<MetricResolution> = {}): MetricResolution => ({
      canonical_id: '',
      display_name: '',
      type: 'atomic',
      confidence: 'unresolved',
      fuzzy_score: null,
      original_query: 'some metric',
      match_source: '',
      suggestions: null,
      ...overrides,
    });

    it('should return empty string when no unresolved metrics', () => {
      expect(service.buildUnresolvedMessage([])).toBe('');
      expect(service.buildUnresolvedMessage(null as any)).toBe('');
    });

    it('should show "did you mean" when suggestions exist', () => {
      const unresolved = [
        makeResolution({
          original_query: 'revnue',
          suggestions: [
            { canonical_id: 'revenue', display_name: 'Revenue', fuzzy_score: 0.82 },
            { canonical_id: 'net_revenue', display_name: 'Net Revenue', fuzzy_score: 0.75 },
          ],
        }),
      ];

      const msg = service.buildUnresolvedMessage(unresolved);

      expect(msg).toContain('revnue');
      expect(msg).toContain('did you mean');
      expect(msg).toContain('Revenue');
      expect(msg).toContain('Net Revenue');
    });

    it('should show "no metric mapped" when no suggestions', () => {
      const unresolved = [
        makeResolution({
          original_query: 'xyzzy_metric',
          suggestions: null,
        }),
      ];

      const msg = service.buildUnresolvedMessage(unresolved);

      expect(msg).toContain('xyzzy_metric');
      expect(msg).toContain("don't have a metric mapped");
    });

    it('should handle multiple unresolved metrics', () => {
      const unresolved = [
        makeResolution({
          original_query: 'revnue',
          suggestions: [
            { canonical_id: 'revenue', display_name: 'Revenue', fuzzy_score: 0.82 },
          ],
        }),
        makeResolution({
          original_query: 'unknown_thing',
          suggestions: null,
        }),
      ];

      const msg = service.buildUnresolvedMessage(unresolved);

      expect(msg).toContain('revnue');
      expect(msg).toContain('unknown_thing');
    });

    it('should show single suggestion without "Other possibilities"', () => {
      const unresolved = [
        makeResolution({
          original_query: 'gros profit',
          suggestions: [
            { canonical_id: 'gross_profit', display_name: 'Gross Profit', fuzzy_score: 0.80 },
          ],
        }),
      ];

      const msg = service.buildUnresolvedMessage(unresolved);

      expect(msg).toContain('Gross Profit');
      expect(msg).not.toContain('Other possibilities');
    });
  });

  // ── buildVisualizationPayload (Req 7.4, 7.5) ─────────────────

  describe('buildVisualizationPayload', () => {
    it('should return undefined when metrics array is empty', () => {
      const intent = makeIntent({ type: 'structured' });
      expect(service.buildVisualizationPayload(intent, [])).toBeUndefined();
    });

    it('should return undefined when intent type is semantic', () => {
      const intent = makeIntent({ type: 'semantic' });
      const metrics = [makeMetric()];
      expect(service.buildVisualizationPayload(intent, metrics)).toBeUndefined();
    });

    it('should return undefined when metrics is null/undefined', () => {
      const intent = makeIntent({ type: 'structured' });
      expect(service.buildVisualizationPayload(intent, null as any)).toBeUndefined();
      expect(service.buildVisualizationPayload(intent, undefined as any)).toBeUndefined();
    });

    it('should merge metrics into rows by ticker+period', () => {
      const intent = makeIntent({ type: 'structured', suggestedChart: 'bar' });
      const metrics = [
        makeMetric({ ticker: 'AAPL', normalizedMetric: 'revenue', value: 400e9, fiscalPeriod: 'FY2023' }),
        makeMetric({ ticker: 'AAPL', normalizedMetric: 'net_income', value: 100e9, fiscalPeriod: 'FY2023' }),
      ];

      const result = service.buildVisualizationPayload(intent, metrics);

      expect(result).toBeDefined();
      // Two metrics for same ticker+period → one row
      expect(result!.data!.rows).toHaveLength(1);
      expect(result!.data!.rows[0].metrics['revenue']).toBe(400e9);
      expect(result!.data!.rows[0].metrics['net_income']).toBe(100e9);
    });

    it('should build columns from distinct normalizedMetric values', () => {
      const intent = makeIntent({ type: 'structured', suggestedChart: 'grouped_bar' });
      const metrics = [
        makeMetric({ normalizedMetric: 'revenue', value: 400e9, fiscalPeriod: 'FY2023' }),
        makeMetric({ normalizedMetric: 'revenue', value: 380e9, fiscalPeriod: 'FY2022' }),
        makeMetric({ normalizedMetric: 'net_income', value: 100e9, fiscalPeriod: 'FY2023' }),
      ];

      const result = service.buildVisualizationPayload(intent, metrics);

      expect(result!.data!.columns).toHaveLength(2);
      const colIds = result!.data!.columns.map((c) => c.canonical_id);
      expect(colIds).toContain('revenue');
      expect(colIds).toContain('net_income');
    });

    it('should sort periods ascending', () => {
      const intent = makeIntent({ type: 'structured', suggestedChart: 'line' });
      const metrics = [
        makeMetric({ normalizedMetric: 'revenue', value: 400e9, fiscalPeriod: 'FY2024' }),
        makeMetric({ normalizedMetric: 'revenue', value: 350e9, fiscalPeriod: 'FY2022' }),
        makeMetric({ normalizedMetric: 'revenue', value: 380e9, fiscalPeriod: 'FY2023' }),
      ];

      const result = service.buildVisualizationPayload(intent, metrics);

      expect(result!.meta!.periods).toEqual(['FY2022', 'FY2023', 'FY2024']);
      expect(result!.data!.rows[0].period).toBe('FY2022');
      expect(result!.data!.rows[2].period).toBe('FY2024');
    });

    it('should sort quarterly periods correctly within a year', () => {
      const intent = makeIntent({ type: 'structured', suggestedChart: 'line' });
      const metrics = [
        makeMetric({ normalizedMetric: 'revenue', value: 100e9, fiscalPeriod: 'Q3FY2024' }),
        makeMetric({ normalizedMetric: 'revenue', value: 90e9, fiscalPeriod: 'Q1FY2024' }),
        makeMetric({ normalizedMetric: 'revenue', value: 95e9, fiscalPeriod: 'Q2FY2024' }),
      ];

      const result = service.buildVisualizationPayload(intent, metrics);

      expect(result!.meta!.periods).toEqual(['Q1FY2024', 'Q2FY2024', 'Q3FY2024']);
    });

    it('should infer percentage format for margin/rate/ratio/growth metrics', () => {
      const intent = makeIntent({ type: 'structured', suggestedChart: 'bar' });
      const metrics = [
        makeMetric({ normalizedMetric: 'gross_profit_margin', value: 0.45, fiscalPeriod: 'FY2023' }),
      ];

      const result = service.buildVisualizationPayload(intent, metrics);

      const col = result!.data!.columns.find((c) => c.canonical_id === 'gross_profit_margin');
      expect(col!.format).toBe('percentage');
    });

    it('should infer currency format for non-ratio metrics', () => {
      const intent = makeIntent({ type: 'structured', suggestedChart: 'bar' });
      const metrics = [
        makeMetric({ normalizedMetric: 'revenue', value: 400e9, fiscalPeriod: 'FY2023' }),
      ];

      const result = service.buildVisualizationPayload(intent, metrics);

      const col = result!.data!.columns.find((c) => c.canonical_id === 'revenue');
      expect(col!.format).toBe('currency');
    });

    it('should infer billions scale for values > 1B', () => {
      const intent = makeIntent({ type: 'structured', suggestedChart: 'bar' });
      const metrics = [
        makeMetric({ normalizedMetric: 'revenue', value: 400e9, fiscalPeriod: 'FY2023' }),
      ];

      const result = service.buildVisualizationPayload(intent, metrics);

      const col = result!.data!.columns.find((c) => c.canonical_id === 'revenue');
      expect(col!.unit_scale).toBe('billions');
    });

    it('should infer millions scale for values > 1M but <= 1B', () => {
      const intent = makeIntent({ type: 'structured', suggestedChart: 'bar' });
      const metrics = [
        makeMetric({ normalizedMetric: 'revenue', value: 500e6, fiscalPeriod: 'FY2023' }),
      ];

      const result = service.buildVisualizationPayload(intent, metrics);

      const col = result!.data!.columns.find((c) => c.canonical_id === 'revenue');
      expect(col!.unit_scale).toBe('millions');
    });

    it('should infer thousands scale for values > 1K but <= 1M', () => {
      const intent = makeIntent({ type: 'structured', suggestedChart: 'bar' });
      const metrics = [
        makeMetric({ normalizedMetric: 'revenue', value: 50000, fiscalPeriod: 'FY2023' }),
      ];

      const result = service.buildVisualizationPayload(intent, metrics);

      const col = result!.data!.columns.find((c) => c.canonical_id === 'revenue');
      expect(col!.unit_scale).toBe('thousands');
    });

    it('should infer ones scale for small values', () => {
      const intent = makeIntent({ type: 'structured', suggestedChart: 'bar' });
      const metrics = [
        makeMetric({ normalizedMetric: 'pe_ratio', value: 25.5, fiscalPeriod: 'FY2023' }),
      ];

      const result = service.buildVisualizationPayload(intent, metrics);

      const col = result!.data!.columns.find((c) => c.canonical_id === 'pe_ratio');
      expect(col!.unit_scale).toBe('ones');
    });

    it('should set suggestedChartType from intent.suggestedChart', () => {
      const intent = makeIntent({ type: 'structured', suggestedChart: 'grouped_bar' });
      const metrics = [makeMetric()];

      const result = service.buildVisualizationPayload(intent, metrics);

      expect(result!.suggestedChartType).toBe('grouped_bar');
    });

    it('should set suggestedChartType to null when intent has no suggestedChart', () => {
      const intent = makeIntent({ type: 'structured', suggestedChart: null });
      const metrics = [makeMetric()];

      const result = service.buildVisualizationPayload(intent, metrics);

      expect(result!.suggestedChartType).toBeNull();
    });

    it('should populate meta with tickers, periods, and title', () => {
      const intent = makeIntent({
        type: 'structured',
        suggestedChart: 'line',
        originalQuery: 'AAPL revenue trend',
      });
      const metrics = [
        makeMetric({ ticker: 'AAPL', fiscalPeriod: 'FY2022', value: 380e9 }),
        makeMetric({ ticker: 'AAPL', fiscalPeriod: 'FY2023', value: 400e9 }),
      ];

      const result = service.buildVisualizationPayload(intent, metrics);

      expect(result!.meta!.title).toBe('AAPL revenue trend');
      expect(result!.meta!.tickers).toEqual(['AAPL']);
      expect(result!.meta!.periods).toEqual(['FY2022', 'FY2023']);
      expect(result!.meta!.source).toBe('FundLens RAG');
    });

    it('should handle multi-ticker data correctly', () => {
      const intent = makeIntent({ type: 'structured', suggestedChart: 'grouped_bar' });
      const metrics = [
        makeMetric({ ticker: 'AAPL', normalizedMetric: 'revenue', value: 400e9, fiscalPeriod: 'FY2023' }),
        makeMetric({ ticker: 'MSFT', normalizedMetric: 'revenue', value: 200e9, fiscalPeriod: 'FY2023' }),
      ];

      const result = service.buildVisualizationPayload(intent, metrics);

      expect(result!.data!.rows).toHaveLength(2);
      expect(result!.meta!.tickers).toEqual(expect.arrayContaining(['AAPL', 'MSFT']));
    });

    it('should work with hybrid intent type', () => {
      const intent = makeIntent({ type: 'hybrid', suggestedChart: 'bar' });
      const metrics = [makeMetric()];

      const result = service.buildVisualizationPayload(intent, metrics);

      expect(result).toBeDefined();
      expect(result!.suggestedChartType).toBe('bar');
    });

    it('should use displayName from MetricResult when available', () => {
      const intent = makeIntent({ type: 'structured', suggestedChart: 'bar' });
      const metrics = [
        makeMetric({ normalizedMetric: 'revenue', displayName: 'Total Revenue', value: 400e9 }),
      ];

      const result = service.buildVisualizationPayload(intent, metrics);

      const col = result!.data!.columns.find((c) => c.canonical_id === 'revenue');
      expect(col!.display_name).toBe('Total Revenue');
    });
  });

  describe('partitionResolutions', () => {
    const makeRes = (confidence: 'exact' | 'fuzzy_auto' | 'unresolved'): MetricResolution => ({
      canonical_id: confidence === 'unresolved' ? '' : 'revenue',
      display_name: confidence === 'unresolved' ? '' : 'Revenue',
      type: 'atomic',
      confidence,
      fuzzy_score: null,
      original_query: 'revenue',
      match_source: 'test',
      suggestions: null,
    });

    it('should separate resolved from unresolved', () => {
      const resolutions = [
        makeRes('exact'),
        makeRes('unresolved'),
        makeRes('fuzzy_auto'),
      ];

      const { resolved, unresolved } = service.partitionResolutions(resolutions);

      expect(resolved).toHaveLength(2);
      expect(unresolved).toHaveLength(1);
      expect(resolved[0].confidence).toBe('exact');
      expect(resolved[1].confidence).toBe('fuzzy_auto');
      expect(unresolved[0].confidence).toBe('unresolved');
    });

    it('should return empty arrays when all resolved', () => {
      const { unresolved } = service.partitionResolutions([makeRes('exact')]);
      expect(unresolved).toHaveLength(0);
    });

    it('should return empty resolved when all unresolved', () => {
      const { resolved } = service.partitionResolutions([makeRes('unresolved')]);
      expect(resolved).toHaveLength(0);
    });
  });
});
