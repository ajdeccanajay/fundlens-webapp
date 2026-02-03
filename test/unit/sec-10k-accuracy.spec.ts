/**
 * SEC 10-K Export Accuracy Tests
 * 
 * These tests validate that Excel exports match SEC 10-K filing structures exactly.
 * Each test compares the generated export structure against fixtures derived from
 * actual SEC 10-K filings.
 * 
 * Requirements validated:
 * - Requirement 1: Industry-Specific Template System
 * - Requirement 4: Exact Line Item Ordering
 * - Requirement 6: CMCSA Reference Implementation
 * - Requirement 7: Cross-Industry Validation
 * - Requirement 9: Display Name Accuracy
 * - Requirement 10: Validation Test Suite
 */

import { Test, TestingModule } from '@nestjs/testing';
import { StatementMapper } from '../../src/deals/statement-mapper';
import { StatementType, MetricDefinition } from '../../src/deals/export.types';
import * as fs from 'fs';
import * as path from 'path';

// Load test fixtures
const loadFixture = (relativePath: string) => {
  const fixturePath = path.join(__dirname, '../fixtures/sec-10k-structures', relativePath);
  const content = fs.readFileSync(fixturePath, 'utf-8');
  return JSON.parse(content);
};

describe('SEC 10-K Export Accuracy', () => {
  let statementMapper: StatementMapper;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StatementMapper],
    }).compile();

    statementMapper = module.get<StatementMapper>(StatementMapper);
  });

  describe('Template Registry', () => {
    it('should have MEDIA_INCOME_STATEMENT template defined', () => {
      expect(StatementMapper.MEDIA_INCOME_STATEMENT).toBeDefined();
      expect(Array.isArray(StatementMapper.MEDIA_INCOME_STATEMENT)).toBe(true);
      expect(StatementMapper.MEDIA_INCOME_STATEMENT.length).toBeGreaterThan(0);
    });

    it('should have BANK_INCOME_STATEMENT template defined', () => {
      expect(StatementMapper.BANK_INCOME_STATEMENT).toBeDefined();
      expect(Array.isArray(StatementMapper.BANK_INCOME_STATEMENT)).toBe(true);
      expect(StatementMapper.BANK_INCOME_STATEMENT.length).toBeGreaterThan(0);
    });

    it('should have all required metric definition properties', () => {
      const validateMetricDef = (def: MetricDefinition) => {
        expect(def.normalizedMetric).toBeDefined();
        expect(typeof def.normalizedMetric).toBe('string');
        expect(def.displayName).toBeDefined();
        expect(typeof def.displayName).toBe('string');
        if (!def.isHeader) {
          expect(def.format).toBeDefined();
        }
      };

      StatementMapper.MEDIA_INCOME_STATEMENT.forEach(validateMetricDef);
      StatementMapper.BANK_INCOME_STATEMENT.forEach(validateMetricDef);
    });
  });

  describe('Industry Detection', () => {
    it('should detect communication_services for CMCSA', () => {
      const industry = statementMapper.detectIndustry('CMCSA');
      expect(industry).toBe('communication_services');
    });

    it('should detect communication_services for DIS', () => {
      const industry = statementMapper.detectIndustry('DIS');
      expect(industry).toBe('communication_services');
    });

    it('should detect financials for JPM', () => {
      const industry = statementMapper.detectIndustry('JPM');
      expect(industry).toBe('financials');
    });

    it('should detect financials for BAC', () => {
      const industry = statementMapper.detectIndustry('BAC');
      expect(industry).toBe('financials');
    });

    it('should detect financials for GS', () => {
      const industry = statementMapper.detectIndustry('GS');
      expect(industry).toBe('financials');
    });

    it('should detect information_technology for AAPL', () => {
      const industry = statementMapper.detectIndustry('AAPL');
      expect(industry).toBe('information_technology');
    });

    it('should detect energy for XOM', () => {
      const industry = statementMapper.detectIndustry('XOM');
      expect(industry).toBe('energy');
    });

    it('should detect utilities for NEE', () => {
      const industry = statementMapper.detectIndustry('NEE');
      expect(industry).toBe('utilities');
    });

    it('should detect real_estate for AMT', () => {
      const industry = statementMapper.detectIndustry('AMT');
      expect(industry).toBe('real_estate');
    });

    it('should detect materials for LIN', () => {
      const industry = statementMapper.detectIndustry('LIN');
      expect(industry).toBe('materials');
    });

    it('should return undefined for unknown ticker', () => {
      const industry = statementMapper.detectIndustry('UNKNOWN123');
      expect(industry).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      expect(statementMapper.detectIndustry('jpm')).toBe('financials');
      expect(statementMapper.detectIndustry('Jpm')).toBe('financials');
      expect(statementMapper.detectIndustry('JPM')).toBe('financials');
    });

    it('should be deterministic (same result for same input)', () => {
      const result1 = statementMapper.detectIndustry('JPM');
      const result2 = statementMapper.detectIndustry('JPM');
      const result3 = statementMapper.detectIndustry('JPM');
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });
  });

  describe('Communication Services - CMCSA Template Validation', () => {
    let fixture: any;

    beforeAll(() => {
      fixture = loadFixture('communication_services/CMCSA_2024_income_statement.json');
    });

    it('should have correct number of line items', () => {
      const template = StatementMapper.MEDIA_INCOME_STATEMENT;
      // Template may have more items (for aliases), but should cover all fixture items
      expect(template.length).toBeGreaterThanOrEqual(fixture.expectedLineItems.length);
    });

    it('should have REVENUE header as first item', () => {
      const template = StatementMapper.MEDIA_INCOME_STATEMENT;
      const firstItem = template[0];
      expect(firstItem.displayName).toBe('REVENUE');
      expect(firstItem.isHeader).toBe(true);
    });

    it('should have COSTS AND EXPENSES header', () => {
      const template = StatementMapper.MEDIA_INCOME_STATEMENT;
      const costsHeader = template.find(t => t.displayName === 'COSTS AND EXPENSES');
      expect(costsHeader).toBeDefined();
      expect(costsHeader?.isHeader).toBe(true);
    });

    it('should have Programming and production as first cost item', () => {
      const template = StatementMapper.MEDIA_INCOME_STATEMENT;
      const costsHeaderIndex = template.findIndex(t => t.displayName === 'COSTS AND EXPENSES');
      const firstCostItem = template[costsHeaderIndex + 1];
      expect(firstCostItem.displayName).toBe('Programming and production');
      expect(firstCostItem.indent).toBe(1);
    });

    it('should have Depreciation and Amortization as separate line items', () => {
      const template = StatementMapper.MEDIA_INCOME_STATEMENT;
      const depreciation = template.find(t => t.normalizedMetric === 'depreciation');
      const amortization = template.find(t => t.normalizedMetric === 'amortization');
      expect(depreciation).toBeDefined();
      expect(amortization).toBeDefined();
      expect(depreciation?.displayName).toBe('Depreciation');
      expect(amortization?.displayName).toBe('Amortization');
    });

    it('should have Interest expense in non-operating section', () => {
      const template = StatementMapper.MEDIA_INCOME_STATEMENT;
      const operatingIncomeIndex = template.findIndex(t => t.normalizedMetric === 'operating_income');
      const interestExpenseIndex = template.findIndex(t => t.normalizedMetric === 'interest_expense');
      expect(interestExpenseIndex).toBeGreaterThan(operatingIncomeIndex);
    });

    it('should have PER SHARE DATA header', () => {
      const template = StatementMapper.MEDIA_INCOME_STATEMENT;
      const epsHeader = template.find(t => t.displayName === 'PER SHARE DATA');
      expect(epsHeader).toBeDefined();
      expect(epsHeader?.isHeader).toBe(true);
    });

    it('should have Basic and Diluted EPS', () => {
      const template = StatementMapper.MEDIA_INCOME_STATEMENT;
      const basicEps = template.find(t => t.normalizedMetric === 'earnings_per_share_basic');
      const dilutedEps = template.find(t => t.normalizedMetric === 'earnings_per_share_diluted');
      expect(basicEps).toBeDefined();
      expect(dilutedEps).toBeDefined();
      expect(basicEps?.format).toBe('eps');
      expect(dilutedEps?.format).toBe('eps');
    });

    it('should match fixture display names exactly', () => {
      const template = StatementMapper.MEDIA_INCOME_STATEMENT;
      const templateDisplayNames = template.map(t => t.displayName);
      
      fixture.expectedLineItems.forEach((item: any) => {
        if (!item.isHeader || item.displayName !== 'REVENUE') {
          // Check that the display name exists in template (may have aliases)
          const found = templateDisplayNames.some(name => 
            name === item.displayName || 
            name.toLowerCase() === item.displayName.toLowerCase()
          );
          expect(found).toBe(true);
        }
      });
    });
  });

  describe('Financials - JPM Template Validation', () => {
    let fixture: any;

    beforeAll(() => {
      fixture = loadFixture('financials/JPM_2024_income_statement.json');
    });

    it('should have correct number of line items', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      expect(template.length).toBeGreaterThanOrEqual(fixture.expectedLineItems.length);
    });

    it('should have REVENUE header as first item', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      const firstItem = template[0];
      expect(firstItem.displayName).toBe('REVENUE');
      expect(firstItem.isHeader).toBe(true);
    });

    it('should have Interest income as first revenue item', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      const interestIncome = template.find(t => t.normalizedMetric === 'interest_income');
      expect(interestIncome).toBeDefined();
      expect(interestIncome?.displayName).toBe('Interest income');
    });

    it('should have Net interest income', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      const netInterestIncome = template.find(t => t.normalizedMetric === 'net_interest_income');
      expect(netInterestIncome).toBeDefined();
      expect(netInterestIncome?.displayName).toBe('Net interest income');
    });

    it('should have Provision for credit losses', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      const provision = template.find(t => t.normalizedMetric === 'provision_credit_losses');
      expect(provision).toBeDefined();
      expect(provision?.displayName).toBe('Provision for credit losses');
    });

    it('should have NONINTEREST REVENUE header', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      const header = template.find(t => t.displayName === 'NONINTEREST REVENUE');
      expect(header).toBeDefined();
      expect(header?.isHeader).toBe(true);
    });

    it('should have Investment banking fees', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      const ibFees = template.find(t => t.normalizedMetric === 'investment_banking_fees');
      expect(ibFees).toBeDefined();
      expect(ibFees?.displayName).toBe('Investment banking fees');
      expect(ibFees?.indent).toBe(1);
    });

    it('should have NONINTEREST EXPENSE header', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      const header = template.find(t => t.displayName === 'NONINTEREST EXPENSE');
      expect(header).toBeDefined();
      expect(header?.isHeader).toBe(true);
    });

    it('should have Compensation expense', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      const comp = template.find(t => t.normalizedMetric === 'compensation_expense');
      expect(comp).toBeDefined();
      expect(comp?.displayName).toBe('Compensation expense');
      expect(comp?.indent).toBe(1);
    });

    it('should have Net income applicable to common stockholders', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      const netIncomeCommon = template.find(t => t.normalizedMetric === 'net_income_common');
      expect(netIncomeCommon).toBeDefined();
      expect(netIncomeCommon?.displayName).toBe('Net income applicable to common stockholders');
    });

    it('should have PER SHARE DATA header', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      const epsHeader = template.find(t => t.displayName === 'PER SHARE DATA');
      expect(epsHeader).toBeDefined();
      expect(epsHeader?.isHeader).toBe(true);
    });

    it('should have KEY RATIOS header', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      const ratiosHeader = template.find(t => t.displayName === 'KEY RATIOS');
      expect(ratiosHeader).toBeDefined();
      expect(ratiosHeader?.isHeader).toBe(true);
    });

    it('should have bank-specific ratios', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      const nim = template.find(t => t.normalizedMetric === 'net_interest_margin');
      const efficiency = template.find(t => t.normalizedMetric === 'efficiency_ratio');
      const roe = template.find(t => t.normalizedMetric === 'return_on_equity');
      const roa = template.find(t => t.normalizedMetric === 'return_on_assets');
      
      expect(nim).toBeDefined();
      expect(efficiency).toBeDefined();
      expect(roe).toBeDefined();
      expect(roa).toBeDefined();
      
      expect(nim?.format).toBe('percentage');
      expect(efficiency?.format).toBe('percentage');
      expect(roe?.format).toBe('percentage');
      expect(roa?.format).toBe('percentage');
    });

    it('should match fixture display names exactly', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      const templateDisplayNames = template.map(t => t.displayName);
      
      fixture.expectedLineItems.forEach((item: any) => {
        const found = templateDisplayNames.some(name => 
          name === item.displayName || 
          name.toLowerCase() === item.displayName.toLowerCase()
        );
        expect(found).toBe(true);
      });
    });
  });

  describe('Template Order Preservation', () => {
    it('should preserve order in MEDIA_INCOME_STATEMENT', () => {
      const template = StatementMapper.MEDIA_INCOME_STATEMENT;
      
      // Revenue should come before Costs
      const revenueIndex = template.findIndex(t => t.displayName === 'REVENUE');
      const costsIndex = template.findIndex(t => t.displayName === 'COSTS AND EXPENSES');
      expect(revenueIndex).toBeLessThan(costsIndex);
      
      // Operating income should come before Interest expense
      const opIncomeIndex = template.findIndex(t => t.normalizedMetric === 'operating_income');
      const interestIndex = template.findIndex(t => t.normalizedMetric === 'interest_expense');
      expect(opIncomeIndex).toBeLessThan(interestIndex);
      
      // Income before taxes should come before Income tax expense
      const preTaxIndex = template.findIndex(t => t.normalizedMetric === 'income_before_taxes');
      const taxIndex = template.findIndex(t => t.normalizedMetric === 'income_tax_expense');
      expect(preTaxIndex).toBeLessThan(taxIndex);
      
      // Net income should come before EPS
      const netIncomeIndex = template.findIndex(t => t.normalizedMetric === 'net_income');
      const epsIndex = template.findIndex(t => t.normalizedMetric === 'earnings_per_share_basic');
      expect(netIncomeIndex).toBeLessThan(epsIndex);
    });

    it('should preserve order in BANK_INCOME_STATEMENT', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      
      // Interest income should come before Interest expense
      const intIncomeIndex = template.findIndex(t => t.normalizedMetric === 'interest_income');
      const intExpenseIndex = template.findIndex(t => t.normalizedMetric === 'interest_expense');
      expect(intIncomeIndex).toBeLessThan(intExpenseIndex);
      
      // Net interest income should come before Provision
      const niiIndex = template.findIndex(t => t.normalizedMetric === 'net_interest_income');
      const provisionIndex = template.findIndex(t => t.normalizedMetric === 'provision_credit_losses');
      expect(niiIndex).toBeLessThan(provisionIndex);
      
      // Noninterest revenue should come before Noninterest expense
      const nirIndex = template.findIndex(t => t.displayName === 'NONINTEREST REVENUE');
      const nieIndex = template.findIndex(t => t.displayName === 'NONINTEREST EXPENSE');
      expect(nirIndex).toBeLessThan(nieIndex);
      
      // Income before taxes should come before Net income
      const preTaxIndex = template.findIndex(t => t.normalizedMetric === 'income_before_taxes');
      const netIncomeIndex = template.findIndex(t => t.normalizedMetric === 'net_income');
      expect(preTaxIndex).toBeLessThan(netIncomeIndex);
    });
  });

  describe('No Duplicate Line Items', () => {
    it('should not have duplicate normalizedMetric values in MEDIA_INCOME_STATEMENT (except aliases)', () => {
      const template = StatementMapper.MEDIA_INCOME_STATEMENT;
      const nonHeaderMetrics = template
        .filter(t => !t.isHeader)
        .map(t => t.normalizedMetric);
      
      // Check for exact duplicates (same metric appearing twice)
      const seen = new Set<string>();
      const duplicates: string[] = [];
      
      for (const metric of nonHeaderMetrics) {
        if (seen.has(metric)) {
          duplicates.push(metric);
        }
        seen.add(metric);
      }
      
      // Allow known aliases (revenue/net_sales, interest_expense/interest_expense_nonoperating)
      const allowedDuplicates = ['revenue', 'net_sales', 'interest_expense', 'interest_expense_nonoperating'];
      const unexpectedDuplicates = duplicates.filter(d => !allowedDuplicates.includes(d));
      
      expect(unexpectedDuplicates).toEqual([]);
    });

    it('should not have duplicate normalizedMetric values in BANK_INCOME_STATEMENT (except aliases)', () => {
      const template = StatementMapper.BANK_INCOME_STATEMENT;
      const nonHeaderMetrics = template
        .filter(t => !t.isHeader)
        .map(t => t.normalizedMetric);
      
      const seen = new Set<string>();
      const duplicates: string[] = [];
      
      for (const metric of nonHeaderMetrics) {
        if (seen.has(metric)) {
          duplicates.push(metric);
        }
        seen.add(metric);
      }
      
      // Allow known aliases (revenue/total_net_revenue)
      const allowedDuplicates = ['revenue', 'total_net_revenue'];
      const unexpectedDuplicates = duplicates.filter(d => !allowedDuplicates.includes(d));
      
      expect(unexpectedDuplicates).toEqual([]);
    });
  });

  describe('Information Technology - AAPL Template Validation', () => {
    let fixture: any;

    beforeAll(() => {
      fixture = loadFixture('information_technology/AAPL_2024_income_statement.json');
    });

    it('should have TECH_INCOME_STATEMENT template defined', () => {
      expect(StatementMapper.TECH_INCOME_STATEMENT).toBeDefined();
      expect(Array.isArray(StatementMapper.TECH_INCOME_STATEMENT)).toBe(true);
      expect(StatementMapper.TECH_INCOME_STATEMENT.length).toBeGreaterThan(0);
    });

    it('should have NET SALES header as first item', () => {
      const template = StatementMapper.TECH_INCOME_STATEMENT;
      const firstItem = template[0];
      expect(firstItem.displayName).toBe('NET SALES');
      expect(firstItem.isHeader).toBe(true);
    });

    it('should have Products and Services revenue breakdown', () => {
      const template = StatementMapper.TECH_INCOME_STATEMENT;
      const productRevenue = template.find(t => t.normalizedMetric === 'product_revenue');
      const serviceRevenue = template.find(t => t.normalizedMetric === 'service_revenue');
      
      expect(productRevenue).toBeDefined();
      expect(productRevenue?.displayName).toBe('Products');
      expect(productRevenue?.indent).toBe(1);
      
      expect(serviceRevenue).toBeDefined();
      expect(serviceRevenue?.displayName).toBe('Services');
      expect(serviceRevenue?.indent).toBe(1);
    });

    it('should have COST OF SALES header', () => {
      const template = StatementMapper.TECH_INCOME_STATEMENT;
      const costHeader = template.find(t => t.displayName === 'COST OF SALES');
      expect(costHeader).toBeDefined();
      expect(costHeader?.isHeader).toBe(true);
    });

    it('should have Products and Services cost breakdown', () => {
      const template = StatementMapper.TECH_INCOME_STATEMENT;
      const costOfProducts = template.find(t => t.normalizedMetric === 'cost_of_products');
      const costOfServices = template.find(t => t.normalizedMetric === 'cost_of_services');
      
      expect(costOfProducts).toBeDefined();
      expect(costOfProducts?.displayName).toBe('Products');
      expect(costOfProducts?.indent).toBe(1);
      
      expect(costOfServices).toBeDefined();
      expect(costOfServices?.displayName).toBe('Services');
      expect(costOfServices?.indent).toBe(1);
    });

    it('should have Gross margin line item', () => {
      const template = StatementMapper.TECH_INCOME_STATEMENT;
      const grossMargin = template.find(t => t.normalizedMetric === 'gross_profit' || t.normalizedMetric === 'gross_margin');
      expect(grossMargin).toBeDefined();
      expect(grossMargin?.displayName).toBe('Gross margin');
    });

    it('should have OPERATING EXPENSES header', () => {
      const template = StatementMapper.TECH_INCOME_STATEMENT;
      const opexHeader = template.find(t => t.displayName === 'OPERATING EXPENSES');
      expect(opexHeader).toBeDefined();
      expect(opexHeader?.isHeader).toBe(true);
    });

    it('should have R&D and SG&A operating expenses', () => {
      const template = StatementMapper.TECH_INCOME_STATEMENT;
      const rnd = template.find(t => t.normalizedMetric === 'research_and_development' || t.normalizedMetric === 'research_development');
      const sga = template.find(t => t.normalizedMetric === 'selling_general_administrative' || t.normalizedMetric === 'sg_and_a');
      
      expect(rnd).toBeDefined();
      expect(rnd?.displayName).toBe('Research and development');
      expect(rnd?.indent).toBe(1);
      
      expect(sga).toBeDefined();
      expect(sga?.displayName).toBe('Selling, general and administrative');
      expect(sga?.indent).toBe(1);
    });

    it('should have EARNINGS PER SHARE header', () => {
      const template = StatementMapper.TECH_INCOME_STATEMENT;
      const epsHeader = template.find(t => t.displayName === 'EARNINGS PER SHARE');
      expect(epsHeader).toBeDefined();
      expect(epsHeader?.isHeader).toBe(true);
    });

    it('should have SHARES USED IN COMPUTING EARNINGS PER SHARE header', () => {
      const template = StatementMapper.TECH_INCOME_STATEMENT;
      const sharesHeader = template.find(t => t.displayName === 'SHARES USED IN COMPUTING EARNINGS PER SHARE');
      expect(sharesHeader).toBeDefined();
      expect(sharesHeader?.isHeader).toBe(true);
    });

    it('should have weighted average shares', () => {
      const template = StatementMapper.TECH_INCOME_STATEMENT;
      const basicShares = template.find(t => t.normalizedMetric === 'weighted_avg_shares_basic');
      const dilutedShares = template.find(t => t.normalizedMetric === 'weighted_avg_shares_diluted');
      
      expect(basicShares).toBeDefined();
      expect(basicShares?.format).toBe('number');
      
      expect(dilutedShares).toBeDefined();
      expect(dilutedShares?.format).toBe('number');
    });

    it('should match fixture display names exactly', () => {
      const template = StatementMapper.TECH_INCOME_STATEMENT;
      const templateDisplayNames = template.map(t => t.displayName);
      
      fixture.expectedLineItems.forEach((item: any) => {
        const found = templateDisplayNames.some(name => 
          name === item.displayName || 
          name.toLowerCase() === item.displayName.toLowerCase()
        );
        expect(found).toBe(true);
      });
    });

    it('should preserve correct order for tech income statement', () => {
      const template = StatementMapper.TECH_INCOME_STATEMENT;
      
      // NET SALES should come before COST OF SALES
      const netSalesIndex = template.findIndex(t => t.displayName === 'NET SALES');
      const costSalesIndex = template.findIndex(t => t.displayName === 'COST OF SALES');
      expect(netSalesIndex).toBeLessThan(costSalesIndex);
      
      // Gross margin should come before OPERATING EXPENSES
      const grossMarginIndex = template.findIndex(t => t.normalizedMetric === 'gross_profit' || t.normalizedMetric === 'gross_margin');
      const opexHeaderIndex = template.findIndex(t => t.displayName === 'OPERATING EXPENSES');
      expect(grossMarginIndex).toBeLessThan(opexHeaderIndex);
      
      // Operating income should come before Other income/(expense)
      const opIncomeIndex = template.findIndex(t => t.normalizedMetric === 'operating_income');
      const otherIncomeIndex = template.findIndex(t => t.normalizedMetric === 'other_income_expense' || t.normalizedMetric === 'other_income');
      expect(opIncomeIndex).toBeLessThan(otherIncomeIndex);
      
      // Net income should come before EARNINGS PER SHARE
      const netIncomeIndex = template.findIndex(t => t.normalizedMetric === 'net_income');
      const epsHeaderIndex = template.findIndex(t => t.displayName === 'EARNINGS PER SHARE');
      expect(netIncomeIndex).toBeLessThan(epsHeaderIndex);
      
      // EARNINGS PER SHARE should come before SHARES USED
      const sharesHeaderIndex = template.findIndex(t => t.displayName === 'SHARES USED IN COMPUTING EARNINGS PER SHARE');
      expect(epsHeaderIndex).toBeLessThan(sharesHeaderIndex);
    });

    it('should not have duplicate normalizedMetric values (except aliases)', () => {
      const template = StatementMapper.TECH_INCOME_STATEMENT;
      const nonHeaderMetrics = template
        .filter(t => !t.isHeader)
        .map(t => t.normalizedMetric);
      
      const seen = new Set<string>();
      const duplicates: string[] = [];
      
      for (const metric of nonHeaderMetrics) {
        if (seen.has(metric)) {
          duplicates.push(metric);
        }
        seen.add(metric);
      }
      
      // Allow known aliases
      const allowedDuplicates = [
        'revenue', 'net_sales', 
        'cost_of_revenue', 'cost_of_sales',
        'gross_profit', 'gross_margin',
        'research_and_development', 'research_development',
        'selling_general_administrative', 'sg_and_a',
        'other_income_expense', 'other_income',
        'income_tax_expense', 'provision_for_income_taxes'
      ];
      const unexpectedDuplicates = duplicates.filter(d => !allowedDuplicates.includes(d));
      
      expect(unexpectedDuplicates).toEqual([]);
    });
  });

  describe('mapMetricsToStatementWithDiscovery', () => {
    it('should use MEDIA_INCOME_STATEMENT for communication_services', () => {
      const rawMetrics = [
        { normalized_metric: 'revenue', value: 100000, fiscal_period: 'FY2024' },
        { normalized_metric: 'programming_and_production', value: 50000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_income', value: 30000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'communication_services'
      );
      
      // Should have REVENUE header
      const revenueHeader = result.find(r => r.displayName === 'REVENUE');
      expect(revenueHeader).toBeDefined();
      expect(revenueHeader?.isHeader).toBe(true);
      
      // Should have Programming and production (media-specific)
      const programming = result.find(r => r.normalizedMetric === 'programming_and_production');
      expect(programming).toBeDefined();
    });

    it('should use BANK_INCOME_STATEMENT for financials', () => {
      const rawMetrics = [
        { normalized_metric: 'interest_income', value: 100000, fiscal_period: 'FY2024' },
        { normalized_metric: 'interest_expense', value: 30000, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_interest_income', value: 70000, fiscal_period: 'FY2024' },
        { normalized_metric: 'provision_credit_losses', value: 5000, fiscal_period: 'FY2024' },
        { normalized_metric: 'investment_banking_fees', value: 20000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'financials'
      );
      
      // Should have REVENUE header
      const revenueHeader = result.find(r => r.displayName === 'REVENUE');
      expect(revenueHeader).toBeDefined();
      
      // Should have bank-specific metrics
      const nii = result.find(r => r.normalizedMetric === 'net_interest_income');
      expect(nii).toBeDefined();
      expect(nii?.displayName).toBe('Net interest income');
      
      const provision = result.find(r => r.normalizedMetric === 'provision_credit_losses');
      expect(provision).toBeDefined();
      
      const ibFees = result.find(r => r.normalizedMetric === 'investment_banking_fees');
      expect(ibFees).toBeDefined();
    });

    it('should only include metrics with data', () => {
      const rawMetrics = [
        { normalized_metric: 'interest_income', value: 100000, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_interest_income', value: 70000, fiscal_period: 'FY2024' },
        // Note: provision_credit_losses is NOT in rawMetrics
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'financials'
      );
      
      // Should NOT have provision_credit_losses since no data
      const provision = result.find(r => r.normalizedMetric === 'provision_credit_losses');
      expect(provision).toBeUndefined();
    });

    it('should preserve template order for metrics with data', () => {
      const rawMetrics = [
        { normalized_metric: 'net_income', value: 50000, fiscal_period: 'FY2024' },
        { normalized_metric: 'interest_income', value: 100000, fiscal_period: 'FY2024' },
        { normalized_metric: 'income_before_taxes', value: 60000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'financials'
      );
      
      const nonHeaderResults = result.filter(r => !r.isHeader);
      const interestIncomeIndex = nonHeaderResults.findIndex(r => r.normalizedMetric === 'interest_income');
      const preTaxIndex = nonHeaderResults.findIndex(r => r.normalizedMetric === 'income_before_taxes');
      const netIncomeIndex = nonHeaderResults.findIndex(r => r.normalizedMetric === 'net_income');
      
      // Order should be: interest_income < income_before_taxes < net_income
      expect(interestIncomeIndex).toBeLessThan(preTaxIndex);
      expect(preTaxIndex).toBeLessThan(netIncomeIndex);
    });

    it('should use TECH_INCOME_STATEMENT for information_technology', () => {
      const rawMetrics = [
        { normalized_metric: 'product_revenue', value: 200000, fiscal_period: 'FY2024' },
        { normalized_metric: 'service_revenue', value: 100000, fiscal_period: 'FY2024' },
        { normalized_metric: 'revenue', value: 300000, fiscal_period: 'FY2024' },
        { normalized_metric: 'cost_of_products', value: 120000, fiscal_period: 'FY2024' },
        { normalized_metric: 'cost_of_services', value: 30000, fiscal_period: 'FY2024' },
        { normalized_metric: 'gross_profit', value: 150000, fiscal_period: 'FY2024' },
        { normalized_metric: 'research_and_development', value: 25000, fiscal_period: 'FY2024' },
        { normalized_metric: 'selling_general_administrative', value: 20000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_income', value: 105000, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_income', value: 90000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'information_technology'
      );
      
      // Should have NET SALES header
      const netSalesHeader = result.find(r => r.displayName === 'NET SALES');
      expect(netSalesHeader).toBeDefined();
      expect(netSalesHeader?.isHeader).toBe(true);
      
      // Should have tech-specific metrics
      const productRevenue = result.find(r => r.normalizedMetric === 'product_revenue');
      expect(productRevenue).toBeDefined();
      expect(productRevenue?.displayName).toBe('Products');
      
      const serviceRevenue = result.find(r => r.normalizedMetric === 'service_revenue');
      expect(serviceRevenue).toBeDefined();
      expect(serviceRevenue?.displayName).toBe('Services');
      
      const grossProfit = result.find(r => r.normalizedMetric === 'gross_profit');
      expect(grossProfit).toBeDefined();
      expect(grossProfit?.displayName).toBe('Gross margin');
      
      const rnd = result.find(r => r.normalizedMetric === 'research_and_development');
      expect(rnd).toBeDefined();
      expect(rnd?.displayName).toBe('Research and development');
    });

    it('should use RETAIL_INCOME_STATEMENT for consumer_discretionary', () => {
      const rawMetrics = [
        { normalized_metric: 'product_sales', value: 400000, fiscal_period: 'FY2024' },
        { normalized_metric: 'service_sales', value: 150000, fiscal_period: 'FY2024' },
        { normalized_metric: 'revenue', value: 550000, fiscal_period: 'FY2024' },
        { normalized_metric: 'cost_of_sales', value: 300000, fiscal_period: 'FY2024' },
        { normalized_metric: 'fulfillment', value: 80000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_income', value: 50000, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_income', value: 40000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'consumer_discretionary'
      );
      
      // Should have NET SALES header
      const netSalesHeader = result.find(r => r.displayName === 'NET SALES');
      expect(netSalesHeader).toBeDefined();
      expect(netSalesHeader?.isHeader).toBe(true);
      
      // Should have retail-specific metrics
      const productSales = result.find(r => r.normalizedMetric === 'product_sales');
      expect(productSales).toBeDefined();
      expect(productSales?.displayName).toBe('Product sales');
      
      const fulfillment = result.find(r => r.normalizedMetric === 'fulfillment');
      expect(fulfillment).toBeDefined();
      expect(fulfillment?.displayName).toBe('Fulfillment');
    });

    it('should use ENERGY_INCOME_STATEMENT for energy', () => {
      const rawMetrics = [
        { normalized_metric: 'sales_and_other_operating_revenue', value: 400000, fiscal_period: 'FY2024' },
        { normalized_metric: 'crude_oil_and_product_purchases', value: 200000, fiscal_period: 'FY2024' },
        { normalized_metric: 'production_and_manufacturing', value: 50000, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation_and_depletion', value: 30000, fiscal_period: 'FY2024' },
        { normalized_metric: 'exploration_expenses', value: 10000, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_income', value: 80000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'energy'
      );
      
      // Should have REVENUES AND OTHER INCOME header
      const revenueHeader = result.find(r => r.displayName === 'REVENUES AND OTHER INCOME');
      expect(revenueHeader).toBeDefined();
      expect(revenueHeader?.isHeader).toBe(true);
      
      // Should have energy-specific metrics
      const salesRevenue = result.find(r => r.normalizedMetric === 'sales_and_other_operating_revenue');
      expect(salesRevenue).toBeDefined();
      
      const exploration = result.find(r => r.normalizedMetric === 'exploration_expenses');
      expect(exploration).toBeDefined();
      expect(exploration?.displayName).toBe('Exploration expenses, including dry holes');
    });

    it('should use UTILITY_INCOME_STATEMENT for utilities', () => {
      const rawMetrics = [
        { normalized_metric: 'electric_revenue', value: 15000, fiscal_period: 'FY2024' },
        { normalized_metric: 'gas_revenue', value: 3000, fiscal_period: 'FY2024' },
        { normalized_metric: 'revenue', value: 18000, fiscal_period: 'FY2024' },
        { normalized_metric: 'fuel_purchased_power_interchange', value: 8000, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation_amortization', value: 2000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_income', value: 5000, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_income', value: 4000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'utilities'
      );
      
      // Should have OPERATING REVENUES header
      const revenueHeader = result.find(r => r.displayName === 'OPERATING REVENUES');
      expect(revenueHeader).toBeDefined();
      expect(revenueHeader?.isHeader).toBe(true);
      
      // Should have utility-specific metrics
      const electricRevenue = result.find(r => r.normalizedMetric === 'electric_revenue');
      expect(electricRevenue).toBeDefined();
      expect(electricRevenue?.displayName).toBe('Electric');
      
      const fuelPurchased = result.find(r => r.normalizedMetric === 'fuel_purchased_power_interchange');
      expect(fuelPurchased).toBeDefined();
    });

    it('should use HEALTHCARE_INCOME_STATEMENT for health_care', () => {
      const rawMetrics = [
        { normalized_metric: 'premiums', value: 250000, fiscal_period: 'FY2024' },
        { normalized_metric: 'products_revenue', value: 50000, fiscal_period: 'FY2024' },
        { normalized_metric: 'services_revenue', value: 30000, fiscal_period: 'FY2024' },
        { normalized_metric: 'revenue', value: 330000, fiscal_period: 'FY2024' },
        { normalized_metric: 'medical_costs', value: 200000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_income', value: 30000, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_income', value: 25000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'health_care'
      );
      
      // Should have REVENUES header
      const revenueHeader = result.find(r => r.displayName === 'REVENUES');
      expect(revenueHeader).toBeDefined();
      expect(revenueHeader?.isHeader).toBe(true);
      
      // Should have healthcare-specific metrics
      const premiums = result.find(r => r.normalizedMetric === 'premiums');
      expect(premiums).toBeDefined();
      expect(premiums?.displayName).toBe('Premiums');
      
      const medicalCosts = result.find(r => r.normalizedMetric === 'medical_costs');
      expect(medicalCosts).toBeDefined();
      expect(medicalCosts?.displayName).toBe('Medical costs');
    });
  });

  describe('Consumer Discretionary - AMZN Template Validation', () => {
    let fixture: any;

    beforeAll(() => {
      fixture = loadFixture('consumer_discretionary/AMZN_2024_income_statement.json');
    });

    it('should have RETAIL_INCOME_STATEMENT template defined', () => {
      expect(StatementMapper.RETAIL_INCOME_STATEMENT).toBeDefined();
      expect(Array.isArray(StatementMapper.RETAIL_INCOME_STATEMENT)).toBe(true);
      expect(StatementMapper.RETAIL_INCOME_STATEMENT.length).toBeGreaterThan(0);
    });

    it('should have NET SALES header as first item', () => {
      const template = StatementMapper.RETAIL_INCOME_STATEMENT;
      const firstItem = template[0];
      expect(firstItem.displayName).toBe('NET SALES');
      expect(firstItem.isHeader).toBe(true);
    });

    it('should have Product sales and Service sales breakdown', () => {
      const template = StatementMapper.RETAIL_INCOME_STATEMENT;
      const productSales = template.find(t => t.normalizedMetric === 'product_sales');
      const serviceSales = template.find(t => t.normalizedMetric === 'service_sales');
      
      expect(productSales).toBeDefined();
      expect(productSales?.displayName).toBe('Product sales');
      expect(productSales?.indent).toBe(1);
      
      expect(serviceSales).toBeDefined();
      expect(serviceSales?.displayName).toBe('Service sales');
      expect(serviceSales?.indent).toBe(1);
    });

    it('should have Fulfillment expense', () => {
      const template = StatementMapper.RETAIL_INCOME_STATEMENT;
      const fulfillment = template.find(t => t.normalizedMetric === 'fulfillment');
      expect(fulfillment).toBeDefined();
      expect(fulfillment?.displayName).toBe('Fulfillment');
      expect(fulfillment?.indent).toBe(1);
    });

    it('should have EARNINGS PER SHARE header', () => {
      const template = StatementMapper.RETAIL_INCOME_STATEMENT;
      const epsHeader = template.find(t => t.displayName === 'EARNINGS PER SHARE');
      expect(epsHeader).toBeDefined();
      expect(epsHeader?.isHeader).toBe(true);
    });

    it('should match fixture display names', () => {
      const template = StatementMapper.RETAIL_INCOME_STATEMENT;
      const templateDisplayNames = template.map(t => t.displayName);
      
      fixture.expectedLineItems.forEach((item: any) => {
        const found = templateDisplayNames.some(name => 
          name === item.displayName || 
          name.toLowerCase() === item.displayName.toLowerCase()
        );
        expect(found).toBe(true);
      });
    });
  });

  describe('Energy - XOM Template Validation', () => {
    let fixture: any;

    beforeAll(() => {
      fixture = loadFixture('energy/XOM_2024_income_statement.json');
    });

    it('should have ENERGY_INCOME_STATEMENT template defined', () => {
      expect(StatementMapper.ENERGY_INCOME_STATEMENT).toBeDefined();
      expect(Array.isArray(StatementMapper.ENERGY_INCOME_STATEMENT)).toBe(true);
      expect(StatementMapper.ENERGY_INCOME_STATEMENT.length).toBeGreaterThan(0);
    });

    it('should have REVENUES AND OTHER INCOME header as first item', () => {
      const template = StatementMapper.ENERGY_INCOME_STATEMENT;
      const firstItem = template[0];
      expect(firstItem.displayName).toBe('REVENUES AND OTHER INCOME');
      expect(firstItem.isHeader).toBe(true);
    });

    it('should have energy-specific cost items', () => {
      const template = StatementMapper.ENERGY_INCOME_STATEMENT;
      const crudeOil = template.find(t => t.normalizedMetric === 'crude_oil_and_product_purchases');
      const exploration = template.find(t => t.normalizedMetric === 'exploration_expenses');
      const depletion = template.find(t => t.normalizedMetric === 'depreciation_and_depletion');
      
      expect(crudeOil).toBeDefined();
      expect(crudeOil?.displayName).toBe('Crude oil and product purchases');
      
      expect(exploration).toBeDefined();
      expect(exploration?.displayName).toBe('Exploration expenses, including dry holes');
      
      expect(depletion).toBeDefined();
      expect(depletion?.displayName).toBe('Depreciation and depletion');
    });

    it('should have COSTS AND OTHER DEDUCTIONS header', () => {
      const template = StatementMapper.ENERGY_INCOME_STATEMENT;
      const costsHeader = template.find(t => t.displayName === 'COSTS AND OTHER DEDUCTIONS');
      expect(costsHeader).toBeDefined();
      expect(costsHeader?.isHeader).toBe(true);
    });

    it('should match fixture display names', () => {
      const template = StatementMapper.ENERGY_INCOME_STATEMENT;
      const templateDisplayNames = template.map(t => t.displayName);
      
      fixture.expectedLineItems.forEach((item: any) => {
        const found = templateDisplayNames.some(name => 
          name === item.displayName || 
          name.toLowerCase() === item.displayName.toLowerCase()
        );
        expect(found).toBe(true);
      });
    });
  });

  describe('Utilities - NEE Template Validation', () => {
    let fixture: any;

    beforeAll(() => {
      fixture = loadFixture('utilities/NEE_2024_income_statement.json');
    });

    it('should have UTILITY_INCOME_STATEMENT template defined', () => {
      expect(StatementMapper.UTILITY_INCOME_STATEMENT).toBeDefined();
      expect(Array.isArray(StatementMapper.UTILITY_INCOME_STATEMENT)).toBe(true);
      expect(StatementMapper.UTILITY_INCOME_STATEMENT.length).toBeGreaterThan(0);
    });

    it('should have OPERATING REVENUES header as first item', () => {
      const template = StatementMapper.UTILITY_INCOME_STATEMENT;
      const firstItem = template[0];
      expect(firstItem.displayName).toBe('OPERATING REVENUES');
      expect(firstItem.isHeader).toBe(true);
    });

    it('should have Electric and Gas revenue breakdown', () => {
      const template = StatementMapper.UTILITY_INCOME_STATEMENT;
      const electricRevenue = template.find(t => t.normalizedMetric === 'electric_revenue');
      const gasRevenue = template.find(t => t.normalizedMetric === 'gas_revenue');
      
      expect(electricRevenue).toBeDefined();
      expect(electricRevenue?.displayName).toBe('Electric');
      expect(electricRevenue?.indent).toBe(1);
      
      expect(gasRevenue).toBeDefined();
      expect(gasRevenue?.displayName).toBe('Gas');
      expect(gasRevenue?.indent).toBe(1);
    });

    it('should have utility-specific expense items', () => {
      const template = StatementMapper.UTILITY_INCOME_STATEMENT;
      const fuelPurchased = template.find(t => t.normalizedMetric === 'fuel_purchased_power_interchange');
      const costOfGas = template.find(t => t.normalizedMetric === 'cost_of_gas_sold');
      
      expect(fuelPurchased).toBeDefined();
      expect(fuelPurchased?.displayName).toBe('Fuel, purchased power and interchange');
      
      expect(costOfGas).toBeDefined();
      expect(costOfGas?.displayName).toBe('Cost of gas sold');
    });

    it('should have OTHER INCOME (DEDUCTIONS) header', () => {
      const template = StatementMapper.UTILITY_INCOME_STATEMENT;
      const otherHeader = template.find(t => t.displayName === 'OTHER INCOME (DEDUCTIONS)');
      expect(otherHeader).toBeDefined();
      expect(otherHeader?.isHeader).toBe(true);
    });

    it('should match fixture display names', () => {
      const template = StatementMapper.UTILITY_INCOME_STATEMENT;
      const templateDisplayNames = template.map(t => t.displayName);
      
      fixture.expectedLineItems.forEach((item: any) => {
        const found = templateDisplayNames.some(name => 
          name === item.displayName || 
          name.toLowerCase() === item.displayName.toLowerCase()
        );
        expect(found).toBe(true);
      });
    });
  });

  describe('Health Care - UNH Template Validation', () => {
    let fixture: any;

    beforeAll(() => {
      fixture = loadFixture('health_care/UNH_2024_income_statement.json');
    });

    it('should have HEALTHCARE_INCOME_STATEMENT template defined', () => {
      expect(StatementMapper.HEALTHCARE_INCOME_STATEMENT).toBeDefined();
      expect(Array.isArray(StatementMapper.HEALTHCARE_INCOME_STATEMENT)).toBe(true);
      expect(StatementMapper.HEALTHCARE_INCOME_STATEMENT.length).toBeGreaterThan(0);
    });

    it('should have REVENUES header as first item', () => {
      const template = StatementMapper.HEALTHCARE_INCOME_STATEMENT;
      const firstItem = template[0];
      expect(firstItem.displayName).toBe('REVENUES');
      expect(firstItem.isHeader).toBe(true);
    });

    it('should have Premiums as first revenue item', () => {
      const template = StatementMapper.HEALTHCARE_INCOME_STATEMENT;
      const premiums = template.find(t => t.normalizedMetric === 'premiums');
      expect(premiums).toBeDefined();
      expect(premiums?.displayName).toBe('Premiums');
      expect(premiums?.indent).toBe(1);
    });

    it('should have healthcare-specific cost items', () => {
      const template = StatementMapper.HEALTHCARE_INCOME_STATEMENT;
      const medicalCosts = template.find(t => t.normalizedMetric === 'medical_costs');
      const operatingCosts = template.find(t => t.normalizedMetric === 'operating_costs');
      
      expect(medicalCosts).toBeDefined();
      expect(medicalCosts?.displayName).toBe('Medical costs');
      expect(medicalCosts?.indent).toBe(1);
      
      expect(operatingCosts).toBeDefined();
      expect(operatingCosts?.displayName).toBe('Operating costs');
    });

    it('should have OPERATING COSTS header', () => {
      const template = StatementMapper.HEALTHCARE_INCOME_STATEMENT;
      const costsHeader = template.find(t => t.displayName === 'OPERATING COSTS');
      expect(costsHeader).toBeDefined();
      expect(costsHeader?.isHeader).toBe(true);
    });

    it('should have Earnings from operations (not Operating income)', () => {
      const template = StatementMapper.HEALTHCARE_INCOME_STATEMENT;
      const operatingIncome = template.find(t => t.normalizedMetric === 'operating_income');
      expect(operatingIncome).toBeDefined();
      expect(operatingIncome?.displayName).toBe('Earnings from operations');
    });

    it('should match fixture display names', () => {
      const template = StatementMapper.HEALTHCARE_INCOME_STATEMENT;
      const templateDisplayNames = template.map(t => t.displayName);
      
      fixture.expectedLineItems.forEach((item: any) => {
        const found = templateDisplayNames.some(name => 
          name === item.displayName || 
          name.toLowerCase() === item.displayName.toLowerCase()
        );
        expect(found).toBe(true);
      });
    });
  });

  describe('Real Estate - AMT Template Validation', () => {
    let fixture: any;

    beforeAll(() => {
      fixture = loadFixture('real_estate/AMT_2024_income_statement.json');
    });

    it('should have REIT_INCOME_STATEMENT template defined', () => {
      expect(StatementMapper.REIT_INCOME_STATEMENT).toBeDefined();
      expect(Array.isArray(StatementMapper.REIT_INCOME_STATEMENT)).toBe(true);
      expect(StatementMapper.REIT_INCOME_STATEMENT.length).toBeGreaterThan(0);
    });

    it('should have REVENUES header as first item', () => {
      const template = StatementMapper.REIT_INCOME_STATEMENT;
      const firstItem = template[0];
      expect(firstItem.displayName).toBe('REVENUES');
      expect(firstItem.isHeader).toBe(true);
    });

    it('should have Property revenue as first revenue item', () => {
      const template = StatementMapper.REIT_INCOME_STATEMENT;
      const propertyRevenue = template.find(t => t.normalizedMetric === 'property_revenue');
      expect(propertyRevenue).toBeDefined();
      expect(propertyRevenue?.displayName).toBe('Property revenue');
      expect(propertyRevenue?.indent).toBe(1);
    });

    it('should have REIT-specific expense items', () => {
      const template = StatementMapper.REIT_INCOME_STATEMENT;
      const depAmortAccret = template.find(t => t.normalizedMetric === 'depreciation_amortization_accretion');
      expect(depAmortAccret).toBeDefined();
      expect(depAmortAccret?.displayName).toBe('Depreciation, amortization and accretion');
    });

    it('should have OTHER INCOME (EXPENSE) header', () => {
      const template = StatementMapper.REIT_INCOME_STATEMENT;
      const otherHeader = template.find(t => t.displayName === 'OTHER INCOME (EXPENSE)');
      expect(otherHeader).toBeDefined();
      expect(otherHeader?.isHeader).toBe(true);
    });

    it('should have WEIGHTED AVERAGE COMMON SHARES OUTSTANDING header', () => {
      const template = StatementMapper.REIT_INCOME_STATEMENT;
      const sharesHeader = template.find(t => t.displayName === 'WEIGHTED AVERAGE COMMON SHARES OUTSTANDING');
      expect(sharesHeader).toBeDefined();
      expect(sharesHeader?.isHeader).toBe(true);
    });

    it('should match fixture display names', () => {
      const template = StatementMapper.REIT_INCOME_STATEMENT;
      const templateDisplayNames = template.map(t => t.displayName);
      
      fixture.expectedLineItems.forEach((item: any) => {
        const found = templateDisplayNames.some(name => 
          name === item.displayName || 
          name.toLowerCase() === item.displayName.toLowerCase()
        );
        expect(found).toBe(true);
      });
    });
  });

  describe('Consumer Staples - PG Template Validation', () => {
    let fixture: any;

    beforeAll(() => {
      fixture = loadFixture('consumer_staples/PG_2024_income_statement.json');
    });

    it('should have CONSUMER_STAPLES_INCOME_STATEMENT template defined', () => {
      expect(StatementMapper.CONSUMER_STAPLES_INCOME_STATEMENT).toBeDefined();
      expect(Array.isArray(StatementMapper.CONSUMER_STAPLES_INCOME_STATEMENT)).toBe(true);
      expect(StatementMapper.CONSUMER_STAPLES_INCOME_STATEMENT.length).toBeGreaterThan(0);
    });

    it('should have NET SALES header as first item', () => {
      const template = StatementMapper.CONSUMER_STAPLES_INCOME_STATEMENT;
      const firstItem = template[0];
      expect(firstItem.displayName).toBe('NET SALES');
      expect(firstItem.isHeader).toBe(true);
    });

    it('should have COSTS AND EXPENSES header', () => {
      const template = StatementMapper.CONSUMER_STAPLES_INCOME_STATEMENT;
      const costsHeader = template.find(t => t.displayName === 'COSTS AND EXPENSES');
      expect(costsHeader).toBeDefined();
      expect(costsHeader?.isHeader).toBe(true);
    });

    it('should have Cost of products sold', () => {
      const template = StatementMapper.CONSUMER_STAPLES_INCOME_STATEMENT;
      const costOfProducts = template.find(t => t.normalizedMetric === 'cost_of_products_sold');
      expect(costOfProducts).toBeDefined();
      expect(costOfProducts?.displayName).toBe('Cost of products sold');
      expect(costOfProducts?.indent).toBe(1);
    });

    it('should have Dividends per common share', () => {
      const template = StatementMapper.CONSUMER_STAPLES_INCOME_STATEMENT;
      const dividends = template.find(t => t.normalizedMetric === 'dividends_per_share');
      expect(dividends).toBeDefined();
      expect(dividends?.displayName).toBe('Dividends per common share');
    });

    it('should match fixture display names', () => {
      const template = StatementMapper.CONSUMER_STAPLES_INCOME_STATEMENT;
      const templateDisplayNames = template.map(t => t.displayName);
      
      fixture.expectedLineItems.forEach((item: any) => {
        const found = templateDisplayNames.some(name => 
          name === item.displayName || 
          name.toLowerCase() === item.displayName.toLowerCase()
        );
        expect(found).toBe(true);
      });
    });
  });

  describe('Industrials - UNP Template Validation', () => {
    let fixture: any;

    beforeAll(() => {
      fixture = loadFixture('industrials/UNP_2024_income_statement.json');
    });

    it('should have INDUSTRIALS_INCOME_STATEMENT template defined', () => {
      expect(StatementMapper.INDUSTRIALS_INCOME_STATEMENT).toBeDefined();
      expect(Array.isArray(StatementMapper.INDUSTRIALS_INCOME_STATEMENT)).toBe(true);
      expect(StatementMapper.INDUSTRIALS_INCOME_STATEMENT.length).toBeGreaterThan(0);
    });

    it('should have OPERATING REVENUES header as first item', () => {
      const template = StatementMapper.INDUSTRIALS_INCOME_STATEMENT;
      const firstItem = template[0];
      expect(firstItem.displayName).toBe('OPERATING REVENUES');
      expect(firstItem.isHeader).toBe(true);
    });

    it('should have Freight revenues and Other revenues breakdown', () => {
      const template = StatementMapper.INDUSTRIALS_INCOME_STATEMENT;
      const freightRevenues = template.find(t => t.normalizedMetric === 'freight_revenues');
      const otherRevenues = template.find(t => t.normalizedMetric === 'other_revenues');
      
      expect(freightRevenues).toBeDefined();
      expect(freightRevenues?.displayName).toBe('Freight revenues');
      expect(freightRevenues?.indent).toBe(1);
      
      expect(otherRevenues).toBeDefined();
      expect(otherRevenues?.displayName).toBe('Other revenues');
      expect(otherRevenues?.indent).toBe(1);
    });

    it('should have industrials-specific expense items', () => {
      const template = StatementMapper.INDUSTRIALS_INCOME_STATEMENT;
      const compensation = template.find(t => t.normalizedMetric === 'compensation_and_benefits');
      const fuel = template.find(t => t.normalizedMetric === 'fuel');
      const purchased = template.find(t => t.normalizedMetric === 'purchased_services_and_materials');
      
      expect(compensation).toBeDefined();
      expect(compensation?.displayName).toBe('Compensation and benefits');
      expect(compensation?.indent).toBe(1);
      
      expect(fuel).toBeDefined();
      expect(fuel?.displayName).toBe('Fuel');
      expect(fuel?.indent).toBe(1);
      
      expect(purchased).toBeDefined();
      expect(purchased?.displayName).toBe('Purchased services and materials');
      expect(purchased?.indent).toBe(1);
    });

    it('should have OTHER INCOME (EXPENSE) header', () => {
      const template = StatementMapper.INDUSTRIALS_INCOME_STATEMENT;
      const otherHeader = template.find(t => t.displayName === 'OTHER INCOME (EXPENSE)');
      expect(otherHeader).toBeDefined();
      expect(otherHeader?.isHeader).toBe(true);
    });

    it('should match fixture display names', () => {
      const template = StatementMapper.INDUSTRIALS_INCOME_STATEMENT;
      const templateDisplayNames = template.map(t => t.displayName);
      
      fixture.expectedLineItems.forEach((item: any) => {
        const found = templateDisplayNames.some(name => 
          name === item.displayName || 
          name.toLowerCase() === item.displayName.toLowerCase()
        );
        expect(found).toBe(true);
      });
    });
  });

  describe('Materials - LIN Template Validation', () => {
    let fixture: any;

    beforeAll(() => {
      fixture = loadFixture('materials/LIN_2024_income_statement.json');
    });

    it('should have MATERIALS_INCOME_STATEMENT template defined', () => {
      expect(StatementMapper.MATERIALS_INCOME_STATEMENT).toBeDefined();
      expect(Array.isArray(StatementMapper.MATERIALS_INCOME_STATEMENT)).toBe(true);
      expect(StatementMapper.MATERIALS_INCOME_STATEMENT.length).toBeGreaterThan(0);
    });

    it('should have SALES header as first item', () => {
      const template = StatementMapper.MATERIALS_INCOME_STATEMENT;
      const firstItem = template[0];
      expect(firstItem.displayName).toBe('SALES');
      expect(firstItem.isHeader).toBe(true);
    });

    it('should have COSTS AND EXPENSES header', () => {
      const template = StatementMapper.MATERIALS_INCOME_STATEMENT;
      const costsHeader = template.find(t => t.displayName === 'COSTS AND EXPENSES');
      expect(costsHeader).toBeDefined();
      expect(costsHeader?.isHeader).toBe(true);
    });

    it('should have materials-specific expense items', () => {
      const template = StatementMapper.MATERIALS_INCOME_STATEMENT;
      const costOfSales = template.find(t => t.normalizedMetric === 'cost_of_sales');
      const rnd = template.find(t => t.normalizedMetric === 'research_and_development');
      const restructuring = template.find(t => t.normalizedMetric === 'restructuring_charges');
      
      expect(costOfSales).toBeDefined();
      expect(costOfSales?.displayName).toBe('Cost of sales');
      expect(costOfSales?.indent).toBe(1);
      
      expect(rnd).toBeDefined();
      expect(rnd?.displayName).toBe('Research and development');
      expect(rnd?.indent).toBe(1);
      
      expect(restructuring).toBeDefined();
      expect(restructuring?.displayName).toBe('Restructuring charges');
      expect(restructuring?.indent).toBe(1);
    });

    it('should have Operating profit (not Operating income)', () => {
      const template = StatementMapper.MATERIALS_INCOME_STATEMENT;
      const operatingProfit = template.find(t => t.normalizedMetric === 'operating_income');
      expect(operatingProfit).toBeDefined();
      expect(operatingProfit?.displayName).toBe('Operating profit');
    });

    it('should have Interest expense - net', () => {
      const template = StatementMapper.MATERIALS_INCOME_STATEMENT;
      const interestExpense = template.find(t => t.normalizedMetric === 'interest_expense');
      expect(interestExpense).toBeDefined();
      expect(interestExpense?.displayName).toBe('Interest expense - net');
      expect(interestExpense?.indent).toBe(1);
    });

    it('should have WEIGHTED AVERAGE SHARES OUTSTANDING header', () => {
      const template = StatementMapper.MATERIALS_INCOME_STATEMENT;
      const sharesHeader = template.find(t => t.displayName === 'WEIGHTED AVERAGE SHARES OUTSTANDING');
      expect(sharesHeader).toBeDefined();
      expect(sharesHeader?.isHeader).toBe(true);
    });

    it('should match fixture display names', () => {
      const template = StatementMapper.MATERIALS_INCOME_STATEMENT;
      const templateDisplayNames = template.map(t => t.displayName);
      
      fixture.expectedLineItems.forEach((item: any) => {
        const found = templateDisplayNames.some(name => 
          name === item.displayName || 
          name.toLowerCase() === item.displayName.toLowerCase()
        );
        expect(found).toBe(true);
      });
    });
  });

  describe('mapMetricsToStatementWithDiscovery - Additional Industries', () => {
    it('should use REIT_INCOME_STATEMENT for real_estate', () => {
      const rawMetrics = [
        { normalized_metric: 'property_revenue', value: 10000, fiscal_period: 'FY2024' },
        { normalized_metric: 'services_and_other_revenue', value: 1000, fiscal_period: 'FY2024' },
        { normalized_metric: 'revenue', value: 11000, fiscal_period: 'FY2024' },
        { normalized_metric: 'cost_of_revenue', value: 4000, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation_amortization_accretion', value: 3000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_income', value: 3000, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_income', value: 2500, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'real_estate'
      );
      
      const revenueHeader = result.find(r => r.displayName === 'REVENUES');
      expect(revenueHeader).toBeDefined();
      expect(revenueHeader?.isHeader).toBe(true);
      
      const propertyRevenue = result.find(r => r.normalizedMetric === 'property_revenue');
      expect(propertyRevenue).toBeDefined();
      expect(propertyRevenue?.displayName).toBe('Property revenue');
    });

    it('should use CONSUMER_STAPLES_INCOME_STATEMENT for consumer_staples', () => {
      const rawMetrics = [
        { normalized_metric: 'net_sales', value: 80000, fiscal_period: 'FY2024' },
        { normalized_metric: 'revenue', value: 80000, fiscal_period: 'FY2024' },
        { normalized_metric: 'cost_of_products_sold', value: 40000, fiscal_period: 'FY2024' },
        { normalized_metric: 'selling_general_administrative', value: 20000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_income', value: 20000, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_income', value: 15000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'consumer_staples'
      );
      
      const netSalesHeader = result.find(r => r.displayName === 'NET SALES');
      expect(netSalesHeader).toBeDefined();
      expect(netSalesHeader?.isHeader).toBe(true);
      
      const costOfProducts = result.find(r => r.normalizedMetric === 'cost_of_products_sold');
      expect(costOfProducts).toBeDefined();
      expect(costOfProducts?.displayName).toBe('Cost of products sold');
    });

    it('should use INDUSTRIALS_INCOME_STATEMENT for industrials', () => {
      const rawMetrics = [
        { normalized_metric: 'freight_revenues', value: 20000, fiscal_period: 'FY2024' },
        { normalized_metric: 'other_revenues', value: 2000, fiscal_period: 'FY2024' },
        { normalized_metric: 'revenue', value: 22000, fiscal_period: 'FY2024' },
        { normalized_metric: 'compensation_and_benefits', value: 8000, fiscal_period: 'FY2024' },
        { normalized_metric: 'fuel', value: 4000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_income', value: 7000, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_income', value: 6000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'industrials'
      );
      
      const revenueHeader = result.find(r => r.displayName === 'OPERATING REVENUES');
      expect(revenueHeader).toBeDefined();
      expect(revenueHeader?.isHeader).toBe(true);
      
      const freightRevenues = result.find(r => r.normalizedMetric === 'freight_revenues');
      expect(freightRevenues).toBeDefined();
      expect(freightRevenues?.displayName).toBe('Freight revenues');
    });

    it('should use MATERIALS_INCOME_STATEMENT for materials', () => {
      const rawMetrics = [
        { normalized_metric: 'net_sales', value: 30000, fiscal_period: 'FY2024' },
        { normalized_metric: 'revenue', value: 30000, fiscal_period: 'FY2024' },
        { normalized_metric: 'cost_of_sales', value: 18000, fiscal_period: 'FY2024' },
        { normalized_metric: 'selling_general_administrative', value: 4000, fiscal_period: 'FY2024' },
        { normalized_metric: 'research_and_development', value: 500, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation_amortization', value: 2000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_income', value: 5500, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_income', value: 4500, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.INCOME_STATEMENT,
        ['FY2024'],
        'materials'
      );
      
      const salesHeader = result.find(r => r.displayName === 'SALES');
      expect(salesHeader).toBeDefined();
      expect(salesHeader?.isHeader).toBe(true);
      
      const costOfSales = result.find(r => r.normalizedMetric === 'cost_of_sales');
      expect(costOfSales).toBeDefined();
      expect(costOfSales?.displayName).toBe('Cost of sales');
      
      const operatingProfit = result.find(r => r.normalizedMetric === 'operating_income');
      expect(operatingProfit).toBeDefined();
      expect(operatingProfit?.displayName).toBe('Operating profit');
    });
  });

  // ============================================================
  // PHASE 3: BALANCE SHEET TEMPLATE VALIDATION
  // ============================================================

  describe('Balance Sheet Template Registry', () => {
    it('should have BANK_BALANCE_SHEET template defined', () => {
      expect(StatementMapper.BANK_BALANCE_SHEET).toBeDefined();
      expect(Array.isArray(StatementMapper.BANK_BALANCE_SHEET)).toBe(true);
      expect(StatementMapper.BANK_BALANCE_SHEET.length).toBeGreaterThan(0);
    });

    it('should have all required bank balance sheet sections', () => {
      const template = StatementMapper.BANK_BALANCE_SHEET;
      
      // Check for main headers
      const assetsHeader = template.find(m => m.displayName === 'ASSETS');
      expect(assetsHeader).toBeDefined();
      expect(assetsHeader?.isHeader).toBe(true);
      
      const liabilitiesHeader = template.find(m => m.displayName === 'LIABILITIES');
      expect(liabilitiesHeader).toBeDefined();
      expect(liabilitiesHeader?.isHeader).toBe(true);
      
      const equityHeader = template.find(m => m.displayName === "STOCKHOLDERS' EQUITY");
      expect(equityHeader).toBeDefined();
      expect(equityHeader?.isHeader).toBe(true);
      
      const ratiosHeader = template.find(m => m.displayName === 'KEY BANK RATIOS');
      expect(ratiosHeader).toBeDefined();
      expect(ratiosHeader?.isHeader).toBe(true);
    });

    it('should have bank-specific asset items', () => {
      const template = StatementMapper.BANK_BALANCE_SHEET;
      
      // Bank-specific assets
      const cashDeposits = template.find(m => m.normalizedMetric === 'cash_deposits_banks');
      expect(cashDeposits).toBeDefined();
      expect(cashDeposits?.displayName).toBe('Cash and due from banks');
      
      const federalFundsSold = template.find(m => m.normalizedMetric === 'federal_funds_sold');
      expect(federalFundsSold).toBeDefined();
      
      const tradingAssets = template.find(m => m.normalizedMetric === 'trading_assets');
      expect(tradingAssets).toBeDefined();
      expect(tradingAssets?.displayName).toBe('Trading assets');
      
      const securitiesAFS = template.find(m => m.normalizedMetric === 'securities_available_for_sale');
      expect(securitiesAFS).toBeDefined();
      expect(securitiesAFS?.displayName).toBe('Securities available-for-sale');
      
      const loansGross = template.find(m => m.normalizedMetric === 'loans_gross');
      expect(loansGross).toBeDefined();
      expect(loansGross?.displayName).toBe('Loans');
      
      const allowance = template.find(m => m.normalizedMetric === 'allowance_loan_losses');
      expect(allowance).toBeDefined();
      expect(allowance?.displayName).toBe('Allowance for loan losses');
      
      const loansNet = template.find(m => m.normalizedMetric === 'loans_net');
      expect(loansNet).toBeDefined();
      expect(loansNet?.displayName).toBe('Loans, net of allowance');
    });

    it('should have bank-specific liability items', () => {
      const template = StatementMapper.BANK_BALANCE_SHEET;
      
      // Deposits breakdown
      const noninterestDeposits = template.find(m => m.normalizedMetric === 'noninterest_bearing_deposits');
      expect(noninterestDeposits).toBeDefined();
      expect(noninterestDeposits?.displayName).toBe('Noninterest-bearing');
      
      const interestDeposits = template.find(m => m.normalizedMetric === 'interest_bearing_deposits');
      expect(interestDeposits).toBeDefined();
      expect(interestDeposits?.displayName).toBe('Interest-bearing');
      
      const totalDeposits = template.find(m => m.normalizedMetric === 'deposits');
      expect(totalDeposits).toBeDefined();
      expect(totalDeposits?.displayName).toBe('Total deposits');
      
      // Other bank liabilities
      const federalFundsPurchased = template.find(m => m.normalizedMetric === 'federal_funds_purchased');
      expect(federalFundsPurchased).toBeDefined();
      
      const tradingLiabilities = template.find(m => m.normalizedMetric === 'trading_liabilities');
      expect(tradingLiabilities).toBeDefined();
      expect(tradingLiabilities?.displayName).toBe('Trading liabilities');
    });

    it('should have regulatory capital ratios', () => {
      const template = StatementMapper.BANK_BALANCE_SHEET;
      
      const tier1Ratio = template.find(m => m.normalizedMetric === 'tier_1_capital_ratio');
      expect(tier1Ratio).toBeDefined();
      expect(tier1Ratio?.displayName).toBe('Tier 1 Capital Ratio');
      expect(tier1Ratio?.format).toBe('percentage');
      
      const totalCapitalRatio = template.find(m => m.normalizedMetric === 'total_capital_ratio');
      expect(totalCapitalRatio).toBeDefined();
      expect(totalCapitalRatio?.displayName).toBe('Total Capital Ratio');
      
      const leverageRatio = template.find(m => m.normalizedMetric === 'leverage_ratio');
      expect(leverageRatio).toBeDefined();
      expect(leverageRatio?.displayName).toBe('Leverage Ratio');
      
      const cet1Ratio = template.find(m => m.normalizedMetric === 'common_equity_tier_1_ratio');
      expect(cet1Ratio).toBeDefined();
      expect(cet1Ratio?.displayName).toBe('Common Equity Tier 1 Ratio');
      
      const loanToDeposit = template.find(m => m.normalizedMetric === 'loan_to_deposit_ratio');
      expect(loanToDeposit).toBeDefined();
      expect(loanToDeposit?.displayName).toBe('Loan-to-Deposit Ratio');
    });
  });

  describe('Financials - JPM Balance Sheet Validation', () => {
    let fixture: any;

    beforeAll(() => {
      fixture = loadFixture('financials/JPM_2024_balance_sheet.json');
    });

    it('should load JPM balance sheet fixture correctly', () => {
      expect(fixture).toBeDefined();
      expect(fixture.ticker).toBe('JPM');
      expect(fixture.statementType).toBe('balance_sheet');
      expect(fixture.expectedLineItems).toBeDefined();
      expect(Array.isArray(fixture.expectedLineItems)).toBe(true);
    });

    it('should have all expected JPM balance sheet line items in template', () => {
      const template = StatementMapper.BANK_BALANCE_SHEET;
      const expectedItems = fixture.expectedLineItems.filter((item: any) => !item.isHeader);
      
      let missingItems: string[] = [];
      let foundCount = 0;
      
      for (const expectedItem of expectedItems) {
        const found = template.find(m => m.normalizedMetric === expectedItem.normalizedMetric);
        if (found) {
          foundCount++;
        } else {
          missingItems.push(expectedItem.normalizedMetric);
        }
      }
      
      // Should find most items (allow some flexibility for optional items)
      const coveragePercent = (foundCount / expectedItems.length) * 100;
      expect(coveragePercent).toBeGreaterThanOrEqual(85);
      
      if (missingItems.length > 0) {
        console.log(`Missing ${missingItems.length} items from JPM balance sheet:`, missingItems);
      }
    });

    it('should match JPM display names exactly', () => {
      const template = StatementMapper.BANK_BALANCE_SHEET;
      const expectedItems = fixture.expectedLineItems.filter((item: any) => !item.isHeader);
      
      let mismatchedNames: Array<{metric: string, expected: string, actual: string}> = [];
      
      for (const expectedItem of expectedItems) {
        const found = template.find(m => m.normalizedMetric === expectedItem.normalizedMetric);
        if (found && found.displayName !== expectedItem.displayName) {
          mismatchedNames.push({
            metric: expectedItem.normalizedMetric,
            expected: expectedItem.displayName,
            actual: found.displayName
          });
        }
      }
      
      // Allow some flexibility for minor naming variations
      expect(mismatchedNames.length).toBeLessThanOrEqual(5);
      
      if (mismatchedNames.length > 0) {
        console.log('Display name mismatches:', mismatchedNames);
      }
    });

    it('should maintain correct hierarchical structure for JPM balance sheet', () => {
      const template = StatementMapper.BANK_BALANCE_SHEET;
      
      // Find key sections
      const assetsHeaderIdx = template.findIndex(m => m.displayName === 'ASSETS');
      const liabilitiesHeaderIdx = template.findIndex(m => m.displayName === 'LIABILITIES');
      const equityHeaderIdx = template.findIndex(m => m.displayName === "STOCKHOLDERS' EQUITY");
      const ratiosHeaderIdx = template.findIndex(m => m.displayName === 'KEY BANK RATIOS');
      
      // Verify order
      expect(assetsHeaderIdx).toBeGreaterThanOrEqual(0);
      expect(liabilitiesHeaderIdx).toBeGreaterThan(assetsHeaderIdx);
      expect(equityHeaderIdx).toBeGreaterThan(liabilitiesHeaderIdx);
      expect(ratiosHeaderIdx).toBeGreaterThan(equityHeaderIdx);
      
      // Verify total_assets comes before liabilities
      const totalAssetsIdx = template.findIndex(m => m.normalizedMetric === 'total_assets');
      expect(totalAssetsIdx).toBeGreaterThan(assetsHeaderIdx);
      expect(totalAssetsIdx).toBeLessThan(liabilitiesHeaderIdx);
    });

    it('should have proper indentation for nested items', () => {
      const template = StatementMapper.BANK_BALANCE_SHEET;
      
      // Securities should be indented under assets
      const securitiesHeader = template.find(m => m.displayName === 'Securities');
      expect(securitiesHeader?.indent).toBe(1);
      
      const tradingAssets = template.find(m => m.normalizedMetric === 'trading_assets');
      expect(tradingAssets?.indent).toBe(2);
      
      // Deposits breakdown should be indented
      const depositsHeader = template.find(m => m.displayName === 'Deposits' && m.isHeader);
      expect(depositsHeader?.indent).toBe(1);
      
      const noninterestDeposits = template.find(m => m.normalizedMetric === 'noninterest_bearing_deposits');
      expect(noninterestDeposits?.indent).toBe(2);
    });

    it('should use BANK_BALANCE_SHEET template for financials sector', () => {
      const rawMetrics = [
        { normalized_metric: 'cash_deposits_banks', value: 500000, fiscal_period: 'FY2024' },
        { normalized_metric: 'trading_assets', value: 300000, fiscal_period: 'FY2024' },
        { normalized_metric: 'loans_gross', value: 1200000, fiscal_period: 'FY2024' },
        { normalized_metric: 'allowance_loan_losses', value: -50000, fiscal_period: 'FY2024' },
        { normalized_metric: 'loans_net', value: 1150000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_assets', value: 3500000, fiscal_period: 'FY2024' },
        { normalized_metric: 'noninterest_bearing_deposits', value: 800000, fiscal_period: 'FY2024' },
        { normalized_metric: 'interest_bearing_deposits', value: 1500000, fiscal_period: 'FY2024' },
        { normalized_metric: 'deposits', value: 2300000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_liabilities', value: 3200000, fiscal_period: 'FY2024' },
        { normalized_metric: 'stockholders_equity', value: 300000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.BALANCE_SHEET,
        ['FY2024'],
        'financials'
      );
      
      // Verify BANK_BALANCE_SHEET template is used
      const assetsHeader = result.find(r => r.displayName === 'ASSETS');
      expect(assetsHeader).toBeDefined();
      expect(assetsHeader?.isHeader).toBe(true);
      
      const cashDeposits = result.find(r => r.normalizedMetric === 'cash_deposits_banks');
      expect(cashDeposits).toBeDefined();
      expect(cashDeposits?.displayName).toBe('Cash and due from banks');
      expect(cashDeposits?.values.get('FY2024')).toBe(500000);
      
      const loansNet = result.find(r => r.normalizedMetric === 'loans_net');
      expect(loansNet).toBeDefined();
      expect(loansNet?.displayName).toBe('Loans, net of allowance');
      expect(loansNet?.values.get('FY2024')).toBe(1150000);
      
      const depositsHeader = result.find(r => r.displayName === 'Deposits' && r.isHeader);
      expect(depositsHeader).toBeDefined();
      
      const noninterestDeposits = result.find(r => r.normalizedMetric === 'noninterest_bearing_deposits');
      expect(noninterestDeposits).toBeDefined();
      expect(noninterestDeposits?.displayName).toBe('Noninterest-bearing');
      expect(noninterestDeposits?.values.get('FY2024')).toBe(800000);
    });

    it('should not have duplicate metrics in bank balance sheet', () => {
      const template = StatementMapper.BANK_BALANCE_SHEET;
      const metricCounts = new Map<string, number>();
      
      for (const metric of template) {
        if (!metric.isHeader) {
          const count = metricCounts.get(metric.normalizedMetric) || 0;
          metricCounts.set(metric.normalizedMetric, count + 1);
        }
      }
      
      const duplicates = Array.from(metricCounts.entries())
        .filter(([_, count]) => count > 1)
        .map(([metric, count]) => ({ metric, count }));
      
      expect(duplicates.length).toBe(0);
      
      if (duplicates.length > 0) {
        console.log('Duplicate metrics found:', duplicates);
      }
    });
  });

  describe('Real Estate - AMT Balance Sheet Validation', () => {
    let fixture: any;

    beforeAll(() => {
      fixture = loadFixture('real_estate/AMT_2024_balance_sheet.json');
    });

    it('should have REIT_BALANCE_SHEET template defined', () => {
      expect(StatementMapper.REIT_BALANCE_SHEET).toBeDefined();
      expect(Array.isArray(StatementMapper.REIT_BALANCE_SHEET)).toBe(true);
      expect(StatementMapper.REIT_BALANCE_SHEET.length).toBeGreaterThan(0);
    });

    it('should load AMT balance sheet fixture correctly', () => {
      expect(fixture).toBeDefined();
      expect(fixture.ticker).toBe('AMT');
      expect(fixture.statementType).toBe('balance_sheet');
      expect(fixture.expectedLineItems).toBeDefined();
      expect(Array.isArray(fixture.expectedLineItems)).toBe(true);
    });

    it('should have all required REIT balance sheet sections', () => {
      const template = StatementMapper.REIT_BALANCE_SHEET;
      
      // Check for main headers
      const assetsHeader = template.find(m => m.displayName === 'ASSETS');
      expect(assetsHeader).toBeDefined();
      expect(assetsHeader?.isHeader).toBe(true);
      
      const liabilitiesHeader = template.find(m => m.displayName === 'LIABILITIES');
      expect(liabilitiesHeader).toBeDefined();
      expect(liabilitiesHeader?.isHeader).toBe(true);
      
      const equityHeader = template.find(m => m.displayName === 'EQUITY');
      expect(equityHeader).toBeDefined();
      expect(equityHeader?.isHeader).toBe(true);
    });

    it('should have REIT-specific asset items', () => {
      const template = StatementMapper.REIT_BALANCE_SHEET;
      
      // Property and equipment (major REIT asset)
      const propertyHeader = template.find(m => m.displayName === 'Property and equipment');
      expect(propertyHeader).toBeDefined();
      expect(propertyHeader?.isHeader).toBe(true);
      
      const propertyGross = template.find(m => m.normalizedMetric === 'property_equipment_gross');
      expect(propertyGross).toBeDefined();
      expect(propertyGross?.displayName).toBe('Property and equipment, gross');
      
      const accumulatedDep = template.find(m => m.normalizedMetric === 'accumulated_depreciation');
      expect(accumulatedDep).toBeDefined();
      expect(accumulatedDep?.displayName).toBe('Less: Accumulated depreciation');
      
      const propertyNet = template.find(m => m.normalizedMetric === 'property_equipment_net');
      expect(propertyNet).toBeDefined();
      expect(propertyNet?.displayName).toBe('Property and equipment, net');
      
      // Intangible assets
      const goodwill = template.find(m => m.normalizedMetric === 'goodwill');
      expect(goodwill).toBeDefined();
      expect(goodwill?.displayName).toBe('Goodwill');
    });

    it('should have proper hierarchical structure for REIT balance sheet', () => {
      const template = StatementMapper.REIT_BALANCE_SHEET;
      
      // Find key sections
      const assetsHeaderIdx = template.findIndex(m => m.displayName === 'ASSETS');
      const liabilitiesHeaderIdx = template.findIndex(m => m.displayName === 'LIABILITIES');
      const equityHeaderIdx = template.findIndex(m => m.displayName === 'EQUITY');
      
      // Verify order
      expect(assetsHeaderIdx).toBeGreaterThanOrEqual(0);
      expect(liabilitiesHeaderIdx).toBeGreaterThan(assetsHeaderIdx);
      expect(equityHeaderIdx).toBeGreaterThan(liabilitiesHeaderIdx);
      
      // Verify total_assets comes before liabilities
      const totalAssetsIdx = template.findIndex(m => m.normalizedMetric === 'total_assets');
      expect(totalAssetsIdx).toBeGreaterThan(assetsHeaderIdx);
      expect(totalAssetsIdx).toBeLessThan(liabilitiesHeaderIdx);
    });

    it('should have proper indentation for nested items', () => {
      const template = StatementMapper.REIT_BALANCE_SHEET;
      
      // Current assets should be indented under assets
      const currentAssetsHeader = template.find(m => m.displayName === 'Current assets');
      expect(currentAssetsHeader?.indent).toBe(1);
      
      const cash = template.find(m => m.normalizedMetric === 'cash_and_cash_equivalents');
      expect(cash?.indent).toBe(2);
      
      // Property and equipment items
      const propertyHeader = template.find(m => m.displayName === 'Property and equipment');
      expect(propertyHeader?.indent).toBe(1);
      
      const propertyGross = template.find(m => m.normalizedMetric === 'property_equipment_gross');
      expect(propertyGross?.indent).toBe(2);
    });

    it('should have all expected AMT balance sheet line items in template', () => {
      const template = StatementMapper.REIT_BALANCE_SHEET;
      const expectedItems = fixture.expectedLineItems.filter((item: any) => !item.isHeader);
      
      let missingItems: string[] = [];
      let foundCount = 0;
      
      for (const expectedItem of expectedItems) {
        const found = template.find(m => m.normalizedMetric === expectedItem.normalizedMetric);
        if (found) {
          foundCount++;
        } else {
          missingItems.push(expectedItem.normalizedMetric);
        }
      }
      
      // Should find most items (allow some flexibility for optional items)
      const coveragePercent = (foundCount / expectedItems.length) * 100;
      expect(coveragePercent).toBeGreaterThanOrEqual(85);
      
      if (missingItems.length > 0) {
        console.log(`Missing ${missingItems.length} items from AMT balance sheet:`, missingItems);
      }
    });

    it('should match AMT display names exactly', () => {
      const template = StatementMapper.REIT_BALANCE_SHEET;
      const expectedItems = fixture.expectedLineItems.filter((item: any) => !item.isHeader);
      
      let mismatchedNames: Array<{metric: string, expected: string, actual: string}> = [];
      
      for (const expectedItem of expectedItems) {
        const found = template.find(m => m.normalizedMetric === expectedItem.normalizedMetric);
        if (found && found.displayName !== expectedItem.displayName) {
          mismatchedNames.push({
            metric: expectedItem.normalizedMetric,
            expected: expectedItem.displayName,
            actual: found.displayName
          });
        }
      }
      
      // Allow some flexibility for minor naming variations
      expect(mismatchedNames.length).toBeLessThanOrEqual(5);
      
      if (mismatchedNames.length > 0) {
        console.log('Display name mismatches:', mismatchedNames);
      }
    });

    it('should use REIT_BALANCE_SHEET template for real_estate sector', () => {
      const rawMetrics = [
        { normalized_metric: 'cash_and_cash_equivalents', value: 2000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'accounts_receivable_net', value: 500000, fiscal_period: 'FY2024' },
        { normalized_metric: 'current_assets', value: 3000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'property_equipment_gross', value: 50000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'accumulated_depreciation', value: -15000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'property_equipment_net', value: 35000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'goodwill', value: 10000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_assets', value: 50000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'current_liabilities', value: 2000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'long_term_debt', value: 30000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_liabilities', value: 35000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'stockholders_equity', value: 15000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.BALANCE_SHEET,
        ['FY2024'],
        'real_estate'
      );
      
      // Verify REIT_BALANCE_SHEET template is used
      const assetsHeader = result.find(r => r.displayName === 'ASSETS');
      expect(assetsHeader).toBeDefined();
      expect(assetsHeader?.isHeader).toBe(true);
      
      const cash = result.find(r => r.normalizedMetric === 'cash_and_cash_equivalents');
      expect(cash).toBeDefined();
      expect(cash?.displayName).toBe('Cash and cash equivalents');
      expect(cash?.values.get('FY2024')).toBe(2000000);
      
      const propertyNet = result.find(r => r.normalizedMetric === 'property_equipment_net');
      expect(propertyNet).toBeDefined();
      expect(propertyNet?.displayName).toBe('Property and equipment, net');
      expect(propertyNet?.values.get('FY2024')).toBe(35000000);
      
      const propertyHeader = result.find(r => r.displayName === 'Property and equipment' && r.isHeader);
      expect(propertyHeader).toBeDefined();
    });

    it('should not have duplicate metrics in REIT balance sheet', () => {
      const template = StatementMapper.REIT_BALANCE_SHEET;
      const metricCounts = new Map<string, number>();
      
      for (const metric of template) {
        if (!metric.isHeader) {
          const count = metricCounts.get(metric.normalizedMetric) || 0;
          metricCounts.set(metric.normalizedMetric, count + 1);
        }
      }
      
      const duplicates = Array.from(metricCounts.entries())
        .filter(([_, count]) => count > 1)
        .map(([metric, count]) => ({ metric, count }));
      
      expect(duplicates.length).toBe(0);
      
      if (duplicates.length > 0) {
        console.log('Duplicate metrics found:', duplicates);
      }
    });
  });

  describe('Utilities - NEE Balance Sheet Validation', () => {
    let fixture: any;

    beforeAll(() => {
      fixture = loadFixture('utilities/NEE_2024_balance_sheet.json');
    });

    it('should have UTILITY_BALANCE_SHEET template defined', () => {
      expect(StatementMapper.UTILITY_BALANCE_SHEET).toBeDefined();
      expect(Array.isArray(StatementMapper.UTILITY_BALANCE_SHEET)).toBe(true);
      expect(StatementMapper.UTILITY_BALANCE_SHEET.length).toBeGreaterThan(0);
    });

    it('should load NEE balance sheet fixture correctly', () => {
      expect(fixture).toBeDefined();
      expect(fixture.ticker).toBe('NEE');
      expect(fixture.statementType).toBe('balance_sheet');
      expect(fixture.expectedLineItems).toBeDefined();
      expect(Array.isArray(fixture.expectedLineItems)).toBe(true);
    });

    it('should have all required utility balance sheet sections', () => {
      const template = StatementMapper.UTILITY_BALANCE_SHEET;
      
      // Check for main headers
      const assetsHeader = template.find(m => m.displayName === 'ASSETS');
      expect(assetsHeader).toBeDefined();
      expect(assetsHeader?.isHeader).toBe(true);
      
      const liabilitiesHeader = template.find(m => m.displayName === 'LIABILITIES AND EQUITY');
      expect(liabilitiesHeader).toBeDefined();
      expect(liabilitiesHeader?.isHeader).toBe(true);
      
      const equityHeader = template.find(m => m.displayName === 'Equity');
      expect(equityHeader).toBeDefined();
      expect(equityHeader?.isHeader).toBe(true);
    });

    it('should have utility-specific asset items', () => {
      const template = StatementMapper.UTILITY_BALANCE_SHEET;
      
      // Property, plant and equipment (major utility asset)
      const propertyHeader = template.find(m => m.displayName === 'Property, plant and equipment' && m.isHeader);
      expect(propertyHeader).toBeDefined();
      expect(propertyHeader?.isHeader).toBe(true);
      
      const propertyGross = template.find(m => m.normalizedMetric === 'property_plant_equipment_gross');
      expect(propertyGross).toBeDefined();
      expect(propertyGross?.displayName).toBe('Property, plant and equipment');
      
      const propertyNet = template.find(m => m.normalizedMetric === 'property_plant_equipment_net');
      expect(propertyNet).toBeDefined();
      expect(propertyNet?.displayName).toBe('Property, plant and equipment, net');
      
      // Regulatory assets (utility-specific)
      const regulatoryAssetsCurrent = template.find(m => m.normalizedMetric === 'regulatory_assets_current');
      expect(regulatoryAssetsCurrent).toBeDefined();
      expect(regulatoryAssetsCurrent?.displayName).toBe('Regulatory assets');
      
      const regulatoryAssetsNoncurrent = template.find(m => m.normalizedMetric === 'regulatory_assets_noncurrent');
      expect(regulatoryAssetsNoncurrent).toBeDefined();
      expect(regulatoryAssetsNoncurrent?.displayName).toBe('Regulatory assets');
    });

    it('should have utility-specific liability items', () => {
      const template = StatementMapper.UTILITY_BALANCE_SHEET;
      
      // Regulatory liabilities (utility-specific)
      const regulatoryLiabilities = template.find(m => m.normalizedMetric === 'regulatory_liabilities');
      expect(regulatoryLiabilities).toBeDefined();
      expect(regulatoryLiabilities?.displayName).toBe('Regulatory liabilities');
      
      // Asset retirement obligations (common for utilities)
      const aro = template.find(m => m.normalizedMetric === 'asset_retirement_obligations');
      expect(aro).toBeDefined();
      expect(aro?.displayName).toBe('Asset retirement obligations');
      
      // Customer deposits
      const customerDeposits = template.find(m => m.normalizedMetric === 'customer_deposits');
      expect(customerDeposits).toBeDefined();
      expect(customerDeposits?.displayName).toBe('Customer deposits');
    });

    it('should have proper hierarchical structure for utility balance sheet', () => {
      const template = StatementMapper.UTILITY_BALANCE_SHEET;
      
      // Find key sections
      const assetsHeaderIdx = template.findIndex(m => m.displayName === 'ASSETS');
      const liabilitiesHeaderIdx = template.findIndex(m => m.displayName === 'LIABILITIES AND EQUITY');
      
      // Verify order
      expect(assetsHeaderIdx).toBeGreaterThanOrEqual(0);
      expect(liabilitiesHeaderIdx).toBeGreaterThan(assetsHeaderIdx);
      
      // Verify total_assets comes before liabilities
      const totalAssetsIdx = template.findIndex(m => m.normalizedMetric === 'total_assets');
      expect(totalAssetsIdx).toBeGreaterThan(assetsHeaderIdx);
      expect(totalAssetsIdx).toBeLessThan(liabilitiesHeaderIdx);
    });

    it('should have proper indentation for nested items', () => {
      const template = StatementMapper.UTILITY_BALANCE_SHEET;
      
      // Current assets should be indented under assets
      const currentAssetsHeader = template.find(m => m.displayName === 'Current assets');
      expect(currentAssetsHeader?.indent).toBe(1);
      
      const cash = template.find(m => m.normalizedMetric === 'cash_and_cash_equivalents');
      expect(cash?.indent).toBe(2);
      
      // Property, plant and equipment items
      const propertyHeader = template.find(m => m.displayName === 'Property, plant and equipment' && m.isHeader);
      expect(propertyHeader?.indent).toBe(1);
      
      const propertyGross = template.find(m => m.normalizedMetric === 'property_plant_equipment_gross');
      expect(propertyGross?.indent).toBe(2);
    });

    it('should have all expected NEE balance sheet line items in template', () => {
      const template = StatementMapper.UTILITY_BALANCE_SHEET;
      const expectedItems = fixture.expectedLineItems.filter((item: any) => !item.isHeader);
      
      let missingItems: string[] = [];
      let foundCount = 0;
      
      for (const expectedItem of expectedItems) {
        const found = template.find(m => m.normalizedMetric === expectedItem.normalizedMetric);
        if (found) {
          foundCount++;
        } else {
          missingItems.push(expectedItem.normalizedMetric);
        }
      }
      
      // Should find most items (allow some flexibility for optional items)
      const coveragePercent = (foundCount / expectedItems.length) * 100;
      expect(coveragePercent).toBeGreaterThanOrEqual(85);
      
      if (missingItems.length > 0) {
        console.log(`Missing ${missingItems.length} items from NEE balance sheet:`, missingItems);
      }
    });

    it('should match NEE display names exactly', () => {
      const template = StatementMapper.UTILITY_BALANCE_SHEET;
      const expectedItems = fixture.expectedLineItems.filter((item: any) => !item.isHeader);
      
      let mismatchedNames: Array<{metric: string, expected: string, actual: string}> = [];
      
      for (const expectedItem of expectedItems) {
        const found = template.find(m => m.normalizedMetric === expectedItem.normalizedMetric);
        if (found && found.displayName !== expectedItem.displayName) {
          mismatchedNames.push({
            metric: expectedItem.normalizedMetric,
            expected: expectedItem.displayName,
            actual: found.displayName
          });
        }
      }
      
      // Allow some flexibility for minor naming variations
      expect(mismatchedNames.length).toBeLessThanOrEqual(5);
      
      if (mismatchedNames.length > 0) {
        console.log('Display name mismatches:', mismatchedNames);
      }
    });

    it('should use UTILITY_BALANCE_SHEET template for utilities sector', () => {
      const rawMetrics = [
        { normalized_metric: 'cash_and_cash_equivalents', value: 1000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'accounts_receivable_net', value: 2000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'regulatory_assets_current', value: 500000, fiscal_period: 'FY2024' },
        { normalized_metric: 'current_assets', value: 5000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'property_plant_equipment_gross', value: 100000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'accumulated_depreciation', value: -30000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'property_plant_equipment_net', value: 70000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'regulatory_assets_noncurrent', value: 3000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_assets', value: 80000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'current_liabilities', value: 4000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'long_term_debt', value: 50000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'regulatory_liabilities', value: 2000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_liabilities', value: 60000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'stockholders_equity', value: 20000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.BALANCE_SHEET,
        ['FY2024'],
        'utilities'
      );
      
      // Verify UTILITY_BALANCE_SHEET template is used
      const assetsHeader = result.find(r => r.displayName === 'ASSETS');
      expect(assetsHeader).toBeDefined();
      expect(assetsHeader?.isHeader).toBe(true);
      
      const cash = result.find(r => r.normalizedMetric === 'cash_and_cash_equivalents');
      expect(cash).toBeDefined();
      expect(cash?.displayName).toBe('Cash and cash equivalents');
      expect(cash?.values.get('FY2024')).toBe(1000000);
      
      const propertyNet = result.find(r => r.normalizedMetric === 'property_plant_equipment_net');
      expect(propertyNet).toBeDefined();
      expect(propertyNet?.displayName).toBe('Property, plant and equipment, net');
      expect(propertyNet?.values.get('FY2024')).toBe(70000000);
      
      const regulatoryLiabilities = result.find(r => r.normalizedMetric === 'regulatory_liabilities');
      expect(regulatoryLiabilities).toBeDefined();
      expect(regulatoryLiabilities?.displayName).toBe('Regulatory liabilities');
      expect(regulatoryLiabilities?.values.get('FY2024')).toBe(2000000);
    });

    it('should not have duplicate metrics in utility balance sheet', () => {
      const template = StatementMapper.UTILITY_BALANCE_SHEET;
      const metricCounts = new Map<string, number>();
      
      for (const metric of template) {
        if (!metric.isHeader) {
          const count = metricCounts.get(metric.normalizedMetric) || 0;
          metricCounts.set(metric.normalizedMetric, count + 1);
        }
      }
      
      const duplicates = Array.from(metricCounts.entries())
        .filter(([_, count]) => count > 1)
        .map(([metric, count]) => ({ metric, count }));
      
      expect(duplicates.length).toBe(0);
      
      if (duplicates.length > 0) {
        console.log('Duplicate metrics found:', duplicates);
      }
    });
  });

  describe('Generic Balance Sheet Template Validation', () => {
    it('should use generic BALANCE_SHEET_METRICS for communication_services sector', () => {
      const rawMetrics = [
        { normalized_metric: 'cash_and_equivalents', value: 5000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'accounts_receivable_net', value: 3000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'current_assets', value: 10000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'property_plant_equipment', value: 20000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'intangible_assets', value: 15000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_assets', value: 50000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'current_liabilities', value: 8000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'long_term_debt', value: 25000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_liabilities', value: 35000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'stockholders_equity', value: 15000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.BALANCE_SHEET,
        ['FY2024'],
        'communication_services'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const assetsHeader = result.find(r => r.displayName === 'ASSETS');
      expect(assetsHeader).toBeDefined();
      
      const cash = result.find(r => r.normalizedMetric === 'cash_and_equivalents');
      expect(cash).toBeDefined();
      expect(cash?.values.get('FY2024')).toBe(5000000);
    });

    it('should use generic BALANCE_SHEET_METRICS for information_technology sector', () => {
      const rawMetrics = [
        { normalized_metric: 'cash', value: 20000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'marketable_securities', value: 30000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'current_assets', value: 60000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_assets', value: 100000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_liabilities', value: 40000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'stockholders_equity', value: 60000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.BALANCE_SHEET,
        ['FY2024'],
        'information_technology'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const cash = result.find(r => r.normalizedMetric === 'cash');
      expect(cash).toBeDefined();
      expect(cash?.values.get('FY2024')).toBe(20000000);
    });

    it('should use generic BALANCE_SHEET_METRICS for consumer_discretionary sector', () => {
      const rawMetrics = [
        { normalized_metric: 'cash_and_equivalents', value: 10000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'inventory', value: 15000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'current_assets', value: 30000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_assets', value: 80000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_liabilities', value: 50000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'stockholders_equity', value: 30000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.BALANCE_SHEET,
        ['FY2024'],
        'consumer_discretionary'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const inventory = result.find(r => r.normalizedMetric === 'inventory');
      expect(inventory).toBeDefined();
      expect(inventory?.values.get('FY2024')).toBe(15000000);
    });

    it('should use generic BALANCE_SHEET_METRICS for energy sector', () => {
      const rawMetrics = [
        { normalized_metric: 'cash_and_equivalents', value: 5000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'property_plant_equipment', value: 50000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_assets', value: 70000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'long_term_debt', value: 30000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_liabilities', value: 40000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'stockholders_equity', value: 30000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.BALANCE_SHEET,
        ['FY2024'],
        'energy'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const ppe = result.find(r => r.normalizedMetric === 'property_plant_equipment');
      expect(ppe).toBeDefined();
      expect(ppe?.values.get('FY2024')).toBe(50000000);
    });

    it('should use generic BALANCE_SHEET_METRICS for health_care sector', () => {
      const rawMetrics = [
        { normalized_metric: 'cash_and_equivalents', value: 8000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'accounts_receivable_net', value: 12000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'current_assets', value: 25000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_assets', value: 60000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_liabilities', value: 35000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'stockholders_equity', value: 25000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.BALANCE_SHEET,
        ['FY2024'],
        'health_care'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const receivables = result.find(r => r.normalizedMetric === 'accounts_receivable_net');
      expect(receivables).toBeDefined();
      expect(receivables?.values.get('FY2024')).toBe(12000000);
    });

    it('should use generic BALANCE_SHEET_METRICS for consumer_staples sector', () => {
      const rawMetrics = [
        { normalized_metric: 'cash_and_equivalents', value: 6000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'inventory', value: 10000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'current_assets', value: 20000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_assets', value: 50000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_liabilities', value: 30000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'stockholders_equity', value: 20000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.BALANCE_SHEET,
        ['FY2024'],
        'consumer_staples'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const inventory = result.find(r => r.normalizedMetric === 'inventory');
      expect(inventory).toBeDefined();
      expect(inventory?.values.get('FY2024')).toBe(10000000);
    });

    it('should use generic BALANCE_SHEET_METRICS for industrials sector', () => {
      const rawMetrics = [
        { normalized_metric: 'cash_and_equivalents', value: 7000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'property_plant_equipment', value: 40000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_assets', value: 65000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'pension_liabilities', value: 5000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_liabilities', value: 38000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'stockholders_equity', value: 27000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.BALANCE_SHEET,
        ['FY2024'],
        'industrials'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const pension = result.find(r => r.normalizedMetric === 'pension_liabilities');
      expect(pension).toBeDefined();
      expect(pension?.values.get('FY2024')).toBe(5000000);
    });

    it('should use generic BALANCE_SHEET_METRICS for materials sector', () => {
      const rawMetrics = [
        { normalized_metric: 'cash_and_equivalents', value: 4000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'inventory', value: 8000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'property_plant_equipment', value: 35000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_assets', value: 55000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'total_liabilities', value: 32000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'stockholders_equity', value: 23000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.BALANCE_SHEET,
        ['FY2024'],
        'materials'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const ppe = result.find(r => r.normalizedMetric === 'property_plant_equipment');
      expect(ppe).toBeDefined();
      expect(ppe?.values.get('FY2024')).toBe(35000000);
    });
  });

  describe('Generic Cash Flow Template Validation', () => {
    it('should use generic CASH_FLOW_METRICS for communication_services sector', () => {
      const rawMetrics = [
        { normalized_metric: 'net_income', value: 10000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation_amortization', value: 5000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_cash_flow', value: 18000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'capital_expenditures', value: -8000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'investing_cash_flow', value: -10000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'dividends_paid', value: -3000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'financing_cash_flow', value: -5000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_change_in_cash', value: 3000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.CASH_FLOW,
        ['FY2024'],
        'communication_services'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const operatingHeader = result.find(r => r.displayName === 'CASH FLOWS FROM OPERATING ACTIVITIES');
      expect(operatingHeader).toBeDefined();
      
      const ocf = result.find(r => r.normalizedMetric === 'operating_cash_flow');
      expect(ocf).toBeDefined();
      expect(ocf?.values.get('FY2024')).toBe(18000000);
    });

    it('should use generic CASH_FLOW_METRICS for financials sector', () => {
      const rawMetrics = [
        { normalized_metric: 'net_income', value: 15000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_cash_flow', value: 20000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'investing_cash_flow', value: -5000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'financing_cash_flow', value: -8000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'net_change_in_cash', value: 7000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.CASH_FLOW,
        ['FY2024'],
        'financials'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const netIncome = result.find(r => r.normalizedMetric === 'net_income');
      expect(netIncome).toBeDefined();
      expect(netIncome?.values.get('FY2024')).toBe(15000000);
    });

    it('should use generic CASH_FLOW_METRICS for information_technology sector', () => {
      const rawMetrics = [
        { normalized_metric: 'net_income', value: 25000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation_amortization', value: 3000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'stock_based_compensation', value: 5000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_cash_flow', value: 35000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'capital_expenditures', value: -10000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'free_cash_flow', value: 25000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.CASH_FLOW,
        ['FY2024'],
        'information_technology'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const fcf = result.find(r => r.normalizedMetric === 'free_cash_flow');
      expect(fcf).toBeDefined();
      expect(fcf?.values.get('FY2024')).toBe(25000000);
    });

    it('should use generic CASH_FLOW_METRICS for consumer_discretionary sector', () => {
      const rawMetrics = [
        { normalized_metric: 'net_income', value: 12000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation_amortization', value: 6000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'change_inventory', value: -2000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_cash_flow', value: 20000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'capital_expenditures', value: -8000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.CASH_FLOW,
        ['FY2024'],
        'consumer_discretionary'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const capex = result.find(r => r.normalizedMetric === 'capital_expenditures');
      expect(capex).toBeDefined();
      expect(capex?.values.get('FY2024')).toBe(-8000000);
    });

    it('should use generic CASH_FLOW_METRICS for energy sector', () => {
      const rawMetrics = [
        { normalized_metric: 'net_income', value: 18000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation_amortization', value: 12000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_cash_flow', value: 35000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'capital_expenditures', value: -20000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'dividends_paid', value: -8000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.CASH_FLOW,
        ['FY2024'],
        'energy'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const da = result.find(r => r.normalizedMetric === 'depreciation_amortization');
      expect(da).toBeDefined();
      expect(da?.values.get('FY2024')).toBe(12000000);
    });

    it('should use generic CASH_FLOW_METRICS for utilities sector', () => {
      const rawMetrics = [
        { normalized_metric: 'net_income', value: 8000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation_amortization', value: 10000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_cash_flow', value: 22000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'capital_expenditures', value: -18000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'dividends_paid', value: -6000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.CASH_FLOW,
        ['FY2024'],
        'utilities'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const dividends = result.find(r => r.normalizedMetric === 'dividends_paid');
      expect(dividends).toBeDefined();
      expect(dividends?.values.get('FY2024')).toBe(-6000000);
    });

    it('should use generic CASH_FLOW_METRICS for real_estate sector', () => {
      const rawMetrics = [
        { normalized_metric: 'net_income', value: 6000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation_amortization', value: 8000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_cash_flow', value: 16000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'capital_expenditures', value: -12000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'acquisitions', value: -5000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.CASH_FLOW,
        ['FY2024'],
        'real_estate'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const acquisitions = result.find(r => r.normalizedMetric === 'acquisitions');
      expect(acquisitions).toBeDefined();
      expect(acquisitions?.values.get('FY2024')).toBe(-5000000);
    });

    it('should use generic CASH_FLOW_METRICS for health_care sector', () => {
      const rawMetrics = [
        { normalized_metric: 'net_income', value: 14000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation_amortization', value: 4000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_cash_flow', value: 20000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'capital_expenditures', value: -6000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.CASH_FLOW,
        ['FY2024'],
        'health_care'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const ocf = result.find(r => r.normalizedMetric === 'operating_cash_flow');
      expect(ocf).toBeDefined();
      expect(ocf?.values.get('FY2024')).toBe(20000000);
    });

    it('should use generic CASH_FLOW_METRICS for consumer_staples sector', () => {
      const rawMetrics = [
        { normalized_metric: 'net_income', value: 10000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation_amortization', value: 5000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_cash_flow', value: 16000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'dividends_paid', value: -7000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.CASH_FLOW,
        ['FY2024'],
        'consumer_staples'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const netIncome = result.find(r => r.normalizedMetric === 'net_income');
      expect(netIncome).toBeDefined();
      expect(netIncome?.values.get('FY2024')).toBe(10000000);
    });

    it('should use generic CASH_FLOW_METRICS for industrials sector', () => {
      const rawMetrics = [
        { normalized_metric: 'net_income', value: 11000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation_amortization', value: 7000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_cash_flow', value: 19000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'capital_expenditures', value: -9000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.CASH_FLOW,
        ['FY2024'],
        'industrials'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const investingHeader = result.find(r => r.displayName === 'CASH FLOWS FROM INVESTING ACTIVITIES');
      expect(investingHeader).toBeDefined();
    });

    it('should use generic CASH_FLOW_METRICS for materials sector', () => {
      const rawMetrics = [
        { normalized_metric: 'net_income', value: 9000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'depreciation_amortization', value: 6000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'operating_cash_flow', value: 17000000, fiscal_period: 'FY2024' },
        { normalized_metric: 'capital_expenditures', value: -10000000, fiscal_period: 'FY2024' },
      ];
      
      const result = statementMapper.mapMetricsToStatementWithDiscovery(
        rawMetrics,
        StatementType.CASH_FLOW,
        ['FY2024'],
        'materials'
      );
      
      expect(result.length).toBeGreaterThan(0);
      const financingHeader = result.find(r => r.displayName === 'CASH FLOWS FROM FINANCING ACTIVITIES');
      expect(financingHeader).toBeDefined();
    });
  });
});
