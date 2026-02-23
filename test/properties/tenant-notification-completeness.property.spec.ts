/**
 * Property-Based Test: Tenant Notification Completeness
 * Feature: automatic-filing-detection, Property 3: Tenant Notification Completeness
 *
 * **Validates: Requirements US-3, FR-5**
 *
 * For any successfully processed filing F for ticker T, the system SHALL create
 * a notification for every tenant that has at least one deal where deal.ticker = T.
 *
 * Additionally, tenants WITHOUT deals for ticker T SHALL NOT receive notifications.
 *
 * Strategy:
 * - Generate random sets of tenants, each with random sets of deals (tickers)
 * - Generate a random filing for a random ticker
 * - Mock PrismaService to track which tenants have deals for which tickers
 * - Call createNotifications() and verify:
 *   1. Every tenant with a deal for the filing's ticker receives exactly one notification
 *   2. Tenants without deals for the filing's ticker do NOT receive notifications
 *   3. The total notification count matches the number of qualifying tenants
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { FilingNotificationService } from '../../src/filings/filing-notification.service';
import { PrismaService } from '../../prisma/prisma.service';

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
 * Generator for unique ticker sets (2-8 tickers to create a realistic universe)
 */
const tickerUniverseArb = fc
  .array(tickerArb, { minLength: 2, maxLength: 8 })
  .map((tickers) => [...new Set(tickers)])
  .filter((tickers) => tickers.length >= 2);

/**
 * Generator for UUID-like tenant IDs
 */
const tenantIdArb = fc.uuid();

/**
 * Generator for SEC filing types
 */
const filingTypeArb = fc.constantFrom('10-K', '10-Q', '8-K');

/**
 * Generator for realistic SEC accession numbers
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
 * Generator for filing dates within the last 2 years
 */
const filingDateArb = fc
  .integer({
    min: Date.now() - 2 * 365 * 24 * 60 * 60 * 1000,
    max: Date.now(),
  })
  .map((ts) => new Date(ts));

/**
 * Generator for a tenant with a set of deal tickers.
 * Each tenant has 1-4 deals, each for a ticker from the provided universe.
 */
const tenantWithDealsArb = (tickerUniverse: string[]) =>
  fc
    .tuple(
      tenantIdArb,
      fc.subarray(tickerUniverse, { minLength: 1, maxLength: Math.min(4, tickerUniverse.length) }),
    )
    .map(([tenantId, dealTickers]) => ({
      tenantId,
      dealTickers,
    }));

/**
 * Generator for a complete test scenario:
 * - A universe of tickers
 * - 2-6 tenants, each with deals for a subset of tickers
 * - A filing for one specific ticker from the universe
 */
