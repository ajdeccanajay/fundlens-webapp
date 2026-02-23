import { Injectable, Logger } from '@nestjs/common';
import { QueryIntent, MetricResult } from './types/query-intent';
import { VisualizationPayload } from './types/visualization';
import { MetricsSummary } from '../deals/financial-calculator.service';

/** Metrics whose values represent currency amounts */
const CURRENCY_METRICS = new Set([
  'revenue', 'net_sales', 'net_income', 'gross_profit', 'operating_income',
  'ebitda', 'free_cash_flow', 'operating_cash_flow', 'capex',
  'total_assets', 'total_liabilities', 'total_equity',
  'working_capital', 'total_debt', 'cost_of_revenue', 'cost_of_goods_sold',
]);

/** Metrics whose values represent percentages */
const PERCENTAGE_METRICS = new Set([
  'gross_margin', 'operating_margin', 'net_margin', 'ebitda_margin',
  'roe', 'roa', 'roic', 'revenue_growth', 'yoy_growth',
]);

@Injectable()
export class VisualizationGeneratorService {
  private readonly logger = new Logger(VisualizationGeneratorService.name);

  /**
   * Generate a visualization payload from RAG query results.
   * Returns null if insufficient data or no visualization-worthy intent.
   * Uses LLM-suggested chart type as a hint when available.
   * 
   * CHART GENERATION RULES:
   * - Multi-ticker comparison: 2+ tickers with same metric → grouped bar chart
   * - Single-ticker trend: 1 ticker with 2+ periods → line chart
   * - Multi-ticker trend: 2+ tickers with 2+ periods → multi-line chart
   * - Single data point: Only generate if LLM explicitly suggests a chart
   */
  generateVisualization(
      intent: QueryIntent,
      metrics: MetricResult[],
      computedMetrics?: MetricsSummary,
    ): VisualizationPayload | null {
      // Must have at least 1 metric to visualize
      if (!metrics || metrics.length === 0) {
        this.logger.log(`📊 No metrics to visualize`);
        return null;
      }

      const tickers = [...new Set(metrics.map((m) => m.ticker?.toUpperCase()))].filter(Boolean);
      const periods = [...new Set(metrics.map((m) => m.fiscalPeriod))];
      const suggestedChart = (intent as any).suggestedChart as string | null | undefined;

      this.logger.log(`📊 Visualization check: ${metrics.length} metrics, ${tickers.length} tickers, ${periods.length} periods`);
      this.logger.log(`📊 Intent flags: needsComparison=${intent.needsComparison}, needsTrend=${intent.needsTrend}, suggestedChart=${suggestedChart}`);

      // CASE 1: Multi-ticker comparison (2+ tickers)
      // Even with single period, show grouped bar for comparison
      if (tickers.length > 1) {
        // If also multi-period with trend flag, use line chart
        if (intent.needsTrend && periods.length > 1) {
          this.logger.log(`📊 Generating multi-ticker trend chart (${tickers.length} tickers, ${periods.length} periods)`);
          return this.buildMultiTickerTrendChart(tickers, metrics);
        }
        // Otherwise grouped bar for comparison
        this.logger.log(`📊 Generating comparison chart for ${tickers.length} tickers`);
        return this.buildComparisonChart(tickers, metrics);
      }

      // CASE 2: Single ticker with multiple periods → trend chart
      if (tickers.length === 1 && periods.length > 1) {
        const ticker = tickers[0];
        const yoyGrowth = this.extractYoyGrowth(ticker, metrics, computedMetrics);
        this.logger.log(`📊 Generating single-ticker trend chart (${periods.length} periods)`);
        return this.buildTrendChart(ticker, metrics, yoyGrowth);
      }

      // CASE 3: Single ticker, single period - only if LLM suggests chart
      if (tickers.length === 1 && metrics.length >= 1 && suggestedChart && suggestedChart !== 'table') {
        const ticker = tickers[0];
        const metricName = metrics[0]?.normalizedMetric ?? 'Metric';
        const metricLabel = metrics[0]?.displayName || this.formatMetricLabel(metricName);
        const labels = metrics.map(m => m.fiscalPeriod);
        const values = metrics.map(m => m.value);

        this.logger.log(`📊 Generating LLM-suggested chart: ${suggestedChart}`);
        return {
          chartType: suggestedChart === 'grouped_bar' ? 'groupedBar' : suggestedChart as any,
          title: `${ticker.toUpperCase()} ${metricLabel}`,
          labels,
          datasets: [{ label: metricLabel, data: values }],
          options: {
            currency: CURRENCY_METRICS.has(metricName),
            percentage: PERCENTAGE_METRICS.has(metricName),
          },
        };
      }

      this.logger.log(`📊 No visualization generated (insufficient data variety)`);
      return null;
    }

