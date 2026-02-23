/**
 * Property-Based Tests for Peer-Grounded Provocation
 *
 * Feature: rag-chatbot-master-engineering
 * Properties tested:
 * - Property 23: Peer-grounded provocation trigger
 *
 * For any FinancialAnalysisContext with non-null `peerData`,
 * the synthesis prompt Step 5 should use the peer-grounded provocation
 * template instead of the standard provocation template.
 *
 * **Validates: Requirements 18.1**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import {
  HybridSynthesisService,
  FinancialAnalysisContext,
  PeerComparisonResult,
} from '../../src/rag/hybrid-synthesis.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { PerformanceOptimizerService } from '../../src/rag/performance-optimizer.service';
import { QueryIntent, MetricResult, ChunkResult } from '../../src/rag/types/query-intent';
import { ComputedMetricResult } from '../../src/rag/metric-resolution/types';

describe('Property Tests - Provocation', () => {
  let service: HybridSynthesisService;
  let mockBedrock: { invokeClaude: jest.Mock };

  beforeAll(async () => {
    mockBedrock = {
      invokeClaude: jest.fn().mockResolvedValue(
        'STEP 1: Facts\nSTEP 2: Narrative\nSTEP 3: Reconciliation\nSTEP 4: Conclusion\nSTEP 5: Provocation',
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridSynthesisService,
        { provide: BedrockService, useValue: mockBedrock },
        {
          provide: PerformanceOptimizerService,
          useValue: { getModelId: jest.fn().mockReturnValue('claude-3-sonnet') },
        },
      ],
    }).compile();

    service = module.get<HybridSynthesisService>(HybridSynthesisService);
  });


  // ── Generators ─────────────────────────────────────────────────────

  const tickerArb = fc.constantFrom('AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'ABNB', 'BKNG', 'NVDA');

  const metricNameArb = fc.constantFrom(
    'revenue', 'net_income', 'gross_profit', 'operating_income',
    'ebitda', 'free_cash_flow', 'total_assets', 'total_debt',
  );

  const sectionTypeArb = fc.constantFrom('item_7', 'item_1a', 'item_1', 'item_2', 'item_8');

  const yearArb = fc.integer({ min: 2020, max: 2026 });
  const quarterArb = fc.integer({ min: 1, max: 4 });

  const fiscalPeriodArb = fc.oneof(
    yearArb.map((y) => `FY${y}`),
    fc.tuple(quarterArb, yearArb).map(([q, y]) => `Q${q}FY${y}`),
  );

  const filingTypeArb = fc.constantFrom('10-K', '10-Q');

  /** Generate a single MetricResult */
  const metricResultArb = fc.tuple(
    tickerArb,
    metricNameArb,
    fiscalPeriodArb,
    filingTypeArb,
    fc.double({ min: 1, max: 999999, noNaN: true }),
  ).map(([ticker, metric, period, filingType, value]): MetricResult => ({
    ticker,
    normalizedMetric: metric,
    rawLabel: metric,
    value,
    fiscalPeriod: period,
    periodType: period.startsWith('Q') ? 'quarterly' : 'annual',
    filingType,
    statementType: 'income_statement',
    statementDate: new Date('2025-01-01'),
    filingDate: new Date('2025-02-01'),
    confidenceScore: 0.95,
    displayName: metric.replace(/_/g, ' '),
  }));

  /** Generate a single ChunkResult (narrative) */
  const chunkResultArb = fc.tuple(
    tickerArb,
    sectionTypeArb,
    fiscalPeriodArb,
    fc.string({ minLength: 10, maxLength: 80 }),
  ).map(([ticker, sectionType, period, content]): ChunkResult => ({
    content,
    score: 0.85,
    metadata: {
      ticker,
      documentType: '10-K',
      filingType: '10-K',
      sectionType,
      fiscalPeriod: period,
      chunkIndex: 0,
    },
  }));

  /** Generate a ComputedMetricResult */
  const computedResultArb = fc.tuple(
    metricNameArb,
    fc.double({ min: 0.01, max: 100, noNaN: true }),
  ).map(([metric, value]): ComputedMetricResult => ({
    canonical_id: metric,
    display_name: metric.replace(/_/g, ' '),
    value,
    formula: `${metric}_formula`,
    resolved_inputs: {},
    explanation: null,
    audit_trail: null,
    interpretation: null,
  }));

  /** Generate a QueryIntent */
  const intentArb = fc.constant({
    type: 'hybrid' as const,
    originalQuery: 'test query',
    needsNarrative: true,
    needsComparison: true,
    needsComputation: false,
    needsTrend: false,
    confidence: 0.9,
  } as QueryIntent);

  /**
   * Generate PeerComparisonResult WITH a clear divergence:
   * - At least 2 rows (subject + 1 peer) with non-null values
   * - subjectTicker set to one of the row tickers
   */
  const peerDataWithDivergenceArb = fc.tuple(
    tickerArb,
    tickerArb.filter((t) => true), // peer ticker (filtered below)
    metricNameArb,
    fiscalPeriodArb,
    fc.double({ min: 100, max: 500000, noNaN: true }),
    fc.double({ min: 100, max: 500000, noNaN: true }),
  ).chain(([subjectTicker, peerTickerCandidate, metric, period, subjectValue, peerValue]) => {
    // Ensure peer ticker differs from subject
    const peerTicker = peerTickerCandidate === subjectTicker
      ? (subjectTicker === 'AAPL' ? 'MSFT' : 'AAPL')
      : peerTickerCandidate;

    return fc.constant<PeerComparisonResult>({
      metric,
      normalizationBasis: 'FY',
      period,
      rows: [
        { ticker: subjectTicker, value: subjectValue, rank: 1 },
        { ticker: peerTicker, value: peerValue, rank: 2 },
      ],
      median: (subjectValue + peerValue) / 2,
      mean: (subjectValue + peerValue) / 2,
      subjectTicker,
      subjectRank: 1,
      subjectVsMedianPct: 0,
    });
  });

  /**
   * Generate PeerComparisonResult with rows but NO divergence possible
   * (only 1 row or no subjectTicker — findMostInterestingDivergence returns null)
   */
  const peerDataNoDivergenceArb = fc.tuple(
    tickerArb,
    metricNameArb,
    fiscalPeriodArb,
    fc.double({ min: 100, max: 500000, noNaN: true }),
  ).map(([ticker, metric, period, value]): PeerComparisonResult => ({
    metric,
    normalizationBasis: 'FY',
    period,
    rows: [
      { ticker, value, rank: 1 },
      { ticker: ticker === 'AAPL' ? 'MSFT' : 'AAPL', value: value + 100, rank: 2 },
    ],
    median: value,
    mean: value,
    // No subjectTicker → findMostInterestingDivergence returns null
    subjectTicker: undefined,
  }));

  /** Generate a FinancialAnalysisContext WITH peerData (divergence detectable) */
  const contextWithPeerDivergenceArb = fc.tuple(
    fc.array(metricResultArb, { minLength: 1, maxLength: 3 }),
    fc.array(chunkResultArb, { minLength: 1, maxLength: 2 }),
    fc.array(computedResultArb, { minLength: 0, maxLength: 1 }),
    peerDataWithDivergenceArb,
    intentArb,
  ).map(([metrics, narratives, computedResults, peerData, intent]): FinancialAnalysisContext => ({
    originalQuery: 'How does ABNB compare to peers on margins?',
    intent,
    metrics,
    narratives,
    computedResults,
    peerData,
    modelTier: 'sonnet',
  }));

  /** Generate a FinancialAnalysisContext WITH peerData but no divergence */
  const contextWithPeerNoDivergenceArb = fc.tuple(
    fc.array(metricResultArb, { minLength: 1, maxLength: 3 }),
    fc.array(chunkResultArb, { minLength: 1, maxLength: 2 }),
    fc.array(computedResultArb, { minLength: 0, maxLength: 1 }),
    peerDataNoDivergenceArb,
    intentArb,
  ).map(([metrics, narratives, computedResults, peerData, intent]): FinancialAnalysisContext => ({
    originalQuery: 'How does ABNB compare to peers on margins?',
    intent,
    metrics,
    narratives,
    computedResults,
    peerData,
    modelTier: 'sonnet',
  }));

  /** Generate a FinancialAnalysisContext WITHOUT peerData */
  const contextWithoutPeerDataArb = fc.tuple(
    fc.array(metricResultArb, { minLength: 1, maxLength: 5 }),
    fc.array(chunkResultArb, { minLength: 1, maxLength: 3 }),
    fc.array(computedResultArb, { minLength: 0, maxLength: 2 }),
    intentArb,
  ).map(([metrics, narratives, computedResults, intent]): FinancialAnalysisContext => ({
    originalQuery: 'What is the revenue trend for AAPL?',
    intent,
    metrics,
    narratives,
    computedResults,
    modelTier: 'sonnet',
  }));


  // ── Property 23: Peer-grounded provocation trigger ─────────────────

  describe('Feature: rag-chatbot-master-engineering, Property 23: Peer-grounded provocation trigger', () => {
    /**
     * **Validates: Requirements 18.1**
     *
     * For any FinancialAnalysisContext with non-null `peerData`,
     * the synthesis prompt Step 5 should use the peer-grounded provocation
     * template instead of the standard provocation template.
     */

    it('buildStructuredPrompt uses "Peer-Grounded" Step 5 when peerData has divergence', () => {
      fc.assert(
        fc.property(contextWithPeerDivergenceArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          // Should contain the peer-grounded provocation marker
          expect(prompt).toContain('STEP 5: Provocation (Peer-Grounded)');

          // Should NOT contain the standard provocation (without Peer-Grounded)
          // Check that the only STEP 5 is the peer-grounded one
          expect(prompt).not.toMatch(/STEP 5: Provocation\n/);
        }),
        { numRuns: 10 },
      );
    });

    it('buildStructuredPrompt includes specific divergence format when divergence found', () => {
      fc.assert(
        fc.property(contextWithPeerDivergenceArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          // Should contain the divergence template with "Given that" and "structural or cyclical"
          expect(prompt).toContain('Given that');
          expect(prompt).toContain('structural or cyclical');

          // Should reference the subject ticker from peerData
          expect(prompt).toContain(ctx.peerData!.subjectTicker!);
        }),
        { numRuns: 10 },
      );
    });

    it('buildStructuredPrompt uses "Peer-Grounded" Step 5 even when no divergence found', () => {
      fc.assert(
        fc.property(contextWithPeerNoDivergenceArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          // Still uses peer-grounded template (fallback variant)
          expect(prompt).toContain('STEP 5: Provocation (Peer-Grounded)');

          // Fallback contains the format template
          expect(prompt).toContain('structural or cyclical');
        }),
        { numRuns: 10 },
      );
    });

    it('buildStructuredPrompt uses standard provocation when peerData is absent', () => {
      fc.assert(
        fc.property(contextWithoutPeerDataArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          // Should contain standard provocation
          expect(prompt).toContain('STEP 5: Provocation');

          // Should NOT contain peer-grounded marker
          expect(prompt).not.toContain('Peer-Grounded');
        }),
        { numRuns: 10 },
      );
    });

    it('buildUnifyingPrompt uses "Peer-Grounded" Step 5 when peerData has divergence', () => {
      fc.assert(
        fc.property(contextWithPeerDivergenceArb, (ctx) => {
          // Add subQueryResults so buildUnifyingPrompt works properly
          const ctxWithSub: FinancialAnalysisContext = {
            ...ctx,
            subQueryResults: [{
              subQuery: 'What are ABNB margins?',
              metrics: ctx.metrics,
              narratives: ctx.narratives,
              computedResults: ctx.computedResults,
              responseType: 'HYBRID_SYNTHESIS',
            }],
          };

          const prompt = service.buildUnifyingPrompt(ctxWithSub);

          expect(prompt).toContain('STEP 5: Provocation (Peer-Grounded)');
          expect(prompt).toContain('Given that');
          expect(prompt).toContain('structural or cyclical');
        }),
        { numRuns: 10 },
      );
    });

    it('buildUnifyingPrompt uses standard provocation when peerData is absent', () => {
      fc.assert(
        fc.property(contextWithoutPeerDataArb, (ctx) => {
          const ctxWithSub: FinancialAnalysisContext = {
            ...ctx,
            subQueryResults: [{
              subQuery: 'What is AAPL revenue?',
              metrics: ctx.metrics,
              narratives: ctx.narratives,
              computedResults: ctx.computedResults,
              responseType: 'STRUCTURED_ONLY',
            }],
          };

          const prompt = service.buildUnifyingPrompt(ctxWithSub);

          expect(prompt).toContain('STEP 5: Provocation');
          expect(prompt).not.toContain('Peer-Grounded');
        }),
        { numRuns: 10 },
      );
    });

    it('findMostInterestingDivergence returns divergence for valid peer data', () => {
      fc.assert(
        fc.property(peerDataWithDivergenceArb, (peerData) => {
          const divergence = service.findMostInterestingDivergence(peerData);

          // With 2+ rows, subjectTicker set, and non-null values → divergence found
          expect(divergence).not.toBeNull();
          expect(divergence!.peerTicker).not.toBe(peerData.subjectTicker);
          expect(divergence!.metric).toBe(peerData.metric);
          expect(divergence!.period).toBe(peerData.period);
        }),
        { numRuns: 10 },
      );
    });

    it('findMostInterestingDivergence returns null when no subjectTicker', () => {
      fc.assert(
        fc.property(peerDataNoDivergenceArb, (peerData) => {
          const divergence = service.findMostInterestingDivergence(peerData);

          // No subjectTicker → returns null
          expect(divergence).toBeNull();
        }),
        { numRuns: 10 },
      );
    });
  });
});
