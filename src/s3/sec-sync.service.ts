import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3DataLakeService } from './s3-data-lake.service';
import { SecService } from '../dataSources/sec/sec.service';

export interface SyncResult {
  ticker: string;
  filingType: string;
  newFilings: number;
  skipped: number;
  errors: number;
  lastFilingDate?: Date;
}

/**
 * SEC Sync Service
 * Handles incremental downloads of SEC filings to S3
 * Only downloads new/updated filings since last sync
 */
@Injectable()
export class SECSyncService {
  private readonly logger = new Logger(SECSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3DataLakeService,
    private readonly secService: SecService,
  ) {}

  /**
   * Sync all filings for a ticker
   */
  async syncTicker(
    ticker: string,
    filingTypes: string[] = ['10-K', '10-Q'],
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    for (const filingType of filingTypes) {
      try {
        const result = await this.syncFilingType(ticker, filingType);
        results.push(result);
      } catch (error) {
        this.logger.error(
          `Error syncing ${ticker} ${filingType}: ${error.message}`,
        );
        results.push({
          ticker,
          filingType,
          newFilings: 0,
          skipped: 0,
          errors: 1,
        });
      }
    }

    return results;
  }

  /**
   * Sync specific filing type for a ticker
   */
  async syncFilingType(
    ticker: string,
    filingType: string,
  ): Promise<SyncResult> {
    this.logger.log(`Syncing ${ticker} ${filingType}...`);

    // Get last sync state
    const lastSync = await this.getLastSync(ticker, filingType);
    const lastFilingDate = lastSync?.lastFilingDate;

    this.logger.log(
      `Last sync: ${lastFilingDate ? lastFilingDate.toISOString() : 'never'}`,
    );

    // Get CIK for ticker first
    const { cik } = await this.secService.getCikForTicker(ticker);
    
    // Fetch filings from SEC since last sync
    const filingsResponse = await this.secService.getFillings(cik, {
      formType: filingType,
      startDate: lastFilingDate?.toISOString().split('T')[0]
    });

    const filings = filingsResponse.allFilings;

    let newFilings = 0;
    let skipped = 0;
    let errors = 0;
    let latestFilingDate: Date | undefined;

    for (const filing of filings) {
      try {
        const filingDate = new Date(filing.filingDate);

        // Skip if we already have this filing
        if (lastFilingDate && filingDate <= lastFilingDate) {
          skipped++;
          continue;
        }

        // Check if already processed (data source exists)
        const sourceId = `${ticker}-${filingType}-${filing.accessionNumber}`;
        const existingSource = await this.prisma.dataSource.findUnique({
          where: {
            type_sourceId: {
              type: 'sec_filing',
              sourceId,
            },
          },
        });

        if (existingSource) {
          this.logger.log(
            `Skipping ${ticker} ${filingType} ${filing.accessionNumber} - already processed`,
          );
          skipped++;
          continue;
        }

        // Download and store the actual filing
        await this.downloadAndStore(ticker, filingType, filing);

        newFilings++;

        // Track latest filing date
        if (!latestFilingDate || filingDate > latestFilingDate) {
          latestFilingDate = filingDate;
        }

        // Rate limiting (SEC: 10 requests/second)
        await this.sleep(150);
      } catch (error) {
        this.logger.error(
          `Error processing filing ${filing.accessionNumber}: ${error.message}`,
        );
        errors++;
      }
    }

    // Update sync state
    await this.updateSyncState(ticker, filingType, {
      lastFilingDate: latestFilingDate || lastFilingDate,
      filesSynced: newFilings,
      status: errors > 0 ? 'partial' : 'success',
    });

    this.logger.log(
      `Sync complete: ${newFilings} new, ${skipped} skipped, ${errors} errors`,
    );

    return {
      ticker,
      filingType,
      newFilings,
      skipped,
      errors,
      lastFilingDate: latestFilingDate,
    };
  }

