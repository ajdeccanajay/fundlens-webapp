import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3DataLakeService } from './s3-data-lake.service';
import { PerformanceOptimizerService } from '../rag/performance-optimizer.service';
import { IngestionValidationService } from './ingestion-validation.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface ProcessingResult {
  ticker: string;
  filingType: string;
  accessionNumber: string;
  metricsExtracted: number;
  narrativesExtracted: number;
  processingTime: number;
  status: 'success' | 'partial' | 'failed';
  errors: string[];
}

export interface ExtractedMetric {
  normalizedMetric: string;
  value: number;
  unit?: string;
  period: string;
  confidence: number;
  rawLabel: string;
  source: string;
}

export interface ExtractedNarrative {
  sectionType: string;
  content: string;
  chunkIndex: number;
  wordCount: number;
  pageNumber?: number;
}

/**
 * SEC Processing Service
 * Processes downloaded SEC filings to extract metrics and narratives
 */
@Injectable()
export class SECProcessingService {
  private readonly logger = new Logger(SECProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3DataLakeService,
    private readonly http: HttpService,
    private readonly performanceOptimizer: PerformanceOptimizerService,
    @Optional() @Inject(IngestionValidationService) private readonly ingestionValidator?: IngestionValidationService,
  ) {}

  /**
   * Process a specific SEC filing
   */
  async processFiling(
    ticker: string,
    filingType: string,
    accessionNumber: string,
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    const result: ProcessingResult = {
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
      this.logger.log(
        `Processing ${ticker} ${filingType} ${accessionNumber}...`,
      );

      // 1. Download the raw filing from S3
      const rawContent = await this.downloadRawFiling(
        ticker,
        filingType,
        accessionNumber,
      );

      // 2. Extract metrics using Python parser
      const metrics = await this.extractMetrics(
        ticker,
        filingType,
        rawContent,
        accessionNumber,
      );
      result.metricsExtracted = metrics.length;

      // 3. Extract narratives
      const narratives = await this.extractNarratives(
        ticker,
        filingType,
        rawContent,
        accessionNumber,
      );
      result.narrativesExtracted = narratives.length;

      // 4. Store processed data in S3
      await this.storeProcessedData(
        ticker,
        filingType,
        accessionNumber,
        metrics,
        narratives,
      );

      // 5. Store metrics in PostgreSQL
      await this.storeMetricsInDatabase(
        ticker,
        filingType,
        accessionNumber,
        metrics,
      );

      // 6. Store narrative references in PostgreSQL
      await this.storeNarrativeReferences(
        ticker,
        filingType,
        accessionNumber,
        narratives,
      );

      // 7. Mark filing as processed
      await this.markFilingAsProcessed(ticker, filingType, accessionNumber);

      // 8. Invalidate cached RAG responses for this ticker
      this.performanceOptimizer.invalidateByTicker(ticker);

      result.processingTime = Date.now() - startTime;
      this.logger.log(
        `Processing complete: ${result.metricsExtracted} metrics, ${result.narrativesExtracted} narratives (${result.processingTime}ms)`,
      );

      return result;
    } catch (error) {
      result.status = 'failed';
      result.errors.push(error.message);
      result.processingTime = Date.now() - startTime;

      this.logger.error(
        `Processing failed for ${ticker} ${filingType} ${accessionNumber}: ${error.message}`,
      );

      return result;
    }
  }

