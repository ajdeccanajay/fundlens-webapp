import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SecService } from '../dataSources/sec/sec.service';
import { S3DataLakeService } from './s3-data-lake.service';
import { SimpleProcessingService, SimpleProcessingResult } from './simple-processing.service';

export interface SimpleSyncResult {
  ticker: string;
  filingType: string;
  totalAvailable: number;
  newDownloads: number;
  skipped: number;
  processed: number;
  errors: string[];
  processingResults: SimpleProcessingResult[];
}

/**
 * Simple Sync Service
 * 
 * Clean approach:
 * 1. Get SEC filings list from SEC API
 * 2. Check S3 for existing files (incremental download)
 * 3. Download only new filings
 * 4. Process immediately with hybrid parser
 * 5. Store results in PostgreSQL
 */
@Injectable()
export class SimpleSyncService {
  private readonly logger = new Logger(SimpleSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secService: SecService,
    private readonly s3: S3DataLakeService,
    private readonly processing: SimpleProcessingService,
  ) {}

  /**
   * Sync and process filings for a ticker
   */
  async syncAndProcessTicker(
    ticker: string,
    options: {
      filingTypes?: string[];
      years?: number[];
      limit?: number;
    } = {},
  ): Promise<SimpleSyncResult> {
    const result: SimpleSyncResult = {
      ticker,
      filingType: 'ALL',
      totalAvailable: 0,
      newDownloads: 0,
      skipped: 0,
      processed: 0,
      errors: [],
      processingResults: [],
    };

    try {
      this.logger.log(`🔄 Syncing ${ticker} with options: ${JSON.stringify(options)}`);

      const filingTypes = options.filingTypes || ['10-K', '10-Q'];
      
      for (const filingType of filingTypes) {
        try {
          const filingResult = await this.syncFilingType(ticker, filingType, options);
          
          result.totalAvailable += filingResult.totalAvailable;
          result.newDownloads += filingResult.newDownloads;
          result.skipped += filingResult.skipped;
          result.processed += filingResult.processed;
          result.processingResults.push(...filingResult.processingResults);
          
          if (filingResult.errors.length > 0) {
            result.errors.push(...filingResult.errors);
          }

        } catch (error) {
          const errorMsg = `Failed to sync ${ticker} ${filingType}: ${error.message}`;
          this.logger.error(errorMsg);
          result.errors.push(errorMsg);
        }
      }

      this.logger.log(
        `✅ ${ticker} sync complete: ${result.newDownloads} new, ${result.processed} processed, ${result.skipped} skipped`
      );

      return result;

    } catch (error) {
      this.logger.error(`❌ ${ticker} sync failed: ${error.message}`);
      result.errors.push(error.message);
      return result;
    }
  }

  /**
   * Sync specific filing type for ticker
   */
  private async syncFilingType(
    ticker: string,
    filingType: string,
    options: {
      years?: number[];
      limit?: number;
    },
  ): Promise<SimpleSyncResult> {
    const result: SimpleSyncResult = {
      ticker,
      filingType,
      totalAvailable: 0,
      newDownloads: 0,
      skipped: 0,
      processed: 0,
      errors: [],
      processingResults: [],
    };

    try {
      // Step 1: Get CIK for ticker
      const { cik } = await this.secService.getCikForTicker(ticker);
      if (!cik) {
        throw new Error(`Could not find CIK for ticker ${ticker}`);
      }

      // Step 2: Get filings list from SEC
      this.logger.log(`📄 Getting ${ticker} ${filingType} filings from SEC...`);
      
      const filingsResponse = await this.secService.getFillings(cik, {
        formType: filingType,
      });

      const filings = filingsResponse.allFilings || [];
      result.totalAvailable = filings.length;
      this.logger.log(`Found ${filings.length} ${filingType} filings for ${ticker}`);

      if (filings.length === 0) {
        return result;
      }

      // Step 2: Filter by years if specified
      let filteredFilings = filings;
      if (options.years && options.years.length > 0) {
        filteredFilings = filings.filter((filing: any) => {
          const filingYear = new Date(filing.filingDate).getFullYear();
          return options.years!.includes(filingYear);
        });
        this.logger.log(`Filtered to ${filteredFilings.length} filings for years: ${options.years.join(', ')}`);
      }

      // Step 3: Check which filings we already have (incremental download)
      const newFilings = await this.filterNewFilings(ticker, filingType, filteredFilings);
      result.newDownloads = newFilings.length;
      result.skipped = filteredFilings.length - newFilings.length;

      this.logger.log(`📥 ${newFilings.length} new filings to download, ${result.skipped} already exist`);

      // Step 4: Process new filings
      if (newFilings.length > 0) {
        const processingResults = await this.processing.processTickerFilings(
          ticker,
          newFilings.map((filing: any) => ({
            filingType: filing.form,
            accessionNumber: filing.accessionNumber,
            url: filing.url,
          }))
        );

        result.processingResults = processingResults;
        result.processed = processingResults.filter(r => r.status === 'success').length;

        // Step 5: Mark filings as downloaded in S3 tracking
        await this.markFilingsAsDownloaded(ticker, filingType, newFilings);
      }

      return result;

    } catch (error) {
      result.errors.push(error.message);
      return result;
    }
  }

