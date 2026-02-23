import { Test, TestingModule } from '@nestjs/testing';
import { PeerComparisonService } from '../../src/rag/peer-comparison.service';
import { StructuredRetrieverService } from '../../src/rag/structured-retriever.service';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

/**
 * Unit tests for PeerComparisonService
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4
 */

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
    db_column: 'revenue',
    ...overrides,
  };
}

function makeMetricResult(overrides: any = {}) {
  return {
    ticker: 'ABNB',
    normalizedMetric: 'revenue',
    displayName: 'Revenue',
    rawLabel: 'Revenue',
    value: 1000,
    fiscalPeriod: 'FY2024',
    periodType: 'annual' as const,
    filingType: '10-K',
    statementType: 'income_statement',
    statementDate: new Date('2024-12-31'),
    filingDate: new Date('2025-02-15'),
    confidenceScore: 0.95,
    ...overrides,
  };
}

describe('PeerComparisonService', () => {
  let service: PeerComparisonService;
  let retrieverMock: jest.Mocked<Partial<StructuredRetrieverService>>;

  beforeEach(async () => {
    retrieverMock = {
      retrieve: jest.fn().mockResolvedValue({ metrics: [], summary: {} }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeerComparisonService,
        { provide: StructuredRetrieverService, useValue: retrieverMock },
      ],
    }).compile();

    service = module.get(PeerComparisonService);
  });

  describe('compare() — parallel fetch (Req 16.1)', () => {
    it('should fetch all N tickers × M metrics combinations in parallel', async () => {
      const tickers = ['ABNB', 'BKNG', 'EXPE'];
      const metrics = [makeResolution(), makeResolution({ canonical_id: 'gross_profit_margin', display_name: 'Gross Profit Margin' })];

      retrieverMock.retrieve!.mockResolvedValue({ metrics: [], summary: {} } as any);

      await service.compare(tickers, metrics, 'FY2024', 'FY');

      // 3 tickers × 2 metrics = 6 calls
      expect(retrieverMock.retrieve).toHaveBeenCalledTimes(6);
    });

    it('should return one PeerComparisonResult per metric', async () => {
      const tickers = ['ABNB', 'BKNG'];
      const metrics = [makeResolution(), makeResolution({ canonical_id: 'ebitda', display_name: 'EBITDA' })];

      const results = await service.compare(tickers, metrics, 'FY2024', 'FY');

      expect(results).toHaveLength(2);
      expect(results[0].metric).toBe('revenue');
      expect(results[1].metric).toBe('ebitda');
    });

    it('should handle fetch failures gracefully with null values', async () => {
      retrieverMock.retrieve!.mockRejectedValue(new Error('DB timeout'));

      const results = await service.compare(['ABNB'], [makeResolution()], 'FY2024', 'FY');

      expect(results).toHaveLength(1);
      expect(results[0].rows[0].value).toBeNull();
    });
  });

  describe('normalizePeriods() — LTM normalization (Req 16.2)', () => {
    it('should sum trailing 4 quarters for LTM', () => {
      const raw = {
        ticker: 'ABNB',
        metricId: 'revenue',
        annual: null,
        quarterly: [
          makeMetricResult({ value: 250, fiscalPeriod: 'Q1FY2024', filingType: '10-Q' }),
          makeMetricResult({ value: 300, fiscalPeriod: 'Q2FY2024', filingType: '10-Q' }),
          makeMetricResult({ value: 350, fiscalPeriod: 'Q3FY2024', filingType: '10-Q' }),
          makeMetricResult({ value: 400, fiscalPeriod: 'Q4FY2024', filingType: '10-Q' }),
        ],
      };

      const result = service.computeLTM(raw);

      expect(result.value).toBe(1300); // 250 + 300 + 350 + 400
      expect(result.period).toBe('LTM');
      expect(result.incomplete).toBeFalsy();
    });

    it('should flag incomplete when fewer than 4 quarters', () => {
      const raw = {
        ticker: 'ABNB',
        metricId: 'revenue',
        annual: null,
        quarterly: [
          makeMetricResult({ value: 250, fiscalPeriod: 'Q1FY2024', filingType: '10-Q' }),
          makeMetricResult({ value: 300, fiscalPeriod: 'Q2FY2024', filingType: '10-Q' }),
        ],
      };

      const result = service.computeLTM(raw);

      expect(result.value).toBe(550);
      expect(result.incomplete).toBe(true);
    });

    it('should return null value when no quarters available', () => {
      const raw = {
        ticker: 'ABNB',
        metricId: 'revenue',
        annual: null,
        quarterly: [],
      };

      const result = service.computeLTM(raw);

      expect(result.value).toBeNull();
      expect(result.incomplete).toBe(true);
    });

    it('should use FY passthrough for FY normalization basis', () => {
      const raw = [{
        ticker: 'ABNB',
        metricId: 'revenue',
        annual: makeMetricResult({ value: 5000, fiscalPeriod: 'FY2024' }),
        quarterly: [],
      }];

      const result = service.normalizePeriods(raw, 'FY');

      expect(result).toHaveLength(1);
      expect(result[0].value).toBe(5000);
      expect(result[0].period).toBe('FY2024');
    });

    it('should take 4 most recent quarters for LTM', () => {
      const raw = {
        ticker: 'ABNB',
        metricId: 'revenue',
        annual: null,
        quarterly: [
          makeMetricResult({ value: 100, fiscalPeriod: 'Q1FY2023', filingType: '10-Q' }),
          makeMetricResult({ value: 200, fiscalPeriod: 'Q2FY2023', filingType: '10-Q' }),
          makeMetricResult({ value: 250, fiscalPeriod: 'Q1FY2024', filingType: '10-Q' }),
          makeMetricResult({ value: 300, fiscalPeriod: 'Q2FY2024', filingType: '10-Q' }),
          makeMetricResult({ value: 350, fiscalPeriod: 'Q3FY2024', filingType: '10-Q' }),
          makeMetricResult({ value: 400, fiscalPeriod: 'Q4FY2024', filingType: '10-Q' }),
        ],
      };

      const result = service.computeLTM(raw);

      // Should take Q1FY2024 + Q2FY2024 + Q3FY2024 + Q4FY2024 = 1300
      expect(result.value).toBe(1300);
      expect(result.incomplete).toBeFalsy();
    });
  });

  describe('buildComparisonResult() — statistics (Req 16.3)', () => {
    it('should compute correct median for odd number of values', async () => {
      // Set up 3 tickers with different revenue values
      const tickers = ['ABNB', 'BKNG', 'EXPE'];
      retrieverMock.retrieve!
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'ABNB', value: 100 })], summary: {} } as any)
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'BKNG', value: 300 })], summary: {} } as any)
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'EXPE', value: 200 })], summary: {} } as any);

      const results = await service.compare(tickers, [makeResolution()], 'FY2024', 'FY');

      expect(results[0].median).toBe(200); // middle of [100, 200, 300]
    });

    it('should compute correct median for even number of values', async () => {
      const tickers = ['ABNB', 'BKNG', 'EXPE', 'TRIP'];
      retrieverMock.retrieve!
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'ABNB', value: 100 })], summary: {} } as any)
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'BKNG', value: 400 })], summary: {} } as any)
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'EXPE', value: 200 })], summary: {} } as any)
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'TRIP', value: 300 })], summary: {} } as any);

      const results = await service.compare(tickers, [makeResolution()], 'FY2024', 'FY');

      expect(results[0].median).toBe(250); // avg of 200 and 300
    });

    it('should compute correct mean', async () => {
      const tickers = ['ABNB', 'BKNG', 'EXPE'];
      retrieverMock.retrieve!
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'ABNB', value: 100 })], summary: {} } as any)
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'BKNG', value: 200 })], summary: {} } as any)
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'EXPE', value: 300 })], summary: {} } as any);

      const results = await service.compare(tickers, [makeResolution()], 'FY2024', 'FY');

      expect(results[0].mean).toBe(200); // (100 + 200 + 300) / 3
    });

    it('should assign ranks in descending order (rank 1 = highest)', async () => {
      const tickers = ['ABNB', 'BKNG', 'EXPE'];
      retrieverMock.retrieve!
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'ABNB', value: 100 })], summary: {} } as any)
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'BKNG', value: 300 })], summary: {} } as any)
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'EXPE', value: 200 })], summary: {} } as any);

      const results = await service.compare(tickers, [makeResolution()], 'FY2024', 'FY');

      const bkng = results[0].rows.find(r => r.ticker === 'BKNG');
      const expe = results[0].rows.find(r => r.ticker === 'EXPE');
      const abnb = results[0].rows.find(r => r.ticker === 'ABNB');

      expect(bkng!.rank).toBe(1); // 300 = highest
      expect(expe!.rank).toBe(2); // 200
      expect(abnb!.rank).toBe(3); // 100 = lowest
    });

    it('should compute subject-vs-median percentage', async () => {
      const tickers = ['ABNB', 'BKNG', 'EXPE'];
      retrieverMock.retrieve!
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'ABNB', value: 100 })], summary: {} } as any)
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'BKNG', value: 300 })], summary: {} } as any)
        .mockResolvedValueOnce({ metrics: [makeMetricResult({ ticker: 'EXPE', value: 200 })], summary: {} } as any);

      const results = await service.compare(tickers, [makeResolution()], 'FY2024', 'FY', 'ABNB');

      // median = 200, ABNB = 100, so (100 - 200) / 200 * 100 = -50%
      expect(results[0].subjectTicker).toBe('ABNB');
      expect(results[0].subjectVsMedianPct).toBe(-50);
    });
  });

  describe('PeerComparisonResult shape (Req 16.4)', () => {
    it('should include all required fields', async () => {
      retrieverMock.retrieve!.mockResolvedValue({
        metrics: [makeMetricResult({ ticker: 'ABNB', value: 500 })],
        summary: {},
      } as any);

      const results = await service.compare(['ABNB'], [makeResolution()], 'FY2024', 'FY', 'ABNB');
      const result = results[0];

      expect(result).toHaveProperty('metric');
      expect(result).toHaveProperty('normalizationBasis');
      expect(result).toHaveProperty('period');
      expect(result).toHaveProperty('rows');
      expect(result).toHaveProperty('median');
      expect(result).toHaveProperty('mean');
      expect(result).toHaveProperty('subjectTicker');
      expect(result).toHaveProperty('subjectRank');
      expect(result).toHaveProperty('subjectVsMedianPct');
    });

    it('should set normalizationBasis correctly', async () => {
      retrieverMock.retrieve!.mockResolvedValue({ metrics: [], summary: {} } as any);

      const fyResults = await service.compare(['ABNB'], [makeResolution()], 'FY2024', 'FY');
      expect(fyResults[0].normalizationBasis).toBe('FY');

      const ltmResults = await service.compare(['ABNB'], [makeResolution()], 'LTM', 'LTM');
      expect(ltmResults[0].normalizationBasis).toBe('LTM');
    });
  });

  describe('FY mismatch warning (Req 16.2)', () => {
    it('should flag when fiscal year-ends differ by > 60 days', async () => {
      // ABNB: Dec 31, MSFT: Jun 30 — differ by ~183 days
      retrieverMock.retrieve!
        .mockResolvedValueOnce({
          metrics: [makeMetricResult({
            ticker: 'ABNB',
            value: 100,
            statementDate: new Date('2024-12-31'),
          })],
          summary: {},
        } as any)
        .mockResolvedValueOnce({
          metrics: [makeMetricResult({
            ticker: 'MSFT',
            value: 200,
            statementDate: new Date('2024-06-30'),
          })],
          summary: {},
        } as any);

      const results = await service.compare(['ABNB', 'MSFT'], [makeResolution()], 'FY2024', 'FY');

      expect(results[0].fyMismatchWarning).toBeDefined();
      expect(results[0].fyMismatchWarning).toContain('mismatch');
    });

    it('should not flag when fiscal year-ends are within 60 days', async () => {
      // Both Dec 31
      retrieverMock.retrieve!
        .mockResolvedValueOnce({
          metrics: [makeMetricResult({
            ticker: 'ABNB',
            value: 100,
            statementDate: new Date('2024-12-31'),
          })],
          summary: {},
        } as any)
        .mockResolvedValueOnce({
          metrics: [makeMetricResult({
            ticker: 'BKNG',
            value: 200,
            statementDate: new Date('2024-12-31'),
          })],
          summary: {},
        } as any);

      const results = await service.compare(['ABNB', 'BKNG'], [makeResolution()], 'FY2024', 'FY');

      expect(results[0].fyMismatchWarning).toBeUndefined();
    });
  });

  describe('handling null/missing data', () => {
    it('should include null values for tickers with no data', async () => {
      retrieverMock.retrieve!
        .mockResolvedValueOnce({
          metrics: [makeMetricResult({ ticker: 'ABNB', value: 100 })],
          summary: {},
        } as any)
        .mockResolvedValueOnce({
          metrics: [], // BKNG has no data
          summary: {},
        } as any);

      const results = await service.compare(['ABNB', 'BKNG'], [makeResolution()], 'FY2024', 'FY');

      const bkng = results[0].rows.find(r => r.ticker === 'BKNG');
      expect(bkng!.value).toBeNull();
    });

    it('should compute statistics excluding null values', async () => {
      retrieverMock.retrieve!
        .mockResolvedValueOnce({
          metrics: [makeMetricResult({ ticker: 'ABNB', value: 100 })],
          summary: {},
        } as any)
        .mockResolvedValueOnce({
          metrics: [], // no data
          summary: {},
        } as any)
        .mockResolvedValueOnce({
          metrics: [makeMetricResult({ ticker: 'EXPE', value: 300 })],
          summary: {},
        } as any);

      const results = await service.compare(['ABNB', 'BKNG', 'EXPE'], [makeResolution()], 'FY2024', 'FY');

      // Mean and median should only consider ABNB (100) and EXPE (300)
      expect(results[0].mean).toBe(200);
      expect(results[0].median).toBe(200);
    });
  });
});
