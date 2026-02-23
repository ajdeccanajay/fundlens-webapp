import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class MetricsService {
  constructor(private prisma: PrismaService) {}

  async createSampleMappings() {
    const sampleMappings = [
      {
        normalizedMetric: 'accounts_payable',
        displayName: 'Accounts Payable',
        statementType: 'balance_sheet',
        synonyms: ['Accounts Payable', 'Trade Payables', 'Payables to Suppliers', 'Trade and Other Payables'],
        xbrlTags: ['us-gaap:AccountsPayableCurrent', 'us-gaap:AccountsPayable'],
        description: 'Amounts owed to suppliers for goods and services purchased on credit',
      },
      {
        normalizedMetric: 'revenue',
        displayName: 'Revenue',
        statementType: 'income_statement',
        synonyms: ['Revenue', 'Revenues', 'Net Revenue', 'Net Revenues', 'Sales', 'Net Sales', 'Total Sales', 'Total Revenue'],
        xbrlTags: ['us-gaap:Revenues', 'us-gaap:SalesRevenueNet'],
        description: 'Total income from sales of goods and services',
      },
      {
        normalizedMetric: 'net_income',
        displayName: 'Net Income',
        statementType: 'income_statement',
        synonyms: ['Net Income', 'Net Earnings', 'Net Profit', 'Net Income Attributable to Common Shareholders'],
        xbrlTags: ['us-gaap:NetIncomeLoss', 'us-gaap:ProfitLoss'],
        description: 'Bottom line profit after all expenses and taxes',
      },
      {
        normalizedMetric: 'gross_profit',
        displayName: 'Gross Profit',
        statementType: 'income_statement',
        synonyms: ['Gross Profit', 'Gross Income', 'Gross Margin'],
        xbrlTags: ['us-gaap:GrossProfit'],
        calculationFormula: 'revenue - cost_of_goods_sold',
        description: 'Revenue minus cost of goods sold',
      },
      {
        normalizedMetric: 'operating_cash_flow',
        displayName: 'Operating Cash Flow',
        statementType: 'cash_flow',
        synonyms: ['Operating Cash Flow', 'Cash from Operations', 'Net Cash from Operating Activities'],
        xbrlTags: ['us-gaap:NetCashProvidedByUsedInOperatingActivities'],
        description: 'Cash generated from normal business operations',
      },
      {
        normalizedMetric: 'total_assets',
        displayName: 'Total Assets',
        statementType: 'balance_sheet',
        synonyms: ['Total Assets', 'Assets'],
        xbrlTags: ['us-gaap:Assets'],
        description: 'Sum of all assets owned by the company',
      },
    ];

    for (const mapping of sampleMappings) {
      await this.prisma.metricMapping.upsert({
        where: { normalizedMetric: mapping.normalizedMetric },
        update: mapping,
        create: mapping,
      });
    }

    return { count: sampleMappings.length, message: 'Sample mappings created' };
  }

  async getAllMappings() {
    return this.prisma.metricMapping.findMany();
  }

  async getMappingByMetric(normalizedMetric: string) {
    return this.prisma.metricMapping.findUnique({
      where: { normalizedMetric },
    });
  }

  async saveMetrics(metrics: any[]) {
    const saved: any[] = [];
    
    for (const metric of metrics) {
      // Normalize metric name to lowercase
      const normalizedMetric = metric.normalized_metric.toLowerCase();
      
      // Use upsert to avoid duplicates
      const result = await this.prisma.financialMetric.upsert({
        where: {
          ticker_normalizedMetric_fiscalPeriod_filingType: {
            ticker: metric.ticker,
            normalizedMetric: normalizedMetric,
            fiscalPeriod: metric.fiscal_period,
            filingType: metric.filing_type,
          },
        },
        update: {
          // Update if exists and new confidence is higher
          rawLabel: metric.raw_label,
          value: metric.value,
          periodType: metric.period_type,
          statementType: metric.statement_type,
          filingDate: new Date(metric.filing_date || Date.now()),
          statementDate: new Date(metric.statement_date || Date.now()),
          confidenceScore: metric.confidence_score || 1.0,
        },
        create: {
          ticker: metric.ticker,
          normalizedMetric: normalizedMetric,
          rawLabel: metric.raw_label,
          value: metric.value,
          fiscalPeriod: metric.fiscal_period,
          periodType: metric.period_type,
          filingType: metric.filing_type,
          statementType: metric.statement_type,
          filingDate: new Date(metric.filing_date || Date.now()),
          statementDate: new Date(metric.statement_date || Date.now()),
          confidenceScore: metric.confidence_score || 1.0,
        },
      });
      saved.push(result);
    }

    return saved;
  }

  async getMetrics(ticker: string, metric: string, filingType?: string) {
    return this.prisma.financialMetric.findMany({
      where: {
        ticker,
        normalizedMetric: metric,
        ...(filingType && { filingType }),
      },
      orderBy: { fiscalPeriod: 'desc' },
      take: 10,
    });
  }

  async clearTickerData(ticker: string) {
    // Delete in order due to foreign key constraints
    await this.prisma.narrativeChunk.deleteMany({ where: { ticker } });
    await this.prisma.financialMetric.deleteMany({ where: { ticker } });
    await this.prisma.filingMetadata.deleteMany({ where: { ticker } });
    
    return { message: `Cleared all data for ${ticker}` };
  }
}