  /**
   * Download filing and store in S3
   */
  private async downloadAndStore(
    ticker: string,
    filingType: string,
    filing: any,
  ): Promise<void> {
    this.logger.log(
      `Downloading ${ticker} ${filingType} ${filing.accessionNumber}...`,
    );

    try {
      // Download the actual filing content
      const filingContent = await this.downloadFilingContent(filing.url);
      
      // Store raw filing in S3
      const s3Path = this.s3.getSECFilingPath(
        ticker,
        filingType,
        filing.accessionNumber,
        'raw',
      );
      
      // Determine file extension from URL
      const fileExtension = this.getFileExtension(filing.url, filing.primaryDocument);
      const fileName = `filing.${fileExtension}`;
      
      // Upload to S3
      await this.s3.uploadSECFiling(
        ticker,
        filingType,
        filing.accessionNumber,
        filingContent,
        fileExtension as 'xml' | 'html' | 'json',
      );

      // Create data source record with S3 path
      await this.createDataSource(ticker, filingType, filing);

      this.logger.log(
        `Downloaded and stored ${ticker} ${filingType} ${filing.accessionNumber} (${filingContent.length} bytes)`,
      );
    } catch (error) {
      this.logger.error(
        `Error downloading ${ticker} ${filingType} ${filing.accessionNumber}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Download filing content from SEC URL
   */
  private async downloadFilingContent(url: string): Promise<Buffer> {
    if (!url) {
      throw new Error('Filing URL is required');
    }

    try {
      // Use the existing SEC service HTTP client with proper headers
      const response = await this.secService['http'].axiosRef.get(url, {
        headers: {
          'User-Agent': process.env.SEC_USER_AGENT || 'FundLensAI/1.0 (contact: you@example.com)',
          'Accept': '*/*',
        },
        responseType: 'arraybuffer', // Get raw bytes
        timeout: 30000, // 30 second timeout
      });

      return Buffer.from(response.data);
    } catch (error) {
      this.logger.error(`Error downloading filing from ${url}: ${error.message}`);
      throw new Error(`Failed to download filing: ${error.message}`);
    }
  }

  /**
   * Determine file extension from URL and document name
   */
  private getFileExtension(url: string, primaryDocument: string): string {
    // Check primary document extension first
    if (primaryDocument) {
      const ext = primaryDocument.split('.').pop()?.toLowerCase();
      if (ext && ['xml', 'html', 'htm', 'txt'].includes(ext)) {
        return ext === 'htm' ? 'html' : ext;
      }
    }

    // Check URL extension
    if (url) {
      const urlExt = url.split('.').pop()?.toLowerCase();
      if (urlExt && ['xml', 'html', 'htm', 'txt'].includes(urlExt)) {
        return urlExt === 'htm' ? 'html' : urlExt;
      }
    }

    // Default to html for SEC filings
    return 'html';
  }

  /**
   * Create data source record for filing
   */
  private async createDataSource(
    ticker: string,
    filingType: string,
    filing: any,
  ): Promise<void> {
    const sourceId = `${ticker}-${filingType}-${filing.accessionNumber}`;
    const s3Path = this.s3.getSECFilingPath(
      ticker,
      filingType,
      filing.accessionNumber,
    );

    await this.prisma.dataSource.upsert({
      where: {
        type_sourceId: {
          type: 'sec_filing',
          sourceId,
        },
      },
      create: {
        type: 'sec_filing',
        sourceId,
        visibility: 'public',
        ownerTenantId: null, // Public data
        s3Path,
        metadata: {
          ticker,
          filingType,
          accessionNumber: filing.accessionNumber,
          filingDate: filing.filingDate,
          reportDate: filing.reportDate,
          form: filing.form,
          size: filing.size,
          processed: false, // Track processing status
          downloadedAt: new Date().toISOString(),
        },
      },
      update: {
        s3Path,
        metadata: {
          ticker,
          filingType,
          accessionNumber: filing.accessionNumber,
          filingDate: filing.filingDate,
          reportDate: filing.reportDate,
          form: filing.form,
          size: filing.size,
          processed: false, // Track processing status
          downloadedAt: new Date().toISOString(),
        },
      },
    });
  }

  /**
   * Get last sync state
   */
  private async getLastSync(
    ticker: string,
    filingType: string,
  ): Promise<any | null> {
    return this.prisma.s3SyncState.findUnique({
      where: {
        ticker_filingType: {
          ticker,
          filingType,
        },
      },
    });
  }

  /**
   * Update sync state
   */
  private async updateSyncState(
    ticker: string,
    filingType: string,
    data: {
      lastFilingDate?: Date;
      filesSynced: number;
      status: string;
      errorMessage?: string;
    },
  ): Promise<void> {
    await this.prisma.s3SyncState.upsert({
      where: {
        ticker_filingType: {
          ticker,
          filingType,
        },
      },
      create: {
        ticker,
        filingType,
        lastSyncAt: new Date(),
        lastFilingDate: data.lastFilingDate,
        filesSynced: data.filesSynced,
        status: data.status,
        errorMessage: data.errorMessage,
      },
      update: {
        lastSyncAt: new Date(),
        lastFilingDate: data.lastFilingDate,
        filesSynced: data.filesSynced,
        status: data.status,
        errorMessage: data.errorMessage,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Sleep for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Sync all tracked tickers
   */
  async syncAll(): Promise<SyncResult[]> {
    // Get all unique tickers from database
    const tickers = await this.prisma.financialMetric.findMany({
      select: { ticker: true },
      distinct: ['ticker'],
    });

    const results: SyncResult[] = [];

    for (const { ticker } of tickers) {
      try {
        const tickerResults = await this.syncTicker(ticker);
        results.push(...tickerResults);
      } catch (error) {
        this.logger.error(`Error syncing ${ticker}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Get sync status for all tickers
   */
  async getSyncStatus(): Promise<any[]> {
    return this.prisma.s3SyncState.findMany({
      orderBy: [{ ticker: 'asc' }, { filingType: 'asc' }],
    });
  }
}
