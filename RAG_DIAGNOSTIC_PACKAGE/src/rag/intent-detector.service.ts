import { Injectable, Logger, Optional } from '@nestjs/common';
import { QueryIntent, QueryType, PeriodType } from './types/query-intent';
import { BedrockService } from './bedrock.service';
import { IntentAnalyticsService } from './intent-analytics.service';
import { MetricRegistryService } from './metric-resolution/metric-registry.service';
import { ConceptRegistryService } from './metric-resolution/concept-registry.service';
import { MetricLearningService } from './metric-learning.service';
import { LlmClassificationResult, LlmDetectionEngine } from './intent-detection/llm-detection-engine';
import { FastPathCache } from './intent-detection/fast-path-cache';
import { CompanyTickerMapService } from './intent-detection/company-ticker-map.service';
import { IntentFeedbackService } from './intent-detection/intent-feedback.service';

/**
 * Result of period extraction — supports both single periods and multi-year ranges.
 */
interface PeriodExtractionResult {
  period?: string;          // Single period (e.g., "FY2024") or undefined for ranges
  periodType?: PeriodType;  // 'annual' | 'quarterly' | 'latest' | 'range'
  periodStart?: string;     // Start of range (e.g., "FY2020")
  periodEnd?: string;       // End of range (e.g., "FY2024")
}

/**
 * Intent Detector Service
 *
 * Three-layer intelligent detection architecture:
 *   Layer 1: Regex Fast-Path ($0/query, <10ms)
 *   Layer 2: Fast-Path Cache ($0/query, <5ms)
 *   Layer 3: LLM Classification via Claude 3.5 Haiku (~$0.0002/query)
 *
 * The LLM is a classifier, not a resolver. Metric resolution is always
 * delegated to MetricRegistryService. Concept matching is always delegated
 * to ConceptRegistryService.
 */
@Injectable()
export class IntentDetectorService {
  private readonly logger = new Logger(IntentDetectorService.name);

  // LLM usage tracking
  private llmUsageStats = {
    totalQueries: 0,
    regexSuccess: 0,
    llmFallback: 0,
    genericFallback: 0,
    llmLatencyMs: [] as number[],
  };

  constructor(
    private readonly bedrock: BedrockService,
    private readonly analytics: IntentAnalyticsService,
    private readonly metricRegistry: MetricRegistryService,
    @Optional() private readonly conceptRegistry?: ConceptRegistryService,
    @Optional() private readonly metricLearning?: MetricLearningService,
    @Optional() private readonly fastPathCache?: FastPathCache,
    @Optional() private readonly companyTickerMap?: CompanyTickerMapService,
    @Optional() private readonly feedbackService?: IntentFeedbackService,
  ) {}

