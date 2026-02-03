import { Injectable, Logger } from '@nestjs/common';
import { SecService } from './sec.service';
import { IngestionService } from './ingestion.service';
import { PrismaService } from '../../../prisma/prisma.service';


export interface HydrationConfig {
  tickers: string[];
  startYear: number;
  endYear: number;
  filingTypes: string[];
  maxConcurrent: number;
  skipExisting: boolean;
}

export interface HydrationProgress {
  ticker: string;
  year: number;
  filingType: string;
  status: 'pending' | 'downloading' | 'processing' | 'completed' | 'failed';
  filingsFound: number;
  filingsProcessed: number;
  metricsExtracted: number;
  chunksExtracted: number;
  error?: string;
  duration?: number;
}

export interface HydrationSummary {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalFilings: number;
  totalMetrics: number;
  totalChunks: number;
  startTime: Date;
  endTime?: Date;
  estimatedCompletion?: Date;
  progress: HydrationProgress[];
}

/**
 * Historical Data Hydration Service
 * 
 * Systematically downloads and processes 7 years of SEC filings
 * for multiple companies across all filing types (10-K, 10-Q, 8-K)
 */
@Injectable()
export class HistoricalHydrationService {
  private readonly logger = new Logger(HistoricalHydrationService.name);
  private hydrationSummary: HydrationSummary | null = null;

  constructor(
    private readonly secService: SecService,
    private readonly ingestionService: IngestionService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Start comprehensive historical data hydration
   */
  async startHydration(config: HydrationConfig): Promise<HydrationSummary> {
    this.logger.log(`🚀 Starting historical data hydration for ${config.tickers.length} companies`);
    this.logger.log(`📅 Timeline: ${config.startYear}-${config.endYear} (${config.endYear - config.startYear + 1} years)`);
    this.logger.log(`📋 Filing types: ${config.filingTypes.join(', ')}`);

    // Initialize progress tracking
    const tasks = this.generateHydrationTasks(config);
    this.hydrationSummary = {
      totalTasks: tasks.length,
      completedTasks: 0,
      failedTasks: 0,
      totalFilings: 0,
      totalMetrics: 0,
      totalChunks: 0,
      startTime: new Date(),
      progress: tasks,
    };

    this.logger.log(`📊 Generated ${tasks.length} hydration tasks`);

    // Process tasks in batches to avoid overwhelming the system
    const batchSize = config.maxConcurrent;
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      
      this.logger.log(`🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(tasks.length / batchSize)} (${batch.length} tasks)`);
      
      await Promise.allSettled(
        batch.map(task => this.processHydrationTask(task, config))
      );

      // Update progress
      this.updateEstimatedCompletion();
      
      // Brief pause between batches to avoid rate limiting
      if (i + batchSize < tasks.length) {
        await this.sleep(2000);
      }
    }

    this.hydrationSummary.endTime = new Date();
    this.logger.log(`✅ Historical hydration completed in ${this.formatDuration(this.hydrationSummary.startTime, this.hydrationSummary.endTime)}`);
    
    return this.hydrationSummary;
  }

  /**
   * Generate all hydration tasks
   */
  private generateHydrationTasks(config: HydrationConfig): HydrationProgress[] {
    const tasks: HydrationProgress[] = [];

    for (const ticker of config.tickers) {
      for (let year = config.startYear; year <= config.endYear; year++) {
        for (const filingType of config.filingTypes) {
          tasks.push({
            ticker,
            year,
            filingType,
            status: 'pending',
            filingsFound: 0,
            filingsProcessed: 0,
            metricsExtracted: 0,
            chunksExtracted: 0,
          });
        }
      }
    }

    return tasks;
  }

