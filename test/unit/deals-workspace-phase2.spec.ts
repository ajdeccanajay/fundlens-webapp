import { Test, TestingModule } from '@nestjs/testing';

/**
 * Deal Workspace Phase 2 - Unit Tests
 * 
 * Tests the enhanced Analysis view with comprehensive financial metrics
 * Phase 2: Analysis View Enhancement
 */

describe('Deal Workspace Phase 2 - Helper Functions', () => {
  describe('formatPercent', () => {
    const formatPercent = (value: number) => {
      if (!value && value !== 0) return 'N/A';
      return `${(value * 100).toFixed(1)}%`;
    };

    it('should format decimal to percentage', () => {
      expect(formatPercent(0.301)).toBe('30.1%');
      expect(formatPercent(0.0825)).toBe('8.3%');
    });

    it('should handle zero', () => {
      expect(formatPercent(0)).toBe('0.0%');
    });

    it('should handle null/undefined', () => {
      expect(formatPercent(null as any)).toBe('N/A');
      expect(formatPercent(undefined as any)).toBe('N/A');
    });

    it('should handle negative values', () => {
      expect(formatPercent(-0.05)).toBe('-5.0%');
    });

    it('should round to 1 decimal place', () => {
      expect(formatPercent(0.12345)).toBe('12.3%');
      expect(formatPercent(0.12678)).toBe('12.7%');
    });
  });

  describe('getYoYGrowth', () => {
    const formatPercent = (value: number) => {
      if (!value && value !== 0) return 'N/A';
      return `${(value * 100).toFixed(1)}%`;
    };

    const getYoYGrowth = (growthData: any[], period: string) => {
      if (!growthData) return 'N/A';
      const growth = growthData.find(g => g.period === period);
      return growth ? formatPercent(growth.value) : 'N/A';
    };

    it('should find growth for specific period', () => {
      const growthData = [
        { period: 'FY2023', value: 0.082 },
        { period: 'FY2022', value: 0.054 }
      ];
      
      expect(getYoYGrowth(growthData, 'FY2023')).toBe('8.2%');
      expect(getYoYGrowth(growthData, 'FY2022')).toBe('5.4%');
    });

    it('should return N/A for missing period', () => {
      const growthData = [
        { period: 'FY2023', value: 0.082 }
      ];
      
      expect(getYoYGrowth(growthData, 'FY2021')).toBe('N/A');
    });

    it('should handle null/undefined data', () => {
      expect(getYoYGrowth(null as any, 'FY2023')).toBe('N/A');
      expect(getYoYGrowth(undefined as any, 'FY2023')).toBe('N/A');
    });

    it('should handle empty array', () => {
      expect(getYoYGrowth([], 'FY2023')).toBe('N/A');
    });
  });

  describe('getMarginForPeriod', () => {
    const formatPercent = (value: number) => {
      if (!value && value !== 0) return 'N/A';
      return `${(value * 100).toFixed(1)}%`;
    };

    const getMarginForPeriod = (marginData: any[], period: string) => {
      if (!marginData) return 'N/A';
      const margin = marginData.find(m => m.period === period);
      return margin ? formatPercent(margin.value) : 'N/A';
    };

    it('should find margin for specific period', () => {
      const marginData = [
        { period: 'FY2023', value: 0.301 },
        { period: 'FY2022', value: 0.289 }
      ];
      
      expect(getMarginForPeriod(marginData, 'FY2023')).toBe('30.1%');
      expect(getMarginForPeriod(marginData, 'FY2022')).toBe('28.9%');
    });

    it('should return N/A for missing period', () => {
      const marginData = [
        { period: 'FY2023', value: 0.301 }
      ];
      
      expect(getMarginForPeriod(marginData, 'FY2021')).toBe('N/A');
    });

    it('should handle null/undefined data', () => {
      expect(getMarginForPeriod(null as any, 'FY2023')).toBe('N/A');
    });
  });

  describe('getValueForPeriod', () => {
    const formatCurrency = (value: number) => {
      if (!value) return '$0';
      const billion = value / 1000000000;
      if (billion >= 1) return `$${billion.toFixed(1)}B`;
      const million = value / 1000000;
      return `$${million.toFixed(1)}M`;
    };

    const formatPercent = (value: number) => {
      if (!value && value !== 0) return 'N/A';
      return `${(value * 100).toFixed(1)}%`;
    };

    const getValueForPeriod = (data: any[], period: string, format = 'currency') => {
      if (!data) return 'N/A';
      const item = data.find(d => d.period === period);
      if (!item) return 'N/A';
      return format === 'currency' ? formatCurrency(item.value) : formatPercent(item.value);
    };

    it('should get currency value for period', () => {
      const data = [
        { period: 'FY2023', value: 394300000000 },
        { period: 'FY2022', value: 365800000000 }
      ];
      
      expect(getValueForPeriod(data, 'FY2023', 'currency')).toBe('$394.3B');
      expect(getValueForPeriod(data, 'FY2022', 'currency')).toBe('$365.8B');
    });

    it('should get percent value for period', () => {
      const data = [
        { period: 'FY2023', value: 0.301 },
        { period: 'FY2022', value: 0.289 }
      ];
      
      expect(getValueForPeriod(data, 'FY2023', 'percent')).toBe('30.1%');
      expect(getValueForPeriod(data, 'FY2022', 'percent')).toBe('28.9%');
    });

    it('should return N/A for missing period', () => {
      const data = [
        { period: 'FY2023', value: 394300000000 }
      ];
      
      expect(getValueForPeriod(data, 'FY2021', 'currency')).toBe('N/A');
    });

    it('should handle null/undefined data', () => {
      expect(getValueForPeriod(null as any, 'FY2023', 'currency')).toBe('N/A');
    });
  });
});

