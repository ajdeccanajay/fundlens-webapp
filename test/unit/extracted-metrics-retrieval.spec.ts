/**
 * Tests for StructuredRetrieverService extracted_metrics fallback.
 * Verifies that when financial_metrics has no results, the retriever
 * falls back to the extracted_metrics table (uploaded document data).
 */
import { StructuredRetrieverService } from '../../src/rag/structured-retriever.service';

describe('StructuredRetrieverService — extracted_metrics fallback', () => {
  let service: StructuredRetrieverService;
  let mockPrisma: any;
  let mockMetricRegistry: any;
  let mockFormulaResolver: any;

  beforeEach(() => {
    mockPrisma = {
      financialMetric: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    };

    mockMetricRegistry = {
      resolve: jest.fn(),
      resolveMultiple: jest.fn(),
      getMetricById: jest.fn(),
      getSynonymsForDbColumn: jest.fn().mockReturnValue(['revenue', 'net_sales', 'total_revenue']),
    };

    mockFormulaResolver = {
      resolveComputed: jest.fn(),
    };

    service = new StructuredRetrieverService(
      mockPrisma,
      mockMetricRegistry,
      mockFormulaResolver,
    );
  });

  it('should fall back to extracted_metrics when financial_metrics is empty', async () => {
    // financial_metrics returns nothing
    mockPrisma.financialMetric.findMany.mockResolvedValue([]);

    // extracted_metrics returns a result
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{
      normalized_metric: 'revenue',
      value: '124300000000',
      period: 'FY2024',
      output_format: 'currency',
      source_file_name: 'AAPL_analyst_report.pdf',
      extraction_confidence: 'high',
      created_at: new Date('2025-02-26'),
    }]);

    mockMetricRegistry.resolveMultiple.mockReturnValue([{
      canonical_id: 'revenue',
      display_name: 'Revenue',
      type: 'atomic',
      confidence: 'exact',
      fuzzy_score: null,
      original_query: 'revenue',
      match_source: 'synonym_index',
    }]);

    const result = await service.retrieve({
      tickers: ['AAPL'],
      metrics: [{
        canonical_id: 'revenue',
        display_name: 'Revenue',
        type: 'atomic',
        confidence: 'exact',
        fuzzy_score: null,
        original_query: 'revenue',
        match_source: 'synonym_index',
      }],
      periodType: 'latest',
    });

    // Should have found the metric from extracted_metrics
    expect(result.metrics.length).toBeGreaterThanOrEqual(1);
    const found = result.metrics.find(m => m.normalizedMetric === 'revenue');
    expect(found).toBeDefined();
    expect(found!.filingType).toBe('uploaded-document');
    expect(found!.value).toBe(124300000000);
  });

  it('should prefer financial_metrics over extracted_metrics', async () => {
    // financial_metrics returns a result
    mockPrisma.financialMetric.findMany.mockResolvedValue([{
      id: '1',
      ticker: 'AAPL',
      normalizedMetric: 'revenue',
      value: 120000000000,
      fiscalPeriod: 'FY2024',
      filingType: '10-K',
      statementType: 'income_statement',
      statementDate: new Date('2024-09-30'),
      filingDate: new Date('2024-11-01'),
      rawLabel: 'Revenue',
      periodType: 'annual',
      confidenceScore: 1.0,
    }]);

    mockMetricRegistry.resolveMultiple.mockReturnValue([{
      canonical_id: 'revenue',
      display_name: 'Revenue',
      type: 'atomic',
      confidence: 'exact',
      fuzzy_score: null,
      original_query: 'revenue',
      match_source: 'synonym_index',
    }]);

    const result = await service.retrieve({
      tickers: ['AAPL'],
      metrics: [{
        canonical_id: 'revenue',
        display_name: 'Revenue',
        type: 'atomic',
        confidence: 'exact',
        fuzzy_score: null,
        original_query: 'revenue',
        match_source: 'synonym_index',
      }],
      periodType: 'latest',
    });

    // Should use financial_metrics (10-K), NOT extracted_metrics
    const found = result.metrics.find(m => m.normalizedMetric === 'revenue');
    expect(found).toBeDefined();
    expect(found!.filingType).toBe('10-K');

    // extracted_metrics should NOT have been queried
    expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('should return null when both sources are empty', async () => {
    mockPrisma.financialMetric.findMany.mockResolvedValue([]);
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

    mockMetricRegistry.resolveMultiple.mockReturnValue([{
      canonical_id: 'revenue',
      display_name: 'Revenue',
      type: 'atomic',
      confidence: 'exact',
      fuzzy_score: null,
      original_query: 'revenue',
      match_source: 'synonym_index',
    }]);

    const result = await service.retrieve({
      tickers: ['AAPL'],
      metrics: [{
        canonical_id: 'revenue',
        display_name: 'Revenue',
        type: 'atomic',
        confidence: 'exact',
        fuzzy_score: null,
        original_query: 'revenue',
        match_source: 'synonym_index',
      }],
      periodType: 'latest',
    });

    // No metrics found from either source
    const found = result.metrics.find(m => m.normalizedMetric === 'revenue');
    expect(found).toBeUndefined();
  });

  it('should handle extracted_metrics query failure gracefully', async () => {
    mockPrisma.financialMetric.findMany.mockResolvedValue([]);
    mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error('table does not exist'));

    mockMetricRegistry.resolveMultiple.mockReturnValue([{
      canonical_id: 'revenue',
      display_name: 'Revenue',
      type: 'atomic',
      confidence: 'exact',
      fuzzy_score: null,
      original_query: 'revenue',
      match_source: 'synonym_index',
    }]);

    // Should not throw
    const result = await service.retrieve({
      tickers: ['AAPL'],
      metrics: [{
        canonical_id: 'revenue',
        display_name: 'Revenue',
        type: 'atomic',
        confidence: 'exact',
        fuzzy_score: null,
        original_query: 'revenue',
        match_source: 'synonym_index',
      }],
      periodType: 'latest',
    });

    expect(result.metrics.find(m => m.normalizedMetric === 'revenue')).toBeUndefined();
  });
});
