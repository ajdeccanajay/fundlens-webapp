import { Controller, Get, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { FootnoteLinkingService } from './footnote-linking.service';
import { MDAIntelligenceService } from './mda-intelligence.service';
import { TenantGuard } from '../tenant/tenant.guard';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('deals/:dealId/context')
@UseGuards(TenantGuard)
export class ContextController {
  constructor(
    private readonly footnoteLinkingService: FootnoteLinkingService,
    private readonly mdaIntelligenceService: MDAIntelligenceService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':metricId')
  async getContext(
    @Param('dealId') dealId: string,
    @Param('metricId') metricId: string,
  ) {
    try {
      // Get deal info
      const deal = await this.prisma.deal.findUnique({
        where: { id: dealId },
      });

      if (!deal) {
        throw new HttpException('Deal not found', HttpStatus.NOT_FOUND);
      }

      // Try to get real metric data
      const metric = deal.ticker ? await this.prisma.financialMetric.findFirst({
        where: {
          ticker: deal.ticker,
          normalizedMetric: metricId,
        },
        orderBy: { fiscalPeriod: 'desc' },
      }) : null;

      // Get MD&A insights for context
      const mdaInsight = await this.prisma.mdaInsight.findFirst({
        where: { dealId },
        orderBy: { fiscalPeriod: 'desc' },
      });

      // Build context response
      const context = {
        metric: {
          id: metricId,
          name: this.formatMetricName(metricId),
          value: metric ? parseFloat(metric.value.toString()) : null,
          fiscalPeriod: metric?.fiscalPeriod || 'FY2024',
        },
        footnotes: this.getFootnotesForMetric(metricId),
        mdaQuotes: this.getMdaQuotesForMetric(metricId, mdaInsight),
        breakdowns: this.getBreakdownsForMetric(metricId, deal.ticker || ''),
      };

      return context;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to load context',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get footnotes relevant to a metric
   */
  private getFootnotesForMetric(metricId: string): any[] {
    // Map metrics to relevant footnote types
    const footnoteMap: Record<string, any[]> = {
      revenue: [
        {
          number: 1,
          title: 'Revenue Recognition',
          text: 'The Company recognizes revenue when control of the promised goods or services is transferred to customers, in an amount that reflects the consideration the Company expects to be entitled to in exchange for those goods or services.',
          contextType: 'accounting_policy',
        },
      ],
      gross_profit: [
        {
          number: 2,
          title: 'Cost of Sales',
          text: 'Cost of sales includes the cost of merchandise sold, including freight and distribution costs, and the cost of services provided.',
          contextType: 'accounting_policy',
        },
      ],
      operating_income: [
        {
          number: 3,
          title: 'Operating Expenses',
          text: 'Operating expenses include selling, general and administrative expenses, research and development costs, and depreciation and amortization.',
          contextType: 'accounting_policy',
        },
      ],
      net_income: [
        {
          number: 4,
          title: 'Income Taxes',
          text: 'The Company accounts for income taxes using the asset and liability method. Deferred tax assets and liabilities are recognized for the future tax consequences attributable to differences between the financial statement carrying amounts of existing assets and liabilities and their respective tax bases.',
          contextType: 'accounting_policy',
        },
      ],
      total_assets: [
        {
          number: 5,
          title: 'Asset Valuation',
          text: 'Assets are recorded at cost and depreciated over their estimated useful lives. The Company reviews long-lived assets for impairment whenever events or changes in circumstances indicate that the carrying amount may not be recoverable.',
          contextType: 'accounting_policy',
        },
      ],
      operating_cash_flow: [
        {
          number: 6,
          title: 'Cash Flow Classification',
          text: 'Cash flows from operating activities include cash received from customers and cash paid to suppliers and employees. Non-cash items such as depreciation and changes in working capital are adjusted to reconcile net income to cash provided by operating activities.',
          contextType: 'reconciliation',
        },
      ],
    };

    return footnoteMap[metricId] || [];
  }

  /**
   * Get MD&A quotes relevant to a metric
   */
  private getMdaQuotesForMetric(metricId: string, mdaInsight: any): any[] {
    if (!mdaInsight) return [];

    const trends = (mdaInsight.trends as any[]) || [];
    const relevantTrends = trends.filter(t => 
      t.metrics?.includes(metricId) || 
      t.category?.toLowerCase().includes(metricId.replace('_', ' '))
    );

    return relevantTrends.map(t => ({
      text: t.description,
      sentiment: t.sentiment,
      context: t.category,
      metric: metricId,
    }));
  }

  /**
   * Get segment breakdowns for a metric
   */
  private getBreakdownsForMetric(metricId: string, ticker: string): any {
    // Return mock segment data based on metric type
    if (metricId === 'revenue') {
      return {
        segments: [
          {
            title: 'Revenue by Segment',
            data: {
              headers: ['Segment', 'Revenue', '% of Total'],
              rows: [
                ['Core Operations', '$180.5B', '72%'],
                ['Services', '$45.2B', '18%'],
                ['Other', '$25.1B', '10%'],
              ],
            },
          },
        ],
        geographic: [],
      };
    }

    if (metricId === 'total_assets') {
      return {
        segments: [
          {
            title: 'Asset Composition',
            data: {
              headers: ['Category', 'Amount', '% of Total'],
              rows: [
                ['Current Assets', '$34.2B', '49%'],
                ['Property & Equipment', '$22.1B', '32%'],
                ['Intangible Assets', '$8.5B', '12%'],
                ['Other Assets', '$5.0B', '7%'],
              ],
            },
          },
        ],
        geographic: [],
      };
    }

    return { segments: [], geographic: [] };
  }

  /**
   * Format metric name for display
   */
  private formatMetricName(metricId: string): string {
    const nameMap: Record<string, string> = {
      revenue: 'Revenue',
      gross_profit: 'Gross Profit',
      operating_income: 'Operating Income',
      net_income: 'Net Income',
      total_assets: 'Total Assets',
      operating_cash_flow: 'Operating Cash Flow',
      ebitda: 'EBITDA',
      free_cash_flow: 'Free Cash Flow',
    };

    return nameMap[metricId] || metricId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  @Get(':metricId/footnotes')
  async getFootnotes(
    @Param('dealId') dealId: string,
    @Param('metricId') metricId: string,
  ) {
    try {
      const footnotes = this.getFootnotesForMetric(metricId);
      return {
        footnotes,
        metadata: {
          metricId,
          count: footnotes.length,
        },
      };
    } catch (error) {
      throw new HttpException(
        'Failed to load footnotes',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':metricId/mda-quotes')
  async getMdaQuotes(
    @Param('dealId') dealId: string,
    @Param('metricId') metricId: string,
  ) {
    try {
      const mdaInsight = await this.prisma.mdaInsight.findFirst({
        where: { dealId },
        orderBy: { fiscalPeriod: 'desc' },
      });

      const quotes = this.getMdaQuotesForMetric(metricId, mdaInsight);
      return {
        quotes,
        metadata: {
          metricId,
          count: quotes.length,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to load MD&A quotes',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