  /**
   * Download raw filing content from S3
   */
  private async downloadRawFiling(
    ticker: string,
    filingType: string,
    accessionNumber: string,
  ): Promise<string> {
    // The S3 path uses accessionNumber as the "fiscalPeriod" parameter
    // This is how the sync service stores it
    const s3Path = this.s3.getSECFilingPath(
      ticker,
      filingType,
      accessionNumber,
      'raw',
    );

    // Try different file extensions and naming patterns
    const filePatterns = [
      'filing.html',
      'filing.xml', 
      'filing.txt',
      `${accessionNumber}.html`,
      `${accessionNumber}.xml`,
      `${accessionNumber}.txt`,
      'document.html',
      'document.xml'
    ];
    
    for (const pattern of filePatterns) {
      const key = `${s3Path}/${pattern}`;
      try {
        this.logger.debug(`Trying to download: ${key}`);
        const buffer = await this.s3.download(key);
        this.logger.log(`Successfully downloaded filing from: ${key}`);
        return buffer.toString('utf-8');
      } catch (error) {
        // Try next pattern
        this.logger.debug(`Failed to download ${key}: ${error.message}`);
        continue;
      }
    }

    // If all patterns fail, try to list what's actually in the S3 path
    try {
      this.logger.warn(`No filing found with standard patterns. Listing S3 path: ${s3Path}`);
      const files = await this.s3.listFiles(s3Path);
      this.logger.warn(`Files found in ${s3Path}: ${files.join(', ')}`);
      
      // Try to download the first file we find
      if (files.length > 0) {
        const firstFile = files[0];
        this.logger.log(`Attempting to download first available file: ${firstFile}`);
        const buffer = await this.s3.download(firstFile);
        return buffer.toString('utf-8');
      }
    } catch (error) {
      this.logger.debug(`Could not list or download from S3 path: ${error.message}`);
    }

    throw new Error(`No filing content found for ${ticker} ${filingType} ${accessionNumber}. Tried patterns: ${filePatterns.join(', ')}`);
  }

  /**
   * Extract financial metrics using Python parser
   */
  private async extractMetrics(
    ticker: string,
    filingType: string,
    content: string,
    accessionNumber: string,
  ): Promise<ExtractedMetric[]> {
    try {
      // Mock parser disabled — always use Python parser for accurate extraction
      // Try Python parser service
      this.logger.log(`Extracting metrics via Python parser for ${ticker} ${filingType}`);
      const pythonParserUrl = process.env.PYTHON_PARSER_URL || 'http://localhost:8000';
      
      const response = await firstValueFrom(
        this.http.post(`${pythonParserUrl}/parse-filing`, {
          ticker,
          filingType,
          content,
          accessionNumber,
          extractMetrics: true,
          extractNarratives: false, // We'll handle narratives separately
        }, {
          timeout: 10000, // 10 second timeout for processing
        }),
      );

      const parsedData = response.data;
      
      if (!parsedData.success) {
        throw new Error(`Python parser failed: ${parsedData.error}`);
      }

      // Convert parsed metrics to our format
      const metrics: ExtractedMetric[] = [];
      
      if (parsedData.metrics) {
        for (const [label, data] of Object.entries(parsedData.metrics)) {
          if (typeof data === 'object' && data !== null) {
            const metricData = data as any;
            
            metrics.push({
              normalizedMetric: this.normalizeMetricLabel(label),
              value: parseFloat(metricData.value) || 0,
              unit: metricData.unit || 'USD',
              period: this.extractPeriod(metricData, filingType),
              confidence: metricData.confidence || 0.8,
              rawLabel: label,
              source: `${filingType}-${accessionNumber}`,
            });
          }
        }
      }

      return metrics;
    } catch (error) {
      this.logger.error(`Python parser failed for ${ticker} ${filingType}: ${error.message}. Returning empty — filing will need reprocessing.`);
      return [];
    }
  }