  /**
   * Detect intent from natural language query.
   * Uses three-layer detection: regex fast-path → cache → LLM.
   *
   * @param query The natural language query
   * @param tenantId Optional tenant ID for analytics
   * @param contextTicker Optional ticker from workspace context
   */
  async detectIntent(query: string, tenantId?: string, contextTicker?: string): Promise<QueryIntent> {
    this.logger.log(`Detecting intent for query: "${query}"`);
    if (contextTicker) {
      this.logger.log(`  Context ticker from workspace: ${contextTicker}`);
    }
    this.llmUsageStats.totalQueries++;

    const startTime = Date.now();

    // Layer 1: Regex Fast-Path (Req 1.2)
    const fastPathResult = this.regexFastPath(query, contextTicker);
    if (fastPathResult.confidence >= 0.9) {
      this.llmUsageStats.regexSuccess++;
      this.logger.log(`✅ Regex fast-path hit (confidence: ${fastPathResult.confidence.toFixed(2)}, latency: ${Date.now() - startTime}ms)`);
      await this.logDetection(fastPathResult, 'regex_fast_path', tenantId, startTime);
      return fastPathResult;
    }

    // Layer 2: Fast-Path Cache (Req 1.3, 4.2)
    if (this.fastPathCache) {
      const cacheResult = this.fastPathCache.lookup(query, fastPathResult);
      if (cacheResult) {
        this.logger.log(`✅ Cache hit (latency: ${Date.now() - startTime}ms)`);
        await this.logDetection(cacheResult, 'cache_hit', tenantId, startTime);
        return cacheResult;
      }
    }

    // Layer 3: LLM Classification (Req 1.5)
    try {
      const llmEngine = new LlmDetectionEngine(this.bedrock, this.metricRegistry, this.conceptRegistry!);
      const llmResult = await llmEngine.classify(query, contextTicker);
      const resolvedIntent = await this.resolveFromLlmResult(llmResult, query, contextTicker);

      // Cache the successful LLM result if confidence >= 0.8 (Req 4.1)
      if (resolvedIntent.confidence >= 0.8 && this.fastPathCache) {
        this.fastPathCache.store(query, resolvedIntent);
      }

      // Set needsClarification for very low confidence (Req 12.2)
      // Only trigger clarification when confidence is genuinely low AND no context ticker is available.
      // A context ticker means the user is in a workspace — we know the company, so proceed with RAG.
      if (resolvedIntent.confidence < 0.5 && !contextTicker) {
        resolvedIntent.needsClarification = true;
        if (!resolvedIntent.ambiguityReason) {
          resolvedIntent.ambiguityReason = 'Detection confidence is low';
        }
      }
      // If context ticker is provided, never trigger clarification — the workspace context is sufficient
      if (contextTicker && resolvedIntent.needsClarification) {
        resolvedIntent.needsClarification = false;
        resolvedIntent.ambiguityReason = undefined;
        this.logger.log(`🔧 Overriding needsClarification=false because contextTicker="${contextTicker}" is provided`);
      }

      this.llmUsageStats.llmFallback++;
      const llmLatency = Date.now() - startTime;
      this.llmUsageStats.llmLatencyMs.push(llmLatency);
      this.logger.log(`✅ LLM detection succeeded (confidence: ${resolvedIntent.confidence.toFixed(2)}, latency: ${llmLatency}ms)`);
      await this.logDetection(resolvedIntent, 'llm', tenantId, startTime);
      return resolvedIntent;
    } catch (error) {
      // Fallback: use regex result with degraded confidence (Req 12.1, 12.4)
      this.llmUsageStats.genericFallback++;
      this.logger.error(`LLM detection failed: ${error.message}, using fallback`);
      const fallback = this.buildFallbackIntent(query, fastPathResult);
      await this.logDetection(fallback, 'fallback', tenantId, startTime, error.message);
      return fallback;
    }
  }

  /**
   * Build a fallback QueryIntent when LLM detection fails.
   * Uses the regex fast-path result with degraded confidence.
   * If regex confidence is below 0.5, returns a semantic fallback (Req 12.1).
   */
  private buildFallbackIntent(query: string, fastPathResult: QueryIntent): QueryIntent {
    if (fastPathResult.confidence >= 0.5) {
      const fallback: QueryIntent = {
        ...fastPathResult,
        confidence: Math.max(0, fastPathResult.confidence - 0.1),
        originalQuery: query,
      };
      if (fallback.confidence < 0.5) {
        fallback.needsClarification = true;
        if (!fallback.ambiguityReason) {
          fallback.ambiguityReason = 'LLM detection failed; using regex fallback';
        }
      }
      return fallback;
    }

    return {
      type: 'semantic',
      needsNarrative: true,
      needsComparison: false,
      needsComputation: false,
      needsTrend: false,
      needsClarification: true,
      ambiguityReason: 'LLM detection failed and regex confidence is low',
      confidence: Math.max(0.3, fastPathResult.confidence),
      originalQuery: query,
      ticker: fastPathResult.ticker,
    };
  }

  /**
   * Log a detection event to IntentAnalyticsService.
   * Non-throwing — logging failures don't break detection.
   */
  private async logDetection(
    intent: QueryIntent,
    method: 'regex_fast_path' | 'cache_hit' | 'llm' | 'fallback',
    tenantId: string | undefined,
    startTime: number,
    errorMessage?: string,
  ): Promise<void> {
    if (!tenantId) return;
    try {
      const latencyMs = Date.now() - startTime;
      const llmCostUsd = method === 'llm' ? this.calculateLLMCost(intent.originalQuery) : undefined;
      await this.analytics.logDetection({
        tenantId,
        query: intent.originalQuery,
        detectedIntent: intent,
        detectionMethod: method as any,
        confidence: intent.confidence,
        success: !errorMessage,
        errorMessage,
        latencyMs,
        llmCostUsd,
      });
    } catch (error) {
      this.logger.warn(`Failed to log detection: ${error?.message}`);
    }
  }

