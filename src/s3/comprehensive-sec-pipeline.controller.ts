import { Controller, Post, Get, Body, Param, Logger } from '@nestjs/common';
import { ComprehensiveSECPipelineService, ComprehensivePipelineResult, PipelineConfig } from './comprehensive-sec-pipeline.service';

/**
 * Comprehensive SEC Pipeline Controller
 * 
 * Provides endpoints for the full SEC data pipeline:
 * 1. Get filing URLs from SEC API
 * 2. Download to S3 raw bucket
 * 3. Process with existing ingestion service
 * 4. Store metrics in RDS
 * 5. Store narratives in S3 processed bucket
 * 6. Sync with Bedrock Knowledge Base
 */
@Controller('comprehensive-sec-pipeline')
export class ComprehensiveSECPipelineController {
  private readonly logger = new Logger(ComprehensiveSECPipelineController.name);

  constructor(
    private readonly pipelineService: ComprehensiveSECPipelineService,
  ) {}

  /**
   * Execute full pipeline for all 10 companies, 7 years
   */
  @Post('execute-full-dataset')
  async executeFullDataset(
    @Body() body?: {
      companies?: string[];
      years?: number[];
      filingTypes?: string[];
      batchSize?: number;
      skipExisting?: boolean;
      syncToKnowledgeBase?: boolean;
      knowledgeBaseBucket?: string;
    },
  ): Promise<{
    success: boolean;
    results: ComprehensivePipelineResult[];
    summary: {
      totalCompanies: number;
      successfulCompanies: number;
      totalFilings: number;
      totalMetrics: number;
      totalNarratives: number;
      totalKBChunks: number;
      processingTime: number;
    };
    message: string;
  }> {
    const startTime = Date.now();

    try {
      // Default configuration for full dataset
      const config: PipelineConfig = {
        companies: body?.companies || [
          'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 
          'META', 'NVDA', 'JPM', 'BAC', 'WMT'
        ],
        years: body?.years || [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
        filingTypes: body?.filingTypes || ['10-K', '10-Q', '8-K'],
        batchSize: body?.batchSize || 3,
        skipExisting: body?.skipExisting ?? true,
        syncToKnowledgeBase: body?.syncToKnowledgeBase ?? true,
        knowledgeBaseBucket: body?.knowledgeBaseBucket,
      };

      this.logger.log(`🚀 Starting comprehensive SEC pipeline:`);
      this.logger.log(`   Companies: ${config.companies.join(', ')}`);
      this.logger.log(`   Years: ${config.years.join(', ')}`);
      this.logger.log(`   Filing Types: ${config.filingTypes.join(', ')}`);
      this.logger.log(`   Skip Existing: ${config.skipExisting}`);
      this.logger.log(`   Knowledge Base Sync: ${config.syncToKnowledgeBase}`);

      const results = await this.pipelineService.executeFullPipeline(config);

      const summary = {
        totalCompanies: results.length,
        successfulCompanies: results.filter(r => r.errors.length === 0).length,
        totalFilings: results.reduce((sum, r) => sum + r.processedFilings, 0),
        totalMetrics: results.reduce((sum, r) => sum + r.totalMetrics, 0),
        totalNarratives: results.reduce((sum, r) => sum + r.totalNarratives, 0),
        totalKBChunks: results.reduce((sum, r) => sum + r.knowledgeBaseSync.chunksUploaded, 0),
        processingTime: Date.now() - startTime,
      };

      const success = summary.totalFilings > 0 && summary.successfulCompanies > 0;
      const message = success
        ? `Pipeline complete: ${summary.totalFilings} filings, ${summary.totalMetrics} metrics, ${summary.totalNarratives} narratives, ${summary.totalKBChunks} KB chunks`
        : `Pipeline had issues: check individual company results`;

      this.logger.log(`🎉 Comprehensive pipeline summary:`);
      this.logger.log(`   Successful companies: ${summary.successfulCompanies}/${summary.totalCompanies}`);
      this.logger.log(`   Total filings processed: ${summary.totalFilings}`);
      this.logger.log(`   Total metrics extracted: ${summary.totalMetrics}`);
      this.logger.log(`   Total narratives extracted: ${summary.totalNarratives}`);
      this.logger.log(`   Total KB chunks synced: ${summary.totalKBChunks}`);
      this.logger.log(`   Processing time: ${(summary.processingTime / 60000).toFixed(1)} minutes`);

      return {
        success,
        results,
        summary,
        message,
      };

    } catch (error) {
      this.logger.error(`❌ Comprehensive pipeline failed: ${error.message}`);
      return {
        success: false,
        results: [],
        summary: {
          totalCompanies: 0,
          successfulCompanies: 0,
          totalFilings: 0,
          totalMetrics: 0,
          totalNarratives: 0,
          totalKBChunks: 0,
          processingTime: Date.now() - startTime,
        },
        message: `Pipeline failed: ${error.message}`,
      };
    }
  }

  /**
   * Execute pipeline for a single company
   */
  @Post('execute-company/:ticker')
  async executeCompany(
    @Param('ticker') tickerParam: string,
    @Body() body: {
      ticker?: string;
      years?: number[];
      filingTypes?: string[];
      skipExisting?: boolean;
      syncToKnowledgeBase?: boolean;
    },
  ): Promise<{
    success: boolean;
    result: ComprehensivePipelineResult;
    message: string;
  }> {
    // Use ticker from URL param, fallback to body
    const ticker = tickerParam || body.ticker;
    
    if (!ticker) {
      return {
        success: false,
        result: {
          ticker: 'unknown',
          totalFilings: 0,
          processedFilings: 0,
          failedFilings: 0,
          totalMetrics: 0,
          totalNarratives: 0,
          s3Uploads: { rawFilings: 0, processedData: 0 },
          knowledgeBaseSync: { chunksUploaded: 0, syncStatus: 'failed' },
          processingTime: 0,
          errors: ['ticker is required'],
        },
        message: 'ticker is required',
      };
    }

    try {
      const config: PipelineConfig = {
        companies: [ticker],
        years: body.years || [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
        filingTypes: body.filingTypes || ['10-K', '10-Q', '8-K'],
        batchSize: 1,
        skipExisting: body.skipExisting ?? true,
        syncToKnowledgeBase: body.syncToKnowledgeBase ?? true,
      };

      this.logger.log(`Starting pipeline for ${ticker}`);
      
      const result = await this.pipelineService.processCompanyComprehensive(ticker, config);
      
      const success = result.errors.length === 0;
      const message = success 
        ? `${ticker}: ${result.processedFilings} filings processed successfully`
        : `${ticker}: ${result.processedFilings} processed, ${result.errors.length} errors`;

      return {
        success,
        result,
        message,
      };

    } catch (error) {
      this.logger.error(`Error processing ${ticker}: ${error.message}`);
      return {
        success: false,
        result: {
          ticker: ticker,
          totalFilings: 0,
          processedFilings: 0,
          failedFilings: 1,
          totalMetrics: 0,
          totalNarratives: 0,
          s3Uploads: { rawFilings: 0, processedData: 0 },
          knowledgeBaseSync: { chunksUploaded: 0, syncStatus: 'failed' },
          processingTime: 0,
          errors: [error.message],
        },
        message: `Failed to process ${ticker}: ${error.message}`,
      };
    }
  }

  /**
   * Get pipeline status for all companies
   */
  @Get('status')
  async getPipelineStatus(): Promise<{
    companies: any[];
    summary: {
      totalCompanies: number;
      companiesWithData: number;
      totalFilings: number;
      totalMetrics: number;
      totalNarratives: number;
    };
  }> {
    try {
      const companies = await this.pipelineService.getPipelineStatus();
      
      const summary = {
        totalCompanies: companies.length,
        companiesWithData: companies.filter(c => c.filings > 0).length,
        totalFilings: companies.reduce((sum, c) => sum + c.filings, 0),
        totalMetrics: companies.reduce((sum, c) => sum + c.metrics, 0),
        totalNarratives: companies.reduce((sum, c) => sum + c.narratives, 0),
      };

      return {
        companies,
        summary,
      };

    } catch (error) {
      this.logger.error(`Error getting pipeline status: ${error.message}`);
      return {
        companies: [],
        summary: {
          totalCompanies: 0,
          companiesWithData: 0,
          totalFilings: 0,
          totalMetrics: 0,
          totalNarratives: 0,
        },
      };
    }
  }

  /**
   * Sync existing data to Knowledge Base
   */
  @Post('sync-to-knowledge-base')
  async syncToKnowledgeBase(
    @Body() body?: {
      ticker?: string;
      bucket?: string;
    },
  ): Promise<{
    success: boolean;
    chunksUploaded: number;
    message: string;
  }> {
    try {
      this.logger.log(`Syncing ${body?.ticker || 'all companies'} to Knowledge Base`);
      
      // Use the chunk exporter service directly
      const bucket = body?.bucket || process.env.S3_DATA_LAKE_BUCKET || 'fundlens-data-lake';
      
      const uploadResult = await this.pipelineService['chunkExporter'].uploadToS3({
        bucket,
        ticker: body?.ticker,
        keyPrefix: 'bedrock-kb/sec-filings',
        dryRun: false,
      });

      const success = uploadResult.uploadedCount > 0;
      const message = success
        ? `Synced ${uploadResult.uploadedCount} chunks to Knowledge Base`
        : `No chunks found to sync`;

      return {
        success,
        chunksUploaded: uploadResult.uploadedCount,
        message,
      };

    } catch (error) {
      this.logger.error(`Error syncing to Knowledge Base: ${error.message}`);
      return {
        success: false,
        chunksUploaded: 0,
        message: `Sync failed: ${error.message}`,
      };
    }
  }

  /**
   * Test endpoint to verify all services are working
   */
  @Post('test-services')
  async testServices(): Promise<{
    success: boolean;
    services: Record<string, boolean>;
    message: string;
  }> {
    const services: Record<string, boolean> = {};
    
    try {
      // Test SEC service
      try {
        await this.pipelineService['secService'].getCikForTicker('AAPL');
        services.secService = true;
      } catch {
        services.secService = false;
      }

      // Test S3 service
      try {
        await this.pipelineService['s3DataLake'].exists('test-key');
        services.s3DataLake = true;
      } catch {
        services.s3DataLake = false;
      }

      // Test database
      try {
        await this.pipelineService['prisma'].financialMetric.count();
        services.database = true;
      } catch {
        services.database = false;
      }

      // Test Python parser
      try {
        const response = await this.pipelineService['http'].axiosRef.get('http://localhost:8000/health');
        services.pythonParser = response.status === 200;
      } catch {
        services.pythonParser = false;
      }

      const allWorking = Object.values(services).every(s => s);
      
      return {
        success: allWorking,
        services,
        message: allWorking ? 'All services are working' : 'Some services have issues',
      };

    } catch (error) {
      return {
        success: false,
        services,
        message: `Service test failed: ${error.message}`,
      };
    }
  }
}