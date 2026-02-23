import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * CompanyTickerMapService — Dynamically loaded company-to-ticker mapping.
 *
 * Replaces the hardcoded `companyMap` object in extractTickersFromQuery().
 * Loads from two sources:
 *   1. Tenant tracked tickers — from the data_sources table metadata
 *   2. Base reference list — ~100 major public companies with common name variants
 *
 * Auto-refreshes every hour. Falls back to base reference list if DB is unavailable.
 *
 * Requirements: 10.2, 10.4, 11.4
 */
@Injectable()
export class CompanyTickerMapService implements OnModuleInit {
  private readonly logger = new Logger(CompanyTickerMapService.name);
  private companyMap: Map<string, string> = new Map();
  private lastRefresh: number = 0;
  private readonly REFRESH_INTERVAL_MS = 3600000; // 1 hour
  private refreshing: boolean = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  /**
   * Resolve a single company name to its ticker symbol.
   * Triggers a background refresh if the cache is stale.
   */
  resolve(companyName: string): string | undefined {
    this.checkRefresh();
    return this.companyMap.get(companyName.toLowerCase().trim());
  }

  /**
   * Find all ticker symbols mentioned in a query string (by company name).
   * Scans the query for all known company name variants.
   * Triggers a background refresh if the cache is stale.
   */
  resolveAll(query: string): string[] {
    this.checkRefresh();
    const normalizedQuery = query.toLowerCase();
    const found: Set<string> = new Set();

    for (const [name, ticker] of this.companyMap) {
      // Skip single-character names — they cause false positives via substring matching
      // (e.g. 'c' matching inside 'across', 'v' inside 'revenues')
      if (name.length <= 1) continue;

      // Use word boundary matching for short names (2-4 chars) to avoid false positives
      if (name.length <= 4) {
        const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (pattern.test(normalizedQuery)) {
          found.add(ticker);
        }
      } else {
        // Longer names (5+ chars) are safe for substring matching
        if (normalizedQuery.includes(name)) {
          found.add(ticker);
        }
      }
    }

    return [...found];
  }

  /**
   * Get all known ticker symbols as a Set.
   * Used by FastPathCache.setKnownTickers().
   */
  getAllTickers(): Set<string> {
    const tickers = new Set<string>();
    for (const ticker of this.companyMap.values()) {
      tickers.add(ticker);
    }
    return tickers;
  }

  /**
   * Get the current size of the company map.
   */
  getMapSize(): number {
    return this.companyMap.size;
  }

  /**
   * Force a refresh of the company-to-ticker mapping.
   */
  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;

    try {
      const baseList = this.loadBaseReferenceList();
      let tenantTickers: Map<string, string>;

      try {
        tenantTickers = await this.loadTenantTickers();
      } catch (error) {
        this.logger.warn(
          `Failed to load tenant tickers from database, using base reference list only: ${error.message}`,
        );
        tenantTickers = new Map();
      }

      // Tenant tickers override base list entries (spread order matters)
      this.companyMap = new Map([...baseList, ...tenantTickers]);
      this.lastRefresh = Date.now();

      this.logger.log(
        `Company ticker map refreshed: ${this.companyMap.size} entries (${baseList.size} base + ${tenantTickers.size} tenant)`,
      );
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Check if a refresh is needed and trigger one in the background.
   */
  private checkRefresh(): void {
    if (Date.now() - this.lastRefresh > this.REFRESH_INTERVAL_MS) {
      // Fire-and-forget background refresh
      this.refresh().catch((err) =>
        this.logger.error(`Background refresh failed: ${err.message}`),
      );
    }
  }

  /**
   * Load tracked tickers from the data_sources table.
   * Extracts ticker symbols from the metadata JSON field of SEC filing data sources.
   */
  private async loadTenantTickers(): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    const dataSources = await this.prisma.dataSource.findMany({
      where: { type: 'sec_filing' },
      select: { sourceId: true, metadata: true },
      distinct: ['sourceId'],
    });

    for (const ds of dataSources) {
      const metadata = ds.metadata as any;
      const ticker = metadata?.ticker;
      const companyName = metadata?.companyName || metadata?.company_name;

      if (ticker && typeof ticker === 'string') {
        const upperTicker = ticker.toUpperCase();
        // Add the ticker itself as a key (lowercase)
        map.set(upperTicker.toLowerCase(), upperTicker);

        // Add company name variant if available
        if (companyName && typeof companyName === 'string') {
          map.set(companyName.toLowerCase().trim(), upperTicker);
        }
      }
    }

    // Also extract unique tickers from sourceId patterns like "AAPL-10-K-..."
    const tickerSet = new Set<string>();
    for (const ds of dataSources) {
      const match = ds.sourceId.match(/^([A-Z]{1,5})-/);
      if (match) {
        tickerSet.add(match[1]);
      }
    }

    for (const ticker of tickerSet) {
      if (!map.has(ticker.toLowerCase())) {
        map.set(ticker.toLowerCase(), ticker);
      }
    }

    return map;
  }

