import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SECSyncService } from '../s3/sec-sync.service';
import { SECProcessingService } from '../s3/sec-processing.service';
import { FilingNotificationService } from './filing-notification.service';
import { FilingDetectorService } from './filing-detector.service';
import { DistributedLockService } from '../common/distributed-lock.service';
import { OrchestratorAgent } from '../agents/orchestrator.agent';

export interface DetectionSummary {
  totalTickers: number;
  totalNewFilings: number;
  successCount: number;
  errorCount: number;
  duration: number;
  results: DetectionResult[];
}

export interface DetectionResult {
  ticker: string;
  newFilings: number;
  errors: string[];
}

/**
 * Filing Detection Scheduler
 * Runs daily at 6 AM ET to detect and process new SEC filings
 * Uses existing SECSyncService and SECProcessingService
 */
@Injectable()
export class FilingDetectionScheduler {
  private readonly logger = new Logger(FilingDetectionScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly detectorService: FilingDetectorService,
    private readonly secSyncService: SECSyncService,
    private readonly secProcessingService: SECProcessingService,
    private readonly notificationService: FilingNotificationService,
    private readonly lockService: DistributedLockService,
    @Optional() private readonly orchestratorAgent?: OrchestratorAgent,
  ) {}

  /**
   * Daily detection job - runs at 6 AM ET
   * Uses distributed lock to ensure only one ECS container runs this.
   */
  @Cron('0 6 * * *', { timeZone: 'America/New_York' })
  async runDailyDetection(): Promise<DetectionSummary | null> {
    const result = await this.lockService.withLock(
      'filing-detection-daily',
      () => this.executeDetection(),
    );
    return result;
  }

  /**
   * Core detection logic — only runs if this instance holds the lock.
   */
  private async executeDetection(): Promise<DetectionSummary> {
    this.logger.log('Starting daily filing detection...');
    const startTime = Date.now();

    // Get all unique tickers from deals
    const trackedTickers = await this.getTrackedTickers();
    this.logger.log(`Checking ${trackedTickers.length} tickers for new filings`);

    const results: DetectionResult[] = [];

    for (const ticker of trackedTickers) {
      try {
        const result = await this.detectAndProcessForTicker(ticker);
        results.push(result);
      } catch (error) {
        this.logger.error(`Error detecting filings for ${ticker}: ${error.message}`);
        results.push({
          ticker,
          newFilings: 0,
          errors: [error.message],
        });
      }
    }

    const duration = Date.now() - startTime;
    const summary = this.summarizeResults(results, duration);

    // Log rate limit compliance metrics
    this.detectorService.logRateLimitMetrics();

    // §7.1 Change 2: Weekly transcript freshness check (Mondays only)
    if (new Date().getDay() === 1 && this.orchestratorAgent) {
      this.logger.log('📅 Monday — running weekly transcript freshness check');
      for (const ticker of trackedTickers) {
        try {
          const deal = await this.prisma.deal.findFirst({
            where: { ticker: { equals: ticker, mode: 'insensitive' } },
            select: { companyName: true },
          });
          await this.orchestratorAgent.execute({
            ticker,
            companyName: deal?.companyName || ticker,
            type: 'freshness_check',
            triggeredBy: 'scheduled',
          });
          this.logger.log(`🎙️ Transcript freshness check complete for ${ticker}`);
        } catch (error) {
          this.logger.warn(`⚠️ Transcript freshness check failed for ${ticker}: ${error.message}`);
        }
      }
    }

    this.logger.log(
      `Detection complete: ${summary.totalNewFilings} new filings found in ${duration}ms`,
    );

    return summary;
  }

  /**
   * Detect and process new filings for a single ticker
   * Uses FilingDetectorService to detect new filings via SecService.getFillings()
   * Then downloads and processes them using existing services
   */
  private async detectAndProcessForTicker(ticker: string): Promise<DetectionResult> {
    this.logger.log(`Detecting new filings for ${ticker}...`);

    const errors: string[] = [];
    let totalNewFilings = 0;

    try {
      // 1. Use FilingDetectorService to detect new filings
      // This uses SecService.getFillings() to query SEC EDGAR
      // Filters by all supported filing types (10-K, 10-Q, 8-K, 13F-HR, DEF 14A, Form 4, S-1, 40-F, 6-K, F-1)
      // Returns only filings since last check date (forward-looking)
      const detectionResult = await this.detectorService.detectNewFilings(ticker);

      if (detectionResult.errors.length > 0) {
        errors.push(...detectionResult.errors);
        return {
          ticker,
          newFilings: 0,
          errors,
        };
      }

      totalNewFilings = detectionResult.newFilings;

      if (totalNewFilings === 0) {
        this.logger.log(`No new filings found for ${ticker}`);
        return {
          ticker,
          newFilings: 0,
          errors: [],
        };
      }

      // 2. Get the list of new filings to download
      const newFilings = await this.detectorService.getNewFilingsForDownload(ticker);

      // 3. Download and process each new filing
      for (const filing of newFilings) {
        try {
          // Download filing using SECSyncService
          await this.downloadFiling(ticker, filing);

          // Process filing using SECProcessingService
          const processingResult = await this.secProcessingService.processFiling(
            ticker,
            filing.form,
            filing.accessionNumber,
          );

          if (processingResult.status === 'success') {
            // Create notifications for all tenants with deals for this ticker
            await this.notificationService.createNotifications(ticker, {
              form: filing.form,
              filingDate: filing.filingDate,
              reportDate: filing.reportDate,
              accessionNumber: filing.accessionNumber,
            });

            this.logger.log(
              `Successfully processed ${ticker} ${filing.form} ${filing.accessionNumber}`,
            );
          } else {
            errors.push(
              `Processing failed for ${ticker} ${filing.form}: ${processingResult.errors.join(', ')}`,
            );
          }
        } catch (error) {
          errors.push(`Error processing filing ${filing.accessionNumber}: ${error.message}`);
        }
      }
    } catch (error) {
      errors.push(error.message);
    }

    return {
      ticker,
      newFilings: totalNewFilings,
      errors,
    };
  }

