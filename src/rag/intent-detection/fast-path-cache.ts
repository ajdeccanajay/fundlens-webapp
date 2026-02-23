import { Injectable, Logger } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { QueryIntent } from '../types/query-intent';

/**
 * Cached intent entry stored in the LRU cache.
 * The template is a QueryIntent with placeholder-like values that get
 * substituted with actual values from the current query on cache hit.
 */
export interface CachedIntent {
  /** The QueryIntent template from the original LLM detection */
  template: QueryIntent;
  /** Timestamp when this entry was cached */
  storedAt: number;
  /** Number of times this cache entry has been used */
  hitCount: number;
}

/**
 * FastPathCache — Layer 2 of the three-layer intent detection architecture.
 *
 * Stores successful LLM detection results keyed by normalized query patterns.
 * When a new query matches a cached pattern, the cached template is returned
 * with actual values (ticker, period, metrics) substituted in from the current query.
 *
 * Pattern normalization replaces specific tickers with {TICKER}, periods with {PERIOD},
 * so that "AAPL revenue FY2024" and "MSFT revenue FY2023" share the same cache key.
 *
 * Uses LRU eviction with a max of 5,000 entries.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */
@Injectable()
export class FastPathCache {
  private readonly logger = new Logger(FastPathCache.name);
  private cache: LRUCache<string, CachedIntent>;
  private readonly MAX_SIZE = 5000;

  /** Set of known ticker symbols used for pattern normalization */
  private knownTickers: Set<string> = new Set();

  constructor() {
    this.cache = new LRUCache<string, CachedIntent>({ max: this.MAX_SIZE });
    // Seed with common tickers — can be updated externally via setKnownTickers()
    this.knownTickers = new Set([
      'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA', 'NVDA',
      'NFLX', 'INTC', 'ORCL', 'ADBE', 'PYPL', 'CSCO', 'SBUX', 'JPM',
      'BAC', 'WFC', 'DIS', 'AMD', 'CRM', 'PFE', 'MRK', 'JNJ', 'UNH',
      'CVS', 'WMT', 'TGT', 'NKE', 'MCD', 'KO', 'PEP', 'HD', 'LOW',
      'RH', 'V', 'MA', 'AMGN', 'CMCSA', 'AVGO', 'COST', 'TMO', 'DHR',
      'LLY', 'ABBV', 'ACN', 'TXN', 'QCOM', 'HON', 'IBM', 'GE', 'CAT',
      'BA', 'MMM', 'GS', 'MS', 'BLK', 'SCHW', 'AXP', 'C', 'USB',
    ]);
  }

  /**
   * Update the set of known tickers used for pattern normalization.
   * Called when tenant tickers are loaded or refreshed.
   */
  setKnownTickers(tickers: Set<string>): void {
    this.knownTickers = new Set([...this.knownTickers, ...tickers]);
  }

  /**
   * Check if a ticker symbol is in the known tickers set.
   */
  isKnownTicker(ticker: string): boolean {
    return this.knownTickers.has(ticker.toUpperCase());
  }

  /**
   * Look up a query in the cache. If a matching normalized pattern exists,
   * substitute the actual values from the current query into the cached template.
   *
   * @param query - The raw user query
   * @param fastPathResult - Partial QueryIntent from the regex fast-path (provides extracted ticker, period, metrics)
   * @returns A fully populated QueryIntent if cache hit, null if cache miss
   */
  lookup(query: string, fastPathResult: Partial<QueryIntent>): QueryIntent | null {
    const pattern = this.normalizeToPattern(query);
    const cached = this.cache.get(pattern);
    if (!cached) return null;

    cached.hitCount++;
    return this.substituteValues(cached, fastPathResult, query);
  }

  /**
   * Store a successful LLM detection result in the cache, keyed by the
   * normalized query pattern.
   *
   * @param query - The raw user query
   * @param intent - The QueryIntent produced by the LLM detection engine
   */
  store(query: string, intent: QueryIntent): void {
    const pattern = this.normalizeToPattern(query);
    this.cache.set(pattern, {
      template: { ...intent },
      storedAt: Date.now(),
      hitCount: 0,
    });
  }

  /**
   * Invalidate (remove) a cache entry for the given query's normalized pattern.
   * Called when a user correction indicates the cached result was wrong.
   *
   * @param query - The raw user query whose cache entry should be removed
   */
  invalidate(query: string): void {
    const pattern = this.normalizeToPattern(query);
    this.cache.delete(pattern);
  }

  /**
   * Get cache statistics for observability.
   */
  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.MAX_SIZE,
    };
  }

  /**
   * Normalize a query to a cache key pattern by replacing specific values
   * with placeholders.
   *
   * Examples:
   *   "AAPL revenue FY2024" → "{TICKER} revenue {PERIOD}"
   *   "Compare NVDA and MSFT gross margin Q4-2024" → "compare {TICKER} and {TICKER} gross margin {PERIOD}"
   *
   * The normalization is designed to be idempotent: normalizing an already-normalized
   * pattern produces the same pattern.
   */
  normalizeToPattern(query: string): string {
    let pattern = query.toLowerCase().trim();

    // Replace known ticker symbols (1-5 letter words that match known tickers)
    // We check against the known tickers set to avoid replacing common English words
    pattern = pattern.replace(/\b[a-z]{1,5}\b/g, (match) => {
      if (match === '{ticker}') return '{TICKER}'; // already a placeholder (lowercased)
      return this.isKnownTicker(match.toUpperCase()) ? '{TICKER}' : match;
    });

    // Replace fiscal periods: FY2024, Q4-2024, Q4 2024, 2024, Q1, Q2, Q3, Q4
    // Must run after ticker replacement to avoid conflicts
    pattern = pattern.replace(/\b(?:fy|q[1-4][-\s]?)?\d{4}\b/gi, '{PERIOD}');
    pattern = pattern.replace(/\b(?:q[1-4])\b/gi, '{PERIOD}');

    // Normalize the placeholder case (in case of mixed case input)
    pattern = pattern.replace(/\{ticker\}/gi, '{TICKER}');
    pattern = pattern.replace(/\{period\}/gi, '{PERIOD}');

    return pattern.trim();
  }

  /**
   * Substitute actual values from the current query into a cached QueryIntent template.
   *
   * The cached template has the original detection's ticker/period/metrics.
   * We replace those with the current query's extracted values so the returned
   * QueryIntent is accurate for the new query.
   */
  private substituteValues(
    cached: CachedIntent,
    fastPathResult: Partial<QueryIntent>,
    originalQuery: string,
  ): QueryIntent {
    const template = cached.template;

    // Build the substituted intent from the template
    const result: QueryIntent = {
      ...template,
      originalQuery, // Always use the current query
    };

    // Substitute ticker from the current query's fast-path extraction
    if (fastPathResult.ticker !== undefined) {
      result.ticker = fastPathResult.ticker;
    }

    // Substitute period from the current query's fast-path extraction
    if (fastPathResult.period !== undefined) {
      result.period = fastPathResult.period;
    }
    if (fastPathResult.periodType !== undefined) {
      result.periodType = fastPathResult.periodType;
    }
    if (fastPathResult.periodStart !== undefined) {
      result.periodStart = fastPathResult.periodStart;
    }
    if (fastPathResult.periodEnd !== undefined) {
      result.periodEnd = fastPathResult.periodEnd;
    }

    // Substitute metrics from the current query's fast-path extraction
    if (fastPathResult.metrics !== undefined && fastPathResult.metrics.length > 0) {
      result.metrics = fastPathResult.metrics;
    }

    return result;
  }
}
