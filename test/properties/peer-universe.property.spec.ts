/**
 * Property-Based Tests for Peer Universe Resolution
 *
 * Feature: rag-chatbot-master-engineering
 * Properties tested:
 * - Property 22: Peer universe resolution
 *
 * Tests the lookupPeerUniverse() method on QueryRouterService by directly
 * setting the internal peerUniverses and tickerToUniverse maps.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { QueryRouterService, PeerUniverse } from '../../src/rag/query-router.service';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { ConceptRegistryService } from '../../src/rag/metric-resolution/concept-registry.service';

describe('Property Tests - Peer Universe Resolution', () => {
  let service: QueryRouterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryRouterService,
        {
          provide: IntentDetectorService,
          useValue: { detectIntent: jest.fn() },
        },
        {
          provide: MetricRegistryService,
          useValue: { resolveMultiple: jest.fn().mockReturnValue([]) },
        },
        {
          provide: ConceptRegistryService,
          useValue: { matchConcept: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<QueryRouterService>(QueryRouterService);
  });

  // ── Generators ──────────────────────────────────────────────────────────

  /** Generate a valid ticker (1-5 uppercase letters) */
  const tickerArb = fc.constantFrom(
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'ABNB', 'BKNG',
    'EXPE', 'TRIP', 'COIN', 'TSLA', 'NFLX', 'CRM', 'UBER', 'LYFT',
    'SQ', 'SHOP', 'SNOW', 'PLTR', 'DDOG', 'NET', 'ZS', 'CRWD',
    'MDB', 'TEAM', 'OKTA', 'TWLO', 'ROKU', 'PINS',
  );

  /** Generate a universe name (snake_case identifier) */
  const universeNameArb = fc.constantFrom(
    'online_travel',
    'us_mega_cap_tech',
    'fintech',
    'streaming',
    'ev_manufacturers',
    'cloud_infrastructure',
    'social_media',
    'semiconductors',
    'biotech_large_cap',
    'retail_ecommerce',
  );

  /** Generate a normalization basis */
  const normBasisArb = fc.constantFrom('FY' as const, 'LTM' as const, 'CY' as const);

  /** Generate a non-empty array of unique tickers for a peer universe (2-8 members) */
  const memberTickersArb = fc
    .uniqueArray(tickerArb, { minLength: 2, maxLength: 8 })
    .filter((arr) => arr.length >= 2);

  /** Generate a complete PeerUniverse definition with its members */
  const peerUniverseArb = fc
    .record({
      name: universeNameArb,
      members: memberTickersArb,
      normBasis: normBasisArb,
    })
    .map(({ name, members, normBasis }) => ({
      name,
      universe: {
        display_name: name.replace(/_/g, ' '),
        members,
        primary_metrics: ['revenue', 'operating_margin'],
        normalization_basis: normBasis,
      } as PeerUniverse,
    }));

  /**
   * Helper: set the internal maps on the service to simulate loaded peer universes.
   * First universe wins for ticker-to-universe mapping (matching loadPeerUniverses behavior).
   */
  function setUniverses(
    svc: QueryRouterService,
    universes: Array<{ name: string; universe: PeerUniverse }>,
  ): void {
    const peerMap = new Map<string, PeerUniverse>();
    const tickerMap = new Map<string, string>();

    for (const { name, universe } of universes) {
      peerMap.set(name, universe);
      for (const ticker of universe.members) {
        if (!tickerMap.has(ticker)) {
          tickerMap.set(ticker, name);
        }
      }
    }

    (svc as any).peerUniverses = peerMap;
    (svc as any).tickerToUniverse = tickerMap;
  }

  // ── Property 22: Peer universe resolution ───────────────────────────

  describe('Feature: rag-chatbot-master-engineering, Property 22: Peer universe resolution', () => {
    /**
     * **Validates: Requirements 17.1**
     *
     * For any single ticker that belongs to a defined peer universe,
     * when `needsPeerComparison` is true, the QueryRouter should expand
     * the ticker list to all members of that peer universe.
     */

    it('lookupPeerUniverse returns the correct universe for any member ticker', async () => {
      await fc.assert(
        fc.asyncProperty(peerUniverseArb, async ({ name, universe }) => {
          setUniverses(service, [{ name, universe }]);

          // For every member ticker, lookupPeerUniverse should return the universe
          for (const ticker of universe.members) {
            const result = service.lookupPeerUniverse(ticker);

            expect(result).toBeDefined();
            expect(result!.name).toBe(name);
            expect(result!.universe.members).toEqual(universe.members);
            expect(result!.universe.members).toContain(ticker);
          }
        }),
        { numRuns: 10 },
      );
    });

    it('returned universe contains all original members', async () => {
      await fc.assert(
        fc.asyncProperty(peerUniverseArb, async ({ name, universe }) => {
          setUniverses(service, [{ name, universe }]);

          // Pick any member and look up — the returned members array must
          // contain every ticker from the original universe definition
          const anyMember = universe.members[0];
          const result = service.lookupPeerUniverse(anyMember);

          expect(result).toBeDefined();
          expect(result!.universe.members.length).toBe(universe.members.length);
          for (const member of universe.members) {
            expect(result!.universe.members).toContain(member);
          }
        }),
        { numRuns: 10 },
      );
    });

    it('returns undefined for tickers not in any peer universe', async () => {
      await fc.assert(
        fc.asyncProperty(
          peerUniverseArb,
          tickerArb,
          async ({ name, universe }, randomTicker) => {
            // Only test when the random ticker is NOT a member
            fc.pre(!universe.members.includes(randomTicker));

            setUniverses(service, [{ name, universe }]);

            const result = service.lookupPeerUniverse(randomTicker);
            expect(result).toBeUndefined();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('first-universe-wins when a ticker appears in multiple universes', async () => {
      await fc.assert(
        fc.asyncProperty(
          memberTickersArb,
          universeNameArb,
          normBasisArb,
          async (sharedMembers, secondName, normBasis) => {
            const firstName = 'first_universe';
            // Ensure distinct universe names
            fc.pre(firstName !== secondName);

            const firstUniverse: PeerUniverse = {
              display_name: 'First Universe',
              members: sharedMembers,
              primary_metrics: ['revenue'],
              normalization_basis: 'FY',
            };
            const secondUniverse: PeerUniverse = {
              display_name: secondName.replace(/_/g, ' '),
              members: sharedMembers,
              primary_metrics: ['operating_margin'],
              normalization_basis: normBasis,
            };

            // Set first universe before second — first wins
            setUniverses(service, [
              { name: firstName, universe: firstUniverse },
              { name: secondName, universe: secondUniverse },
            ]);

            for (const ticker of sharedMembers) {
              const result = service.lookupPeerUniverse(ticker);
              expect(result).toBeDefined();
              expect(result!.name).toBe(firstName);
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('universe metadata (display_name, normalization_basis) is preserved', async () => {
      await fc.assert(
        fc.asyncProperty(peerUniverseArb, async ({ name, universe }) => {
          setUniverses(service, [{ name, universe }]);

          const ticker = universe.members[0];
          const result = service.lookupPeerUniverse(ticker);

          expect(result).toBeDefined();
          expect(result!.universe.display_name).toBe(universe.display_name);
          expect(result!.universe.normalization_basis).toBe(
            universe.normalization_basis,
          );
          expect(result!.universe.primary_metrics).toEqual(
            universe.primary_metrics,
          );
        }),
        { numRuns: 10 },
      );
    });
  });
});
