import { Controller, Get, Post, Query, Param, Body, Logger } from '@nestjs/common';
import { KBSyncService, KBSyncResult, SyncStatus, FullSyncResult, SectionSyncResult } from './kb-sync.service';

@Controller('rag/kb')
export class KBSyncController {
  private readonly logger = new Logger(KBSyncController.name);

  constructor(private readonly kbSyncService: KBSyncService) {}

  /**
   * Get sync status - compare RDS, S3, and KB document counts
   */
  @Get('status')
  async getSyncStatus(@Query('ticker') ticker?: string): Promise<{
    success: boolean;
    data: SyncStatus;
  }> {
    this.logger.log(`Getting sync status${ticker ? ` for ${ticker}` : ''}`);
    
    const status = await this.kbSyncService.getSyncStatus(ticker);
    
    return {
      success: true,
      data: status,
    };
  }

  /**
   * Start KB ingestion job (via Lambda - faster)
   */
  @Post('sync')
  async startSync(@Body() body: { ticker?: string; description?: string; useLambda?: boolean }): Promise<{
    success: boolean;
    data: KBSyncResult;
  }> {
    this.logger.log(`Starting KB sync${body.ticker ? ` for ${body.ticker}` : ''} (Lambda: ${body.useLambda !== false})`);
    
    let result: KBSyncResult;
    
    if (body.useLambda !== false) {
      // Use Lambda by default (faster)
      result = await this.kbSyncService.startIngestionViaLambda(body.ticker);
    } else {
      // Direct API call
      const description = body.description || 
        `Manual sync${body.ticker ? ` for ${body.ticker}` : ''} at ${new Date().toISOString()}`;
      result = await this.kbSyncService.startIngestion(description);
    }
    
    return {
      success: result.success,
      data: result,
    };
  }

  /**
   * Get ingestion job status
   */
  @Get('job/:jobId')
  async getJobStatus(@Param('jobId') jobId: string): Promise<{
    success: boolean;
    data: KBSyncResult;
  }> {
    this.logger.log(`Getting job status: ${jobId}`);
    
    const result = await this.kbSyncService.getIngestionStatus(jobId);
    
    return {
      success: result.success,
      data: result,
    };
  }

  /**
   * Get latest ingestion job
   */
  @Get('latest-job')
  async getLatestJob(): Promise<{
    success: boolean;
    data: KBSyncResult;
  }> {
    this.logger.log('Getting latest ingestion job');
    
    const result = await this.kbSyncService.getLatestIngestionJob();
    
    return {
      success: result.success,
      data: result,
    };
  }

  /**
   * Full sync: Upload to S3 + Trigger KB ingestion + Wait for completion
   */
  @Post('full-sync')
  async fullSync(@Body() body: { ticker?: string }): Promise<{
    success: boolean;
    data: KBSyncResult;
  }> {
    this.logger.log(`Starting full sync${body.ticker ? ` for ${body.ticker}` : ''}`);
    
    const result = await this.kbSyncService.fullSync(body.ticker);
    
    return {
      success: result.success,
      data: result,
    };
  }

  /**
   * FULL SYNC ALL - Sync ALL chunks from RDS to S3 and KB
   * 
   * CRITICAL: This ensures delta = 0 (all RDS chunks synced to KB)
   * Uses batch processing with exponential backoff for rate limiting
   */
  @Post('full-sync-all')
  async fullSyncAll(@Body() body: { 
    batchSize?: number; 
    waitForKB?: boolean;
    ticker?: string;
  }): Promise<{
    success: boolean;
    data: FullSyncResult;
  }> {
    this.logger.log(`🚀 Starting FULL SYNC ALL - ensuring delta = 0`);
    this.logger.log(`   Options: batchSize=${body.batchSize || 1000}, waitForKB=${body.waitForKB !== false}, ticker=${body.ticker || 'ALL'}`);
    
    const result = await this.kbSyncService.fullSyncAll({
      batchSize: body.batchSize,
      waitForKB: body.waitForKB,
      ticker: body.ticker,
    });
    
    return {
      success: result.success,
      data: result,
    };
  }

  /**
   * Wait for job completion
   */
  @Post('wait/:jobId')
  async waitForCompletion(
    @Param('jobId') jobId: string,
    @Body() body: { maxWaitMs?: number }
  ): Promise<{
    success: boolean;
    data: KBSyncResult;
  }> {
    this.logger.log(`Waiting for job completion: ${jobId}`);
    
    const result = await this.kbSyncService.waitForCompletion(
      jobId, 
      body.maxWaitMs || 300000
    );
    
    return {
      success: result.success,
      data: result,
    };
  }

  /**
   * SECTION-BASED SYNC - Optimized sync using aggregated sections
   * 
   * RECOMMENDED: This approach aggregates chunks by section before upload,
   * reducing S3 file count from ~77K to ~1K while preserving all content.
   * Bedrock handles optimal chunking for embeddings.
   */
  @Post('section-sync')
  async sectionBasedSync(@Body() body: {
    clearExisting?: boolean;
    waitForKB?: boolean;
    tickers?: string[];
  }): Promise<{
    success: boolean;
    data: SectionSyncResult;
  }> {
    this.logger.log(`🚀 Starting SECTION-BASED SYNC (optimized)`);
    this.logger.log(`   Options: clearExisting=${body.clearExisting}, waitForKB=${body.waitForKB !== false}, tickers=${body.tickers?.join(',') || 'ALL'}`);
    
    const result = await this.kbSyncService.sectionBasedSync({
      clearExisting: body.clearExisting,
      waitForKB: body.waitForKB,
      tickers: body.tickers,
    });
    
    return {
      success: result.success,
      data: result,
    };
  }
}
