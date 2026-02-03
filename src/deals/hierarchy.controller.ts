import { Controller, Get, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { MetricHierarchyService } from './metric-hierarchy.service';
import { TenantGuard } from '../tenant/tenant.guard';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('deals/:dealId/hierarchy')
@UseGuards(TenantGuard)
export class HierarchyController {
  constructor(
    private readonly metricHierarchyService: MetricHierarchyService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':fiscalPeriod')
  async getHierarchy(
    @Param('dealId') dealId: string,
    @Param('fiscalPeriod') fiscalPeriod: string,
  ) {
    try {
      // Get deal to find ticker
      const deal = await this.prisma.deal.findUnique({
        where: { id: dealId },
      });

      if (!deal || !deal.ticker) {
        // Return mock hierarchy if no deal/ticker
        return {
          hierarchy: this.getMockHierarchy(),
          metadata: {
            dealId,
            fiscalPeriod,
            totalMetrics: 10,
            rootMetrics: 3,
            source: 'mock',
          },
        };
      }

      // Get financial metrics for this ticker and period
      const metrics = await this.prisma.financialMetric.findMany({
        where: {
          ticker: deal.ticker,
          fiscalPeriod,
        },
        orderBy: [
          { statementType: 'asc' },
        ],
      });

      if (metrics.length === 0) {
        // Return mock hierarchy if no metrics
        return {
          hierarchy: this.getMockHierarchy(),
          metadata: {
            dealId,
            fiscalPeriod,
            totalMetrics: 0,
            rootMetrics: 3,
            source: 'mock',
          },
        };
      }

      // Build real hierarchy from metrics
      const hierarchy = this.buildHierarchyFromMetrics(metrics);

      return {
        hierarchy,
        metadata: {
          dealId,
          fiscalPeriod,
          ticker: deal.ticker,
          totalMetrics: metrics.length,
          rootMetrics: hierarchy.length,
          source: 'database',
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to load hierarchy',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Build hierarchy structure from flat metrics
   */
  private buildHierarchyFromMetrics(metrics: any[]): any[] {
    // Group metrics by statement type
    const byStatement: Record<string, any[]> = {};
    
    for (const metric of metrics) {
      const stmt = metric.statementType || 'other';
      if (!byStatement[stmt]) {
        byStatement[stmt] = [];
      }
      byStatement[stmt].push(metric);
    }

    // Define key metrics for each statement type
    const keyMetrics: Record<string, string[]> = {
      income_statement: ['revenue', 'gross_profit', 'operating_income', 'net_income', 'ebitda'],
      balance_sheet: ['total_assets', 'total_liabilities', 'stockholders_equity', 'cash_and_equivalents'],
      cash_flow: ['operating_cash_flow', 'investing_cash_flow', 'financing_cash_flow', 'free_cash_flow'],
    };

    // Build hierarchy nodes
    const hierarchy: any[] = [];

    // Income Statement hierarchy
    if (byStatement['income_statement']?.length > 0) {
      const incomeMetrics = byStatement['income_statement'];
      
      // Revenue as root with children
      const revenue = incomeMetrics.find(m => m.normalizedMetric === 'revenue');
      if (revenue) {
        const revenueChildren = incomeMetrics.filter(m => 
          m.normalizedMetric?.includes('revenue') && 
          m.normalizedMetric !== 'revenue'
        );
        
        hierarchy.push({
          id: 'revenue',
          name: 'Revenue',
          level: 0,
          hasChildren: revenueChildren.length > 0,
          isKeyDriver: true,
          formula: null,
          value: parseFloat(revenue.value) || 0,
          contribution: null,
          statementType: 'income_statement',
          children: revenueChildren.map((child, idx) => ({
            id: child.normalizedMetric || `revenue_child_${idx}`,
            name: child.rawLabel || child.normalizedMetric,
            level: 1,
            hasChildren: false,
            isKeyDriver: false,
            formula: null,
            value: parseFloat(child.value) || 0,
            contribution: revenue.value ? Math.round((parseFloat(child.value) / parseFloat(revenue.value)) * 1000) / 10 : null,
            statementType: 'income_statement',
            children: [],
          })),
        });
      }

      // Gross Profit
      const grossProfit = incomeMetrics.find(m => m.normalizedMetric === 'gross_profit');
      if (grossProfit) {
        hierarchy.push({
          id: 'gross_profit',
          name: 'Gross Profit',
          level: 0,
          hasChildren: false,
          isKeyDriver: true,
          formula: 'Revenue - Cost of Revenue',
          value: parseFloat(grossProfit.value) || 0,
          contribution: null,
          statementType: 'income_statement',
          children: [],
        });
      }

      // Operating Income
      const operatingIncome = incomeMetrics.find(m => m.normalizedMetric === 'operating_income');
      if (operatingIncome) {
        const opexMetrics = incomeMetrics.filter(m => 
          m.normalizedMetric?.includes('expense') || 
          m.normalizedMetric?.includes('cost')
        ).slice(0, 3);

        hierarchy.push({
          id: 'operating_income',
          name: 'Operating Income',
          level: 0,
          hasChildren: opexMetrics.length > 0,
          isKeyDriver: true,
          formula: 'Gross Profit - Operating Expenses',
          value: parseFloat(operatingIncome.value) || 0,
          contribution: null,
          statementType: 'income_statement',
          children: opexMetrics.map((child, idx) => ({
            id: child.normalizedMetric || `opex_${idx}`,
            name: child.rawLabel || child.normalizedMetric,
            level: 1,
            hasChildren: false,
            isKeyDriver: false,
            formula: null,
            value: parseFloat(child.value) || 0,
            contribution: null,
            statementType: 'income_statement',
            children: [],
          })),
        });
      }

      // Net Income
      const netIncome = incomeMetrics.find(m => m.normalizedMetric === 'net_income');
      if (netIncome) {
        hierarchy.push({
          id: 'net_income',
          name: 'Net Income',
          level: 0,
          hasChildren: false,
          isKeyDriver: true,
          formula: 'Income Before Tax - Tax Expense',
          value: parseFloat(netIncome.value) || 0,
          contribution: null,
          statementType: 'income_statement',
          children: [],
        });
      }
    }

    // Balance Sheet hierarchy
    if (byStatement['balance_sheet']?.length > 0) {
      const bsMetrics = byStatement['balance_sheet'];
      
      const totalAssets = bsMetrics.find(m => m.normalizedMetric === 'total_assets');
      if (totalAssets) {
        const assetChildren = bsMetrics.filter(m => 
          m.normalizedMetric?.includes('assets') && 
          m.normalizedMetric !== 'total_assets'
        ).slice(0, 4);

        hierarchy.push({
          id: 'total_assets',
          name: 'Total Assets',
          level: 0,
          hasChildren: assetChildren.length > 0,
          isKeyDriver: true,
          formula: 'Current Assets + Non-Current Assets',
          value: parseFloat(totalAssets.value) || 0,
          contribution: null,
          statementType: 'balance_sheet',
          children: assetChildren.map((child, idx) => ({
            id: child.normalizedMetric || `asset_${idx}`,
            name: child.rawLabel || child.normalizedMetric,
            level: 1,
            hasChildren: false,
            isKeyDriver: false,
            formula: null,
            value: parseFloat(child.value) || 0,
            contribution: totalAssets.value ? Math.round((parseFloat(child.value) / parseFloat(totalAssets.value)) * 1000) / 10 : null,
            statementType: 'balance_sheet',
            children: [],
          })),
        });
      }
    }

    // Cash Flow hierarchy
    if (byStatement['cash_flow']?.length > 0) {
      const cfMetrics = byStatement['cash_flow'];
      
      const operatingCF = cfMetrics.find(m => m.normalizedMetric === 'operating_cash_flow');
      if (operatingCF) {
        hierarchy.push({
          id: 'operating_cash_flow',
          name: 'Operating Cash Flow',
          level: 0,
          hasChildren: false,
          isKeyDriver: true,
          formula: 'Net Income + Non-Cash Adjustments + Working Capital Changes',
          value: parseFloat(operatingCF.value) || 0,
          contribution: null,
          statementType: 'cash_flow',
          children: [],
        });
      }
    }

    // If no real hierarchy built, return mock
    if (hierarchy.length === 0) {
      return this.getMockHierarchy();
    }

    return hierarchy;
  }

  @Get(':fiscalPeriod/metric/:metricId/children')
  async getChildren(
    @Param('dealId') dealId: string,
    @Param('fiscalPeriod') fiscalPeriod: string,
    @Param('metricId') metricId: string,
  ) {
    try {
      // TODO: Implement when database table is ready
      return {
        children: [],
        metadata: {
          parentId: metricId,
          childCount: 0,
        },
      };
    } catch (error) {
      throw new HttpException(
        'Failed to load children',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':fiscalPeriod/metric/:metricId/path')
  async getPath(
    @Param('dealId') dealId: string,
    @Param('fiscalPeriod') fiscalPeriod: string,
    @Param('metricId') metricId: string,
  ) {
    try {
      // TODO: Implement when database table is ready
      return {
        path: [
          {
            id: metricId,
            name: 'Revenue',
            level: 0,
          },
        ],
        metadata: {
          metricId,
          depth: 1,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to load path',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get mock hierarchy for testing
   */
  private getMockHierarchy(): any[] {
    return [
      {
        id: 'revenue',
        name: 'Revenue',
        level: 0,
        hasChildren: true,
        isKeyDriver: true,
        formula: null,
        contribution: null,
        statementType: 'income_statement',
        children: [
          {
            id: 'product_revenue',
            name: 'Product Revenue',
            level: 1,
            hasChildren: false,
            isKeyDriver: false,
            formula: null,
            contribution: 75.6,
            statementType: 'income_statement',
            children: [],
          },
          {
            id: 'services_revenue',
            name: 'Services Revenue',
            level: 1,
            hasChildren: false,
            isKeyDriver: false,
            formula: null,
            contribution: 24.4,
            statementType: 'income_statement',
            children: [],
          },
        ],
      },
      {
        id: 'gross_profit',
        name: 'Gross Profit',
        level: 0,
        hasChildren: false,
        isKeyDriver: true,
        formula: 'Revenue - COGS',
        contribution: null,
        statementType: 'income_statement',
        children: [],
      },
      {
        id: 'operating_income',
        name: 'Operating Income',
        level: 0,
        hasChildren: false,
        isKeyDriver: true,
        formula: 'Gross Profit - Operating Expenses',
        contribution: null,
        statementType: 'income_statement',
        children: [],
      },
    ];
  }
}