  /**
   * Extract ticker symbol from query
   *
   * @param query The normalized query string
   * @param contextTicker Optional ticker from workspace context for disambiguation
   */
  private extractTicker(query: string, contextTicker?: string): string | string[] | undefined {
    const queryTickers = this.extractTickersFromQuery(query);

    if (contextTicker) {
      const ctUpper = contextTicker.toUpperCase();
      const allTickers = new Set<string>([ctUpper, ...queryTickers]);
      const arr = Array.from(allTickers);
      this.logger.log(`🎯 Context ticker: ${ctUpper}, query tickers: [${queryTickers.join(', ')}], merged: [${arr.join(', ')}]`);
      return arr.length === 1 ? arr[0] : arr;
    }

    if (queryTickers.length === 0) {
      return undefined;
    }
    if (queryTickers.length === 1) {
      return queryTickers[0];
    }
    this.logger.log(`🔍 Multiple tickers detected: ${queryTickers.join(', ')}`);
    return queryTickers;
  }

  /**
   * Extract ticker symbols from query text using regex patterns.
   * The hardcoded companyMap has been removed (Req 11.4, 13.1).
   * Company name resolution is handled by CompanyTickerMapService (injected separately)
   * and by the LLM layer for names it recognizes.
   */
  private extractTickersFromQuery(query: string): string[] {
    const foundTickers = new Set<string>();

    // Ticker regex — matches known uppercase ticker symbols
    const tickerPatterns = [
      /\b(GOOGL|GOOG|AAPL|MSFT|AMZN|TSLA|META|NVDA|NFLX|INTC|ORCL|ADBE|PYPL|CSCO|SBUX|JPM|BAC|WFC|DIS|AMD|CRM|PFE|MRK|JNJ|UNH|CVS|WMT|TGT|NKE|MCD|KO|PEP|HD|LOW|RH|V|MA)\b/gi,
    ];

    const specificMatch = query.match(tickerPatterns[0]);
    if (specificMatch) {
      specificMatch.forEach(ticker => foundTickers.add(ticker.toUpperCase()));
    }

    return Array.from(foundTickers);
  }

  /**
   * Extract time period from query
   */
  private extractPeriod(query: string): PeriodExtractionResult {
    const currentYear = new Date().getFullYear();

    // Check specific fiscal year FIRST — per Req 4.5, explicit FY takes precedence over multi-year phrases
    const fyMatch = query.match(/\b(?:fy|fiscal year)\s*(\d{4})\b/i);
    if (fyMatch) {
      return { period: `FY${fyMatch[1]}` };
    }

    // "past N years", "last N years", "over the past N years", "over the last N years"
    const multiYearMatch = query.match(/\b(?:past|last|over the (?:past|last))\s+(\d+)\s+years?\b/i);
    if (multiYearMatch) {
      const n = Math.min(parseInt(multiYearMatch[1]), 30);
      return {
        periodType: 'range',
        periodStart: `FY${currentYear - n}`,
        periodEnd: `FY${currentYear}`,
      };
    }

    // "N-year" or "N year" (e.g., "5-year trend")
    const nYearMatch = query.match(/\b(\d+)[\s-]year\b/i);
    if (nYearMatch) {
      const n = Math.min(parseInt(nYearMatch[1]), 30);
      return {
        periodType: 'range',
        periodStart: `FY${currentYear - n}`,
        periodEnd: `FY${currentYear}`,
      };
    }

    // "decade" — "past decade", "last decade", "over the past decade"
    if (query.match(/\b(?:past|last|over the (?:past|last))\s+decade\b/i)) {
      return {
        periodType: 'range',
        periodStart: `FY${currentYear - 10}`,
        periodEnd: `FY${currentYear}`,
      };
    }

    // "year over year" / "yoy" → at least 2 years
    if (query.match(/\b(?:year over year|yoy)\b/i)) {
      return {
        periodType: 'range',
        periodStart: `FY${currentYear - 2}`,
        periodEnd: `FY${currentYear}`,
      };
    }

    // Latest
    if (query.match(/\b(latest|most recent|current)\b/i)) {
      return { period: 'latest' };
    }

    // Just year: 2024
    const yearMatch = query.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      return { period: `FY${yearMatch[1]}` };
    }

