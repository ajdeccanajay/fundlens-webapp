/**
 * Property-Based Tests for ResponseType Classification
 *
 * Feature: rag-chatbot-master-engineering
 * Property tested:
 * - Property 11: ResponseType classification invariant
 *
 * Tests the pure function classifyResponseType() from query-intent.ts.
 * No mocks needed — this is a pure function operating on data shapes.
 */

import * as fc from 'fast-check';
import {
  classifyResponseType,
  ResponseClassificationInput,
  ResponseType,
  QueryIntent,
  MetricResult,
  ChunkResult,
} from '../../src/rag/types/query-intent';

// ── Valid ResponseType values ────────────────────────────────────────────
const VALID_RESPONSE_TYPES: ResponseType[] = [
  'STRUCTURED_ONLY',
  'COMPUTED_ONLY',
  'HYBRID_SYNTHESIS',
  'PEER_COMPARISON',
  'TIME_SERIES',
  'CONCEPT_ANALYSIS',
  'DECOMPOSED_HYBRID',
  'NARRATIVE_ONLY',
];

// ── Generators ───────────────────────────────────────────────────────────

/** Minimal QueryIntent with configurable needsTrend */
const queryIntentArb = (overrides?: Partial<QueryIntent>): fc.Arbitrary<QueryIntent> =>
  fc.record({
    needsTrend: fc.boolean(),
    needsNarrative: fc.boolean(),
    needsComparison: fc.boolean(),
    needsComputation: fc.boolean(),
  }).map(({ needsTrend, needsNarrative, needsComparison, needsComputation }) => ({
    type: 'hybrid' as const,
    needsNarrative,
    needsComparison,
    needsComputation,
    needsTrend,
    confidence: 0.9,
    originalQuery: 'test query',
    ...overrides,
  }));

/** Generate a MetricResult stub */
const metricResultArb: fc.Arbitrary<MetricResult> = fc.record({
  ticker: fc.constantFrom('AAPL', 'MSFT', 'GOOGL', 'ABNB', 'META'),
  normalizedMetric: fc.constantFrom('revenue', 'net_income', 'ebitda'),
  rawLabel: fc.constant('Revenue'),
  value: fc.double({ min: 1, max: 1e9, noNaN: true, noDefaultInfinity: true }),
  fiscalPeriod: fc.constantFrom('FY2024', 'Q3FY2024', 'FY2023'),
  periodType: fc.constantFrom('annual', 'quarterly'),
  filingType: fc.constantFrom('10-K', '10-Q'),
  statementType: fc.constantFrom('income_statement', 'balance_sheet', 'cash_flow'),
  statementDate: fc.constant(new Date('2024-12-31')),
  filingDate: fc.constant(new Date('2025-02-15')),
  confidenceScore: fc.double({ min: 0.7, max: 1.0, noNaN: true }),
});

/** Generate a ChunkResult stub */
const chunkResultArb: fc.Arbitrary<ChunkResult> = fc.record({
  content: fc.string({ minLength: 10, maxLength: 200 }),
  score: fc.double({ min: 0.5, max: 1.0, noNaN: true }),
  metadata: fc.record({
    ticker: fc.constantFrom('AAPL', 'MSFT', 'GOOGL', 'ABNB'),
    documentType: fc.constantFrom('10-K', '10-Q'),
    chunkIndex: fc.nat({ max: 50 }),
  }),
});

/** Generate a computed result stub */
const computedResultArb = fc.record({
  canonical_id: fc.constantFrom('ebitda_margin', 'gross_profit_margin', 'roe'),
  value: fc.oneof(
    fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
    fc.constant(null as number | null),
  ),
});

/** Generate peer data (non-empty rows) */
const peerDataArb = fc.record({
  rows: fc.array(
    fc.record({
      ticker: fc.constantFrom('AAPL', 'MSFT', 'GOOGL', 'ABNB', 'META'),
      value: fc.oneof(
        fc.double({ min: 0, max: 1e9, noNaN: true, noDefaultInfinity: true }),
        fc.constant(null as number | null),
      ),
      rank: fc.nat({ max: 10 }),
    }),
    { minLength: 1, maxLength: 5 },
  ),
});

/** Generate sub-query results (non-empty) */
const subQueryResultsArb = fc.array(
  fc.record({
    subQuery: fc.string({ minLength: 5, maxLength: 100 }),
  }),
  { minLength: 1, maxLength: 3 },
);

/** Generate a concept match ID */
const conceptMatchIdArb = fc.constantFrom('leverage', 'liquidity', 'profitability', 'growth', 'valuation');

// ── Helper: build a full ResponseClassificationInput ─────────────────────