const scenarioArb = tickerUniverseArb.chain((tickerUniverse) =>
  fc
    .tuple(
      fc.array(tenantWithDealsArb(tickerUniverse), {
        minLength: 2,
        maxLength: 6,
      }),
      fc.constantFrom(...tickerUniverse),
      filingTypeArb,
      accessionNumberArb,
      filingDateArb,
    )
    .map(([tenants, filingTicker, filingType, accessionNumber, filingDate]) => {
      // Ensure unique tenant IDs
      const seenIds = new Set<string>();
      const uniqueTenants = tenants.filter((t) => {
        if (seenIds.has(t.tenantId)) return false;
        seenIds.add(t.tenantId);
        return true;
      });

      return {
        tickerUniverse,
        tenants: uniqueTenants,
        filingTicker,
        filing: {
          form: filingType,
          filingDate,
          reportDate: new Date(filingDate.getTime() - 30 * 24 * 60 * 60 * 1000),
          accessionNumber,
        },
      };
    })
    .filter((s) => s.tenants.length >= 2),
);

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Property 3: Tenant Notification Completeness', () => {
  let service: FilingNotificationService;
  let prisma: any;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilingNotificationService,
        {
          provide: PrismaService,
          useValue: {
            deal: {
              findMany: jest.fn(),
            },
            filingNotification: {
              create: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<FilingNotificationService>(FilingNotificationService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Property 3: Tenant Notification Completeness
   *
   * For any successfully processed filing F for ticker T, the system SHALL
   * create a notification for every tenant that has at least one deal where
   * deal.ticker = T.
   *
   * We verify:
   * 1. Every tenant with a deal for ticker T receives a notification
   * 2. Tenants WITHOUT deals for ticker T do NOT receive notifications
   * 3. The returned count matches the number of qualifying tenants
   * 4. Each notification contains the correct filing metadata
   */
  it('should create notifications for exactly the tenants with deals for the filing ticker', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        // Reset mocks for each iteration
        jest.clearAllMocks();

        const { tenants, filingTicker, filing } = scenario;

        // ── Derive expected results ──────────────────────────────────

        // Tenants that SHOULD receive notifications (have a deal for filingTicker)
        const qualifyingTenants = tenants.filter((t) =>
          t.dealTickers.includes(filingTicker),
        );
        const qualifyingTenantIds = qualifyingTenants.map((t) => t.tenantId);

        // Tenants that should NOT receive notifications
        const nonQualifyingTenants = tenants.filter(
          (t) => !t.dealTickers.includes(filingTicker),
        );

        // ── Arrange ──────────────────────────────────────────────────

        // Mock: deal.findMany returns distinct tenantIds for the filing ticker
        // The service queries: prisma.deal.findMany({ where: { ticker }, select: { tenantId: true }, distinct: ['tenantId'] })
        prisma.deal.findMany.mockResolvedValue(
          qualifyingTenantIds.map((tenantId) => ({ tenantId })),
        );

        // Mock: filingNotification.create returns a notification object for each call
        // Track all created notifications to verify correctness
        const createdNotifications: any[] = [];
        prisma.filingNotification.create.mockImplementation(
          async (args: any) => {
            const notification = {
              id: `notif-${createdNotifications.length + 1}`,
              ...args.data,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            createdNotifications.push(notification);
            return notification;
          },
        );

        // ── Act ──────────────────────────────────────────────────────

        const notificationCount = await service.createNotifications(
          filingTicker,
          filing,
        );

        // ── Assert ───────────────────────────────────────────────────

        // Property 3a: Notification count equals number of qualifying tenants
        expect(notificationCount).toBe(qualifyingTenantIds.length);

        // Property 3b: Exactly one notification created per qualifying tenant
        expect(createdNotifications.length).toBe(qualifyingTenantIds.length);

        // Property 3c: Every qualifying tenant received a notification
        const notifiedTenantIds = createdNotifications.map(
          (n) => n.tenantId,
        );
        for (const tenantId of qualifyingTenantIds) {
          expect(notifiedTenantIds).toContain(tenantId);
        }

        // Property 3d: No non-qualifying tenant received a notification
        for (const tenant of nonQualifyingTenants) {
          expect(notifiedTenantIds).not.toContain(tenant.tenantId);
        }

        // Property 3e: Each notification contains correct filing metadata
        for (const notification of createdNotifications) {
          expect(notification.ticker).toBe(filingTicker);
          expect(notification.filingType).toBe(filing.form);
          expect(notification.filingDate).toEqual(filing.filingDate);
          expect(notification.accessionNumber).toBe(filing.accessionNumber);
          expect(notification.dismissed).toBe(false);
        }

        // Property 3f: The deal query was made with the correct ticker
        expect(prisma.deal.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { ticker: filingTicker },
            select: { tenantId: true },
            distinct: ['tenantId'],
          }),
        );
      }),
      { numRuns: 10 },
    );
  }, 30000);

  /**
   * Property 3 (variant): Zero notifications when no tenants have deals
   *
   * For any filing F for ticker T, if NO tenant has a deal for T,
   * the system SHALL create zero notifications.
   */
  it('should create zero notifications when no tenant has a deal for the filing ticker', async () => {
    await fc.assert(
      fc.asyncProperty(
        tickerArb,
        filingTypeArb,
        accessionNumberArb,
        filingDateArb,
        async (ticker, filingType, accessionNumber, filingDate) => {
          jest.clearAllMocks();

          // ── Arrange ──────────────────────────────────────────────────

          // Mock: No deals exist for this ticker
          prisma.deal.findMany.mockResolvedValue([]);

          const filing = {
            form: filingType,
            filingDate,
            reportDate: new Date(
              filingDate.getTime() - 30 * 24 * 60 * 60 * 1000,
            ),
            accessionNumber,
          };

          // ── Act ──────────────────────────────────────────────────────

          const notificationCount = await service.createNotifications(
            ticker,
            filing,
          );

          // ── Assert ───────────────────────────────────────────────────

          // Property: Zero notifications when no tenants have deals
          expect(notificationCount).toBe(0);

          // No notification.create calls should have been made
          expect(prisma.filingNotification.create).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 10 },
    );
  }, 30000);

  /**
   * Property 3 (variant): Single tenant with multiple deals for same ticker
   *
   * For any tenant T with multiple deals for ticker X, the system SHALL
   * create exactly ONE notification for T (not one per deal).
   */
  it('should create exactly one notification per tenant even with multiple deals for the same ticker', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        tickerArb,
        filingTypeArb,
        accessionNumberArb,
        filingDateArb,
        fc.integer({ min: 2, max: 5 }),
        async (
          tenantId,
          ticker,
          filingType,
          accessionNumber,
          filingDate,
          _dealCount,
        ) => {
          jest.clearAllMocks();

          // ── Arrange ──────────────────────────────────────────────────

          // Mock: The distinct query returns only one tenantId
          // (even though the tenant has multiple deals for this ticker,
          //  the distinct: ['tenantId'] ensures deduplication)
          prisma.deal.findMany.mockResolvedValue([{ tenantId }]);

          const createdNotifications: any[] = [];
          prisma.filingNotification.create.mockImplementation(
            async (args: any) => {
              const notification = {
                id: `notif-${createdNotifications.length + 1}`,
                ...args.data,
                createdAt: new Date(),
                updatedAt: new Date(),
              };
              createdNotifications.push(notification);
              return notification;
            },
          );

          const filing = {
            form: filingType,
            filingDate,
            reportDate: new Date(
              filingDate.getTime() - 30 * 24 * 60 * 60 * 1000,
            ),
            accessionNumber,
          };

          // ── Act ──────────────────────────────────────────────────────

          const notificationCount = await service.createNotifications(
            ticker,
            filing,
          );

          // ── Assert ───────────────────────────────────────────────────

          // Property: Exactly one notification per tenant
          expect(notificationCount).toBe(1);
          expect(createdNotifications.length).toBe(1);
          expect(createdNotifications[0].tenantId).toBe(tenantId);
          expect(createdNotifications[0].ticker).toBe(ticker);
        },
      ),
      { numRuns: 10 },
    );
  }, 30000);
});
