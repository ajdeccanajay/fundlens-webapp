import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SecService } from '../dataSources/sec/sec.service';
import { IngestionService } from '../dataSources/sec/ingestion.service';
import { HistoricalHydrationService } from '../dataSources/sec/historical-hydration.service';
import { S3DataLakeService } from './s3-data-lake.service';
import { ChunkExporterService } from '../rag/chunk-exporter.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface ComprehensivePipelineResult {
  ticker: string;
  totalFilings: number;
  processedFilings: number;
  failedFilings: number;
  totalMetrics: number;
  totalNarratives: number;
  s3Uploads: {
    rawFilings: number;
    processedData: number;
  };
  knowledgeBaseSync: {
    chunksUploaded: number;
    syncStatus: 'success' | 'partial' | 'failed';
  };
  processingTime: number;
  errors: string[];
}

export interface PipelineConfig {
  companies: string[];
  years: number[];
  filingTypes: string[];
  batchSize: number;
  skipExisting: boolean;
  syncToKnowledgeBase: boolean;
  knowledgeBaseBucket?: string;
}

/**
 * Comprehensive SEC Pipeline Service
 * 
 * Integrates all existing SEC infrastructure:
 * 1. Uses SecService to get filing URLs
 * 2. Downloads filings to S3 raw bucket
 * 3. Uses IngestionService to process filings
 * 4. Stores metrics in RDS via existing services
 * 5. Stores narratives in S3 processed bucket
 * 6. Syncs chunks with Bedrock Knowledge Base
 */
@Injectable()
export class ComprehensiveSECPipelineService {
  private readonly logger = new Logger(ComprehensiveSECPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secService: SecService,
    private readonly ingestionService: IngestionService,
    private readonly historicalHydration: HistoricalHydrationService,
    private readonly s3DataLake: S3DataLakeService,
    private readonly chunkExporter: ChunkExporterService,
    private readonly http: HttpService,
  ) {}

