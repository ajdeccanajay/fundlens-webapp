import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ComputedMetricResult {
  ticker: string;
  metric: string;
  value: string;
  fiscalPeriod: string;
  periodType: string;
  filingType: string;
  filingDate: Date;
  formula: string;
  components: Array<{
    metric: string;
    value: string;
  }>;
}

@Injectable()
export class ComputedMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate EBITDA (Earnings Before Interest, Taxes, Depreciation, and Amortization)
   * Formula: Operating Income + Depreciation & Amortization
   * Fallback: Net Income + Interest + Taxes + D&A
   */
  async calculateEBITDA(
    ticker: string,
    fiscalPeriod?: string,
  ): Promise<ComputedMetricResult[]> {
    const upperTicker = ticker.toUpperCase();

    // Get operating income (EBIT)
    const operatingIncome = await this.prisma.financialMetric.findMany({
      where: {
        ticker: upperTicker,
        normalizedMetric: 'operating_income',
        ...(fiscalPeriod && { fiscalPeriod }),
      },
      orderBy: { filingDate: 'desc' },
    });

    // Get depreciation & amortization
    const depreciation = await this.prisma.financialMetric.findMany({
      where: {
        ticker: upperTicker,
        normalizedMetric: {
          in: ['depreciation_amortization', 'depreciation', 'amortization'],
        },
        ...(fiscalPeriod && { fiscalPeriod }),
      },
      orderBy: { filingDate: 'desc' },
    });

    const results: ComputedMetricResult[] = [];

    // Match by fiscal period
    for (const oi of operatingIncome) {
      const matchingDA = depreciation.find(
        (d) => d.fiscalPeriod === oi.fiscalPeriod,
      );

      if (matchingDA) {
        const ebitda =
          parseFloat(oi.value.toString()) +
          parseFloat(matchingDA.value.toString());

        results.push({
          ticker: upperTicker,
          metric: 'ebitda',
          value: ebitda.toFixed(2),
          fiscalPeriod: oi.fiscalPeriod,
          periodType: oi.periodType,
          filingType: oi.filingType,
          filingDate: oi.filingDate,
          formula: 'Operating Income + Depreciation & Amortization',
          components: [
            {
              metric: 'operating_income',
              value: oi.value.toString(),
            },
            {
              metric: matchingDA.normalizedMetric,
              value: matchingDA.value.toString(),
            },
          ],
        });
      }
    }

    if (results.length === 0) {
      throw new NotFoundException(
        `Cannot calculate EBITDA for ${ticker}: missing required components`,
      );
    }

    return results;
  }

  /**
   * Calculate Free Cash Flow (FCF)
   * Formula: Operating Cash Flow - Capital Expenditures
   */
  async calculateFCF(
    ticker: string,
    fiscalPeriod?: string,
  ): Promise<ComputedMetricResult[]> {
    const upperTicker = ticker.toUpperCase();

    // Get operating cash flow
    const ocf = await this.prisma.financialMetric.findMany({
      where: {
        ticker: upperTicker,
        normalizedMetric: 'operating_cash_flow',
        ...(fiscalPeriod && { fiscalPeriod }),
      },
      orderBy: { filingDate: 'desc' },
    });

    // Get capital expenditures
    const capex = await this.prisma.financialMetric.findMany({
      where: {
        ticker: upperTicker,
        normalizedMetric: {
          in: ['capex', 'capital_expenditures', 'property_plant_equipment_additions'],
        },
        ...(fiscalPeriod && { fiscalPeriod }),
      },
      orderBy: { filingDate: 'desc' },
    });

    const results: ComputedMetricResult[] = [];

    // Match by fiscal period
    for (const ocfMetric of ocf) {
      const matchingCapex = capex.find(
        (c) => c.fiscalPeriod === ocfMetric.fiscalPeriod,
      );

      if (matchingCapex) {
        const fcf =
          parseFloat(ocfMetric.value.toString()) -
          Math.abs(parseFloat(matchingCapex.value.toString()));

        results.push({
          ticker: upperTicker,
          metric: 'fcf',
          value: fcf.toFixed(2),
          fiscalPeriod: ocfMetric.fiscalPeriod,
          periodType: ocfMetric.periodType,
          filingType: ocfMetric.filingType,
          filingDate: ocfMetric.filingDate,
          formula: 'Operating Cash Flow - Capital Expenditures',
          components: [
            {
              metric: 'operating_cash_flow',
              value: ocfMetric.value.toString(),
            },
            {
              metric: matchingCapex.normalizedMetric,
              value: matchingCapex.value.toString(),
            },
          ],
        });
      }
    }

    if (results.length === 0) {
      throw new NotFoundException(
        `Cannot calculate FCF for ${ticker}: missing required components`,
      );
    }

    return results;
  }

  /**
   * Calculate Trailing Twelve Months (TTM) for a metric
   * Sums the last 4 quarters
   */
  async calculateTTM(ticker: string, metric: string): Promise<ComputedMetricResult> {
    const upperTicker = ticker.toUpperCase();

    // Get last 4 quarters
    const quarters = await this.prisma.financialMetric.findMany({
      where: {
        ticker: upperTicker,
        normalizedMetric: metric,
        periodType: 'quarterly',
      },
      orderBy: { filingDate: 'desc' },
      take: 4,
    });

    if (quarters.length < 4) {
      throw new NotFoundException(
        `Cannot calculate TTM for ${ticker} ${metric}: need 4 quarters, found ${quarters.length}`,
      );
    }

    // Sum the values
    const ttmValue = quarters.reduce(
      (sum, q) => sum + parseFloat(q.value.toString()),
      0,
    );

    // Get date range
    const latestQuarter = quarters[0];
    const oldestQuarter = quarters[3];

    return {
      ticker: upperTicker,
      metric: `${metric}_ttm`,
      value: ttmValue.toFixed(2),
      fiscalPeriod: `TTM ending ${latestQuarter.fiscalPeriod}`,
      periodType: 'ttm',
      filingType: '10-Q',
      filingDate: latestQuarter.filingDate,
      formula: 'Sum of last 4 quarters',
      components: quarters.map((q) => ({
        metric: `${metric} (${q.fiscalPeriod})`,
        value: q.value.toString(),
      })),
    };
  }

  /**
   * Calculate Gross Margin Percentage
   * Formula: (Gross Profit / Revenue) * 100
   */
  async calculateGrossMargin(
    ticker: string,
    fiscalPeriod?: string,
  ): Promise<ComputedMetricResult[]> {
    const upperTicker = ticker.toUpperCase();

    // Get gross profit (try both capitalized and lowercase)
    const grossProfit = await this.prisma.financialMetric.findMany({
      where: {
        ticker: upperTicker,
        normalizedMetric: {
          in: ['gross_profit', 'Gross_Profit'],
        },
        ...(fiscalPeriod && { fiscalPeriod }),
      },
      orderBy: { filingDate: 'desc' },
    });

    // Get revenue (try both capitalized and lowercase)
    const revenue = await this.prisma.financialMetric.findMany({
      where: {
        ticker: upperTicker,
        normalizedMetric: {
          in: ['revenue', 'Revenue'],
        },
        ...(fiscalPeriod && { fiscalPeriod }),
      },
      orderBy: { filingDate: 'desc' },
    });

    const results: ComputedMetricResult[] = [];

    // Match by fiscal period
    for (const gp of grossProfit) {
      const matchingRev = revenue.find((r) => r.fiscalPeriod === gp.fiscalPeriod);

      if (matchingRev) {
        const margin =
          (parseFloat(gp.value.toString()) /
            parseFloat(matchingRev.value.toString())) *
          100;

        results.push({
          ticker: upperTicker,
          metric: 'gross_margin_pct',
          value: margin.toFixed(2),
          fiscalPeriod: gp.fiscalPeriod,
          periodType: gp.periodType,
          filingType: gp.filingType,
          filingDate: gp.filingDate,
          formula: '(Gross Profit / Revenue) * 100',
          components: [
            {
              metric: 'gross_profit',
              value: gp.value.toString(),
            },
            {
              metric: 'revenue',
              value: matchingRev.value.toString(),
            },
          ],
        });
      }
    }

    if (results.length === 0) {
      throw new NotFoundException(
        `Cannot calculate Gross Margin for ${ticker}: missing required components`,
      );
    }

    return results;
  }

  /**
   * Calculate Net Margin Percentage
   * Formula: (Net Income / Revenue) * 100
   */
  async calculateNetMargin(
    ticker: string,
    fiscalPeriod?: string,
  ): Promise<ComputedMetricResult[]> {
    const upperTicker = ticker.toUpperCase();

    // Get net income (try both capitalized and lowercase)
    const netIncome = await this.prisma.financialMetric.findMany({
      where: {
        ticker: upperTicker,
        normalizedMetric: {
          in: ['net_income', 'Net_Income'],
        },
        ...(fiscalPeriod && { fiscalPeriod }),
      },
      orderBy: { filingDate: 'desc' },
    });

    // Get revenue (try both capitalized and lowercase)
    const revenue = await this.prisma.financialMetric.findMany({
      where: {
        ticker: upperTicker,
        normalizedMetric: {
          in: ['revenue', 'Revenue'],
        },
        ...(fiscalPeriod && { fiscalPeriod }),
      },
      orderBy: { filingDate: 'desc' },
    });

    const results: ComputedMetricResult[] = [];

    // Match by fiscal period
    for (const ni of netIncome) {
      const matchingRev = revenue.find((r) => r.fiscalPeriod === ni.fiscalPeriod);

      if (matchingRev) {
        const margin =
          (parseFloat(ni.value.toString()) /
            parseFloat(matchingRev.value.toString())) *
          100;

        results.push({
          ticker: upperTicker,
          metric: 'net_margin_pct',
          value: margin.toFixed(2),
          fiscalPeriod: ni.fiscalPeriod,
          periodType: ni.periodType,
          filingType: ni.filingType,
          filingDate: ni.filingDate,
          formula: '(Net Income / Revenue) * 100',
          components: [
            {
              metric: 'net_income',
              value: ni.value.toString(),
            },
            {
              metric: 'revenue',
              value: matchingRev.value.toString(),
            },
          ],
        });
      }
    }

    if (results.length === 0) {
      throw new NotFoundException(
        `Cannot calculate Net Margin for ${ticker}: missing required components`,
      );
    }

    return results;
  }

  /**
   * Get all available computed metrics for a ticker
   */
  async getAvailableComputedMetrics(ticker: string): Promise<string[]> {
    const available: string[] = [];

    // Check what base metrics are available
    const metrics = await this.prisma.financialMetric.findMany({
      where: { ticker: ticker.toUpperCase() },
      distinct: ['normalizedMetric'],
      select: { normalizedMetric: true },
    });

    const metricSet = new Set(metrics.map((m) => m.normalizedMetric));

    // EBITDA: needs operating_income + depreciation
    if (
      metricSet.has('operating_income') &&
      (metricSet.has('depreciation_amortization') ||
        metricSet.has('depreciation'))
    ) {
      available.push('ebitda');
    }

    // FCF: needs operating_cash_flow + capex
    if (
      metricSet.has('operating_cash_flow') &&
      (metricSet.has('capex') || metricSet.has('capital_expenditures'))
    ) {
      available.push('fcf');
    }

    // Margins: need revenue + profit metrics
    if (metricSet.has('revenue')) {
      if (metricSet.has('gross_profit')) {
        available.push('gross_margin_pct');
      }
      if (metricSet.has('net_income')) {
        available.push('net_margin_pct');
      }
    }

    // TTM: available for any metric with quarterly data
    const quarterlyMetrics = await this.prisma.financialMetric.findMany({
      where: {
        ticker: ticker.toUpperCase(),
        periodType: 'quarterly',
      },
      distinct: ['normalizedMetric'],
      select: { normalizedMetric: true },
    });

    for (const m of quarterlyMetrics) {
      available.push(`${m.normalizedMetric}_ttm`);
    }

    return available;
  }
}
