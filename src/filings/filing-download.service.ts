import { Injectable, Logger } from '@nestjs/common';
import { SECSyncService } from '../s3/sec-sync.service';
import {
  SECProcessingService,
  ProcessingResult,
} from '../s3/sec-processing.service';
import { FilingNotificationService } from './filing-notification.service';
import { SECFiling } from './filing-detector.service';

/**
 * Result of a download + process operation
 */
export interface DownloadResult {
  ticker: string;
  filingType: string;
  accessionNumber: string;
  downloadSuccess: boolean;
  processingResult: ProcessingResult | null;
  notificationsSent: number;
  retryCount: number;
  errors: string[];
}

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Filing Download Service
 *
 * Bridges the FilingDetectorService (which detects new filings) with the
 * existing SEC sync/processing pipeline. Orchestrates the full flow:
 *   1. Download raw filing from SEC EDGAR → S3 (via SECSyncService)
 *   2. Process filing: extract metrics + chunk narratives (via SECProcessingService)
 *   3. Create tenant-scoped notifications (via FilingNotificationService)
 *
 * Implements exponential backoff retries and handles partial failures gracefully.
 * For MVP: processes synchronously (no SQS queue).
 */
@Injectable()
export class FilingDownloadService {
  private readonly logger = new Logger(FilingDownloadService.name);

  constructor(
    private readonly secSyncService: SECSyncService,
    private readonly secProcessingService: SECProcessingService,
    private readonly notificationService: FilingNotificationService,
  ) {}

  /**
   * Queue a filing for download and processing.
   * For MVP: processes synchronously (no SQS queue).
   * Future: will push to SQS for async processing.
   *
   * @param ticker - Company ticker symbol (e.g., 'AAPL')
   * @param filing - SEC filing metadata from the detector
   * @param retryConfig - Optional retry configuration override
   * @returns DownloadResult with status of each step
   */
  async queueDownload(
    ticker: string,
    filing: SECFiling,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
  ): Promise<DownloadResult> {
    this.logger.log(
      `Queuing download: ${ticker} ${filing.form} (accession: ${filing.accessionNumber})`,
    );

    const result: DownloadResult = {
      ticker,
      filingType: filing.form,
      accessionNumber: filing.accessionNumber,
      downloadSuccess: false,
      processingResult: null,
      notificationsSent: 0,
      retryCount: 0,
      errors: [],
    };

    try {
      const downloadResult = await this.downloadAndProcess(
        ticker,
        filing,
        retryConfig,
      );
      return downloadResult;
    } catch (error) {
      this.logger.error(
        `Failed to download and process filing | ticker=${ticker} filingType=${filing.form} accession=${filing.accessionNumber} error=${error.message}`,
      );
      result.errors.push(error.message);
      return result;
    }
  }

