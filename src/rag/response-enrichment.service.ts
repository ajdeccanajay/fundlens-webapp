import { Injectable, Logger } from '@nestjs/common';
import { QueryIntent, MetricResult, RAGResponse } from './types/query-intent';
import { VisualizationPayload, ChartType } from './types/visualization';
import { MetricResolution } from './metric-resolution/types';
import {
  FinancialCalculatorService,
  MetricsSummary,
} from '../deals/financial-calculator.service';
import { VisualizationGeneratorService } from './visualization-generator.service';

/**
 * ResponseEnrichmentService — Two-phase enrichment for RAG responses.
 *
 * Phase 1 (Pre-LLM):  computeFinancials() → MetricsSummary injected into LLM context
 * Phase 2 (Post-LLM): enrichResponse()     → VisualizationPayload attached to response
 *
 * Also owns the quick-response path that skips LLM entirely.
 */
@Injectable()
export class ResponseEnrichmentService {
  private readonly logger = new Logger(ResponseEnrichmentService.name);

  constructor(
    private readonly financialCalculator: FinancialCalculatorService,
    private readonly visualizationGenerator: VisualizationGeneratorService,
  ) {}

  /**
   * Phase 1 (Pre-LLM): Compute financial metrics for the ticker.
   * Returns MetricsSummary to be injected into LLM context.
   * Returns undefined on failure — pipeline continues with raw metrics (Req 2.4).
   */
  async computeFinancials(
    intent: QueryIntent,
    metrics: MetricResult[],
  ): Promise<MetricsSummary | undefined> {
    const ticker = this.extractTicker(intent);
    if (!ticker) {
      this.logger.warn('computeFinancials: no ticker found in intent');
      return undefined;
    }

    try {
      const summary = await this.financialCalculator.getMetricsSummary(ticker);
      this.logger.log(`Computed financial summary for ${ticker}`);
      return summary;
    } catch (error) {
      this.logger.warn(
        `Failed to compute financials for ${ticker}: ${error?.message ?? error}`,
      );
      return undefined;
    }
  }

  /**
   * Phase 1 (Pre-LLM): Compute financial metrics for ALL tickers.
   * Iterates each ticker, catches per-ticker errors, returns partial results.
   * Returns empty array if no tickers found — pipeline continues with raw metrics.
   */
  async computeFinancialsMulti(
    intent: QueryIntent,
    metrics: MetricResult[],
  ): Promise<MetricsSummary[]> {
    const tickers = Array.isArray(intent.ticker)
      ? intent.ticker
      : intent.ticker
        ? [intent.ticker]
        : [];
    const summaries: MetricsSummary[] = [];

    for (const ticker of tickers) {
      try {
        const summary = await this.financialCalculator.getMetricsSummary(ticker);
        summaries.push(summary);
      } catch (error) {
        this.logger.warn(
          `Failed to compute financials for ${ticker}: ${error?.message ?? error}`,
        );
      }
    }

    return summaries;
  }


  /**
   * Phase 2 (Post-LLM): Generate visualization and attach to response.
   * Returns a new response object with the visualization field set (if applicable).
   * Accepts either a single MetricsSummary or an array for multi-ticker queries.
   */
  enrichResponse(
    response: RAGResponse,
    intent: QueryIntent,
    metrics: MetricResult[],
    computedSummary?: MetricsSummary | MetricsSummary[],
  ): RAGResponse {
    // For visualization, pass the first summary (single-ticker trend uses it for YoY overlay)
    const singleSummary = Array.isArray(computedSummary)
      ? computedSummary[0]
      : computedSummary;

    const visualization = this.visualizationGenerator.generateVisualization(
      intent,
      metrics,
      singleSummary,
    );

    if (!visualization) {
      return response;
    }

    return { ...response, visualization };
  }

  /**
   * Check if a query is eligible for the quick response path.
   * Eligible when: structured type, high confidence, no narrative needed.
   */
  isQuickResponseEligible(intent: QueryIntent): boolean {
      // Multi-ticker queries must always go through LLM synthesis
      const isMultiTicker = Array.isArray(intent.ticker) && intent.ticker.length > 1;

      return (
        !isMultiTicker &&
        intent.type === 'structured' &&
        intent.confidence > 0.85 &&
        !intent.needsNarrative &&
        !intent.needsTrend &&
        !intent.needsComparison &&
        !intent.needsComputation &&
        intent.periodType !== 'range'
      );
    }

