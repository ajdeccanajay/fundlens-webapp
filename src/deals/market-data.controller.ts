import { Controller, Get, Param, Query, Logger } from '@nestjs/common';
import { MarketDataService } from './market-data.service';

/**
 * Market Data Controller
 * Provides real-time stock prices and market data
 */
@Controller('market-data')
export class MarketDataController {
  private readonly logger = new Logger(MarketDataController.name);

  constructor(private readonly marketDataService: MarketDataService) {}

  /**
   * Get stock quote
   * GET /api/market-data/quote/:ticker
   */
  @Get('quote/:ticker')
  async getStockQuote(@Param('ticker') ticker: string) {
    this.logger.log(`Getting quote for ${ticker}`);

    try {
      const quote = await this.marketDataService.getStockQuote(ticker);

      if (!quote) {
        return {
          success: false,
          message: `No quote data found for ${ticker}`,
        };
      }

      return {
        success: true,
        data: quote,
        message: `Quote retrieved for ${ticker}`,
      };
    } catch (error) {
      this.logger.error(`Failed to get quote for ${ticker}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to get quote for ${ticker}`,
      };
    }
  }

  /**
   * Get multiple stock quotes
   * GET /api/market-data/quotes?tickers=AAPL,MSFT,GOOGL
   */
  @Get('quotes')
  async getMultipleQuotes(@Query('tickers') tickersParam: string) {
    if (!tickersParam) {
      return {
        success: false,
        message: 'Tickers parameter is required',
      };
    }

    const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase());
    this.logger.log(`Getting quotes for ${tickers.length} tickers`);

    try {
      const quotes = await this.marketDataService.getMultipleQuotes(tickers);

      return {
        success: true,
        data: quotes,
        message: `Retrieved quotes for ${tickers.length} tickers`,
      };
    } catch (error) {
      this.logger.error(`Failed to get multiple quotes: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to get multiple quotes',
      };
    }
  }

  /**
   * Get market news for a ticker
   * GET /api/market-data/news/:ticker
   */
  @Get('news/:ticker')
  async getMarketNews(
    @Param('ticker') ticker: string,
    @Query('limit') limit?: string,
  ) {
    const newsLimit = limit ? parseInt(limit) : 10;
    this.logger.log(`Getting news for ${ticker}, limit: ${newsLimit}`);

    try {
      const news = await this.marketDataService.getMarketNews(ticker, newsLimit);

      return {
        success: true,
        data: news,
        message: `Retrieved ${news.length} news items for ${ticker}`,
      };
    } catch (error) {
      this.logger.error(`Failed to get news for ${ticker}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to get news for ${ticker}`,
      };
    }
  }

  /**
   * Get market status
   * GET /api/market-data/status
   */
  @Get('status')
  async getMarketStatus() {
    try {
      const status = await this.marketDataService.getMarketStatus();

      return {
        success: true,
        data: status,
        message: 'Market status retrieved',
      };
    } catch (error) {
      this.logger.error(`Failed to get market status: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to get market status',
      };
    }
  }

  /**
   * Calculate market cap
   * GET /api/market-data/market-cap/:ticker
   */
  @Get('market-cap/:ticker')
  async getMarketCap(@Param('ticker') ticker: string) {
    this.logger.log(`Calculating market cap for ${ticker}`);

    try {
      const marketCap = await this.marketDataService.calculateMarketCap(ticker);

      if (marketCap === null) {
        return {
          success: false,
          message: `Could not calculate market cap for ${ticker}`,
        };
      }

      return {
        success: true,
        data: {
          ticker: ticker.toUpperCase(),
          marketCap,
          marketCapFormatted: this.formatMarketCap(marketCap),
        },
        message: `Market cap calculated for ${ticker}`,
      };
    } catch (error) {
      this.logger.error(`Failed to calculate market cap for ${ticker}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to calculate market cap for ${ticker}`,
      };
    }
  }

  /**
   * Format market cap for display
   */
  private formatMarketCap(marketCap: number): string {
    if (marketCap >= 1e12) {
      return `$${(marketCap / 1e12).toFixed(2)}T`;
    } else if (marketCap >= 1e9) {
      return `$${(marketCap / 1e9).toFixed(2)}B`;
    } else if (marketCap >= 1e6) {
      return `$${(marketCap / 1e6).toFixed(2)}M`;
    } else {
      return `$${marketCap.toLocaleString()}`;
    }
  }
}