  /**
   * Download and process a filing through the full pipeline.
   * Orchestrates: download → process → notify
   *
   * Handles partial failures:
   * - If download fails: throws (will be retried by caller)
   * - If processing fails partially (metrics OK, narratives fail): keeps partial results
   * - If notifications fail: logs error but doesn't fail the whole operation
   *
   * @param ticker - Company ticker symbol
   * @param filing - SEC filing metadata
   * @param retryConfig - Retry configuration
   * @returns DownloadResult with detailed status
   */
  private async downloadAndProcess(
    ticker: string,
    filing: SECFiling,
    retryConfig: RetryConfig,
  ): Promise<DownloadResult> {
    const result: DownloadResult = {
      ticker,
      filingType: filing.form,
      accessionNumber: filing.accessionNumber,
      downloadSuccess: false,
      processingResult: null,
      notificationsSent: 0,
      retryCount: 0,
      errors: [],
    };

    // Step 1: Download raw filing from SEC EDGAR → S3
    // Uses SECSyncService.syncFilingType() which handles download + data source creation
    // Retry with exponential backoff on transient failures
    try {
      await this.executeWithRetry(
        async () => {
          this.logger.log(
            `Downloading filing | ticker=${ticker} filingType=${filing.form} accession=${filing.accessionNumber}`,
          );

          const syncResults = await this.secSyncService.syncTicker(ticker, [
            filing.form,
          ]);

          const syncResult = syncResults[0];
          if (syncResult && syncResult.errors > 0 && syncResult.newFilings === 0) {
            throw new Error(
              `Sync failed for ${ticker} ${filing.form}: ${syncResult.errors} errors, 0 new filings`,
            );
          }

          result.downloadSuccess = true;
          this.logger.log(
            `Download complete | ticker=${ticker} filingType=${filing.form} accession=${filing.accessionNumber}`,
          );
        },
        retryConfig,
        `download ${ticker} ${filing.form} ${filing.accessionNumber}`,
        result,
      );
    } catch (error) {
      // Download failed after all retries
      this.logger.error(
        `Download failed after retries | ticker=${ticker} filingType=${filing.form} accession=${filing.accessionNumber} error=${error.message}`,
      );
      result.errors.push(`Download error: ${error.message}`);
      return result;
    }

    // Step 2: Process filing (extract metrics + chunk narratives)
    // Handles partial failures: if metrics succeed but narratives fail, keeps partial results
    try {
      result.processingResult = await this.executeWithRetry(
        async () => {
          this.logger.log(
            `Processing filing | ticker=${ticker} filingType=${filing.form} accession=${filing.accessionNumber}`,
          );

          const processingResult =
            await this.secProcessingService.processFiling(
              ticker,
              filing.form,
              filing.accessionNumber,
            );

          // Log processing outcome with context
          if (processingResult.status === 'success') {
            this.logger.log(
              `Processing complete | ticker=${ticker} filingType=${filing.form} accession=${filing.accessionNumber} ` +
                `metrics=${processingResult.metricsExtracted} narratives=${processingResult.narrativesExtracted} ` +
                `time=${processingResult.processingTime}ms`,
            );
          } else if (processingResult.status === 'partial') {
            // Partial success: some data was extracted, keep it
            this.logger.warn(
              `Processing partially complete | ticker=${ticker} filingType=${filing.form} accession=${filing.accessionNumber} ` +
                `metrics=${processingResult.metricsExtracted} narratives=${processingResult.narrativesExtracted} ` +
                `errors=${processingResult.errors.join('; ')}`,
            );
            result.errors.push(
              ...processingResult.errors.map(
                (e) => `Processing partial: ${e}`,
              ),
            );
          } else {
            // Full failure
            this.logger.error(
              `Processing failed | ticker=${ticker} filingType=${filing.form} accession=${filing.accessionNumber} ` +
                `errors=${processingResult.errors.join('; ')}`,
            );
            result.errors.push(
              ...processingResult.errors.map((e) => `Processing failed: ${e}`),
            );
          }

          return processingResult;
        },
        retryConfig,
        `process ${ticker} ${filing.form} ${filing.accessionNumber}`,
        result,
      );
    } catch (error) {
      // Processing failed completely after retries - log but continue to check partial results
      this.logger.error(
        `Processing failed after retries | ticker=${ticker} filingType=${filing.form} accession=${filing.accessionNumber} error=${error.message}`,
      );
      result.errors.push(`Processing error: ${error.message}`);
    }

    // Step 3: Create notifications for all tenants with deals for this ticker
    // Only notify if processing was at least partially successful
    const shouldNotify =
      result.processingResult &&
      (result.processingResult.status === 'success' ||
        result.processingResult.status === 'partial');

    if (shouldNotify) {
      try {
        result.notificationsSent =
          await this.notificationService.createNotifications(ticker, {
            form: filing.form,
            filingDate: filing.filingDate,
            reportDate: filing.reportDate,
            accessionNumber: filing.accessionNumber,
          });

        this.logger.log(
          `Notifications sent | ticker=${ticker} filingType=${filing.form} accession=${filing.accessionNumber} count=${result.notificationsSent}`,
        );
      } catch (error) {
        // Notification failure should NOT fail the whole operation
        // The filing is already downloaded and processed
        this.logger.error(
          `Notification creation failed | ticker=${ticker} filingType=${filing.form} accession=${filing.accessionNumber} error=${error.message}`,
        );
        result.errors.push(`Notification error: ${error.message}`);
      }
    } else {
      this.logger.warn(
        `Skipping notifications (processing not successful) | ticker=${ticker} filingType=${filing.form} accession=${filing.accessionNumber}`,
      );
    }

    return result;
  }

  /**
   * Execute an async operation with exponential backoff retry.
   *
   * Delay formula: min(baseDelay * 2^attempt, maxDelay)
   * Example with defaults (base=1s, max=30s):
   *   Attempt 0: immediate
   *   Attempt 1: 1s delay
   *   Attempt 2: 2s delay
   *   Attempt 3: 4s delay
   *
   * @param operation - Async function to execute
   * @param config - Retry configuration
   * @param context - Description for logging
   * @param result - DownloadResult to track retry count
   * @returns The result of the operation
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    config: RetryConfig,
    context: string,
    result: DownloadResult,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Don't retry on final attempt
        if (attempt === config.maxRetries) {
          break;
        }

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          this.logger.warn(
            `Non-retryable error for ${context}: ${error.message}`,
          );
          break;
        }

        // Calculate exponential backoff delay
        const delayMs = Math.min(
          config.baseDelayMs * Math.pow(2, attempt),
          config.maxDelayMs,
        );

        result.retryCount++;

        this.logger.warn(
          `Retry ${attempt + 1}/${config.maxRetries} for ${context} | delay=${delayMs}ms error=${error.message}`,
        );

        await this.sleep(delayMs);
      }
    }

    // All retries exhausted
    this.logger.error(
      `All retries exhausted for ${context} | attempts=${config.maxRetries + 1} lastError=${lastError?.message}`,
    );

    throw lastError || new Error(`Operation failed: ${context}`);
  }

  /**
   * Determine if an error is retryable (transient).
   * Returns true for network errors, timeouts, rate limits, and server errors.
   */
  private isRetryableError(error: any): boolean {
    // Network errors
    if (
      error?.code &&
      ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(
        error.code,
      )
    ) {
      return true;
    }

    // Timeout errors
    if (error?.message?.toLowerCase().includes('timeout')) {
      return true;
    }

    // HTTP status codes that are retryable (rate limit, bad gateway, service unavailable, gateway timeout)
    const status =
      error?.status || error?.response?.status || error?.statusCode;
    if (
      status === 429 ||
      status === 502 ||
      status === 503 ||
      status === 504
    ) {
      return true;
    }

    // Network error messages
    if (error?.message?.toLowerCase().includes('network error')) {
      return true;
    }

    return false;
  }

  /**
   * Promise-based delay for exponential backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
