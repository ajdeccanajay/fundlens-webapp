import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { LogPerformance } from './log-performance.decorator';

export interface Change {
  id: string;
  type: 'new_disclosure' | 'language_change' | 'metric_change' | 'accounting_change';
  category: string;
  description: string;
  materiality: 'high' | 'medium' | 'low';
  fromPeriod: string;
  toPeriod: string;
  fromValue: string | number | null;
  toValue: string | number | null;
  percentChange?: number;
  context: string;
  sourceSection?: string;
  pageNumber?: number;
}

export interface ChangeTrackerData {
  changes: Change[];
  summary: {
    total: number;
    byType: Record<string, number>;
    byMateriality: Record<string, number>;
    byCategory: Record<string, number>;
  };
}

export interface ChangeTrackerOptions {
  ticker: string;
  fromPeriod: string; // e.g., "FY2023" or "2023-12-31"
  toPeriod: string;   // e.g., "FY2024" or "2024-12-31"
  types?: string[];
  materiality?: string;
}

@Injectable()
export class ChangeTrackerService {
  private readonly logger = new Logger(ChangeTrackerService.name);
  private readonly cache = new Map<string, { data: ChangeTrackerData; timestamp: number }>();
  private readonly CACHE_TTL = 3600000; // 1 hour

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Detect all changes between two fiscal periods
   */
  @LogPerformance
  async detectChanges(options: ChangeTrackerOptions): Promise<ChangeTrackerData> {
    this.logger.log(
      `Detecting changes for ${options.ticker} from ${options.fromPeriod} to ${options.toPeriod}`,
    );

    // Check cache
    const cacheKey = this.getCacheKey(options);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.logger.log('Returning cached change tracker data');
      return cached.data;
    }

    // Detect all types of changes
    const [newDisclosures, languageChanges, metricChanges, accountingChanges] =
      await Promise.all([
        this.detectNewDisclosures(options),
        this.detectLanguageChanges(options),
        this.detectMetricChanges(options),
        this.detectAccountingChanges(options),
      ]);

    // Combine all changes
    let allChanges = [
      ...newDisclosures,
      ...languageChanges,
      ...metricChanges,
      ...accountingChanges,
    ];

    // Apply filters
    if (options.types && options.types.length > 0) {
      allChanges = allChanges.filter((c) => options.types!.includes(c.type));
    }

    if (options.materiality) {
      allChanges = allChanges.filter((c) => c.materiality === options.materiality);
    }

    // Sort by materiality (high first) then by type
    allChanges.sort((a, b) => {
      const materialityOrder = { high: 0, medium: 1, low: 2 };
      const matDiff = materialityOrder[a.materiality] - materialityOrder[b.materiality];
      if (matDiff !== 0) return matDiff;
      return a.type.localeCompare(b.type);
    });

    // Calculate summary
    const summary = this.calculateSummary(allChanges);

    const result: ChangeTrackerData = {
      changes: allChanges,
      summary,
    };