  /**
   * Mock metrics extraction for testing
   */
  private extractMetricsMock(
    ticker: string,
    filingType: string,
    content: string,
    accessionNumber: string,
  ): ExtractedMetric[] {
    // Simple regex-based extraction for common metrics
    const metrics: ExtractedMetric[] = [];
    
    // Look for revenue patterns
    const revenuePatterns = [
      /revenue[s]?\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:million|billion)?/gi,
      /net\s+revenue[s]?\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:million|billion)?/gi,
      /total\s+revenue[s]?\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:million|billion)?/gi,
    ];

    for (const pattern of revenuePatterns) {
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        const match = matches[0];
        const valueMatch = match.match(/([\d,]+(?:\.\d+)?)/);
        if (valueMatch) {
          const value = parseFloat(valueMatch[1].replace(/,/g, ''));
          if (value > 0) {
            metrics.push({
              normalizedMetric: 'Revenue',
              value: value * 1000000, // Assume millions
              unit: 'USD',
              period: this.extractPeriod({}, filingType),
              confidence: 0.7,
              rawLabel: match.trim(),
              source: `${filingType}-${accessionNumber}`,
            });
            break; // Only take the first match
          }
        }
      }
    }

    // Look for net income patterns
    const netIncomePatterns = [
      /net\s+income\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:million|billion)?/gi,
      /net\s+earnings\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:million|billion)?/gi,
    ];

    for (const pattern of netIncomePatterns) {
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        const match = matches[0];
        const valueMatch = match.match(/([\d,]+(?:\.\d+)?)/);
        if (valueMatch) {
          const value = parseFloat(valueMatch[1].replace(/,/g, ''));
          if (value > 0) {
            metrics.push({
              normalizedMetric: 'NetIncome',
              value: value * 1000000, // Assume millions
              unit: 'USD',
              period: this.extractPeriod({}, filingType),
              confidence: 0.7,
              rawLabel: match.trim(),
              source: `${filingType}-${accessionNumber}`,
            });
            break; // Only take the first match
          }
        }
      }
    }

    return metrics;
  }

  /**
   * Extract narrative sections from filing
   */
  private async extractNarratives(
    ticker: string,
    filingType: string,
    content: string,
    accessionNumber: string,
  ): Promise<ExtractedNarrative[]> {
    try {
      // Call Python parser for narrative extraction
      const pythonParserUrl = process.env.PYTHON_PARSER_URL || 'http://localhost:8000';
      
      const response = await firstValueFrom(
        this.http.post(`${pythonParserUrl}/parse-filing`, {
          ticker,
          filingType,
          content,
          accessionNumber,
          extractMetrics: false,
          extractNarratives: true,
        }, {
          timeout: 60000,
        }),
      );

      const parsedData = response.data;
      
      if (!parsedData.success) {
        throw new Error(`Python parser failed: ${parsedData.error}`);
      }

      // Convert parsed narratives to our format
      const narratives: ExtractedNarrative[] = [];
      
      if (parsedData.narratives) {
        for (const [sectionType, chunks] of Object.entries(parsedData.narratives)) {
          if (Array.isArray(chunks)) {
            chunks.forEach((chunk: any, index: number) => {
              narratives.push({
                sectionType: this.normalizeSectionType(sectionType),
                content: chunk.content || chunk,
                chunkIndex: index,
                wordCount: this.countWords(chunk.content || chunk),
                pageNumber: chunk.pageNumber,
              });
            });
          }
        }
      }

      return narratives;
    } catch (error) {
      this.logger.error(`Error extracting narratives: ${error.message}`);
      return []; // Return empty array on error
    }
  }

  /**
   * Store processed data in S3
   */
  private async storeProcessedData(
    ticker: string,
    filingType: string,
    accessionNumber: string,
    metrics: ExtractedMetric[],
    narratives: ExtractedNarrative[],
  ): Promise<void> {
    // Store metrics
    if (metrics.length > 0) {
      await this.s3.uploadProcessedSECData(
        ticker,
        filingType,
        accessionNumber,
        { metrics },
      );
    }

    // Store narratives
    if (narratives.length > 0) {
      const narrativeChunks = narratives.map((narrative, index) => ({
        ...narrative,
        metadata: {
          ticker,
          filingType,
          accessionNumber,
          chunkIndex: index,
        },
      }));

      await this.s3.uploadProcessedSECData(
        ticker,
        filingType,
        accessionNumber,
        { narratives: narrativeChunks },
      );
    }
  }

  /**
   * Store metrics in PostgreSQL database
   */
  private async storeMetricsInDatabase(
    ticker: string,
    filingType: string,
    accessionNumber: string,
    metrics: ExtractedMetric[],
  ): Promise<void> {
    for (const metric of metrics) {
      try {
        // Run ingestion validation before writing (Requirement 19)
        let normalizedMetric = metric.normalizedMetric;
        let value = metric.value;
        let confidenceScore = metric.confidence;
        let xbrlTag: string | undefined;
        let canonicalId: string | undefined;

        if (this.ingestionValidator) {
          const validation = await this.ingestionValidator.validate({
            ticker,
            normalizedMetric: metric.normalizedMetric,
            rawLabel: metric.rawLabel,
            value: metric.value,
            fiscalPeriod: metric.period,
            filingType,
            statementType: 'income_statement',
            confidenceScore: metric.confidence,
            xbrlTag: undefined, // XBRL tag from extraction if available
          });

          normalizedMetric = validation.normalizedMetric;
          value = validation.value;
          confidenceScore = validation.confidenceScore;
          xbrlTag = validation.xbrlTag;
          canonicalId = validation.canonicalId;

          if (validation.flags.length > 0) {
            this.logger.debug(
              `Validation flags for ${ticker}/${normalizedMetric}: ${validation.flags.map((f) => f.message).join('; ')}`,
            );
          }
        }

        await this.prisma.financialMetric.upsert({
          where: {
            ticker_normalizedMetric_fiscalPeriod_filingType: {
              ticker,
              normalizedMetric,
              fiscalPeriod: metric.period,
              filingType,
            },
          },
          create: {
            ticker,
            normalizedMetric,
            rawLabel: metric.rawLabel,
            value,
            fiscalPeriod: metric.period,
            periodType: filingType === '10-K' ? 'annual' : 'quarterly',
            filingType,
            statementType: 'income_statement',
            filingDate: new Date(),
            statementDate: new Date(),
            confidenceScore,
            dataSourceId: accessionNumber,
            xbrlTag: xbrlTag || undefined,
          },
          update: {
            rawLabel: metric.rawLabel,
            value,
            confidenceScore,
            statementType: 'income_statement',
            filingDate: new Date(),
            statementDate: new Date(),
            updatedAt: new Date(),
            xbrlTag: xbrlTag || undefined,
          },
        });
      } catch (error) {
        this.logger.error(
          `Error storing metric ${metric.normalizedMetric}: ${error.message}`,
        );
      }
    }
  }

  /**
   * Store narrative references in PostgreSQL
   */
  private async storeNarrativeReferences(
    ticker: string,
    filingType: string,
    accessionNumber: string,
    narratives: ExtractedNarrative[],
    filingDate?: Date,
  ): Promise<void> {
    const filingDateObj = filingDate || new Date();
    
    for (const narrative of narratives) {
      try {
        const s3Path = this.s3.getSECFilingPath(
          ticker,
          filingType,
          accessionNumber,
          'processed',
        );

        await this.prisma.narrativeChunk.upsert({
          where: {
            ticker_filingType_filingDate_sectionType_chunkIndex: {
              ticker,
              filingType,
              filingDate: filingDateObj,
              sectionType: narrative.sectionType,
              chunkIndex: narrative.chunkIndex,
            },
          },
          update: {
            content: narrative.content.substring(0, 10000),
            s3Path: `${s3Path}/narratives/chunk-${narrative.chunkIndex}.json`,
          },
          create: {
            ticker,
            filingType,
            filingDate: filingDateObj,
            sectionType: narrative.sectionType,
            content: narrative.content.substring(0, 10000),
            chunkIndex: narrative.chunkIndex,
            s3Path: `${s3Path}/narratives/chunk-${narrative.chunkIndex}.json`,
            dataSourceId: accessionNumber,
          },
        });
      } catch (error) {
        this.logger.error(
          `Error storing narrative chunk ${narrative.chunkIndex}: ${error.message}`,
        );
      }
    }
  }

  /**
   * Normalize metric labels to standard format
   */
  private normalizeMetricLabel(label: string): string {
    const normalizations: Record<string, string> = {
      'Total Revenue': 'Revenue',
      'Total Revenues': 'Revenue',
      'Net Revenue': 'Revenue',
      'Net Income': 'NetIncome',
      'Net Income (Loss)': 'NetIncome',
      'Total Assets': 'TotalAssets',
      'Total Stockholders Equity': 'StockholdersEquity',
      'Total Stockholder Equity': 'StockholdersEquity',
      'Cash and Cash Equivalents': 'CashAndCashEquivalents',
      'Operating Cash Flow': 'OperatingCashFlow',
      'Free Cash Flow': 'FreeCashFlow',
    };

    return normalizations[label] || label.replace(/[^a-zA-Z0-9]/g, '');
  }

  /**
   * Normalize section types
   */
  private normalizeSectionType(sectionType: string): string {
    const normalizations: Record<string, string> = {
      'management_discussion': 'mda',
      'risk_factors': 'risk_factors',
      'business_overview': 'business',
      'financial_statements': 'financials',
    };

    return normalizations[sectionType] || sectionType.toLowerCase();
  }

  /**
   * Extract fiscal period from metric data
   */
  private extractPeriod(metricData: any, filingType: string): string {
    if (metricData.period) {
      return metricData.period;
    }

    // Default period based on filing type
    const currentYear = new Date().getFullYear();
    return filingType === '10-K' ? `FY${currentYear}` : `Q${Math.ceil(new Date().getMonth() / 3)}${currentYear}`;
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.trim().split(/\s+/).length;
  }

  /**
   * Process all unprocessed filings
   */
  async processAllUnprocessed(): Promise<ProcessingResult[]> {
    // Get all data sources that haven't been processed yet
    // For now, get all SEC filings and filter in memory
    // TODO: Improve this query when Prisma JSON filtering is working better
    const allFilings = await this.prisma.dataSource.findMany({
      where: {
        type: 'sec_filing',
      },
    });

    // Filter unprocessed filings in memory
    const unprocessedFilings = allFilings.filter(filing => {
      const metadata = filing.metadata as any;
      return !metadata?.processed;
    });

    const results: ProcessingResult[] = [];

    for (const filing of unprocessedFilings) {
      try {
        const metadata = filing.metadata as any;
        const result = await this.processFiling(
          metadata.ticker,
          metadata.filingType,
          metadata.accessionNumber,
        );
        results.push(result);

        // Rate limiting
        await this.sleep(1000); // 1 second between processing
      } catch (error) {
        this.logger.error(`Error processing filing ${filing.sourceId}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Mark filing as processed in database
   */
  private async markFilingAsProcessed(
    ticker: string,
    filingType: string,
    accessionNumber: string,
  ): Promise<void> {
    const sourceId = `${ticker}-${filingType}-${accessionNumber}`;
    
    try {
      const existingSource = await this.prisma.dataSource.findUnique({
        where: {
          type_sourceId: {
            type: 'sec_filing',
            sourceId,
          },
        },
      });

      if (existingSource) {
        const updatedMetadata = {
          ...(existingSource.metadata as any),
          processed: true,
          processedAt: new Date().toISOString(),
        };

        await this.prisma.dataSource.update({
          where: {
            type_sourceId: {
              type: 'sec_filing',
              sourceId,
            },
          },
          data: {
            metadata: updatedMetadata,
          },
        });
      }
    } catch (error) {
      this.logger.error(`Error marking filing as processed: ${error.message}`);
    }
  }

  /**
   * Process unprocessed filings for a specific ticker
   */
  async processUnprocessedForTicker(ticker: string): Promise<ProcessingResult[]> {
    // Get all filings for the ticker and filter in memory
    const allFilings = await this.prisma.dataSource.findMany({
      where: {
        type: 'sec_filing',
      },
    });

    // Filter unprocessed filings for this ticker in memory
    const unprocessedFilings = allFilings.filter(filing => {
      const metadata = filing.metadata as any;
      return metadata?.ticker === ticker && !metadata?.processed;
    });

    const results: ProcessingResult[] = [];

    for (const filing of unprocessedFilings) {
      try {
        const metadata = filing.metadata as any;
        const result = await this.processFiling(
          metadata.ticker,
          metadata.filingType,
          metadata.accessionNumber,
        );
        results.push(result);

        // Rate limiting
        await this.sleep(1000); // 1 second between processing
      } catch (error) {
        this.logger.error(`Error processing filing ${filing.sourceId}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}