  /**
   * Build a multi-series trend (line) chart with one dataset per ticker on a shared time axis.
   * All tickers share the same X-axis labels (fiscal periods), with null for missing data points.
   */
  private buildMultiTickerTrendChart(
    tickers: string[],
    metrics: MetricResult[],
  ): VisualizationPayload {
    const allPeriods = [...new Set(metrics.map(m => m.fiscalPeriod))].sort();
    const metricLabel = metrics[0]?.displayName || this.formatMetricLabel(metrics[0]?.normalizedMetric ?? 'Metric');

    const datasets: VisualizationPayload['datasets'] = tickers.map(ticker => {
      const tickerMetrics = metrics.filter(m => m.ticker.toUpperCase() === ticker.toUpperCase());
      const valueByPeriod = new Map(tickerMetrics.map(m => [m.fiscalPeriod, m.value]));
      return {
        label: ticker.toUpperCase(),
        data: allPeriods.map(p => valueByPeriod.get(p) ?? null) as number[],
      };
    });

    return {
      chartType: 'line',
      title: `${metricLabel} Trend — ${tickers.map(t => t.toUpperCase()).join(' vs ')}`,
      labels: allPeriods,
      datasets,
      options: {
        currency: CURRENCY_METRICS.has(metrics[0]?.normalizedMetric),
        percentage: PERCENTAGE_METRICS.has(metrics[0]?.normalizedMetric),
      },
    };
  }


  /**
   * Build a trend (line) chart from time-series metric data.
   * Sorts metrics chronologically by fiscal period.
   */
  private buildTrendChart(
    ticker: string,
    metrics: MetricResult[],
    yoyGrowth?: { period: string; value: number }[],
  ): VisualizationPayload {
    // Filter to this ticker and sort chronologically
    const tickerMetrics = metrics
      .filter((m) => m.ticker === ticker)
      .sort((a, b) => a.fiscalPeriod.localeCompare(b.fiscalPeriod));

    const metricName = tickerMetrics[0]?.normalizedMetric ?? 'Metric';
    const metricLabel = tickerMetrics[0]?.displayName || this.formatMetricLabel(metricName);
    const labels = tickerMetrics.map((m) => m.fiscalPeriod);
    const values = tickerMetrics.map((m) => m.value);

    const datasets: VisualizationPayload['datasets'] = [
      { label: metricLabel, data: values },
    ];

    let dualAxis = false;

    // Add YoY growth as secondary dataset if available
    if (yoyGrowth && yoyGrowth.length > 0) {
      const growthByPeriod = new Map(yoyGrowth.map((g) => [g.period, g.value]));
      const growthValues = labels.map((l) => growthByPeriod.get(l) ?? 0);
      const hasData = growthValues.some((v) => v !== 0);

      if (hasData) {
        datasets.push({
          label: 'YoY Growth %',
          data: growthValues,
          type: 'line',
          yAxisID: 'yoy',
        });
        dualAxis = true;
      }
    }

    const firstPeriod = labels[0] ?? '';
    const lastPeriod = labels[labels.length - 1] ?? '';

    return {
      chartType: 'line',
      title: `${ticker.toUpperCase()} ${metricLabel} Trend (${firstPeriod}–${lastPeriod})`,
      labels,
      datasets,
      options: {
        currency: CURRENCY_METRICS.has(metricName),
        percentage: PERCENTAGE_METRICS.has(metricName),
        dualAxis,
      },
    };
  }

  /**
   * Build a comparison (grouped bar) chart from multi-ticker data.
   * Groups metrics by ticker, creating one dataset per ticker.
   */
  private buildComparisonChart(
    tickers: string[],
    metrics: MetricResult[],
  ): VisualizationPayload {
    // Collect all unique fiscal periods as labels, sorted chronologically
    const labels = [
      ...new Set(metrics.map((m) => m.fiscalPeriod)),
    ].sort((a, b) => a.localeCompare(b));

    const metricName = metrics[0]?.normalizedMetric ?? 'Metric';
    const metricLabel = metrics[0]?.displayName || this.formatMetricLabel(metricName);

    const datasets = tickers.map((ticker) => {
      const tickerMetrics = metrics.filter((m) => m.ticker === ticker);
      const valueByPeriod = new Map(
        tickerMetrics.map((m) => [m.fiscalPeriod, m.value]),
      );
      return {
        label: ticker.toUpperCase(),
        data: labels.map((l) => valueByPeriod.get(l) ?? 0),
      };
    });

    return {
      chartType: 'groupedBar',
      title: `${metricLabel} Comparison — ${tickers.map((t) => t.toUpperCase()).join(' vs ')}`,
      labels,
      datasets,
      options: {
        currency: CURRENCY_METRICS.has(metricName),
        percentage: PERCENTAGE_METRICS.has(metricName),
      },
    };
  }

  /**
   * Extract YoY growth data from MetricsSummary for the primary metric.
   */
  private extractYoyGrowth(
    ticker: string,
    metrics: MetricResult[],
    summary?: MetricsSummary,
  ): { period: string; value: number }[] | undefined {
    if (!summary || summary.ticker.toUpperCase() !== ticker.toUpperCase()) {
      return undefined;
    }

    const metricName = metrics[0]?.normalizedMetric ?? '';

    // Check revenue yoyGrowth
    if (metricName.includes('revenue') && summary.metrics.revenue?.yoyGrowth?.length) {
      return summary.metrics.revenue.yoyGrowth;
    }

    // Check net income yoyGrowth
    if (metricName.includes('net_income') && summary.metrics.profitability?.netIncome?.yoyGrowth?.length) {
      return summary.metrics.profitability.netIncome.yoyGrowth;
    }

    return undefined;
  }

  /** Convert snake_case metric name to a readable label */
  private formatMetricLabel(metric: string): string {
    return metric
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