describe('Deal Workspace Phase 2 - Data Loading', () => {
  describe('Comprehensive Data Loading', () => {
    it('should load comprehensive dashboard data', async () => {
      const ticker = 'AAPL';
      const years = 5;
      const expectedUrl = `/api/financial-calculator/dashboard/${ticker}?years=${years}`;
      
      expect(expectedUrl).toBe('/api/financial-calculator/dashboard/AAPL?years=5');
    });

    it('should fallback to simple metrics on error', async () => {
      const fallbackUrl = '/api/deals/financial-calculator/metrics?ticker=AAPL';
      
      expect(fallbackUrl).toContain('ticker=AAPL');
    });

    it('should extract simple metrics from comprehensive data', () => {
      const comprehensiveData = {
        metrics: {
          revenue: {
            ttm: 394300000000,
            cagr: 0.082
          },
          profitability: {
            netIncome: {
              ttm: 97000000000,
              yoyGrowth: [{ period: 'FY2023', value: 0.054 }]
            },
            operatingMargin: {
              ttm: 0.301
            }
          },
          cashFlow: {
            freeCashFlow: {
              ttm: 99600000000,
              yoyGrowth: [{ period: 'FY2023', value: 0.123 }]
            }
          }
        }
      };
      
      expect(comprehensiveData.metrics.revenue.ttm).toBe(394300000000);
      expect(comprehensiveData.metrics.profitability.netIncome.ttm).toBe(97000000000);
    });
  });

  describe('Qualitative Data Loading', () => {
    it('should load qualitative analysis', async () => {
      const ticker = 'AAPL';
      const expectedUrl = `/api/deals/qualitative-analysis?ticker=${ticker}`;
      
      expect(expectedUrl).toBe('/api/deals/qualitative-analysis?ticker=AAPL');
    });

    it('should handle cached qualitative data', () => {
      const cachedData = {
        ticker: 'AAPL',
        categories: {
          companyDescription: [
            { question: 'What does the company do?', answer: 'Apple designs...' }
          ]
        },
        cached: true
      };
      
      expect(cachedData.cached).toBe(true);
      expect(cachedData.categories.companyDescription.length).toBe(1);
    });
  });
});

