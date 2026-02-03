import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

export interface CompTableRow {
  ticker: string;
  companyName: string;
  values: Record<string, number | null>;
  percentiles: Record<string, number | null>; // 0-100
  outliers: string[]; // metric names that are outliers
}

export interface CompTableData {
  headers: string[];
  rows: CompTableRow[];
  summary: {
    median: Record<string, number | null>;
    mean: Record<string, number | null>;
    percentiles: Record<string, Record<string, number>>;
  };
}

export interface CompTableOptions {
  companies: string[]; // tickers
  metrics: string[]; // normalized metric names
  period: string; // fiscal period (e.g., 'FY2024')
}

@Injectable()
export class CompTableService {
  private readonly logger = new Logger(CompTableService.name);
  private readonly cache = new Map<string, { data: CompTableData; timestamp: number }>();
  private readonly CACHE_TTL = 86400000; // 1 day in milliseconds

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build comparison table for multiple companies
   */
  async buildCompTable(options: CompTableOptions): Promise<CompTableData> {
    this.logger.log(
      `Building comp table for ${options.companies.length} companies, ${options.metrics.length} metrics, period ${options.period}`,
    );

    // Check cache
    const cacheKey = this.getCacheKey(options);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.logger.log('Returning cached comp table');
      return cached.data;
    }

    // Build rows for each company
    const rows: CompTableRow[] = [];

    for (const ticker of options.companies) {
      const row = await this.buildCompTableRow(
        ticker,
        options.metrics,
        options.period,
      );
      if (row) {
        rows.push(row);
      }
    }

    if (rows.length === 0) {
      throw new Error('No data found for any of the specified companies');
    }

    // Calculate summary statistics
    const summary = this.calculateSummaryStats(rows, options.metrics);

    // Calculate percentiles for each company
    this.calculatePercentiles(rows, summary, options.metrics);

    // Identify outliers
    this.identifyOutliers(rows, summary, options.metrics);

    const data: CompTableData = {
      headers: ['Ticker', 'Company', ...options.metrics],
      rows,
      summary,
    };

    // Cache the result
    this.cache.set(cacheKey, { data, timestamp: Date.now() });

    this.logger.log(`Comp table built with ${rows.length} companies`);

    return data;
  }

  /**
   * Build a single row for a company
   */
  private async buildCompTableRow(
    ticker: string,
    metrics: string[],
    period: string,
  ): Promise<CompTableRow | null> {
    // Get company name from deals table
    const deal = await this.prisma.deal.findFirst({
      where: { ticker },
    });

    if (!deal) {
      this.logger.warn(`No deal found for ticker ${ticker}`);
      return null;
    }

    // Get metric values for this company and period
    const values: Record<string, number> = {};

    for (const metric of metrics) {
      const metricData = await this.prisma.financialMetric.findFirst({
        where: {
          ticker,
          normalizedMetric: metric,
          fiscalPeriod: period,
        },
        orderBy: { filingDate: 'desc' }, // Get most recent if multiple
      });

      if (metricData) {
        values[metric] = this.decimalToNumber(metricData.value);
      } else {
        this.logger.warn(
          `No data found for ${ticker} - ${metric} - ${period}`,
        );
        values[metric] = null;
      }
    }

    // Check if we have at least some data
    const hasData = Object.values(values).some((v) => v !== null);
    if (!hasData) {
      this.logger.warn(`No metric data found for ${ticker} in ${period}`);
      return null;
    }

    return {
      ticker,
      companyName: deal.companyName || ticker,
      values,
      percentiles: {},
      outliers: [],
    };
  }

  /**
   * Calculate summary statistics (median, mean, percentiles)
   */
  calculateSummaryStats(
    rows: CompTableRow[],
    metrics: string[],
  ): CompTableData['summary'] {
    const summary: CompTableData['summary'] = {
      median: {},
      mean: {},
      percentiles: {},
    };

    for (const metric of metrics) {
      const values = rows
        .map((r) => r.values[metric])
        .filter((v) => v !== null && !isNaN(v));

      if (values.length === 0) {
        this.logger.warn(`No valid values for metric ${metric}`);
        continue;
      }

      summary.median[metric] = this.calculateMedian(values);
      summary.mean[metric] = this.calculateMean(values);
      summary.percentiles[metric] = {
        p25: this.calculatePercentile(values, 25),
        p50: this.calculatePercentile(values, 50),
        p75: this.calculatePercentile(values, 75),
      };
    }

    return summary;
  }

  /**
   * Calculate percentile rank for each company's metrics
   */
  calculatePercentiles(
    rows: CompTableRow[],
    summary: CompTableData['summary'],
    metrics: string[],
  ): void {
    for (const row of rows) {
      for (const metric of metrics) {
        const value = row.values[metric];
        if (value === null || isNaN(value)) {
          row.percentiles[metric] = null;
          continue;
        }

        // Get all values for this metric
        const allValues = rows
          .map((r) => r.values[metric])
          .filter((v) => v !== null && !isNaN(v));

        if (allValues.length === 0) {
          row.percentiles[metric] = null;
          continue;
        }

        // Calculate percentile rank (0-100)
        const rank = allValues.filter((v) => v < value).length;
        row.percentiles[metric] = (rank / allValues.length) * 100;
      }
    }
  }

  /**
   * Identify outliers (top/bottom quartile)
   */
  identifyOutliers(
    rows: CompTableRow[],
    summary: CompTableData['summary'],
    metrics: string[],
  ): void {
    for (const row of rows) {
      row.outliers = [];

      for (const metric of metrics) {
        const percentile = row.percentiles[metric];

        if (percentile === null || isNaN(percentile)) {
          continue;
        }

        // Top or bottom quartile are outliers
        if (percentile >= 75 || percentile <= 25) {
          row.outliers.push(metric);
        }
      }
    }
  }

  /**
   * Calculate median of an array
   */
  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
      return sorted[mid];
    }
  }

  /**
   * Calculate mean of an array
   */
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Calculate percentile of an array
   */
  calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    if (lower === upper) {
      return sorted[lower];
    }

    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Convert Prisma Decimal to number
   */
  private decimalToNumber(decimal: Decimal): number {
    return Number(decimal.toString());
  }

  /**
   * Generate cache key
   */
  private getCacheKey(options: CompTableOptions): string {
    // Don't sort - preserve order for consistent headers
    return `${options.companies.join(',')}|${options.metrics.join(',')}|${options.period}`;
  }

  /**
   * Clear cache (for testing or manual refresh)
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('Comp table cache cleared');
  }
}
