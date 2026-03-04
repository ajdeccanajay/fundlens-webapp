import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SecService } from '../dataSources/sec/sec.service';
import { RateLimiterService } from './rate-limiter.service';

export interface DetectionResult {
  ticker: string;
  newFilings: number;
  errors: string[];
  rateLimitMetrics?: {
    requestsLastSecond: number;
    totalDelays: number;
    isCompliant: boolean;
  };
}

export interface SECFiling {
  accessionNumber: string;
  filingDate: Date;
  reportDate: Date | null;
  form: string;
  url: string | null;
  primaryDocument: string;
}

export interface FilingDetectionState {
  ticker: string;
  lastCheckDate: Date;
  lastFilingDate?: Date | null;
  checkCount: number;
  consecutiveFailures: number;
}

/**
 * Filing Detector Service
 * Detects new SEC filings using the existing SecService.getFillings() method
 * Implements forward-looking detection (only new filings since last check)
 * Includes rate limiting compliance monitoring
 */
@Injectable()
export class FilingDetectorService {
  private readonly logger = new Logger(FilingDetectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secService: SecService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  /**
   * Detect new filings for a ticker with retry logic
   * Uses SecService.getFillings() to query SEC EDGAR
   * Filters by filing types (10-K, 10-Q, 8-K)
   * Returns only filings since last check date (forward-looking)
   * Implements exponential backoff retry on transient failures
   */
  async detectNewFilings(
    ticker: string,
    filingTypes: string[] = ['10-K', '10-Q', '8-K', '13F-HR', 'DEF 14A', '4', 'S-1'],
    maxRetries: number = 3,
  ): Promise<DetectionResult> {
    this.logger.log(`Detecting new filings for ${ticker}...`);

    // Retry with exponential backoff
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.detectNewFilingsInternal(ticker, filingTypes);
      } catch (error) {
        lastError = error;
        
        // Don't retry on final attempt
        if (attempt === maxRetries) {
          break;
        }

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          this.logger.warn(
            `Non-retryable error for ${ticker}, not retrying: ${error.message}`,
          );
          break;
        }

        // Calculate exponential backoff delay: 2^attempt * 1000ms (1s, 2s, 4s)
        const delayMs = Math.pow(2, attempt) * 1000;
        this.logger.warn(
          `Attempt ${attempt + 1}/${maxRetries + 1} failed for ${ticker}: ${error.message}. ` +
          `Retrying in ${delayMs}ms...`,
        );

        await this.sleep(delayMs);
      }
    }

    // All retries exhausted
    this.logger.error(
      `All ${maxRetries + 1} attempts failed for ${ticker}: ${lastError?.message}`,
    );

    // Update detection state with failure
    const detectionState = await this.getDetectionState(ticker);
    await this.updateDetectionState(ticker, {
      lastCheckDate: new Date(),
      checkCount: (detectionState?.checkCount || 0) + 1,
      consecutiveFailures: (detectionState?.consecutiveFailures || 0) + 1,
    });

    return {
      ticker,
      newFilings: 0,
      errors: [lastError?.message || 'Unknown error'],
    };
  }

  /**
   * Internal method that performs the actual detection logic
   * Separated to enable retry wrapper
   */
  private async detectNewFilingsInternal(
    ticker: string,
    filingTypes: string[],
  ): Promise<DetectionResult> {
    try {
      // Get last check date for forward-looking detection
      const detectionState = await this.getDetectionState(ticker);
      const lastCheckDate = detectionState?.lastCheckDate;

      this.logger.log(
        `Last check date for ${ticker}: ${lastCheckDate ? lastCheckDate.toISOString() : 'never'}`,
      );

      // Get CIK for ticker
      const { cik } = await this.secService.getCikForTicker(ticker);

      // Query SEC EDGAR for filings since last check
      // Use SecService.getFillings() which handles rate limiting and pagination
      const allFilings: SECFiling[] = [];

      for (const filingType of filingTypes) {
        try {
          // Wait for rate limit compliance before making SEC API request
          await this.rateLimiter.waitForRateLimit();

          const filingsResponse = await this.secService.getFillings(cik, {
            formType: filingType,
            startDate: lastCheckDate?.toISOString().split('T')[0], // YYYY-MM-DD format
            includeOlderPages: false, // Only check recent filings for performance
          });

          // Convert response format to SECFiling format
          const filings = filingsResponse.allFilings.map((f) => ({
            accessionNumber: f.accessionNumber,
            filingDate: new Date(f.filingDate),
            reportDate: f.reportDate ? new Date(f.reportDate) : null,
            form: f.form,
            url: f.url,
            primaryDocument: f.primaryDocument,
          }));

          allFilings.push(...filings);

          this.logger.log(
            `Found ${filings.length} ${filingType} filings for ${ticker} since ${lastCheckDate ? lastCheckDate.toISOString().split('T')[0] : 'beginning'}`,
          );
        } catch (error) {
          this.logger.error(
            `Error fetching ${filingType} filings for ${ticker}: ${error.message}`,
          );
          // Continue with other filing types even if one fails
        }
      }

      // Filter out filings we already have in data_sources
      const newFilings = await this.filterNewFilings(ticker, allFilings);

      this.logger.log(
        `Found ${newFilings.length} new filings for ${ticker} (${allFilings.length} total, ${allFilings.length - newFilings.length} already exist)`,
      );

      // Update detection state
      await this.updateDetectionState(ticker, {
        lastCheckDate: new Date(),
        lastFilingDate: newFilings[0]?.filingDate,
        checkCount: (detectionState?.checkCount || 0) + 1,
        consecutiveFailures: 0,
      });

      // Get rate limit metrics for monitoring
      const rateLimitMetrics = this.rateLimiter.getMetrics();

      return {
        ticker,
        newFilings: newFilings.length,
        errors: [],
        rateLimitMetrics: {
          requestsLastSecond: rateLimitMetrics.requestsLastSecond,
          totalDelays: rateLimitMetrics.totalDelays,
          isCompliant: rateLimitMetrics.isCompliant,
        },
      };
    } catch (error) {
      this.logger.error(`Error detecting filings for ${ticker}: ${error.message}`);

      // Update detection state with failure
      const detectionState = await this.getDetectionState(ticker);
      await this.updateDetectionState(ticker, {
        lastCheckDate: new Date(),
        checkCount: (detectionState?.checkCount || 0) + 1,
        consecutiveFailures: (detectionState?.consecutiveFailures || 0) + 1,
      });

      return {
        ticker,
        newFilings: 0,
        errors: [error.message],
      };
    }
  }

  /**
   * Filter out filings that already exist in database
   * Checks data_sources table for existing accession numbers
   */
  private async filterNewFilings(
    ticker: string,
    filings: SECFiling[],
  ): Promise<SECFiling[]> {
    if (filings.length === 0) {
      return [];
    }

    // Get all existing data sources for this ticker
    const existingDataSources = await this.prisma.dataSource.findMany({
      where: {
        type: 'sec_filing',
      },
      select: {
        metadata: true,
      },
    });

    // Build set of existing accession numbers for this ticker
    const existingAccessions = new Set<string>();
    for (const ds of existingDataSources) {
      const metadata = ds.metadata as any;
      if (metadata?.ticker === ticker && metadata?.accessionNumber) {
        existingAccessions.add(metadata.accessionNumber);
      }
    }

    // Filter out filings that already exist
    const newFilings = filings.filter(
      (f) => !existingAccessions.has(f.accessionNumber),
    );

    this.logger.log(
      `Filtered ${ticker}: ${filings.length} total filings, ${existingAccessions.size} already exist, ${newFilings.length} new`,
    );

    return newFilings;
  }

  /**
   * Get detection state for ticker
   */
  private async getDetectionState(
    ticker: string,
  ): Promise<FilingDetectionState | null> {
    return this.prisma.filingDetectionState.findUnique({
      where: { ticker },
    });
  }

  /**
   * Update detection state
   */
  private async updateDetectionState(
    ticker: string,
    data: Partial<FilingDetectionState>,
  ): Promise<void> {
    try {
      await this.prisma.filingDetectionState.upsert({
        where: { ticker },
        create: {
          ticker,
          lastCheckDate: data.lastCheckDate || new Date(),
          lastFilingDate: data.lastFilingDate,
          checkCount: data.checkCount || 0,
          consecutiveFailures: data.consecutiveFailures || 0,
        },
        update: {
          lastCheckDate: data.lastCheckDate,
          lastFilingDate: data.lastFilingDate,
          checkCount: data.checkCount,
          consecutiveFailures: data.consecutiveFailures,
        },
      });
    } catch (error) {
      this.logger.error(
        `Error updating detection state for ${ticker}: ${error.message}`,
      );
    }
  }

  /**
   * Get new filings for download
   * Returns the list of new filings detected
   */
  async getNewFilingsForDownload(ticker: string): Promise<SECFiling[]> {
    const result = await this.detectNewFilings(ticker);
    
    if (result.errors.length > 0) {
      throw new Error(`Detection failed: ${result.errors.join(', ')}`);
    }

    // Re-query to get the actual filing objects
    const detectionState = await this.getDetectionState(ticker);
    const lastCheckDate = detectionState?.lastCheckDate;

    const { cik } = await this.secService.getCikForTicker(ticker);
    const allFilings: SECFiling[] = [];

    for (const filingType of ['10-K', '10-Q', '8-K', '13F-HR', 'DEF 14A', '4', 'S-1']) {
      // Wait for rate limit compliance
      await this.rateLimiter.waitForRateLimit();

      const filingsResponse = await this.secService.getFillings(cik, {
        formType: filingType,
        startDate: lastCheckDate?.toISOString().split('T')[0],
        includeOlderPages: false,
      });

      const filings = filingsResponse.allFilings.map((f) => ({
        accessionNumber: f.accessionNumber,
        filingDate: new Date(f.filingDate),
        reportDate: f.reportDate ? new Date(f.reportDate) : null,
        form: f.form,
        url: f.url,
        primaryDocument: f.primaryDocument,
      }));

      allFilings.push(...filings);
    }

    return this.filterNewFilings(ticker, allFilings);
  }

  /**
   * Get rate limit metrics for monitoring
   */
  getRateLimitMetrics() {
    return this.rateLimiter.getMetrics();
  }

  /**
   * Log rate limit metrics
   */
  logRateLimitMetrics(): void {
    this.rateLimiter.logMetrics();
  }

  /**
   * Determine if an error is retryable (transient)
   * Returns true for network errors, timeouts, and rate limit/service unavailable HTTP status codes
   */
  private isRetryableError(error: any): boolean {
    // Network errors (ECONNRESET, ECONNREFUSED, ETIMEDOUT, etc.)
    if (error?.code && ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code)) {
      return true;
    }

    // Timeout errors
    if (error?.message?.toLowerCase().includes('timeout')) {
      return true;
    }

    // HTTP status codes that are retryable
    const status = error?.status || error?.response?.status || error?.statusCode;
    if (status === 429 || status === 503 || status === 502 || status === 504) {
      return true;
    }

    // Axios/fetch network errors
    if (error?.message?.toLowerCase().includes('network error')) {
      return true;
    }

    return false;
  }

  /**
   * Simple Promise-based delay for exponential backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

}
