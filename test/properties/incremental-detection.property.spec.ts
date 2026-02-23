/**
 * Property-Based Test: Incremental Detection
 * Feature: automatic-filing-detection, Property 6: Incremental Detection
 *
 * **Validates: Requirements US-5, FR-1**
 *
 * For any ticker T, if the system has already detected filing F (exists in
 * data_sources), running detection again SHALL NOT re-download or re-process F.
 *
 * Strategy:
 * - Generate random sets of filings: some already existing in data_sources, some new
 * - Mock SEC EDGAR to return ALL filings (both existing and new)
 * - Mock data_sources to contain the "existing" filings
 * - Call detectNewFilings() and verify:
 *   1. Only truly new filings are detected (existing ones are skipped)
 *   2. Running detection twice with the same data produces 0 new filings on the second run
 *   3. Detection state is properly updated between runs
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FilingDetectorService,
} from '../../src/filings/filing-detector.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SecService } from '../../src/dataSources/sec/sec.service';
import { RateLimiterService } from '../../src/filings/rate-limiter.service';

// ─── Smart Generators ────────────────────────────────────────────────────────

/**
 * Generator for realistic stock ticker symbols (1-5 uppercase letters)
 */
const tickerArb = fc
  .array(
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
    { minLength: 1, maxLength: 5 },
  )
  .map((chars) => chars.join(''));

/**
 * Generator for SEC filing types (the three types the system monitors)
 */
const filingTypeArb = fc.constantFrom('10-K', '10-Q', '8-K');

/**
 * Generator for realistic SEC accession numbers (format: XXXXXXXXXX-YY-ZZZZZZ)
 */
const accessionNumberArb = fc
  .tuple(
    fc.integer({ min: 100000000, max: 9999999999 }),
    fc.integer({ min: 20, max: 26 }),
    fc.integer({ min: 100000, max: 999999 }),
  )
  .map(
    ([filer, year, seq]) =>
      `${filer}-${year}-${String(seq).padStart(6, '0')}`,
  );

/**
 * Generator for filing dates within the last 2 years (realistic range)
 */
const filingDateArb = fc
  .integer({
    min: Date.now() - 2 * 365 * 24 * 60 * 60 * 1000,
    max: Date.now(),
  })
  .map((ts) => new Date(ts));

/**
 * Generator for CIK numbers (SEC Central Index Key, 10-digit zero-padded)
 */
const cikArb = fc
  .integer({ min: 1, max: 9999999999 })
  .map((n) => String(n).padStart(10, '0'));

/**
 * Generator for a complete SEC filing object as returned by SecService.getFillings()
 */
const secFilingArb = fc
  .tuple(filingTypeArb, accessionNumberArb, filingDateArb)
  .map(([form, accessionNumber, filingDate]) => ({
    form,
    accessionNumber,
    filingDate: filingDate.toISOString().split('T')[0],
    reportDate: new Date(filingDate.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0],
    primaryDocument: `filing-${accessionNumber}.htm`,
    items: undefined as undefined,
    url: `https://www.sec.gov/Archives/edgar/data/${accessionNumber}/filing.htm`,
  }));

/**
 * Generator for a set of filings with guaranteed unique accession numbers.
 * Returns 2-8 filings to create a realistic scenario.
 */
const uniqueFilingsArb = fc
  .array(secFilingArb, { minLength: 2, maxLength: 8 })
  .map((filings) => {
    const seen = new Set<string>();
    return filings.filter((f) => {
      if (seen.has(f.accessionNumber)) return false;
      seen.add(f.accessionNumber);
      return true;
    });
  })
  .filter((filings) => filings.length >= 2);

/**
 * Generator for a scenario with existing and new filings.
 * Splits a set of unique filings into two groups:
 * - existingFilings: already in data_sources (should be skipped)
 * - newFilings: not yet in data_sources (should be detected)
 */
const incrementalScenarioArb = fc
  .tuple(tickerArb, cikArb, uniqueFilingsArb)
  .chain(([ticker, cik, allFilings]) => {
    // Split filings: at least 1 existing and at least 1 new
    const maxExisting = allFilings.length - 1;
    return fc
      .integer({ min: 1, max: Math.max(1, maxExisting) })
      .map((existingCount) => {
        const existingFilings = allFilings.slice(0, existingCount);
        const newFilings = allFilings.slice(existingCount);
        return {
          ticker,
          cik,
          allFilings,
          existingFilings,
          newFilings,
        };
      });
  })
  .filter((s) => s.existingFilings.length >= 1 && s.newFilings.length >= 1);

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Create a mock SEC EDGAR response for getFillings()
 */
function makeSecResponse(
  cik: string,
  ticker: string,
  formType: string,
  filings: any[],
) {
  return {
    metadata: {
      cik,
      ticker,
      companyName: `${ticker} Inc.`,
      dateRange: { startDate: undefined, endDate: undefined },
      formType,
      includeOlderPages: false,
    },
    summary: {
      totalFilings: filings.length,
      filingsInDateRange: filings.length,
      finalResults: filings.length,
      tenKCount: 0,
      tenQCount: 0,
      eightKCount: 0,
    },
    filings: { tenK: [], tenQ: [], eightK: [] },
    allFilings: filings,
  };
}