  /**
   * Base reference list of ~100 major public companies with common name variants.
   * This is hardcoded for now; will be loaded from S3 in the future.
   */
  private loadBaseReferenceList(): Map<string, string> {
    const map = new Map<string, string>();

    const entries: Array<{ ticker: string; names: string[] }> = [
      // Technology - Mega Cap
      { ticker: 'AAPL', names: ['apple', 'apple inc', 'apple inc.'] },
      { ticker: 'MSFT', names: ['microsoft', 'microsoft corp', 'microsoft corporation'] },
      { ticker: 'AMZN', names: ['amazon', 'amazon.com', 'amazon inc', 'amazon.com inc'] },
      { ticker: 'GOOGL', names: ['alphabet', 'alphabet inc', 'google', 'alphabet class a'] },
      { ticker: 'GOOG', names: ['alphabet class c'] },
      { ticker: 'META', names: ['meta', 'meta platforms', 'meta platforms inc', 'facebook'] },
      { ticker: 'TSLA', names: ['tesla', 'tesla inc', 'tesla motors'] },
      { ticker: 'NVDA', names: ['nvidia', 'nvidia corp', 'nvidia corporation'] },
      { ticker: 'AVGO', names: ['broadcom', 'broadcom inc'] },
      { ticker: 'ORCL', names: ['oracle', 'oracle corp', 'oracle corporation'] },

      // Technology - Large Cap
      { ticker: 'ADBE', names: ['adobe', 'adobe inc', 'adobe systems'] },
      { ticker: 'CRM', names: ['salesforce', 'salesforce inc'] },
      { ticker: 'CSCO', names: ['cisco', 'cisco systems', 'cisco systems inc'] },
      { ticker: 'INTC', names: ['intel', 'intel corp', 'intel corporation'] },
      { ticker: 'AMD', names: ['amd', 'advanced micro devices'] },
      { ticker: 'QCOM', names: ['qualcomm', 'qualcomm inc'] },
      { ticker: 'TXN', names: ['texas instruments', 'texas instruments inc'] },
      { ticker: 'IBM', names: ['ibm', 'international business machines'] },
      { ticker: 'NFLX', names: ['netflix', 'netflix inc'] },
      { ticker: 'PYPL', names: ['paypal', 'paypal holdings'] },
      { ticker: 'NOW', names: ['servicenow', 'servicenow inc'] },
      { ticker: 'INTU', names: ['intuit', 'intuit inc'] },
      { ticker: 'SHOP', names: ['shopify', 'shopify inc'] },
      { ticker: 'SQ', names: ['block', 'block inc', 'square'] },
      { ticker: 'SNOW', names: ['snowflake', 'snowflake inc'] },
      { ticker: 'PLTR', names: ['palantir', 'palantir technologies'] },
      { ticker: 'UBER', names: ['uber', 'uber technologies'] },
      { ticker: 'ABNB', names: ['airbnb', 'airbnb inc'] },

      // Financial Services
      { ticker: 'JPM', names: ['jpmorgan', 'jp morgan', 'jpmorgan chase', 'j.p. morgan'] },
      { ticker: 'BAC', names: ['bank of america', 'bofa', 'bank of america corp'] },
      { ticker: 'WFC', names: ['wells fargo', 'wells fargo & co'] },
      { ticker: 'GS', names: ['goldman sachs', 'goldman sachs group'] },
      { ticker: 'MS', names: ['morgan stanley'] },
      { ticker: 'BLK', names: ['blackrock', 'blackrock inc'] },
      { ticker: 'SCHW', names: ['charles schwab', 'schwab'] },
      { ticker: 'AXP', names: ['american express', 'amex'] },
      { ticker: 'C', names: ['citigroup', 'citi', 'citigroup inc'] },
      { ticker: 'USB', names: ['us bancorp', 'u.s. bancorp'] },
      { ticker: 'V', names: ['visa', 'visa inc'] },
      { ticker: 'MA', names: ['mastercard', 'mastercard inc'] },
      { ticker: 'BRK.B', names: ['berkshire hathaway', 'berkshire'] },

      // Healthcare & Pharma
      { ticker: 'UNH', names: ['unitedhealth', 'unitedhealth group', 'united health'] },
      { ticker: 'JNJ', names: ['johnson & johnson', 'johnson and johnson', 'j&j'] },
      { ticker: 'PFE', names: ['pfizer', 'pfizer inc'] },
      { ticker: 'MRK', names: ['merck', 'merck & co', 'merck and co'] },
      { ticker: 'ABBV', names: ['abbvie', 'abbvie inc'] },
      { ticker: 'LLY', names: ['eli lilly', 'lilly', 'eli lilly and company'] },
      { ticker: 'TMO', names: ['thermo fisher', 'thermo fisher scientific'] },
      { ticker: 'DHR', names: ['danaher', 'danaher corp'] },
      { ticker: 'AMGN', names: ['amgen', 'amgen inc'] },
      { ticker: 'CVS', names: ['cvs health', 'cvs', 'cvs health corp'] },
      { ticker: 'BMY', names: ['bristol-myers squibb', 'bristol myers', 'bmy'] },
      { ticker: 'GILD', names: ['gilead', 'gilead sciences'] },

      // Consumer
      { ticker: 'WMT', names: ['walmart', 'wal-mart', 'walmart inc'] },
      { ticker: 'COST', names: ['costco', 'costco wholesale'] },
      { ticker: 'HD', names: ['home depot', 'the home depot'] },
      { ticker: 'LOW', names: ['lowes', "lowe's", 'lowes companies'] },
      { ticker: 'TGT', names: ['target', 'target corp'] },
      { ticker: 'NKE', names: ['nike', 'nike inc'] },
      { ticker: 'SBUX', names: ['starbucks', 'starbucks corp'] },
      { ticker: 'MCD', names: ['mcdonalds', "mcdonald's", 'mcdonald corp'] },
      { ticker: 'KO', names: ['coca-cola', 'coca cola', 'the coca-cola company', 'coke'] },
      { ticker: 'PEP', names: ['pepsico', 'pepsi', 'pepsico inc'] },
      { ticker: 'PG', names: ['procter & gamble', 'procter and gamble', 'p&g'] },
      { ticker: 'DIS', names: ['disney', 'walt disney', 'the walt disney company'] },
      { ticker: 'CMCSA', names: ['comcast', 'comcast corp'] },

      // Industrial & Conglomerate
      { ticker: 'GE', names: ['ge', 'general electric', 'ge aerospace'] },
      { ticker: 'HON', names: ['honeywell', 'honeywell international'] },
      { ticker: 'CAT', names: ['caterpillar', 'caterpillar inc'] },
      { ticker: 'BA', names: ['boeing', 'the boeing company'] },
      { ticker: 'MMM', names: ['3m', '3m company'] },
      { ticker: 'RTX', names: ['rtx', 'raytheon', 'raytheon technologies'] },
      { ticker: 'LMT', names: ['lockheed martin', 'lockheed'] },
      { ticker: 'UPS', names: ['ups', 'united parcel service'] },
      { ticker: 'DE', names: ['deere', 'john deere', 'deere & company'] },
      { ticker: 'ACN', names: ['accenture', 'accenture plc'] },

      // Energy
      { ticker: 'XOM', names: ['exxon', 'exxon mobil', 'exxonmobil'] },
      { ticker: 'CVX', names: ['chevron', 'chevron corp'] },
      { ticker: 'COP', names: ['conocophillips', 'conoco phillips'] },
      { ticker: 'SLB', names: ['schlumberger'] },
      { ticker: 'EOG', names: ['eog resources'] },

      // Telecom & Media
      { ticker: 'T', names: ['at&t', 'att'] },
      { ticker: 'VZ', names: ['verizon', 'verizon communications'] },
      { ticker: 'TMUS', names: ['t-mobile', 'tmobile', 't-mobile us'] },

      // Real Estate & Utilities
      { ticker: 'AMT', names: ['american tower', 'american tower corp'] },
      { ticker: 'PLD', names: ['prologis', 'prologis inc'] },
      { ticker: 'NEE', names: ['nextera energy', 'nextera'] },
      { ticker: 'DUK', names: ['duke energy', 'duke energy corp'] },

      // Semiconductors (additional)
      { ticker: 'MU', names: ['micron', 'micron technology'] },
      { ticker: 'LRCX', names: ['lam research'] },
      { ticker: 'AMAT', names: ['applied materials'] },
      { ticker: 'KLAC', names: ['kla', 'kla corp'] },
      { ticker: 'MRVL', names: ['marvell', 'marvell technology'] },
      { ticker: 'ARM', names: ['arm', 'arm holdings'] },
      { ticker: 'TSM', names: ['tsmc', 'taiwan semiconductor'] },

      // Automotive
      { ticker: 'F', names: ['ford', 'ford motor', 'ford motor company'] },
      { ticker: 'GM', names: ['general motors', 'gm'] },
      { ticker: 'RIVN', names: ['rivian', 'rivian automotive'] },

      // Other notable
      { ticker: 'RH', names: ['rh', 'restoration hardware'] },
      { ticker: 'COIN', names: ['coinbase', 'coinbase global'] },
      { ticker: 'CRWD', names: ['crowdstrike', 'crowdstrike holdings'] },
      { ticker: 'ZS', names: ['zscaler', 'zscaler inc'] },
      { ticker: 'PANW', names: ['palo alto networks', 'palo alto'] },
      { ticker: 'DDOG', names: ['datadog', 'datadog inc'] },
    ];

    for (const entry of entries) {
      for (const name of entry.names) {
        map.set(name.toLowerCase(), entry.ticker);
      }
      // Also add the ticker itself as a key
      map.set(entry.ticker.toLowerCase(), entry.ticker);
    }

    return map;
  }
}
