import { MetricPersistenceService } from '../../src/documents/metric-persistence.service';

describe('MetricPersistenceService', () => {
  let service: MetricPersistenceService;
  let mockPrisma: any;
  let mockMetricRegistry: any;

  beforeEach(() => {
    mockPrisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      $queryRawUnsafe: jest.fn(),
    };

    mockMetricRegistry = {
      resolve: jest.fn(),
      getMetricById: jest.fn(),
    };

    service = new MetricPersistenceService(mockPrisma, mockMetricRegistry);
  });

  describe('persistMetrics()', () => {
    it('should resolve labels to canonical IDs and persist', async () => {
      mockMetricRegistry.resolve.mockReturnValue({
        canonical_id: 'revenue',
        display_name: 'Revenue',
        confidence: 'exact',
      });
      mockMetricRegistry.getMetricById.mockReturnValue({
        output_format: 'currency',
      });

      const result = await service.persistMetrics(
        'doc-123', 'tenant-1', 'AAPL',
        [
          { rawLabel: 'Total Revenue', value: 100000, period: 'FY2024' },
          { rawLabel: 'Net Sales', value: 120000, period: 'FY2023' },
        ],
        'report.pdf',
      );

      // Should delete existing first (idempotent)
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM extracted_metrics'),
        'doc-123',
      );

      // Should insert 2 metrics (different periods, same canonical_id is OK)
      expect(result.persisted).toBe(2);
      expect(result.total).toBe(2);
      expect(result.skippedUnresolved).toBe(0);
    });

    it('should skip unresolved metrics', async () => {
      mockMetricRegistry.resolve
        .mockReturnValueOnce({ canonical_id: 'revenue', display_name: 'Revenue', confidence: 'exact' })
        .mockReturnValueOnce({ canonical_id: '', display_name: '', confidence: 'unresolved', suggestions: [] });
      mockMetricRegistry.getMetricById.mockReturnValue({ output_format: 'currency' });

      const result = await service.persistMetrics(
        'doc-123', 'tenant-1', 'AAPL',
        [
          { rawLabel: 'Revenue', value: 100000, period: 'FY2024' },
          { rawLabel: 'Weird Custom Metric', value: 42, period: 'FY2024' },
        ],
        'report.pdf',
      );

      expect(result.persisted).toBe(1);
      expect(result.skippedUnresolved).toBe(1);
    });

    it('should deduplicate same canonical_id + period within document', async () => {
      mockMetricRegistry.resolve.mockReturnValue({
        canonical_id: 'revenue',
        display_name: 'Revenue',
        confidence: 'exact',
      });
      mockMetricRegistry.getMetricById.mockReturnValue({ output_format: 'currency' });

      const result = await service.persistMetrics(
        'doc-123', 'tenant-1', 'AAPL',
        [
          { rawLabel: 'Revenue', value: 100000, period: 'FY2024' },
          { rawLabel: 'Total Revenue', value: 100000, period: 'FY2024' }, // Same canonical + period
        ],
        'report.pdf',
      );

      expect(result.persisted).toBe(1);
      expect(result.skippedDuplicate).toBe(1);
    });

    it('should handle empty metrics array', async () => {
      const result = await service.persistMetrics(
        'doc-123', 'tenant-1', 'AAPL', [], 'report.pdf',
      );

      expect(result.total).toBe(0);
      expect(result.persisted).toBe(0);
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should use output_format from MetricRegistry', async () => {
      mockMetricRegistry.resolve.mockReturnValue({
        canonical_id: 'gross_margin_pct',
        display_name: 'Gross Margin',
        confidence: 'exact',
      });
      mockMetricRegistry.getMetricById.mockReturnValue({
        output_format: 'percentage',
      });

      await service.persistMetrics(
        'doc-123', 'tenant-1', 'AAPL',
        [{ rawLabel: 'Gross Margin', value: 0.48, period: 'FY2024' }],
        'report.pdf',
      );

      // The INSERT call should include 'percentage' as output_format
      const insertCall = mockPrisma.$executeRawUnsafe.mock.calls.find(
        (c: any[]) => c[0].includes('INSERT INTO extracted_metrics'),
      );
      expect(insertCall).toBeDefined();
      // output_format is the 12th parameter ($12)
      expect(insertCall![12]).toBe('percentage');
    });

    it('should handle DB insert failure gracefully', async () => {
      mockMetricRegistry.resolve.mockReturnValue({
        canonical_id: 'revenue',
        display_name: 'Revenue',
        confidence: 'exact',
      });
      mockMetricRegistry.getMetricById.mockReturnValue({ output_format: 'currency' });

      // First call is DELETE (succeeds), subsequent INSERT calls fail
      mockPrisma.$executeRawUnsafe
        .mockResolvedValueOnce(undefined) // DELETE
        .mockRejectedValueOnce(new Error('constraint violation'));

      const result = await service.persistMetrics(
        'doc-123', 'tenant-1', 'AAPL',
        [{ rawLabel: 'Revenue', value: 100000, period: 'FY2024' }],
        'report.pdf',
      );

      // Should not throw, just log and report 0 persisted
      expect(result.persisted).toBe(0);
      expect(result.total).toBe(1);
    });

    it('should uppercase ticker', async () => {
      mockMetricRegistry.resolve.mockReturnValue({
        canonical_id: 'revenue',
        display_name: 'Revenue',
        confidence: 'exact',
      });
      mockMetricRegistry.getMetricById.mockReturnValue({ output_format: 'currency' });

      await service.persistMetrics(
        'doc-123', 'tenant-1', 'aapl',
        [{ rawLabel: 'Revenue', value: 100000, period: 'FY2024' }],
        'report.pdf',
      );

      const insertCall = mockPrisma.$executeRawUnsafe.mock.calls.find(
        (c: any[]) => c[0].includes('INSERT INTO extracted_metrics'),
      );
      // ticker is the 3rd parameter ($3)
      expect(insertCall![3]).toBe('AAPL');
    });
  });

  describe('persistFromExtractions()', () => {
    it('should fetch from intel_document_extractions and persist', async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ company_ticker: 'AAPL', file_name: 'report.pdf' }]) // doc lookup
        .mockResolvedValueOnce([ // extractions
          {
            data: { metric_key: 'revenue', numeric_value: 100000, period: 'FY2024' },
            confidence: 'high',
            page_number: 5,
          },
        ]);

      mockMetricRegistry.resolve.mockReturnValue({
        canonical_id: 'revenue',
        display_name: 'Revenue',
        confidence: 'exact',
      });
      mockMetricRegistry.getMetricById.mockReturnValue({ output_format: 'currency' });

      const result = await service.persistFromExtractions('doc-123', 'tenant-1');

      expect(result.persisted).toBe(1);
    });

    it('should skip if no ticker on document', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        { company_ticker: null, file_name: 'unknown.pdf' },
      ]);

      const result = await service.persistFromExtractions('doc-123', 'tenant-1');

      expect(result.total).toBe(0);
      expect(result.persisted).toBe(0);
    });

    it('should skip extractions without numeric_value', async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ company_ticker: 'AAPL', file_name: 'report.pdf' }])
        .mockResolvedValueOnce([
          { data: { metric_key: 'revenue', numeric_value: null }, confidence: 'high', page_number: 1 },
          { data: { metric_key: null, numeric_value: 100 }, confidence: 'high', page_number: 2 },
        ]);

      const result = await service.persistFromExtractions('doc-123', 'tenant-1');

      expect(result.total).toBe(0); // Both filtered out
    });
  });
});