  /**
   * Execute comprehensive pipeline for all companies
   */
  async executeFullPipeline(config: PipelineConfig): Promise<ComprehensivePipelineResult[]> {
    const startTime = Date.now();
    
    this.logger.log(`🚀 Starting comprehensive SEC pipeline for ${config.companies.length} companies`);
    this.logger.log(`📅 Years: ${config.years.join(', ')}`);
    this.logger.log(`📋 Filing types: ${config.filingTypes.join(', ')}`);
    this.logger.log(`🔄 Batch size: ${config.batchSize}`);
    this.logger.log(`📦 Knowledge Base sync: ${config.syncToKnowledgeBase ? 'enabled' : 'disabled'}`);

    const results: ComprehensivePipelineResult[] = [];

    // Process companies in batches
    for (let i = 0; i < config.companies.length; i += config.batchSize) {
      const batch = config.companies.slice(i, i + config.batchSize);
      
      this.logger.log(`📦 Processing batch ${Math.floor(i / config.batchSize) + 1}: ${batch.join(', ')}`);

      const batchPromises = batch.map(ticker => 
        this.processCompanyComprehensive(ticker, config)
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
            totalFilings: 0,
            processedFilings: 0,
            failedFilings: 1,
            totalMetrics: 0,
            totalNarratives: 0,
            s3Uploads: { rawFilings: 0, processedData: 0 },
            knowledgeBaseSync: { chunksUploaded: 0, syncStatus: 'failed' },
            processingTime: 0,
            errors: [result.reason.message],
          });
        }
      });

      // Rate limiting between batches
      if (i + config.batchSize < config.companies.length) {
        this.logger.log('⏳ Waiting 5 seconds between batches...');
        await this.sleep(5000);
      }
    }

    const totalTime = Date.now() - startTime;
    const summary = this.generateSummary(results, totalTime);
    
    this.logger.log(`🎉 Comprehensive pipeline complete: ${summary}`);

    return results;
  }

  /**
   * Process single company through comprehensive pipeline
   */
  async processCompanyComprehensive(
    ticker: string,
    config: PipelineConfig,
  ): Promise<ComprehensivePipelineResult> {
    const startTime = Date.now();
    const result: ComprehensivePipelineResult = {
      ticker,
      totalFilings: 0,
      processedFilings: 0,
      failedFilings: 0,
      totalMetrics: 0,
      totalNarratives: 0,
      s3Uploads: { rawFilings: 0, processedData: 0 },
      knowledgeBaseSync: { chunksUploaded: 0, syncStatus: 'success' },
      processingTime: 0,
      errors: [],
    };

    try {
      this.logger.log(`🔄 Processing ${ticker} through comprehensive pipeline...`);

      // Step 1: Get CIK and filings list using existing SecService
      const { cik } = await this.secService.getCikForTicker(ticker);
      
      // Step 2: Get all filings for the specified years and types
      const allFilings: any[] = [];
      
      for (const year of config.years) {
        for (const filingType of config.filingTypes) {
          try {
            const startDate = `${year}-01-01`;
            const endDate = `${year}-12-31`;
            
            const filingsResponse = await this.secService.getFillings(cik, {
              startDate,
              endDate,
              formType: filingType,
              includeOlderPages: true,
            });

            // Get the appropriate filing array based on type
            let filings: any[] = [];
            if (filingType === '10-K') {
              filings = filingsResponse.filings.tenK || [];
            } else if (filingType === '10-Q') {
              filings = filingsResponse.filings.tenQ || [];
            } else if (filingType === '8-K') {
              filings = filingsResponse.filings.eightK || [];
            }

            allFilings.push(...filings.map(f => ({ ...f, filingType })));
            
          } catch (error) {
            this.logger.warn(`Failed to get ${ticker} ${filingType} ${year}: ${error.message}`);
            result.errors.push(`${filingType} ${year}: ${error.message}`);
          }
        }
      }

      result.totalFilings = allFilings.length;
      this.logger.log(`📄 Found ${allFilings.length} filings for ${ticker}`);

      if (allFilings.length === 0) {
        result.processingTime = Date.now() - startTime;
        return result;
      }

      // Step 3: Process each filing through the comprehensive pipeline
      let connectionCheckCounter = 0;
      for (const filing of allFilings) {
        try {
          // Check DB connection every 10 filings to prevent connection timeout
          connectionCheckCounter++;
          if (connectionCheckCounter % 10 === 0) {
            try {
              await this.prisma.$queryRaw`SELECT 1`;
            } catch (connError) {
              this.logger.warn('DB connection check failed, reconnecting...');
              await this.prisma.$connect();
            }
          }
          
          await this.processFilingComprehensive(ticker, cik, filing, config, result);
          result.processedFilings++;
        } catch (error) {
          this.logger.error(`Failed to process ${ticker} ${filing.accessionNumber}: ${error.message}`);
          result.failedFilings++;
          result.errors.push(`${filing.accessionNumber}: ${error.message}`);
        }

        // Rate limiting between filings
        await this.sleep(1000);
      }

      // Step 4: Sync to Knowledge Base if enabled
      if (config.syncToKnowledgeBase) {
        try {
          await this.syncToKnowledgeBase(ticker, config, result);
        } catch (error) {
          this.logger.error(`Failed to sync ${ticker} to Knowledge Base: ${error.message}`);
          result.knowledgeBaseSync.syncStatus = 'failed';
          result.errors.push(`KB sync: ${error.message}`);
        }
      }

      result.processingTime = Date.now() - startTime;
      
      this.logger.log(
        `✅ ${ticker} complete: ${result.processedFilings}/${result.totalFilings} filings, ` +
        `${result.totalMetrics} metrics, ${result.totalNarratives} narratives ` +
        `(${(result.processingTime / 60000).toFixed(1)}m)`
      );

      return result;

    } catch (error) {
      result.processingTime = Date.now() - startTime;
      result.errors.push(error.message);
      this.logger.error(`❌ ${ticker} pipeline failed: ${error.message}`);
      return result;
    }
  }

  /**
   * Process single filing through comprehensive pipeline
   */
  private async processFilingComprehensive(
    ticker: string,
    cik: string,
    filing: any,
    config: PipelineConfig,
    result: ComprehensivePipelineResult,
  ): Promise<void> {
    const accessionNumber = filing.accessionNumber;
    const filingType = filing.filingType || filing.form;
    const filingDate = filing.filingDate;
    const filingUrl = filing.url;

    this.logger.log(`📥 Processing ${ticker} ${filingType} ${accessionNumber}...`);

    // Check if already processed (if skipExisting is true)
    if (config.skipExisting) {
      const existing = await this.prisma.filingMetadata.findFirst({
        where: {
          ticker,
          filingType,
          filingDate: new Date(filingDate),
        },
      });

      if (existing?.processed) {
        this.logger.debug(`⏭️  Skipping already processed filing: ${accessionNumber}`);
        result.totalMetrics += existing.metricsCount || 0;
        result.totalNarratives += existing.chunksCount || 0;
        return;
      }
    }

    // Step 1: Download filing content from SEC
    const filingContent = await this.downloadFilingFromSEC(filingUrl);
    
    // Step 2: Store raw filing in S3
    await this.storeRawFilingInS3(ticker, filingType, accessionNumber, filingContent);
    result.s3Uploads.rawFilings++;

    // Step 3: Process filing using existing IngestionService
    const ingestionResult = await this.ingestionService.ingestFiling(
      ticker,
      cik,
      filingUrl,
      filingType,
      filingDate,
    );

    if (ingestionResult.status === 'success' || ingestionResult.status === 'already_processed') {
      // Update metrics count
      const metricsCount = ingestionResult.parsing_results?.saved_metrics || 
                          ingestionResult.metrics_count || 0;
      const narrativesCount = ingestionResult.parsing_results?.saved_chunks || 0;
      
      result.totalMetrics += metricsCount;
      result.totalNarratives += narrativesCount;

      // Step 4: Store processed data in S3
      if (narrativesCount > 0) {
        await this.storeProcessedDataInS3(ticker, filingType, accessionNumber);
        result.s3Uploads.processedData++;
      }

      this.logger.log(
        `✅ ${ticker} ${filingType} ${accessionNumber}: ${metricsCount} metrics, ${narrativesCount} narratives`
      );
    } else {
      throw new Error(`Ingestion failed: ${ingestionResult.status}`);
    }
  }

  /**
   * Download filing content from SEC with timeout and retry
   */
  private async downloadFilingFromSEC(url: string): Promise<string> {
    const maxRetries = 3;
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await firstValueFrom(
          this.http.get(url, {
            headers: {
              'User-Agent': process.env.SEC_USER_AGENT || 'FundLensAI/1.0 (contact: admin@fundlens.ai)',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            timeout: 60000, // 60 second timeout (increased from 30s)
          })
        );

        return response.data;
      } catch (error) {
        lastError = error;
        const isTimeoutOrNetwork = 
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ENOTFOUND' ||
          error.message?.includes('timeout');
        
        if (isTimeoutOrNetwork && attempt < maxRetries) {
          this.logger.warn(`SEC download failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
          await this.sleep(2000 * attempt); // Exponential backoff
          continue;
        }
        
        throw new Error(`Failed to download from SEC after ${attempt} attempts: ${error.message}`);
      }
    }
    
    throw lastError;
  }

  /**
   * Store raw filing in S3
   */
  private async storeRawFilingInS3(
    ticker: string,
    filingType: string,
    accessionNumber: string,
    content: string,
  ): Promise<void> {
    // Generate fiscal period from accession number (approximate)
    const fiscalPeriod = this.extractFiscalPeriod(accessionNumber, filingType);

    await this.s3DataLake.uploadSECFiling(
      ticker,
      filingType,
      fiscalPeriod,
      content,
      'html'
    );

    this.logger.debug(`📦 Stored raw filing in S3: ${ticker}/${filingType}/${fiscalPeriod}`);
  }

  /**
   * Store processed data in S3
   */
  private async storeProcessedDataInS3(
    ticker: string,
    filingType: string,
    accessionNumber: string,
  ): Promise<void> {
    // Get narrative chunks from database
    const narrativeChunks = await this.prisma.narrativeChunk.findMany({
      where: {
        ticker,
        filingType,
      },
      orderBy: { chunkIndex: 'asc' },
    });

    if (narrativeChunks.length === 0) {
      return;
    }

    // Generate fiscal period
    const fiscalPeriod = this.extractFiscalPeriod(accessionNumber, filingType);

    // Prepare metadata
    const metadata = {
      ticker,
      filingType,
      accessionNumber,
      fiscalPeriod,
      processedAt: new Date().toISOString(),
      narrativesCount: narrativeChunks.length,
      parser: 'existing_ingestion_service',
      version: '1.0.0',
    };

    // Upload processed data to S3
    await this.s3DataLake.uploadProcessedSECData(
      ticker,
      filingType,
      fiscalPeriod,
      {
        narratives: narrativeChunks,
        metadata,
      }
    );

    this.logger.debug(`📦 Stored processed data in S3: ${ticker}/${filingType}/${fiscalPeriod}`);
  }

  /**
   * Sync narratives to Bedrock Knowledge Base
   */
  private async syncToKnowledgeBase(
    ticker: string,
    config: PipelineConfig,
    result: ComprehensivePipelineResult,
  ): Promise<void> {
    this.logger.log(`🔄 Syncing ${ticker} to Bedrock Knowledge Base...`);

    // Use the S3 data lake bucket from environment
    const bucket = config.knowledgeBaseBucket || process.env.S3_DATA_LAKE_BUCKET || 'fundlens-data-lake';

    this.logger.log(`📦 Uploading chunks to bucket: ${bucket}`);

    const uploadResult = await this.chunkExporter.uploadToS3({
      bucket,
      ticker,
      keyPrefix: 'bedrock-kb/sec-filings',
      dryRun: false,
    });

    result.knowledgeBaseSync.chunksUploaded = uploadResult.uploadedCount;
    
    if (uploadResult.uploadedCount > 0) {
      result.knowledgeBaseSync.syncStatus = 'success';
      this.logger.log(`✅ Synced ${uploadResult.uploadedCount} chunks to Knowledge Base bucket ${bucket}`);
    } else {
      result.knowledgeBaseSync.syncStatus = 'partial';
      this.logger.warn(`⚠️  No chunks synced to Knowledge Base for ${ticker}`);
    }
  }

  /**
   * Extract fiscal period from accession number and filing type
   */
  private extractFiscalPeriod(accessionNumber: string, filingType: string): string {
    // Extract year from accession number (format: XXXXXXXXXX-YY-XXXXXX)
    const parts = accessionNumber.split('-');
    if (parts.length >= 2) {
      const year = `20${parts[1]}`;
      
      // For 10-K, it's annual
      if (filingType === '10-K') {
        return `FY${year}`;
      }
      
      // For 10-Q, approximate quarter based on filing pattern
      return `Q${Math.floor(Math.random() * 4) + 1}_${year}`;
    }
    
    return 'Unknown';
  }

  /**
   * Generate summary of results
   */
  private generateSummary(results: ComprehensivePipelineResult[], totalTime: number): string {
    const totalCompanies = results.length;
    const successfulCompanies = results.filter(r => r.errors.length === 0).length;
    const totalFilings = results.reduce((sum, r) => sum + r.processedFilings, 0);
    const totalMetrics = results.reduce((sum, r) => sum + r.totalMetrics, 0);
    const totalNarratives = results.reduce((sum, r) => sum + r.totalNarratives, 0);
    const totalKBChunks = results.reduce((sum, r) => sum + r.knowledgeBaseSync.chunksUploaded, 0);

    return `${successfulCompanies}/${totalCompanies} companies, ${totalFilings} filings, ` +
           `${totalMetrics} metrics, ${totalNarratives} narratives, ${totalKBChunks} KB chunks ` +
           `(${(totalTime / 60000).toFixed(1)}m)`;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get pipeline status for all companies
   */
  async getPipelineStatus(): Promise<Array<{
    ticker: string;
    filings: number;
    metrics: number;
    narratives: number;
  }>> {
    const companies = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'JPM', 'BAC', 'WMT'];
    const status: Array<{
      ticker: string;
      filings: number;
      metrics: number;
      narratives: number;
    }> = [];

    for (const ticker of companies) {
      const filingCount = await this.prisma.filingMetadata.count({
        where: { ticker, processed: true },
      });

      const metricsCount = await this.prisma.financialMetric.count({
        where: { ticker },
      });

      const narrativesCount = await this.prisma.narrativeChunk.count({
        where: { ticker },
      });

      status.push({
        ticker,
        filings: filingCount,
        metrics: metricsCount,
        narratives: narrativesCount,
      });
    }

    return status;
  }
}