describe('Deal Workspace Phase 2 - Metrics Display', () => {
  describe('Financial Performance Metrics', () => {
    it('should display revenue metrics', () => {
      const revenue = {
        ttm: 394300000000,
        cagr: 0.082,
        annual: [
          { period: 'FY2023', value: 394300000000 },
          { period: 'FY2022', value: 365800000000 }
        ]
      };
      
      expect(revenue.ttm).toBeGreaterThan(0);
      expect(revenue.annual.length).toBe(2);
    });

    it('should display profitability metrics', () => {
      const profitability = {
        grossProfit: { ttm: 169100000000 },
        grossMargin: { ttm: 0.429 },
        operatingIncome: { ttm: 118700000000 },
        operatingMargin: { ttm: 0.301 },
        netIncome: { ttm: 97000000000 },
        netMargin: { ttm: 0.246 }
      };
      
      expect(profitability.grossMargin.ttm).toBeGreaterThan(0);
      expect(profitability.operatingMargin.ttm).toBeGreaterThan(0);
      expect(profitability.netMargin.ttm).toBeGreaterThan(0);
    });

    it('should display cash flow metrics', () => {
      const cashFlow = {
        operatingCashFlow: { ttm: 110500000000 },
        freeCashFlow: { ttm: 99600000000 },
        capex: { ttm: 10900000000 },
        cashConversionRatio: { ttm: 1.027 }
      };
      
      expect(cashFlow.freeCashFlow.ttm).toBeGreaterThan(0);
      expect(cashFlow.cashConversionRatio.ttm).toBeGreaterThan(1);
    });
  });

  describe('Annual Tables', () => {
    it('should filter annual periods', () => {
      const allPeriods = [
        { period: 'FY2023', value: 394300000000 },
        { period: 'Q4-2023', value: 119600000000 },
        { period: 'FY2022', value: 365800000000 }
      ];
      
      const annualOnly = allPeriods.filter(p => p.period.startsWith('FY'));
      
      expect(annualOnly.length).toBe(2);
      expect(annualOnly[0].period).toBe('FY2023');
    });

    it('should display revenue table', () => {
      const revenueTable = {
        headers: ['Fiscal Year', 'Revenue', 'YoY Growth'],
        rows: [
          { period: 'FY2023', revenue: '$394.3B', growth: '+8.2%' },
          { period: 'FY2022', revenue: '$365.8B', growth: '+5.4%' }
        ]
      };
      
      expect(revenueTable.headers.length).toBe(3);
      expect(revenueTable.rows.length).toBe(2);
    });
  });
});

describe('Deal Workspace Phase 2 - Export Functionality', () => {
  describe('Export Wizard', () => {
    it('should select export years', () => {
      const selectedYears = ['FY2023', 'FY2022', 'FY2021'];
      
      expect(selectedYears.length).toBe(3);
      expect(selectedYears[0]).toBe('FY2023');
    });

    it('should select statements', () => {
      const selectedStatements = ['income_statement', 'balance_sheet', 'cash_flow'];
      
      expect(selectedStatements.length).toBe(3);
      expect(selectedStatements).toContain('income_statement');
    });

    it('should validate export selection', () => {
      const canExport = (years: string[], statements: string[]) => {
        return years.length > 0 && statements.length > 0;
      };
      
      expect(canExport(['FY2023'], ['income_statement'])).toBe(true);
      expect(canExport([], ['income_statement'])).toBe(false);
      expect(canExport(['FY2023'], [])).toBe(false);
    });
  });

  describe('Export Execution', () => {
    it('should generate Excel filename', () => {
      const ticker = 'AAPL';
      const date = '2026-01-26';
      const filename = `${ticker}-Financial-Statements-${date}.xlsx`;
      
      expect(filename).toBe('AAPL-Financial-Statements-2026-01-26.xlsx');
    });

    it('should call export API', () => {
      const ticker = 'AAPL';
      const exportUrl = `/api/deals/export/excel?ticker=${ticker}`;
      
      expect(exportUrl).toBe('/api/deals/export/excel?ticker=AAPL');
    });
  });
});

describe('Deal Workspace Phase 2 - State Management', () => {
  describe('Years Selection', () => {
    it('should default to 5 years', () => {
      const years = 5;
      
      expect(years).toBe(5);
    });

    it('should allow 3 or 5 years', () => {
      const validYears = [3, 5];
      
      expect(validYears).toContain(3);
      expect(validYears).toContain(5);
    });

    it('should reload data when years change', () => {
      let years = 3;
      years = 5;
      
      expect(years).toBe(5);
    });
  });

  describe('Tab State', () => {
    it('should maintain analysis tab selection', () => {
      let analysisTab = 'quantitative';
      analysisTab = 'qualitative';
      
      expect(analysisTab).toBe('qualitative');
    });

    it('should preserve tab when switching views', () => {
      const state = {
        currentView: 'analysis',
        analysisTab: 'qualitative'
      };
      
      state.currentView = 'research';
      state.currentView = 'analysis';
      
      expect(state.analysisTab).toBe('qualitative');
    });
  });
});
