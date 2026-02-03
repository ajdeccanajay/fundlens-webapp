import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../../../prisma/prisma.service';
import { MetricsService } from './metrics.service';
import { firstValueFrom, timeout, retry, catchError, throwError, timer } from 'rxjs';

/**
 * Ingestion Service - HARDENED
 * 
 * Resilience features:
 * - DB operations with automatic retry on connection errors
 * - Python parser calls with timeout and retry
 * - SEC downloads with timeout and retry
 * - Upsert for all DB writes (handles duplicates gracefully)
 * - Graceful degradation (partial success is OK)
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly PYTHON_PARSER_TIMEOUT = 120000; // 2 minutes for large filings
  private readonly PYTHON_PARSER_RETRIES = 3;
  private readonly DB_RETRY_ATTEMPTS = 3;
  private readonly SEC_DOWNLOAD_TIMEOUT = 60000; // 60 seconds

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService,
  ) {}

  async ingestFiling(
    ticker: string,
    cik: string,
    filingUrl: string,
    filingType: string,
    filingDate: string,
  ) {
    this.logger.log(`📥 Ingesting ${ticker} ${filingType} from ${filingDate}`);

    // Check if already processed (with retry)
    const existing = await this.executeWithRetry(async () => {
      return this.prisma.filingMetadata.findUnique({
        where: {
          ticker_filingType_filingDate: {
            ticker,
            filingType,
            filingDate: new Date(filingDate),
          },
        },
      });
    });

    if (existing?.processed) {
      this.logger.log(`⏭️  Already processed, skipping`);
      return {
        status: 'already_processed',
        filing_id: existing.id,
        metrics_count: existing.metricsCount,
      };
    }

    // Download HTML with retry
    this.logger.log(`📄 Downloading HTML from SEC...`);
    const htmlContent = await this.downloadFromSECWithRetry(filingUrl);
    this.logger.log(`✅ Downloaded ${htmlContent.length} bytes`);

    // Parse with Python API (with timeout and retry)
    this.logger.log(`🔍 Parsing with Python API...`);
    const parsedData = await this.parseWithPythonRetry(htmlContent, ticker, filingType, cik);
    this.logger.log(
      `✅ Parsed: ${parsedData.metadata.total_metrics} metrics, ${parsedData.metadata.total_chunks} narrative chunks`,
    );

    // Save filing metadata (with retry)
    const filingMetadata = await this.executeWithRetry(async () => {
      return this.prisma.filingMetadata.upsert({
        where: {
          ticker_filingType_filingDate: {
            ticker,
            filingType,
            filingDate: new Date(filingDate),
          },
        },
        update: {
          processed: true,
          metricsCount: parsedData.metadata.total_metrics,
          chunksCount: parsedData.metadata.total_chunks,
        },
        create: {
          ticker,
          filingType,
          filingDate: new Date(filingDate),
          cik,
          accessionNo: filingUrl.split('/').slice(-2, -1)[0] || 'unknown',
          filingUrl,
          processed: true,
          metricsCount: parsedData.metadata.total_metrics,
          chunksCount: parsedData.metadata.total_chunks,
        },
      });
    });

    // Save structured metrics with retry and upsert
    let savedMetrics = 0;
    let skippedMetrics = 0;
    if (parsedData.structured_metrics?.length > 0) {
      this.logger.log(`💾 Saving ${parsedData.structured_metrics.length} metrics...`);
      
      for (const metric of parsedData.structured_metrics) {
        try {
          await this.executeWithRetry(async () => {
            return this.prisma.financialMetric.upsert({
              where: {
                ticker_normalizedMetric_fiscalPeriod_filingType: {
                  ticker: metric.ticker,
                  normalizedMetric: metric.normalized_metric,
                  fiscalPeriod: metric.fiscal_period,
                  filingType: metric.filing_type,
                },
              },
              update: {
                value: metric.value,
                rawLabel: metric.raw_label,
                confidenceScore: metric.confidence_score,
                filingDate: new Date(filingDate),
                statementDate: new Date(filingDate),
              },
              create: {
                ticker: metric.ticker,
                normalizedMetric: metric.normalized_metric,
                rawLabel: metric.raw_label,
                value: metric.value,
                fiscalPeriod: metric.fiscal_period,
                periodType: metric.period_type,
                filingType: metric.filing_type,
                statementType: metric.statement_type,
                filingDate: new Date(filingDate),
                statementDate: new Date(filingDate),
                confidenceScore: metric.confidence_score,
              },
            });
          });
          savedMetrics++;
        } catch (error) {
          skippedMetrics++;
          if (!error.message?.includes('Unique constraint')) {
            this.logger.warn(`Failed to save metric ${metric.normalized_metric}: ${error.message}`);
          }
        }
      }
      
      this.logger.log(`✅ Saved ${savedMetrics} metrics (${skippedMetrics} skipped)`);
    }

    // Save narrative chunks with retry and upsert
    let savedChunks = 0;
    let skippedChunks = 0;
    if (parsedData.narrative_chunks?.length > 0) {
      this.logger.log(`💾 Saving ${parsedData.narrative_chunks.length} narrative chunks...`);
      
      const filingDateObj = new Date(filingDate);
      
      for (const chunk of parsedData.narrative_chunks) {
        try {
          await this.executeWithRetry(async () => {
            // Use upsert with the new unique constraint that includes filingDate
            // This ensures chunks from different filings are stored separately
            return this.prisma.narrativeChunk.upsert({
              where: {
                ticker_filingType_filingDate_sectionType_chunkIndex: {
                  ticker: chunk.ticker,
                  filingType: chunk.filing_type,
                  filingDate: filingDateObj,
                  sectionType: chunk.section_type,
                  chunkIndex: chunk.chunk_index,
                },
              },
              update: {
                content: chunk.content,
              },
              create: {
                ticker: chunk.ticker,
                filingType: chunk.filing_type,
                filingDate: filingDateObj,
                sectionType: chunk.section_type,
                chunkIndex: chunk.chunk_index,
                content: chunk.content,
              },
            });
          });
          
          savedChunks++;
        } catch (error) {
          skippedChunks++;
          this.logger.warn(`Failed to save chunk: ${error.message}`);
        }
      }
      
      this.logger.log(`✅ Saved ${savedChunks} chunks (${skippedChunks} skipped/failed)`);
    }

    return {
      status: 'success',
      filing_id: filingMetadata.id,
      parsing_results: {
        total_metrics: parsedData.metadata.total_metrics,
        high_confidence_metrics: parsedData.metadata.high_confidence_metrics,
        total_chunks: parsedData.metadata.total_chunks,
        saved_metrics: savedMetrics,
        saved_chunks: savedChunks,
      },
    };
  }

  /**
   * Download from SEC with timeout and retry
   */
  private async downloadFromSECWithRetry(url: string): Promise<string> {
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await firstValueFrom(
          this.httpService.get(url, {
            headers: {
              'User-Agent': process.env.SEC_USER_AGENT || 'FundLensAI/1.0 (contact: admin@fundlens.ai)',
            },
            timeout: this.SEC_DOWNLOAD_TIMEOUT,
          })
        );
        return response.data;
      } catch (error) {
        const isRetryable = this.isRetryableError(error);
        
        if (isRetryable && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.warn(`SEC download failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${delay}ms...`);
          await this.sleep(delay);
          continue;
        }
        
        throw new Error(`SEC download failed after ${attempt} attempts: ${error.message}`);
      }
    }
    
    throw new Error('SEC download failed: max retries exceeded');
  }

  /**
   * Parse with Python API with timeout and retry
   */
  private async parseWithPythonRetry(
    htmlContent: string,
    ticker: string,
    filingType: string,
    cik: string,
  ): Promise<any> {
    for (let attempt = 1; attempt <= this.PYTHON_PARSER_RETRIES; attempt++) {
      try {
        const response = await firstValueFrom(
          this.httpService.post('http://localhost:8000/sec-parser', {
            html_content: htmlContent,
            ticker,
            filing_type: filingType,
            cik,
          }, {
            timeout: this.PYTHON_PARSER_TIMEOUT,
          })
        );
        
        // Validate response
        if (!response.data || !response.data.metadata) {
          throw new Error('Invalid response from Python parser');
        }
        
        return response.data;
      } catch (error) {
        const isRetryable = this.isRetryableError(error);
        
        if (isRetryable && attempt < this.PYTHON_PARSER_RETRIES) {
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.warn(`Python parser failed (attempt ${attempt}/${this.PYTHON_PARSER_RETRIES}): ${error.message}. Retrying in ${delay}ms...`);
          await this.sleep(delay);
          continue;
        }
        
        throw new Error(`Python parser failed after ${attempt} attempts: ${error.message}`);
      }
    }
    
    throw new Error('Python parser failed: max retries exceeded');
  }

  /**
   * Execute DB operation with retry on connection errors
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= this.DB_RETRY_ATTEMPTS; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const isConnectionError = this.isDBConnectionError(error);
        
        if (isConnectionError && attempt < this.DB_RETRY_ATTEMPTS) {
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.warn(`DB operation failed (attempt ${attempt}/${this.DB_RETRY_ATTEMPTS}): ${error.message}. Retrying in ${delay}ms...`);
          
          // Try to reconnect
          try {
            await this.prisma.$connect();
          } catch (reconnectError) {
            this.logger.warn(`Reconnect failed: ${reconnectError.message}`);
          }
          
          await this.sleep(delay);
          continue;
        }
        
        throw error;
      }
    }
    
    throw new Error('DB operation failed: max retries exceeded');
  }

  /**
   * Check if error is a DB connection error
   */
  private isDBConnectionError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';
    return (
      message.includes('connection') ||
      message.includes('closed') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('enotfound') ||
      error.code === 'P1001' ||
      error.code === 'P1002' ||
      error.code === 'P1008' ||
      error.code === 'P1017'
    );
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';
    return (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('etimedout') ||
      message.includes('enotfound') ||
      message.includes('socket hang up') ||
      message.includes('network') ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNREFUSED'
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
