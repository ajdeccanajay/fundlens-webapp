/**
 * IntentValidatorService — Deterministic validation and enrichment layer.
 *
 * Takes raw QueryIntentObject from Haiku, validates entities against
 * known tickers, resolves metrics via MetricRegistryService, maps
 * time periods to the existing PeriodType system, and returns a
 * ValidatedQueryIntent.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 14.1, 14.2
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricRegistryService } from './metric-resolution/metric-registry.service';
import { MetricResolution } from './metric-resolution/types';
import {
  QueryIntentObject,
  QueryIntentMetric,
  QueryIntentTimePeriod,
  QIOQueryType,
} from './types/query-intent-object';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface ValidatedEntity {
  ticker: string;
  company: string;
  confidence: number;
  validated: boolean;
  source: 'exact_match' | 'fuzzy_match';
}

export interface MappedTimePeriod {
  periodType: string; // LATEST_BOTH, SPECIFIC_YEAR, SPECIFIC_QUARTER, RANGE, TTM, YTD
  specificPeriod: string | null;
  rangeValue?: number | null;
  rangeUnit?: string | null;
}

export interface ValidatedQueryIntent {
  tickers: string[];
  entities: ValidatedEntity[];
  metrics: MetricResolution[];
  rawMetrics: QueryIntentMetric[];
  timePeriod: MappedTimePeriod;
  queryType: QIOQueryType;
  needsNarrative: boolean;
  needsPeerComparison: boolean;
  needsComputation: boolean;
  originalQuery: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class IntentValidatorService implements OnModuleInit {
  private readonly logger = new Logger(IntentValidatorService.name);

  /**
   * Map of uppercase ticker → company name.
   * Used for exact ticker validation and as the source for fuzzy company name matching.
   */
  private knownTickers: Map<string, string> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricRegistry: MetricRegistryService,
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle — load ticker data on init, refresh daily at 02:00
  // -------------------------------------------------------------------------

  async onModuleInit(): Promise<void> {
    await this.refreshTickerData();
  }

  @Cron('0 2 * * *')
  async refreshTickerData(): Promise<void> {
    try {
      const tickerMap = new Map<string, string>();

      // Load base reference list (hardcoded well-known companies)
      const baseEntries = this.loadBaseReferenceList();
      for (const [ticker, companyName] of baseEntries) {
        tickerMap.set(ticker, companyName);
      }

      // Enrich from database — distinct tickers from financial_metrics
      if (this.prisma) {
        try {
          const rows = await this.prisma.financialMetric.findMany({
            select: { ticker: true },
            distinct: ['ticker'],
          });
          for (const row of rows) {
            if (row.ticker) {
              const upper = row.ticker.toUpperCase();
              if (!tickerMap.has(upper)) {
                tickerMap.set(upper, upper); // company name unknown, use ticker as placeholder
              }
            }
          }
        } catch (dbError) {
          this.logger.warn(`Failed to load tickers from DB: ${dbError?.message}`);
        }
      }

      this.knownTickers = tickerMap;
      this.logger.log(`Ticker data refreshed: ${this.knownTickers.size} known tickers`);
    } catch (error) {
      this.logger.error(`Failed to refresh ticker data: ${error?.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Core validation
  // -------------------------------------------------------------------------

  async validate(qio: QueryIntentObject): Promise<ValidatedQueryIntent> {
    // 1. Validate entities
    const validatedEntities = this.validateEntities(qio.entities);

    // 2. Deduplicate by ticker, keeping highest confidence
    const deduped = this.deduplicateEntities(validatedEntities);

    // 3. Resolve metrics via MetricRegistryService
    const resolvedMetrics = this.resolveMetrics(qio.metrics);

    // 4. Correct needs_computation if any resolved metric has type='computed'
    let needsComputation = qio.needs_computation;
    if (resolvedMetrics.some((m) => m.type === 'computed')) {
      needsComputation = true;
    }

    // 5. Map time period
    const timePeriod = this.mapTimePeriod(qio.time_period);

    return {
      tickers: deduped.map((e) => e.ticker),
      entities: deduped,
      metrics: resolvedMetrics,
      rawMetrics: qio.metrics,
      timePeriod,
      queryType: qio.query_type,
      needsNarrative: qio.needs_narrative,
      needsPeerComparison: qio.needs_peer_comparison,
      needsComputation,
      originalQuery: qio.original_query,
    };
  }

  // -------------------------------------------------------------------------
  // Entity validation
  // -------------------------------------------------------------------------

  private validateEntities(
    entities: QueryIntentObject['entities'],
  ): ValidatedEntity[] {
    const validated: ValidatedEntity[] = [];

    for (const entity of entities) {
      const upperTicker = entity.ticker.toUpperCase();

      // Exact match: ticker exists in knownTickers
      if (this.knownTickers.has(upperTicker)) {
        validated.push({
          ticker: upperTicker,
          company: entity.company || this.knownTickers.get(upperTicker) || '',
          confidence: entity.confidence,
          validated: true,
          source: 'exact_match',
        });
        continue;
      }

      // Fuzzy match: case-insensitive substring of entity company name against known company names
      const fuzzyResult = this.fuzzyMatchByCompanyName(entity.company);
      if (fuzzyResult) {
        const reducedConfidence = entity.confidence * 0.8;
        validated.push({
          ticker: fuzzyResult.ticker,
          company: entity.company || fuzzyResult.companyName,
          confidence: reducedConfidence,
          validated: true,
          source: 'fuzzy_match',
        });

        // Req 14.2: log warning for low confidence
        if (reducedConfidence < 0.5) {
          this.logger.warn(
            `[TICKER_LOW_CONFIDENCE] ticker="${fuzzyResult.ticker}" company="${entity.company}" confidence=${reducedConfidence.toFixed(2)} query="${entity.company}"`,
          );
        }
        continue;
      }

      // No match — exclude entity, log ticker miss (Req 6.5, 11.3)
      this.logger.warn(
        `[TICKER_MISS] ticker="${entity.ticker}" company="${entity.company}" — not found in known tickers`,
      );
    }

    return validated;
  }

  /**
   * Fuzzy match: case-insensitive substring match of the entity's company name
   * against company names in the known tickers map.
   */
  private fuzzyMatchByCompanyName(
    companyName: string,
  ): { ticker: string; companyName: string } | null {
    if (!companyName) return null;

    const lowerInput = companyName.toLowerCase().trim();
    if (!lowerInput) return null;

    for (const [ticker, knownCompany] of this.knownTickers) {
      const lowerKnown = knownCompany.toLowerCase();
      // Substring match in either direction
      if (lowerKnown.includes(lowerInput) || lowerInput.includes(lowerKnown)) {
        return { ticker, companyName: knownCompany };
      }
    }

    return null;
  }

  /**
   * Deduplicate entities by ticker, keeping the entry with the highest confidence.
   */
  private deduplicateEntities(entities: ValidatedEntity[]): ValidatedEntity[] {
    const byTicker = new Map<string, ValidatedEntity>();

    for (const entity of entities) {
      const existing = byTicker.get(entity.ticker);
      if (!existing || entity.confidence > existing.confidence) {
        byTicker.set(entity.ticker, entity);
      }
    }

    return Array.from(byTicker.values());
  }

  // -------------------------------------------------------------------------
  // Metric resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve each metric via MetricRegistryService.
   * Tries canonical_guess first, then raw_name as fallback.
   */
  private resolveMetrics(metrics: QueryIntentMetric[]): MetricResolution[] {
    return metrics.map((metric) => {
      // Try canonical_guess first
      const canonicalResult = this.metricRegistry.resolve(metric.canonical_guess);
      if (canonicalResult.confidence !== 'unresolved') {
        return canonicalResult;
      }

      // Fallback to raw_name
      const rawResult = this.metricRegistry.resolve(metric.raw_name);
      return rawResult;
    });
  }

  // -------------------------------------------------------------------------
  // Time period mapping
  // -------------------------------------------------------------------------

  mapTimePeriod(tp: QueryIntentTimePeriod): MappedTimePeriod {
    switch (tp.type) {
      case 'latest':
        return { periodType: 'LATEST_BOTH', specificPeriod: null };

      case 'specific_year':
        return {
          periodType: 'SPECIFIC_YEAR',
          specificPeriod: tp.value != null ? String(tp.value) : null,
        };

      case 'specific_quarter':
        return {
          periodType: 'SPECIFIC_QUARTER',
          specificPeriod: tp.raw_text || (tp.value != null ? String(tp.value) : null),
        };

      case 'range':
        return {
          periodType: 'RANGE',
          specificPeriod: null,
          rangeValue: tp.value,
          rangeUnit: tp.unit,
        };

      case 'ttm':
        return { periodType: 'TTM', specificPeriod: null };

      case 'ytd':
        return { periodType: 'YTD', specificPeriod: null };

      default:
        return { periodType: 'LATEST_BOTH', specificPeriod: null };
    }
  }

  // -------------------------------------------------------------------------
  // Base reference list — mirrors CompanyTickerMapService for consistency
  // -------------------------------------------------------------------------

  private loadBaseReferenceList(): Map<string, string> {
    const map = new Map<string, string>();

    const entries: Array<{ ticker: string; company: string }> = [
      // Technology - Mega Cap
      { ticker: 'AAPL', company: 'Apple' },
      { ticker: 'MSFT', company: 'Microsoft' },
      { ticker: 'AMZN', company: 'Amazon' },
      { ticker: 'GOOGL', company: 'Alphabet' },
      { ticker: 'META', company: 'Meta Platforms' },
      { ticker: 'TSLA', company: 'Tesla' },
      { ticker: 'NVDA', company: 'Nvidia' },
      { ticker: 'AVGO', company: 'Broadcom' },
      { ticker: 'ORCL', company: 'Oracle' },
      // Technology - Large Cap
      { ticker: 'ADBE', company: 'Adobe' },
      { ticker: 'CRM', company: 'Salesforce' },
      { ticker: 'CSCO', company: 'Cisco Systems' },
      { ticker: 'INTC', company: 'Intel' },
      { ticker: 'AMD', company: 'Advanced Micro Devices' },
      { ticker: 'QCOM', company: 'Qualcomm' },
      { ticker: 'TXN', company: 'Texas Instruments' },
      { ticker: 'IBM', company: 'IBM' },
      { ticker: 'NFLX', company: 'Netflix' },
      { ticker: 'PYPL', company: 'PayPal' },
      { ticker: 'NOW', company: 'ServiceNow' },
      { ticker: 'INTU', company: 'Intuit' },
      { ticker: 'SHOP', company: 'Shopify' },
      { ticker: 'SQ', company: 'Block' },
      { ticker: 'SNOW', company: 'Snowflake' },
      { ticker: 'PLTR', company: 'Palantir' },
      { ticker: 'UBER', company: 'Uber' },
      { ticker: 'ABNB', company: 'Airbnb' },
      // Financial Services
      { ticker: 'JPM', company: 'JPMorgan Chase' },
      { ticker: 'BAC', company: 'Bank of America' },
      { ticker: 'WFC', company: 'Wells Fargo' },
      { ticker: 'GS', company: 'Goldman Sachs' },
      { ticker: 'MS', company: 'Morgan Stanley' },
      { ticker: 'BLK', company: 'BlackRock' },
      { ticker: 'SCHW', company: 'Charles Schwab' },
      { ticker: 'AXP', company: 'American Express' },
      { ticker: 'C', company: 'Citigroup' },
      { ticker: 'USB', company: 'US Bancorp' },
      { ticker: 'V', company: 'Visa' },
      { ticker: 'MA', company: 'Mastercard' },
      // Healthcare & Pharma
      { ticker: 'UNH', company: 'UnitedHealth Group' },
      { ticker: 'JNJ', company: 'Johnson & Johnson' },
      { ticker: 'PFE', company: 'Pfizer' },
      { ticker: 'MRK', company: 'Merck' },
      { ticker: 'ABBV', company: 'AbbVie' },
      { ticker: 'LLY', company: 'Eli Lilly' },
      { ticker: 'TMO', company: 'Thermo Fisher Scientific' },
      { ticker: 'DHR', company: 'Danaher' },
      { ticker: 'AMGN', company: 'Amgen' },
      { ticker: 'CVS', company: 'CVS Health' },
      { ticker: 'BMY', company: 'Bristol-Myers Squibb' },
      { ticker: 'GILD', company: 'Gilead Sciences' },
      // Consumer
      { ticker: 'WMT', company: 'Walmart' },
      { ticker: 'COST', company: 'Costco' },
      { ticker: 'HD', company: 'Home Depot' },
      { ticker: 'LOW', company: "Lowe's" },
      { ticker: 'TGT', company: 'Target' },
      { ticker: 'NKE', company: 'Nike' },
      { ticker: 'SBUX', company: 'Starbucks' },
      { ticker: 'MCD', company: "McDonald's" },
      { ticker: 'KO', company: 'Coca-Cola' },
      { ticker: 'PEP', company: 'PepsiCo' },
      { ticker: 'PG', company: 'Procter & Gamble' },
      { ticker: 'DIS', company: 'Disney' },
      { ticker: 'CMCSA', company: 'Comcast' },
      // Industrial & Conglomerate
      { ticker: 'GE', company: 'General Electric' },
      { ticker: 'HON', company: 'Honeywell' },
      { ticker: 'CAT', company: 'Caterpillar' },
      { ticker: 'BA', company: 'Boeing' },
      { ticker: 'MMM', company: '3M' },
      { ticker: 'RTX', company: 'Raytheon Technologies' },
      { ticker: 'LMT', company: 'Lockheed Martin' },
      { ticker: 'UPS', company: 'United Parcel Service' },
      { ticker: 'DE', company: 'Deere & Company' },
      { ticker: 'ACN', company: 'Accenture' },
      // Energy
      { ticker: 'XOM', company: 'ExxonMobil' },
      { ticker: 'CVX', company: 'Chevron' },
      { ticker: 'COP', company: 'ConocoPhillips' },
      { ticker: 'SLB', company: 'Schlumberger' },
      { ticker: 'EOG', company: 'EOG Resources' },
      // Telecom & Media
      { ticker: 'T', company: 'AT&T' },
      { ticker: 'VZ', company: 'Verizon' },
      { ticker: 'TMUS', company: 'T-Mobile' },
      // Real Estate & Utilities
      { ticker: 'AMT', company: 'American Tower' },
      { ticker: 'PLD', company: 'Prologis' },
      { ticker: 'NEE', company: 'NextEra Energy' },
      { ticker: 'DUK', company: 'Duke Energy' },
      // Semiconductors
      { ticker: 'MU', company: 'Micron Technology' },
      { ticker: 'LRCX', company: 'Lam Research' },
      { ticker: 'AMAT', company: 'Applied Materials' },
      { ticker: 'KLAC', company: 'KLA Corp' },
      { ticker: 'MRVL', company: 'Marvell Technology' },
      { ticker: 'ARM', company: 'ARM Holdings' },
      { ticker: 'TSM', company: 'Taiwan Semiconductor' },
      // Automotive
      { ticker: 'F', company: 'Ford' },
      { ticker: 'GM', company: 'General Motors' },
      { ticker: 'RIVN', company: 'Rivian' },
      // Other notable
      { ticker: 'RH', company: 'Restoration Hardware' },
      { ticker: 'COIN', company: 'Coinbase' },
      { ticker: 'CRWD', company: 'CrowdStrike' },
      { ticker: 'ZS', company: 'Zscaler' },
      { ticker: 'PANW', company: 'Palo Alto Networks' },
      { ticker: 'DDOG', company: 'Datadog' },
    ];

    for (const entry of entries) {
      map.set(entry.ticker, entry.company);
    }

    return map;
  }

  // -------------------------------------------------------------------------
  // Accessors (for testing / fallback path)
  // -------------------------------------------------------------------------

  getKnownTickers(): Map<string, string> {
    return this.knownTickers;
  }
}