    // Quarter: Q4 2024, Q4-2024
    const quarterMatch = query.match(/\bq([1-4])[\s-]*(20\d{2})\b/i);
    if (quarterMatch) {
      return { period: `Q${quarterMatch[1]}-${quarterMatch[2]}` };
    }

    return {};
  }

  /**
   * Determine period type
   */
  private determinePeriodType(period?: string): PeriodType | undefined {
    if (!period) return undefined;

    if (period === 'latest') return 'latest';
    if (period.startsWith('FY')) return 'annual';
    if (period.match(/Q\d-\d{4}/)) return 'quarterly';

    return undefined;
  }

  /**
   * Calculate LLM cost for a query.
   * Claude 3.5 Haiku: $0.25 per 1M input tokens, $1.25 per 1M output tokens
   */
  private calculateLLMCost(query: string): number {
    const inputTokens = (query.length + 500) / 4;
    const outputTokens = 150;

    const inputCost = (inputTokens / 1_000_000) * 0.25;
    const outputCost = (outputTokens / 1_000_000) * 1.25;

    return inputCost + outputCost;
  }

  /**
   * Extract simple metric candidate phrases from a query for fast-path resolution.
   * Generates 1-3 word phrases by stripping stopwords, tickers, and periods.
   * Simpler than the deleted extractMetricCandidates() — designed for fast-path use only.
   */
  private extractMetricCandidatesSimple(query: string): string[] {
    const stopwords = new Set([
      'what', 'is', 'the', 'for', 'in', 'of', 'and', 'a', 'an', 'to', 'from',
      'how', 'much', 'was', 'were', 'are', 'has', 'had', 'have', 'show', 'me',
      'tell', 'give', 'get', 'find', 'compare', 'vs', 'versus', 'between',
      'their', 'its', 'this', 'that', 'with', 'by', 'on', 'at', 'do', 'does',
      'did', 'can', 'could', 'would', 'should', 'will', 'be', 'been', 'being',
      'about', 'over', 'last', 'past', 'recent', 'latest', 'current',
    ]);

    const cleaned = query
      .replace(/\b[a-z]{1,5}\b/g, (match) => {
        if (/^[a-z]{1,5}$/.test(match) && match === match.toUpperCase?.()) return '';
        return match;
      })
      .replace(/\b[A-Z]{1,5}\b/g, '')
      .replace(/\b(20\d{2}|19\d{2})\b/g, '')
      .replace(/\b(q[1-4]|fy\d{2,4}|annual|quarterly|ttm)\b/gi, '')
      .toLowerCase()
      .trim();

    const words = cleaned.split(/\s+/).filter(w => w.length > 1 && !stopwords.has(w));
    if (words.length === 0) return [];

    const phrases: string[] = [];

    for (let n = Math.min(3, words.length); n >= 1; n--) {
      for (let i = 0; i <= words.length - n; i++) {
        phrases.push(words.slice(i, i + n).join(' '));
      }
    }

    return [...new Set(phrases)].slice(0, 8);
  }

  /**
   * Build a low-confidence QueryIntent for cases where the fast-path cannot
   * fully resolve the query (missing ticker, metric, or period).
   * Used to signal that the query should be delegated to the cache or LLM layers.
   */
  private buildLowConfidenceIntent(
    query: string,
    ticker: string | string[] | undefined,
    metrics: string[],
    periodResult: PeriodExtractionResult,
    confidence: number,
  ): QueryIntent {
    const hasMetrics = metrics.length > 0;
    const type: QueryType = hasMetrics ? 'structured' : 'semantic';

    return {
      type,
      ticker,
      metrics: hasMetrics ? metrics : undefined,
      period: periodResult.period,
      periodType: periodResult.periodType || this.determinePeriodType(periodResult.period),
      periodStart: periodResult.periodStart,
      periodEnd: periodResult.periodEnd,
      needsNarrative: !hasMetrics,
      needsComparison: Array.isArray(ticker) && ticker.length > 1,
      needsComputation: false,
      needsTrend: false,
      needsPeerComparison: false,
      confidence: Math.max(0, Math.min(1, confidence)),
      originalQuery: query,
    };
  }

  /**
   * Regex Fast-Path: Deterministic detection for simple queries.
   * Returns high confidence (>= 0.9) only when ALL three criteria are met:
   *   1. Exactly one ticker detected
   *   2. At least one metric resolved with "exact" confidence from MetricRegistryService
   *   3. An explicit period extracted
   *
   * Multi-ticker queries immediately return confidence 0.5 to delegate to LLM.
   * Partial matches return proportional low confidence to trigger cache/LLM layers.
   *
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 6.6
   */
  private regexFastPath(query: string, contextTicker?: string): QueryIntent {
    const normalizedQuery = query.toLowerCase();

    const ticker = this.extractTicker(normalizedQuery, contextTicker);
    const periodResult = this.extractPeriod(normalizedQuery);

    const metricCandidates = this.extractMetricCandidatesSimple(normalizedQuery);
    const exactMetrics: string[] = [];
    let hasComputedMetric = false;

    for (const candidate of metricCandidates) {
      try {
        const resolution = this.metricRegistry.resolve(candidate);
        if (resolution && resolution.confidence === 'exact') {
          const metricKey = resolution.db_column || resolution.canonical_id;
          if (!exactMetrics.includes(metricKey)) {
            exactMetrics.push(metricKey);
          }
          if (resolution.type === 'computed') {
            hasComputedMetric = true;
          }
        }
      } catch {
        // MetricRegistryService error — skip this candidate
      }
    }

    const isSingleTicker = typeof ticker === 'string';
    const hasExactMetric = exactMetrics.length > 0;
    const hasPeriod = !!periodResult.period;
    const isMultiTicker = Array.isArray(ticker) && ticker.length > 1;

    // Multi-ticker → always delegate to LLM (Req 2.7)
    if (isMultiTicker) {
      return this.buildLowConfidenceIntent(query, ticker, exactMetrics, periodResult, 0.5);
    }

    // Full fast-path: single ticker + exact metric + period (Req 2.1)
    if (isSingleTicker && hasExactMetric && hasPeriod) {
      const type: QueryType = exactMetrics.length > 0 ? 'structured' : 'semantic';

      return {
        type,
        ticker,
        metrics: exactMetrics,
        period: periodResult.period,
        periodType: periodResult.periodType || this.determinePeriodType(periodResult.period),
        periodStart: periodResult.periodStart,
        periodEnd: periodResult.periodEnd,
        needsNarrative: false,
        needsComparison: false,
        needsComputation: hasComputedMetric,
        needsTrend: false,
        needsPeerComparison: false,
        confidence: 0.95,
        originalQuery: query,
      };
    }

    // Partial match — return low confidence to trigger LLM (Req 2.5)
    const confidence = (isSingleTicker ? 0.3 : 0) + (hasExactMetric ? 0.3 : 0) + (hasPeriod ? 0.2 : 0);
    return this.buildLowConfidenceIntent(query, ticker, exactMetrics, periodResult, confidence);
  }

  /**
   * Post-LLM resolution pipeline.
   *
   * Takes the raw LLM classification result and resolves entities through
   * the existing registries:
   * - Metrics → MetricRegistryService.resolve()
   * - Concepts → ConceptRegistryService.matchConcept() + getMetricBundle()
   * - Periods → extractPeriod() as fallback
   * - Tickers → merge with contextTicker
   *
   * Requirements: 3.1, 3.2, 3.3, 3.4, 5.2, 5.3, 5.4, 5.5
   */
  async resolveFromLlmResult(
    llmResult: LlmClassificationResult,
    query: string,
    contextTicker?: string,
  ): Promise<QueryIntent> {
    // 1. Resolve tickers (merge with contextTicker if present)
    let tickers = llmResult.tickers;
    if (contextTicker) {
      const ctUpper = contextTicker.toUpperCase();
      tickers = [...new Set([ctUpper, ...tickers])];
    }

    // 2. Resolve metrics through MetricRegistryService
    const resolvedMetrics: string[] = [];
    let needsComputation = llmResult.needsComputation;
    for (const phrase of llmResult.rawMetricPhrases) {
      try {
        const resolution = this.metricRegistry.resolve(phrase);
        if (resolution && resolution.confidence !== 'unresolved') {
          const metricKey = resolution.db_column || resolution.canonical_id;
          if (!resolvedMetrics.includes(metricKey)) {
            resolvedMetrics.push(metricKey);
          }
          if (resolution.type === 'computed') {
            needsComputation = true;
          }
        } else {
          await this.logUnresolvedMetric(phrase, query, tickers[0] || '');
        }
      } catch (error) {
        this.logger.warn(`MetricRegistryService error resolving "${phrase}": ${error?.message}`);
        await this.logUnresolvedMetric(phrase, query, tickers[0] || '');
      }
    }

    // 3. Match concepts through ConceptRegistryService (Req 5.3)
    if (llmResult.conceptMatch && this.conceptRegistry) {
      try {
        const conceptMatch = this.conceptRegistry.matchConcept(query);
        if (conceptMatch) {
          const bundle = this.conceptRegistry.getMetricBundle(conceptMatch.concept_id);
          if (bundle) {
            for (const metricId of [...bundle.primary_metrics, ...bundle.secondary_metrics]) {
              if (!resolvedMetrics.includes(metricId)) {
                resolvedMetrics.push(metricId);
              }
            }
            needsComputation = true;
          }
        }
      } catch (error) {
        this.logger.warn(`ConceptRegistryService error for query "${query}": ${error?.message}`);
      }
    }

    // 4. Resolve period (use preserved extractPeriod logic as fallback)
    const periodResult = this.extractPeriod(query);
    const period = llmResult.period || periodResult.period;
    const periodType = this.determinePeriodType(period);

    // 5. Structural comparison detection (Req 3.1, 3.2)
    const needsComparison = tickers.length > 1 || llmResult.needsComparison;
    const needsPeerComparison = llmResult.needsPeerComparison ||
      (tickers.length > 1 && this.hasComparisonConnectors(query));

    // 6. Build QueryIntent
    return {
      type: llmResult.queryType,
      ticker: tickers.length === 1 ? tickers[0] : tickers.length > 1 ? tickers : undefined,
      metrics: resolvedMetrics.length > 0 ? resolvedMetrics : undefined,
      period,
      periodType,
      periodStart: llmResult.periodStart || periodResult.periodStart,
      periodEnd: llmResult.periodEnd || periodResult.periodEnd,
      documentTypes: llmResult.documentTypes as any,
      sectionTypes: llmResult.sectionTypes as any,
      subsectionName: llmResult.subsectionName,
      needsNarrative: llmResult.needsNarrative,
      needsComparison,
      needsComputation,
      needsTrend: llmResult.needsTrend,
      needsPeerComparison,
      needsClarification: llmResult.needsClarification,
      ambiguityReason: llmResult.ambiguityReason,
      confidence: llmResult.confidence,
      suggestedChart: llmResult.suggestedChart ?? null,
      retrievalPaths: llmResult.retrievalPaths,
      originalQuery: query,
    };
  }

  /**
   * Check if a query contains comparison connectors between entities.
   * Used for structural peer comparison detection (Req 3.2).
   */
  private hasComparisonConnectors(query: string): boolean {
    const normalized = query.toLowerCase();
    const connectors = [
      'vs',
      'versus',
      'compared to',
      'relative to',
      'against',
      'stack up',
    ];
    return connectors.some(connector => normalized.includes(connector));
  }

  /**
   * Log an unresolved metric phrase to MetricLearningService.
   */
  private async logUnresolvedMetric(rawPhrase: string, query: string, ticker: string): Promise<void> {
    try {
      await this.metricLearning?.logUnrecognizedMetric({
        tenantId: '',
        ticker,
        query,
        requestedMetric: rawPhrase,
        failureReason: 'LLM detected metric phrase not in MetricRegistryService',
        userMessage: '',
      });
    } catch (error) {
      this.logger.warn(`Failed to log unresolved metric "${rawPhrase}": ${error?.message}`);
    }
  }
}
