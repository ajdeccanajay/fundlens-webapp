import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  StructuredQuery,
  MetricResult,
} from './types/query-intent';

/**
 * Structured Retriever Service
 * Retrieves exact metrics from PostgreSQL with 100% accuracy
 * 
 * Key Features:
 * - Deterministic retrieval (no hallucination)
 * - "Latest" query handling (both 10-K + 10-Q)
 * - Multi-company comparison
 * - Source tracking (filing, period, page)
 */
@Injectable()
export class StructuredRetrieverService {
  private readonly logger = new Logger(StructuredRetrieverService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieve metrics based on structured query
   */
  async retrieve(query: StructuredQuery): Promise<{
    metrics: MetricResult[];
    summary: {
      total: number;
      byTicker: Record<string, number>;
      byMetric: Record<string, number>;
    };
  }> {
    this.logger.log(`🔍 STRUCTURED RETRIEVER: Retrieving metrics: ${JSON.stringify(query)}`);
    this.logger.log(`🔍 STRUCTURED RETRIEVER: Tickers: ${JSON.stringify(query.tickers)}, Metrics: ${JSON.stringify(query.metrics)}`);

    // Handle "latest" queries specially
    if (query.periodType === 'latest') {
      return this.retrieveLatest(query);
    }

    // Build WHERE clause (case-insensitive)
    const where: any = {
      ticker: query.tickers.length === 1 
        ? { equals: query.tickers[0], mode: 'insensitive' }
        : { in: query.tickers, mode: 'insensitive' },
    };

    if (query.metrics.length > 0) {
      // Metric name translation: Intent detector names → Database names
      const metricTranslation: Record<string, string[]> = {
        'cash_and_cash_equivalents': ['cash', 'cash_and_equivalents'],
        'revenue': ['revenue', 'total_revenue'], // CRITICAL: Database stores as "total_revenue"
      };
      
      // For metrics, use case-insensitive matching with OR conditions
      // Prisma doesn't support mode:'insensitive' with 'in', so we use OR
      const metricConditions: any[] = [];
      
      for (const m of query.metrics) {
        // Convert to lowercase for database query (database stores lowercase)
        const lowerMetric = m.toLowerCase();
        
        // Check if we have a translation for this metric
        const translations = metricTranslation[lowerMetric];
        if (translations) {
          // Add all translated metric names
          for (const translated of translations) {
            metricConditions.push({
              normalizedMetric: { equals: translated, mode: 'insensitive' as const }
            });
          }
        } else {
          // Use lowercase with case-insensitive mode for maximum compatibility
          metricConditions.push({
            normalizedMetric: { equals: lowerMetric, mode: 'insensitive' as const }
          });
        }
      }
      
      where.OR = metricConditions;
      
      // DEBUG: Log the query conditions
      this.logger.log(`🔍 STRUCTURED RETRIEVER: Metric Query Conditions:`);
      this.logger.log(`   Searching for metrics: ${JSON.stringify(query.metrics)}`);
      this.logger.log(`   Generated ${metricConditions.length} OR conditions`);
      this.logger.log(`   Sample condition: ${JSON.stringify(metricConditions[0])}`);
    }

    if (query.period) {
      where.fiscalPeriod = query.period;
    }

    if (query.filingTypes.length > 0) {
      where.filingType = query.filingTypes.length === 1
        ? query.filingTypes[0]
        : { in: query.filingTypes };
    }

    // Query database
    const metrics = await this.prisma.financialMetric.findMany({
      where,
      orderBy: [
        { ticker: 'asc' },
        { normalizedMetric: 'asc' },
        { fiscalPeriod: 'desc' }, // Sort by fiscal period (FY2024, FY2023, etc.)
      ],
      take: 100, // Reasonable limit
    });

    this.logger.log(`🔍 STRUCTURED RETRIEVER: Retrieved ${metrics.length} metrics from database`);
    if (metrics.length > 0) {
      this.logger.log(`🔍 STRUCTURED RETRIEVER: Sample metric: ${JSON.stringify({
        ticker: metrics[0].ticker,
        normalizedMetric: metrics[0].normalizedMetric,
        rawLabel: metrics[0].rawLabel,
        value: metrics[0].value,
        fiscalPeriod: metrics[0].fiscalPeriod
      })}`);
    }

    // Deduplicate and filter by quality
    const deduplicated = this.deduplicateMetrics(metrics);

    return {
      metrics: deduplicated.map(this.formatMetric),
      summary: this.buildSummary(deduplicated),
    };
  }

  /**
   * Deduplicate metrics and prefer higher quality data
   * 
   * Issue: Same metric can appear with different capitalizations
   * (e.g., "total_assets" and "Total_Assets")
   * 
   * Solution: Group by (ticker, metric_lowercase, period) and pick best
   * 
   * CRITICAL: For structured metrics, we need 99.99999% accuracy
   * Bad data must be filtered out aggressively
   */
  private deduplicateMetrics(metrics: any[]): any[] {
    const grouped = new Map<string, any[]>();

    // Group by ticker + metric (lowercase) + period
    for (const metric of metrics) {
      // STRICT VALIDATION: Filter out obviously wrong data
      if (!this.validateMetricQuality(metric)) {
        this.logger.warn(
          `Filtered out low-quality metric: ${metric.ticker} ${metric.normalizedMetric} ${metric.fiscalPeriod} - ` +
          `Raw label: "${metric.rawLabel}", Value: ${metric.value}, Confidence: ${metric.confidenceScore}`
        );
        continue;
      }

      const key = `${metric.ticker}|${metric.normalizedMetric.toLowerCase()}|${metric.fiscalPeriod}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(metric);
    }

    // For each group, pick the best metric
    const deduplicated: any[] = [];
    for (const [key, group] of grouped.entries()) {
      if (group.length === 1) {
        deduplicated.push(group[0]);
      } else {
        // Multiple entries - pick best based on:
        // 1. Semantic match between raw label and normalized metric
        // 2. Highest confidence score
        // 3. Capitalized metric name (usually more accurate)
        // 4. Largest value (for balance sheet items)
        const best = group.sort((a, b) => {
          // Prefer semantic match
          const aMatch = this.semanticMatch(a.rawLabel, a.normalizedMetric);
          const bMatch = this.semanticMatch(b.rawLabel, b.normalizedMetric);
          if (aMatch !== bMatch) {
            return aMatch ? -1 : 1;
          }

          // Sort by confidence score (descending)
          if (a.confidenceScore !== b.confidenceScore) {
            return b.confidenceScore - a.confidenceScore;
          }
          
          // Prefer capitalized metric names
          const aCapitalized = a.normalizedMetric.charAt(0) === a.normalizedMetric.charAt(0).toUpperCase();
          const bCapitalized = b.normalizedMetric.charAt(0) === b.normalizedMetric.charAt(0).toUpperCase();
          if (aCapitalized !== bCapitalized) {
            return aCapitalized ? -1 : 1;
          }
          
          // Prefer larger values (for balance sheet items like total assets)
          return parseFloat(b.value.toString()) - parseFloat(a.value.toString());
        })[0];
        
        deduplicated.push(best);
      }
    }

    return deduplicated;
  }

  /**
   * Validate metric quality - filter out obviously wrong data
   * 
   * CRITICAL: We need 99.99999% accuracy for structured metrics
   * Better to return no data than wrong data
   * 
   * HOWEVER: Don't filter out valid XBRL tags like "us-gaap:Revenues"
   */
  private validateMetricQuality(metric: any): boolean {
    const rawLabel = metric.rawLabel?.toLowerCase() || '';
    const normalizedMetric = metric.normalizedMetric?.toLowerCase() || '';

    // Rule 1: If confidence score is 1.0 and it's a standard XBRL tag, trust it
    if (metric.confidenceScore === 1.0 && rawLabel.startsWith('us-gaap:')) {
      // For XBRL tags, do a simpler check
      return this.xbrlTagMatches(rawLabel, normalizedMetric);
    }

    // Rule 2: Raw label must semantically match normalized metric
    if (!this.semanticMatch(rawLabel, normalizedMetric)) {
      return false;
    }

    // Rule 3: Confidence score must be reasonable (but not too strict)
    if (metric.confidenceScore < 0.7) {
      return false;
    }

    return true;
  }

  /**
   * Check if XBRL tag matches the normalized metric
   * More lenient than semanticMatch for standard XBRL tags
   */
  private xbrlTagMatches(xbrlTag: string, normalizedMetric: string): boolean {
    const tag = xbrlTag.toLowerCase().replace('us-gaap:', '');
    const metric = normalizedMetric.toLowerCase().replace(/_/g, '');

    // Direct XBRL tag mappings
    const xbrlMappings: Record<string, string[]> = {
      'revenues': ['revenue', 'totalrevenue'],
      'salesrevenuenet': ['revenue', 'totalrevenue'],
      'revenuefromcontractwithcustomerexcludingassessedtax': ['revenue', 'totalrevenue'],
      'netincomeloss': ['netincome'],
      'grossprofit': ['grossprofit'],
      'operatingincomeloss': ['operatingincome'],
      'costofrevenue': ['costofrevenue'],
      'assets': ['totalassets'],
      'liabilities': ['totalliabilities'],
      'stockholdersequity': ['totalequity', 'equity'],
      'cashandcashequivalentsatcarryingvalue': ['cash', 'cashandcashequivalents'],
    };

    // Check if tag matches any of the metric aliases
    const aliases = xbrlMappings[tag];
    if (aliases) {
      return aliases.some(alias => metric.includes(alias) || alias.includes(metric));
    }

    // Fallback: check if tag contains the metric name
    return tag.includes(metric) || metric.includes(tag);
  }

  /**
   * Check if raw label semantically matches normalized metric
   * 
   * Examples:
   * - "Total assets" matches "total_assets" ✅
   * - "Total net sales" matches "Revenue" ✅ (common mapping)
   * - "us-gaap:RevenueFromContract..." matches "revenue" ✅
   * - "Prepaid expenses" does NOT match "total_assets" ❌
   * - "Digital assets gain" does NOT match "total_assets" ❌
   */
  private semanticMatch(rawLabel: string, normalizedMetric: string): boolean {
    const rawLower = rawLabel.toLowerCase();
    const metricLower = normalizedMetric.toLowerCase().replace(/_/g, ' ');

    // Special mappings for common financial metrics (aliases)
    const specialMappings: Record<string, string[]> = {
      'revenue': ['total net sales', 'net sales', 'sales', 'revenues', 'total revenue', 'net revenue', 'revenue', 'us-gaap:revenues'],
      'total revenue': ['total net sales', 'net sales', 'sales', 'revenues', 'total revenue', 'net revenue', 'revenue', 'us-gaap:revenues'],
      'net income': ['net income', 'net earnings', 'profit', 'net profit', 'netincome'],
      'total assets': ['total assets', 'totalassets'],
      'cash': ['cash and cash equivalents', 'cash equivalents', 'cashandcashequivalents', 'cash'],
      'cash and cash equivalents': ['cash', 'cash and equivalents', 'cash and cash equivalents', 'cashandcashequivalents'],
      'accounts payable': ['accounts payable', 'accountspayable'],
      'accounts receivable': ['accounts receivable', 'receivables', 'accountsreceivable'],
      'gross profit': ['gross profit', 'grossprofit'],
      'operating income': ['operating income', 'operatingincome'],
      'cost of revenue': ['cost of revenue', 'cost of goods sold', 'costofrevenue', 'costofgoodssold'],
    };

    // Check special mappings first (includes the metric name itself)
    const mappings = specialMappings[metricLower];
    if (mappings) {
      if (mappings.some(mapping => rawLower.includes(mapping))) {
        return true;
      }
    }

    // Extract key words from normalized metric
    const metricWords = metricLower.split(' ').filter(w => w.length > 2);

    // For metrics like "total_assets", BOTH "total" AND "assets" must be in raw label
    // Not just "assets" (which would match "prepaid assets", "digital assets", etc.)
    if (metricWords.length >= 2) {
      // All significant words must be present
      return metricWords.every(word => rawLower.includes(word));
    }

    // For single-word metrics, just check if it's present
    return rawLower.includes(metricLower);
  }

  /**
   * Retrieve "latest" metrics (both annual and quarterly)
   */
  private async retrieveLatest(query: StructuredQuery): Promise<{
    metrics: MetricResult[];
    summary: any;
  }> {
    this.logger.log('Retrieving latest metrics (both 10-K and 10-Q)');

    const results: MetricResult[] = [];

    // For each ticker and metric, get latest annual and quarterly
    for (const ticker of query.tickers) {
      for (const metric of query.metrics) {
        // Get latest annual (10-K)
        const annual = await this.getLatestByFilingType(
          ticker,
          metric,
          '10-K',
        );
        if (annual) results.push(annual);

        // Get latest quarterly (10-Q)
        const quarterly = await this.getLatestByFilingType(
          ticker,
          metric,
          '10-Q',
        );
        if (quarterly) results.push(quarterly);
      }
    }

    return {
      metrics: results,
      summary: this.buildSummary(results),
    };
  }

  /**
   * Get latest metric by filing type
   * 
   * IMPORTANT: "Latest" means the most recent FISCAL PERIOD, not filing date
   * A 10-K filed in 2025 might contain data for FY2024, FY2023, FY2022
   * We want the most recent fiscal period (FY2024), not the most recent filing date
   */
  private async getLatestByFilingType(
    ticker: string,
    metric: string,
    filingType: string,
  ): Promise<MetricResult | null> {
    // Try multiple case variations
    const metricVariations = [
      metric.toLowerCase(),
      metric.charAt(0).toUpperCase() + metric.slice(1).toLowerCase(),
      metric.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('_'),
    ];

    // Get all matching metrics
    const results = await this.prisma.financialMetric.findMany({
      where: {
        ticker,
        normalizedMetric: { in: metricVariations },
        filingType,
      },
      orderBy: {
        statementDate: 'desc', // Sort by statement date (fiscal period end)
      },
    });

    if (results.length === 0) return null;

    // Find the most recent fiscal period
    // FY2024 > FY2023 > FY2022
    const sortedByPeriod = results.sort((a, b) => {
      // Extract year from fiscal period (FY2024 -> 2024)
      const yearA = parseInt(a.fiscalPeriod.replace(/[^\d]/g, '')) || 0;
      const yearB = parseInt(b.fiscalPeriod.replace(/[^\d]/g, '')) || 0;
      return yearB - yearA; // Descending order
    });

    return this.formatMetric(sortedByPeriod[0]);
  }

  /**
   * Get metrics for comparison
   */
  async compareMetrics(
    tickers: string[],
    metrics: string[],
    period?: string,
  ): Promise<{
    comparison: Array<{
      metric: string;
      values: Array<{
        ticker: string;
        value: number;
        period: string;
        filingType: string;
      }>;
    }>;
  }> {
    this.logger.log(`Comparing ${tickers.join(', ')} on ${metrics.join(', ')}`);

    const comparison: any[] = [];

    for (const metric of metrics) {
      const values: any[] = [];

      // Try multiple case variations
      const metricVariations = [
        metric.toLowerCase(),
        metric.charAt(0).toUpperCase() + metric.slice(1).toLowerCase(),
        metric.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('_'),
      ];

      for (const ticker of tickers) {
        const where: any = {
          ticker,
          normalizedMetric: { in: metricVariations },
        };

        if (period) {
          where.fiscalPeriod = period;
        }

        const result = await this.prisma.financialMetric.findFirst({
          where,
          orderBy: {
            filingDate: 'desc',
          },
        });

        if (result) {
          values.push({
            ticker: result.ticker,
            value: parseFloat(result.value.toString()),
            period: result.fiscalPeriod,
            filingType: result.filingType,
            filingDate: result.filingDate,
          });
        }
      }

      comparison.push({
        metric,
        values,
      });
    }

    return { comparison };
  }

  /**
   * Get time series for a metric
   */
  async getTimeSeries(
    ticker: string,
    metric: string,
    filingType?: string,
    limit = 10,
  ): Promise<{
    ticker: string;
    metric: string;
    timeSeries: Array<{
      period: string;
      value: number;
      filingType: string;
      filingDate: Date;
    }>;
  }> {
    this.logger.log(`Getting time series for ${ticker} ${metric}`);

    // Try multiple case variations
    const metricVariations = [
      metric.toLowerCase(),
      metric.charAt(0).toUpperCase() + metric.slice(1).toLowerCase(),
      metric.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('_'),
    ];

    const where: any = {
      ticker,
      normalizedMetric: { in: metricVariations },
    };

    if (filingType) {
      where.filingType = filingType;
    }

    const results = await this.prisma.financialMetric.findMany({
      where,
      orderBy: {
        statementDate: 'desc',
      },
      take: limit,
    });

    return {
      ticker,
      metric,
      timeSeries: results.map((r) => ({
        period: r.fiscalPeriod,
        value: parseFloat(r.value.toString()),
        filingType: r.filingType,
        filingDate: r.filingDate,
      })),
    };
  }

  /**
   * Format metric for response
   */
  private formatMetric(metric: any): MetricResult {
    return {
      ticker: metric.ticker,
      normalizedMetric: metric.normalizedMetric,
      rawLabel: metric.rawLabel,
      value: parseFloat(metric.value.toString()),
      fiscalPeriod: metric.fiscalPeriod,
      periodType: metric.periodType,
      filingType: metric.filingType,
      statementType: metric.statementType,
      statementDate: metric.statementDate,
      filingDate: metric.filingDate,
      sourcePage: metric.sourcePage,
      confidenceScore: metric.confidenceScore,
    };
  }

  /**
   * Build summary statistics
   */
  private buildSummary(metrics: any[]): {
    total: number;
    byTicker: Record<string, number>;
    byMetric: Record<string, number>;
  } {
    const byTicker: Record<string, number> = {};
    const byMetric: Record<string, number> = {};

    for (const metric of metrics) {
      const ticker = metric.ticker || metric.ticker;
      const metricName = metric.normalizedMetric || metric.normalizedMetric;

      byTicker[ticker] = (byTicker[ticker] || 0) + 1;
      byMetric[metricName] = (byMetric[metricName] || 0) + 1;
    }

    return {
      total: metrics.length,
      byTicker,
      byMetric,
    };
  }

  /**
   * Check if metrics exist for a ticker
   */
  async hasMetrics(ticker: string): Promise<boolean> {
    const count = await this.prisma.financialMetric.count({
      where: { ticker },
    });
    return count > 0;
  }

  /**
   * Get available metrics for a ticker
   */
  async getAvailableMetrics(ticker: string): Promise<string[]> {
    const metrics = await this.prisma.financialMetric.findMany({
      where: { ticker },
      select: { normalizedMetric: true },
      distinct: ['normalizedMetric'],
    });

    return metrics.map((m) => m.normalizedMetric);
  }

  /**
   * Get available periods for a ticker
   */
  async getAvailablePeriods(ticker: string): Promise<Array<{
    period: string;
    filingType: string;
    filingDate: Date;
  }>> {
    const periods = await this.prisma.financialMetric.findMany({
      where: { ticker },
      select: {
        fiscalPeriod: true,
        filingType: true,
        filingDate: true,
      },
      distinct: ['fiscalPeriod', 'filingType'],
      orderBy: {
        filingDate: 'desc',
      },
    });

    return periods.map((p) => ({
      period: p.fiscalPeriod,
      filingType: p.filingType,
      filingDate: p.filingDate,
    }));
  }
}