/**
 * Convert existing filings to data_source records (as stored in DB)
 */
function toDataSourceRecords(ticker: string, filings: any[]) {
  return filings.map((f) => ({
    metadata: {
      ticker,
      filingType: f.form,
      accessionNumber: f.accessionNumber,
      filingDate: f.filingDate,
      reportDate: f.reportDate,
      processed: true,
    },
  }));
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Property 6: Incremental Detection', () => {
  let service: FilingDetectorService;
  let prisma: any;
  let secService: any;
  let rateLimiter: any;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilingDetectorService,
        {
          provide: PrismaService,
          useValue: {
            filingDetectionState: {
              findUnique: jest.fn(),
              upsert: jest.fn(),
            },
            dataSource: {
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: SecService,
          useValue: {
            getCikForTicker: jest.fn(),
            getFillings: jest.fn(),
          },
        },
        {
          provide: RateLimiterService,
          useValue: {
            waitForRateLimit: jest.fn().mockResolvedValue(undefined),
            getMetrics: jest.fn().mockReturnValue({
              totalRequests: 0,
              totalDelays: 0,
              totalDelayTime: 0,
              averageDelayTime: 0,
              requestsLastSecond: 0,
              requestsLastMinute: 0,
              currentTokens: 9,
              maxRequestsPerSecond: 9,
              minDelayMs: 111,
              isCompliant: true,
            }),
            logMetrics: jest.fn(),
            resetMetrics: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FilingDetectorService>(FilingDetectorService);
    prisma = module.get<PrismaService>(PrismaService);
    secService = module.get<SecService>(SecService);
    rateLimiter = module.get<RateLimiterService>(RateLimiterService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Property 6a: Existing filings are skipped
   *
   * For any ticker T with a mix of existing and new filings, running
   * detection SHALL only report the truly new filings. Existing filings
   * (already in data_sources) SHALL NOT be counted as new.
   *
   * **Validates: Requirements US-5, FR-1**
   */
  it('should skip existing filings and only detect truly new ones', async () => {
    await fc.assert(
      fc.asyncProperty(incrementalScenarioArb, async (scenario) => {
        jest.clearAllMocks();

        const { ticker, cik, allFilings, existingFilings, newFilings } =
          scenario;

        // ── Arrange ──────────────────────────────────────────────────

        // Mock: Detection state exists (not first run)
        prisma.filingDetectionState.findUnique.mockResolvedValue({
          ticker,
          lastCheckDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          lastFilingDate: null,
          checkCount: 1,
          consecutiveFailures: 0,
        });

        // Mock: CIK lookup succeeds
        secService.getCikForTicker.mockResolvedValue({
          ticker,
          cik,
          cik_numeric: parseInt(cik, 10),
          name: `${ticker} Inc.`,
        });

        // Mock: SEC EDGAR returns ALL filings (both existing and new)
        // Return all filings on the first call (10-K), empty for the rest
        secService.getFillings
          .mockResolvedValueOnce(
            makeSecResponse(cik, ticker, '10-K', allFilings),
          )
          .mockResolvedValueOnce(
            makeSecResponse(cik, ticker, '10-Q', []),
          )
          .mockResolvedValueOnce(
            makeSecResponse(cik, ticker, '8-K', []),
          );

        // Mock: data_sources contains the existing filings
        prisma.dataSource.findMany.mockResolvedValue(
          toDataSourceRecords(ticker, existingFilings),
        );

        // Mock: Detection state upsert succeeds
        prisma.filingDetectionState.upsert.mockResolvedValue({
          ticker,
          lastCheckDate: new Date(),
          checkCount: 2,
          consecutiveFailures: 0,
        });

        // ── Act ──────────────────────────────────────────────────────

        const result = await service.detectNewFilings(ticker);

        // ── Assert ───────────────────────────────────────────────────

        // Property 6a: Only new filings are detected
        expect(result.newFilings).toBe(newFilings.length);

        // Property 6b: No errors for valid detection
        expect(result.errors).toHaveLength(0);

        // Property 6c: Existing filings were NOT counted
        expect(result.newFilings).toBeLessThan(allFilings.length);
      }),
      { numRuns: 10 },
    );
  }, 30000);

  /**
   * Property 6b: Second detection run finds zero new filings
   *
   * For any ticker T, if detection has already found and recorded all filings,
   * running detection again with the same SEC data SHALL produce 0 new filings.
   * This verifies the system does not re-download or re-process existing filings.
   *
   * **Validates: Requirements US-5, FR-1**
   */
  it('should find zero new filings on second run when all filings already exist', async () => {
    await fc.assert(
      fc.asyncProperty(
        tickerArb,
        cikArb,
        uniqueFilingsArb,
        async (ticker, cik, allFilings) => {
          jest.clearAllMocks();

          // ── Arrange ────────────────────────────────────────────────

          // Mock: Detection state exists from a previous run
          prisma.filingDetectionState.findUnique.mockResolvedValue({
            ticker,
            lastCheckDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
            lastFilingDate: null,
            checkCount: 5,
            consecutiveFailures: 0,
          });

          // Mock: CIK lookup succeeds
          secService.getCikForTicker.mockResolvedValue({
            ticker,
            cik,
            cik_numeric: parseInt(cik, 10),
            name: `${ticker} Inc.`,
          });

          // Mock: SEC EDGAR returns the same filings as before
          secService.getFillings
            .mockResolvedValueOnce(
              makeSecResponse(cik, ticker, '10-K', allFilings),
            )
            .mockResolvedValueOnce(
              makeSecResponse(cik, ticker, '10-Q', []),
            )
            .mockResolvedValueOnce(
              makeSecResponse(cik, ticker, '8-K', []),
            );

          // Mock: ALL filings already exist in data_sources (from previous run)
          prisma.dataSource.findMany.mockResolvedValue(
            toDataSourceRecords(ticker, allFilings),
          );

          // Mock: Detection state upsert succeeds
          prisma.filingDetectionState.upsert.mockResolvedValue({
            ticker,
            lastCheckDate: new Date(),
            checkCount: 6,
            consecutiveFailures: 0,
          });

          // ── Act ────────────────────────────────────────────────────

          const result = await service.detectNewFilings(ticker);

          // ── Assert ─────────────────────────────────────────────────

          // Property 6: Zero new filings when all already exist
          expect(result.newFilings).toBe(0);

          // No errors for valid detection
          expect(result.errors).toHaveLength(0);

          // Detection state was still updated (check count incremented)
          expect(prisma.filingDetectionState.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
              where: { ticker },
              update: expect.objectContaining({
                checkCount: 6,
                consecutiveFailures: 0,
              }),
            }),
          );
        },
      ),
      { numRuns: 10 },
    );
  }, 30000);

  /**
   * Property 6c: Detection state is properly updated between runs
   *
   * For any ticker T, after detection runs, the detection state SHALL be
   * updated with a new lastCheckDate and incremented checkCount, ensuring
   * the system tracks its progress for incremental detection.
   *
   * **Validates: Requirements US-5, FR-1**
   */
  it('should update detection state with incremented checkCount after each run', async () => {
    await fc.assert(
      fc.asyncProperty(
        tickerArb,
        cikArb,
        uniqueFilingsArb,
        fc.integer({ min: 0, max: 50 }),
        async (ticker, cik, allFilings, previousCheckCount) => {
          jest.clearAllMocks();

          // ── Arrange ────────────────────────────────────────────────

          const previousCheckDate = new Date(
            Date.now() - 24 * 60 * 60 * 1000,
          );

          // Mock: Detection state with a known checkCount
          prisma.filingDetectionState.findUnique.mockResolvedValue({
            ticker,
            lastCheckDate: previousCheckDate,
            lastFilingDate: null,
            checkCount: previousCheckCount,
            consecutiveFailures: 0,
          });

          // Mock: CIK lookup succeeds
          secService.getCikForTicker.mockResolvedValue({
            ticker,
            cik,
            cik_numeric: parseInt(cik, 10),
            name: `${ticker} Inc.`,
          });

          // Mock: SEC returns filings
          secService.getFillings
            .mockResolvedValueOnce(
              makeSecResponse(cik, ticker, '10-K', allFilings),
            )
            .mockResolvedValueOnce(
              makeSecResponse(cik, ticker, '10-Q', []),
            )
            .mockResolvedValueOnce(
              makeSecResponse(cik, ticker, '8-K', []),
            );

          // Mock: No existing data sources (all filings are new)
          prisma.dataSource.findMany.mockResolvedValue([]);

          // Mock: Detection state upsert succeeds
          prisma.filingDetectionState.upsert.mockResolvedValue({
            ticker,
            lastCheckDate: new Date(),
            checkCount: previousCheckCount + 1,
            consecutiveFailures: 0,
          });

          // ── Act ────────────────────────────────────────────────────

          const result = await service.detectNewFilings(ticker);

          // ── Assert ─────────────────────────────────────────────────

          // No errors
          expect(result.errors).toHaveLength(0);

          // Detection state was updated
          expect(prisma.filingDetectionState.upsert).toHaveBeenCalledTimes(1);

          const upsertCall =
            prisma.filingDetectionState.upsert.mock.calls[0][0];

          // Property 6c-1: checkCount is incremented by 1
          expect(upsertCall.update.checkCount).toBe(
            previousCheckCount + 1,
          );

          // Property 6c-2: consecutiveFailures is reset to 0 on success
          expect(upsertCall.update.consecutiveFailures).toBe(0);

          // Property 6c-3: lastCheckDate is updated to a recent time
          const updatedCheckDate = upsertCall.update.lastCheckDate;
          expect(updatedCheckDate).toBeInstanceOf(Date);
          const now = new Date();
          expect(
            now.getTime() - updatedCheckDate.getTime(),
          ).toBeLessThan(5000); // Within 5 seconds

          // Property 6c-4: The upsert targets the correct ticker
          expect(upsertCall.where.ticker).toBe(ticker);
        },
      ),
      { numRuns: 10 },
    );
  }, 30000);
});
