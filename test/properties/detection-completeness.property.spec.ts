/**
 * Property-Based Test: Detection Completeness
 * Feature: automatic-filing-detection, Property 1: Detection Completeness
 *
 * **Validates: Requirements US-1, FR-1**
 *
 * For any ticker T with at least one deal, if a new filing F is published to
 * SEC EDGAR, the system SHALL detect F within 24 hours of publication.
 *
 * Strategy:
 * - Generate random tickers, filing types, filing dates, and accession numbers
 * - Mock SEC EDGAR to return these filings for the generated ticker
 * - Mock the deals table to confirm the ticker has at least one deal
 * - Mock the data_sources table to confirm the filing is new (not yet downloaded)
 * - Call detectNewFilings() and verify the filing is detected (newFilings > 0)
 * - Verify detection state is updated with a lastCheckDate within 24 hours
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FilingDetectorService,
  SECFiling,
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
  .map(([filer, year, seq]) => `${filer}-${year}-${String(seq).padStart(6, '0')}`);

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
 * Generator for a complete SEC filing object
 */
const secFilingArb = fc
  .tuple(filingTypeArb, accessionNumberArb, filingDateArb)
  .map(([form, accessionNumber, filingDate]) => ({
    form,
    accessionNumber,
    filingDate: filingDate.toISOString().split('T')[0],
    reportDate: new Date(
      filingDate.getTime() - 30 * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .split('T')[0],
    primaryDocument: `filing-${accessionNumber}.htm`,
    items: undefined as undefined,
    url: `https://www.sec.gov/Archives/edgar/data/${accessionNumber}/filing.htm`,
  }));

/**
 * Generator for arrays of 1-5 unique SEC filings (simulating what SEC EDGAR returns)
 */
const secFilingsArrayArb = fc
  .array(secFilingArb, { minLength: 1, maxLength: 5 })
  .map((filings) => {
    // Ensure unique accession numbers
    const seen = new Set<string>();
    return filings.filter((f) => {
      if (seen.has(f.accessionNumber)) return false;
      seen.add(f.accessionNumber);
      return true;
    });
  })
  .filter((filings) => filings.length > 0);

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Property 1: Detection Completeness', () => {
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
   * Property 1: Detection Completeness
   *
   * For any ticker T with at least one deal, if a new filing F is published
   * to SEC EDGAR, the system SHALL detect F within 24 hours of publication.
   *
   * We verify:
   * 1. The detector returns newFilings > 0 when SEC returns new filings
   * 2. The detection state is updated (lastCheckDate set)
   * 3. No errors are reported for valid inputs
   */
  it('should detect all new filings returned by SEC EDGAR for any ticker with a deal', async () => {
    await fc.assert(
      fc.asyncProperty(
        tickerArb,
        cikArb,
        secFilingsArrayArb,
        async (ticker, cik, secFilings) => {
          // Reset mocks for each iteration
          jest.clearAllMocks();

          // ── Arrange ──────────────────────────────────────────────────

          // Mock: No previous detection state (first check for this ticker)
          prisma.filingDetectionState.findUnique.mockResolvedValue(null);

          // Mock: CIK lookup succeeds
          secService.getCikForTicker.mockResolvedValue({
            ticker,
            cik,
            cik_numeric: parseInt(cik, 10),
            name: `${ticker} Inc.`,
          });

          // Mock: SEC EDGAR returns the generated filings for ALL filing types
          // The detector queries once per filing type (10-K, 10-Q, 8-K)
          // We return all filings for the first call and empty for the rest
          // to simulate filings being found
          secService.getFillings
            .mockResolvedValueOnce({
              metadata: {
                cik,
                ticker,
                companyName: `${ticker} Inc.`,
                dateRange: { startDate: undefined, endDate: undefined },
                formType: '10-K',
                includeOlderPages: false,
              },
              summary: {
                totalFilings: secFilings.length,
                filingsInDateRange: secFilings.length,
                finalResults: secFilings.length,
                tenKCount: secFilings.length,
                tenQCount: 0,
                eightKCount: 0,
              },
              filings: { tenK: [], tenQ: [], eightK: [] },
              allFilings: secFilings,
            })
            .mockResolvedValueOnce({
              metadata: {
                cik,
                ticker,
                companyName: `${ticker} Inc.`,
                dateRange: { startDate: undefined, endDate: undefined },
                formType: '10-Q',
                includeOlderPages: false,
              },
              summary: {
                totalFilings: 0,
                filingsInDateRange: 0,
                finalResults: 0,
                tenKCount: 0,
                tenQCount: 0,
                eightKCount: 0,
              },
              filings: { tenK: [], tenQ: [], eightK: [] },
              allFilings: [],
            })
            .mockResolvedValueOnce({
              metadata: {
                cik,
                ticker,
                companyName: `${ticker} Inc.`,
                dateRange: { startDate: undefined, endDate: undefined },
                formType: '8-K',
                includeOlderPages: false,
              },
              summary: {
                totalFilings: 0,
                filingsInDateRange: 0,
                finalResults: 0,
                tenKCount: 0,
                tenQCount: 0,
                eightKCount: 0,
              },
              filings: { tenK: [], tenQ: [], eightK: [] },
              allFilings: [],
            });

          // Mock: No existing data sources (all filings are new)
          prisma.dataSource.findMany.mockResolvedValue([]);

          // Mock: Detection state upsert succeeds
          prisma.filingDetectionState.upsert.mockResolvedValue({
            ticker,
            lastCheckDate: new Date(),
            lastFilingDate: new Date(secFilings[0].filingDate),
            checkCount: 1,
            consecutiveFailures: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // ── Act ──────────────────────────────────────────────────────

          const result = await service.detectNewFilings(ticker);

          // ── Assert ───────────────────────────────────────────────────

          // Property 1a: All new filings must be detected
          expect(result.newFilings).toBe(secFilings.length);

          // Property 1b: No errors for valid detection
          expect(result.errors).toHaveLength(0);

          // Property 1c: Ticker in result matches input
          expect(result.ticker).toBe(ticker);

          // Property 1d: Detection state was updated (lastCheckDate set)
          expect(prisma.filingDetectionState.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
              where: { ticker },
              create: expect.objectContaining({
                ticker,
                consecutiveFailures: 0,
              }),
              update: expect.objectContaining({
                consecutiveFailures: 0,
              }),
            }),
          );

          // Property 1e: The lastCheckDate in the upsert is within 24 hours of now
          const upsertCall =
            prisma.filingDetectionState.upsert.mock.calls[0][0];
          const lastCheckDate = upsertCall.create.lastCheckDate;
          const now = new Date();
          const twentyFourHoursMs = 24 * 60 * 60 * 1000;
          expect(
            now.getTime() - lastCheckDate.getTime(),
          ).toBeLessThan(twentyFourHoursMs);

          // Property 1f: Rate limiter was called (SEC compliance)
          expect(rateLimiter.waitForRateLimit).toHaveBeenCalled();
        },
      ),
      { numRuns: 10 },
    );
  }, 30000);

  /**
   * Property 1 (variant): Detection with prior state
   *
   * For any ticker that has been checked before, if SEC returns new filings
   * since the last check date, the system SHALL detect them.
   */
  it('should detect new filings even when prior detection state exists', async () => {
    await fc.assert(
      fc.asyncProperty(
        tickerArb,
        cikArb,
        secFilingsArrayArb,
        filingDateArb,
        async (ticker, cik, secFilings, lastCheckDate) => {
          jest.clearAllMocks();

          // ── Arrange ──────────────────────────────────────────────────

          // Mock: Previous detection state exists
          prisma.filingDetectionState.findUnique.mockResolvedValue({
            ticker,
            lastCheckDate,
            lastFilingDate: new Date(
              lastCheckDate.getTime() - 7 * 24 * 60 * 60 * 1000,
            ),
            checkCount: 5,
            consecutiveFailures: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Mock: CIK lookup succeeds
          secService.getCikForTicker.mockResolvedValue({
            ticker,
            cik,
            cik_numeric: parseInt(cik, 10),
            name: `${ticker} Inc.`,
          });

          // Mock: SEC returns filings (all types return same set for simplicity)
          const emptyResponse = {
            metadata: {
              cik,
              ticker,
              companyName: `${ticker} Inc.`,
              dateRange: {
                startDate: lastCheckDate.toISOString().split('T')[0],
                endDate: undefined,
              },
              formType: '10-K',
              includeOlderPages: false,
            },
            summary: {
              totalFilings: 0,
              filingsInDateRange: 0,
              finalResults: 0,
              tenKCount: 0,
              tenQCount: 0,
              eightKCount: 0,
            },
            filings: { tenK: [], tenQ: [], eightK: [] },
            allFilings: [],
          };

          secService.getFillings
            .mockResolvedValueOnce({
              ...emptyResponse,
              metadata: { ...emptyResponse.metadata, formType: '10-K' },
              summary: {
                ...emptyResponse.summary,
                totalFilings: secFilings.length,
                filingsInDateRange: secFilings.length,
                finalResults: secFilings.length,
              },
              allFilings: secFilings,
            })
            .mockResolvedValueOnce({
              ...emptyResponse,
              metadata: { ...emptyResponse.metadata, formType: '10-Q' },
            })
            .mockResolvedValueOnce({
              ...emptyResponse,
              metadata: { ...emptyResponse.metadata, formType: '8-K' },
            });

          // Mock: No existing data sources (all filings are new)
          prisma.dataSource.findMany.mockResolvedValue([]);

          // Mock: Detection state upsert succeeds
          prisma.filingDetectionState.upsert.mockResolvedValue({
            ticker,
            lastCheckDate: new Date(),
            lastFilingDate: new Date(secFilings[0].filingDate),
            checkCount: 6,
            consecutiveFailures: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // ── Act ──────────────────────────────────────────────────────

          const result = await service.detectNewFilings(ticker);

          // ── Assert ───────────────────────────────────────────────────

          // Property: All new filings detected even with prior state
          expect(result.newFilings).toBe(secFilings.length);
          expect(result.errors).toHaveLength(0);
          expect(result.ticker).toBe(ticker);

          // Verify forward-looking detection: startDate was passed
          const firstGetFillingsCall = secService.getFillings.mock.calls[0];
          expect(firstGetFillingsCall[1].startDate).toBe(
            lastCheckDate.toISOString().split('T')[0],
          );

          // Detection state was updated with incremented checkCount
          expect(prisma.filingDetectionState.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
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
   * Property 1 (variant): Detection across all filing types
   *
   * For any combination of filing types returned by SEC, the system SHALL
   * detect all of them regardless of type.
   */
  it('should detect filings across all supported filing types (10-K, 10-Q, 8-K)', async () => {
    await fc.assert(
      fc.asyncProperty(
        tickerArb,
        cikArb,
        fc.record({
          tenK: fc.array(secFilingArb, { minLength: 0, maxLength: 2 }),
          tenQ: fc.array(secFilingArb, { minLength: 0, maxLength: 2 }),
          eightK: fc.array(secFilingArb, { minLength: 0, maxLength: 2 }),
        }),
        async (ticker, cik, filingsByType) => {
          // Ensure at least one filing exists across all types
          const totalFilings =
            filingsByType.tenK.length +
            filingsByType.tenQ.length +
            filingsByType.eightK.length;
          if (totalFilings === 0) return; // Skip if no filings generated

          jest.clearAllMocks();

          // ── Arrange ──────────────────────────────────────────────────

          prisma.filingDetectionState.findUnique.mockResolvedValue(null);

          secService.getCikForTicker.mockResolvedValue({
            ticker,
            cik,
            cik_numeric: parseInt(cik, 10),
            name: `${ticker} Inc.`,
          });

          const makeResponse = (formType: string, filings: any[]) => ({
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
          });

          secService.getFillings
            .mockResolvedValueOnce(makeResponse('10-K', filingsByType.tenK))
            .mockResolvedValueOnce(makeResponse('10-Q', filingsByType.tenQ))
            .mockResolvedValueOnce(
              makeResponse('8-K', filingsByType.eightK),
            );

          prisma.dataSource.findMany.mockResolvedValue([]);

          prisma.filingDetectionState.upsert.mockResolvedValue({
            ticker,
            lastCheckDate: new Date(),
            lastFilingDate: null,
            checkCount: 1,
            consecutiveFailures: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // ── Act ──────────────────────────────────────────────────────

          const result = await service.detectNewFilings(ticker);

          // ── Assert ───────────────────────────────────────────────────

          // Property: Total detected filings equals sum across all types
          expect(result.newFilings).toBe(totalFilings);
          expect(result.errors).toHaveLength(0);

          // All three filing types were queried
          expect(secService.getFillings).toHaveBeenCalledTimes(3);
        },
      ),
      { numRuns: 10 },
    );
  }, 30000);
});