  /**
   * Quick response path: compute + visualize without LLM invocation.
   * Formats metrics into a markdown table, generates chart if applicable.
   */
  async buildQuickResponse(
    intent: QueryIntent,
    metrics: MetricResult[],
  ): Promise<RAGResponse> {
    const startTime = Date.now();

    // Format metrics into markdown table
    const answer = this.buildMarkdownTable(metrics);

    // Compute financials (may return undefined)
    const computedSummary = await this.computeFinancials(intent, metrics);

    // Generate visualization
    const visualization = this.visualizationGenerator.generateVisualization(
      intent,
      metrics,
      computedSummary,
    );

    const response: RAGResponse = {
      answer,
      intent,
      metrics,
      sources: this.buildSources(metrics),
      timestamp: new Date(),
      latency: Date.now() - startTime,
      cost: 0,
      processingInfo: {
        structuredMetrics: metrics.length,
        semanticNarratives: 0,
        userDocumentChunks: 0,
        usedBedrockKB: false,
        usedClaudeGeneration: false,
        hybridProcessing: false,
      },
    };

    if (visualization) {
      return { ...response, visualization };
    }

    return response;
  }

  // ── Graceful Degradation (Req 9.1–9.4) ────────────────────────

  /**
   * Build a degradation message block for unresolved metrics.
   * Returns empty string when all metrics resolved successfully.
   *
   * - If suggestions exist → "Did you mean …?" with suggestion chips
   * - If no suggestions   → "I don't have a metric mapped for …" with alternatives
   */
  buildUnresolvedMessage(unresolvedMetrics: MetricResolution[]): string {
    if (!unresolvedMetrics || unresolvedMetrics.length === 0) return '';

    const lines: string[] = [];

    for (const m of unresolvedMetrics) {
      if (m.suggestions && m.suggestions.length > 0) {
        // "Did you mean?" with suggestion chips
        const top = m.suggestions[0];
        const others = m.suggestions.slice(1);
        lines.push(
          `⚠️ No exact match for **"${m.original_query}"** — did you mean **${top.display_name}**?`,
        );
        if (others.length > 0) {
          const altList = others.map((s) => s.display_name).join(', ');
          lines.push(`   Other possibilities: ${altList}`);
        }
      } else {
        // No suggestions at all
        lines.push(
          `⚠️ I don't have a metric mapped for **"${m.original_query}"** yet. ` +
            `Try rephrasing or check the metric name.`,
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * Context-aware degradation response builder (Req 21.1, 21.2, 21.3).
   *
   * Produces a comprehensive message that:
   *  1. Lists found metrics with ticker, value, and period
   *  2. Explains each resolved-but-missing metric (not found in DB for the requested period)
   *  3. Handles unresolved metrics via buildUnresolvedMessage() logic
   *  4. Returns a full "no data" message when everything is missing
   */
  buildDegradationResponse(
    foundMetrics: MetricResult[],
    allResolutions: MetricResolution[],
  ): string {
    const { resolved, unresolved } = this.partitionResolutions(allResolutions);

    // Build a set of found metric canonical IDs for quick lookup
    const foundMetricKeys = new Set(
      foundMetrics.map((m) => m.normalizedMetric.toLowerCase()),
    );

    // Identify resolved metrics that have NO corresponding foundMetric (missing from DB)
    const missingResolved = resolved.filter(
      (r) => !foundMetricKeys.has(r.canonical_id.toLowerCase()),
    );

    const hasFound = foundMetrics.length > 0;
    const hasMissing = missingResolved.length > 0;
    const hasUnresolved = unresolved.length > 0;

    // Everything is missing — comprehensive "no data" message
    if (!hasFound && !hasMissing && !hasUnresolved) {
      return 'No data available for the requested query. Please try a different metric, ticker, or time period.';
    }

    if (!hasFound && !hasMissing && hasUnresolved) {
      return this.buildUnresolvedMessage(unresolved);
    }

    const sections: string[] = [];

    // Section 1: List found metrics
    if (hasFound) {
      sections.push("Here's what I found:");
      for (const m of foundMetrics) {
        const label = m.displayName || this.formatMetricLabel(m.normalizedMetric);
        const formattedValue = this.financialCalculator.formatMetricValue(
          m.value,
          m.normalizedMetric,
        );
        sections.push(`• **${label}** for ${m.ticker.toUpperCase()}: ${formattedValue} (${m.fiscalPeriod})`);
      }
    }

    // Section 2: Explain missing resolved metrics (in DB registry but no data returned)
    if (hasMissing) {
      for (const r of missingResolved) {
        sections.push(
          `⚠️ ${r.display_name || r.canonical_id}: not found in our database for the requested period`,
        );
      }
    }

    // Section 3: Handle unresolved metrics (not recognized by MetricRegistry)
    if (hasUnresolved) {
      const unresolvedBlock = this.buildUnresolvedMessage(unresolved);
      if (unresolvedBlock) {
        sections.push(unresolvedBlock);
      }
    }

    return sections.join('\n');
  }

  /**
   * Partition MetricResolution[] into resolved and unresolved buckets.
   */
  partitionResolutions(
    resolutions: MetricResolution[],
  ): { resolved: MetricResolution[]; unresolved: MetricResolution[] } {
    const resolved: MetricResolution[] = [];
    const unresolved: MetricResolution[] = [];
    for (const r of resolutions) {
      if (r.confidence === 'unresolved') {
        unresolved.push(r);
      } else {
        resolved.push(r);
      }
    }
    return { resolved, unresolved };
  }

  // ── VisualizationPayload builder (Req 7.4, 7.5) ─────────────────

  /**
   * Build a canonical VisualizationPayload from metrics and intent.
   *
   * Returns undefined when:
   *  - metrics array is empty
   *  - intent.type === 'semantic' (no structured data to chart)
   *
   * Otherwise merges metrics into rows keyed by ticker+period,
   * builds columns from distinct normalizedMetric values,
   * infers format/scale, and sorts periods ascending.
   */
  buildVisualizationPayload(
    intent: QueryIntent,
    metrics: MetricResult[],
  ): VisualizationPayload | undefined {
    if (!metrics || metrics.length === 0) return undefined;
    if (intent.type === 'semantic') return undefined;

    // ── 1. Merge metrics into rows keyed by ticker|period ──────────
    const rowMap = new Map<
      string,
      { ticker: string; period: string; filingType: string; metrics: Record<string, number | null> }
    >();

    const columnSet = new Set<string>();

    for (const m of metrics) {
      const key = `${m.ticker}|${m.fiscalPeriod}`;
      columnSet.add(m.normalizedMetric);

      let row = rowMap.get(key);
      if (!row) {
        row = {
          ticker: m.ticker,
          period: m.fiscalPeriod,
          filingType: m.filingType,
          metrics: {},
        };
        rowMap.set(key, row);
      }
      row.metrics[m.normalizedMetric] = m.value ?? null;
    }

    // ── 2. Build columns from distinct metrics ─────────────────────
    const columns = Array.from(columnSet).map((metricId) => ({
      canonical_id: metricId,
      display_name: this.inferDisplayName(metricId, metrics),
      format: this.inferFormat(metricId) as 'currency' | 'percentage' | 'ratio' | 'integer',
      unit_scale: this.inferUnitScale(metrics, metricId) as 'ones' | 'thousands' | 'millions' | 'billions',
    }));

    // ── 3. Sort rows by period ascending ───────────────────────────
    const rows = Array.from(rowMap.values()).sort(
      (a, b) => this.fiscalPeriodSortKey(a.period) - this.fiscalPeriodSortKey(b.period),
    );

    const sortedPeriods = [...new Set(rows.map((r) => r.period))];
    const tickers = [...new Set(rows.map((r) => r.ticker))];

    // ── 4. Determine chart type ────────────────────────────────────
    const suggestedChartType: ChartType | null = intent.suggestedChart
      ? (intent.suggestedChart as ChartType)
      : null;

    return {
      suggestedChartType,
      data: { rows, columns },
      meta: {
        title: intent.originalQuery,
        tickers,
        periods: sortedPeriods,
        source: 'FundLens RAG',
      },
    };
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Extract a single ticker from the intent (handles string | string[]).
   */
  private extractTicker(intent: QueryIntent): string | undefined {
    if (!intent.ticker) return undefined;
    return Array.isArray(intent.ticker) ? intent.ticker[0] : intent.ticker;
  }

  /**
   * Build a markdown table from metric results.
   * Columns: Ticker | Metric | Value | Period
   */
  private buildMarkdownTable(metrics: MetricResult[]): string {
    if (!metrics || metrics.length === 0) {
      return 'No metrics available.';
    }

    const header = '| Ticker | Metric | Value | Period |\n| --- | --- | --- | --- |';
    const rows = metrics.map((m) => {
      const formattedValue = this.financialCalculator.formatMetricValue(
        m.value,
        m.normalizedMetric,
      );
      // Use display_name from MetricResolution when available, fall back to formatMetricLabel
      const label = m.displayName || this.formatMetricLabel(m.normalizedMetric);
      return `| ${m.ticker.toUpperCase()} | ${label} | ${formattedValue} | ${m.fiscalPeriod} |`;
    });

    return `${header}\n${rows.join('\n')}`;
  }

  /**
   * Build source references from metrics.
   */
  private buildSources(metrics: MetricResult[]): RAGResponse['sources'] {
    return metrics.map((m) => ({
      type: 'metric' as const,
      ticker: m.ticker,
      filingType: m.filingType,
      fiscalPeriod: m.fiscalPeriod,
      pageNumber: m.sourcePage,
    }));
  }

  /** Convert snake_case metric name to a readable label */
  private formatMetricLabel(metric: string): string {
    return metric
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ── Visualization helpers ────────────────────────────────────────

  /**
   * Infer display name for a metric column.
   * Prefers displayName from the first MetricResult that matches.
   */
  private inferDisplayName(metricId: string, metrics: MetricResult[]): string {
    const match = metrics.find((m) => m.normalizedMetric === metricId);
    if (match?.displayName) return match.displayName;
    return this.formatMetricLabel(metricId);
  }

  /**
   * Infer format from metric name.
   * Metrics containing 'margin', 'rate', 'ratio', 'growth' → percentage; others → currency.
   */
  private inferFormat(metricId: string): string {
    const lower = metricId.toLowerCase();
    if (/margin|rate|ratio|growth/.test(lower)) return 'percentage';
    return 'currency';
  }

  /**
   * Infer unit_scale from the magnitude of metric values.
   * Examines all values for the given metric and picks the scale of the largest absolute value.
   */
  private inferUnitScale(metrics: MetricResult[], metricId: string): string {
    let maxAbs = 0;
    for (const m of metrics) {
      if (m.normalizedMetric === metricId && m.value != null) {
        const abs = Math.abs(m.value);
        if (abs > maxAbs) maxAbs = abs;
      }
    }
    if (maxAbs > 1_000_000_000) return 'billions';
    if (maxAbs > 1_000_000) return 'millions';
    if (maxAbs > 1_000) return 'thousands';
    return 'ones';
  }

  /**
   * Fiscal period sort key — mirrors StructuredRetriever.parseFiscalPeriodSortKey().
   * FY2024 → 20240000, Q3FY2024 → 20240300, TTM → 99990000.
   */
  private fiscalPeriodSortKey(period: string): number {
    if (!period) return 0;
    if (/TTM/i.test(period)) return 99990000;

    // Quarterly: Q3FY2024 → year * 10000 + quarter * 100
    const qtr = period.match(/Q([1-4])[\s\-]?(?:FY)?(\d{4})/i);
    if (qtr) return parseInt(qtr[2], 10) * 10000 + parseInt(qtr[1], 10) * 100;

    // Annual: FY2024 → year * 10000
    const fy = period.match(/(?:FY)(\d{4})/i);
    if (fy) return parseInt(fy[1], 10) * 10000;

    // Bare year
    const bare = period.match(/^(\d{4})$/);
    if (bare) return parseInt(bare[1], 10) * 10000;

    return 0;
  }
}
