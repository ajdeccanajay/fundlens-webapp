import {
  MetricDefinition,
  MetricResolution,
  MetricSuggestion,
  IndexBuildResult,
  RegistryStats,
  ComputedMetricResult,
  ResolvedValue,
  PythonCalculationResult,
  AuditTrail,
} from 'src/rag/metric-resolution/types';

describe('Metric Resolution Types', () => {
  describe('MetricDefinition', () => {
    it('should create an atomic metric definition with all required fields', () => {
      const metric: MetricDefinition = {
        canonical_id: 'cash_and_cash_equivalents',
        display_name: 'Cash and Cash Equivalents',
        type: 'atomic',
        statement: 'balance_sheet',
        category: 'current_assets',
        asset_class: ['public_equity', 'private_equity'],
        industry: 'all',
        synonyms: ['Cash', 'Cash on Hand', 'Cash Equivalents'],
        xbrl_tags: ['us-gaap:CashAndCashEquivalentsAtCarryingValue'],
        db_column: 'cash_and_cash_equivalents',
      };

      expect(metric.canonical_id).toBe('cash_and_cash_equivalents');
      expect(metric.type).toBe('atomic');
      expect(metric.statement).toBe('balance_sheet');
      expect(metric.db_column).toBe('cash_and_cash_equivalents');
      expect(metric.synonyms).toHaveLength(3);
    });

    it('should create a computed metric definition with formula and dependencies', () => {
      const metric: MetricDefinition = {
        canonical_id: 'net_debt_to_ebitda',
        display_name: 'Net Debt / EBITDA',
        type: 'computed',
        statement: null,
        category: 'leverage',
        asset_class: ['public_equity', 'private_equity'],
        industry: 'all',
        synonyms: ['net debt to ebitda', 'leverage ratio'],
        xbrl_tags: [],
        formula: 'net_debt / ebitda',
        dependencies: ['net_debt', 'ebitda'],
        output_format: 'ratio',
        output_suffix: 'x',
        interpretation: { low: '< 2.0x', moderate: '2.0x - 4.0x', high: '> 4.0x' },
        calculation_notes: 'Net Debt divided by trailing EBITDA',
      };

      expect(metric.type).toBe('computed');
      expect(metric.statement).toBeNull();
      expect(metric.formula).toBe('net_debt / ebitda');
      expect(metric.dependencies).toEqual(['net_debt', 'ebitda']);
      expect(metric.output_format).toBe('ratio');
      expect(metric.interpretation).toHaveProperty('moderate');
    });

    it('should allow supplemental statement type', () => {
      const metric: MetricDefinition = {
        canonical_id: 'proved_reserves',
        display_name: 'Proved Reserves',
        type: 'atomic',
        statement: 'supplemental',
        category: 'reserves',
        asset_class: ['public_equity'],
        industry: 'energy',
        synonyms: ['reserves', 'proved reserves'],
        xbrl_tags: [],
      };

      expect(metric.statement).toBe('supplemental');
      expect(metric.db_column).toBeUndefined();
    });
  });

  describe('MetricResolution', () => {
    it('should create an exact match resolution for an atomic metric', () => {
      const resolution: MetricResolution = {
        canonical_id: 'revenue',
        display_name: 'Revenue',
        type: 'atomic',
        confidence: 'exact',
        fuzzy_score: null,
        original_query: 'total revenue',
        match_source: 'synonym: total revenue',
        suggestions: null,
        db_column: 'revenue',
      };

      expect(resolution.confidence).toBe('exact');
      expect(resolution.fuzzy_score).toBeNull();
      expect(resolution.suggestions).toBeNull();
      expect(resolution.db_column).toBe('revenue');
    });

    it('should create a fuzzy_auto resolution with a score', () => {
      const resolution: MetricResolution = {
        canonical_id: 'ebitda',
        display_name: 'EBITDA',
        type: 'computed',
        confidence: 'fuzzy_auto',
        fuzzy_score: 0.91,
        original_query: 'ebitdaa',
        match_source: 'fuzzy: ebitda (0.91)',
        suggestions: null,
        formula: 'operating_income + depreciation_amortization',
        dependencies: ['operating_income', 'depreciation_amortization'],
      };

      expect(resolution.confidence).toBe('fuzzy_auto');
      expect(resolution.fuzzy_score).toBeGreaterThanOrEqual(0.85);
      expect(resolution.formula).toBeDefined();
      expect(resolution.dependencies).toHaveLength(2);
    });

    it('should create an unresolved resolution with suggestions', () => {
      const resolution: MetricResolution = {
        canonical_id: '',
        display_name: '',
        type: 'atomic',
        confidence: 'unresolved',
        fuzzy_score: null,
        original_query: 'xyzmetric',
        match_source: 'none',
        suggestions: [
          { canonical_id: 'revenue', display_name: 'Revenue', fuzzy_score: 0.72 },
          { canonical_id: 'net_income', display_name: 'Net Income', fuzzy_score: 0.71 },
        ],
      };

      expect(resolution.confidence).toBe('unresolved');
      expect(resolution.canonical_id).toBe('');
      expect(resolution.suggestions).toHaveLength(2);
      expect(resolution.suggestions![0].fuzzy_score).toBe(0.72);
    });
  });

  describe('MetricSuggestion', () => {
    it('should hold a canonical_id, display_name, and fuzzy_score', () => {
      const suggestion: MetricSuggestion = {
        canonical_id: 'gross_profit',
        display_name: 'Gross Profit',
        fuzzy_score: 0.78,
      };

      expect(suggestion.canonical_id).toBe('gross_profit');
      expect(suggestion.fuzzy_score).toBeGreaterThan(0);
      expect(suggestion.fuzzy_score).toBeLessThanOrEqual(1);
    });
  });

  describe('IndexBuildResult', () => {
    it('should capture index build statistics', () => {
      const result: IndexBuildResult = {
        metricsLoaded: 252,
        synonymsIndexed: 1209,
        collisions: 3,
        loadTimeMs: 1450,
      };

      expect(result.metricsLoaded).toBe(252);
      expect(result.synonymsIndexed).toBe(1209);
      expect(result.collisions).toBe(3);
      expect(result.loadTimeMs).toBeGreaterThan(0);
    });
  });

  describe('RegistryStats', () => {
    it('should expose live monitoring stats', () => {
      const stats: RegistryStats = {
        metricsLoaded: 252,
        synonymsIndexed: 1209,
        collisions: 3,
        cacheSize: 150,
        lastBuildTimeMs: 1450,
      };

      expect(stats.cacheSize).toBe(150);
      expect(stats.lastBuildTimeMs).toBe(1450);
    });
  });

  describe('ComputedMetricResult', () => {
    it('should represent a successful computation with audit trail', () => {
      const result: ComputedMetricResult = {
        canonical_id: 'gross_margin_pct',
        display_name: 'Gross Margin %',
        value: 37.5,
        formula: 'gross_profit / revenue * 100',
        resolved_inputs: {
          gross_profit: {
            metric_id: 'gross_profit',
            display_name: 'Gross Profit',
            value: 45000000000,
            source: 'database',
            period: 'FY2024',
          },
          revenue: {
            metric_id: 'revenue',
            display_name: 'Revenue',
            value: 120000000000,
            source: 'database',
            period: 'FY2024',
          },
        },
        explanation: null,
        audit_trail: {
          formula: 'gross_profit / revenue * 100',
          inputs: { gross_profit: 45000000000, revenue: 120000000000 },
          intermediate_steps: [
            '45000000000 / 120000000000 = 0.375',
            '0.375 * 100 = 37.5',
          ],
          result: 37.5,
          execution_time_ms: 2,
        },
        interpretation: 'Strong (> 30%)',
      };

      expect(result.value).toBe(37.5);
      expect(result.explanation).toBeNull();
      expect(result.audit_trail).not.toBeNull();
      expect(result.audit_trail!.execution_time_ms).toBe(2);
      expect(Object.keys(result.resolved_inputs)).toHaveLength(2);
    });

    it('should represent a failed computation with explanation', () => {
      const result: ComputedMetricResult = {
        canonical_id: 'net_debt_to_ebitda',
        display_name: 'Net Debt / EBITDA',
        value: null,
        formula: 'net_debt / ebitda',
        resolved_inputs: {
          net_debt: {
            metric_id: 'net_debt',
            display_name: 'Net Debt',
            value: null,
            source: 'database',
            period: 'FY2024',
          },
        },
        explanation: 'Cannot calculate Net Debt / EBITDA: missing Net Debt for FY2024',
        audit_trail: null,
        interpretation: null,
      };

      expect(result.value).toBeNull();
      expect(result.explanation).toContain('missing');
      expect(result.audit_trail).toBeNull();
    });
  });

  describe('PythonCalculationResult', () => {
    it('should carry a result and audit trail from the Python engine', () => {
      const pyResult: PythonCalculationResult = {
        result: 37.5,
        audit_trail: {
          formula: 'gross_profit / revenue * 100',
          inputs: { gross_profit: 45000000000, revenue: 120000000000 },
          intermediate_steps: ['45000000000 / 120000000000 = 0.375', '0.375 * 100 = 37.5'],
          result: 37.5,
          execution_time_ms: 2,
        },
      };

      expect(pyResult.result).toBe(37.5);
      expect(pyResult.audit_trail.intermediate_steps).toHaveLength(2);
    });
  });

  describe('AuditTrail', () => {
    it('should capture all calculation details for transparency', () => {
      const trail: AuditTrail = {
        formula: 'net_debt / ebitda',
        inputs: { net_debt: 5000000000, ebitda: 2000000000 },
        intermediate_steps: ['5000000000 / 2000000000 = 2.5'],
        result: 2.5,
        execution_time_ms: 1,
      };

      expect(trail.formula).toBe('net_debt / ebitda');
      expect(trail.inputs).toHaveProperty('net_debt');
      expect(trail.inputs).toHaveProperty('ebitda');
      expect(trail.result).toBe(2.5);
      expect(trail.execution_time_ms).toBeLessThan(100);
    });
  });
});
