import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
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
import { PrismaService } from '../../prisma/prisma.service';
import { ValidatedQueryIntent, MappedTimePeriod } from './intent-validator.service';
import { IntentValidatorService } from './intent-validator.service';
import { HaikuIntentParserService } from './haiku-intent-parser.service';
import { QIOQueryType } from './types/query-intent-object';
import { MetricResolution } from './metric-resolution/types';

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
export class IntentDetectorService implements OnModuleInit {
  private readonly logger = new Logger(IntentDetectorService.name);

  /** Known tickers loaded from the database for regex validation (Req 6.1) */
  private knownTickers: Set<string> = new Set();

  /** LRU cache for happy-path validated results (Req 7.1–7.5, 11.1, 11.2) */
  private happyPathCache = new LRUCache<string, ValidatedQueryIntent>({
    max: 5000,
    ttl: 86_400_000, // 24 hours
  });

  /** Separate LRU cache for fallback results with shorter TTL (Req 8.5, 11.4) */
  private fallbackCache = new LRUCache<string, ValidatedQueryIntent>({
    max: 5000,
    ttl: 300_000, // 5 minutes — short TTL so queries recover when Bedrock comes back online
  });

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
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly conceptRegistry?: ConceptRegistryService,
    @Optional() private readonly metricLearning?: MetricLearningService,
    @Optional() private readonly fastPathCache?: FastPathCache,
    @Optional() private readonly companyTickerMap?: CompanyTickerMapService,
    @Optional() private readonly feedbackService?: IntentFeedbackService,
    @Optional() private readonly haikuParser?: HaikuIntentParserService,
    @Optional() private readonly intentValidator?: IntentValidatorService,
  ) {}

  /**
   * Load known tickers from the database at startup (Req 6.1).
   * Falls back to CompanyTickerMapService tickers if DB query fails.
   */
  async onModuleInit(): Promise<void> {
    await this.refreshTickerSet();
  }

  /**
   * Refresh the known ticker set from the database.
   * Loads distinct tickers from financial_metrics table and merges with
   * CompanyTickerMapService tickers for comprehensive coverage.
   * Runs daily at 2:00 AM (Req 6.6).
   */
  @Cron('0 2 * * *')
  async refreshTickerSet(): Promise<void> {
    try {
      const dbTickers = new Set<string>();

      // Load distinct tickers from financial_metrics (primary source of known tickers)
      if (this.prisma) {
        const rows = await this.prisma.financialMetric.findMany({
          select: { ticker: true },
          distinct: ['ticker'],
        });
        for (const row of rows) {
          if (row.ticker) {
            dbTickers.add(row.ticker.toUpperCase());
          }
        }
      }

      // Merge with CompanyTickerMapService tickers for broader coverage
      if (this.companyTickerMap) {
        const mapTickers = this.companyTickerMap.getAllTickers();
        for (const t of mapTickers) {
          dbTickers.add(t.toUpperCase());
        }
      }

      this.knownTickers = dbTickers;
      this.logger.log(`Ticker set refreshed: ${this.knownTickers.size} known tickers`);
    } catch (error) {
      this.logger.error(`Failed to refresh ticker set: ${error?.message}`);
      // Keep existing set (or empty set on first load) — will retry on next cron cycle
    }
  }

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
      // If context ticker is provided, only suppress clarification for ticker-related ambiguity
      // on non-gibberish queries. Gibberish queries should still trigger clarification.
      if (contextTicker && resolvedIntent.needsClarification) {
        const isTickerRelatedAmbiguity = !resolvedIntent.ambiguityReason ||
          resolvedIntent.ambiguityReason.toLowerCase().includes('ticker') ||
          resolvedIntent.ambiguityReason.toLowerCase().includes('company') ||
          resolvedIntent.ambiguityReason.toLowerCase().includes('missing');

        if (isTickerRelatedAmbiguity && !this.isGibberish(query)) {
          resolvedIntent.needsClarification = false;
          resolvedIntent.ambiguityReason = undefined;
          this.logger.log(`🔧 Overriding needsClarification=false because contextTicker="${contextTicker}" is provided and query is intelligible`);
        } else {
          this.logger.log(`🚫 Preserving needsClarification=true despite contextTicker="${contextTicker}" — query appears to be gibberish or ambiguity is not ticker-related`);
        }
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
   * Lightweight deterministic heuristic to detect gibberish/nonsensical queries.
   * Returns true if the query lacks recognizable English words or financial terms.
   *
   * Logic:
   * 1. If any token is a known financial term → not gibberish
   * 2. If 2+ tokens are common English dictionary words → not gibberish
   * 3. Otherwise → gibberish
   */
  private isGibberish(query: string): boolean {
    const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) return true;

    // Known financial terms: tickers, metrics, filing types, section references
    const financialTerms = new Set([
      // Common tickers
      'aapl', 'msft', 'googl', 'goog', 'amzn', 'meta', 'tsla', 'nvda', 'brk',
      'jpm', 'v', 'ma', 'hd', 'pg', 'jnj', 'unh', 'bac', 'xom', 'cvx', 'ko',
      'pep', 'abbv', 'mrk', 'lly', 'cost', 'avgo', 'wmt', 'dis', 'adbe', 'crm',
      'nflx', 'csco', 'acn', 'intc', 'amd', 'qcom', 'txn', 'ibm', 'orcl', 'cmcsa',
      'amgn', 'abt', 'tmo', 'dhr', 'mdt', 'isrg', 'bmy', 'gild', 'regn', 'vrtx',
      // Metric names
      'revenue', 'revenues', 'income', 'earnings', 'profit', 'loss', 'margin',
      'ebitda', 'ebit', 'eps', 'pe', 'p/e', 'roe', 'roa', 'roic', 'roi',
      'debt', 'equity', 'assets', 'liabilities', 'cash', 'capex',
      'dividend', 'dividends', 'yield', 'growth', 'cagr', 'fcf',
      'operating', 'gross', 'net', 'total', 'free', 'working', 'capital',
      'sales', 'cost', 'costs', 'expense', 'expenses', 'depreciation',
      'amortization', 'interest', 'tax', 'taxes', 'shares', 'outstanding',
      'market', 'cap', 'valuation', 'multiple', 'ratio', 'leverage',
      'liquidity', 'solvency', 'profitability', 'efficiency', 'turnover',
      'inventory', 'receivables', 'payables', 'backlog', 'guidance',
      'forecast', 'estimate', 'consensus', 'beat', 'miss', 'surprise',
      'segment', 'segments', 'breakdown', 'composition', 'mix',
      // Filing types
      '10-k', '10k', '10-q', '10q', '8-k', '8k', '20-f', '20f',
      'annual', 'quarterly', 'filing', 'filings', 'report', 'sec',
      // Section references
      'item', 'section', 'mda', 'md&a', 'risk', 'risks', 'factors',
      'business', 'overview', 'financial', 'statements', 'notes',
      'discussion', 'analysis', 'management',
    ]);

    // Check 1: Any token is a known financial term
    for (const token of tokens) {
      if (financialTerms.has(token)) return false;
    }

    // Also check multi-token financial terms like "item 7", "10-k", "free cash flow"
    const joined = tokens.join(' ');
    const multiTokenTerms = [
      'item 1', 'item 1a', 'item 1b', 'item 2', 'item 3', 'item 4',
      'item 5', 'item 6', 'item 7', 'item 7a', 'item 8', 'item 9',
      'free cash flow', 'cash flow', 'balance sheet', 'income statement',
      'profit margin', 'gross margin', 'operating margin', 'net margin',
      'price to earnings', 'debt to equity', 'current ratio',
      'earnings per share', 'return on equity', 'return on assets',
    ];
    for (const term of multiTokenTerms) {
      if (joined.includes(term)) return false;
    }

    // Check 2: At least 2 dictionary-recognizable English words
    const commonEnglishWords = new Set([
      'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
      'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
      'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her',
      'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there',
      'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get',
      'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no',
      'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your',
      'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then',
      'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
      'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first',
      'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
      'give', 'day', 'most', 'us', 'tell', 'show', 'compare', 'between',
      'much', 'many', 'more', 'less', 'high', 'low', 'big', 'small',
      'last', 'next', 'recent', 'current', 'previous', 'latest',
      'increase', 'decrease', 'change', 'trend', 'performance',
      'company', 'companies', 'stock', 'stocks', 'price', 'prices',
      'value', 'rate', 'rates', 'percent', 'percentage', 'number',
      'data', 'information', 'details', 'summary', 'chart', 'graph',
      'table', 'list', 'top', 'best', 'worst', 'average', 'median',
      'was', 'were', 'been', 'being', 'has', 'had', 'did', 'does',
      'are', 'is', 'am', 'should', 'would', 'could', 'might', 'may',
      'must', 'shall', 'need', 'why', 'where', 'how', 'when', 'what',
      'which', 'who', 'whom', 'whose', 'each', 'every', 'both',
      'few', 'several', 'own', 'same', 'different', 'such', 'very',
      'too', 'quite', 'rather', 'enough', 'still', 'already', 'yet',
    ]);

    let dictWordCount = 0;
    for (const token of tokens) {
      // Strip common punctuation for matching
      const cleaned = token.replace(/[.,!?;:'"()]/g, '');
      if (cleaned.length > 0 && commonEnglishWords.has(cleaned)) {
        dictWordCount++;
      }
    }

    if (dictWordCount >= 2) return false;

    // Neither condition met — query is gibberish
    return true;
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

        // PRIORITY: Query tickers first, context ticker second.
        // "AMZN revenue" in AAPL workspace → ["AMZN", "AAPL"], not ["AAPL", "AMZN"]
        if (queryTickers.length > 0) {
          const allTickers = new Set<string>([...queryTickers, ctUpper]);
          const arr = Array.from(allTickers);
          this.logger.log(`🎯 Query tickers: [${queryTickers.join(', ')}], context: ${ctUpper}, merged: [${arr.join(', ')}]`);
          return arr.length === 1 ? arr[0] : arr;
        }

        // No tickers in query → use context ticker as sole source
        this.logger.log(`🎯 No query tickers, using context: ${ctUpper}`);
        return ctUpper;
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
   * Extract ticker symbols from query text using universal regex + companies table validation.
   * Uses pattern matching for 1-5 uppercase letters bounded by whitespace/punctuation,
   * then validates candidates against the knownTickers Set loaded from the database.
   * This rejects non-ticker uppercase words like EBITDA, GAAP, CEO, FY (Req 6.2, 6.3).
   */
  private extractTickersFromQuery(query: string): string[] {
    const candidates = new Set<string>();

    // Pass 1: Match uppercase ticker symbols (e.g. AAPL, NVDA)
    const upperPattern = /(?:^|[\s,(.])([A-Z]{1,5})(?=[\s,.)!?\n]|$)/g;
    let m: RegExpExecArray | null;
    while ((m = upperPattern.exec(query)) !== null) {
      candidates.add(m[1]);
    }

    // Pass 2: Case-insensitive — match lowercase/mixed-case tickers (e.g. abnb, Aapl)
    // Only match standalone words with 2-5 letters to avoid matching single letters
    // from common words like "a", "I", or substrings like "C" from "across"
    const ciPattern = /(?:^|[\s,(.])([a-zA-Z]{2,5})(?=[\s,.)!?\n]|$)/gi;
    const stopwords = new Set([
      'what', 'are', 'the', 'for', 'and', 'how', 'has', 'its', 'was', 'were',
      'show', 'give', 'from', 'with', 'over', 'past', 'last', 'this', 'that',
      'does', 'been', 'have', 'will', 'can', 'net', 'per', 'year', 'years',
      'also', 'than', 'each', 'much', 'most', 'some', 'all', 'any', 'few',
    ]);
    while ((m = ciPattern.exec(query)) !== null) {
      const word = m[1];
      const upper = word.toUpperCase();
      // Skip common English words and only accept known tickers
      if (!stopwords.has(word.toLowerCase()) && this.knownTickers.has(upper)) {
        candidates.add(upper);
      }
    }

    // Pass 3: Company name resolution via CompanyTickerMapService
    if (this.companyTickerMap) {
      const companyTickers = this.companyTickerMap.resolveAll(query);
      for (const t of companyTickers) {
        candidates.add(t.toUpperCase());
      }
    }

    const validated = Array.from(candidates).filter(c => this.knownTickers.has(c));

    // Req 22.5: Log ticker candidates not found in companies table
    const rejected = Array.from(candidates).filter(c => !this.knownTickers.has(c));
    if (rejected.length > 0) {
      this.logger.warn(
        `ticker_miss_log: Regex candidates not in companies table: [${rejected.join(', ')}] — query: "${query.substring(0, 80)}"`,
      );
    }

    return validated;
  }

  /**
   * Extract time period from query
   */
  private extractPeriod(query: string): PeriodExtractionResult {
    const currentYear = new Date().getFullYear();

    // Check FY RANGE first — "FY 2023 - 2024", "FY 2020 to FY 2024", "fiscal year 2023–2024"
    const fyRangeMatch = query.match(/\b(?:fy|fiscal year)\s*(\d{4})\s*[-–to]+\s*(?:fy|fiscal year)?\s*(\d{4})\b/i);
    if (fyRangeMatch) {
      return {
        periodType: 'range',
        periodStart: `FY${fyRangeMatch[1]}`,
        periodEnd: `FY${fyRangeMatch[2]}`,
      };
    }

    // Check specific fiscal year — per Req 4.5, explicit FY takes precedence over multi-year phrases
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
    const isRange = periodResult.periodType === 'range';
    const hasTrendSignal = isRange || /\b(trend|growth|grown|over|past|last|year.over.year|yoy|history|historical)\b/i.test(query);

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
      needsTrend: hasTrendSignal,
      needsPeerComparison: false,
      suggestedChart: hasTrendSignal ? 'line' : null,
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

    // Use original query for ticker extraction (regex needs uppercase letters)
    const ticker = this.extractTicker(query, contextTicker);
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
      const isRange = periodResult.periodType === 'range';
      const hasTrendSignal = isRange || /\b(trend|growth|grown|over|past|last|year.over.year|yoy|history|historical)\b/i.test(normalizedQuery);

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
        needsTrend: hasTrendSignal,
        needsPeerComparison: false,
        suggestedChart: hasTrendSignal ? 'line' : null,
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
    // 1. Resolve tickers — query-extracted tickers take priority over context ticker.
    let tickers = llmResult.tickers;
    if (contextTicker) {
      const ctUpper = contextTicker.toUpperCase();
      // LLM tickers first (from query), context ticker appended as secondary
      tickers = [...new Set([...tickers, ctUpper])];
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

  // ---------------------------------------------------------------------------
  // Haiku-first pipeline helpers (Task 3.5a)
  // ---------------------------------------------------------------------------

  /**
   * Normalize a query for cache key generation and comparison.
   * Trims whitespace, collapses multiple spaces to single space, lowercases.
   * Ensures "ABNB revenue", "abnb revenue", "  ABNB  revenue  " all produce
   * the same normalized form.
   *
   * Requirements: 7.1, 7.5 (via 8.2)
   */
  normalizeQuery(query: string): string {
    return query.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  /**
   * Compute a cache key from a normalized query using SHA-256 (first 16 chars).
   *
   * Requirements: 7.1, 7.5
   */
  computeCacheKey(normalizedQuery: string): string {
    return createHash('sha256').update(normalizedQuery).digest('hex').substring(0, 16);
  }

  /**
   * Haiku-first intent detection pipeline entry point.
   *
   * Pipeline: normalize → cache check → Haiku parse → validate → cache set → return.
   * Falls back to regex when Haiku returns null.
   *
   * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 10.1, 10.2, 10.4, 11.1, 11.2
   */
  async detect(query: string): Promise<ValidatedQueryIntent> {
    const normalized = this.normalizeQuery(query);
    const cacheKey = this.computeCacheKey(normalized);

    this.logger.log(`[Haiku pipeline] detect() called for: "${normalized}"`);

    // --- Cache check (Req 7.2) ---
    const cached = this.happyPathCache.get(cacheKey);
    if (cached) {
      this.logger.debug(`[Haiku pipeline] Cache HIT for key=${cacheKey}`);
      return cached;
    }

    // --- Cache miss: call Haiku parser for structured extraction ---
    const qio = await this.haikuParser!.parse(normalized);

    if (!qio) {
      this.logger.warn(
        `[Haiku pipeline] Haiku parse returned null for query: "${query.substring(0, 80)}" — activating regex fallback`,
      );

      // Check fallback cache first (Req 8.5, 11.4)
      const cachedFallback = this.fallbackCache.get(cacheKey);
      if (cachedFallback) {
        this.logger.debug(`[Haiku pipeline] Fallback cache HIT for key=${cacheKey}`);
        return cachedFallback;
      }

      // Fresh fallback — cache with 5min TTL
      const fallbackResult = await this.regexFallback(query);
      this.fallbackCache.set(cacheKey, fallbackResult);
      this.logger.log('[Haiku pipeline] Fallback cache MISS — cached with 5min TTL');
      return fallbackResult;
    }

    // Validate and enrich via deterministic validation layer
    const validated = await this.intentValidator!.validate(qio);

    // Log extracted tickers/metrics/queryType on cache miss (Req 11.2)
    this.logger.log(
      `[Haiku pipeline] Cache MISS — tickers=[${validated.tickers.join(', ')}] ` +
      `queryType=${validated.queryType} metrics=${validated.metrics.length}`,
    );

    // --- Cache set (Req 7.3) ---
    this.happyPathCache.set(cacheKey, validated);

    return validated;
  }

  /**
   * Maps a ValidatedQueryIntent to the existing QueryIntent interface
   * consumed by QueryRouter and downstream services.
   *
   * Mapping rules (from design doc):
   * - tickers (length 1) → ticker as single string
   * - tickers (length > 1) → ticker as string array
   * - metrics → MetricResolution canonical_ids as string[]
   * - queryType → QueryType enum (structured/semantic/hybrid) per mapping table
   * - needsNarrative, needsComputation, needsPeerComparison → direct pass-through
   * - timePeriod → period string + PeriodType enum
   * - originalQuery → direct pass-through
   *
   * Requirements: 10.1, 10.2, 15.1, 15.2, 15.3, 15.4, 15.5
   */
  mapToQueryIntent(validated: ValidatedQueryIntent): QueryIntent {
    // 15.1 / 15.2: Single ticker → string, multiple tickers → string array
    let ticker: string | string[] | undefined;
    if (validated.tickers.length === 1) {
      ticker = validated.tickers[0];
    } else if (validated.tickers.length > 1) {
      ticker = validated.tickers;
    }

    // 15.3: Map MetricResolution[] to string[] (canonical IDs)
    const metrics = validated.metrics.map(m => m.canonical_id);

    // 15.4: Map QIOQueryType → QueryType (structured/semantic/hybrid)
    const type = this.mapQueryType(validated.queryType);

    // Map MappedTimePeriod → period string + PeriodType enum
    const { period, periodType, periodStart, periodEnd } = this.mapTimePeriodToQueryIntent(validated.timePeriod);

    return {
      type,
      ticker,
      metrics: metrics.length > 0 ? metrics : undefined,
      period,
      periodType,
      periodStart,
      periodEnd,
      // 15.5: Direct pass-through fields
      needsNarrative: validated.needsNarrative,
      needsComparison: validated.queryType === 'comparative',
      needsComputation: validated.needsComputation,
      needsTrend: validated.queryType === 'trend_analysis',
      needsPeerComparison: validated.needsPeerComparison,
      confidence: validated.entities.length > 0
        ? Math.max(...validated.entities.map(e => e.confidence))
        : 0.5,
      originalQuery: validated.originalQuery,
    };
  }

  /**
   * Maps QIOQueryType to the existing QueryType enum (structured/semantic/hybrid).
   *
   * Design mapping table:
   *   narrative_only → 'semantic'
   *   concept_analysis → 'hybrid'
   *   single_metric, multi_metric, comparative, trend_analysis, screening → 'structured'
   *   peer_benchmark, modeling, sentiment → 'hybrid'
   */
  private mapQueryType(qioType: QIOQueryType): QueryType {
    switch (qioType) {
      case 'narrative_only':
        return 'semantic';
      case 'concept_analysis':
      case 'peer_benchmark':
      case 'modeling':
      case 'sentiment':
        return 'hybrid';
      case 'single_metric':
      case 'multi_metric':
      case 'comparative':
      case 'trend_analysis':
      case 'screening':
        return 'structured';
      default:
        return 'hybrid';
    }
  }

  /**
   * Maps MappedTimePeriod to QueryIntent period fields.
   *
   * MappedTimePeriod.periodType values → QueryIntent fields:
   *   LATEST_BOTH → periodType='latest', period=undefined
   *   SPECIFIC_YEAR → periodType='annual', period='FY{year}'
   *   SPECIFIC_QUARTER → periodType='quarterly', period='Q{quarter}'
   *   RANGE → periodType='range', periodStart/periodEnd computed from rangeValue/rangeUnit
   *   TTM → periodType='latest', period='TTM'
   *   YTD → periodType='latest', period='YTD'
   */
  private mapTimePeriodToQueryIntent(tp: MappedTimePeriod): {
    period?: string;
    periodType?: PeriodType;
    periodStart?: string;
    periodEnd?: string;
  } {
    switch (tp.periodType) {
      case 'LATEST_BOTH':
        return { periodType: 'latest' };
      case 'SPECIFIC_YEAR':
        return {
          periodType: 'annual',
          period: tp.specificPeriod || undefined,
        };
      case 'SPECIFIC_QUARTER':
        return {
          periodType: 'quarterly',
          period: tp.specificPeriod || undefined,
        };
      case 'RANGE': {
        const currentYear = new Date().getFullYear();
        const rangeYears = tp.rangeValue || 5;
        return {
          periodType: 'range',
          periodStart: `FY${currentYear - rangeYears}`,
          periodEnd: `FY${currentYear}`,
        };
      }
      case 'TTM':
        return { periodType: 'latest', period: 'TTM' };
      case 'YTD':
        return { periodType: 'latest', period: 'YTD' };
      default:
        return { periodType: 'latest' };
    }
  }

  /**
   * Simplified regex fallback for when Bedrock/Haiku is unavailable.
   * Extracts only explicit uppercase tickers (1-5 letter words matching the
   * knownTickers set) and resolves metrics via MetricRegistryService using
   * exact name matching only.
   *
   * Defaults: timePeriod=LATEST_BOTH, queryType=single_metric, all boolean flags=false.
   *
   * Requirements: 8.2, 8.3, 8.4
   */
  async regexFallback(query: string): Promise<ValidatedQueryIntent> {
    this.logger.warn(`Regex fallback activated for query: "${query.substring(0, 80)}"`);

    // Extract uppercase ticker candidates using the specified pattern
    const tickerPattern = /(?:^|[\s,(.])([A-Z]{1,5})(?=[\s,.)!?\n]|$)/g;
    const tickers: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = tickerPattern.exec(query)) !== null) {
      const candidate = match[1];
      if (this.knownTickers.has(candidate) && !tickers.includes(candidate)) {
        tickers.push(candidate);
      }
    }

    // Resolve metrics via MetricRegistryService using exact name matching only
    const metricCandidates = this.extractMetricCandidatesSimple(query.toLowerCase());
    const resolvedMetrics: MetricResolution[] = [];
    const rawMetrics: { raw_name: string; canonical_guess: string; is_computed: boolean }[] = [];

    for (const candidate of metricCandidates) {
      try {
        const resolution = this.metricRegistry.resolve(candidate);
        if (resolution && resolution.confidence === 'exact') {
          // Avoid duplicates by canonical_id
          if (!resolvedMetrics.some(m => m.canonical_id === resolution.canonical_id)) {
            resolvedMetrics.push(resolution);
            rawMetrics.push({
              raw_name: candidate,
              canonical_guess: resolution.canonical_id,
              is_computed: resolution.type === 'computed',
            });
          }
        }
      } catch {
        // Skip metric resolution errors in fallback
      }
    }

    return {
      tickers,
      entities: tickers.map(t => ({
        ticker: t,
        company: '',
        confidence: 0.5,
        validated: true,
        source: 'exact_match' as const,
      })),
      metrics: resolvedMetrics,
      rawMetrics,
      timePeriod: {
        periodType: 'LATEST_BOTH',
        specificPeriod: null,
      },
      queryType: 'single_metric',
      needsNarrative: false,
      needsPeerComparison: false,
      needsComputation: false,
      originalQuery: query,
    };
  }
}
