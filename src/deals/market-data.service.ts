import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import yahooFinance from 'yahoo-finance2';

export interface StockQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  marketCap?: number;
  volume?: number;
  previousClose: number;
  dayHigh: number;
  dayLow: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  lastUpdated: Date;
}

export interface MarketNews {
  title: string;
  summary?: string;
  url?: string;
  publishedAt: Date;
  source?: string;
}

/**
 * Market Data Service
 * Fetches real-time stock prices and market data from Yahoo Finance
 */
@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);
  private readonly CACHE_DURATION = 60 * 1000; // 1 minute cache

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get real-time stock quote
   */
  async getStockQuote(ticker: string): Promise<StockQuote | null> {
    this.logger.log(`Fetching stock quote for ${ticker}`);

    try {
      // Check cache first
      const cached = await this.getCachedQuote(ticker);
      if (cached && this.isCacheValid(cached.fetchedAt)) {
        this.logger.log(`Using cached quote for ${ticker}`);
        return this.parseQuoteFromCache(cached);
      }

      // Fetch from Yahoo Finance
      const quote = await yahooFinance.quote(ticker);
      
      if (!quote) {
        this.logger.warn(`No quote data found for ${ticker}`);
        return null;
      }

      const stockQuote: StockQuote = {
        ticker: ticker.toUpperCase(),
        price: quote.regularMarketPrice || 0,
        change: quote.regularMarketChange || 0,
        changePercent: quote.regularMarketChangePercent || 0,
        marketCap: quote.marketCap,
        volume: quote.regularMarketVolume,
        previousClose: quote.regularMarketPreviousClose || 0,
        dayHigh: quote.regularMarketDayHigh || 0,
        dayLow: quote.regularMarketDayLow || 0,
        fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
        lastUpdated: new Date(),
      };

      // Cache the result
      await this.cacheQuote(ticker, stockQuote, quote);

      this.logger.log(`Fetched quote for ${ticker}: $${stockQuote.price}`);
      return stockQuote;

    } catch (error) {
      this.logger.error(`Failed to fetch quote for ${ticker}: ${error.message}`);
      
      // Try to return cached data even if expired
      const cached = await this.getCachedQuote(ticker);
      if (cached) {
        this.logger.log(`Using expired cache for ${ticker}`);
        return this.parseQuoteFromCache(cached);
      }
      
      return null;
    }
  }

  /**
   * Get market news for a ticker
   */
  async getMarketNews(ticker: string, limit: number = 10): Promise<MarketNews[]> {
    this.logger.log(`Fetching market news for ${ticker}`);

    try {
      // Check cache first
      const cached = await this.getCachedNews(ticker);
      if (cached && this.isCacheValid(cached.fetchedAt)) {
        return JSON.parse(cached.dataValue);
      }

      // Try Yahoo Finance first
      let news: MarketNews[] = [];
      
      try {
        const searchResult = await yahooFinance.search(ticker);
        const rawNews: any[] = searchResult?.news || [];

        news = rawNews.slice(0, limit).map((item: any) => ({
          title: item.title || 'No title',
          summary: item.summary,
          url: item.link || item.url,
          publishedAt: item.providerPublishTime 
            ? (typeof item.providerPublishTime === 'number' && item.providerPublishTime > 1000000000000 
               ? new Date(item.providerPublishTime) 
               : new Date(item.providerPublishTime * 1000))
            : new Date(),
          source: item.publisher,
        }));
      } catch (yahooError) {
        this.logger.warn(`Yahoo Finance news failed for ${ticker}: ${yahooError.message}`);
      }

      // If Yahoo failed or returned no results, try Finnhub as backup
      if (news.length === 0) {
        try {
          const finnhubKey = process.env.FINNHUB_API_KEY;
          if (finnhubKey) {
            const today = new Date();
            const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            const fromDate = weekAgo.toISOString().split('T')[0];
            const toDate = today.toISOString().split('T')[0];
            
            const response = await fetch(
              `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${fromDate}&to=${toDate}&token=${finnhubKey}`
            );
            
            if (response.ok) {
              const finnhubNews = await response.json();
              news = finnhubNews.slice(0, limit).map((item: any) => ({
                title: item.headline || 'No title',
                summary: item.summary,
                url: item.url,
                publishedAt: new Date(item.datetime * 1000),
                source: item.source,
                image: item.image,
                sentiment: item.sentiment,
              }));
              this.logger.log(`Fetched ${news.length} news items from Finnhub for ${ticker}`);
            }
          }
        } catch (finnhubError) {
          this.logger.warn(`Finnhub news failed for ${ticker}: ${finnhubError.message}`);
        }
      }

      // If still no news, generate placeholder
      if (news.length === 0) {
        news = this.generatePlaceholderNews(ticker);
      }

      // Cache the result
      if (news.length > 0) {
        await this.cacheNews(ticker, news);
      }

      this.logger.log(`Fetched ${news.length} news items for ${ticker}`);
      return news;

    } catch (error) {
      this.logger.error(`Failed to fetch news for ${ticker}: ${error.message}`);
      
      // Try to return cached data
      const cached = await this.getCachedNews(ticker);
      if (cached) {
        return JSON.parse(cached.dataValue);
      }
      
      return this.generatePlaceholderNews(ticker);
    }
  }

  /**
   * Generate placeholder news when APIs fail
   */
  private generatePlaceholderNews(ticker: string): MarketNews[] {
    return [
      {
        title: `${ticker} - Latest SEC Filing Analysis Available`,
        summary: `View the comprehensive analysis of ${ticker}'s latest SEC filings including 10-K, 10-Q, and 8-K reports.`,
        url: `/comprehensive-financial-analysis.html?ticker=${ticker}`,
        publishedAt: new Date(),
        source: 'FundLens Analysis',
      },
      {
        title: `${ticker} Financial Metrics Dashboard`,
        summary: `Access real-time financial metrics, ratios, and trend analysis for ${ticker}.`,
        url: `/comprehensive-financial-analysis.html?ticker=${ticker}`,
        publishedAt: new Date(),
        source: 'FundLens',
      },
    ];
  }

  /**
   * Get multiple stock quotes
   */
  async getMultipleQuotes(tickers: string[]): Promise<Record<string, StockQuote | null>> {
    this.logger.log(`Fetching quotes for ${tickers.length} tickers`);

    const quotes: Record<string, StockQuote | null> = {};
    
    // Fetch quotes in parallel
    const promises = tickers.map(async (ticker) => {
      const quote = await this.getStockQuote(ticker);
      quotes[ticker.toUpperCase()] = quote;
    });

    await Promise.all(promises);
    return quotes;
  }

  /**
   * Calculate market cap from price and shares outstanding
   */
  async calculateMarketCap(ticker: string): Promise<number | null> {
    try {
      const quote = await yahooFinance.quote(ticker);
      const price = quote?.regularMarketPrice;
      const shares = quote?.sharesOutstanding;
      
      if (price && shares) {
        return price * shares;
      }
      
      return quote?.marketCap || null;
    } catch (error) {
      this.logger.error(`Failed to calculate market cap for ${ticker}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get cached quote from database
   */
  private async getCachedQuote(ticker: string): Promise<any> {
    try {
      const cached = await this.prisma.$queryRaw`
        SELECT data_value as "dataValue", fetched_at as "fetchedAt"
        FROM market_data
        WHERE ticker = ${ticker.toUpperCase()} AND data_type = 'quote'
        ORDER BY fetched_at DESC
        LIMIT 1
      ` as any[];

      return cached[0] || null;
    } catch (error) {
      // Table might not exist yet
      return null;
    }
  }

  /**
   * Get cached news from database
   */
  private async getCachedNews(ticker: string): Promise<any> {
    try {
      const cached = await this.prisma.$queryRaw`
        SELECT data_value as "dataValue", fetched_at as "fetchedAt"
        FROM market_data
        WHERE ticker = ${ticker.toUpperCase()} AND data_type = 'news'
        ORDER BY fetched_at DESC
        LIMIT 1
      ` as any[];

      return cached[0] || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Cache quote data
   */
  private async cacheQuote(ticker: string, quote: StockQuote, rawData: any): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO market_data (ticker, data_type, data_value, expires_at)
        VALUES (${ticker.toUpperCase()}, 'quote', ${JSON.stringify({
          quote,
          raw: rawData
        })}::jsonb, ${new Date(Date.now() + this.CACHE_DURATION)})
        ON CONFLICT (ticker, data_type) 
        DO UPDATE SET 
          data_value = EXCLUDED.data_value,
          fetched_at = NOW(),
          expires_at = EXCLUDED.expires_at
      `;
    } catch (error) {
      this.logger.warn(`Failed to cache quote for ${ticker}: ${error.message}`);
    }
  }

  /**
   * Cache news data
   */
  private async cacheNews(ticker: string, news: MarketNews[]): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO market_data (ticker, data_type, data_value, expires_at)
        VALUES (${ticker.toUpperCase()}, 'news', ${JSON.stringify(news)}::jsonb, ${new Date(Date.now() + this.CACHE_DURATION * 5)})
        ON CONFLICT (ticker, data_type) 
        DO UPDATE SET 
          data_value = EXCLUDED.data_value,
          fetched_at = NOW(),
          expires_at = EXCLUDED.expires_at
      `;
    } catch (error) {
      this.logger.warn(`Failed to cache news for ${ticker}: ${error.message}`);
    }
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(fetchedAt: Date): boolean {
    const now = new Date();
    const cacheAge = now.getTime() - new Date(fetchedAt).getTime();
    return cacheAge < this.CACHE_DURATION;
  }

  /**
   * Parse quote from cached data
   */
  private parseQuoteFromCache(cached: any): StockQuote {
    const data = JSON.parse(cached.dataValue);
    return data.quote;
  }

  /**
   * Get market status (open/closed)
   */
  async getMarketStatus(): Promise<{
    isOpen: boolean;
    nextOpen?: Date;
    nextClose?: Date;
    timezone: string;
  }> {
    try {
      // Use a major index to determine market status
      const quote = await yahooFinance.quote('^GSPC'); // S&P 500
      
      const now = new Date();
      const marketTime = quote?.regularMarketTime ? new Date(Number(quote.regularMarketTime) * 1000) : now;
      
      // Simple market hours check (9:30 AM - 4:00 PM ET on weekdays)
      const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
      const hour = now.getHours();
      const isMarketHours = hour >= 9 && hour < 16; // Simplified
      
      return {
        isOpen: isWeekday && isMarketHours,
        timezone: 'America/New_York',
      };
    } catch (error) {
      this.logger.error(`Failed to get market status: ${error.message}`);
      return {
        isOpen: false,
        timezone: 'America/New_York',
      };
    }
  }
}