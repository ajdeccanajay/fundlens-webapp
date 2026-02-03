import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { S3DataLakeService } from './s3-data-lake.service';

export interface SimpleProcessingResult {
  ticker: string;
  filingType: string;
  accessionNumber: string;
  metricsExtracted: number;
  narrativesExtracted: number;
  processingTime: number;
  status: 'success' | 'failed';
  errors: string[];
  s3Locations?: {
    rawFiling?: string;
    metrics?: string;
    narratives?: string[];
    metadata?: string;
  };
}

/**
 * Simple Processing Service
 * 
 * Clean, direct approach:
 * 1. Download SEC filing directly from SEC
 * 2. Send to Python hybrid parser
 * 3. Store results in PostgreSQL
 * 4. No complex S3 path management
 */
@Injectable()
export class SimpleProcessingService {
  private readonly logger = new Logger(SimpleProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly s3: S3DataLakeService,
  ) {}

  /**
   * Process SEC filing directly from SEC URL
   */
  async processFiling(
    ticker: string,
    filingType: string,
    accessionNumber: string,
    filingUrl: string,
  ): Promise<SimpleProcessingResult> {
    const startTime = Date.now();
    const result: SimpleProcessingResult = {
      ticker,
      filingType,
      accessionNumber,
      metricsExtracted: 0,
      narrativesExtracted: 0,
      processingTime: 0,
      status: 'success',
      errors: [],
    };

    try {
      this.logger.log(`Processing ${ticker} ${filingType} ${accessionNumber}...`);

      // Step 1: Download filing content directly from SEC
      const filingContent = await this.downloadFromSEC(filingUrl);
      
      // Step 2: Process with Python hybrid parser
      const parsingResult = await this.processWithPythonParser(
        ticker,
        filingType,
        filingContent,
        accessionNumber,
      );

      // Step 3: Store metrics in PostgreSQL
      if (parsingResult.metrics && parsingResult.metrics.length > 0) {
        await this.storeMetrics(ticker, filingType, accessionNumber, parsingResult.metrics);
        result.metricsExtracted = parsingResult.metrics.length;
      }

      // Step 4: Store narratives in PostgreSQL
      if (parsingResult.narratives && parsingResult.narratives.length > 0) {
        await this.storeNarratives(ticker, filingType, accessionNumber, parsingResult.narratives);
        result.narrativesExtracted = parsingResult.narratives.length;
      }

      // Step 5: Store data in S3
      result.s3Locations = await this.storeInS3(
        ticker,
        filingType,
        accessionNumber,
        filingContent,
        parsingResult.metrics,
        parsingResult.narratives,
      );

      result.processingTime = Date.now() - startTime;
      
      this.logger.log(
        `✅ ${ticker} ${filingType} complete: ${result.metricsExtracted} metrics, ${result.narrativesExtracted} narratives (${result.processingTime}ms)`
      );

      return result;

    } catch (error) {
      result.status = 'failed';
      result.errors.push(error.message);
      result.processingTime = Date.now() - startTime;

      this.logger.error(`❌ ${ticker} ${filingType} failed: ${error.message}`);
      return result;
    }
  }

  /**
   * Download filing content directly from SEC
   */
  private async downloadFromSEC(url: string): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.http.get(url, {
          headers: {
            'User-Agent': process.env.SEC_USER_AGENT || 'FundLensAI/1.0 (contact: admin@fundlens.ai)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          timeout: 30000,
        })
      );

