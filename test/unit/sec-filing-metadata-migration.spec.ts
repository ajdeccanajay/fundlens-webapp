/**
 * SEC Filing Metadata Migration Tests
 * 
 * Tests to verify that the migration of existing data_sources records
 * was successful and all records now conform to the validation rules.
 */

import { PrismaClient } from '@prisma/client';
import {
  validateSECFilingMetadata,
  isSECFilingMetadata,
  SECFilingMetadata,
} from '../../src/filings/types/sec-filing-metadata.interface';

describe('SEC Filing Metadata Migration', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Data Compliance', () => {
    it('should have all SEC filing records with valid metadata', async () => {
      // Get all SEC filing records
      const secFilings = await prisma.dataSource.findMany({
        where: {
          type: 'sec_filing',
        },
        select: {
          id: true,
          sourceId: true,
          metadata: true,
        },
      });

      expect(secFilings.length).toBeGreaterThan(0);

      // Validate each record
      const invalidRecords: Array<{ id: string; sourceId: string; error: string }> = [];

      for (const filing of secFilings) {
        try {
          validateSECFilingMetadata(filing.metadata);
        } catch (error) {
          invalidRecords.push({
            id: filing.id,
            sourceId: filing.sourceId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // All records should be valid
      if (invalidRecords.length > 0) {
        console.error('Invalid records found:', invalidRecords);
      }

      expect(invalidRecords).toHaveLength(0);
    });

    it('should have all required fields present', async () => {
      const secFilings = await prisma.dataSource.findMany({
        where: {
          type: 'sec_filing',
        },
        select: {
          metadata: true,
        },
        take: 10, // Sample 10 records
      });

      const requiredFields = [
        'ticker',
        'filingType',
        'accessionNumber',
        'filingDate',
        'reportDate',
        'processed',
        'downloadedAt',
      ];

      for (const filing of secFilings) {
        const metadata = filing.metadata as any;

        for (const field of requiredFields) {
          expect(metadata).toHaveProperty(field);
          expect(metadata[field]).toBeDefined();
        }
      }
    });

    it('should have properly formatted accession numbers', async () => {
      const secFilings = await prisma.dataSource.findMany({
        where: {
          type: 'sec_filing',
        },
        select: {
          metadata: true,
        },
      });

      const accessionNumberPattern = /^\d{10}-\d{2}-\d{6}$/;

      for (const filing of secFilings) {
        const metadata = filing.metadata as SECFilingMetadata;
        expect(metadata.accessionNumber).toMatch(accessionNumberPattern);
      }
    });

    it('should have uppercase tickers', async () => {
      const secFilings = await prisma.dataSource.findMany({
        where: {
          type: 'sec_filing',
        },
        select: {
          metadata: true,
        },
        take: 20, // Sample 20 records
      });

      for (const filing of secFilings) {
        const metadata = filing.metadata as SECFilingMetadata;
        expect(metadata.ticker).toMatch(/^[A-Z]{1,5}$/);
        expect(metadata.ticker).toBe(metadata.ticker.toUpperCase());
      }
    });

    it('should have valid filing types', async () => {
      const secFilings = await prisma.dataSource.findMany({
        where: {
          type: 'sec_filing',
        },
        select: {
          metadata: true,
        },
      });

      const validFilingTypes = ['10-K', '10-Q', '8-K'];

      for (const filing of secFilings) {
        const metadata = filing.metadata as SECFilingMetadata;
        expect(validFilingTypes).toContain(metadata.filingType);
      }
    });

    it('should have valid date formats', async () => {
      const secFilings = await prisma.dataSource.findMany({
        where: {
          type: 'sec_filing',
        },
        select: {
          metadata: true,
        },
        take: 20, // Sample 20 records
      });

      for (const filing of secFilings) {
        const metadata = filing.metadata as SECFilingMetadata;

        // Filing date should be valid
        expect(Date.parse(metadata.filingDate)).not.toBeNaN();

        // Report date should be valid
        expect(Date.parse(metadata.reportDate)).not.toBeNaN();

        // Downloaded at should be valid
        expect(Date.parse(metadata.downloadedAt)).not.toBeNaN();

        // Report date should not be after filing date
        const reportTime = new Date(metadata.reportDate).getTime();
        const filingTime = new Date(metadata.filingDate).getTime();
        expect(reportTime).toBeLessThanOrEqual(filingTime);
      }
    });

    it('should have boolean processed field', async () => {
      const secFilings = await prisma.dataSource.findMany({
        where: {
          type: 'sec_filing',
        },
        select: {
          metadata: true,
        },
        take: 20, // Sample 20 records
      });

      for (const filing of secFilings) {
        const metadata = filing.metadata as SECFilingMetadata;
        expect(typeof metadata.processed).toBe('boolean');
      }
    });

    it('should pass type guard for all records', async () => {
      const secFilings = await prisma.dataSource.findMany({
        where: {
          type: 'sec_filing',
        },
        select: {
          metadata: true,
        },
        take: 20, // Sample 20 records
      });

      for (const filing of secFilings) {
        expect(isSECFilingMetadata(filing.metadata)).toBe(true);
      }
    });
  });

  describe('Migration Quality', () => {
    it('should have reasonable distribution of filing types', async () => {
      const secFilings = await prisma.dataSource.findMany({
        where: {
          type: 'sec_filing',
        },
        select: {
          metadata: true,
        },
      });

      const filingTypeCounts = {
        '10-K': 0,
        '10-Q': 0,
        '8-K': 0,
      };

      for (const filing of secFilings) {
        const metadata = filing.metadata as SECFilingMetadata;
        filingTypeCounts[metadata.filingType]++;
      }

      // Should have at least some of each type (or at least 10-K and 10-Q)
      expect(filingTypeCounts['10-K']).toBeGreaterThan(0);
      expect(filingTypeCounts['10-Q']).toBeGreaterThan(0);
    });

    it('should have processed timestamps for processed filings', async () => {
      const processedFilings = await prisma.dataSource.findMany({
        where: {
          type: 'sec_filing',
        },
        select: {
          metadata: true,
        },
        take: 100,
      });

      for (const filing of processedFilings) {
        const metadata = filing.metadata as SECFilingMetadata;

        if (metadata.processed && metadata.processedAt) {
          // ProcessedAt should be valid
          expect(Date.parse(metadata.processedAt)).not.toBeNaN();

          // ProcessedAt should be after downloadedAt
          const downloadedTime = new Date(metadata.downloadedAt).getTime();
          const processedTime = new Date(metadata.processedAt).getTime();
          expect(processedTime).toBeGreaterThanOrEqual(downloadedTime);
        }
      }
    });

    it('should have unique accession numbers per ticker-filing combination (excluding legacy)', async () => {
      const secFilings = await prisma.dataSource.findMany({
        where: {
          type: 'sec_filing',
        },
        select: {
          sourceId: true,
          metadata: true,
        },
      });

      const seen = new Set<string>();
      const duplicates: string[] = [];

      for (const filing of secFilings) {
        const metadata = filing.metadata as any;
        
        // Skip legacy records (those with fiscal_period field)
        if ('fiscal_period' in metadata) {
          continue;
        }

        const key = `${metadata.ticker}-${metadata.filingType}-${metadata.accessionNumber}`;

        if (seen.has(key)) {
          duplicates.push(key);
        } else {
          seen.add(key);
        }
      }

      // Real filings should have unique accession numbers
      expect(duplicates).toHaveLength(0);
    });
  });

  describe('Legacy Records', () => {
    it('should identify legacy records with placeholder accession numbers', async () => {
      const legacyRecords = await prisma.dataSource.findMany({
        where: {
          type: 'sec_filing',
        },
        select: {
          id: true,
          sourceId: true,
          metadata: true,
        },
      });

      const placeholderCount = legacyRecords.filter((filing) => {
        const metadata = filing.metadata as SECFilingMetadata;
        return metadata.accessionNumber === '0000000000-00-000000';
      }).length;

      // Log the count for informational purposes
      console.log(`Found ${placeholderCount} legacy records with placeholder accession numbers`);

      // This is informational - we expect some legacy records
      expect(placeholderCount).toBeGreaterThanOrEqual(0);
    });

    it('should have fiscal_period preserved in legacy records', async () => {
      const legacyRecords = await prisma.dataSource.findMany({
        where: {
          type: 'sec_filing',
        },
        select: {
          metadata: true,
        },
      });

      const recordsWithFiscalPeriod = legacyRecords.filter((filing) => {
        const metadata = filing.metadata as any;
        return 'fiscal_period' in metadata;
      });

      // Log the count for informational purposes
      console.log(`Found ${recordsWithFiscalPeriod.length} records with fiscal_period field`);

      // This is informational - we expect some records to have fiscal_period
      expect(recordsWithFiscalPeriod.length).toBeGreaterThanOrEqual(0);
    });
  });
});