    // Cache result
    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });

    this.logger.log(`Detected ${allChanges.length} changes`);
    return result;
  }

  /**
   * Detect new disclosures (sections/topics in new period but not in old)
   */
  async detectNewDisclosures(options: ChangeTrackerOptions): Promise<Change[]> {
    const changes: Change[] = [];

    try {
      // Get filing dates for both periods
      const [fromDate, toDate] = await Promise.all([
        this.getFilingDateForPeriod(options.ticker, options.fromPeriod),
        this.getFilingDateForPeriod(options.ticker, options.toPeriod),
      ]);

      if (!fromDate || !toDate) {
        this.logger.warn('Could not find filing dates for periods');
        return changes;
      }

      // Get narrative chunks for both periods
      const [fromChunks, toChunks] = await Promise.all([
        this.prisma.narrativeChunk.findMany({
          where: {
            ticker: options.ticker,
            filingDate: fromDate,
          },
        }),
        this.prisma.narrativeChunk.findMany({
          where: {
            ticker: options.ticker,
            filingDate: toDate,
          },
        }),
      ]);

      // Extract section types from both periods
      const fromSections = new Set(fromChunks.map((c) => c.sectionType));
      const toSections = new Set(toChunks.map((c) => c.sectionType));

      // Find new sections
      const newSections = Array.from(toSections).filter((s) => !fromSections.has(s));

      for (const section of newSections) {
        // Get sample content from new section
        const sampleChunk = toChunks.find((c) => c.sectionType === section);
        const content = sampleChunk?.content.substring(0, 200) || '';

        changes.push({
          id: `new_disclosure_${section}_${Date.now()}`,
          type: 'new_disclosure',
          category: 'New Section',
          description: `New section disclosed: ${section}`,
          materiality: this.calculateSectionMateriality(section),
          fromPeriod: options.fromPeriod,
          toPeriod: options.toPeriod,
          fromValue: null,
          toValue: content,
          context: `First appearance in ${options.toPeriod}`,
          sourceSection: section,
        });
      }

      // Detect new risk-related content
      const riskChanges = await this.detectNewRiskContent(
        options,
        fromChunks,
        toChunks,
      );
      changes.push(...riskChanges);
    } catch (error) {
      this.logger.error('Error detecting new disclosures:', error);
    }

    return changes;
  }

  /**
   * Detect language changes (keyword frequency, tone shifts)
   */
  async detectLanguageChanges(options: ChangeTrackerOptions): Promise<Change[]> {
    const changes: Change[] = [];

    try {
      // Get filing dates
      const [fromDate, toDate] = await Promise.all([
        this.getFilingDateForPeriod(options.ticker, options.fromPeriod),
        this.getFilingDateForPeriod(options.ticker, options.toPeriod),
      ]);

      if (!fromDate || !toDate) return changes;

      // Get MD&A chunks for both periods
      const [fromChunks, toChunks] = await Promise.all([
        this.prisma.narrativeChunk.findMany({
          where: {
            ticker: options.ticker,
            filingDate: fromDate,
            sectionType: { contains: 'MD&A' },
          },
        }),
        this.prisma.narrativeChunk.findMany({
          where: {
            ticker: options.ticker,
            filingDate: toDate,
            sectionType: { contains: 'MD&A' },
          },
        }),
      ]);

      // Detect keyword frequency changes
      const keywordChanges = this.detectKeywordFrequencyChanges(
        options,
        fromChunks,
        toChunks,
      );
      changes.push(...keywordChanges);

      // Detect tone shifts
      const toneChanges = this.detectToneShifts(options, fromChunks, toChunks);
      changes.push(...toneChanges);
    } catch (error) {
      this.logger.error('Error detecting language changes:', error);
    }

    return changes;
  }

  /**
   * Detect metric changes (discontinued, new, significantly changed)
   */
  async detectMetricChanges(options: ChangeTrackerOptions): Promise<Change[]> {
    const changes: Change[] = [];

    try {
      // Get all metrics for both periods
      const [fromMetrics, toMetrics] = await Promise.all([
        this.prisma.financialMetric.findMany({
          where: {
            ticker: options.ticker,
            fiscalPeriod: options.fromPeriod,
          },
        }),
        this.prisma.financialMetric.findMany({
          where: {
            ticker: options.ticker,
            fiscalPeriod: options.toPeriod,
          },
        }),
      ]);

      // Create maps for easy lookup
      const fromMetricMap = new Map(
        fromMetrics.map((m) => [m.normalizedMetric, m]),
      );
      const toMetricMap = new Map(
        toMetrics.map((m) => [m.normalizedMetric, m]),
      );

      // Detect discontinued metrics
      for (const [metric, data] of fromMetricMap.entries()) {
        if (!toMetricMap.has(metric)) {
          changes.push({
            id: `metric_discontinued_${metric}_${Date.now()}`,
            type: 'metric_change',
            category: 'Discontinued Metric',
            description: `Metric "${metric}" was discontinued`,
            materiality: 'high',
            fromPeriod: options.fromPeriod,
            toPeriod: options.toPeriod,
            fromValue: this.decimalToNumber(data.value),
            toValue: null,
            context: `Previously reported in ${options.fromPeriod}`,
          });
        }
      }

      // Detect new metrics
      for (const [metric, data] of toMetricMap.entries()) {
        if (!fromMetricMap.has(metric)) {
          changes.push({
            id: `metric_new_${metric}_${Date.now()}`,
            type: 'metric_change',
            category: 'New Metric',
            description: `New metric "${metric}" introduced`,
            materiality: 'medium',
            fromPeriod: options.fromPeriod,
            toPeriod: options.toPeriod,
            fromValue: null,
            toValue: this.decimalToNumber(data.value),
            context: `First reported in ${options.toPeriod}`,
          });
        }
      }

      // Detect significant value changes (>20% YoY)
      for (const [metric, toData] of toMetricMap.entries()) {
        const fromData = fromMetricMap.get(metric);
        if (fromData) {
          const fromValue = this.decimalToNumber(fromData.value);
          const toValue = this.decimalToNumber(toData.value);

          if (
            fromValue !== null &&
            toValue !== null &&
            fromValue !== 0
          ) {
            const percentChange =
              ((toValue - fromValue) / Math.abs(fromValue)) * 100;

            if (Math.abs(percentChange) > 20) {
              changes.push({
                id: `metric_change_${metric}_${Date.now()}`,
                type: 'metric_change',
                category: 'Significant Change',
                description: `${metric} changed by ${percentChange.toFixed(1)}%`,
                materiality: Math.abs(percentChange) > 50 ? 'high' : 'medium',
                fromPeriod: options.fromPeriod,
                toPeriod: options.toPeriod,
                fromValue,
                toValue,
                percentChange,
                context: 'Year-over-year change',
              });
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Error detecting metric changes:', error);
    }

    return changes;
  }

  /**
   * Detect accounting changes (policy changes, restatements)
   */
  async detectAccountingChanges(options: ChangeTrackerOptions): Promise<Change[]> {
    const changes: Change[] = [];

    try {
      // Get filing date for new period
      const toDate = await this.getFilingDateForPeriod(
        options.ticker,
        options.toPeriod,
      );

      if (!toDate) return changes;

      // Get accounting-related chunks
      const accountingChunks = await this.prisma.narrativeChunk.findMany({
        where: {
          ticker: options.ticker,
          filingDate: toDate,
          OR: [
            { sectionType: { contains: 'Accounting' } },
            { sectionType: { contains: 'Policies' } },
            { sectionType: { contains: 'Notes' } },
          ],
        },
      });

      // Keywords that indicate accounting changes
      const accountingKeywords = [
        'accounting policy',
        'accounting standard',
        'ASC',
        'IFRS',
        'restatement',
        'reclassification',
        'change in estimate',
        'depreciation method',
        'revenue recognition',
        'lease accounting',
        'adoption',
        'implemented',
        'adopted new',
      ];

      for (const chunk of accountingChunks) {
        const content = chunk.content.toLowerCase();

        for (const keyword of accountingKeywords) {
          if (content.includes(keyword.toLowerCase())) {
            // Extract context around the keyword
            const keywordIndex = content.indexOf(keyword.toLowerCase());
            const contextStart = Math.max(0, keywordIndex - 100);
            const contextEnd = Math.min(content.length, keywordIndex + 200);
            const context = chunk.content.substring(contextStart, contextEnd);

            changes.push({
              id: `accounting_${keyword.replace(/\s+/g, '_')}_${Date.now()}`,
              type: 'accounting_change',
              category: 'Accounting Policy',
              description: `Accounting change related to: ${keyword}`,
              materiality: 'high',
              fromPeriod: options.fromPeriod,
              toPeriod: options.toPeriod,
              fromValue: null,
              toValue: context,
              context: `${chunk.sectionType} section`,
              sourceSection: chunk.sectionType,
            });
            break; // Only one change per chunk
          }
        }
      }
    } catch (error) {
      this.logger.error('Error detecting accounting changes:', error);
    }

    return changes;
  }

  /**
   * Helper: Detect new risk-related content
   */
  private async detectNewRiskContent(
    options: ChangeTrackerOptions,
    fromChunks: any[],
    toChunks: any[],
  ): Promise<Change[]> {
    const changes: Change[] = [];

    // Get risk-related chunks
    const fromRiskChunks = fromChunks.filter((c) =>
      c.sectionType.toLowerCase().includes('risk'),
    );
    const toRiskChunks = toChunks.filter((c) =>
      c.sectionType.toLowerCase().includes('risk'),
    );

    // If there are more risk chunks in new period, it might indicate new risks
    if (toRiskChunks.length > fromRiskChunks.length) {
      const newRiskKeywords = [
        'cybersecurity',
        'litigation',
        'investigation',
        'breach',
        'regulatory',
        'compliance',
      ];

      for (const chunk of toRiskChunks) {
        const content = chunk.content.toLowerCase();

        for (const keyword of newRiskKeywords) {
          if (content.includes(keyword)) {
            // Check if this keyword wasn't prominent in old period
            const oldMentions = fromRiskChunks.filter((c) =>
              c.content.toLowerCase().includes(keyword),
            ).length;
            const newMentions = toRiskChunks.filter((c) =>
              c.content.toLowerCase().includes(keyword),
            ).length;

            if (newMentions > oldMentions * 1.5) {
              // 50% increase
              changes.push({
                id: `new_risk_${keyword}_${Date.now()}`,
                type: 'new_disclosure',
                category: 'Risk Factors',
                description: `Increased focus on ${keyword} risk`,
                materiality: 'high',
                fromPeriod: options.fromPeriod,
                toPeriod: options.toPeriod,
                fromValue: oldMentions,
                toValue: newMentions,
                percentChange: ((newMentions - oldMentions) / (oldMentions || 1)) * 100,
                context: `Risk Factors section`,
                sourceSection: chunk.sectionType,
              });
              break;
            }
          }
        }
      }
    }

    return changes;
  }

  /**
   * Helper: Detect keyword frequency changes
   */
  private detectKeywordFrequencyChanges(
    options: ChangeTrackerOptions,
    fromChunks: any[],
    toChunks: any[],
  ): Change[] {
    const changes: Change[] = [];

    // Keywords to track
    const trackedKeywords = [
      'growth',
      'decline',
      'challenge',
      'opportunity',
      'headwind',
      'tailwind',
      'uncertainty',
      'confident',
      'expect',
      'anticipate',
    ];

    const fromFreq = this.countKeywordFrequencies(fromChunks, trackedKeywords);
    const toFreq = this.countKeywordFrequencies(toChunks, trackedKeywords);

    for (const keyword of trackedKeywords) {
      const fromCount = fromFreq.get(keyword) || 0;
      const toCount = toFreq.get(keyword) || 0;

      // Significant change: >50% increase or decrease
      if (fromCount > 0 && Math.abs(toCount - fromCount) / fromCount > 0.5) {
        const percentChange = ((toCount - fromCount) / fromCount) * 100;

        changes.push({
          id: `keyword_freq_${keyword}_${Date.now()}`,
          type: 'language_change',
          category: 'Keyword Frequency',
          description: `Keyword "${keyword}" frequency changed by ${percentChange.toFixed(0)}%`,
          materiality: Math.abs(percentChange) > 100 ? 'medium' : 'low',
          fromPeriod: options.fromPeriod,
          toPeriod: options.toPeriod,
          fromValue: fromCount,
          toValue: toCount,
          percentChange,
          context: 'MD&A narrative analysis',
        });
      }
    }

    return changes;
  }

  /**
   * Helper: Detect tone shifts
   */
  private detectToneShifts(
    options: ChangeTrackerOptions,
    fromChunks: any[],
    toChunks: any[],
  ): Change[] {
    const changes: Change[] = [];

    // Simple sentiment analysis based on keyword presence
    const positiveWords = ['growth', 'strong', 'improved', 'success', 'opportunity'];
    const negativeWords = ['decline', 'weak', 'challenge', 'risk', 'uncertainty'];

    const fromSentiment = this.calculateSimpleSentiment(fromChunks, positiveWords, negativeWords);
    const toSentiment = this.calculateSimpleSentiment(toChunks, positiveWords, negativeWords);

    if (fromSentiment !== toSentiment) {
      changes.push({
        id: `tone_shift_${Date.now()}`,
        type: 'language_change',
        category: 'Management Tone',
        description: `Overall tone shifted from ${fromSentiment} to ${toSentiment}`,
        materiality: this.calculateToneShiftMateriality(fromSentiment, toSentiment),
        fromPeriod: options.fromPeriod,
        toPeriod: options.toPeriod,
        fromValue: fromSentiment,
        toValue: toSentiment,
        context: 'MD&A section',
      });
    }

    return changes;
  }

  /**
   * Helper: Count keyword frequencies
   */
  private countKeywordFrequencies(
    chunks: any[],
    keywords: string[],
  ): Map<string, number> {
    const freq = new Map<string, number>();

    for (const keyword of keywords) {
      let count = 0;
      for (const chunk of chunks) {
        const text = chunk.content.toLowerCase();
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        const matches = text.match(regex);
        count += matches ? matches.length : 0;
      }
      freq.set(keyword, count);
    }

    return freq;
  }

  /**
   * Helper: Calculate simple sentiment
   */
  private calculateSimpleSentiment(
    chunks: any[],
    positiveWords: string[],
    negativeWords: string[],
  ): string {
    let positiveCount = 0;
    let negativeCount = 0;

    for (const chunk of chunks) {
      const text = chunk.content.toLowerCase();
      positiveCount += positiveWords.filter((w) => text.includes(w)).length;
      negativeCount += negativeWords.filter((w) => text.includes(w)).length;
    }

    if (positiveCount > negativeCount * 1.2) return 'positive';
    if (negativeCount > positiveCount * 1.2) return 'negative';
    return 'neutral';
  }

  /**
   * Helper: Get filing date for a fiscal period
   */
  private async getFilingDateForPeriod(
    ticker: string,
    period: string,
  ): Promise<Date | null> {
    try {
      // Try to find a filing metadata entry
      const filing = await this.prisma.filingMetadata.findFirst({
        where: {
          ticker,
          filingType: '10-K', // Assuming annual reports
        },
        orderBy: {
          filingDate: 'desc',
        },
      });

      if (filing) {
        return filing.filingDate;
      }

      // Fallback: try to find from financial metrics
      const metric = await this.prisma.financialMetric.findFirst({
        where: {
          ticker,
          fiscalPeriod: period,
        },
      });

      return metric?.filingDate || null;
    } catch (error) {
      this.logger.error('Error getting filing date:', error);
      return null;
    }
  }

  /**
   * Helper: Calculate section materiality
   */
  private calculateSectionMateriality(section: string): 'high' | 'medium' | 'low' {
    const lower = section.toLowerCase();

    const highMaterialitySections = [
      'risk',
      'litigation',
      'legal',
      'investigation',
      'restatement',
    ];

    const mediumMaterialitySections = [
      'segment',
      'acquisition',
      'divestiture',
      'restructuring',
    ];

    if (highMaterialitySections.some((s) => lower.includes(s))) {
      return 'high';
    }
    if (mediumMaterialitySections.some((s) => lower.includes(s))) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Helper: Calculate tone shift materiality
   */
  private calculateToneShiftMateriality(
    from: string,
    to: string,
  ): 'high' | 'medium' | 'low' {
    if (
      (from === 'positive' && to === 'negative') ||
      (from === 'negative' && to === 'positive')
    ) {
      return 'high';
    }

    if (from === 'neutral' || to === 'neutral') {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Helper: Calculate summary statistics
   */
  private calculateSummary(changes: Change[]): ChangeTrackerData['summary'] {
    const summary = {
      total: changes.length,
      byType: {} as Record<string, number>,
      byMateriality: {} as Record<string, number>,
      byCategory: {} as Record<string, number>,
    };

    for (const change of changes) {
      summary.byType[change.type] = (summary.byType[change.type] || 0) + 1;
      summary.byMateriality[change.materiality] =
        (summary.byMateriality[change.materiality] || 0) + 1;
      summary.byCategory[change.category] =
        (summary.byCategory[change.category] || 0) + 1;
    }

    return summary;
  }

  /**
   * Helper: Convert Decimal to number
   */
  private decimalToNumber(value: any): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && 'toNumber' in value) {
      return value.toNumber();
    }
    return parseFloat(value.toString());
  }

  /**
   * Helper: Generate cache key
   */
  private getCacheKey(options: ChangeTrackerOptions): string {
    return `${options.ticker}_${options.fromPeriod}_${options.toPeriod}_${options.types?.join(',') || 'all'}_${options.materiality || 'all'}`;
  }

  /**
   * Clear cache (for testing or manual refresh)
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('Change tracker cache cleared');
  }
}
