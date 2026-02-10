import {
  SECFilingMetadata,
  isSECFilingMetadata,
  validateSECFilingMetadata,
  SECFilingMetadataValidationError,
  createSECFilingMetadata,
  markAsProcessed,
  getTickerFromMetadata,
  isFilingProcessed,
} from '../../src/filings/types/sec-filing-metadata.interface';

describe('SECFilingMetadata', () => {
  describe('isSECFilingMetadata', () => {
    it('should return true for valid metadata', () => {
      const metadata: SECFilingMetadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(isSECFilingMetadata(metadata)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isSECFilingMetadata(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isSECFilingMetadata(undefined)).toBe(false);
    });

    it('should return false for missing required fields', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        // Missing other required fields
      };

      expect(isSECFilingMetadata(metadata)).toBe(false);
    });

    it('should return false for wrong field types', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: 'false', // Should be boolean
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(isSECFilingMetadata(metadata)).toBe(false);
    });
  });

  describe('validateSECFilingMetadata', () => {
    it('should not throw for valid metadata', () => {
      const metadata: SECFilingMetadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(() => validateSECFilingMetadata(metadata)).not.toThrow();
    });

    it('should throw for missing ticker', () => {
      const metadata = {
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        SECFilingMetadataValidationError
      );
      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'Missing required field: ticker'
      );
    });

    it('should throw for invalid ticker format', () => {
      const metadata = {
        ticker: 'aapl', // Should be uppercase
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'Invalid ticker format'
      );
    });

    it('should throw for invalid accession number format', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: 'invalid-format', // Invalid format
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'Invalid accession number format'
      );
    });

    it('should accept valid accession number format', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(() => validateSECFilingMetadata(metadata)).not.toThrow();
    });

    it('should throw for invalid filing type', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-X', // Invalid type
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'Invalid filing type'
      );
    });

    it('should throw for invalid filing date', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: 'invalid-date',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'Invalid filing date'
      );
    });

    it('should throw for invalid report date', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: 'invalid-date',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'Invalid report date'
      );
    });

    it('should throw if report date is after filing date', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-09-30',
        reportDate: '2024-11-01', // After filing date
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'Report date'
      );
      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'cannot be after filing date'
      );
    });

    it('should accept report date equal to filing date', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '8-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-11-01', // Same as filing date
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(() => validateSECFilingMetadata(metadata)).not.toThrow();
    });

    it('should throw for non-boolean processed', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: 'false', // Should be boolean
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'Invalid processed value'
      );
    });

    it('should throw for invalid downloadedAt timestamp', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: 'invalid-timestamp',
      };

      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'Invalid downloadedAt timestamp'
      );
    });

    it('should throw if processedAt is before downloadedAt', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: true,
        downloadedAt: '2024-11-02T06:20:00.000Z',
        processedAt: '2024-11-02T06:15:00.000Z', // Before downloadedAt
      };

      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'processedAt'
      );
      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'must be after downloadedAt'
      );
    });

    it('should accept valid optional fields', () => {
      const metadata: SECFilingMetadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: true,
        downloadedAt: '2024-11-02T06:15:00.000Z',
        processedAt: '2024-11-02T06:20:00.000Z',
        form: '10-K',
        size: 1234567,
        cik: '0000320193',
        primaryDocument: 'aapl-20240930.htm',
        url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240930.htm',
      };

      expect(() => validateSECFilingMetadata(metadata)).not.toThrow();
    });
  });

  describe('createSECFilingMetadata', () => {
    it('should create valid metadata with required fields', () => {
      const metadata = createSECFilingMetadata({
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
      });

      expect(metadata.ticker).toBe('AAPL');
      expect(metadata.filingType).toBe('10-K');
      expect(metadata.accessionNumber).toBe('0000320193-24-000123');
      expect(metadata.filingDate).toBe('2024-11-01');
      expect(metadata.reportDate).toBe('2024-09-30');
      expect(metadata.processed).toBe(false);
      expect(metadata.downloadedAt).toBeDefined();
      expect(new Date(metadata.downloadedAt).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should normalize ticker to uppercase', () => {
      const metadata = createSECFilingMetadata({
        ticker: 'aapl', // lowercase
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
      });

      expect(metadata.ticker).toBe('AAPL');
    });

    it('should include optional fields when provided', () => {
      const metadata = createSECFilingMetadata({
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        form: '10-K',
        size: 1234567,
        cik: '0000320193',
        primaryDocument: 'aapl-20240930.htm',
        url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240930.htm',
      });

      expect(metadata.form).toBe('10-K');
      expect(metadata.size).toBe(1234567);
      expect(metadata.cik).toBe('0000320193');
      expect(metadata.primaryDocument).toBe('aapl-20240930.htm');
      expect(metadata.url).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240930.htm');
    });

    it('should throw for invalid parameters', () => {
      expect(() =>
        createSECFilingMetadata({
          ticker: 'invalid ticker', // Invalid format
          filingType: '10-K',
          accessionNumber: '0000320193-24-000123',
          filingDate: '2024-11-01',
          reportDate: '2024-09-30',
        })
      ).toThrow(SECFilingMetadataValidationError);
    });

    it('should support all valid filing types', () => {
      const filingTypes: Array<'10-K' | '10-Q' | '8-K'> = ['10-K', '10-Q', '8-K'];

      for (const filingType of filingTypes) {
        const metadata = createSECFilingMetadata({
          ticker: 'AAPL',
          filingType,
          accessionNumber: '0000320193-24-000123',
          filingDate: '2024-11-01',
          reportDate: '2024-09-30',
        });

        expect(metadata.filingType).toBe(filingType);
      }
    });
  });

  describe('markAsProcessed', () => {
    it('should mark metadata as processed', () => {
      const metadata: SECFilingMetadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      const processed = markAsProcessed(metadata);

      expect(processed.processed).toBe(true);
      expect(processed.processedAt).toBeDefined();
      expect(new Date(processed.processedAt!).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should preserve all original fields', () => {
      const metadata: SECFilingMetadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
        form: '10-K',
        size: 1234567,
      };

      const processed = markAsProcessed(metadata);

      expect(processed.ticker).toBe(metadata.ticker);
      expect(processed.filingType).toBe(metadata.filingType);
      expect(processed.accessionNumber).toBe(metadata.accessionNumber);
      expect(processed.filingDate).toBe(metadata.filingDate);
      expect(processed.reportDate).toBe(metadata.reportDate);
      expect(processed.downloadedAt).toBe(metadata.downloadedAt);
      expect(processed.form).toBe(metadata.form);
      expect(processed.size).toBe(metadata.size);
    });
  });

  describe('getTickerFromMetadata', () => {
    it('should extract ticker from valid metadata', () => {
      const metadata: SECFilingMetadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(getTickerFromMetadata(metadata)).toBe('AAPL');
    });

    it('should return null for invalid metadata', () => {
      const metadata = {
        ticker: 'AAPL',
        // Missing other required fields
      };

      expect(getTickerFromMetadata(metadata)).toBeNull();
    });

    it('should return null for null', () => {
      expect(getTickerFromMetadata(null)).toBeNull();
    });

    it('should return null for undefined', () => {
      expect(getTickerFromMetadata(undefined)).toBeNull();
    });
  });

  describe('isFilingProcessed', () => {
    it('should return true for processed filing', () => {
      const metadata: SECFilingMetadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: true,
        downloadedAt: '2024-11-02T06:15:00.000Z',
        processedAt: '2024-11-02T06:20:00.000Z',
      };

      expect(isFilingProcessed(metadata)).toBe(true);
    });

    it('should return false for unprocessed filing', () => {
      const metadata: SECFilingMetadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
      };

      expect(isFilingProcessed(metadata)).toBe(false);
    });

    it('should return false for invalid metadata', () => {
      const metadata = {
        ticker: 'AAPL',
        processed: true,
        // Missing other required fields
      };

      expect(isFilingProcessed(metadata)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isFilingProcessed(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isFilingProcessed(undefined)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle ticker with 1 character', () => {
      const metadata = createSECFilingMetadata({
        ticker: 'F', // Ford Motor Company
        filingType: '10-K',
        accessionNumber: '0000037996-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
      });

      expect(metadata.ticker).toBe('F');
    });

    it('should handle ticker with 5 characters', () => {
      const metadata = createSECFilingMetadata({
        ticker: 'GOOGL',
        filingType: '10-K',
        accessionNumber: '0001652044-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
      });

      expect(metadata.ticker).toBe('GOOGL');
    });

    it('should reject ticker with 6 characters', () => {
      expect(() =>
        createSECFilingMetadata({
          ticker: 'TOOLONG',
          filingType: '10-K',
          accessionNumber: '0000320193-24-000123',
          filingDate: '2024-11-01',
          reportDate: '2024-09-30',
        })
      ).toThrow('Invalid ticker format');
    });

    it('should handle same filing and report date (8-K)', () => {
      const metadata = createSECFilingMetadata({
        ticker: 'AAPL',
        filingType: '8-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-11-01', // Same as filing date
      });

      expect(metadata.filingDate).toBe(metadata.reportDate);
    });
  });

  describe('Optional Field Validation', () => {
    it('should throw for negative size', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
        size: -100, // Invalid
      };

      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'Invalid size value'
      );
    });

    it('should accept valid size', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
        size: 1234567,
      };

      expect(() => validateSECFilingMetadata(metadata)).not.toThrow();
    });

    it('should throw for invalid CIK format', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
        cik: '123', // Too short
      };

      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'Invalid CIK format'
      );
    });

    it('should accept valid CIK', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
        cik: '0000320193',
      };

      expect(() => validateSECFilingMetadata(metadata)).not.toThrow();
    });

    it('should throw for invalid URL format', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
        url: 'not-a-valid-url',
      };

      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'Invalid URL format'
      );
    });

    it('should accept valid URL', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
        url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240930.htm',
      };

      expect(() => validateSECFilingMetadata(metadata)).not.toThrow();
    });

    it('should throw for empty primaryDocument', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
        primaryDocument: '', // Empty string
      };

      expect(() => validateSECFilingMetadata(metadata)).toThrow(
        'Invalid primaryDocument value'
      );
    });

    it('should accept valid primaryDocument', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
        primaryDocument: 'aapl-20240930.htm',
      };

      expect(() => validateSECFilingMetadata(metadata)).not.toThrow();
    });

    it('should accept valid form field', () => {
      const metadata = {
        ticker: 'AAPL',
        filingType: '10-K',
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-30',
        processed: false,
        downloadedAt: '2024-11-02T06:15:00.000Z',
        form: '10-K',
      };

      expect(() => validateSECFilingMetadata(metadata)).not.toThrow();
    });
  });
});
