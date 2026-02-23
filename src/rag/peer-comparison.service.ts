import { Injectable, Logger } from '@nestjs/common';
import { StructuredRetrieverService } from './structured-retriever.service';
import { MetricResolution } from './metric-resolution/types';
import { PeerComparisonResult } from './hybrid-synthesis.service';
import { MetricResult } from './types/query-intent';

/**
 * Raw fetch result for a single ticker × metric combination.
 */
interface RawFetchResult {
  ticker: string;
  metricId: string;
  annual: MetricResult | null;
  quarterly: MetricResult[];
  fiscalYearEnd?: Date;
}

/**
 * Normalized value for a single ticker × metric after period normalization.
 */
interface NormalizedEntry {
  ticker: string;
  metricId: string;
  value: number | null;
  period: string;
  fiscalYearEnd?: Date;
  incomplete?: boolean;
}

/**
 * PeerComparisonService — Fetches and normalizes metrics across peer universe
 * tickers for comparative analysis.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4
 */
@Injectable()
export class PeerComparisonService {
  private readonly logger = new Logger(PeerComparisonService.name);

  constructor(
    private readonly structuredRetriever: StructuredRetrieverService,
  ) {}

  /**
   * Compare tickers across metrics with period normalization.
   *
   * Req 16.1: Parallel fetch all tickers × metrics via Promise.all
   * Req 16.2: LTM normalization sums trailing 4 quarters
   * Req 16.3: Compute median, mean, rank, subject-vs-median
   * Req 16.4: PeerComparisonResult shape
   */
  async compare(
    tickers: string[],
    metrics: MetricResolution[],
    period: string,
    normalizationBasis: 'FY' | 'LTM' | 'CY',
    subjectTicker?: string,
  ): Promise<PeerComparisonResult[]> {
    this.logger.log(
      `Peer comparison: ${tickers.length} tickers × ${metrics.length} metrics, basis=${normalizationBasis}`,
    );

    // Req 16.1: Parallel fetch all ticker × metric combinations
    const fetchPromises: Promise<RawFetchResult>[] = [];
    for (const ticker of tickers) {
      for (const metric of metrics) {
        fetchPromises.push(this.fetchTickerMetric(ticker, metric));
      }
    }
    const rawResults = await Promise.all(fetchPromises);

    // Group raw results by metric
    const byMetric = new Map<string, RawFetchResult[]>();
    for (const raw of rawResults) {
      const existing = byMetric.get(raw.metricId) ?? [];
      existing.push(raw);
      byMetric.set(raw.metricId, existing);
    }

    // Build one PeerComparisonResult per metric
    const results: PeerComparisonResult[] = [];
    for (const metric of metrics) {
      const metricRaws = byMetric.get(metric.canonical_id) ?? [];
      const normalized = this.normalizePeriods(metricRaws, normalizationBasis);
      const result = this.buildComparisonResult(
        normalized,
        tickers,
        metric,
        period,
        normalizationBasis,
        subjectTicker,
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Fetch annual and quarterly data for a single ticker × metric.
   */
  private async fetchTickerMetric(
    ticker: string,
    metric: MetricResolution,
  ): Promise<RawFetchResult> {
    try {
      const query = {
        tickers: [ticker],
        metrics: [metric],
        filingTypes: ['10-K', '10-Q'],
        period: 'latest',
      };
      const { metrics: retrieved } = await this.structuredRetriever.retrieve(query as any);

      const annual = retrieved.find(
        (m) => m.ticker === ticker && m.filingType === '10-K',
      ) ?? null;

      const quarterly = retrieved.filter(
        (m) => m.ticker === ticker && m.filingType === '10-Q',
      );

      // Extract fiscal year-end from annual filing date
      const fiscalYearEnd = annual?.statementDate ?? undefined;

      return {
        ticker,
        metricId: metric.canonical_id,
        annual,
        quarterly,
        fiscalYearEnd,
      };
    } catch (e) {
      this.logger.warn(`Fetch failed for ${ticker}/${metric.canonical_id}: ${e.message}`);
      return {
        ticker,
        metricId: metric.canonical_id,
        annual: null,
        quarterly: [],
      };
    }
  }

  /**
   * Normalize periods based on the normalization basis.
   *
   * FY: passthrough — use annual data as-is
   * LTM: sum trailing 4 quarters
   * CY: calendar year alignment (passthrough for now)
   */
  normalizePeriods(
    rawResults: RawFetchResult[],
    basis: string,
  ): NormalizedEntry[] {
    const entries: NormalizedEntry[] = [];

    for (const raw of rawResults) {
      switch (basis) {
        case 'LTM': {
          const ltm = this.computeLTM(raw);
          entries.push(ltm);
          break;
        }
        case 'FY':
        case 'CY':
        default: {
          // FY/CY passthrough: use annual data
          entries.push({
            ticker: raw.ticker,
            metricId: raw.metricId,
            value: raw.annual?.value ?? null,
            period: raw.annual?.fiscalPeriod ?? 'N/A',
            fiscalYearEnd: raw.fiscalYearEnd,
          });
          break;
        }
      }
    }

    return entries;
  }

  /**
   * Compute LTM (Last Twelve Months) by summing trailing 4 quarters.
   *
   * Req 16.2: LTM normalization sums trailing 4 quarters.
   * If fewer than 4 quarters available, flag as incomplete.
   */
  computeLTM(raw: RawFetchResult): NormalizedEntry {
    const quarters = raw.quarterly
      .filter((q) => q.value !== null && q.value !== undefined)
      .sort((a, b) => {
        // Sort by fiscal period descending to get most recent first
        const keyA = this.parseFiscalPeriodSortKey(a.fiscalPeriod);
        const keyB = this.parseFiscalPeriodSortKey(b.fiscalPeriod);
        return keyB - keyA;
      })
      .slice(0, 4); // Take 4 most recent

    if (quarters.length === 0) {
      return {
        ticker: raw.ticker,
        metricId: raw.metricId,
        value: null,
        period: 'LTM',
        fiscalYearEnd: raw.fiscalYearEnd,
        incomplete: true,
      };
    }

    const sum = quarters.reduce((acc, q) => acc + (q.value ?? 0), 0);
    const incomplete = quarters.length < 4;

    return {
      ticker: raw.ticker,
      metricId: raw.metricId,
      value: sum,
      period: 'LTM',
      fiscalYearEnd: raw.fiscalYearEnd,
      incomplete,
    };
  }

  /**
   * Build the PeerComparisonResult with statistics.
   *
   * Req 16.3: Compute median, mean, rank, subject-vs-median
   * Req 16.4: PeerComparisonResult shape
   */
  private buildComparisonResult(
    normalized: NormalizedEntry[],
    tickers: string[],
    metric: MetricResolution,
    period: string,
    normalizationBasis: 'FY' | 'LTM' | 'CY',
    subjectTicker?: string,
  ): PeerComparisonResult {
    // Build rows — ensure all tickers are represented
    const tickerMap = new Map<string, NormalizedEntry>();
    for (const entry of normalized) {
      tickerMap.set(entry.ticker, entry);
    }

    // Get numeric values for statistics (exclude nulls)
    const numericValues = normalized
      .map((e) => e.value)
      .filter((v): v is number => v !== null);

    // Sort descending for ranking (rank 1 = highest value)
    const sortedValues = [...numericValues].sort((a, b) => b - a);

    // Build rows with ranks
    const rows: Array<{ ticker: string; value: number | null; rank: number }> = [];
    for (const ticker of tickers) {
      const entry = tickerMap.get(ticker);
      const value = entry?.value ?? null;
      const rank = value !== null
        ? sortedValues.indexOf(value) + 1
        : tickers.length; // null values get last rank
      rows.push({ ticker, value, rank });
    }

    // Sort rows by rank
    rows.sort((a, b) => a.rank - b.rank);

    // Compute median
    const median = this.computeMedian(numericValues);

    // Compute mean
    const mean = numericValues.length > 0
      ? numericValues.reduce((a, b) => a + b, 0) / numericValues.length
      : 0;

    // Subject ticker stats
    let subjectRank: number | undefined;
    let subjectVsMedianPct: number | undefined;
    if (subjectTicker) {
      const subjectRow = rows.find((r) => r.ticker === subjectTicker);
      if (subjectRow) {
        subjectRank = subjectRow.rank;
        if (subjectRow.value !== null && median !== 0) {
          subjectVsMedianPct = ((subjectRow.value - median) / Math.abs(median)) * 100;
        }
      }
    }

    // Check FY mismatch — fiscal year-ends differ by > 60 days
    const fyMismatchWarning = this.checkFYMismatch(normalized);

    return {
      metric: metric.canonical_id,
      normalizationBasis,
      period,
      rows,
      median,
      mean,
      subjectTicker,
      subjectRank,
      subjectVsMedianPct,
      fyMismatchWarning,
    };
  }

  /**
   * Compute statistical median of an array of numbers.
   */
  private computeMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  /**
   * Check if fiscal year-ends differ by > 60 days across tickers.
   *
   * Req 16.2: Flag FY mismatch when fiscal year-ends differ by > 60 days.
   */
  private checkFYMismatch(entries: NormalizedEntry[]): string | undefined {
    const yearEnds = entries
      .filter((e) => e.fiscalYearEnd instanceof Date && !isNaN(e.fiscalYearEnd.getTime()))
      .map((e) => ({ ticker: e.ticker, date: e.fiscalYearEnd! }));

    if (yearEnds.length < 2) return undefined;

    const MS_PER_DAY = 86_400_000;
    const SIXTY_DAYS_MS = 60 * MS_PER_DAY;

    for (let i = 0; i < yearEnds.length; i++) {
      for (let j = i + 1; j < yearEnds.length; j++) {
        // Compare month/day only (normalize to same year)
        const a = new Date(2000, yearEnds[i].date.getMonth(), yearEnds[i].date.getDate());
        const b = new Date(2000, yearEnds[j].date.getMonth(), yearEnds[j].date.getDate());
        const diff = Math.abs(a.getTime() - b.getTime());

        // Handle wrap-around (e.g., Jan vs Dec)
        const wrapDiff = 365 * MS_PER_DAY - diff;
        const minDiff = Math.min(diff, wrapDiff);

        if (minDiff > SIXTY_DAYS_MS) {
          return `Fiscal year-end mismatch: ${yearEnds[i].ticker} (${this.formatMonthDay(yearEnds[i].date)}) vs ${yearEnds[j].ticker} (${this.formatMonthDay(yearEnds[j].date)}) differ by >${Math.round(minDiff / MS_PER_DAY)} days`;
        }
      }
    }

    return undefined;
  }

  /**
   * Format a date as "Mon DD" for FY mismatch warnings.
   */
  private formatMonthDay(date: Date): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}`;
  }

  /**
   * Parse fiscal period into a numeric sort key (mirrors StructuredRetriever logic).
   */
  private parseFiscalPeriodSortKey(period: string): number {
    const qtr = period.match(/Q([1-4])[\s\-]?(?:FY)?(\d{4})/i);
    if (qtr) return parseInt(qtr[2]) * 10000 + parseInt(qtr[1]) * 100;

    const annual = period.match(/FY(\d{4})/i);
    if (annual) return parseInt(annual[1]) * 10000;

    if (/TTM/i.test(period)) return 99990000;

    const yr = period.match(/(\d{4})/);
    return yr ? parseInt(yr[1]) * 10000 : 0;
  }
}