  /**
   * Download a filing using SECSyncService
   */
  private async downloadFiling(ticker: string, filing: any): Promise<void> {
    // Use SECSyncService to download and store the filing
    // This handles S3 storage and data_source creation
    await this.secSyncService.syncFilingType(ticker, filing.form);
  }

  /**
   * Get all tickers that have at least one deal
   */
  private async getTrackedTickers(): Promise<string[]> {
    const deals = await this.prisma.deal.findMany({
      where: {
        ticker: { not: null },
      },
      select: { ticker: true },
      distinct: ['ticker'],
    });

    return deals.map((d) => d.ticker).filter(Boolean) as string[];
  }

  /**
   * Summarize detection results
   */
  private summarizeResults(
    results: DetectionResult[],
    duration: number,
  ): DetectionSummary {
    const totalNewFilings = results.reduce((sum, r) => sum + r.newFilings, 0);
    const successCount = results.filter((r) => r.errors.length === 0).length;
    const errorCount = results.filter((r) => r.errors.length > 0).length;

    return {
      totalTickers: results.length,
      totalNewFilings,
      successCount,
      errorCount,
      duration,
      results,
    };
  }

  /**
   * Sleep for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cron health check — runs at 8 AM ET daily (§7.1 Change 3)
   * If the daily 6 AM detection hasn't run in >26 hours, triggers a catch-up.
   */
  @Cron('0 8 * * *', { timeZone: 'America/New_York' })
  async checkCronHealth(): Promise<void> {
    const states = await this.prisma.filingDetectionState.findMany({
      orderBy: { lastCheckDate: 'desc' },
      take: 1,
    });
    if (states.length === 0) return;
    const hoursSince = (Date.now() - states[0].lastCheckDate.getTime()) / 3600000;
    if (hoursSince > 26) {
      this.logger.error(`⚠️ CRON MISSED: ${hoursSince.toFixed(1)}h since last detection run. Triggering catch-up.`);
      await this.runDailyDetection();
    } else {
      this.logger.log(`✅ Cron health check: last detection ${hoursSince.toFixed(1)}h ago — OK`);
    }
  }

  /**
   * Manual trigger for testing (admin only)
   */
  async triggerDetectionForTicker(ticker: string): Promise<DetectionResult> {
    this.logger.log(`Manually triggering detection for ${ticker}...`);
    return this.detectAndProcessForTicker(ticker);
  }

  /**
   * Get detection state for all tracked tickers (admin only)
   */
  async getDetectionStatus(): Promise<any[]> {
    return this.prisma.filingDetectionState.findMany({
      orderBy: { lastCheckDate: 'desc' },
    });
  }

  /**
   * Get a summary of the last detection run (admin only)
   */
  async getDetectionSummary(): Promise<{
    trackedTickers: number;
    tickersWithState: number;
    lastCheckDate: Date | null;
    tickersNeverChecked: number;
    tickersWithFailures: number;
  }> {
    const trackedTickers = await this.getTrackedTickers();
    const allStates = await this.prisma.filingDetectionState.findMany();

    const tickersWithState = allStates.length;
    const lastCheckDate = allStates.length > 0
      ? allStates.reduce((latest, s) =>
          s.lastCheckDate > latest ? s.lastCheckDate : latest,
          allStates[0].lastCheckDate,
        )
      : null;
    const tickersNeverChecked = trackedTickers.filter(
      (t) => !allStates.find((s) => s.ticker === t),
    ).length;
    const tickersWithFailures = allStates.filter(
      (s) => s.consecutiveFailures > 0,
    ).length;

    return {
      trackedTickers: trackedTickers.length,
      tickersWithState,
      lastCheckDate,
      tickersNeverChecked,
      tickersWithFailures,
    };
  }

}