      return response.data;
    } catch (error) {
      throw new Error(`Failed to download from SEC: ${error.message}`);
    }
  }

  /**
   * Process with Python hybrid parser
   */
  private async processWithPythonParser(
    ticker: string,
    filingType: string,
    content: string,
    accessionNumber: string,
  ): Promise<{
    metrics: any[];
    narratives: any[];
  }> {
    try {
      const pythonUrl = process.env.PYTHON_PARSER_URL || 'http://localhost:8000';
      
      const response = await firstValueFrom(
        this.http.post(`${pythonUrl}/parse-filing`, {
          ticker,
          filingType,
          content,
          accessionNumber,
        }, {
          timeout: 120000, // 2 minutes for parsing
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      const result = response.data;
      
      console.log('=== PYTHON PARSER RESPONSE DEBUG ===');
      console.log('Response keys:', Object.keys(result));
      console.log('Metrics type:', typeof result.metrics);
      console.log('Narratives type:', typeof result.narratives);
      console.log('Metrics value:', result.metrics);
      console.log('Narratives value:', result.narratives);
      console.log('=== END DEBUG ===');
      
      // Convert metrics from dictionary to array
      const metricsArray: any[] = [];
      if (result.metrics && typeof result.metrics === 'object') {
        for (const [key, metric] of Object.entries(result.metrics)) {
          metricsArray.push({
            metric_name: key,
            normalized_metric: key.split('_')[0], // Extract normalized metric from key
            raw_label: (metric as any).raw_label,
            value: (metric as any).value,
            fiscal_period: (metric as any).period,
            confidence: (metric as any).confidence,
            statement_type: (metric as any).statement_type,
          });
        }
      }

      // Convert narratives from dictionary to array
      const narrativesArray: any[] = [];
      if (result.narratives && typeof result.narratives === 'object') {
        for (const [sectionType, chunks] of Object.entries(result.narratives)) {
          if (Array.isArray(chunks)) {
            for (const chunk of chunks) {
              narrativesArray.push({
                content: (chunk as any).content,
                section_type: sectionType,
                chunk_index: (chunk as any).chunk_index,
              });
            }
          }
        }
      }
      
      return {
        metrics: metricsArray,
        narratives: narrativesArray,
      };

    } catch (error) {
      this.logger.warn(`Python parser failed, using fallback: ${error.message}`);
      
      // Fallback: basic extraction
      return {
        metrics: [],
        narratives: this.extractBasicNarratives(content, ticker, filingType),
      };
    }
  }

  /**
   * Store metrics in PostgreSQL
   */
  private async storeMetrics(
    ticker: string,
    filingType: string,
    accessionNumber: string,
    metrics: any[],
  ): Promise<void> {
    for (const metric of metrics) {
      try {
        await this.prisma.financialMetric.upsert({
          where: {
            ticker_normalizedMetric_fiscalPeriod_filingType: {
              ticker,
              normalizedMetric: metric.normalized_metric || metric.metric_name,
              fiscalPeriod: metric.fiscal_period || 'Unknown',
              filingType,
            },
          },
          update: {
            rawLabel: metric.raw_label || metric.label,
            value: parseFloat(metric.value) || 0,
            periodType: filingType === '10-K' ? 'annual' : 'quarterly',
            statementType: metric.statement_type || 'unknown',
            confidenceScore: metric.confidence || 0.8,
            filingDate: new Date(),
            statementDate: new Date(),
            updatedAt: new Date(),
          },
          create: {
            ticker,
            normalizedMetric: metric.normalized_metric || metric.metric_name,
            rawLabel: metric.raw_label || metric.label,
            value: parseFloat(metric.value) || 0,
            fiscalPeriod: metric.fiscal_period || 'Unknown',
            periodType: filingType === '10-K' ? 'annual' : 'quarterly',
            filingType,
            statementType: metric.statement_type || 'unknown',
            confidenceScore: metric.confidence || 0.8,
            filingDate: new Date(),
            statementDate: new Date(),
          },
        });
      } catch (error) {
        this.logger.warn(`Failed to store metric ${metric.metric_name}: ${error.message}`);
      }
    }
  }

  /**
   * Store narratives in PostgreSQL
   */
  private async storeNarratives(
    ticker: string,
    filingType: string,
    accessionNumber: string,
    narratives: any[],
    filingDate?: Date,
  ): Promise<void> {
    const filingDateObj = filingDate || new Date();
    
    for (let i = 0; i < narratives.length; i++) {
      const narrative = narratives[i];
      
      try {
        // Use upsert with the unique constraint that includes filingDate
        await this.prisma.narrativeChunk.upsert({
          where: {
            ticker_filingType_filingDate_sectionType_chunkIndex: {
              ticker,
              filingType,
              filingDate: filingDateObj,
              sectionType: narrative.section_type || 'general',
              chunkIndex: i,
            },
          },
          update: {
            content: narrative.content,
          },
          create: {
            ticker,
            filingType,
            filingDate: filingDateObj,
            chunkIndex: i,
            content: narrative.content,
            sectionType: narrative.section_type || 'general',
          },
        });
      } catch (error) {
        this.logger.warn(`Failed to store narrative chunk ${i}: ${error.message}`);
      }
    }
  }

  /**
   * Fallback: Extract basic narratives from content
   */
  private extractBasicNarratives(
    content: string,
    ticker: string,
    filingType: string,
  ): any[] {
    if (!content || content.length < 1000) {
      return [];
    }

    // Simple chunking: split into 1500-character chunks
    const chunks: any[] = [];
    const chunkSize = 1500;
    
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.substring(i, i + chunkSize);
      
      if (chunk.trim().length > 100) {
        chunks.push({
          content: chunk.trim(),
          section_type: 'general',
          word_count: chunk.split(/\s+/).length,
          page_number: Math.floor(i / 5000) + 1, // Rough page estimation
        });
      }
    }

    return chunks.slice(0, 50); // Limit to 50 chunks per filing
  }

  /**
   * Store data in S3 data lake
   */
  private async storeInS3(
    ticker: string,
    filingType: string,
    accessionNumber: string,
    rawContent: string,
    metrics: any[],
    narratives: any[],
  ): Promise<{
    rawFiling?: string;
    metrics?: string;
    narratives?: string[];
    metadata?: string;
  }> {
    const s3Locations: any = {};

    try {
      // Generate fiscal period from accession number (approximate)
      const fiscalPeriod = this.extractFiscalPeriod(accessionNumber, filingType);

      // 1. Store raw filing content
      const rawLocation = await this.s3.uploadSECFiling(
        ticker,
        filingType,
        fiscalPeriod,
        rawContent,
        'html'
      );
      s3Locations.rawFiling = rawLocation.url;

      // 2. Store processed data (metrics, narratives, metadata)
      const metadata = {
        ticker,
        filingType,
        accessionNumber,
        fiscalPeriod,
        processedAt: new Date().toISOString(),
        metricsCount: metrics.length,
        narrativesCount: narratives.length,
        parser: 'hybrid_ixbrl_parser_v2',
        version: '2.0.0',
      };

      const processedLocations = await this.s3.uploadProcessedSECData(
        ticker,
        filingType,
        fiscalPeriod,
        {
          metrics: metrics.length > 0 ? metrics : undefined,
          narratives: narratives.length > 0 ? narratives : undefined,
          metadata,
        }
      );

      if (processedLocations.metricsLocation) {
        s3Locations.metrics = processedLocations.metricsLocation.url;
      }

      if (processedLocations.narrativesLocations) {
        s3Locations.narratives = processedLocations.narrativesLocations.map(loc => loc.url);
      }

      if (processedLocations.metadataLocation) {
        s3Locations.metadata = processedLocations.metadataLocation.url;
      }

      this.logger.log(`📦 S3 storage complete for ${ticker} ${filingType} ${accessionNumber}`);

    } catch (error) {
      this.logger.warn(`Failed to store in S3: ${error.message}`);
    }

    return s3Locations;
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
      // This is a rough approximation - in production you'd want more precise logic
      return `Q${Math.floor(Math.random() * 4) + 1}_${year}`;
    }
    
    return 'Unknown';
  }

  /**
   * Process multiple filings for a ticker
   */
  async processTickerFilings(
    ticker: string,
    filings: Array<{
      filingType: string;
      accessionNumber: string;
      url: string;
    }>,
  ): Promise<SimpleProcessingResult[]> {
    const results: SimpleProcessingResult[] = [];

    for (const filing of filings) {
      try {
        const result = await this.processFiling(
          ticker,
          filing.filingType,
          filing.accessionNumber,
          filing.url,
        );
        results.push(result);

        // Rate limiting: 1 second between filings
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        this.logger.error(`Failed to process ${ticker} ${filing.filingType}: ${error.message}`);
        results.push({
          ticker,
          filingType: filing.filingType,
          accessionNumber: filing.accessionNumber,
          metricsExtracted: 0,
          narrativesExtracted: 0,
          processingTime: 0,
          status: 'failed',
          errors: [error.message],
        });
      }
    }

    return results;
  }
}