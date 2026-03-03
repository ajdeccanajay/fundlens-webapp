import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  StructuredQuery,
  MetricResult,
} from './types/query-intent';
import { MetricResolution } from './metric-resolution/types';
import { MetricRegistryService } from './metric-resolution/metric-registry.service';
import { FormulaResolutionService } from './metric-resolution/formula-resolution.service';
import { MetricLearningService } from './metric-learning.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricRegistry: MetricRegistryService,
    private readonly formulaResolver: FormulaResolutionService,
    @Optional() private readonly metricLearning?: MetricLearningService,
  ) {}

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

    // Filter out unresolved metrics before building WHERE clause
    const resolvedMetrics = query.metrics.filter(m => m.confidence !== 'unresolved');
    
    if (resolvedMetrics.length === 0 && query.metrics.length > 0) {
      this.logger.warn(`🔍 STRUCTURED RETRIEVER: All ${query.metrics.length} metrics are unresolved — returning empty results`);
      return {
        metrics: [],
        summary: { total: 0, byTicker: {}, byMetric: {} },
      };
    }

    if (resolvedMetrics.length > 0) {
      // Collect all synonyms across all resolved metrics into one flat list for a single IN query
      const allSynonyms: string[] = [];
      for (const resolution of resolvedMetrics) {
        const synonyms = this.metricRegistry.getSynonymsForDbColumn(resolution.canonical_id);
        allSynonyms.push(...synonyms);
      }
      
      if (allSynonyms.length > 0) {
        where.normalizedMetric = { in: allSynonyms, mode: 'insensitive' as const };
      }
      
      // DEBUG: Log the query conditions
      this.logger.log(`🔍 STRUCTURED RETRIEVER: Metric Query Conditions:`);
      this.logger.log(`   Searching for metrics: ${JSON.stringify(resolvedMetrics.map(m => m.canonical_id))}`);
      this.logger.log(`   Total synonyms in IN clause: ${allSynonyms.length}`);
      this.logger.log(`   Sample synonyms: ${JSON.stringify(allSynonyms.slice(0, 5))}`);
      
      if (query.metrics.length !== resolvedMetrics.length) {
        const unresolvedCount = query.metrics.length - resolvedMetrics.length;
        this.logger.warn(`🔍 STRUCTURED RETRIEVER: Skipped ${unresolvedCount} unresolved metric(s)`);
      }
    }

    // Handle period range queries (e.g., FY2023 to FY2024) — must come before single period
    if (query.periodType === 'range' && query.periodStart && query.periodEnd) {
      const startYear = parseInt(query.periodStart.replace(/\D/g, ''), 10);
      const endYear = parseInt(query.periodEnd.replace(/\D/g, ''), 10);
      if (!isNaN(startYear) && !isNaN(endYear) && endYear >= startYear) {
        const periods: string[] = [];
        for (let y = startYear; y <= endYear; y++) {
          periods.push(`FY${y}`);
        }
        where.fiscalPeriod = { in: periods };
        this.logger.log(`🔍 STRUCTURED RETRIEVER: Range filter FY${startYear}–FY${endYear}: ${JSON.stringify(periods)}`);
      }
    } else if (query.period) {
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

    // Post-retrieval validation gate (Requirements 20.1-20.4)
    const formatted = deduplicated.map(this.formatMetric);
    const validated = this.validateResults(formatted);

    return {
      metrics: validated,
      summary: this.buildSummary(validated),
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
  /**
     * Deduplicate metrics and prefer higher quality data
     * 
     * Issue: Same metric can appear with different normalizedMetric values
     * (e.g., "revenue" and "net_sales" are both stored separately but represent
     * the same canonical metric). Also handles capitalization variants.
     * 
     * Solution: Resolve each metric to its canonical ID via MetricRegistry,
     * then group by (ticker, canonicalId, period) and pick best.
     * 
     * CRITICAL: For structured metrics, we need 99.99999% accuracy
     * Bad data must be filtered out aggressively
     */
    private deduplicateMetrics(metrics: any[]): any[] {
      const grouped = new Map<string, any[]>();

      // Group by ticker + canonical metric ID + period
      for (const metric of metrics) {
        // STRICT VALIDATION: Filter out obviously wrong data
        if (!this.validateMetricQuality(metric)) {
          this.logger.warn(
            `Filtered out low-quality metric: ${metric.ticker} ${metric.normalizedMetric} ${metric.fiscalPeriod} - ` +
            `Raw label: "${metric.rawLabel}", Value: ${metric.value}, Confidence: ${metric.confidenceScore}`
          );
          continue;
        }

        // Resolve normalizedMetric to canonical ID so synonyms like
        // "revenue" and "net_sales" collapse into the same group
        let groupMetric = metric.normalizedMetric.toLowerCase();
        try {
          const resolution = this.metricRegistry.resolve(metric.normalizedMetric);
          if (resolution && resolution.confidence !== 'unresolved' && resolution.canonical_id) {
            groupMetric = resolution.canonical_id;
          }
        } catch {
          // MetricRegistry lookup failed — fall back to normalizedMetric
        }

        const key = `${metric.ticker}|${groupMetric}|${metric.fiscalPeriod}`;
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

      // Rule 0: If the normalizedMetric is a known synonym in the MetricRegistry,
      // trust it — it was already validated during ingestion and matched via the registry.
      // This prevents the quality filter from rejecting metrics that the synonym-based
      // WHERE clause correctly retrieved.
      try {
        if (normalizedMetric && this.metricRegistry) {
          const resolution = this.metricRegistry.resolve(normalizedMetric);
          if (resolution && resolution.confidence !== 'unresolved') {
            return true;
          }
        }
      } catch {
        // MetricRegistry lookup failed — fall through to other rules
      }

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
        'revenues': ['revenue', 'totalrevenue', 'netsales'],
        'salesrevenuenet': ['revenue', 'totalrevenue', 'netsales'],
        'revenuefromcontractwithcustomerexcludingassessedtax': ['revenue', 'totalrevenue', 'netsales', 'netrevenue'],
        'netincomeloss': ['netincome', 'netincomeloss'],
        'grossprofit': ['grossprofit'],
        'operatingincomeloss': ['operatingincome', 'operatingincomeloss'],
        'costofrevenue': ['costofrevenue', 'costofgoodssold', 'cogs'],
        'costofgoodsandservicessold': ['costofrevenue', 'costofgoodssold', 'cogs'],
        'assets': ['totalassets', 'assets'],
        'liabilities': ['totalliabilities', 'liabilities'],
        'stockholdersequity': ['totalequity', 'equity', 'stockholdersequity'],
        'cashandcashequivalentsatcarryingvalue': ['cash', 'cashandcashequivalents'],
        'earningspersharebasic': ['earningspershare', 'eps', 'basiceps'],
        'earningspersharediluted': ['earningspershare', 'eps', 'dilutedeps'],
      };

      // Check if tag matches any of the metric aliases
      const aliases = xbrlMappings[tag];
      if (aliases) {
        return aliases.some(alias => metric.includes(alias) || alias.includes(metric));
      }

      // Fallback: check if tag contains the metric name or vice versa
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
        'revenue': ['total net sales', 'net sales', 'sales', 'revenues', 'total revenue', 'net revenue', 'revenue', 'us-gaap:revenues', 'us-gaap:revenuefromcontractwithcustomerexcludingassessedtax'],
        'total revenue': ['total net sales', 'net sales', 'sales', 'revenues', 'total revenue', 'net revenue', 'revenue', 'us-gaap:revenues', 'us-gaap:revenuefromcontractwithcustomerexcludingassessedtax'],
        'net sales': ['revenue', 'revenues', 'total revenue', 'net revenue', 'net sales', 'sales', 'us-gaap:revenues', 'us-gaap:revenuefromcontractwithcustomerexcludingassessedtax'],
        'net income': ['net income', 'net earnings', 'profit', 'net profit', 'netincome', 'us-gaap:netincomeloss'],
        'total assets': ['total assets', 'totalassets', 'us-gaap:assets'],
        'cash': ['cash and cash equivalents', 'cash equivalents', 'cashandcashequivalents', 'cash', 'us-gaap:cashandcashequivalentsatcarryingvalue'],
        'cash and cash equivalents': ['cash', 'cash and equivalents', 'cash and cash equivalents', 'cashandcashequivalents', 'us-gaap:cashandcashequivalentsatcarryingvalue'],
        'accounts payable': ['accounts payable', 'accountspayable'],
        'accounts receivable': ['accounts receivable', 'receivables', 'accountsreceivable'],
        'gross profit': ['gross profit', 'grossprofit', 'us-gaap:grossprofit'],
        'operating income': ['operating income', 'operatingincome', 'income from operations', 'us-gaap:operatingincomeloss'],
        'cost of revenue': ['cost of revenue', 'cost of goods sold', 'costofrevenue', 'costofgoodssold', 'us-gaap:costofrevenue', 'us-gaap:costofgoodsandservicessold'],
      };

      // Check special mappings first (includes the metric name itself)
      const mappings = specialMappings[metricLower];
      if (mappings) {
        if (mappings.some(mapping => rawLower.includes(mapping))) {
          return true;
        }
      }

      // Reverse check: if the rawLabel is a XBRL tag, check if ANY mapping's aliases match
      if (rawLower.startsWith('us-gaap:')) {
        for (const [, aliases] of Object.entries(specialMappings)) {
          if (aliases.some(alias => rawLower.includes(alias) || alias.includes(rawLower))) {
            // Found a mapping group that contains this XBRL tag — now check if the metric is also in that group
            const metricNoSpaces = metricLower.replace(/\s/g, '');
            if (aliases.some(alias => alias.replace(/[\s_-]/g, '').includes(metricNoSpaces) || metricNoSpaces.includes(alias.replace(/[\s_-]/g, '')))) {
              return true;
            }
          }
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

    let results: MetricResult[] = [];
    
    // Filter out unresolved metrics to avoid unnecessary DB queries
    const resolvedMetrics = query.metrics.filter(m => m.confidence !== 'unresolved');
    
    if (resolvedMetrics.length === 0 && query.metrics.length > 0) {
      this.logger.warn(`All ${query.metrics.length} metrics are unresolved — returning empty results`);
      return {
        metrics: [],
        summary: this.buildSummary([]),
      };
    }

    // For each ticker and metric, get latest annual and quarterly
    for (const ticker of query.tickers) {
      for (const resolution of resolvedMetrics) {
        // Get latest annual (10-K)
        const annual = await this.getLatestByFilingType(
          ticker,
          resolution,
          '10-K',
        );
        if (annual) results.push(annual);

        // Get latest quarterly (10-Q)
        const quarterly = await this.getLatestByFilingType(
          ticker,
          resolution,
          '10-Q',
        );
        if (quarterly) results.push(quarterly);
      }
    }

    // Supplement with historical annual data for core metrics.
    // When periodType=latest, the primary loop returns only the most recent
    // annual and quarterly values. For core metrics (revenue, net_income, etc.),
    // we fetch up to 5 prior annual periods so computeFinancials can calculate
    // YoY growth rates and the chart shows a meaningful trend.
    const TREND_WORTHY_METRICS = new Set([
      'revenue', 'net_income', 'gross_profit', 'operating_income',
      'ebitda', 'free_cash_flow', 'operating_cash_flow',
      'total_assets', 'total_liabilities', 'total_equity',
      'cost_of_revenue', 'net_sales',
    ]);

    // Build dedup keys using CANONICAL metric ID so synonyms like
    // "revenue" and "net_sales" collapse into the same key.
    // Without this, getLatestByFilingType returns normalizedMetric=canonical_id
    // but historical rows have the raw DB value (e.g. "net_sales"), causing duplicates.
    const existingKeys = new Set(
      results.map(r => {
        let canonicalMetric = r.normalizedMetric;
        try {
          const res = this.metricRegistry.resolve(r.normalizedMetric);
          if (res && res.confidence !== 'unresolved' && res.canonical_id) {
            canonicalMetric = res.canonical_id;
          }
        } catch { /* use raw */ }
        return `${r.ticker.toUpperCase()}-${canonicalMetric.toLowerCase()}-${r.fiscalPeriod}`;
      })
    );

    for (const ticker of query.tickers) {
      for (const resolution of resolvedMetrics) {
        if (!TREND_WORTHY_METRICS.has(resolution.canonical_id)) continue;

        try {
          const synonyms = this.metricRegistry.getSynonymsForDbColumn(resolution.canonical_id);
          const historicalAnnuals = await this.prisma.financialMetric.findMany({
            where: {
              ticker: { equals: ticker, mode: 'insensitive' },
              filingType: '10-K',
              normalizedMetric: { in: synonyms, mode: 'insensitive' },
            },
            orderBy: { statementDate: 'desc' },
            take: 5,
          });

          for (const h of historicalAnnuals) {
            // Use canonical_id for dedup key, not raw normalizedMetric
            const key = `${h.ticker.toUpperCase()}-${resolution.canonical_id.toLowerCase()}-${h.fiscalPeriod}`;
            if (!existingKeys.has(key)) {
              const formatted = this.formatMetric(h);
              // Normalize to canonical_id so downstream dedup in rag.service.ts also works
              formatted.normalizedMetric = resolution.canonical_id;
              results.push(formatted);
              existingKeys.add(key);
            }
          }
        } catch (e) {
          this.logger.warn(`Historical fetch failed for ${ticker}/${resolution.canonical_id}: ${e.message}`);
        }
      }
    }

    // Deduplicate metrics by (ticker, canonical_metric, fiscalPeriod, filingType).
    // Different synonym variants (e.g., 'revenue' vs 'net_sales') from the same filing
    // can produce duplicate rows. Keep the one with the highest confidence score.
    {
      const deduped = new Map<string, MetricResult>();
      for (const r of results) {
        let canonicalMetric = r.normalizedMetric?.toLowerCase() || '';
        try {
          const res = this.metricRegistry.resolve(r.normalizedMetric);
          if (res && res.confidence !== 'unresolved' && res.canonical_id) {
            canonicalMetric = res.canonical_id.toLowerCase();
          }
        } catch { /* use raw */ }
        const key = `${(r.ticker || '').toUpperCase()}|${canonicalMetric}|${r.fiscalPeriod}|${r.filingType}`;
        const existing = deduped.get(key);
        if (!existing || (r.confidenceScore || 0) > (existing.confidenceScore || 0)) {
          deduped.set(key, r);
        }
      }
      const before = results.length;
      results = Array.from(deduped.values());
      if (results.length < before) {
        this.logger.log(`🧹 retrieveLatest dedup: ${before} → ${results.length} metrics`);
      }
    }

    // Post-retrieval validation gate (Requirements 20.1-20.4)
    const validated = this.validateResults(results);

    return {
      metrics: validated,
      summary: this.buildSummary(validated),
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
    resolution: MetricResolution,
    filingType: string,
  ): Promise<MetricResult | null> {

    // Computed metrics never touch the DB directly
    if (resolution.type === 'computed') {
      return this.resolveComputedMetric(ticker, resolution, filingType);
    }

    // Unresolved: surface gracefully
    if (resolution.confidence === 'unresolved') {
      this.logger.warn(`Unresolved: ${resolution.original_query}`);
      return null;
    }

    // Atomic: query by all synonyms from MetricRegistry (single source of truth)
    // This handles cases where ingestion stored raw labels like 'net_sales' instead of 'revenue'
    const synonyms = this.metricRegistry.getSynonymsForDbColumn(resolution.canonical_id);
    // e.g. ['revenue', 'revenues', 'total_revenue', 'net_revenue', 'net_sales', ...]

    this.logger.log(`🔍 getLatestByFilingType: ${ticker}/${resolution.canonical_id}/${filingType} — synonyms: [${synonyms.join(', ')}]`);

    const results = await this.prisma.financialMetric.findMany({
      where: {
        ticker: { equals: ticker, mode: 'insensitive' },
        normalizedMetric: { in: synonyms, mode: 'insensitive' },
        filingType: { equals: filingType, mode: 'insensitive' },
      },
      orderBy: { statementDate: 'desc' },
    });

    if (!results.length) {
      // Fallback: check extracted_metrics table (uploaded document metrics)
      // Spec §4 Phase 4: structured retriever queries both financial_metrics AND extracted_metrics
      const extractedResult = await this.getFromExtractedMetrics(ticker, resolution);
      if (extractedResult) {
        this.logger.log(
          `📄 Found metric in extracted_metrics (uploaded docs): ${ticker}/${resolution.canonical_id}`,
        );
        return extractedResult;
      }

      // Req 22.1: Log metric miss and trigger MetricLearningService
      this.logger.warn(
        `metric_misses: No DB results for ${ticker}/${resolution.canonical_id}/${filingType} — synonyms tried: [${synonyms.join(', ')}]`,
      );
      if (this.metricLearning) {
        this.metricLearning.logUnrecognizedMetric({
          tenantId: 'system',
          ticker,
          query: resolution.original_query,
          requestedMetric: resolution.canonical_id || resolution.original_query,
          failureReason: `No DB rows matched synonyms [${synonyms.join(', ')}] for filingType=${filingType}`,
          userMessage: resolution.original_query,
        }).catch((err) => this.logger.error(`MetricLearningService log failed: ${err.message}`));
      }
      return null;
    }

    // Sort by fiscal period using the corrected sort key
    const best = results.sort((a, b) =>
      this.parseFiscalPeriodSortKey(b.fiscalPeriod) - this.parseFiscalPeriodSortKey(a.fiscalPeriod)
    )[0];

    const result = this.formatMetric(best);
    result.displayName = resolution.display_name;
    return result;
  }

  /**
   * Query the extracted_metrics table (uploaded document metrics).
   * Spec §4 Phase 4: fallback when financial_metrics has no results.
   * Uses the same synonym lookup as the primary path.
   * SEC filing data (financial_metrics) is always preferred — this is fallback only.
   */
  private async getFromExtractedMetrics(
    ticker: string,
    resolution: MetricResolution,
  ): Promise<MetricResult | null> {
    try {
      const synonyms = this.metricRegistry.getSynonymsForDbColumn(resolution.canonical_id);

      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT normalized_metric, value, period, output_format,
                source_file_name, extraction_confidence, created_at,
                document_id
         FROM extracted_metrics
         WHERE UPPER(ticker) = UPPER($1)
           AND normalized_metric = ANY($2::text[])
         ORDER BY period_end_date DESC NULLS LAST, created_at DESC
         LIMIT 1`,
        ticker,
        synonyms,
      );

      if (!rows?.length) return null;

      const row = rows[0];
      return {
        ticker: ticker.toUpperCase(),
        normalizedMetric: resolution.canonical_id,
        displayName: resolution.display_name,
        rawLabel: row.normalized_metric,
        value: parseFloat(row.value),
        fiscalPeriod: row.period || 'uploaded',
        periodType: 'as-reported',
        filingType: 'uploaded-document',
        statementType: 'uploaded',
        statementDate: row.created_at ? new Date(row.created_at) : new Date(),
        filingDate: row.created_at ? new Date(row.created_at) : new Date(),
        confidenceScore: row.extraction_confidence === 'high' ? 0.95 : 0.75,
        source: `${row.source_file_name || 'uploaded document'}`,
        fileName: row.source_file_name || undefined,
        documentId: row.document_id || undefined,
      } as MetricResult;
    } catch (err) {
      this.logger.warn(`extracted_metrics query failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Parse fiscal period into a numeric sort key.
   * FY2024 → 20240000, Q3FY2024 → 20240300, TTM → 99990000
   * Fixes the bug where parseInt('Q3FY2024'.replace(/[^\d]/g,'')) = 32024 > 2024
   */
  private parseFiscalPeriodSortKey(period: string): number {
      // Check quarterly FIRST — "Q3FY2024" would otherwise match the annual regex
      const qtr = period.match(/Q([1-4])[\s\-]?(?:FY)?(\d{4})/i);
      if (qtr) return parseInt(qtr[2]) * 10000 + parseInt(qtr[1]) * 100;  // Q3FY2024 → 20240300

      const annual = period.match(/FY(\d{4})/i);
      if (annual) return parseInt(annual[1]) * 10000;           // FY2024 → 20240000

      if (/TTM/i.test(period)) return 99990000;

      const yr = period.match(/(\d{4})/);
      return yr ? parseInt(yr[1]) * 10000 : 0;
    }

  /**
   * Resolve a computed metric via FormulaResolutionService.
   * Computed metrics (e.g. EBITDA margin) are calculated from atomic dependencies,
   * not fetched directly from the DB.
   */
  private async resolveComputedMetric(
    ticker: string, resolution: MetricResolution, filingType: string,
  ): Promise<MetricResult | null> {
    try {
      const period = filingType === '10-K' ? 'latest_annual' : 'latest_quarterly';
      const result = await this.formulaResolver.resolveComputed(resolution, ticker, period);
      if (!result || result.value === null) return null;
      return {
        ticker, normalizedMetric: resolution.canonical_id,
        displayName: resolution.display_name, rawLabel: resolution.display_name,
        value: result.value,
        fiscalPeriod: result.resolved_inputs?.[Object.keys(result.resolved_inputs)[0]]?.period ?? 'latest',
        periodType: filingType === '10-K' ? 'annual' : 'quarterly',
        filingType, statementType: 'computed',
        statementDate: new Date(), filingDate: new Date(), confidenceScore: 1.0,
      };
    } catch (e) {
      this.logger.warn(`Computed resolution failed: ${ticker}/${resolution.canonical_id}: ${e.message}`);
      return null;
    }
  }

  /**
   * Post-retrieval validation gate for a single MetricResult.
   * Excludes null values, low confidence, unparseable periods.
   * Appends 8-K warning for income statement metrics.
   *
   * Requirements: 20.1, 20.2, 20.3, 20.4
   */
  private validateResult(result: MetricResult): MetricResult | null {
    // 20.1: Exclude null/undefined values
    if (result.value === null || result.value === undefined) {
      this.logger.warn(`Validation excluded ${result.ticker}/${result.normalizedMetric}: null value`);
      return null;
    }

    // 20.2: Exclude confidence < 0.70
    if (result.confidenceScore < 0.70) {
      this.logger.warn(
        `Validation excluded ${result.ticker}/${result.normalizedMetric} ` +
        `(${result.fiscalPeriod}): confidence ${result.confidenceScore} < 0.70`,
      );
      return null;
    }

    // 20.3: Exclude unparseable fiscal periods (sort key === 0 means unparseable)
    if (this.parseFiscalPeriodSortKey(result.fiscalPeriod) === 0) {
      this.logger.warn(
        `Validation excluded ${result.ticker}/${result.normalizedMetric}: ` +
        `unparseable fiscal period "${result.fiscalPeriod}"`,
      );
      return null;
    }

    // 20.4: 8-K warning for income statement metrics
    if (result.filingType === '8-K' && result.statementType === 'income_statement') {
      return {
        ...result,
        displayName: `${result.displayName ?? result.normalizedMetric} ⚠️ (press release, unaudited)`,
      };
    }

    return result;
  }

  /**
   * Batch validation: filters an array of MetricResults through validateResult().
   */
  private validateResults(results: MetricResult[]): MetricResult[] {
    return results
      .map(r => this.validateResult(r))
      .filter((r): r is MetricResult => r !== null);
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

      // Use MetricRegistry synonyms (single source of truth) instead of manual case variations
      const synonyms = this.metricRegistry.getSynonymsForDbColumn(metric);

      for (const ticker of tickers) {
        const where: any = {
          ticker,
          normalizedMetric: { in: synonyms, mode: 'insensitive' as const },
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

    // Use MetricRegistry synonyms (single source of truth) instead of manual case variations
    const synonyms = this.metricRegistry.getSynonymsForDbColumn(metric);

    const where: any = {
      ticker,
      normalizedMetric: { in: synonyms, mode: 'insensitive' as const },
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
      value: metric.value != null ? parseFloat(metric.value.toString()) : (null as unknown as number),
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
