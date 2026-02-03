import { StatementMapper } from '../../src/deals/statement-mapper';
import { StatementType } from '../../src/deals/export.types';

describe('StatementMapper', () => {
  let mapper: StatementMapper;

  beforeEach(() => {
    mapper = new StatementMapper();
  });

  describe('humanizeMetricName', () => {
    it('should convert snake_case to Title Case', () => {
      expect(mapper.humanizeMetricName('total_revenue')).toBe('Total Revenue');
      expect(mapper.humanizeMetricName('net_income')).toBe('Net Income');
      expect(mapper.humanizeMetricName('operating_expenses')).toBe('Operating Expenses');
    });

    it('should handle common financial abbreviations', () => {
      expect(mapper.humanizeMetricName('eps_basic')).toBe('EPS Basic');
      expect(mapper.humanizeMetricName('eps_diluted')).toBe('EPS Diluted');
      expect(mapper.humanizeMetricName('ebitda')).toBe('EBITDA');
      expect(mapper.humanizeMetricName('ebitda_margin')).toBe('EBITDA Margin');
    });

    it('should handle SG&A and R&D abbreviations', () => {
      expect(mapper.humanizeMetricName('sg_and_a')).toBe('SG&A');
      expect(mapper.humanizeMetricName('r_and_d')).toBe('R&D');
      expect(mapper.humanizeMetricName('research_and_development')).toBe('Research & Development');
    });

    it('should handle PP&E abbreviation', () => {
      expect(mapper.humanizeMetricName('ppe_net')).toBe('PP&E Net');
      expect(mapper.humanizeMetricName('property_plant_equipment')).toBe('Property, Plant & Equipment');
    });

    it('should handle cash flow abbreviations', () => {
      expect(mapper.humanizeMetricName('ocf')).toBe('Operating Cash Flow');
      expect(mapper.humanizeMetricName('fcf')).toBe('Free Cash Flow');
      expect(mapper.humanizeMetricName('capex')).toBe('CapEx');
    });

    it('should handle return metrics', () => {
      expect(mapper.humanizeMetricName('roe')).toBe('ROE');
      expect(mapper.humanizeMetricName('roa')).toBe('ROA');
      expect(mapper.humanizeMetricName('roic')).toBe('ROIC');
    });

    it('should handle REIT-specific metrics', () => {
      expect(mapper.humanizeMetricName('ffo')).toBe('FFO');
      expect(mapper.humanizeMetricName('affo')).toBe('AFFO');
      expect(mapper.humanizeMetricName('noi')).toBe('NOI');
    });

    it('should handle telecom metrics', () => {
      expect(mapper.humanizeMetricName('arpu')).toBe('ARPU');
    });

    it('should handle lowercase words correctly', () => {
      expect(mapper.humanizeMetricName('cost_of_revenue')).toBe('Cost of Revenue');
      expect(mapper.humanizeMetricName('income_from_operations')).toBe('Income from Operations');
      expect(mapper.humanizeMetricName('return_on_equity')).toBe('Return on Equity');
    });

    it('should handle "and" as ampersand in middle of string', () => {
      expect(mapper.humanizeMetricName('selling_and_marketing')).toBe('Selling & Marketing');
      expect(mapper.humanizeMetricName('general_and_administrative')).toBe('General & Administrative');
    });

    it('should handle empty or null input', () => {
      expect(mapper.humanizeMetricName('')).toBe('Unknown Metric');
      expect(mapper.humanizeMetricName(null as any)).toBe('Unknown Metric');
      expect(mapper.humanizeMetricName(undefined as any)).toBe('Unknown Metric');
    });

    it('should handle time period abbreviations', () => {
      expect(mapper.humanizeMetricName('revenue_ttm')).toBe('Revenue TTM');
      expect(mapper.humanizeMetricName('growth_yoy')).toBe('Growth YoY');
      expect(mapper.humanizeMetricName('change_qoq')).toBe('Change QoQ');
    });
  });

  describe('detectIndustry', () => {
    it('should detect media companies', () => {
      expect(mapper.detectIndustry('CMCSA')).toBe('media');
      expect(mapper.detectIndustry('DIS')).toBe('media');
      expect(mapper.detectIndustry('NFLX')).toBe('media');
    });

    it('should detect banks', () => {
      expect(mapper.detectIndustry('JPM')).toBe('bank');
      expect(mapper.detectIndustry('BAC')).toBe('bank');
      expect(mapper.detectIndustry('GS')).toBe('bank');
      expect(mapper.detectIndustry('MS')).toBe('bank');
    });

    it('should detect insurance companies', () => {
      expect(mapper.detectIndustry('BRK.A')).toBe('insurance');
      expect(mapper.detectIndustry('BRK.B')).toBe('insurance');
      expect(mapper.detectIndustry('MET')).toBe('insurance');
    });

    it('should detect REITs', () => {
      expect(mapper.detectIndustry('AMT')).toBe('reit');
      expect(mapper.detectIndustry('PLD')).toBe('reit');
      expect(mapper.detectIndustry('SPG')).toBe('reit');
    });

    it('should detect utilities', () => {
      expect(mapper.detectIndustry('NEE')).toBe('utility');
      expect(mapper.detectIndustry('DUK')).toBe('utility');
      expect(mapper.detectIndustry('SO')).toBe('utility');
    });

    it('should detect telecom companies', () => {
      expect(mapper.detectIndustry('T')).toBe('telecom');
      expect(mapper.detectIndustry('VZ')).toBe('telecom');
      expect(mapper.detectIndustry('TMUS')).toBe('telecom');
    });

    it('should return undefined for unknown tickers', () => {
      expect(mapper.detectIndustry('AAPL')).toBeUndefined();
      expect(mapper.detectIndustry('MSFT')).toBeUndefined();
      expect(mapper.detectIndustry('UNKNOWN')).toBeUndefined();
    });

    it('should handle case insensitivity', () => {
      expect(mapper.detectIndustry('jpm')).toBe('bank');
      expect(mapper.detectIndustry('Cmcsa')).toBe('media');
    });
  });

  describe('mapMetricsToStatement', () => {
    it('should map raw metrics to statement rows', () => {
      const rawMetrics = [
        { normalized_metric: 'revenue', value: 100000, fiscal_period: 'FY2024', reporting_unit: 'millions' },
        { normalized_metric: 'net_income', value: 20000, fiscal_period: 'FY2024', reporting_unit: 'millions' },
      ];

      const rows = mapper.mapMetricsToStatement(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
      );

      expect(rows.length).toBeGreaterThan(0);
      
      const revenueRow = rows.find(r => r.normalizedMetric === 'revenue');
      expect(revenueRow).toBeDefined();
      expect(revenueRow?.values.get('FY2024')).toBe(100000);
      expect(revenueRow?.reportingUnits.get('FY2024')).toBe('millions');
    });

    it('should include header rows', () => {
      const rawMetrics = [
        { normalized_metric: 'revenue', value: 100000, fiscal_period: 'FY2024' },
      ];

      const rows = mapper.mapMetricsToStatement(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
      );

      const headerRows = rows.filter(r => r.isHeader);
      expect(headerRows.length).toBeGreaterThan(0);
    });

    it('should handle multiple periods', () => {
      const rawMetrics = [
        { normalized_metric: 'revenue', value: 100000, fiscal_period: 'FY2024', reporting_unit: 'millions' },
        { normalized_metric: 'revenue', value: 90000, fiscal_period: 'FY2023', reporting_unit: 'millions' },
        { normalized_metric: 'revenue', value: 80000, fiscal_period: 'FY2022', reporting_unit: 'millions' },
      ];

      const rows = mapper.mapMetricsToStatement(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024', 'FY2023', 'FY2022'],
      );

      const revenueRow = rows.find(r => r.normalizedMetric === 'revenue');
      expect(revenueRow?.values.get('FY2024')).toBe(100000);
      expect(revenueRow?.values.get('FY2023')).toBe(90000);
      expect(revenueRow?.values.get('FY2022')).toBe(80000);
    });

    it('should handle missing periods with null values', () => {
      const rawMetrics = [
        { normalized_metric: 'revenue', value: 100000, fiscal_period: 'FY2024' },
      ];

      const rows = mapper.mapMetricsToStatement(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024', 'FY2023'],
      );

      const revenueRow = rows.find(r => r.normalizedMetric === 'revenue');
      expect(revenueRow?.values.get('FY2024')).toBe(100000);
      expect(revenueRow?.values.get('FY2023')).toBeNull();
    });
  });

  describe('mapMetricsToStatementWithDiscovery', () => {
    it('should NOT discover metrics not in configuration (dynamic discovery disabled)', () => {
      const rawMetrics = [
        { normalized_metric: 'revenue', value: 100000, fiscal_period: 'FY2024' },
        { normalized_metric: 'custom_metric_xyz', value: 5000, fiscal_period: 'FY2024' },
      ];

      const rows = mapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
      );

      // Dynamic discovery is disabled - custom metrics should NOT appear
      const discoveredRow = rows.find(r => r.normalizedMetric === 'custom_metric_xyz');
      expect(discoveredRow).toBeUndefined();
      
      // But predefined metrics should still work
      const revenueRow = rows.find(r => r.normalizedMetric === 'revenue');
      expect(revenueRow).toBeDefined();
      expect(revenueRow?.values.get('FY2024')).toBe(100000);
    });

    it('should NOT add discovered metrics header (dynamic discovery disabled)', () => {
      const rawMetrics = [
        { normalized_metric: 'unknown_metric_abc', value: 1000, fiscal_period: 'FY2024' },
      ];

      const rows = mapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
      );

      // Dynamic discovery is disabled - no discovered header should appear
      const discoveredHeader = rows.find(r => r.normalizedMetric === 'discovered_header');
      expect(discoveredHeader).toBeUndefined();
    });

    it('should only include predefined metrics to match SEC 10-K structure', () => {
      // Simulate CMCSA-like data with many metrics tagged as income_statement
      const rawMetrics = [
        { normalized_metric: 'revenue', value: 123731, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_income', value: 16192, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_income', value: 23297, fiscal_period: 'FY2024' },
        // These should NOT appear (not in predefined config)
        { normalized_metric: 'comprehensive_income_loss', value: 15000, fiscal_period: 'FY2024' },
        { normalized_metric: 'film_capitalization_costs', value: 8000, fiscal_period: 'FY2024' },
        { normalized_metric: 'tax_reconciliation_item', value: 500, fiscal_period: 'FY2024' },
      ];

      const rows = mapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
      );

      // Predefined metrics should be present
      expect(rows.find(r => r.normalizedMetric === 'revenue')).toBeDefined();
      expect(rows.find(r => r.normalizedMetric === 'net_income')).toBeDefined();
      expect(rows.find(r => r.normalizedMetric === 'operating_income')).toBeDefined();

      // Non-predefined metrics should NOT be present
      expect(rows.find(r => r.normalizedMetric === 'comprehensive_income_loss')).toBeUndefined();
      expect(rows.find(r => r.normalizedMetric === 'film_capitalization_costs')).toBeUndefined();
      expect(rows.find(r => r.normalizedMetric === 'tax_reconciliation_item')).toBeUndefined();
    });

    it('should include industry-specific metrics for media companies', () => {
      const rawMetrics = [
        { normalized_metric: 'programming_and_production', value: 50000, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation', value: 8729, fiscal_period: 'FY2024' },
        { normalized_metric: 'amortization', value: 6072, fiscal_period: 'FY2024' },
      ];

      const rows = mapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'media',
      );

      const programmingRow = rows.find(r => r.normalizedMetric === 'programming_and_production');
      expect(programmingRow).toBeDefined();
      expect(programmingRow?.displayName).toBe('Programming & Production Costs');

      // Media companies should have separate depreciation and amortization
      const depreciationRow = rows.find(r => r.normalizedMetric === 'depreciation');
      expect(depreciationRow).toBeDefined();
      expect(depreciationRow?.displayName).toBe('Depreciation');

      const amortizationRow = rows.find(r => r.normalizedMetric === 'amortization');
      expect(amortizationRow).toBeDefined();
      expect(amortizationRow?.displayName).toBe('Amortization');
    });

    it('should include industry-specific metrics for banks', () => {
      const rawMetrics = [
        { normalized_metric: 'net_interest_income', value: 30000, fiscal_period: 'FY2024' },
        { normalized_metric: 'provision_credit_losses', value: 5000, fiscal_period: 'FY2024' },
      ];

      const rows = mapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'bank',
      );

      const niiRow = rows.find(r => r.normalizedMetric === 'net_interest_income');
      expect(niiRow).toBeDefined();
      expect(niiRow?.displayName).toBe('Net Interest Income');
    });

    it('should not duplicate metrics that exist in both base and industry configs', () => {
      const rawMetrics = [
        { normalized_metric: 'revenue', value: 100000, fiscal_period: 'FY2024' },
      ];

      const rows = mapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'media',
      );

      const revenueRows = rows.filter(r => r.normalizedMetric === 'revenue');
      expect(revenueRows.length).toBe(1);
    });

    it('should include net_income_noncontrolling for SEC 10-K compliance', () => {
      const rawMetrics = [
        { normalized_metric: 'net_income', value: 16192, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_income_noncontrolling', value: 315, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_income_attributable', value: 15877, fiscal_period: 'FY2024' },
      ];

      const rows = mapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
      );

      // Should have the noncontrolling interests line item
      const noncontrollingRow = rows.find(r => r.normalizedMetric === 'net_income_noncontrolling');
      expect(noncontrollingRow).toBeDefined();
      expect(noncontrollingRow?.displayName).toBe('Less: Net Income Attributable to Noncontrolling Interests');
    });

    it('should include interest_expense for SEC 10-K compliance', () => {
      const rawMetrics = [
        { normalized_metric: 'interest_expense', value: 4134, fiscal_period: 'FY2024' },
        { normalized_metric: 'interest_income', value: 500, fiscal_period: 'FY2024' },
      ];

      const rows = mapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
      );

      const interestExpenseRow = rows.find(r => r.normalizedMetric === 'interest_expense');
      expect(interestExpenseRow).toBeDefined();
      expect(interestExpenseRow?.displayName).toBe('Interest Expense');
      expect(interestExpenseRow?.values.get('FY2024')).toBe(4134);
    });

    it('should use metric aliases when primary metric is missing for a period', () => {
      // Simulate CMCSA case: interest_expense for 2023, interest_expense_nonoperating for 2024
      const rawMetrics = [
        { normalized_metric: 'interest_expense', value: 4087, fiscal_period: 'FY2023' },
        { normalized_metric: 'interest_expense_nonoperating', value: 4134, fiscal_period: 'FY2024' },
      ];

      const rows = mapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024', 'FY2023'],
      );

      const interestExpenseRow = rows.find(r => r.normalizedMetric === 'interest_expense');
      expect(interestExpenseRow).toBeDefined();
      expect(interestExpenseRow?.displayName).toBe('Interest Expense');
      // Should get value from alias for 2024
      expect(interestExpenseRow?.values.get('FY2024')).toBe(4134);
      // Should get value from primary for 2023
      expect(interestExpenseRow?.values.get('FY2023')).toBe(4087);
    });

    it('should prefer primary metric over alias when both exist', () => {
      const rawMetrics = [
        { normalized_metric: 'interest_expense', value: 4000, fiscal_period: 'FY2024' },
        { normalized_metric: 'interest_expense_nonoperating', value: 4500, fiscal_period: 'FY2024' },
      ];

      const rows = mapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
      );

      const interestExpenseRow = rows.find(r => r.normalizedMetric === 'interest_expense');
      expect(interestExpenseRow).toBeDefined();
      // Should prefer primary metric value
      expect(interestExpenseRow?.values.get('FY2024')).toBe(4000);
    });

    it('should handle revenue aliases (net_sales)', () => {
      const rawMetrics = [
        { normalized_metric: 'net_sales', value: 123731, fiscal_period: 'FY2024' },
      ];

      const rows = mapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
      );

      const revenueRow = rows.find(r => r.normalizedMetric === 'revenue');
      expect(revenueRow).toBeDefined();
      expect(revenueRow?.displayName).toBe('Total Revenue');
      expect(revenueRow?.values.get('FY2024')).toBe(123731);
    });
  });

  describe('getStatementConfig', () => {
    it('should return income statement config', () => {
      const config = mapper.getStatementConfig(StatementType.INCOME_STATEMENT);
      expect(config.type).toBe(StatementType.INCOME_STATEMENT);
      expect(config.displayName).toBe('Income Statement');
      expect(config.worksheetName).toBe('Income Statement');
      expect(config.metricOrder.length).toBeGreaterThan(0);
    });

    it('should return balance sheet config', () => {
      const config = mapper.getStatementConfig(StatementType.BALANCE_SHEET);
      expect(config.type).toBe(StatementType.BALANCE_SHEET);
      expect(config.displayName).toBe('Balance Sheet');
      expect(config.worksheetName).toBe('Balance Sheet');
    });

    it('should return cash flow config', () => {
      const config = mapper.getStatementConfig(StatementType.CASH_FLOW);
      expect(config.type).toBe(StatementType.CASH_FLOW);
      expect(config.displayName).toBe('Cash Flow Statement');
      expect(config.worksheetName).toBe('Cash Flow');
    });
  });

  describe('industry metric definitions', () => {
    it('should have media income statement additions', () => {
      expect(StatementMapper.MEDIA_INCOME_STATEMENT_ADDITIONS.length).toBeGreaterThan(0);
      
      const programmingMetric = StatementMapper.MEDIA_INCOME_STATEMENT_ADDITIONS.find(
        m => m.normalizedMetric === 'programming_and_production'
      );
      expect(programmingMetric).toBeDefined();
      expect(programmingMetric?.displayName).toBe('Programming & Production Costs');
    });

    it('should have bank income statement additions', () => {
      expect(StatementMapper.BANK_INCOME_STATEMENT_ADDITIONS.length).toBeGreaterThan(0);
      
      const niiMetric = StatementMapper.BANK_INCOME_STATEMENT_ADDITIONS.find(
        m => m.normalizedMetric === 'net_interest_income'
      );
      expect(niiMetric).toBeDefined();
    });

    it('should have bank balance sheet additions', () => {
      expect(StatementMapper.BANK_BALANCE_SHEET_ADDITIONS.length).toBeGreaterThan(0);
      
      const loansMetric = StatementMapper.BANK_BALANCE_SHEET_ADDITIONS.find(
        m => m.normalizedMetric === 'loans_net'
      );
      expect(loansMetric).toBeDefined();
    });

    it('should have insurance income statement additions', () => {
      expect(StatementMapper.INSURANCE_INCOME_STATEMENT_ADDITIONS.length).toBeGreaterThan(0);
      
      const premiumsMetric = StatementMapper.INSURANCE_INCOME_STATEMENT_ADDITIONS.find(
        m => m.normalizedMetric === 'premiums_earned'
      );
      expect(premiumsMetric).toBeDefined();
    });

    it('should have REIT income statement additions', () => {
      expect(StatementMapper.REIT_INCOME_STATEMENT_ADDITIONS.length).toBeGreaterThan(0);
      
      const ffoMetric = StatementMapper.REIT_INCOME_STATEMENT_ADDITIONS.find(
        m => m.normalizedMetric === 'funds_from_operations'
      );
      expect(ffoMetric).toBeDefined();
    });

    it('should have utility income statement additions', () => {
      expect(StatementMapper.UTILITY_INCOME_STATEMENT_ADDITIONS.length).toBeGreaterThan(0);
      
      const electricMetric = StatementMapper.UTILITY_INCOME_STATEMENT_ADDITIONS.find(
        m => m.normalizedMetric === 'electric_revenue'
      );
      expect(electricMetric).toBeDefined();
    });

    it('should have telecom income statement additions', () => {
      expect(StatementMapper.TELECOM_INCOME_STATEMENT_ADDITIONS.length).toBeGreaterThan(0);
      
      const wirelessMetric = StatementMapper.TELECOM_INCOME_STATEMENT_ADDITIONS.find(
        m => m.normalizedMetric === 'wireless_revenue'
      );
      expect(wirelessMetric).toBeDefined();
    });
  });

  describe('hierarchical ordering', () => {
    describe('orderMetricsHierarchically', () => {
      it('should order children after their parents', () => {
        const metrics = [
          {
            displayName: 'Product Revenue',
            normalizedMetric: 'product_revenue',
            values: new Map([['FY2024', 50000]]),
            reportingUnits: new Map([['FY2024', 'millions']]),
            parentMetric: 'revenue',
          },
          {
            displayName: 'Total Revenue',
            normalizedMetric: 'revenue',
            values: new Map([['FY2024', 100000]]),
            reportingUnits: new Map([['FY2024', 'millions']]),
          },
          {
            displayName: 'Service Revenue',
            normalizedMetric: 'service_revenue',
            values: new Map([['FY2024', 50000]]),
            reportingUnits: new Map([['FY2024', 'millions']]),
            parentMetric: 'revenue',
          },
        ];

        const ordered = mapper.orderMetricsHierarchically(metrics);

        expect(ordered[0].normalizedMetric).toBe('revenue');
        expect(ordered[1].normalizedMetric).toBe('product_revenue');
        expect(ordered[2].normalizedMetric).toBe('service_revenue');
      });

      it('should set indent based on hierarchy depth', () => {
        const metrics = [
          {
            displayName: 'Raw Materials',
            normalizedMetric: 'raw_materials',
            values: new Map([['FY2024', 10000]]),
            reportingUnits: new Map([['FY2024', 'millions']]),
            parentMetric: 'inventory',
          },
          {
            displayName: 'Inventory',
            normalizedMetric: 'inventory',
            values: new Map([['FY2024', 30000]]),
            reportingUnits: new Map([['FY2024', 'millions']]),
            parentMetric: 'current_assets',
          },
          {
            displayName: 'Current Assets',
            normalizedMetric: 'current_assets',
            values: new Map([['FY2024', 100000]]),
            reportingUnits: new Map([['FY2024', 'millions']]),
          },
        ];

        const ordered = mapper.orderMetricsHierarchically(metrics);

        expect(ordered[0].normalizedMetric).toBe('current_assets');
        expect(ordered[0].indent).toBe(0);
        expect(ordered[1].normalizedMetric).toBe('inventory');
        expect(ordered[1].indent).toBe(1);
        expect(ordered[2].normalizedMetric).toBe('raw_materials');
        expect(ordered[2].indent).toBe(2);
      });

      it('should handle metrics without parents', () => {
        const metrics = [
          {
            displayName: 'Net Income',
            normalizedMetric: 'net_income',
            values: new Map([['FY2024', 20000]]),
            reportingUnits: new Map([['FY2024', 'millions']]),
          },
          {
            displayName: 'Total Revenue',
            normalizedMetric: 'revenue',
            values: new Map([['FY2024', 100000]]),
            reportingUnits: new Map([['FY2024', 'millions']]),
          },
        ];

        const ordered = mapper.orderMetricsHierarchically(metrics);

        expect(ordered.length).toBe(2);
        expect(ordered[0].normalizedMetric).toBe('net_income');
        expect(ordered[1].normalizedMetric).toBe('revenue');
      });

      it('should handle orphaned children (parent not in list)', () => {
        const metrics = [
          {
            displayName: 'Product Revenue',
            normalizedMetric: 'product_revenue',
            values: new Map([['FY2024', 50000]]),
            reportingUnits: new Map([['FY2024', 'millions']]),
            parentMetric: 'revenue',
          },
        ];

        const ordered = mapper.orderMetricsHierarchically(metrics);

        expect(ordered.length).toBe(1);
        expect(ordered[0].normalizedMetric).toBe('product_revenue');
      });
    });

    describe('detectParentMetric', () => {
      it('should detect income statement hierarchy', () => {
        expect(mapper.detectParentMetric('product_revenue', StatementType.INCOME_STATEMENT)).toBe('revenue');
        expect(mapper.detectParentMetric('service_revenue', StatementType.INCOME_STATEMENT)).toBe('revenue');
        expect(mapper.detectParentMetric('research_development', StatementType.INCOME_STATEMENT)).toBe('operating_expenses');
        expect(mapper.detectParentMetric('sg_and_a', StatementType.INCOME_STATEMENT)).toBe('operating_expenses');
      });

      it('should detect balance sheet hierarchy', () => {
        expect(mapper.detectParentMetric('cash_and_equivalents', StatementType.BALANCE_SHEET)).toBe('current_assets');
        expect(mapper.detectParentMetric('inventory', StatementType.BALANCE_SHEET)).toBe('current_assets');
        expect(mapper.detectParentMetric('raw_materials', StatementType.BALANCE_SHEET)).toBe('inventory');
        expect(mapper.detectParentMetric('accounts_payable', StatementType.BALANCE_SHEET)).toBe('current_liabilities');
        expect(mapper.detectParentMetric('long_term_debt', StatementType.BALANCE_SHEET)).toBe('total_non_current_liabilities');
      });

      it('should detect cash flow hierarchy', () => {
        expect(mapper.detectParentMetric('depreciation_amortization', StatementType.CASH_FLOW)).toBe('operating_cash_flow');
        expect(mapper.detectParentMetric('capital_expenditures', StatementType.CASH_FLOW)).toBe('investing_cash_flow');
        expect(mapper.detectParentMetric('dividends_paid', StatementType.CASH_FLOW)).toBe('financing_cash_flow');
      });

      it('should detect bank-specific hierarchy', () => {
        expect(mapper.detectParentMetric('interest_income_loans', StatementType.INCOME_STATEMENT)).toBe('net_interest_income');
        expect(mapper.detectParentMetric('trading_revenue', StatementType.INCOME_STATEMENT)).toBe('noninterest_income');
        expect(mapper.detectParentMetric('commercial_loans', StatementType.BALANCE_SHEET)).toBe('total_loans');
        expect(mapper.detectParentMetric('demand_deposits', StatementType.BALANCE_SHEET)).toBe('deposits');
      });

      it('should return undefined for unknown metrics', () => {
        expect(mapper.detectParentMetric('unknown_metric', StatementType.INCOME_STATEMENT)).toBeUndefined();
        expect(mapper.detectParentMetric('custom_metric_xyz', StatementType.BALANCE_SHEET)).toBeUndefined();
      });
    });

    describe('mapMetricsToStatementHierarchical', () => {
      it('should apply hierarchy from raw metrics', () => {
        const rawMetrics = [
          { normalized_metric: 'revenue', value: 100000, fiscal_period: 'FY2024' },
          { normalized_metric: 'product_revenue', value: 60000, fiscal_period: 'FY2024', parent_metric: 'revenue' },
          { normalized_metric: 'service_revenue', value: 40000, fiscal_period: 'FY2024', parent_metric: 'revenue' },
        ];

        const rows = mapper.mapMetricsToStatementHierarchical(
          rawMetrics,
          StatementType.INCOME_STATEMENT,
          ['FY2024'],
        );

        const revenueRow = rows.find(r => r.normalizedMetric === 'revenue');
        const productRow = rows.find(r => r.normalizedMetric === 'product_revenue');
        const serviceRow = rows.find(r => r.normalizedMetric === 'service_revenue');

        expect(revenueRow).toBeDefined();
        expect(productRow).toBeDefined();
        expect(serviceRow).toBeDefined();

        expect(productRow?.parentMetric).toBe('revenue');
        expect(serviceRow?.parentMetric).toBe('revenue');
      });

      it('should detect hierarchy when not provided in raw metrics', () => {
        const rawMetrics = [
          { normalized_metric: 'current_assets', value: 100000, fiscal_period: 'FY2024' },
          { normalized_metric: 'cash_and_equivalents', value: 50000, fiscal_period: 'FY2024' },
          { normalized_metric: 'inventory', value: 30000, fiscal_period: 'FY2024' },
        ];

        const rows = mapper.mapMetricsToStatementHierarchical(
          rawMetrics,
          StatementType.BALANCE_SHEET,
          ['FY2024'],
        );

        const cashRow = rows.find(r => r.normalizedMetric === 'cash_and_equivalents' || r.normalizedMetric === 'cash');
        const inventoryRow = rows.find(r => r.normalizedMetric === 'inventory' || r.normalizedMetric === 'inventories');

        if (cashRow) {
          expect(cashRow.parentMetric).toBe('current_assets');
        }
        if (inventoryRow) {
          expect(inventoryRow.parentMetric).toBe('current_assets');
        }
      });
    });
  });
});
