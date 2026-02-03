import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LogPerformance } from './log-performance.decorator';
import { handlePrismaError } from './prisma-error-handler';

export interface Anomaly {
  id: string;
  type: AnomalyType;
  severity: 'high' | 'medium' | 'low';
  metric: string;
  period: string;
  value: number;
  expectedValue: number | null;
  deviation: number | null;
  description: string;
  context: string;
  actionable: boolean;
  dismissed: boolean;
}

export type AnomalyType =
  | 'statistical_outlier'
  | 'sequential_change'
  | 'trend_reversal'
  | 'management_tone_shift';

export interface AnomalySummary {
  total: number;
  byType: Record<AnomalyType, number>;
  bySeverity: Record<string, number>;
}

@Injectable()
export class AnomalyDetectionService {
  private readonly logger = new Logger(AnomalyDetectionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Detect all anomalies for a deal
   */
  @LogPerformance
  async detectAnomalies(
    dealId: string,
    types?: AnomalyType[],
  ): Promise<Anomaly[]> {
    // Validate input
    if (!dealId) {
      throw new BadRequestException('Deal ID is required');
    }

    try {
      // Get deal info to get ticker
      const deal = await this.prisma.deal.findUnique({
        where: { id: dealId },
      });

      if (!deal) {
        throw new NotFoundException(`Deal with ID ${dealId} not found`);
      }

      if (!deal.ticker) {
        throw new BadRequestException('Deal must have a ticker symbol');
      }

      const anomalies: Anomaly[] = [];

      // Detect different types of anomalies
      if (!types || types.includes('statistical_outlier')) {
        const outliers = await this.detectStatisticalOutliers(deal.ticker);
        anomalies.push(...outliers);
      }

      if (!types || types.includes('sequential_change')) {
        const sequential = await this.detectSequentialChanges(deal.ticker);
        anomalies.push(...sequential);
      }

      if (!types || types.includes('trend_reversal')) {
        const reversals = await this.detectTrendReversals(deal.ticker);
        anomalies.push(...reversals);
      }

      if (!types || types.includes('management_tone_shift')) {
        const toneShifts = await this.detectToneShifts(deal.ticker);
        anomalies.push(...toneShifts);
      }

      // Prioritize anomalies
      const prioritized = this.prioritizeAnomalies(anomalies);

      this.logger.log(
        `Detected ${prioritized.length} anomalies for deal ${dealId}`,
      );

      return prioritized;
    } catch (error) {
      // Log error with context
      this.logger.error(
        `Error detecting anomalies for deal ${dealId}:`,
        error.stack,
      );

      // Handle Prisma errors
      if (error.code && error.code.startsWith('P')) {
        handlePrismaError(error, 'Anomaly detection');
      }

      // Re-throw known HTTP exceptions
      if (error.status) {
        throw error;
      }

      // Wrap unknown errors
      throw new BadRequestException(
        'Failed to detect anomalies. Please try again.',
      );
    }
  }

  /**
   * Detect statistical outliers (>2σ from mean)
   */
  private async detectStatisticalOutliers(
    ticker: string,
  ): Promise<Anomaly[]> {
    const outliers: Anomaly[] = [];

    // Get all metrics for this ticker
    const metrics = await this.prisma.financialMetric.findMany({
      where: { ticker },
      orderBy: { fiscalPeriod: 'asc' },
    });

    // Group by metric name
    const metricGroups = this.groupByMetricName(metrics);

    // Analyze each metric
    for (const [metricName, values] of Object.entries(metricGroups)) {
      if (values.length < 4) continue; // Need at least 4 data points

      const numericValues = values.map((v) => Number(v.value));
      const mean = this.calculateMean(numericValues);
      const stdDev = this.calculateStdDev(numericValues);

      if (stdDev === 0) continue; // No variation

      // Check latest value
      const latest = values[values.length - 1];
      const latestValue = Number(latest.value);
      const deviation = Math.abs((latestValue - mean) / stdDev);

      if (deviation > 2) {
        // Outlier detected
        const severity = this.calculateSeverity(deviation);

        outliers.push({
          id: `outlier-${metricName}-${latest.fiscalPeriod}`,
          type: 'statistical_outlier',
          severity,
          metric: metricName,
          period: latest.fiscalPeriod,
          value: latestValue,
          expectedValue: mean,
          deviation,
          description: `${metricName} is ${deviation.toFixed(1)}σ from historical average`,
          context: `Historical range: ${this.formatCurrency(mean - 2 * stdDev)} to ${this.formatCurrency(mean + 2 * stdDev)}`,
          actionable: true,
          dismissed: false,
        });
      }
    }

    return outliers;
  }

  /**
   * Detect sequential changes (first time in X quarters)
   */
  private async detectSequentialChanges(ticker: string): Promise<Anomaly[]> {
    const changes: Anomaly[] = [];

    // Get quarterly metrics
    const metrics = await this.prisma.financialMetric.findMany({
      where: {
        ticker,
        fiscalPeriod: { contains: 'Q' }, // Quarterly data
      },
      orderBy: { fiscalPeriod: 'asc' },
    });

    // Group by metric name
    const metricGroups = this.groupByMetricName(metrics);

    // Analyze each metric for streaks
    for (const [metricName, values] of Object.entries(metricGroups)) {
      if (values.length < 5) continue; // Need at least 5 quarters

      const streak = this.findStreak(values);

      if (streak.length >= 4) {
        // 4+ quarters streak
        const latest = values[values.length - 1];

        changes.push({
          id: `sequential-${metricName}-${latest.fiscalPeriod}`,
          type: 'sequential_change',
          severity: 'medium',
          metric: metricName,
          period: latest.fiscalPeriod,
          value: Number(latest.value),
          expectedValue: null,
          deviation: null,
          description: `First ${streak.direction} in ${streak.length} quarters`,
          context: `Previous trend: ${streak.previousDirection}`,
          actionable: true,
          dismissed: false,
        });
      }
    }

    return changes;
  }

  /**
   * Detect trend reversals
   */
  private async detectTrendReversals(ticker: string): Promise<Anomaly[]> {
    const reversals: Anomaly[] = [];

    // Get metrics
    const metrics = await this.prisma.financialMetric.findMany({
      where: { ticker },
      orderBy: { fiscalPeriod: 'asc' },
    });

    // Group by metric name
    const metricGroups = this.groupByMetricName(metrics);

    // Analyze each metric for reversals
    for (const [metricName, values] of Object.entries(metricGroups)) {
      if (values.length < 4) continue;

      const reversal = this.detectReversal(values);

      if (reversal) {
        const latest = values[values.length - 1];

        reversals.push({
          id: `reversal-${metricName}-${latest.fiscalPeriod}`,
          type: 'trend_reversal',
          severity: 'medium',
          metric: metricName,
          period: latest.fiscalPeriod,
          value: Number(latest.value),
          expectedValue: null,
          deviation: null,
          description: `Trend reversed from ${reversal.from} to ${reversal.to}`,
          context: `After ${reversal.duration} periods of ${reversal.from}`,
          actionable: true,
          dismissed: false,
        });
      }
    }

    return reversals;
  }

  /**
   * Detect management tone shifts in MD&A
   */
  private async detectToneShifts(ticker: string): Promise<Anomaly[]> {
    const shifts: Anomaly[] = [];

    // Keywords to track
    const keywords = [
      'headwinds',
      'tailwinds',
      'pressure',
      'improving',
      'challenging',
      'uncertainty',
    ];

    // Get narrative chunks (MD&A)
    const chunks = await this.prisma.narrativeChunk.findMany({
      where: {
        ticker,
        sectionType: 'mda',
      },
      orderBy: { filingDate: 'desc' },
      take: 2, // Latest 2 filings
    });

    if (chunks.length < 2) return shifts;

    const [latest, previous] = chunks;

    // Analyze keyword frequency
    for (const keyword of keywords) {
      const latestFreq = this.countKeyword(latest.content, keyword);
      const previousFreq = this.countKeyword(previous.content, keyword);

      const change = latestFreq - previousFreq;

      if (Math.abs(change) >= 3) {
        // 3+ mention change
        shifts.push({
          id: `tone-${keyword}-${latest.filingDate.toISOString()}`,
          type: 'management_tone_shift',
          severity: 'low',
          metric: `Keyword: ${keyword}`,
          period: latest.filingDate.toISOString().split('T')[0],
          value: latestFreq,
          expectedValue: previousFreq,
          deviation: change,
          description: `"${keyword}" mentioned ${latestFreq}x vs ${previousFreq}x last period`,
          context: 'Check MD&A for context',
          actionable: true,
          dismissed: false,
        });
      }
    }

    return shifts;
  }

  /**
   * Prioritize anomalies by severity and type
   */
  private prioritizeAnomalies(anomalies: Anomaly[]): Anomaly[] {
    const severityOrder = { high: 0, medium: 1, low: 2 };

    return anomalies.sort((a, b) => {
      // Sort by severity first
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      // Then by type
      return a.type.localeCompare(b.type);
    });
  }

  /**
   * Calculate summary statistics
   */
  calculateSummary(anomalies: Anomaly[]): AnomalySummary {
    const summary: AnomalySummary = {
      total: anomalies.length,
      byType: {
        statistical_outlier: 0,
        sequential_change: 0,
        trend_reversal: 0,
        management_tone_shift: 0,
      },
      bySeverity: {
        high: 0,
        medium: 0,
        low: 0,
      },
    };

    for (const anomaly of anomalies) {
      summary.byType[anomaly.type]++;
      summary.bySeverity[anomaly.severity]++;
    }

    return summary;
  }

  // Helper methods

  private groupByMetricName(
    metrics: any[],
  ): Record<string, any[]> {
    return metrics.reduce((acc, metric) => {
      const key = metric.normalizedMetric || metric.metricName;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(metric);
      return acc;
    }, {});
  }

  private calculateMean(values: number[]): number {
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private calculateStdDev(values: number[]): number {
    const mean = this.calculateMean(values);
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    const variance = this.calculateMean(squaredDiffs);
    return Math.sqrt(variance);
  }

  private calculateSeverity(deviation: number): 'high' | 'medium' | 'low' {
    if (deviation > 3) return 'high';
    if (deviation > 2.5) return 'medium';
    return 'low';
  }

  private findStreak(values: any[]): {
    length: number;
    direction: string;
    previousDirection: string;
  } {
    if (values.length < 2) {
      return { length: 0, direction: 'flat', previousDirection: 'flat' };
    }

    let streakLength = 1;
    let currentDirection = 'flat';

    // Determine current direction
    const latest = Number(values[values.length - 1].value);
    const previous = Number(values[values.length - 2].value);

    if (latest > previous * 1.05) {
      currentDirection = 'increase';
    } else if (latest < previous * 0.95) {
      currentDirection = 'decrease';
    }

    // Count streak
    for (let i = values.length - 2; i > 0; i--) {
      const curr = Number(values[i].value);
      const prev = Number(values[i - 1].value);

      let direction = 'flat';
      if (curr > prev * 1.05) direction = 'increase';
      else if (curr < prev * 0.95) direction = 'decrease';

      if (direction === currentDirection) {
        streakLength++;
      } else {
        break;
      }
    }

    return {
      length: streakLength,
      direction: currentDirection,
      previousDirection: 'opposite',
    };
  }

  private detectReversal(values: any[]): {
    from: string;
    to: string;
    duration: number;
  } | null {
    if (values.length < 4) return null;

    // Check if trend reversed in latest period
    const latest = Number(values[values.length - 1].value);
    const previous = Number(values[values.length - 2].value);
    const beforePrevious = Number(values[values.length - 3].value);

    const latestChange = (latest - previous) / previous;
    const previousChange = (previous - beforePrevious) / beforePrevious;

    // Reversal if signs are opposite and magnitude > 5%
    if (
      Math.abs(latestChange) > 0.05 &&
      Math.abs(previousChange) > 0.05 &&
      latestChange * previousChange < 0
    ) {
      return {
        from: previousChange > 0 ? 'increasing' : 'decreasing',
        to: latestChange > 0 ? 'increasing' : 'decreasing',
        duration: 3,
      };
    }

    return null;
  }

  private countKeyword(text: string, keyword: string): number {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  }

  private formatCurrency(value: number): string {
    if (Math.abs(value) >= 1e9) {
      return `$${(value / 1e9).toFixed(1)}B`;
    } else if (Math.abs(value) >= 1e6) {
      return `$${(value / 1e6).toFixed(1)}M`;
    }
    return `$${value.toFixed(0)}`;
  }
}
