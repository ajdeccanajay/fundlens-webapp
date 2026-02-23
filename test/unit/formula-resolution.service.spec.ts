import { FormulaResolutionService } from '../../src/rag/metric-resolution/formula-resolution.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { FinancialCalculatorService } from '../../src/deals/financial-calculator.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { MetricDefinition, MetricResolution } from '../../src/rag/metric-resolution/types';

// Mock metric definitions
const mockMetrics: Record<string, MetricDefinition> = {
  revenue: {
    canonical_id: 'revenue',
    display_name: 'Revenue',
    type: 'atomic',
    statement: 'income_statement',
    category: 'revenue',
    asset_class: ['public_equity'],
    industry: 'all',
    synonyms: [],
    xbrl_tags: [],
    db_column: 'revenue',
  },
  cost_of_goods_sold: {
    canonical_id: 'cost_of_goods_sold',
    display_name: 'Cost of Goods Sold',
    type: 'atomic',
    statement: 'income_statement',
    category: 'expenses',
    asset_class: ['public_equity'],
    industry: 'all',
    synonyms: [],
    xbrl_tags: [],
    db_column: 'cost_of_goods_sold',
  },
  gross_profit: {
    canonical_id: 'gross_profit',
    display_name: 'Gross Profit',
    type: 'computed',
    statement: null,
    category: 'profitability',
    asset_class: ['public_equity'],
    industry: 'all',
    synonyms: [],
    xbrl_tags: [],
    formula: 'revenue - cost_of_goods_sold',
    dependencies: ['revenue', 'cost_of_goods_sold'],
    output_format: 'currency',
  },
  gross_margin: {
    canonical_id: 'gross_margin',
    display_name: 'Gross Margin',
    type: 'computed',
    statement: null,
    category: 'profitability',
    asset_class: ['public_equity'],
    industry: 'all',
    synonyms: [],
    xbrl_tags: [],
    formula: 'gross_profit / revenue * 100',
    dependencies: ['gross_profit', 'revenue'],
    output_format: 'percentage',
    interpretation: { strong: '> 40', adequate: '20 - 40', weak: '< 20' },
  },
};

function makeResolution(id: string): MetricResolution {
  const m = mockMetrics[id];
  return {
    canonical_id: id,
    display_name: m?.display_name || id,
    type: m?.type || 'computed',
    confidence: 'exact',
    fuzzy_score: null,
    original_query: id,
    match_source: id,
    suggestions: null,
    formula: m?.formula,
    dependencies: m?.dependencies,
  };
}

