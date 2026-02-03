import { Controller, Post, Param, Body, Logger } from '@nestjs/common';
import { SimpleSyncService, SimpleSyncResult } from './simple-sync.service';

/**
 * Simple Controller
 * 
 * Clean API endpoints for the new simple sync and processing system
 */
@Controller('simple')
export class SimpleController {
  private readonly logger = new Logger(SimpleController.name);

  constructor(private readonly syncService: SimpleSyncService) {}

  /**
   * Sync and process a single ticker
   */
  @Post('sync/:ticker')
  async syncTicker(
    @Param('ticker') ticker: string,
    @Body() body?: {
      filingTypes?: string[];
      years?: number[];
      limit?: number;
    },
  ): Promise<{
    success: boolean;
    result: SimpleSyncResult;
    message: string;
  }> {
    try {
      this.logger.log(`Starting simple sync for ticker: ${ticker}`);
      
      const result = await this.syncService.syncAndProcessTicker(ticker, body || {});
      
      const success = result.errors.length === 0;
      const message = success 
        ? `${ticker}: ${result.processed} filings processed successfully`
        : `${ticker}: ${result.processed} processed, ${result.errors.length} errors`;

      return {
        success,
        result,
        message,
      };

    } catch (error) {
      this.logger.error(`Error syncing ${ticker}: ${error.message}`);
      return {
        success: false,
        result: {
          ticker,
          filingType: 'ALL',
          totalAvailable: 0,
          newDownloads: 0,
          skipped: 0,
          processed: 0,
          errors: [error.message],
          processingResults: [],
        },
        message: `Failed to sync ${ticker}: ${error.message}`,
      };
    }
  }

  /**
   * Sync and process multiple tickers
   */
  @Post('sync-batch')
  async syncBatch(
    @Body() body: {
      tickers: string[];
      filingTypes?: string[];
      years?: number[];
      limit?: number;
      batchSize?: number;
    },
  ): Promise<{
    success: boolean;
    results: SimpleSyncResult[];
    summary: {
      totalTickers: number;
      successfulTickers: number;
      totalProcessed: number;
      totalErrors: number;
    };
    message: string;
  }> {
    try {
      this.logger.log(`Starting batch sync for ${body.tickers.length} tickers`);
      
      const results = await this.syncService.syncMultipleTickers(body.tickers, body);
      
      const summary = {
        totalTickers: results.length,
        successfulTickers: results.filter(r => r.errors.length === 0).length,
        totalProcessed: results.reduce((sum, r) => sum + r.processed, 0),
        totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
      };

      const success = summary.totalErrors === 0;
      const message = `Batch sync complete: ${summary.totalProcessed} filings processed, ${summary.totalErrors} errors`;

      return {
        success,
        results,
        summary,
        message,
      };

    } catch (error) {
      this.logger.error(`Error in batch sync: ${error.message}`);
      return {
        success: false,
        results: [],
        summary: {
          totalTickers: 0,
          successfulTickers: 0,
          totalProcessed: 0,
          totalErrors: 1,
        },
        message: `Batch sync failed: ${error.message}`,
      };
    }
  }

  /**
   * Full dataset scaling endpoint
   */
  @Post('scale-full-dataset')
  async scaleFullDataset(
    @Body() body?: {
      companies?: string[];
      years?: number[];
      filingTypes?: string[];
      batchSize?: number;
    },
  ): Promise<{
    success: boolean;
    results: SimpleSyncResult[];
    summary: {
      totalCompanies: number;
      successfulCompanies: number;
      totalFilings: number;
      totalMetrics: number;
      totalNarratives: number;
      processingTime: number;
    };
    message: string;
  }> {
    const startTime = Date.now();

    try {
      // Default configuration for full dataset scaling
      const companies = body?.companies || [
        'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 
        'META', 'NVDA', 'JPM', 'BAC', 'WMT'
      ];
      
      const years = body?.years || [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
      const filingTypes = body?.filingTypes || ['10-K', '10-Q'];
      const batchSize = body?.batchSize || 3;

      this.logger.log(`🚀 Starting full dataset scaling:`);
      this.logger.log(`   Companies: ${companies.join(', ')}`);
      this.logger.log(`   Years: ${years.join(', ')}`);
      this.logger.log(`   Filing Types: ${filingTypes.join(', ')}`);

      const results = await this.syncService.syncMultipleTickers(companies, {
        filingTypes,
        years,
        batchSize,
        limit: 100, // Generous limit for historical data
      });

      const summary = {
        totalCompanies: results.length,
        successfulCompanies: results.filter(r => r.errors.length === 0).length,
        totalFilings: results.reduce((sum, r) => sum + r.processed, 0),
        totalMetrics: results.reduce((sum, r) => 
          sum + r.processingResults.reduce((mSum, pr) => mSum + pr.metricsExtracted, 0), 0
        ),
        totalNarratives: results.reduce((sum, r) => 
          sum + r.processingResults.reduce((nSum, pr) => nSum + pr.narrativesExtracted, 0), 0
        ),
        processingTime: Date.now() - startTime,
      };

      const success = summary.totalFilings > 0 && summary.successfulCompanies > 0;
      const message = success
        ? `Full dataset scaling complete: ${summary.totalFilings} filings, ${summary.totalMetrics} metrics, ${summary.totalNarratives} narratives`
        : `Full dataset scaling had issues: check individual company results`;

      this.logger.log(`🎉 Full dataset scaling summary:`);
      this.logger.log(`   Successful companies: ${summary.successfulCompanies}/${summary.totalCompanies}`);
      this.logger.log(`   Total filings processed: ${summary.totalFilings}`);
      this.logger.log(`   Total metrics extracted: ${summary.totalMetrics}`);
      this.logger.log(`   Total narratives extracted: ${summary.totalNarratives}`);
      this.logger.log(`   Processing time: ${(summary.processingTime / 60000).toFixed(1)} minutes`);

      return {
        success,
        results,
        summary,
        message,
      };

    } catch (error) {
      this.logger.error(`❌ Full dataset scaling failed: ${error.message}`);
      return {
        success: false,
        results: [],
        summary: {
          totalCompanies: 0,
          successfulCompanies: 0,
          totalFilings: 0,
          totalMetrics: 0,
          totalNarratives: 0,
          processingTime: Date.now() - startTime,
        },
        message: `Full dataset scaling failed: ${error.message}`,
      };
    }
  }
}