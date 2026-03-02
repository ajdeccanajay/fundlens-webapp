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

        // CRITICAL: Filter out non-DB metrics before charting.
        // Only structured DB metrics (from financial_metrics table) should drive charts.
        // Contextual metrics from semantic retriever, uploaded doc metrics, and
        // LLM-derived values produce hallucinated chart labels like "FY 2015" or "1Q25".
        const dbMetrics = metrics.filter(m => {
          // Exclude uploaded document metrics
          if ((m as any).filingType === 'uploaded-document') return false;
          if ((m as any)._documentComputed) return false;
          // Exclude contextual metrics injected by semantic retriever
          if ((m as any)._contextual) return false;
          // Exclude computed formula metrics
          if ((m as any)._computed) return false;
          // Validate fiscal period format: must be FY20XX or QN FY20XX pattern
          if (m.fiscalPeriod && !/^(FY\d{4}|Q[1-4]\s?(?:FY)?\d{4})$/i.test(m.fiscalPeriod)) {
            this.logger.log(`📊 Filtering out metric with invalid period: "${m.fiscalPeriod}" (${m.ticker}/${m.normalizedMetric})`);
            return false;
          }
          return true;
        });

        this.logger.log(`📊 Chart metrics: ${dbMetrics.length} of ${metrics.length} passed DB-only filter`);

        if (dbMetrics.length === 0) {
          this.logger.log(`📊 No DB metrics survived filter — skipping visualization`);
          return null;
        }

        // Defense-in-depth: deduplicate by (ticker, fiscalPeriod, normalizedMetric)
        // keeping highest confidenceScore to prevent oscillating chart data
        let chartMetrics: MetricResult[];
        {
          const seen = new Map<string, MetricResult>();
          for (const m of dbMetrics) {
            const key = `${(m.ticker || '').toUpperCase()}|${m.fiscalPeriod || ''}|${(m.normalizedMetric || '').toLowerCase()}`;
            const existing = seen.get(key);
            if (!existing || ((m as any).confidenceScore ?? 0) > ((existing as any).confidenceScore ?? 0)) {
              seen.set(key, m);
            }
          }
          chartMetrics = [...seen.values()];
        }

        const tickers = [...new Set(chartMetrics.map((m) => m.ticker?.toUpperCase()))].filter(Boolean);
        const periods = [...new Set(chartMetrics.map((m) => m.fiscalPeriod))];
        const suggestedChart = (intent as any).suggestedChart as string | null | undefined;

        this.logger.log(`📊 Visualization check: ${chartMetrics.length} metrics, ${tickers.length} tickers, ${periods.length} periods`);
        this.logger.log(`📊 Periods: ${JSON.stringify(periods)}`);
        this.logger.log(`📊 Intent flags: needsComparison=${intent.needsComparison}, needsTrend=${intent.needsTrend}, suggestedChart=${suggestedChart}`);

        // CASE 1: Multi-ticker comparison (2+ tickers)
        // Even with single period, show grouped bar for comparison
        if (tickers.length > 1) {
          // If also multi-period with trend flag, use line chart
          if (intent.needsTrend && periods.length > 1) {
            this.logger.log(`📊 Generating multi-ticker trend chart (${tickers.length} tickers, ${periods.length} periods)`);
            return this.buildMultiTickerTrendChart(tickers, chartMetrics);
          }
          // Otherwise grouped bar for comparison
          this.logger.log(`📊 Generating comparison chart for ${tickers.length} tickers`);
          return this.buildComparisonChart(tickers, chartMetrics);
        }

        // CASE 2: Single ticker with multiple periods → trend chart
        if (tickers.length === 1 && periods.length > 1) {
          const ticker = tickers[0];
          const yoyGrowth = this.extractYoyGrowth(ticker, chartMetrics, computedMetrics);
          this.logger.log(`📊 Generating single-ticker trend chart (${periods.length} periods)`);
          return this.buildTrendChart(ticker, chartMetrics, yoyGrowth);
        }

        // CASE 3: Single ticker, single period - only if LLM suggests chart
        if (tickers.length === 1 && chartMetrics.length >= 1 && suggestedChart && suggestedChart !== 'table') {
          const ticker = tickers[0];
          const metricName = chartMetrics[0]?.normalizedMetric ?? 'Metric';
          const metricLabel = chartMetrics[0]?.displayName || this.formatMetricLabel(metricName);
          const labels = chartMetrics.map(m => m.fiscalPeriod);
          const values = chartMetrics.map(m => m.value);

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
        // Filter to only tickers that actually have metric data
        const tickersWithData = tickers.filter(ticker =>
          metrics.some(m => m.ticker?.toUpperCase() === ticker.toUpperCase()),
        );
        const effectiveTickers = tickersWithData.length > 0 ? tickersWithData : tickers;

        const allPeriods = [...new Set(metrics.map(m => m.fiscalPeriod))]
          .sort((a, b) => this.parseFiscalPeriodSortKey(a) - this.parseFiscalPeriodSortKey(b));
        const metricLabel = metrics[0]?.displayName || this.formatMetricLabel(metrics[0]?.normalizedMetric ?? 'Metric');

        const datasets: VisualizationPayload['datasets'] = effectiveTickers.map(ticker => {
          const tickerMetrics = metrics.filter(m => m.ticker?.toUpperCase() === ticker.toUpperCase());
          const valueByPeriod = new Map(tickerMetrics.map(m => [m.fiscalPeriod, m.value]));
          return {
            label: ticker.toUpperCase(),
            data: allPeriods.map(p => valueByPeriod.get(p) ?? null) as number[],
          };
        });

        return {
          chartType: 'line',
          title: `${metricLabel} Trend — ${effectiveTickers.map(t => t.toUpperCase()).join(' vs ')}`,
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
      // Filter to this ticker and sort chronologically using numeric sort key
      const tickerMetrics = metrics
        .filter((m) => m.ticker === ticker)
        .sort((a, b) => this.parseFiscalPeriodSortKey(a.fiscalPeriod) - this.parseFiscalPeriodSortKey(b.fiscalPeriod));

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
        // Filter to only tickers that actually have metric data
        const tickersWithData = tickers.filter(ticker =>
          metrics.some(m => m.ticker?.toUpperCase() === ticker.toUpperCase()),
        );

        if (tickersWithData.length === 0) {
          // Fallback: use all tickers even if no data (shouldn't happen)
          tickersWithData.push(...tickers);
        }

        // Collect all unique fiscal periods as labels, sorted chronologically
        const labels = [
          ...new Set(metrics.map((m) => m.fiscalPeriod)),
        ].sort((a, b) => this.parseFiscalPeriodSortKey(a) - this.parseFiscalPeriodSortKey(b));

        const metricName = metrics[0]?.normalizedMetric ?? 'Metric';
        const metricLabel = metrics[0]?.displayName || this.formatMetricLabel(metricName);

        const datasets = tickersWithData.map((ticker) => {
          const tickerMetrics = metrics.filter((m) => m.ticker?.toUpperCase() === ticker.toUpperCase());
          const valueByPeriod = new Map(
            tickerMetrics.map((m) => [m.fiscalPeriod, m.value]),
          );
          return {
            label: ticker.toUpperCase(),
            // Use null for missing periods so chart library skips them
            // instead of showing misleading zero-height bars
            data: labels.map((l) => valueByPeriod.get(l) ?? null),
          };
        });

        return {
          chartType: 'groupedBar',
          title: `${metricLabel} Comparison — ${tickersWithData.map((t) => t.toUpperCase()).join(' vs ')}`,
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
  /**
   * Convert fiscal period string to a numeric sort key for chronological ordering.
   * Prevents alphabetical sort bugs like "1Q25" < "FY2023".
   */
  private parseFiscalPeriodSortKey(period: string): number {
    // Quarterly: Q3FY2024, 3Q2024, Q3 2024, 1Q25, etc.
    const qtr = period.match(/Q([1-4])[\s\-]?(?:FY)?(\d{2,4})/i)
      || period.match(/([1-4])Q[\s\-]?(?:FY)?(\d{2,4})/i);
    if (qtr) {
      let year = parseInt(qtr[2]);
      if (year < 100) year += 2000; // "25" → 2025
      return year * 10000 + parseInt(qtr[1]) * 100;
    }

    // Annual: FY2024, FY 2024, FY2025F (strip trailing F for forecast)
    const annual = period.match(/FY\s?(\d{4})/i);
    if (annual) return parseInt(annual[1]) * 10000;

    // TTM always sorts last
    if (/TTM/i.test(period)) return 99990000;

    // Bare year
    const yr = period.match(/(\d{4})/);
    return yr ? parseInt(yr[1]) * 10000 : 0;
  }
}