describe('FormulaResolutionService', () => {
  let service: FormulaResolutionService;
  let mockRegistry: Partial<MetricRegistryService>;
  let mockPrisma: Partial<PrismaService>;
  let mockCalculator: Partial<FinancialCalculatorService>;

  beforeEach(() => {
    mockRegistry = {
      getMetricById: jest.fn((id: string) => mockMetrics[id] || undefined),
      getTopologicalOrder: jest.fn(() => ['gross_profit', 'gross_margin']),
      getDependencyGraph: jest.fn(() => new Map()),
    };

    mockPrisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([
        { normalized_metric: 'revenue', value: '120000000000', fiscal_period: 'FY2024', period_type: 'annual', filing_type: '10-K' },
        { normalized_metric: 'cost_of_goods_sold', value: '75000000000', fiscal_period: 'FY2024', period_type: 'annual', filing_type: '10-K' },
      ]),
    };

    mockCalculator = {
      evaluateFormula: jest.fn().mockResolvedValue({
        result: 45000000000,
        audit_trail: {
          formula: 'revenue - cost_of_goods_sold',
          inputs: { revenue: 120000000000, cost_of_goods_sold: 75000000000 },
          intermediate_steps: ['120000000000 - 75000000000 = 45000000000'],
          result: 45000000000,
          execution_time_ms: 1.5,
        },
      }),
    };

    service = new FormulaResolutionService(
      mockRegistry as MetricRegistryService,
      mockPrisma as PrismaService,
      mockCalculator as FinancialCalculatorService,
    );
  });

  afterEach(() => {
    service.clearCache();
  });

  it('should resolve a computed metric with all dependencies available', async () => {
    const resolution = makeResolution('gross_profit');
    const result = await service.resolveComputed(resolution, 'AAPL', 'FY2024');

    expect(result.value).toBe(45000000000);
    expect(result.canonical_id).toBe('gross_profit');
    expect(result.display_name).toBe('Gross Profit');
    expect(result.formula).toBe('revenue - cost_of_goods_sold');
    expect(result.explanation).toBeNull();
    expect(result.audit_trail).not.toBeNull();
    expect(result.resolved_inputs).toHaveProperty('revenue');
    expect(result.resolved_inputs).toHaveProperty('cost_of_goods_sold');
  });

  it('should return null with explanation when a dependency is missing', async () => {
    // Only return revenue, not cost_of_goods_sold
    (mockPrisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([
      { normalized_metric: 'revenue', value: '120000000000', fiscal_period: 'FY2024', period_type: 'annual', filing_type: '10-K' },
    ]);

    const resolution = makeResolution('gross_profit');
    const result = await service.resolveComputed(resolution, 'AAPL', 'FY2024');

    expect(result.value).toBeNull();
    expect(result.explanation).toContain('Cannot calculate');
    expect(result.explanation).toContain('Cost of Goods Sold');
    // Python should NOT have been called
    expect(mockCalculator.evaluateFormula).not.toHaveBeenCalled();
  });

  it('should never return 0 for missing values', async () => {
    (mockPrisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([]);

    const resolution = makeResolution('gross_profit');
    const result = await service.resolveComputed(resolution, 'AAPL', 'FY2024');

    expect(result.value).toBeNull();
    expect(result.value).not.toBe(0);
  });

  it('should handle Python calculator errors gracefully', async () => {
    (mockCalculator.evaluateFormula as jest.Mock).mockResolvedValue({
      result: null,
      error: 'Division by zero in formula evaluation',
    });

    const resolution = makeResolution('gross_profit');
    const result = await service.resolveComputed(resolution, 'AAPL', 'FY2024');

    expect(result.value).toBeNull();
    expect(result.explanation).toContain('Formula evaluation failed');
  });

  it('should wire interpretation thresholds from YAML', async () => {
    // gross_margin = gross_profit / revenue * 100 = 37.5
    (mockCalculator.evaluateFormula as jest.Mock)
      .mockResolvedValueOnce({
        result: 45000000000,
        audit_trail: { formula: 'revenue - cost_of_goods_sold', inputs: {}, intermediate_steps: [], result: 45000000000, execution_time_ms: 1 },
      })
      .mockResolvedValueOnce({
        result: 37.5,
        audit_trail: { formula: 'gross_profit / revenue * 100', inputs: {}, intermediate_steps: [], result: 37.5, execution_time_ms: 1 },
      });

    const resolution = makeResolution('gross_margin');
    const result = await service.resolveComputed(resolution, 'AAPL', 'FY2024');

    expect(result.value).toBe(37.5);
    expect(result.interpretation).toContain('Adequate');
  });

  it('should return null result for non-computed metrics', async () => {
    const resolution = makeResolution('revenue');
    const result = await service.resolveComputed(resolution, 'AAPL', 'FY2024');

    expect(result.value).toBeNull();
    expect(result.explanation).toContain('not a computed metric');
  });

  it('should return null result for unknown metric IDs', async () => {
    const resolution: MetricResolution = {
      canonical_id: 'nonexistent_metric',
      display_name: 'Nonexistent',
      type: 'computed',
      confidence: 'exact',
      fuzzy_score: null,
      original_query: 'nonexistent',
      match_source: 'test',
      suggestions: null,
    };

    const result = await service.resolveComputed(resolution, 'AAPL');

    expect(result.value).toBeNull();
    expect(result.explanation).toContain('not found');
  });

  it('should use resolution cache for repeated lookups', async () => {
    const resolution = makeResolution('gross_profit');

    // First call
    await service.resolveComputed(resolution, 'AAPL', 'FY2024');
    // Second call — should use cache
    await service.resolveComputed(resolution, 'AAPL', 'FY2024');

    // DB should only be queried once (cached after first call)
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('should batch fetch atomic values correctly', async () => {
    const values = await service.batchFetchAtomicValues(
      ['revenue', 'cost_of_goods_sold'],
      'AAPL',
      'FY2024',
    );

    expect(values.size).toBe(2);
    expect(values.get('revenue')?.value).toBe(120000000000);
    expect(values.get('revenue')?.source).toBe('database');
    expect(values.get('cost_of_goods_sold')?.value).toBe(75000000000);
  });

  it('should default to "latest" period when none specified', async () => {
    const resolution = makeResolution('gross_profit');
    await service.resolveComputed(resolution, 'AAPL');

    const queryCall = (mockPrisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
    // Should use DISTINCT ON query for latest
    expect(queryCall[0]).toContain('DISTINCT ON');
  });
});