  /**
   * Filter out filings we already have (incremental download)
   */
  private async filterNewFilings(
    ticker: string,
    filingType: string,
    filings: any[],
  ): Promise<any[]> {
    const newFilings: any[] = [];

    for (const filing of filings) {
      const s3Key = this.getS3Key(ticker, filingType, filing.accessionNumber);
      
      // Check if file exists in S3
      const exists = await this.s3.exists(s3Key);
      
      if (!exists) {
        newFilings.push(filing);
      } else {
        this.logger.debug(`Skipping ${ticker} ${filing.accessionNumber} - already exists in S3`);
      }
    }

    return newFilings;
  }

  /**
   * Mark filings as downloaded in S3 (for incremental tracking)
   */
  private async markFilingsAsDownloaded(
    ticker: string,
    filingType: string,
    filings: any[],
  ): Promise<void> {
    for (const filing of filings) {
      try {
        const s3Key = this.getS3Key(ticker, filingType, filing.accessionNumber);
        
        // Store a small marker file in S3 to track that we've processed this filing
        const marker = {
          ticker,
          filingType,
          accessionNumber: filing.accessionNumber,
          filingDate: filing.filingDate,
          downloadedAt: new Date().toISOString(),
          processed: true,
        };

        await this.s3.upload(s3Key, JSON.stringify(marker), {
          contentType: 'application/json',
          metadata: {
            ticker,
            filingType,
            accessionNumber: filing.accessionNumber,
          },
        });

      } catch (error) {
        this.logger.warn(`Failed to mark ${ticker} ${filing.accessionNumber} as downloaded: ${error.message}`);
      }
    }
  }

  /**
   * Get S3 key for filing tracking
   */
  private getS3Key(ticker: string, filingType: string, accessionNumber: string): string {
    return `processed-filings/${ticker}/${filingType}/${accessionNumber}/marker.json`;
  }

  /**
   * Sync multiple tickers in parallel
   */
  async syncMultipleTickers(
    tickers: string[],
    options: {
      filingTypes?: string[];
      years?: number[];
      limit?: number;
      batchSize?: number;
    } = {},
  ): Promise<SimpleSyncResult[]> {
    const batchSize = options.batchSize || 3;
    const results: SimpleSyncResult[] = [];

    this.logger.log(`🚀 Syncing ${tickers.length} tickers in batches of ${batchSize}`);

    // Process tickers in batches
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      
      this.logger.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}: ${batch.join(', ')}`);

      const batchPromises = batch.map(ticker => 
        this.syncAndProcessTicker(ticker, options)
      );

      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, index) => {
        const ticker = batch[index];
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          this.logger.error(`Batch processing failed for ${ticker}: ${result.reason}`);
          results.push({
            ticker,
            filingType: 'ALL',
            totalAvailable: 0,
            newDownloads: 0,
            skipped: 0,
            processed: 0,
            errors: [result.reason.message],
            processingResults: [],
          });
        }
      });

      // Rate limiting between batches
      if (i + batchSize < tickers.length) {
        this.logger.log('⏳ Waiting 5 seconds between batches...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    const totalProcessed = results.reduce((sum, r) => sum + r.processed, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

    this.logger.log(`🎉 Multi-ticker sync complete: ${totalProcessed} filings processed, ${totalErrors} errors`);

    return results;
  }
}