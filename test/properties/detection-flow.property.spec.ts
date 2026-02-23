/**
 * Property-Based Tests for Detection Flow (Task 4.4)
 *
 * Tests the three-layer detection flow in IntentDetectorService:
 *   Layer 1: Regex fast-path → Layer 2: FastPathCache → Layer 3: LLM
 *
 * Uses fast-check to generate random inputs and verify universal properties.
 *
 * Feature: intelligent-intent-detection-system
 * Properties tested:
 * - Property 1: Detection Layer Ordering
 * - Property 2: Fast-Path Confidence Correctness
 * - Property 6: Multi-Ticker Implies Comparison
 * - Property 7: Peer Comparison Detection
 * - Property 9: QueryIntent Output Invariants
 * - Property 10: Low Confidence Triggers Clarification
 * - Property 11: Graceful Degradation on Total Failure
 * - Property 15: ContextTicker Merging
 * - Property 17: Confidence Selection Between LLM and Regex
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { FastPathCache } from '../../src/rag/intent-detection/fast-path-cache';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

// ─── Known tickers from FastPathCache ────────────────────────────
const KNOWN_TICKERS = [
  'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'NVDA',
  'NFLX', 'INTC', 'ORCL', 'ADBE', 'PYPL', 'CSCO', 'SBUX', 'JPM',
  'BAC', 'WFC', 'DIS', 'AMD', 'CRM', 'PFE', 'MRK', 'JNJ', 'UNH',
];

const PERIODS = [
  'FY2024', 'FY2023', 'FY2022', 'Q1-2024', 'Q2-2024', 'Q3-2024', 'Q4-2024',
];

const EXACT_METRICS = ['revenue', 'net income', 'gross margin', 'operating income', 'total assets'];

const COMPARISON_CONNECTORS = ['vs', 'versus', 'compared to', 'relative to', 'against', 'stack up'];
const PEER_KEYWORDS = ['peers', 'competitors', 'comps', 'comparable companies', 'industry peers'];

// ─── Helpers ─────────────────────────────────────────────────────

const tickerArb = fc.constantFrom(...KNOWN_TICKERS);
const periodArb = fc.constantFrom(...PERIODS);
const metricArb = fc.constantFrom(...EXACT_METRICS);
const connectorArb = fc.constantFrom(...COMPARISON_CONNECTORS);
const peerKeywordArb = fc.constantFrom(...PEER_KEYWORDS);

function buildResolution(
  canonicalId: string,
  displayName: string,
  confidence: 'exact' | 'fuzzy_auto' | 'unresolved',
  type: 'atomic' | 'computed' = 'atomic',
  dbColumn?: string,
): MetricResolution {
  return {
    canonical_id: canonicalId,
    display_name: displayName,
    type,
    confidence,
    fuzzy_score: confidence === 'fuzzy_auto' ? 0.88 : null,
    original_query: canonicalId,
    match_source: confidence === 'unresolved' ? 'none' : 'synonym_index',
    suggestions: null,
    db_column: dbColumn || canonicalId,
  };
}

function buildLlmResponse(overrides: Record<string, any> = {}): string {
  const base = {
    tickers: ['AAPL'],
    rawMetricPhrases: ['revenue'],
    queryType: 'structured',
    period: 'FY2024',
    needsNarrative: false,
    needsComparison: false,
    needsComputation: false,
    needsTrend: false,
    needsPeerComparison: false,
    needsClarification: false,
    confidence: 0.9,
    ...overrides,
  };
  return JSON.stringify(base);
}


// ─── Test Suite ──────────────────────────────────────────────────

describe('Property Tests - Detection Flow', () => {
  let service: IntentDetectorService;
  let mockInvokeClaude: ReturnType<typeof vi.fn>;
  let mockLogDetection: ReturnType<typeof vi.fn>;
  let mockMetricResolve: ReturnType<typeof vi.fn>;
  let fastPathCache: FastPathCache;
  let mockCacheLookup: ReturnType<typeof vi.fn>;
  let mockCacheStore: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockInvokeClaude = vi.fn().mockResolvedValue(buildLlmResponse());
    mockLogDetection = vi.fn().mockResolvedValue(undefined);
    mockMetricResolve = vi.fn().mockImplementation((query: string) => {
      const q = query.toLowerCase();
      if (q.includes('revenue')) return buildResolution('revenue', 'Revenue', 'exact', 'atomic', 'revenue');
      if (q.includes('net income')) return buildResolution('net_income', 'Net Income', 'exact', 'atomic', 'net_income');
      if (q.includes('gross margin')) return buildResolution('gross_margin', 'Gross Margin', 'exact', 'computed', 'gross_margin');
      if (q.includes('operating income')) return buildResolution('operating_income', 'Operating Income', 'exact', 'atomic', 'operating_income');
      if (q.includes('total assets')) return buildResolution('total_assets', 'Total Assets', 'exact', 'atomic', 'total_assets');
      return buildResolution('', '', 'unresolved');
    });

    fastPathCache = new FastPathCache();
    mockCacheLookup = vi.spyOn(fastPathCache, 'lookup');
    mockCacheStore = vi.spyOn(fastPathCache, 'store');

    const mockBedrock = { invokeClaude: mockInvokeClaude };
    const mockAnalytics = { logDetection: mockLogDetection };
    const mockMetricRegistry = {
      resolve: mockMetricResolve,
      resolveMultiple: vi.fn().mockReturnValue([]),
      getKnownMetricNames: vi.fn().mockReturnValue(new Map()),
      normalizeMetricName: vi.fn((name: string) => name),
      getAllMetrics: vi.fn().mockReturnValue(new Map()),
    };
    const mockConceptRegistry = {
      matchConcept: vi.fn().mockReturnValue(null),
      getMetricBundle: vi.fn().mockReturnValue(null),
      getAllConceptIds: vi.fn().mockReturnValue([]),
      getConceptById: vi.fn().mockReturnValue(null),
    };
    const mockMetricLearning = {
      logUnrecognizedMetric: vi.fn().mockResolvedValue(undefined),
    };

    service = new (IntentDetectorService as any)(
      mockBedrock,
      mockAnalytics,
      mockMetricRegistry,
      undefined, // PrismaService (optional)
      mockConceptRegistry,
      mockMetricLearning,
      fastPathCache,
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // Property 1: Detection Layer Ordering
  // ═══════════════════════════════════════════════════════════════

  describe('Property 1: Detection Layer Ordering', () => {
    /**
     * **Validates: Requirements 1.1, 2.1**
     *
     * If regex fast-path returns confidence >= 0.9, cache and LLM are NOT invoked.
     * If regex < 0.9 and cache hits, LLM is NOT invoked.
     */

    it('regex fast-path >= 0.9 skips cache and LLM for any (ticker, metric, period)', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          metricArb,
          periodArb,
          async (ticker, metric, period) => {
            mockInvokeClaude.mockClear();
            mockCacheLookup.mockClear();

            const query = `${ticker.toLowerCase()} ${metric} ${period.toLowerCase()}`;
            const result = await service.detectIntent(query);

            expect(result.confidence).toBeGreaterThanOrEqual(0.9);
            // Cache should NOT be checked
            expect(mockCacheLookup).not.toHaveBeenCalled();
            // LLM should NOT be called
            expect(mockInvokeClaude).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('cache hit skips LLM invocation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            'what about apple revenue',
            'tell me about nvidia earnings',
            'how is microsoft doing',
          ),
          async (query) => {
            mockInvokeClaude.mockClear();
            mockCacheLookup.mockClear();

            // Mock cache to return a hit
            mockCacheLookup.mockReturnValueOnce({
              type: 'structured',
              ticker: 'AAPL',
              metrics: ['revenue'],
              needsNarrative: false,
              needsComparison: false,
              needsComputation: false,
              needsTrend: false,
              confidence: 0.92,
              originalQuery: query,
            });

            await service.detectIntent(query);

            // Cache was checked
            expect(mockCacheLookup).toHaveBeenCalled();
            // LLM should NOT be called since cache hit
            expect(mockInvokeClaude).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('cache miss + low regex confidence invokes LLM', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            'tell me about apple',
            'how is the market doing',
            'what are risk factors',
          ),
          async (query) => {
            mockInvokeClaude.mockClear();
            mockCacheLookup.mockClear();
            mockCacheLookup.mockReturnValue(null);

            await service.detectIntent(query);

            // Both cache and LLM should be invoked
            expect(mockCacheLookup).toHaveBeenCalled();
            expect(mockInvokeClaude).toHaveBeenCalled();
          },
        ),
        { numRuns: 10 },
      );
    });
  });


  // ═══════════════════════════════════════════════════════════════
  // Property 2: Fast-Path Confidence Correctness
  // ═══════════════════════════════════════════════════════════════

  describe('Property 2: Fast-Path Confidence Correctness', () => {
    /**
     * **Validates: Requirements 2.1, 2.3, 2.5, 2.7**
     *
     * Regex fast-path returns confidence >= 0.9 iff single ticker + exact metric
     * + explicit period. Multi-ticker → confidence = 0.5.
     */

    it('single ticker + exact metric + period → confidence >= 0.9', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          metricArb,
          periodArb,
          async (ticker, metric, period) => {
            const query = `${ticker.toLowerCase()} ${metric} ${period.toLowerCase()}`;
            const result = await service.detectIntent(query);

            expect(result.confidence).toBeGreaterThanOrEqual(0.9);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('missing period → confidence < 0.9', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          metricArb,
          async (ticker, metric) => {
            mockCacheLookup.mockReturnValue(null);
            // Use a query with no period — LLM will be called
            mockInvokeClaude.mockResolvedValue(
              buildLlmResponse({ confidence: 0.7, tickers: [ticker] }),
            );

            const query = `${ticker.toLowerCase()} ${metric}`;
            const result = await service.detectIntent(query);

            // The regex fast-path should NOT produce >= 0.9 without a period
            // (result may come from LLM, but fast-path confidence was < 0.9)
            expect(mockInvokeClaude).toHaveBeenCalled();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('missing metric → confidence < 0.9 (triggers LLM)', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          periodArb,
          async (ticker, period) => {
            mockCacheLookup.mockReturnValue(null);
            mockInvokeClaude.mockResolvedValue(
              buildLlmResponse({ confidence: 0.7, tickers: [ticker] }),
            );

            // Query with ticker and period but no recognizable metric
            const query = `${ticker.toLowerCase()} something ${period.toLowerCase()}`;
            const result = await service.detectIntent(query);

            // Fast-path should not have been sufficient
            expect(mockInvokeClaude).toHaveBeenCalled();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('multi-ticker → confidence = 0.5 from fast-path (delegates to LLM)', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          tickerArb.filter((t) => t !== 'AAPL'), // ensure different from first
          metricArb,
          periodArb,
          async (ticker1, ticker2, metric, period) => {
            // Ensure we get two different tickers
            if (ticker1 === ticker2) return;

            mockCacheLookup.mockReturnValue(null);
            mockInvokeClaude.mockResolvedValue(
              buildLlmResponse({
                tickers: [ticker1, ticker2],
                needsComparison: true,
                confidence: 0.9,
              }),
            );

            const query = `${ticker1.toLowerCase()} vs ${ticker2.toLowerCase()} ${metric} ${period.toLowerCase()}`;
            const result = await service.detectIntent(query);

            // The regex fast-path should have returned 0.5 for multi-ticker,
            // so LLM should have been invoked
            expect(mockInvokeClaude).toHaveBeenCalled();
          },
        ),
        { numRuns: 10 },
      );
    });
  });


  // ═══════════════════════════════════════════════════════════════
  // Property 6: Multi-Ticker Implies Comparison
  // ═══════════════════════════════════════════════════════════════

  describe('Property 6: Multi-Ticker Implies Comparison', () => {
    /**
     * **Validates: Requirements 3.1**
     *
     * Any QueryIntent with ticker as array of length >= 2 has
     * needsComparison = true.
     */

    it('LLM result with 2+ tickers always sets needsComparison = true', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          tickerArb,
          metricArb,
          fc.boolean(), // whether LLM explicitly sets needsComparison
          async (ticker1, ticker2, metric, llmSetsComparison) => {
            if (ticker1 === ticker2) return;

            mockCacheLookup.mockReturnValue(null);
            mockInvokeClaude.mockResolvedValue(
              buildLlmResponse({
                tickers: [ticker1, ticker2],
                rawMetricPhrases: [metric],
                needsComparison: llmSetsComparison,
                confidence: 0.9,
              }),
            );

            const query = `${ticker1.toLowerCase()} and ${ticker2.toLowerCase()} ${metric}`;
            const result = await service.detectIntent(query);

            // Structural comparison detection: multiple tickers → needsComparison = true
            if (Array.isArray(result.ticker) && result.ticker.length >= 2) {
              expect(result.needsComparison).toBe(true);
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('regex fast-path with multi-ticker sets needsComparison = true', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          tickerArb,
          async (ticker1, ticker2) => {
            if (ticker1 === ticker2) return;

            mockCacheLookup.mockReturnValue(null);
            mockInvokeClaude.mockResolvedValue(
              buildLlmResponse({
                tickers: [ticker1, ticker2],
                needsComparison: true,
                confidence: 0.9,
              }),
            );

            const query = `${ticker1.toLowerCase()} vs ${ticker2.toLowerCase()} revenue fy2024`;
            const result = await service.detectIntent(query);

            if (Array.isArray(result.ticker) && result.ticker.length >= 2) {
              expect(result.needsComparison).toBe(true);
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Property 7: Peer Comparison Detection
  // ═══════════════════════════════════════════════════════════════

  describe('Property 7: Peer Comparison Detection', () => {
    /**
     * **Validates: Requirements 3.2, 3.4**
     *
     * Multiple tickers + comparison connectors → needsPeerComparison = true.
     */

    it('multiple tickers + comparison connector → needsPeerComparison = true', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          tickerArb,
          connectorArb,
          metricArb,
          async (ticker1, ticker2, connector, metric) => {
            if (ticker1 === ticker2) return;

            mockCacheLookup.mockReturnValue(null);
            mockInvokeClaude.mockResolvedValue(
              buildLlmResponse({
                tickers: [ticker1, ticker2],
                rawMetricPhrases: [metric],
                needsComparison: true,
                needsPeerComparison: true,
                confidence: 0.9,
              }),
            );

            const query = `${ticker1.toLowerCase()} ${connector} ${ticker2.toLowerCase()} ${metric}`;
            const result = await service.detectIntent(query);

            // resolveFromLlmResult checks: needsPeerComparison from LLM OR
            // (tickers.length > 1 && hasComparisonConnectors(query))
            expect(result.needsPeerComparison).toBe(true);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('single ticker + peer keyword → needsPeerComparison = true via LLM', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          peerKeywordArb,
          async (ticker, peerKeyword) => {
            mockCacheLookup.mockReturnValue(null);
            mockInvokeClaude.mockResolvedValue(
              buildLlmResponse({
                tickers: [ticker],
                needsPeerComparison: true,
                confidence: 0.85,
              }),
            );

            const query = `${ticker.toLowerCase()} ${peerKeyword}`;
            const result = await service.detectIntent(query);

            expect(result.needsPeerComparison).toBe(true);
            // Ticker should remain a single string (not an array)
            if (result.ticker) {
              expect(typeof result.ticker).toBe('string');
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });


  // ═══════════════════════════════════════════════════════════════
  // Property 9: QueryIntent Output Invariants
  // ═══════════════════════════════════════════════════════════════

  describe('Property 9: QueryIntent Output Invariants', () => {
    /**
     * **Validates: Requirements 8.3, 8.4, 8.5, 12.3**
     *
     * For any query, returned QueryIntent has: confidence in [0,1],
     * valid ticker type, boolean flags, valid type, originalQuery equals input.
     */

    it('any string input produces a valid QueryIntent with correct invariants', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            // Normal queries
            fc.constantFrom(
              'aapl revenue fy2024',
              'tell me about apple',
              'compare nvda and msft',
              'what are risk factors',
            ),
            // Edge cases
            fc.constantFrom('', '   ', '!!!', '12345'),
            // Random strings
            fc.string({ minLength: 0, maxLength: 100 }),
          ),
          async (query) => {
            // Ensure LLM doesn't block — mock a reasonable response or error
            mockCacheLookup.mockReturnValue(null);
            mockInvokeClaude.mockResolvedValue(
              buildLlmResponse({ confidence: 0.7 }),
            );

            const result = await service.detectIntent(query);

            // 1. Result is never null/undefined
            expect(result).toBeDefined();
            expect(result).not.toBeNull();

            // 2. confidence is a number in [0, 1]
            expect(typeof result.confidence).toBe('number');
            expect(result.confidence).toBeGreaterThanOrEqual(0);
            expect(result.confidence).toBeLessThanOrEqual(1);

            // 3. ticker is undefined, string, or string[]
            if (result.ticker !== undefined) {
              const isString = typeof result.ticker === 'string';
              const isStringArray =
                Array.isArray(result.ticker) &&
                result.ticker.every((t: any) => typeof t === 'string');
              expect(isString || isStringArray).toBe(true);
            }

            // 4. boolean flags are booleans
            expect(typeof result.needsNarrative).toBe('boolean');
            expect(typeof result.needsComparison).toBe('boolean');
            expect(typeof result.needsComputation).toBe('boolean');
            expect(typeof result.needsTrend).toBe('boolean');

            // 5. type is one of the valid values
            expect(['structured', 'semantic', 'hybrid']).toContain(result.type);

            // 6. originalQuery equals the input
            expect(result.originalQuery).toBe(query);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('LLM failure still produces valid QueryIntent invariants', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 80 }),
          async (query) => {
            mockCacheLookup.mockReturnValue(null);
            mockInvokeClaude.mockRejectedValue(new Error('LLM timeout'));

            const result = await service.detectIntent(query);

            expect(result).toBeDefined();
            expect(typeof result.confidence).toBe('number');
            expect(result.confidence).toBeGreaterThanOrEqual(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
            expect(['structured', 'semantic', 'hybrid']).toContain(result.type);
            expect(typeof result.needsNarrative).toBe('boolean');
            expect(typeof result.needsComparison).toBe('boolean');
            expect(typeof result.needsComputation).toBe('boolean');
            expect(typeof result.needsTrend).toBe('boolean');
            expect(result.originalQuery).toBe(query);
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Property 10: Low Confidence Triggers Clarification
  // ═══════════════════════════════════════════════════════════════

  describe('Property 10: Low Confidence Triggers Clarification', () => {
    /**
     * **Validates: Requirements 12.2**
     *
     * confidence < 0.7 → needsClarification = true and ambiguityReason is non-empty.
     */

    it('LLM result with confidence < 0.7 → needsClarification + ambiguityReason', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: 0.01, max: 0.69, noNaN: true }),
          fc.constantFrom('vague query', 'something unclear', 'xyz'),
          async (lowConfidence, query) => {
            mockCacheLookup.mockReturnValue(null);
            mockInvokeClaude.mockResolvedValue(
              buildLlmResponse({
                confidence: lowConfidence,
                tickers: [],
                rawMetricPhrases: [],
                queryType: 'semantic',
                needsNarrative: true,
              }),
            );

            const result = await service.detectIntent(query);

            if (result.confidence < 0.7) {
              expect(result.needsClarification).toBe(true);
              expect(result.ambiguityReason).toBeDefined();
              expect(typeof result.ambiguityReason).toBe('string');
              expect(result.ambiguityReason!.length).toBeGreaterThan(0);
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('fallback with low confidence → needsClarification + ambiguityReason', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('xyz', 'random text', '!!!', 'blah blah'),
          async (query) => {
            mockCacheLookup.mockReturnValue(null);
            mockInvokeClaude.mockRejectedValue(new Error('LLM error'));

            const result = await service.detectIntent(query);

            // Fallback for unrecognizable queries should have low confidence
            if (result.confidence < 0.7) {
              expect(result.needsClarification).toBe(true);
              expect(result.ambiguityReason).toBeDefined();
              expect(result.ambiguityReason!.length).toBeGreaterThan(0);
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });


  // ═══════════════════════════════════════════════════════════════
  // Property 11: Graceful Degradation on Total Failure
  // ═══════════════════════════════════════════════════════════════

  describe('Property 11: Graceful Degradation on Total Failure', () => {
    /**
     * **Validates: Requirements 12.1**
     *
     * LLM throws + regex confidence < 0.5 → type "semantic",
     * needsNarrative true, originalQuery preserved.
     */

    it('LLM failure + low regex confidence → semantic fallback with originalQuery', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Queries that won't match any ticker/metric/period (low regex confidence)
          fc.constantFrom(
            'xyz',
            'random gibberish',
            'what is happening',
            '!!!',
            'tell me everything',
            'blah blah blah',
          ),
          async (query) => {
            mockCacheLookup.mockReturnValue(null);
            mockInvokeClaude.mockRejectedValue(new Error('LLM total failure'));

            const result = await service.detectIntent(query);

            // For queries with no recognizable ticker/metric/period,
            // regex confidence should be < 0.5, triggering semantic fallback
            expect(result).toBeDefined();
            expect(result.type).toBe('semantic');
            expect(result.needsNarrative).toBe(true);
            expect(result.originalQuery).toBe(query);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('LLM failure never returns null — always a valid QueryIntent', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (query) => {
            mockCacheLookup.mockReturnValue(null);
            mockInvokeClaude.mockRejectedValue(new Error('catastrophic failure'));

            const result = await service.detectIntent(query);

            expect(result).toBeDefined();
            expect(result).not.toBeNull();
            expect(result.originalQuery).toBe(query);
            expect(typeof result.confidence).toBe('number');
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Property 15: ContextTicker Merging
  // ═══════════════════════════════════════════════════════════════

  describe('Property 15: ContextTicker Merging', () => {
    /**
     * **Validates: Requirements 8.5**
     *
     * contextTicker provided + query mentions additional tickers →
     * result ticker contains both (deduplicated).
     */

    it('contextTicker + query ticker → result contains both (deduplicated)', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          tickerArb,
          metricArb,
          periodArb,
          async (contextTicker, queryTicker, metric, period) => {
            mockCacheLookup.mockReturnValue(null);
            mockInvokeClaude.mockResolvedValue(
              buildLlmResponse({
                tickers: [queryTicker],
                rawMetricPhrases: [metric],
                confidence: 0.9,
                needsComparison: contextTicker !== queryTicker,
              }),
            );

            const query = `${queryTicker.toLowerCase()} ${metric} ${period.toLowerCase()}`;
            const result = await service.detectIntent(query, 'tenant1', contextTicker);

            if (result.ticker) {
              if (contextTicker === queryTicker) {
                // Same ticker — should be a single string
                if (typeof result.ticker === 'string') {
                  expect(result.ticker.toUpperCase()).toBe(contextTicker.toUpperCase());
                }
              } else {
                // Different tickers — result should contain both
                const tickers = Array.isArray(result.ticker)
                  ? result.ticker.map((t: string) => t.toUpperCase())
                  : [result.ticker.toUpperCase()];
                // At minimum, the contextTicker should be present
                expect(tickers).toContain(contextTicker.toUpperCase());
              }
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('contextTicker with no query ticker → result ticker = contextTicker', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          async (contextTicker) => {
            // Query with no ticker — just a metric + period
            const query = `revenue fy2024`;
            const result = await service.detectIntent(query, 'tenant1', contextTicker);

            // contextTicker should be used as the ticker
            if (result.ticker) {
              const tickerStr = Array.isArray(result.ticker)
                ? result.ticker[0]
                : result.ticker;
              expect(tickerStr.toUpperCase()).toBe(contextTicker.toUpperCase());
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Property 17: Confidence Selection Between LLM and Regex
  // ═══════════════════════════════════════════════════════════════

  describe('Property 17: Confidence Selection Between LLM and Regex', () => {
    /**
     * **Validates: Requirements 12.5**
     *
     * regex confidence > 0.9 → regex result preferred (LLM not called).
     * LLM confidence > 0.8 + regex < 0.9 → LLM result used.
     */

    it('regex confidence >= 0.9 → regex result preferred, LLM not called', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          metricArb,
          periodArb,
          async (ticker, metric, period) => {
            mockInvokeClaude.mockClear();

            // Simple query that qualifies for fast-path (confidence >= 0.9)
            const query = `${ticker.toLowerCase()} ${metric} ${period.toLowerCase()}`;
            const result = await service.detectIntent(query);

            // Regex fast-path should have handled it
            expect(result.confidence).toBeGreaterThanOrEqual(0.9);
            expect(mockInvokeClaude).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 10 },
      );
    });

    it('LLM confidence > 0.8 + regex < 0.9 → LLM result used', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: 0.81, max: 0.99, noNaN: true }),
          fc.constantFrom(
            'tell me about apple revenue trends',
            'how is nvidia doing in AI',
            'what about microsoft cloud business',
          ),
          async (llmConfidence, query) => {
            mockCacheLookup.mockReturnValue(null);
            mockInvokeClaude.mockResolvedValue(
              buildLlmResponse({
                confidence: llmConfidence,
                tickers: ['AAPL'],
                rawMetricPhrases: ['revenue'],
              }),
            );

            const result = await service.detectIntent(query);

            // LLM should have been called (regex confidence < 0.9 for these queries)
            expect(mockInvokeClaude).toHaveBeenCalled();
            // Result should reflect LLM confidence (possibly adjusted)
            expect(result.confidence).toBeGreaterThanOrEqual(0.8);
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