interface InputConfig {
  metricCount: number;
  narrativeCount: number;
  computedCount: number;
  hasSubQueries: boolean;
  hasPeerData: boolean;
  hasConceptMatch: boolean;
  needsTrend: boolean;
}

const inputConfigArb: fc.Arbitrary<InputConfig> = fc.record({
  metricCount: fc.nat({ max: 5 }),
  narrativeCount: fc.nat({ max: 5 }),
  computedCount: fc.nat({ max: 3 }),
  hasSubQueries: fc.boolean(),
  hasPeerData: fc.boolean(),
  hasConceptMatch: fc.boolean(),
  needsTrend: fc.boolean(),
});

function buildInput(
  config: InputConfig,
  metrics: MetricResult[],
  narratives: ChunkResult[],
  computedResults: Array<{ canonical_id: string; value: number | null }>,
  peerData: { rows: Array<{ ticker: string; value: number | null; rank: number }> } | undefined,
  subQueryResults: Array<{ subQuery: string }> | undefined,
  conceptMatchId: string | undefined,
  intent: QueryIntent,
): ResponseClassificationInput {
  return {
    intent,
    metrics: metrics.slice(0, config.metricCount),
    narratives: narratives.slice(0, config.narrativeCount),
    computedResults: computedResults.slice(0, config.computedCount),
    peerData: config.hasPeerData ? peerData : undefined,
    subQueryResults: config.hasSubQueries ? subQueryResults : undefined,
    conceptMatchId: config.hasConceptMatch ? conceptMatchId : undefined,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Feature: rag-chatbot-master-engineering, Property 11: ResponseType classification invariant', () => {
  /**
   * **Validates: Requirements 9.1**
   *
   * For any combination of intent type, metric count, narrative count,
   * ticker count, and decomposition state, the RAGService should assign
   * exactly one ResponseType from the 8-value enum.
   */

  it('always returns exactly one valid ResponseType for any input combination', () => {
    fc.assert(
      fc.property(
        inputConfigArb,
        fc.array(metricResultArb, { minLength: 0, maxLength: 5 }),
        fc.array(chunkResultArb, { minLength: 0, maxLength: 5 }),
        fc.array(computedResultArb, { minLength: 0, maxLength: 3 }),
        peerDataArb,
        subQueryResultsArb,
        conceptMatchIdArb,
        queryIntentArb(),
        (config, metrics, narratives, computed, peerData, subQueries, conceptId, intent) => {
          const input = buildInput(
            config, metrics, narratives, computed,
            peerData, subQueries, conceptId,
            { ...intent, needsTrend: config.needsTrend },
          );

          const result = classifyResponseType(input);

          // Must be exactly one of the 8 valid values
          expect(VALID_RESPONSE_TYPES).toContain(result);
          expect(typeof result).toBe('string');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns DECOMPOSED_HYBRID when subQueryResults is non-empty', () => {
    fc.assert(
      fc.property(
        fc.array(metricResultArb, { minLength: 0, maxLength: 3 }),
        fc.array(chunkResultArb, { minLength: 0, maxLength: 3 }),
        fc.array(computedResultArb, { minLength: 0, maxLength: 2 }),
        subQueryResultsArb,
        fc.option(peerDataArb, { nil: undefined }),
        fc.option(conceptMatchIdArb, { nil: undefined }),
        queryIntentArb(),
        (metrics, narratives, computed, subQueries, peerData, conceptId, intent) => {
          const input: ResponseClassificationInput = {
            intent,
            metrics,
            narratives,
            computedResults: computed,
            peerData,
            subQueryResults: subQueries,
            conceptMatchId: conceptId,
          };

          const result = classifyResponseType(input);

          // Sub-queries present → always DECOMPOSED_HYBRID (highest priority)
          expect(result).toBe('DECOMPOSED_HYBRID');
        },
      ),
      { numRuns: 10 },
    );
  });

  it('returns PEER_COMPARISON when peerData has rows and no sub-queries', () => {
    fc.assert(
      fc.property(
        fc.array(metricResultArb, { minLength: 0, maxLength: 3 }),
        fc.array(chunkResultArb, { minLength: 0, maxLength: 3 }),
        fc.array(computedResultArb, { minLength: 0, maxLength: 2 }),
        peerDataArb,
        fc.option(conceptMatchIdArb, { nil: undefined }),
        queryIntentArb(),
        (metrics, narratives, computed, peerData, conceptId, intent) => {
          const input: ResponseClassificationInput = {
            intent,
            metrics,
            narratives,
            computedResults: computed,
            peerData,
            subQueryResults: undefined,
            conceptMatchId: conceptId,
          };

          const result = classifyResponseType(input);

          // Peer data with rows → PEER_COMPARISON (2nd priority, no sub-queries)
          expect(result).toBe('PEER_COMPARISON');
        },
      ),
      { numRuns: 10 },
    );
  });

  it('returns CONCEPT_ANALYSIS when conceptMatchId is set and no higher-priority signals', () => {
    fc.assert(
      fc.property(
        fc.array(metricResultArb, { minLength: 0, maxLength: 3 }),
        fc.array(chunkResultArb, { minLength: 0, maxLength: 3 }),
        fc.array(computedResultArb, { minLength: 0, maxLength: 2 }),
        conceptMatchIdArb,
        queryIntentArb(),
        (metrics, narratives, computed, conceptId, intent) => {
          const input: ResponseClassificationInput = {
            intent,
            metrics,
            narratives,
            computedResults: computed,
            peerData: undefined,
            subQueryResults: undefined,
            conceptMatchId: conceptId,
          };

          const result = classifyResponseType(input);

          // Concept match → CONCEPT_ANALYSIS (3rd priority)
          expect(result).toBe('CONCEPT_ANALYSIS');
        },
      ),
      { numRuns: 10 },
    );
  });

  it('returns TIME_SERIES when needsTrend and has metrics, no higher-priority signals', () => {
    fc.assert(
      fc.property(
        fc.array(metricResultArb, { minLength: 1, maxLength: 5 }),
        fc.array(chunkResultArb, { minLength: 0, maxLength: 3 }),
        fc.array(computedResultArb, { minLength: 0, maxLength: 2 }),
        queryIntentArb({ needsTrend: true }),
        (metrics, narratives, computed, intent) => {
          const input: ResponseClassificationInput = {
            intent,
            metrics,
            narratives,
            computedResults: computed,
            peerData: undefined,
            subQueryResults: undefined,
            conceptMatchId: undefined,
          };

          const result = classifyResponseType(input);

          // needsTrend + metrics → TIME_SERIES (4th priority)
          expect(result).toBe('TIME_SERIES');
        },
      ),
      { numRuns: 10 },
    );
  });

  it('returns TIME_SERIES when needsTrend and has computed results only, no higher-priority signals', () => {
    fc.assert(
      fc.property(
        fc.array(computedResultArb, { minLength: 1, maxLength: 3 }),
        fc.array(chunkResultArb, { minLength: 0, maxLength: 3 }),
        queryIntentArb({ needsTrend: true }),
        (computed, narratives, intent) => {
          const input: ResponseClassificationInput = {
            intent,
            metrics: [],
            narratives,
            computedResults: computed,
            peerData: undefined,
            subQueryResults: undefined,
            conceptMatchId: undefined,
          };

          const result = classifyResponseType(input);

          expect(result).toBe('TIME_SERIES');
        },
      ),
      { numRuns: 10 },
    );
  });

  it('never throws for any valid input combination', () => {
    fc.assert(
      fc.property(
        inputConfigArb,
        fc.array(metricResultArb, { minLength: 0, maxLength: 5 }),
        fc.array(chunkResultArb, { minLength: 0, maxLength: 5 }),
        fc.array(computedResultArb, { minLength: 0, maxLength: 3 }),
        peerDataArb,
        subQueryResultsArb,
        conceptMatchIdArb,
        queryIntentArb(),
        (config, metrics, narratives, computed, peerData, subQueries, conceptId, intent) => {
          const input = buildInput(
            config, metrics, narratives, computed,
            peerData, subQueries, conceptId,
            { ...intent, needsTrend: config.needsTrend },
          );

          // Should never throw
          expect(() => classifyResponseType(input)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns STRUCTURED_ONLY when only metrics present (no narratives, no computed, no trend)', () => {
    fc.assert(
      fc.property(
        fc.array(metricResultArb, { minLength: 1, maxLength: 5 }),
        queryIntentArb({ needsTrend: false }),
        (metrics, intent) => {
          const input: ResponseClassificationInput = {
            intent,
            metrics,
            narratives: [],
            computedResults: [],
            peerData: undefined,
            subQueryResults: undefined,
            conceptMatchId: undefined,
          };

          const result = classifyResponseType(input);

          expect(result).toBe('STRUCTURED_ONLY');
        },
      ),
      { numRuns: 10 },
    );
  });

  it('returns NARRATIVE_ONLY when only narratives present (no metrics, no computed)', () => {
    fc.assert(
      fc.property(
        fc.array(chunkResultArb, { minLength: 1, maxLength: 5 }),
        queryIntentArb({ needsTrend: false }),
        (narratives, intent) => {
          const input: ResponseClassificationInput = {
            intent,
            metrics: [],
            narratives,
            computedResults: [],
            peerData: undefined,
            subQueryResults: undefined,
            conceptMatchId: undefined,
          };

          const result = classifyResponseType(input);

          expect(result).toBe('NARRATIVE_ONLY');
        },
      ),
      { numRuns: 10 },
    );
  });

  it('returns COMPUTED_ONLY when only computed results present (no metrics, no narratives)', () => {
    fc.assert(
      fc.property(
        fc.array(computedResultArb, { minLength: 1, maxLength: 3 }),
        queryIntentArb({ needsTrend: false }),
        (computed, intent) => {
          const input: ResponseClassificationInput = {
            intent,
            metrics: [],
            narratives: [],
            computedResults: computed,
            peerData: undefined,
            subQueryResults: undefined,
            conceptMatchId: undefined,
          };

          const result = classifyResponseType(input);

          expect(result).toBe('COMPUTED_ONLY');
        },
      ),
      { numRuns: 10 },
    );
  });

  it('returns HYBRID_SYNTHESIS when both metrics and narratives present (no higher-priority signals, no trend)', () => {
    fc.assert(
      fc.property(
        fc.array(metricResultArb, { minLength: 1, maxLength: 3 }),
        fc.array(chunkResultArb, { minLength: 1, maxLength: 3 }),
        queryIntentArb({ needsTrend: false }),
        (metrics, narratives, intent) => {
          const input: ResponseClassificationInput = {
            intent,
            metrics,
            narratives,
            computedResults: [],
            peerData: undefined,
            subQueryResults: undefined,
            conceptMatchId: undefined,
          };

          const result = classifyResponseType(input);

          expect(result).toBe('HYBRID_SYNTHESIS');
        },
      ),
      { numRuns: 10 },
    );
  });

  it('returns HYBRID_SYNTHESIS when computed results and narratives present (no higher-priority signals, no trend)', () => {
    fc.assert(
      fc.property(
        fc.array(computedResultArb, { minLength: 1, maxLength: 3 }),
        fc.array(chunkResultArb, { minLength: 1, maxLength: 3 }),
        queryIntentArb({ needsTrend: false }),
        (computed, narratives, intent) => {
          const input: ResponseClassificationInput = {
            intent,
            metrics: [],
            narratives,
            computedResults: computed,
            peerData: undefined,
            subQueryResults: undefined,
            conceptMatchId: undefined,
          };

          const result = classifyResponseType(input);

          expect(result).toBe('HYBRID_SYNTHESIS');
        },
      ),
      { numRuns: 10 },
    );
  });

  it('returns NARRATIVE_ONLY as fallback when no data is present at all', () => {
    fc.assert(
      fc.property(
        queryIntentArb({ needsTrend: false }),
        (intent) => {
          const input: ResponseClassificationInput = {
            intent,
            metrics: [],
            narratives: [],
            computedResults: [],
            peerData: undefined,
            subQueryResults: undefined,
            conceptMatchId: undefined,
          };

          const result = classifyResponseType(input);

          expect(result).toBe('NARRATIVE_ONLY');
        },
      ),
      { numRuns: 10 },
    );
  });

  it('respects priority order: DECOMPOSED_HYBRID > PEER_COMPARISON > CONCEPT_ANALYSIS', () => {
    fc.assert(
      fc.property(
        fc.array(metricResultArb, { minLength: 1, maxLength: 3 }),
        fc.array(chunkResultArb, { minLength: 1, maxLength: 3 }),
        peerDataArb,
        subQueryResultsArb,
        conceptMatchIdArb,
        queryIntentArb(),
        (metrics, narratives, peerData, subQueries, conceptId, intent) => {
          // All signals present — DECOMPOSED_HYBRID should win
          const inputAll: ResponseClassificationInput = {
            intent,
            metrics,
            narratives,
            computedResults: [],
            peerData,
            subQueryResults: subQueries,
            conceptMatchId: conceptId,
          };
          expect(classifyResponseType(inputAll)).toBe('DECOMPOSED_HYBRID');

          // Remove sub-queries — PEER_COMPARISON should win
          const inputNoSub: ResponseClassificationInput = {
            ...inputAll,
            subQueryResults: undefined,
          };
          expect(classifyResponseType(inputNoSub)).toBe('PEER_COMPARISON');

          // Remove peer data — CONCEPT_ANALYSIS should win
          const inputNoPeer: ResponseClassificationInput = {
            ...inputNoSub,
            peerData: undefined,
          };
          expect(classifyResponseType(inputNoPeer)).toBe('CONCEPT_ANALYSIS');
        },
      ),
      { numRuns: 10 },
    );
  });
});
