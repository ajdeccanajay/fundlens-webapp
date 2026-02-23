/**
 * Property-Based Tests for buildStructuredPrompt()
 *
 * Feature: rag-chatbot-master-engineering, Property 9: Structured prompt completeness
 * Feature: rag-chatbot-master-engineering, Property 10: Peer data inclusion in prompt
 *
 * Property 9: Structured prompt completeness — For any FinancialAnalysisContext
 * with non-empty metrics and narratives, buildStructuredPrompt() should produce
 * a string containing all 5 step markers (STEP 1 through STEP 5), all metric
 * ticker/value pairs from the context, and all narrative section attributions.
 *
 * Property 10: Peer data inclusion in prompt — For any FinancialAnalysisContext
 * with non-null peerData, buildStructuredPrompt() should include a peer
 * comparison section in the output.
 *
 * **Validates: Requirements 8.2, 8.3, 8.4, 8.5**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { HybridSynthesisService, FinancialAnalysisContext, PeerComparisonResult } from '../../src/rag/hybrid-synthesis.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { PerformanceOptimizerService } from '../../src/rag/performance-optimizer.service';
import { QueryIntent, MetricResult, ChunkResult } from '../../src/rag/types/query-intent';
import { ComputedMetricResult } from '../../src/rag/metric-resolution/types';

describe('Property Tests - Structured Prompt', () => {
  let service: HybridSynthesisService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridSynthesisService,
        {
          provide: BedrockService,
          useValue: { invokeClaude: jest.fn() },
        },
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

  const sectionTypeArb = fc.constantFrom(
    'item_7', 'item_1a', 'item_1', 'item_2', 'item_8',
  );

  const yearArb = fc.integer({ min: 2020, max: 2026 });
  const quarterArb = fc.integer({ min: 1, max: 4 });

  const fiscalPeriodArb = fc.oneof(
    yearArb.map((y) => `FY${y}`),
    fc.tuple(quarterArb, yearArb).map(([q, y]) => `Q${q}FY${y}`),
  );

  const filingTypeArb = fc.constantFrom('10-K', '10-Q');

  /** Generate a single MetricResult with small values to avoid prompt truncation */
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

  /** Generate a single ChunkResult (narrative) with short content */
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
    needsComparison: false,
    needsComputation: false,
    needsTrend: false,
    confidence: 0.9,
  } as QueryIntent);

  /** Generate a PeerComparisonResult with rows */
  const peerRowArb = fc.tuple(tickerArb, fc.double({ min: 1, max: 999, noNaN: true }), fc.integer({ min: 1, max: 10 }))
    .map(([ticker, value, rank]) => ({ ticker, value, rank }));

  const peerDataArb = fc.tuple(
    metricNameArb,
    fc.array(peerRowArb, { minLength: 2, maxLength: 6 }),
  ).map(([metric, rows]): PeerComparisonResult => ({
    metric,
    normalizationBasis: 'FY',
    period: 'FY2024',
    rows,
    median: rows.reduce((s, r) => s + (r.value ?? 0), 0) / rows.length,
    mean: rows.reduce((s, r) => s + (r.value ?? 0), 0) / rows.length,
    subjectTicker: rows[0]?.ticker,
    subjectRank: 1,
    subjectVsMedianPct: 5.0,
  }));

  /** Generate a FinancialAnalysisContext with non-empty metrics and narratives */
  const contextWithMetricsAndNarrativesArb = fc.tuple(
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

  /** Generate a FinancialAnalysisContext with peerData */
  const contextWithPeerDataArb = fc.tuple(
    fc.array(metricResultArb, { minLength: 1, maxLength: 3 }),
    fc.array(chunkResultArb, { minLength: 0, maxLength: 2 }),
    fc.array(computedResultArb, { minLength: 0, maxLength: 1 }),
    peerDataArb,
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

  // ── Property 9 Tests ──────────────────────────────────────────────

  describe('Feature: rag-chatbot-master-engineering, Property 9: Structured prompt completeness', () => {
    /**
     * **Validates: Requirements 8.2, 8.3, 8.4**
     */

    it('prompt contains all 5 step markers (STEP 1 through STEP 5)', () => {
      fc.assert(
        fc.property(contextWithMetricsAndNarrativesArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          expect(prompt).toContain('STEP 1');
          expect(prompt).toContain('STEP 2');
          expect(prompt).toContain('STEP 3');
          expect(prompt).toContain('STEP 4');
          expect(prompt).toContain('STEP 5');
        }),
        { numRuns: 10 },
      );
    });

    it('prompt contains every metric ticker from the context', () => {
      fc.assert(
        fc.property(contextWithMetricsAndNarrativesArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          for (const m of ctx.metrics) {
            expect(prompt).toContain(m.ticker.toUpperCase());
          }
        }),
        { numRuns: 10 },
      );
    });

    it('prompt contains every metric fiscal period from the context', () => {
      fc.assert(
        fc.property(contextWithMetricsAndNarrativesArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          for (const m of ctx.metrics) {
            expect(prompt).toContain(m.fiscalPeriod);
          }
        }),
        { numRuns: 10 },
      );
    });

    it('prompt contains every narrative section type attribution', () => {
      fc.assert(
        fc.property(contextWithMetricsAndNarrativesArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          for (const n of ctx.narratives) {
            if (n.metadata.sectionType) {
              expect(prompt).toContain(n.metadata.sectionType);
            }
          }
        }),
        { numRuns: 10 },
      );
    });

    it('prompt contains every narrative ticker attribution', () => {
      fc.assert(
        fc.property(contextWithMetricsAndNarrativesArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          for (const n of ctx.narratives) {
            if (n.metadata.ticker) {
              expect(prompt).toContain(n.metadata.ticker.toUpperCase());
            }
          }
        }),
        { numRuns: 10 },
      );
    });

    it('prompt contains the QUANTITATIVE DATA section header', () => {
      fc.assert(
        fc.property(contextWithMetricsAndNarrativesArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          expect(prompt).toContain('QUANTITATIVE DATA');
        }),
        { numRuns: 10 },
      );
    });

    it('prompt contains the NARRATIVE CONTEXT section header', () => {
      fc.assert(
        fc.property(contextWithMetricsAndNarrativesArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          expect(prompt).toContain('NARRATIVE CONTEXT');
        }),
        { numRuns: 10 },
      );
    });

    it('prompt contains the original query', () => {
      fc.assert(
        fc.property(contextWithMetricsAndNarrativesArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          expect(prompt).toContain(ctx.originalQuery);
        }),
        { numRuns: 10 },
      );
    });
  });

  // ── Property 10 Tests ─────────────────────────────────────────────

  describe('Feature: rag-chatbot-master-engineering, Property 10: Peer data inclusion in prompt', () => {
    /**
     * **Validates: Requirements 8.5**
     */

    it('prompt contains PEER COMPARISON DATA section when peerData is present', () => {
      fc.assert(
        fc.property(contextWithPeerDataArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          expect(prompt).toContain('PEER COMPARISON DATA');
        }),
        { numRuns: 10 },
      );
    });

    it('prompt contains peer ticker names from peerData rows', () => {
      fc.assert(
        fc.property(contextWithPeerDataArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          for (const row of ctx.peerData!.rows) {
            expect(prompt).toContain(row.ticker);
          }
        }),
        { numRuns: 10 },
      );
    });

    it('prompt contains peer metric name from peerData', () => {
      fc.assert(
        fc.property(contextWithPeerDataArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          expect(prompt).toContain(ctx.peerData!.metric);
        }),
        { numRuns: 10 },
      );
    });

    it('prompt uses peer-grounded provocation template when peerData has rows', () => {
      fc.assert(
        fc.property(contextWithPeerDataArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          expect(prompt).toContain('Peer-Grounded');
        }),
        { numRuns: 10 },
      );
    });

    it('prompt does NOT contain PEER COMPARISON DATA when peerData is absent', () => {
      fc.assert(
        fc.property(contextWithMetricsAndNarrativesArb, (ctx) => {
          // Ensure no peerData
          const ctxNoPeer = { ...ctx, peerData: undefined };
          const prompt = service.buildStructuredPrompt(ctxNoPeer);

          expect(prompt).not.toContain('PEER COMPARISON DATA');
        }),
        { numRuns: 10 },
      );
    });
  });
});
