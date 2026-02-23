import { IngestionValidationService, MetricInput, ValidationFlag } from '../../src/s3/ingestion-validation.service';

const mockPrisma = {
  financialMetric: { findMany: jest.fn(), findFirst: jest.fn() },
};
const mockRegistry = {
  getMetricById: jest.fn(),
  resolve: jest.fn(),
  getSynonymsForDbColumn: jest.fn(),
};

describe('IngestionValidationService', () => {
  let svc: IngestionValidationService;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = new IngestionValidationService(mockPrisma as any, mockRegistry as any);
    mockRegistry.getMetricById.mockReturnValue(undefined);
    mockRegistry.resolve.mockReturnValue({ confidence: 'unresolved' });
    mockPrisma.financialMetric.findMany.mockResolvedValue([]);
    mockPrisma.financialMetric.findFirst.mockResolvedValue(null);
  });

  describe('normalizeForStorage', () => {
    it('converts to lowercase', () => {
      const f: ValidationFlag[] = [];
      expect(svc.normalizeForStorage('TotalRevenue', 'x', f)).toBe('totalrevenue');
    });
    it('replaces special chars with underscores', () => {
      const f: ValidationFlag[] = [];
      expect(svc.normalizeForStorage('Net Income (Loss)', 'x', f)).toBe('net_income_loss');
    });
    it('strips leading/trailing underscores', () => {
      const f: ValidationFlag[] = [];
      expect(svc.normalizeForStorage('_Revenue_', 'x', f)).toBe('revenue');
    });
    it('logs flag when normalization changes value', () => {
      const f: ValidationFlag[] = [];
      svc.normalizeForStorage('Total Revenue', 'Total Revenue', f);
      expect(f).toHaveLength(1);
      expect(f[0].rule).toBe('normalization');
    });
    it('no flag when already normalized', () => {
      const f: ValidationFlag[] = [];
      svc.normalizeForStorage('revenue', 'Revenue', f);
      expect(f).toHaveLength(0);
    });
  });

  describe('checkRange', () => {
    it('returns false with < 3 historical values', async () => {
      mockPrisma.financialMetric.findMany.mockResolvedValue([{ value: 100 }, { value: 110 }]);
      const f: ValidationFlag[] = [];
      expect(await svc.checkRange('AAPL', 'revenue', 500, f)).toBe(false);
    });
    it('flags value > 5 sigma from mean', async () => {
      mockPrisma.financialMetric.findMany.mockResolvedValue([
        { value: 100 }, { value: 102 }, { value: 98 }, { value: 101 },
        { value: 99 }, { value: 103 }, { value: 97 }, { value: 100 },
      ]);
      const f: ValidationFlag[] = [];
      expect(await svc.checkRange('AAPL', 'revenue', 200, f)).toBe(true);
      expect(f[0].rule).toBe('range_check');
    });
    it('does not flag value within 5 sigma', async () => {
      mockPrisma.financialMetric.findMany.mockResolvedValue([
        { value: 100 }, { value: 102 }, { value: 98 }, { value: 101 },
        { value: 99 }, { value: 103 }, { value: 97 }, { value: 100 },
      ]);
      const f: ValidationFlag[] = [];
      expect(await svc.checkRange('AAPL', 'revenue', 105, f)).toBe(false);
    });
    it('handles all-identical historical values', async () => {
      mockPrisma.financialMetric.findMany.mockResolvedValue([{ value: 100 }, { value: 100 }, { value: 100 }]);
      const f: ValidationFlag[] = [];
      expect(await svc.checkRange('AAPL', 'revenue', 101, f)).toBe(true);
    });
    it('returns false on DB error', async () => {
      mockPrisma.financialMetric.findMany.mockRejectedValue(new Error('DB'));
      const f: ValidationFlag[] = [];
      expect(await svc.checkRange('AAPL', 'revenue', 100, f)).toBe(false);
    });
  });

  describe('verifySignConvention', () => {
    it('inverts negative revenue to positive', () => {
      const f: ValidationFlag[] = [];
      expect(svc.verifySignConvention(-500, 'revenue', f)).toBe(500);
      expect(f[0].rule).toBe('sign_convention');
    });
    it('keeps positive revenue unchanged', () => {
      const f: ValidationFlag[] = [];
      expect(svc.verifySignConvention(500, 'revenue', f)).toBe(500);
      expect(f).toHaveLength(0);
    });
    it('ignores metrics without sign convention', () => {
      const f: ValidationFlag[] = [];
      expect(svc.verifySignConvention(-500, 'unknown_metric', f)).toBe(-500);
    });
    it('uses YAML registry sign_convention', () => {
      mockRegistry.getMetricById.mockReturnValue({ sign_convention: 'positive' });
      const f: ValidationFlag[] = [];
      expect(svc.verifySignConvention(-100, 'custom_metric', f)).toBe(100);
    });
    it('does not change zero', () => {
      const f: ValidationFlag[] = [];
      expect(svc.verifySignConvention(0, 'revenue', f)).toBe(0);
      expect(f).toHaveLength(0);
    });
  });

  describe('reconcileCrossStatement', () => {
    it('flags discrepancy beyond tolerance', async () => {
      mockPrisma.financialMetric.findFirst.mockResolvedValue({ value: 5e9, statementType: 'cash_flow' });
      const f: ValidationFlag[] = [];
      const r = await svc.reconcileCrossStatement('AAPL', 'FY2024', 3e9, 'income_statement', f);
      expect(r).toBe(3e9);
      expect(f[0].rule).toBe('cross_statement_reconciliation');
    });
    it('prefers IS value when writing CF with discrepancy', async () => {
      mockPrisma.financialMetric.findFirst.mockResolvedValue({ value: 3e9, statementType: 'income_statement' });
      const f: ValidationFlag[] = [];
      expect(await svc.reconcileCrossStatement('AAPL', 'FY2024', 5e9, 'cash_flow', f)).toBe(3e9);
    });
    it('no flag within rounding tolerance', async () => {
      mockPrisma.financialMetric.findFirst.mockResolvedValue({ value: 3000500000, statementType: 'cash_flow' });
      const f: ValidationFlag[] = [];
      await svc.reconcileCrossStatement('AAPL', 'FY2024', 3e9, 'income_statement', f);
      expect(f).toHaveLength(0);
    });
    it('returns original when no counterpart', async () => {
      const f: ValidationFlag[] = [];
      expect(await svc.reconcileCrossStatement('AAPL', 'FY2024', 3e9, 'income_statement', f)).toBe(3e9);
    });
    it('returns original on DB error', async () => {
      mockPrisma.financialMetric.findFirst.mockRejectedValue(new Error('DB'));
      const f: ValidationFlag[] = [];
      expect(await svc.reconcileCrossStatement('AAPL', 'FY2024', 3e9, 'income_statement', f)).toBe(3e9);
    });
  });

  describe('mapXbrlTag', () => {
    it('maps known XBRL tag to canonical_id', () => {
      mockRegistry.resolve.mockReturnValue({ confidence: 'exact', canonical_id: 'revenue' });
      const f: ValidationFlag[] = [];
      const r = svc.mapXbrlTag('us-gaap:Revenues', 'revenue', f);
      expect(r.canonicalId).toBe('revenue');
      expect(r.xbrlTag).toBe('us-gaap:Revenues');
    });
    it('stores raw tag when not in registry', () => {
      const f: ValidationFlag[] = [];
      const r = svc.mapXbrlTag('us-gaap:Unknown', 'x', f);
      expect(r.canonicalId).toBeNull();
      expect(r.xbrlTag).toBe('us-gaap:Unknown');
    });
    it('returns nulls when no tag provided', () => {
      const f: ValidationFlag[] = [];
      const r = svc.mapXbrlTag(undefined, 'revenue', f);
      expect(r.canonicalId).toBeNull();
      expect(r.xbrlTag).toBeNull();
    });
  });

  describe('validate (full pipeline)', () => {
    it('runs all rules and returns combined result', async () => {
      mockRegistry.resolve.mockReturnValue({ confidence: 'exact', canonical_id: 'revenue' });
      const input: MetricInput = {
        ticker: 'AAPL', normalizedMetric: 'Total Revenue', rawLabel: 'Total Revenue',
        value: 1e8, fiscalPeriod: 'FY2024', filingType: '10-K',
        statementType: 'income_statement', confidenceScore: 0.95, xbrlTag: 'us-gaap:Revenues',
      };
      const r = await svc.validate(input);
      expect(r.normalizedMetric).toBe('total_revenue');
      expect(r.value).toBe(1e8);
      expect(r.confidenceScore).toBe(0.95);
      expect(r.canonicalId).toBe('revenue');
      expect(r.xbrlTag).toBe('us-gaap:Revenues');
    });
    it('lowers confidence on range check failure', async () => {
      mockPrisma.financialMetric.findMany.mockResolvedValue([
        { value: 100 }, { value: 102 }, { value: 98 }, { value: 101 },
        { value: 99 }, { value: 103 }, { value: 97 }, { value: 100 },
      ]);
      const input: MetricInput = {
        ticker: 'AAPL', normalizedMetric: 'revenue', rawLabel: 'Revenue',
        value: 10000, fiscalPeriod: 'FY2024', filingType: '10-K',
        statementType: 'income_statement', confidenceScore: 0.95,
      };
      const r = await svc.validate(input);
      expect(r.confidenceScore).toBe(0.3);
    });
    it('corrects sign and flags it', async () => {
      const input: MetricInput = {
        ticker: 'AAPL', normalizedMetric: 'revenue', rawLabel: 'Revenue',
        value: -5e8, fiscalPeriod: 'FY2024', filingType: '10-K',
        statementType: 'income_statement',
      };
      const r = await svc.validate(input);
      expect(r.value).toBe(5e8);
      expect(r.flags.some((fl: ValidationFlag) => fl.rule === 'sign_convention')).toBe(true);
    });
  });
});