  /**
   * Process a single hydration task
   */
  private async processHydrationTask(
    task: HydrationProgress,
    config: HydrationConfig
  ): Promise<void> {
    const startTime = Date.now();
    task.status = 'downloading';

    try {
      this.logger.log(`📥 Processing ${task.ticker} ${task.filingType} ${task.year}`);

      // Step 1: Search for filings in the specific year
      const startDate = `${task.year}-01-01`;
      const endDate = `${task.year}-12-31`;

      // Get CIK for ticker first
      const cikResult = await this.secService.getCikForTicker(task.ticker);
      if (!cikResult.cik) {
        throw new Error(`Could not find CIK for ticker ${task.ticker}`);
      }

      const searchResult = await this.secService.getFillings(cikResult.cik, {
        startDate,
        endDate,
        formType: task.filingType,
        includeOlderPages: true,
      });

      // Get the appropriate filing array based on type
      let filings: any[] = [];
      if (task.filingType === '10-K') {
        filings = searchResult.filings.tenK || [];
      } else if (task.filingType === '10-Q') {
        filings = searchResult.filings.tenQ || [];
      } else if (task.filingType === '8-K') {
        filings = searchResult.filings.eightK || [];
      }

      task.filingsFound = filings.length;

      if (task.filingsFound === 0) {
        task.status = 'completed';
        this.logger.log(`ℹ️  No ${task.filingType} filings found for ${task.ticker} in ${task.year}`);
        return;
      }

      task.status = 'processing';

      // Step 2: Process each filing
      let processedCount = 0;
      let totalMetrics = 0;
      let totalChunks = 0;

      for (const filing of filings) {
        try {
          // Check if already processed (if skipExisting is true)
          if (config.skipExisting) {
            const existing = await this.prisma.filingMetadata.findFirst({
              where: {
                ticker: task.ticker,
                filingType: task.filingType,
                filingDate: new Date(filing.filingDate),
              },
            });

            if (existing?.processed) {
              this.logger.debug(`⏭️  Skipping already processed filing: ${filing.accessionNumber}`);
              processedCount++;
              continue;
            }
          }

          // Process the filing
          const result = await this.ingestionService.ingestFiling(
            task.ticker,
            cikResult.cik,
            filing.url || filing.primaryDocument,
            task.filingType,
            filing.filingDate,
          );

          if (result.status === 'success' || result.status === 'already_processed') {
            totalMetrics += result.metrics_count || result.parsing_results?.saved_metrics || 0;
            totalChunks += result.parsing_results?.saved_chunks || 0;
            processedCount++;
          }

        } catch (filingError) {
          this.logger.warn(`⚠️  Failed to process filing ${filing.accessionNumber}: ${filingError.message}`);
        }
      }

      // Update task results
      task.filingsProcessed = processedCount;
      task.metricsExtracted = totalMetrics;
      task.chunksExtracted = totalChunks;
      task.status = 'completed';
      task.duration = Date.now() - startTime;

      // Update summary
      this.hydrationSummary!.completedTasks++;
      this.hydrationSummary!.totalFilings += processedCount;
      this.hydrationSummary!.totalMetrics += totalMetrics;
      this.hydrationSummary!.totalChunks += totalChunks;

      this.logger.log(
        `✅ Completed ${task.ticker} ${task.filingType} ${task.year}: ` +
        `${processedCount}/${task.filingsFound} filings, ${totalMetrics} metrics, ${totalChunks} chunks ` +
        `(${this.formatDuration(startTime, Date.now())})`
      );

    } catch (error) {
      task.status = 'failed';
      task.error = error.message;
      task.duration = Date.now() - startTime;
      this.hydrationSummary!.failedTasks++;

      this.logger.error(`❌ Failed ${task.ticker} ${task.filingType} ${task.year}: ${error.message}`);
    }
  }

  /**
   * Get current hydration progress
   */
  getProgress(): HydrationSummary | null {
    return this.hydrationSummary;
  }

  /**
   * Get detailed progress for a specific ticker
   */
  getTickerProgress(ticker: string): HydrationProgress[] {
    if (!this.hydrationSummary) return [];
    
    return this.hydrationSummary.progress.filter(p => p.ticker === ticker);
  }

  /**
   * Update estimated completion time
   */
  private updateEstimatedCompletion(): void {
    if (!this.hydrationSummary) return;

    const { completedTasks, totalTasks, startTime } = this.hydrationSummary;
    
    if (completedTasks > 0) {
      const elapsed = Date.now() - startTime.getTime();
      const avgTimePerTask = elapsed / completedTasks;
      const remainingTasks = totalTasks - completedTasks;
      const estimatedRemainingTime = remainingTasks * avgTimePerTask;
      
      this.hydrationSummary.estimatedCompletion = new Date(Date.now() + estimatedRemainingTime);
    }
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(start: number | Date, end: number | Date): string {
    const startTime = typeof start === 'number' ? start : start.getTime();
    const endTime = typeof end === 'number' ? end : end.getTime();
    const duration = endTime - startTime;
    
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((duration % (1000 * 60)) / 1000);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate summary report
   */
  generateReport(): string {
    if (!this.hydrationSummary) return 'No hydration in progress';

    const { totalTasks, completedTasks, failedTasks, totalFilings, totalMetrics, totalChunks } = this.hydrationSummary;
    const successRate = ((completedTasks / totalTasks) * 100).toFixed(1);

    return `
📊 Historical Data Hydration Report
=====================================

📈 Overall Progress: ${completedTasks}/${totalTasks} tasks (${successRate}%)
❌ Failed Tasks: ${failedTasks}
📄 Total Filings Processed: ${totalFilings.toLocaleString()}
📊 Total Metrics Extracted: ${totalMetrics.toLocaleString()}
📝 Total Chunks Created: ${totalChunks.toLocaleString()}

⏱️  Duration: ${this.hydrationSummary.endTime ? 
  this.formatDuration(this.hydrationSummary.startTime, this.hydrationSummary.endTime) : 
  'In progress...'}

${this.hydrationSummary.estimatedCompletion ? 
  `🔮 Estimated Completion: ${this.hydrationSummary.estimatedCompletion.toLocaleString()}` : ''}
`;
  }
}