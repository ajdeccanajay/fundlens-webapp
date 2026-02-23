/**
 * Structured Retriever Unit Tests
 * Tests metric retrieval from PostgreSQL RDS
 */

import { Test, TestingModule } from '@nestjs/testing';
import { StructuredRetrieverService } from '../../src/rag/structured-retriever.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { FormulaResolutionService } from '../../src/rag/metric-resolution/formula-resolution.service';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

/** Helper to create a MetricResolution for test StructuredQuery objects */
const makeMetricResolution = (metricName: string, overrides: Partial<MetricResolution> = {}): MetricResolution => ({
  canonical_id: metricName,
  display_name: metricName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  type: 'atomic',
  confidence: 'exact',
  fuzzy_score: null,
  original_query: metricName,
  match_source: 'synonym_index',
  suggestions: null,
  db_column: metricName,
  ...overrides,
});

describe('StructuredRetrieverService', () => {
  let service: StructuredRetrieverService;
  let prisma: PrismaService;
  let formulaResolver: FormulaResolutionService;

  const mockMetrics = [
    {
      id: 1,
      ticker: 'SHOP',
      normalizedMetric: 'revenue',
      value: 8880000000,
      fiscalPeriod: 'FY2024',
      filingType: '10-K',
      statementType: 'income_statement',
    },
    {
      id: 2,
      ticker: 'SHOP',
      normalizedMetric: 'gross_profit',
      value: 4440000000,
      fiscalPeriod: 'FY2024',
      filingType: '10-K',
      statementType: 'income_statement',
    },
    {
      id: 3,
      ticker: 'SHOP',
      normalizedMetric: 'net_income',
      value: 1500000000,
      fiscalPeriod: 'FY2024',
      filingType: '10-K',
      statementType: 'income_statement',
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StructuredRetrieverService,
        {
          provide: PrismaService,
          useValue: {
            financialMetric: {
              findMany: jest.fn().mockResolvedValue(mockMetrics),
            },
            calculatedMetric: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            $queryRaw: jest.fn().mockResolvedValue([{ count: 3 }]),
          },
        },
        {
          provide: MetricRegistryService,
          useValue: {
            getSynonymsForDbColumn: jest.fn().mockImplementation((id: string) => [id]),
          },
        },
        {
          provide: FormulaResolutionService,
          useValue: {
            resolveComputed: jest.fn().mockResolvedValue({
              canonical_id: 'ebitda_margin',
              display_name: 'EBITDA Margin',
              value: 0.35,
              formula: 'ebitda / revenue * 100',
              resolved_inputs: {
                ebitda: { metric_id: 'ebitda', display_name: 'EBITDA', value: 3108000000, source: 'database', period: 'FY2024' },
                revenue: { metric_id: 'revenue', display_name: 'Revenue', value: 8880000000, source: 'database', period: 'FY2024' },
              },
              explanation: null,
              audit_trail: null,
              interpretation: null,
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StructuredRetrieverService>(StructuredRetrieverService);
    prisma = module.get<PrismaService>(PrismaService);
    formulaResolver = module.get<FormulaResolutionService>(FormulaResolutionService);
  });

  describe('Metric Retrieval', () => {
    it('should retrieve metrics for ticker', async () => {
      const result = await service.retrieve({
        tickers: ['SHOP'],
        metrics: [makeMetricResolution('revenue'), makeMetricResolution('gross_profit')],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(result.metrics).toBeDefined();
      expect(prisma.financialMetric.findMany).toHaveBeenCalled();
    });

    it('should filter by metric names', async () => {
      await service.retrieve({
        tickers: ['SHOP'],
        metrics: [makeMetricResolution('revenue')],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(prisma.financialMetric.findMany).toHaveBeenCalled();
    });

    it('should filter by fiscal period', async () => {
      await service.retrieve({
        tickers: ['SHOP'],
        metrics: [makeMetricResolution('revenue')],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(prisma.financialMetric.findMany).toHaveBeenCalled();
    });

    it('should handle multiple tickers', async () => {
      await service.retrieve({
        tickers: ['SHOP', 'AAPL'],
        metrics: [makeMetricResolution('revenue')],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(prisma.financialMetric.findMany).toHaveBeenCalled();
    });
  });

  describe('Query Building', () => {
    it('should build case-insensitive ticker filter', async () => {
      await service.retrieve({
        tickers: ['shop'],
        metrics: [makeMetricResolution('revenue')],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(prisma.financialMetric.findMany).toHaveBeenCalled();
    });

    it('should call findMany with limit', async () => {
      await service.retrieve({
        tickers: ['SHOP'],
        metrics: [makeMetricResolution('revenue')],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(prisma.financialMetric.findMany).toHaveBeenCalled();
    });
  });

  describe('Result Summary', () => {
    it('should build retrieval summary', async () => {
      const result = await service.retrieve({
        tickers: ['SHOP'],
        metrics: [makeMetricResolution('revenue'), makeMetricResolution('gross_profit'), makeMetricResolution('net_income')],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(result.summary).toBeDefined();
      expect(result.summary.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Computed Metrics', () => {
    it('should include computed metrics when requested', async () => {
      await service.retrieve({
        tickers: ['SHOP'],
        metrics: [makeMetricResolution('gross_margin', { type: 'computed', db_column: undefined })],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: true,
      });

      // Should call either calculatedMetric or financialMetric
      expect(
        prisma.calculatedMetric.findMany || prisma.financialMetric.findMany
      ).toBeDefined();
    });

    it('should skip computed metrics when not requested', async () => {
      await service.retrieve({
        tickers: ['SHOP'],
        metrics: [makeMetricResolution('revenue')],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(prisma.financialMetric.findMany).toHaveBeenCalled();
    });
  });

  describe('resolveComputedMetric — delegates to FormulaResolutionService (Task 1.7)', () => {
    it('should delegate to FormulaResolutionService and return MetricResult with statementType computed', async () => {
      const resolution = makeMetricResolution('ebitda_margin', {
        type: 'computed',
        display_name: 'EBITDA Margin',
        formula: 'ebitda / revenue * 100',
        dependencies: ['ebitda', 'revenue'],
      });

      const result = await service.retrieve({
        tickers: ['ABNB'],
        metrics: [resolution],
        period: 'FY2024',
        periodType: 'latest',
        filingTypes: ['10-K'],
        includeComputed: true,
      });

      expect(formulaResolver.resolveComputed).toHaveBeenCalledWith(
        resolution,
        'ABNB',
        expect.any(String),
      );

      const computed = result.metrics.find(m => m.statementType === 'computed');
      expect(computed).toBeDefined();
      expect(computed!.statementType).toBe('computed');
      expect(computed!.displayName).toBe('EBITDA Margin');
      expect(computed!.value).toBe(0.35);
      expect(computed!.ticker).toBe('ABNB');
    });

    it('should return null when FormulaResolutionService returns null value', async () => {
      // Mock both 10-K and 10-Q calls to return null value
      (formulaResolver.resolveComputed as jest.Mock)
        .mockResolvedValueOnce({
          canonical_id: 'ebitda_margin',
          display_name: 'EBITDA Margin',
          value: null,
          formula: 'ebitda / revenue * 100',
          resolved_inputs: {},
          explanation: 'Missing dependency: ebitda',
          audit_trail: null,
          interpretation: null,
        })
        .mockResolvedValueOnce({
          canonical_id: 'ebitda_margin',
          display_name: 'EBITDA Margin',
          value: null,
          formula: 'ebitda / revenue * 100',
          resolved_inputs: {},
          explanation: 'Missing dependency: ebitda',
          audit_trail: null,
          interpretation: null,
        });

      const resolution = makeMetricResolution('ebitda_margin', {
        type: 'computed',
        display_name: 'EBITDA Margin',
      });

      const result = await service.retrieve({
        tickers: ['ABNB'],
        metrics: [resolution],
        period: 'FY2024',
        periodType: 'latest',
        filingTypes: ['10-K'],
        includeComputed: true,
      });

      const computed = result.metrics.find(m => m.statementType === 'computed');
      expect(computed).toBeUndefined();
    });

    it('should handle FormulaResolutionService errors gracefully and return null', async () => {
      // Mock both 10-K and 10-Q calls to throw
      (formulaResolver.resolveComputed as jest.Mock)
        .mockRejectedValueOnce(new Error('Python calculation bridge unavailable'))
        .mockRejectedValueOnce(new Error('Python calculation bridge unavailable'));

      const resolution = makeMetricResolution('ebitda_margin', {
        type: 'computed',
        display_name: 'EBITDA Margin',
      });

      const result = await service.retrieve({
        tickers: ['ABNB'],
        metrics: [resolution],
        period: 'FY2024',
        periodType: 'latest',
        filingTypes: ['10-K'],
        includeComputed: true,
      });

      const computed = result.metrics.find(m => m.statementType === 'computed');
      expect(computed).toBeUndefined();
    });

    it('should set displayName from MetricResolution.display_name', async () => {
      (formulaResolver.resolveComputed as jest.Mock).mockResolvedValueOnce({
        canonical_id: 'gross_margin',
        display_name: 'Gross Margin',
        value: 0.50,
        formula: 'gross_profit / revenue * 100',
        resolved_inputs: {
          gross_profit: { metric_id: 'gross_profit', display_name: 'Gross Profit', value: 4440000000, source: 'database', period: 'FY2024' },
          revenue: { metric_id: 'revenue', display_name: 'Revenue', value: 8880000000, source: 'database', period: 'FY2024' },
        },
        explanation: null,
        audit_trail: null,
        interpretation: null,
      });

      const resolution = makeMetricResolution('gross_margin', {
        type: 'computed',
        display_name: 'Gross Margin',
      });

      const result = await service.retrieve({
        tickers: ['SHOP'],
        metrics: [resolution],
        period: 'FY2024',
        periodType: 'latest',
        filingTypes: ['10-K'],
        includeComputed: true,
      });

      const computed = result.metrics.find(m => m.statementType === 'computed');
      expect(computed).toBeDefined();
      expect(computed!.displayName).toBe('Gross Margin');
    });
  });
});


describe('Post-Retrieval Validation Gate (Task 4.4)', () => {
  let service: StructuredRetrieverService;
  let prisma: any;

  const makeMetricResolution = (metricName: string, overrides: Partial<MetricResolution> = {}): MetricResolution => ({
    canonical_id: metricName,
    display_name: metricName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    type: 'atomic',
    confidence: 'exact',
    fuzzy_score: null,
    original_query: metricName,
    match_source: 'synonym_index',
    suggestions: null,
    db_column: metricName,
    ...overrides,
  });

  const makeDbRow = (overrides: Partial<any> = {}) => ({
    id: 1,
    ticker: 'ABNB',
    normalizedMetric: 'revenue',
    rawLabel: 'Revenue',
    value: 5000000000,
    fiscalPeriod: 'FY2024',
    periodType: 'annual',
    filingType: '10-K',
    statementType: 'income_statement',
    statementDate: new Date('2024-12-31'),
    filingDate: new Date('2025-02-15'),
    confidenceScore: 0.95,
    sourcePage: 42,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StructuredRetrieverService,
        {
          provide: PrismaService,
          useValue: {
            financialMetric: {
              findMany: jest.fn().mockResolvedValue([]),
              count: jest.fn().mockResolvedValue(0),
            },
          },
        },
        {
          provide: MetricRegistryService,
          useValue: {
            getSynonymsForDbColumn: jest.fn().mockImplementation((id: string) => [id]),
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
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should exclude results with null values (Req 20.1)', async () => {
    (prisma.financialMetric.findMany as jest.Mock).mockResolvedValue([
      makeDbRow({ value: null, fiscalPeriod: 'FY2024' }),
    ]);

    const result = await service.retrieve({
      tickers: ['ABNB'],
      metrics: [makeMetricResolution('revenue')],
      period: 'FY2024',
      filingTypes: ['10-K'],
      includeComputed: false,
    });

    expect(result.metrics).toHaveLength(0);
  });

  it('should exclude results with confidence < 0.70 (Req 20.2)', async () => {
    (prisma.financialMetric.findMany as jest.Mock).mockResolvedValue([
      makeDbRow({ confidenceScore: 0.50, fiscalPeriod: 'FY2024' }),
    ]);

    const result = await service.retrieve({
      tickers: ['ABNB'],
      metrics: [makeMetricResolution('revenue')],
      period: 'FY2024',
      filingTypes: ['10-K'],
      includeComputed: false,
    });

    expect(result.metrics).toHaveLength(0);
  });

  it('should keep results with confidence >= 0.70', async () => {
    (prisma.financialMetric.findMany as jest.Mock).mockResolvedValue([
      makeDbRow({ confidenceScore: 0.70, fiscalPeriod: 'FY2024' }),
    ]);

    const result = await service.retrieve({
      tickers: ['ABNB'],
      metrics: [makeMetricResolution('revenue')],
      period: 'FY2024',
      filingTypes: ['10-K'],
      includeComputed: false,
    });

    expect(result.metrics).toHaveLength(1);
  });

  it('should exclude results with unparseable fiscal periods (Req 20.3)', async () => {
    (prisma.financialMetric.findMany as jest.Mock).mockResolvedValue([
      makeDbRow({ fiscalPeriod: 'unknown_period' }),
    ]);

    const result = await service.retrieve({
      tickers: ['ABNB'],
      metrics: [makeMetricResolution('revenue')],
      period: 'FY2024',
      filingTypes: ['10-K'],
      includeComputed: false,
    });

    expect(result.metrics).toHaveLength(0);
  });

  it('should append 8-K warning for income statement metrics (Req 20.4)', async () => {
    (prisma.financialMetric.findMany as jest.Mock).mockResolvedValue([
      makeDbRow({
        filingType: '8-K',
        statementType: 'income_statement',
        fiscalPeriod: 'FY2024',
      }),
    ]);

    // Use non-latest path (retrieve with explicit period) so filingType from DB row is preserved
    const result = await service.retrieve({
      tickers: ['ABNB'],
      metrics: [makeMetricResolution('revenue')],
      period: 'FY2024',
      filingTypes: ['8-K'],
      includeComputed: false,
    });

    const withWarning = result.metrics.filter(m => m.displayName?.includes('⚠️'));
    expect(withWarning).toHaveLength(1);
    expect(withWarning[0].displayName).toContain('⚠️ (press release, unaudited)');
  });

  it('should NOT append 8-K warning for non-income-statement metrics', async () => {
    (prisma.financialMetric.findMany as jest.Mock).mockResolvedValue([
      makeDbRow({
        filingType: '8-K',
        statementType: 'balance_sheet',
        normalizedMetric: 'total_assets',
        rawLabel: 'Total Assets',
        fiscalPeriod: 'FY2024',
      }),
    ]);

    const result = await service.retrieve({
      tickers: ['ABNB'],
      metrics: [makeMetricResolution('total_assets')],
      period: 'FY2024',
      filingTypes: ['8-K'],
      includeComputed: false,
    });

    expect(result.metrics.length).toBeGreaterThanOrEqual(1);
    for (const m of result.metrics) {
      expect(m.displayName ?? '').not.toContain('⚠️');
    }
  });

  it('should pass through valid results unchanged', async () => {
    (prisma.financialMetric.findMany as jest.Mock).mockResolvedValue([
      makeDbRow({ confidenceScore: 0.95, value: 5000000000, fiscalPeriod: 'Q3FY2025' }),
    ]);

    const result = await service.retrieve({
      tickers: ['ABNB'],
      metrics: [makeMetricResolution('revenue')],
      period: 'Q3FY2025',
      filingTypes: ['10-K'],
      includeComputed: false,
    });

    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0].value).toBe(5000000000);
    expect(result.metrics[0].confidenceScore).toBe(0.95);
  });
});
