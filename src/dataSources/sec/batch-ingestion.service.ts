import { Injectable, Logger } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface BatchIngestionResult {
  ticker: string;
  status: 'success' | 'failed' | 'skipped';
  metricsCount?: number;
  chunksCount?: number;
  error?: string;
  duration?: number;
}

export interface BatchProgress {
  total: number;
  completed: number;
  successful: number;
  failed: number;
  results: BatchIngestionResult[];
  startTime: Date;
  endTime?: Date;
}

@Injectable()
export class BatchIngestionService {
  private readonly logger = new Logger(BatchIngestionService.name);
  private batchProgress: Map<string, BatchProgress> = new Map();

  constructor(
    private readonly ingestionService: IngestionService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Ingest multiple companies in parallel
   */
  async ingestBatch(
    tickers: string[],
    options: {
      maxConcurrent?: number;
      skipExisting?: boolean;
    } = {},
  ): Promise<{ batchId: string; progress: BatchProgress }> {
    const batchId = `batch_${Date.now()}`;
    const maxConcurrent = options.maxConcurrent || 3;
    const skipExisting = options.skipExisting ?? true;

    this.logger.log(
      `🚀 Starting batch ingestion for ${tickers.length} companies (max ${maxConcurrent} concurrent)`,
    );

    // Initialize progress tracking
    const progress: BatchProgress = {
      total: tickers.length,
      completed: 0,
      successful: 0,
      failed: 0,
      results: [],
      startTime: new Date(),
    };

    this.batchProgress.set(batchId, progress);

    // Process tickers in batches
    const results: BatchIngestionResult[] = [];

    for (let i = 0; i < tickers.length; i += maxConcurrent) {
      const batch = tickers.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(
        batch.map((ticker) =>
          this.ingestSingleCompany(ticker, skipExisting),
        ),
      );

      results.push(...batchResults);

      // Update progress
      progress.completed += batch.length;
      progress.successful = results.filter((r) => r.status === 'success').length;
      progress.failed = results.filter((r) => r.status === 'failed').length;
      progress.results = results;

      this.logger.log(
        `📊 Progress: ${progress.completed}/${progress.total} (${progress.successful} successful, ${progress.failed} failed)`,
      );
    }

    progress.endTime = new Date();
    this.batchProgress.set(batchId, progress);

    this.logger.log(
      `✅ Batch ingestion complete: ${progress.successful}/${progress.total} successful`,
    );

    return { batchId, progress };
  }

  /**
   * Ingest a single company
   */
  private async ingestSingleCompany(
    ticker: string,
    skipExisting: boolean,
  ): Promise<BatchIngestionResult> {
    const startTime = Date.now();
    const upperTicker = ticker.toUpperCase();

    try {
      this.logger.log(`📥 Processing ${upperTicker}...`);

      // Get CIK for ticker
      const cikResponse = await fetch(
        `http://localhost:3000/api/sec/lookup?ticker=${upperTicker}`,
      );

      if (!cikResponse.ok) {
        throw new Error(`Failed to lookup CIK for ${upperTicker}`);
      }

      const { cik } = await cikResponse.json();

      // Get submissions to find 10-K filings
      const submissionsResponse = await fetch(
        `http://localhost:3000/api/sec/submissions?cik=${cik}`,
      );

      if (!submissionsResponse.ok) {
        throw new Error(`Failed to get submissions for ${upperTicker}`);
      }

      const submissions = await submissionsResponse.json();
      const filings = submissions.filings?.recent;

      if (!filings || !filings.form) {
        throw new Error(`No filings found for ${upperTicker}`);
      }

      // Find ALL 10-K filings (up to 3 years)
      const tenKIndices: number[] = [];
      for (let i = 0; i < filings.form.length && tenKIndices.length < 3; i++) {
        if (filings.form[i] === '10-K') {
          tenKIndices.push(i);
        }
      }

      if (tenKIndices.length === 0) {
        throw new Error(`No 10-K filing found for ${upperTicker}`);
      }

      this.logger.log(`📄 Found ${tenKIndices.length} 10-K filings for ${upperTicker}`);

      let totalMetrics = 0;
      let totalChunks = 0;
      let processedFilings = 0;

      // Process each 10-K filing
      for (const tenKIndex of tenKIndices) {
        const accessionNumber = filings.accessionNumber[tenKIndex];
        const filingDate = filings.filingDate[tenKIndex];
        const primaryDocument = filings.primaryDocument[tenKIndex];

        // Check if already processed
        if (skipExisting) {
          const existing = await this.prisma.filingMetadata.findFirst({
            where: {
              ticker: upperTicker,
              filingType: '10-K',
              filingDate: new Date(filingDate),
              processed: true,
            },
          });

          if (existing) {
            this.logger.log(`⏭️  ${upperTicker} 10-K ${filingDate} already processed, skipping`);
            continue;
          }
        }

        // Build filing URL
        const accessionNoFormatted = accessionNumber.replace(/-/g, '');
        const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cik.replace(/^0+/, '')}/${accessionNoFormatted}/${primaryDocument}`;

        this.logger.log(`📄 Processing 10-K for ${upperTicker}: ${filingDate}`);

        // Ingest the filing
        const result = await this.ingestionService.ingestFiling(
          upperTicker,
          cik,
          filingUrl,
          '10-K',
          filingDate,
        );

        totalMetrics += result.parsing_results?.saved_metrics || 0;
        totalChunks += result.parsing_results?.saved_chunks || 0;
        processedFilings++;
      }

      const duration = Date.now() - startTime;

      if (processedFilings === 0 && skipExisting) {
        this.logger.log(`⏭️  ${upperTicker} all filings already processed`);
        return {
          ticker: upperTicker,
          status: 'skipped',
          duration,
        };
      }

      this.logger.log(
        `✅ ${upperTicker} completed: ${processedFilings} filings, ${totalMetrics} metrics in ${(duration / 1000).toFixed(1)}s`,
      );

      return {
        ticker: upperTicker,
        status: 'success',
        metricsCount: totalMetrics,
        chunksCount: totalChunks,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ ${upperTicker} failed: ${error.message}`);

      return {
        ticker: upperTicker,
        status: 'failed',
        error: error.message,
        duration,
      };
    }
  }

  /**
   * Get batch progress
   */
  getBatchProgress(batchId: string): BatchProgress | null {
    return this.batchProgress.get(batchId) || null;
  }

  /**
   * Get all available tickers with stats
   */
  async getIngestedTickers(): Promise<
    Array<{
      ticker: string;
      metricsCount: number;
      chunksCount: number;
      latestFiling: string;
    }>
  > {
    const tickers = await this.prisma.filingMetadata.findMany({
      where: { processed: true },
      select: {
        ticker: true,
        filingDate: true,
        metricsCount: true,
        chunksCount: true,
      },
      orderBy: { ticker: 'asc' },
    });

    // Group by ticker and get latest
    const tickerMap = new Map();

    for (const filing of tickers) {
      if (
        !tickerMap.has(filing.ticker) ||
        new Date(filing.filingDate) >
          new Date(tickerMap.get(filing.ticker).filingDate)
      ) {
        tickerMap.set(filing.ticker, filing);
      }
    }

    return Array.from(tickerMap.values()).map((filing) => ({
      ticker: filing.ticker,
      metricsCount: filing.metricsCount,
      chunksCount: filing.chunksCount,
      latestFiling: filing.filingDate.toISOString().split('T')[0],
    }));
  }
}
