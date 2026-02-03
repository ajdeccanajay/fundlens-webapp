import { Controller, Post, Get, Param, Body, Logger } from '@nestjs/common';
import { SECSyncService, SyncResult } from './sec-sync.service';
import { S3DataLakeService } from './s3-data-lake.service';
import { SECProcessingService, ProcessingResult } from './sec-processing.service';

@Controller('s3')
export class S3Controller {
  private readonly logger = new Logger(S3Controller.name);

  constructor(
    private readonly secSync: SECSyncService,
    private readonly s3DataLake: S3DataLakeService,
    private readonly secProcessing: SECProcessingService,
  ) {}

  /**
   * Sync SEC filings for a specific ticker
   */
  @Post('sync/:ticker')
  async syncTicker(
    @Param('ticker') ticker: string,
    @Body() body?: { filingTypes?: string[] },
  ): Promise<{
    success: boolean;
    ticker: string;
    results: SyncResult[];
    message: string;
  }> {
    try {
      this.logger.log(`Starting sync for ticker: ${ticker}`);
      
      const filingTypes = body?.filingTypes || ['10-K', '10-Q'];
      const results = await this.secSync.syncTicker(ticker, filingTypes);
      
      const totalNew = results.reduce((sum, r) => sum + r.newFilings, 0);
      const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
      const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
      
      return {
        success: totalErrors === 0,
        ticker,
        results,
        message: `Sync complete: ${totalNew} new filings, ${totalSkipped} skipped, ${totalErrors} errors`,
      };
    } catch (error) {
      this.logger.error(`Error syncing ${ticker}: ${error.message}`);
      return {
        success: false,
        ticker,
        results: [],
        message: `Sync failed: ${error.message}`,
      };
    }
  }

  /**
   * Sync all tracked tickers
   */
  @Post('sync-all')
  async syncAll(): Promise<{
    success: boolean;
    results: SyncResult[];
    summary: {
      totalTickers: number;
      totalNew: number;
      totalSkipped: number;
      totalErrors: number;
    };
  }> {
    try {
      this.logger.log('Starting sync for all tickers');
      
      const results = await this.secSync.syncAll();
      
      const totalNew = results.reduce((sum, r) => sum + r.newFilings, 0);
      const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
      const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
      const totalTickers = new Set(results.map(r => r.ticker)).size;
      
      return {
        success: totalErrors === 0,
        results,
        summary: {
          totalTickers,
          totalNew,
          totalSkipped,
          totalErrors,
        },
      };
    } catch (error) {
      this.logger.error(`Error syncing all tickers: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get sync status for all tickers
   */
  @Get('sync-status')
  async getSyncStatus(): Promise<any[]> {
    return this.secSync.getSyncStatus();
  }

  /**
   * Get S3 bucket info
   */
  @Get('bucket-info')
  async getBucketInfo(): Promise<{
    bucketName: string;
    region: string;
    isLocal: boolean;
    paths: {
      secFilings: string;
      userUploads: string;
      processedData: string;
    };
  }> {
    return {
      bucketName: process.env.S3_DATA_LAKE_BUCKET || 'fundlens-data-lake',
      region: process.env.AWS_REGION || 'us-east-1',
      isLocal: !process.env.AWS_ACCESS_KEY_ID,
      paths: {
        secFilings: 'public/sec-filings/',
        userUploads: 'tenants/{tenantId}/uploads/',
        processedData: 'public/sec-filings/processed/',
      },
    };
  }

  /**
   * Test S3 connectivity
   */
  @Post('test-connection')
  async testConnection(): Promise<{
    success: boolean;
    message: string;
    canList: boolean;
  }> {
    try {
      // Test by trying to list files in the root
      await this.s3DataLake.listFiles('');
      return {
        success: true,
        message: 'S3 connection successful',
        canList: true,
      };
    } catch (error) {
      return {
        success: false,
        message: `S3 connection failed: ${error.message}`,
        canList: false,
      };
    }
  }

  /**
   * Process a specific SEC filing
   */
  @Post('process/:ticker/:filingType/:accessionNumber')
  async processFiling(
    @Param('ticker') ticker: string,
    @Param('filingType') filingType: string,
    @Param('accessionNumber') accessionNumber: string,
  ): Promise<{
    success: boolean;
    result?: ProcessingResult;
    message: string;
  }> {
    try {
      this.logger.log(`Starting processing for ${ticker} ${filingType} ${accessionNumber}`);
      
      const result = await this.secProcessing.processFiling(
        ticker,
        filingType,
        accessionNumber,
      );
      
      return {
        success: result.status === 'success',
        result,
        message: result.status === 'success' 
          ? `Processing complete: ${result.metricsExtracted} metrics, ${result.narrativesExtracted} narratives`
          : `Processing failed: ${result.errors.join(', ')}`,
      };
    } catch (error) {
      this.logger.error(`Error processing filing: ${error.message}`);
      return {
        success: false,
        message: `Processing failed: ${error.message}`,
      };
    }
  }

  /**
   * Process all unprocessed filings
   */
  @Post('process-all')
  async processAllUnprocessed(): Promise<{
    success: boolean;
    results: ProcessingResult[];
    summary: {
      total: number;
      successful: number;
      failed: number;
      totalMetrics: number;
      totalNarratives: number;
    };
  }> {
    try {
      this.logger.log('Starting processing for all unprocessed filings');
      
      const results = await this.secProcessing.processAllUnprocessed();
      
      const successful = results.filter(r => r.status === 'success').length;
      const failed = results.filter(r => r.status === 'failed').length;
      const totalMetrics = results.reduce((sum, r) => sum + r.metricsExtracted, 0);
      const totalNarratives = results.reduce((sum, r) => sum + r.narrativesExtracted, 0);
      
      return {
        success: failed === 0,
        results,
        summary: {
          total: results.length,
          successful,
          failed,
          totalMetrics,
          totalNarratives,
        },
      };
    } catch (error) {
      this.logger.error(`Error processing all filings: ${error.message}`);
      throw error;
    }
  }

  /**
   * Sync and process a ticker (complete workflow)
   */
  @Post('sync-and-process/:ticker')
  async syncAndProcess(
    @Param('ticker') ticker: string,
    @Body() body?: { filingTypes?: string[] },
  ): Promise<{
    success: boolean;
    syncResults: SyncResult[];
    processingResults: ProcessingResult[];
    message: string;
  }> {
    try {
      this.logger.log(`Starting sync and process workflow for ticker: ${ticker}`);
      
      // Step 1: Sync (download) new filings
      const filingTypes = body?.filingTypes || ['10-K', '10-Q'];
      const syncResults = await this.secSync.syncTicker(ticker, filingTypes);
      
      // Step 2: Process newly downloaded filings
      const processingResults = await this.secProcessing.processUnprocessedForTicker(ticker);
      
      const totalProcessed = processingResults.length;
      const successfullyProcessed = processingResults.filter(r => r.status === 'success').length;
      
      const totalNewFilings = syncResults.reduce((sum, r) => sum + r.newFilings, 0);
      const totalErrors = syncResults.reduce((sum, r) => sum + r.errors, 0);
      
      return {
        success: totalErrors === 0,
        syncResults,
        processingResults,
        message: `Workflow complete: ${totalNewFilings} filings synced, ${successfullyProcessed}/${totalProcessed} processed successfully`,
      };
    } catch (error) {
      this.logger.error(`Error in sync and process workflow: ${error.message}`);
      return {
        success: false,
        syncResults: [],
        processingResults: [],
        message: `Workflow failed: ${error.message}`,
      };
    }
  }
}