import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import {
  FilingDownloadService,
  DownloadResult,
  RetryConfig,
} from '../../src/filings/filing-download.service';
import { SECSyncService } from '../../src/s3/sec-sync.service';
import { SECProcessingService } from '../../src/s3/sec-processing.service';
import { FilingNotificationService } from '../../src/filings/filing-notification.service';
import { SECFiling } from '../../src/filings/filing-detector.service';

describe('FilingDownloadService', () => {
  let service: FilingDownloadService;
  let secSyncService: jest.Mocked<SECSyncService>;
  let secProcessingService: jest.Mocked<SECProcessingService>;
  let notificationService: jest.Mocked<FilingNotificationService>;

  const mockFiling: SECFiling = {
    accessionNumber: '0000320193-24-000123',
    filingDate: new Date('2024-11-01'),
    reportDate: new Date('2024-09-30'),
    form: '10-K',
    url: 'https://www.sec.gov/Archives/edgar/data/320193/filing.htm',
    primaryDocument: 'filing.htm',
  };

  // Fast retry config for tests (no real delays)
  const fastRetryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1, // 1ms for fast tests
    maxDelayMs: 10,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilingDownloadService,
        {
          provide: SECSyncService,
          useValue: {
            syncTicker: jest.fn(),
          },
        },
        {
          provide: SECProcessingService,
          useValue: {
            processFiling: jest.fn(),
          },
        },
        {
          provide: FilingNotificationService,
          useValue: {
            createNotifications: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FilingDownloadService>(FilingDownloadService);
    secSyncService = module.get(SECSyncService);
    secProcessingService = module.get(SECProcessingService);
    notificationService = module.get(FilingNotificationService);

    // Suppress logger output in tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('queueDownload', () => {
    it('should successfully download, process, and notify', async () => {
      // Arrange
      secSyncService.syncTicker.mockResolvedValue([
        {
          ticker: 'AAPL',
          filingType: '10-K',
          newFilings: 1,
          skipped: 0,
          errors: 0,
        },
      ]);

      secProcessingService.processFiling.mockResolvedValue({
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        metricsExtracted: 15,
        narrativesExtracted: 8,
        processingTime: 1500,
        status: 'success',
        errors: [],
      });

      notificationService.createNotifications.mockResolvedValue(3);

      // Act
      const result = await service.queueDownload(
        'AAPL',
        mockFiling,
        fastRetryConfig,
      );

      // Assert
      expect(result.downloadSuccess).toBe(true);
      expect(result.processingResult).toBeDefined();
      expect(result.processingResult!.status).toBe('success');
      expect(result.notificationsSent).toBe(3);
      expect(result.errors).toHaveLength(0);
      expect(result.retryCount).toBe(0);

      expect(secSyncService.syncTicker).toHaveBeenCalledWith('AAPL', ['10-K']);
      expect(secProcessingService.processFiling).toHaveBeenCalledWith(
        'AAPL',
        '10-K',
        '0000320193-24-000123',
      );
      expect(notificationService.createNotifications).toHaveBeenCalledWith(
        'AAPL',
        expect.objectContaining({
          form: '10-K',
          accessionNumber: '0000320193-24-000123',
        }),
      );
    });

    it('should return result with errors when download fails after retries', async () => {
      // Arrange - simulate transient network error
      const networkError = new Error('Network error');
      (networkError as any).code = 'ECONNRESET';
      secSyncService.syncTicker.mockRejectedValue(networkError);

      // Act
      const result = await service.queueDownload(
        'AAPL',
        mockFiling,
        fastRetryConfig,
      );

      // Assert
      expect(result.downloadSuccess).toBe(false);
      expect(result.processingResult).toBeNull();
      expect(result.notificationsSent).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
      // Should have retried maxRetries times
      expect(result.retryCount).toBe(fastRetryConfig.maxRetries);
      // 1 initial + 3 retries = 4 total calls
      expect(secSyncService.syncTicker).toHaveBeenCalledTimes(
        fastRetryConfig.maxRetries + 1,
      );
      // Processing should not have been called
      expect(secProcessingService.processFiling).not.toHaveBeenCalled();
    });

    it('should not retry on non-retryable errors', async () => {
      // Arrange - simulate a non-retryable error (e.g., 404 Not Found)
      const notFoundError = new Error('Filing not found');
      (notFoundError as any).status = 404;
      secSyncService.syncTicker.mockRejectedValue(notFoundError);

      // Act
      const result = await service.queueDownload(
        'AAPL',
        mockFiling,
        fastRetryConfig,
      );

      // Assert
      expect(result.downloadSuccess).toBe(false);
      expect(result.retryCount).toBe(0); // No retries for non-retryable errors
      expect(secSyncService.syncTicker).toHaveBeenCalledTimes(1);
    });

    it('should handle partial processing failures gracefully', async () => {
      // Arrange
      secSyncService.syncTicker.mockResolvedValue([
        {
          ticker: 'AAPL',
          filingType: '10-K',
          newFilings: 1,
          skipped: 0,
          errors: 0,
        },
      ]);

      secProcessingService.processFiling.mockResolvedValue({
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        metricsExtracted: 15,
        narrativesExtracted: 0,
        processingTime: 1200,
        status: 'partial',
        errors: ['Narrative extraction failed: timeout'],
      });

      notificationService.createNotifications.mockResolvedValue(2);

      // Act
      const result = await service.queueDownload(
        'AAPL',
        mockFiling,
        fastRetryConfig,
      );

      // Assert
      expect(result.downloadSuccess).toBe(true);
      expect(result.processingResult).toBeDefined();
      expect(result.processingResult!.status).toBe('partial');
      expect(result.processingResult!.metricsExtracted).toBe(15);
      expect(result.processingResult!.narrativesExtracted).toBe(0);
      // Notifications should still be sent for partial success
      expect(result.notificationsSent).toBe(2);
      expect(notificationService.createNotifications).toHaveBeenCalled();
      // Should have partial failure error recorded
      expect(result.errors).toContain(
        'Processing partial: Narrative extraction failed: timeout',
      );
    });

    it('should skip notifications when processing completely fails', async () => {
      // Arrange
      secSyncService.syncTicker.mockResolvedValue([
        {
          ticker: 'AAPL',
          filingType: '10-K',
          newFilings: 1,
          skipped: 0,
          errors: 0,
        },
      ]);

      secProcessingService.processFiling.mockResolvedValue({
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        metricsExtracted: 0,
        narrativesExtracted: 0,
        processingTime: 500,
        status: 'failed',
        errors: ['Parser unavailable'],
      });

      // Act
      const result = await service.queueDownload(
        'AAPL',
        mockFiling,
        fastRetryConfig,
      );

      // Assert
      expect(result.downloadSuccess).toBe(true);
      expect(result.processingResult!.status).toBe('failed');
      expect(result.notificationsSent).toBe(0);
      // Notifications should NOT be called when processing fails
      expect(notificationService.createNotifications).not.toHaveBeenCalled();
    });

    it('should continue even if notification creation fails', async () => {
      // Arrange
      secSyncService.syncTicker.mockResolvedValue([
        {
          ticker: 'AAPL',
          filingType: '10-K',
          newFilings: 1,
          skipped: 0,
          errors: 0,
        },
      ]);

      secProcessingService.processFiling.mockResolvedValue({
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        metricsExtracted: 15,
        narrativesExtracted: 8,
        processingTime: 1500,
        status: 'success',
        errors: [],
      });

      notificationService.createNotifications.mockRejectedValue(
        new Error('Database connection lost'),
      );

      // Act
      const result = await service.queueDownload(
        'AAPL',
        mockFiling,
        fastRetryConfig,
      );

      // Assert
      expect(result.downloadSuccess).toBe(true);
      expect(result.processingResult!.status).toBe('success');
      expect(result.notificationsSent).toBe(0);
      expect(result.errors).toContain(
        'Notification error: Database connection lost',
      );
    });

    it('should retry on transient download errors then succeed', async () => {
      // Arrange - fail twice, then succeed
      const timeoutError = new Error('Request timeout');
      (timeoutError as any).code = 'ETIMEDOUT';

      secSyncService.syncTicker
        .mockRejectedValueOnce(timeoutError)
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce([
          {
            ticker: 'AAPL',
            filingType: '10-K',
            newFilings: 1,
            skipped: 0,
            errors: 0,
          },
        ]);

      secProcessingService.processFiling.mockResolvedValue({
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        metricsExtracted: 10,
        narrativesExtracted: 5,
        processingTime: 1000,
        status: 'success',
        errors: [],
      });

      notificationService.createNotifications.mockResolvedValue(1);

      // Act
      const result = await service.queueDownload(
        'AAPL',
        mockFiling,
        fastRetryConfig,
      );

      // Assert
      expect(result.downloadSuccess).toBe(true);
      expect(result.retryCount).toBe(2); // 2 retries before success
      expect(secSyncService.syncTicker).toHaveBeenCalledTimes(3);
      expect(result.processingResult!.status).toBe('success');
      expect(result.notificationsSent).toBe(1);
    });

    it('should retry on HTTP 429 rate limit errors', async () => {
      // Arrange
      const rateLimitError = new Error('Too Many Requests');
      (rateLimitError as any).status = 429;

      secSyncService.syncTicker
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce([
          {
            ticker: 'MSFT',
            filingType: '10-Q',
            newFilings: 1,
            skipped: 0,
            errors: 0,
          },
        ]);

      secProcessingService.processFiling.mockResolvedValue({
        ticker: 'MSFT',
        filingType: '10-Q',
        accessionNumber: '0000789019-24-000456',
        metricsExtracted: 12,
        narrativesExtracted: 6,
        processingTime: 800,
        status: 'success',
        errors: [],
      });

      notificationService.createNotifications.mockResolvedValue(2);

      const filing10Q: SECFiling = {
        ...mockFiling,
        form: '10-Q',
        accessionNumber: '0000789019-24-000456',
      };

      // Act
      const result = await service.queueDownload(
        'MSFT',
        filing10Q,
        fastRetryConfig,
      );

      // Assert
      expect(result.downloadSuccess).toBe(true);
      expect(result.retryCount).toBe(1);
      expect(secSyncService.syncTicker).toHaveBeenCalledTimes(2);
    });

    it('should retry on HTTP 503 service unavailable errors', async () => {
      // Arrange
      const serviceUnavailableError = new Error('Service Unavailable');
      (serviceUnavailableError as any).status = 503;

      secSyncService.syncTicker
        .mockRejectedValueOnce(serviceUnavailableError)
        .mockResolvedValueOnce([
          {
            ticker: 'AAPL',
            filingType: '10-K',
            newFilings: 1,
            skipped: 0,
            errors: 0,
          },
        ]);

      secProcessingService.processFiling.mockResolvedValue({
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        metricsExtracted: 10,
        narrativesExtracted: 5,
        processingTime: 1000,
        status: 'success',
        errors: [],
      });

      notificationService.createNotifications.mockResolvedValue(1);

      // Act
      const result = await service.queueDownload(
        'AAPL',
        mockFiling,
        fastRetryConfig,
      );

      // Assert
      expect(result.downloadSuccess).toBe(true);
      expect(result.retryCount).toBe(1);
    });

    it('should handle sync result with errors and zero new filings as failure', async () => {
      // Arrange - syncTicker returns but with errors
      secSyncService.syncTicker.mockResolvedValue([
        {
          ticker: 'AAPL',
          filingType: '10-K',
          newFilings: 0,
          skipped: 0,
          errors: 1,
        },
      ]);

      // Act
      const result = await service.queueDownload(
        'AAPL',
        mockFiling,
        fastRetryConfig,
      );

      // Assert - should have treated this as a failure and not proceeded to processing
      expect(result.downloadSuccess).toBe(false);
      expect(secProcessingService.processFiling).not.toHaveBeenCalled();
    });

    it('should include correct context in DownloadResult', async () => {
      // Arrange
      secSyncService.syncTicker.mockResolvedValue([
        {
          ticker: 'AMZN',
          filingType: '8-K',
          newFilings: 1,
          skipped: 0,
          errors: 0,
        },
      ]);

      secProcessingService.processFiling.mockResolvedValue({
        ticker: 'AMZN',
        filingType: '8-K',
        accessionNumber: '0001018724-24-000789',
        metricsExtracted: 3,
        narrativesExtracted: 2,
        processingTime: 400,
        status: 'success',
        errors: [],
      });

      notificationService.createNotifications.mockResolvedValue(5);

      const filing8K: SECFiling = {
        accessionNumber: '0001018724-24-000789',
        filingDate: new Date('2024-12-15'),
        reportDate: null,
        form: '8-K',
        url: 'https://www.sec.gov/Archives/edgar/data/1018724/filing.htm',
        primaryDocument: 'filing.htm',
      };

      // Act
      const result = await service.queueDownload(
        'AMZN',
        filing8K,
        fastRetryConfig,
      );

      // Assert
      expect(result.ticker).toBe('AMZN');
      expect(result.filingType).toBe('8-K');
      expect(result.accessionNumber).toBe('0001018724-24-000789');
      expect(result.downloadSuccess).toBe(true);
      expect(result.notificationsSent).toBe(5);
    });
  });

  describe('error context logging', () => {
    it('should log errors with ticker, filing type, and accession number', async () => {
      // Arrange
      const errorSpy = jest.spyOn(Logger.prototype, 'error');
      const notFoundError = new Error('CIK not found for ticker');
      (notFoundError as any).status = 404;
      secSyncService.syncTicker.mockRejectedValue(notFoundError);

      // Act
      await service.queueDownload('INVALID', mockFiling, fastRetryConfig);

      // Assert - verify error logs contain context
      const errorCalls = errorSpy.mock.calls.map((call) => call[0]);
      const hasContextualError = errorCalls.some(
        (msg: string) =>
          msg.includes('INVALID') &&
          msg.includes('10-K') &&
          msg.includes('0000320193-24-000123'),
      );
      expect(hasContextualError).toBe(true);
    });

    it('should log processing errors with full context', async () => {
      // Arrange
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      secSyncService.syncTicker.mockResolvedValue([
        {
          ticker: 'AAPL',
          filingType: '10-K',
          newFilings: 1,
          skipped: 0,
          errors: 0,
        },
      ]);

      secProcessingService.processFiling.mockResolvedValue({
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        metricsExtracted: 10,
        narrativesExtracted: 0,
        processingTime: 800,
        status: 'partial',
        errors: ['Narrative chunking timeout'],
      });

      notificationService.createNotifications.mockResolvedValue(1);

      // Act
      await service.queueDownload('AAPL', mockFiling, fastRetryConfig);

      // Assert - verify warning logs contain context for partial failures
      const warnCalls = warnSpy.mock.calls.map((call) => call[0]);
      const hasPartialWarning = warnCalls.some(
        (msg: string) =>
          msg.includes('AAPL') &&
          msg.includes('10-K') &&
          msg.includes('partially'),
      );
      expect(hasPartialWarning).toBe(true);
    });
  });

  describe('exponential backoff', () => {
    it('should use exponential delays between retries', async () => {
      // Arrange
      const sleepSpy = jest.spyOn(service as any, 'sleep');
      const networkError = new Error('Connection reset');
      (networkError as any).code = 'ECONNRESET';

      secSyncService.syncTicker.mockRejectedValue(networkError);

      const retryConfig: RetryConfig = {
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 10000,
      };

      // Act
      await service.queueDownload('AAPL', mockFiling, retryConfig);

      // Assert - verify exponential backoff delays
      // Attempt 0 fails → delay 100ms (100 * 2^0)
      // Attempt 1 fails → delay 200ms (100 * 2^1)
      // Attempt 2 fails → delay 400ms (100 * 2^2)
      // Attempt 3 fails → no more retries
      expect(sleepSpy).toHaveBeenCalledTimes(3);
      expect(sleepSpy).toHaveBeenNthCalledWith(1, 100); // 100 * 2^0
      expect(sleepSpy).toHaveBeenNthCalledWith(2, 200); // 100 * 2^1
      expect(sleepSpy).toHaveBeenNthCalledWith(3, 400); // 100 * 2^2
    });

    it('should cap delay at maxDelayMs', async () => {
      // Arrange
      const sleepSpy = jest.spyOn(service as any, 'sleep');
      const networkError = new Error('Connection reset');
      (networkError as any).code = 'ECONNRESET';

      secSyncService.syncTicker.mockRejectedValue(networkError);

      const retryConfig: RetryConfig = {
        maxRetries: 3,
        baseDelayMs: 5000,
        maxDelayMs: 8000,
      };

      // Act
      await service.queueDownload('AAPL', mockFiling, retryConfig);

      // Assert - delays should be capped at maxDelayMs
      // Attempt 0 fails → delay min(5000, 8000) = 5000ms
      // Attempt 1 fails → delay min(10000, 8000) = 8000ms (capped)
      // Attempt 2 fails → delay min(20000, 8000) = 8000ms (capped)
      expect(sleepSpy).toHaveBeenNthCalledWith(1, 5000);
      expect(sleepSpy).toHaveBeenNthCalledWith(2, 8000);
      expect(sleepSpy).toHaveBeenNthCalledWith(3, 8000);
    });
  });
});
