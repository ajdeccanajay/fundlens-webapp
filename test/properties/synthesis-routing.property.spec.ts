/**
 * Property-Based Tests for Synthesis Routing
 *
 * Feature: rag-chatbot-master-engineering
 * Properties tested:
 * - Property 18: Unifying synthesis for sub-queries
 *
 * For any FinancialAnalysisContext with non-empty `subQueryResults`,
 * the HybridSynthesisService should use a unifying prompt template
 * instead of the standard single-query template.
 *
 * **Validates: Requirements 14.3**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import {
  HybridSynthesisService,
  FinancialAnalysisContext,
  SubQueryResult,
  PeerComparisonResult,
} from '../../src/rag/hybrid-synthesis.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { PerformanceOptimizerService } from '../../src/rag/performance-optimizer.service';
import { QueryIntent, MetricResult, ChunkResult, ResponseType } from '../../src/rag/types/query-intent';
import { ComputedMetricResult } from '../../src/rag/metric-resolution/types';

describe('Property Tests - Synthesis Routing', () => {
  let service: HybridSynthesisService;
  let mockBedrock: { invokeClaude: jest.Mock };

  beforeAll(async () => {
    mockBedrock = {
      invokeClaude: jest.fn().mockResolvedValue('STEP 1: ...\nSTEP 2: ...\nSTEP 3: ...\nSTEP 4: ...\nSTEP 5: ...'),
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

  const responseTypeArb = fc.constantFrom<ResponseType>(
    'STRUCTURED_ONLY', 'COMPUTED_ONLY', 'HYBRID_SYNTHESIS',
    'PEER_COMPARISON', 'TIME_SERIES', 'CONCEPT_ANALYSIS',
    'DECOMPOSED_HYBRID', 'NARRATIVE_ONLY',
  );

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
    needsComparison: false,
    needsComputation: false,
    needsTrend: false,
    confidence: 0.9,
  } as QueryIntent);

  /** Generate a SubQueryResult with non-empty metrics and narratives */
  const subQueryResultArb = fc.tuple(
    fc.string({ minLength: 5, maxLength: 60 }).filter(s => /\w/.test(s)),
    fc.array(metricResultArb, { minLength: 1, maxLength: 3 }),
    fc.array(chunkResultArb, { minLength: 0, maxLength: 2 }),
    fc.array(computedResultArb, { minLength: 0, maxLength: 1 }),
    responseTypeArb,
  ).map(([subQuery, metrics, narratives, computedResults, responseType]): SubQueryResult => ({
    subQuery,
    metrics,
    narratives,
    computedResults,
    responseType,
  }));

  /** Generate a FinancialAnalysisContext WITH non-empty subQueryResults */
  const contextWithSubQueriesArb = fc.tuple(
    fc.array(metricResultArb, { minLength: 0, maxLength: 3 }),
    fc.array(chunkResultArb, { minLength: 0, maxLength: 2 }),
    fc.array(computedResultArb, { minLength: 0, maxLength: 1 }),
    fc.array(subQueryResultArb, { minLength: 1, maxLength: 3 }),
    intentArb,
    fc.option(fc.string({ minLength: 5, maxLength: 100 }).filter(s => /\w/.test(s)), { nil: undefined }),
  ).map(([metrics, narratives, computedResults, subQueryResults, intent, unifyingInstruction]): FinancialAnalysisContext => ({
    originalQuery: 'What are ABNB margins AND what does management say drives them?',
    intent,
    metrics,
    narratives,
    computedResults,
    subQueryResults,
    unifyingInstruction,
    modelTier: 'sonnet',
  }));

  /** Generate a FinancialAnalysisContext WITHOUT subQueryResults */
  const contextWithoutSubQueriesArb = fc.tuple(
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


  // ── Property 18: Unifying synthesis for sub-queries ────────────────

  describe('Feature: rag-chatbot-master-engineering, Property 18: Unifying synthesis for sub-queries', () => {
    /**
     * **Validates: Requirements 14.3**
     *
     * For any FinancialAnalysisContext with non-empty `subQueryResults`,
     * the HybridSynthesisService should use a unifying prompt template
     * instead of the standard single-query template.
     */

    it('buildUnifyingPrompt contains sub-query decomposition markers', () => {
      fc.assert(
        fc.property(contextWithSubQueriesArb, (ctx) => {
          const prompt = service.buildUnifyingPrompt(ctx);

          // Unifying prompt starts with decomposition preamble
          expect(prompt).toContain('decomposed into sub-queries');

          // Each sub-query should appear with its SUB-QUERY label
          for (let i = 0; i < ctx.subQueryResults!.length; i++) {
            expect(prompt).toContain(`SUB-QUERY ${i + 1}`);
            expect(prompt).toContain(ctx.subQueryResults![i].subQuery);
          }
        }),
        { numRuns: 10 },
      );
    });

    it('buildUnifyingPrompt includes unifyingInstruction when present', () => {
      fc.assert(
        fc.property(
          contextWithSubQueriesArb.filter(ctx => ctx.unifyingInstruction != null && ctx.unifyingInstruction.length > 0),
          (ctx) => {
            const prompt = service.buildUnifyingPrompt(ctx);

            expect(prompt).toContain('UNIFYING INSTRUCTION');
            expect(prompt).toContain(ctx.unifyingInstruction!);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('buildUnifyingPrompt contains all 5 step markers', () => {
      fc.assert(
        fc.property(contextWithSubQueriesArb, (ctx) => {
          const prompt = service.buildUnifyingPrompt(ctx);

          expect(prompt).toContain('STEP 1');
          expect(prompt).toContain('STEP 2');
          expect(prompt).toContain('STEP 3');
          expect(prompt).toContain('STEP 4');
          expect(prompt).toContain('STEP 5');
        }),
        { numRuns: 10 },
      );
    });

    it('buildUnifyingPrompt uses "Unify" instructions instead of standard single-query instructions', () => {
      fc.assert(
        fc.property(contextWithSubQueriesArb, (ctx) => {
          const prompt = service.buildUnifyingPrompt(ctx);

          // Unifying prompt uses "Unify" language
          expect(prompt).toContain('Unify the sub-query results');

          // Should NOT contain the standard single-query preamble
          expect(prompt).not.toContain('Answer the following query using ONLY the data provided');
        }),
        { numRuns: 10 },
      );
    });

    it('buildStructuredPrompt does NOT contain sub-query markers', () => {
      fc.assert(
        fc.property(contextWithoutSubQueriesArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          // Standard prompt should NOT reference sub-queries
          expect(prompt).not.toContain('SUB-QUERY');
          expect(prompt).not.toContain('decomposed into sub-queries');
          expect(prompt).not.toContain('Unify the sub-query results');

          // Standard prompt uses the single-query preamble
          expect(prompt).toContain('Answer the following query using ONLY the data provided');
        }),
        { numRuns: 10 },
      );
    });

    it('synthesize() routes to unifying prompt when subQueryResults is non-empty', async () => {
      await fc.assert(
        fc.asyncProperty(contextWithSubQueriesArb, async (ctx) => {
          mockBedrock.invokeClaude.mockClear();
          mockBedrock.invokeClaude.mockResolvedValue(
            'STEP 1: Facts\nSTEP 2: Narrative\nSTEP 3: Reconciliation\nSTEP 4: Conclusion\nSTEP 5: Provocation',
          );

          await service.synthesize(ctx);

          // Verify Bedrock was called with the unifying prompt
          expect(mockBedrock.invokeClaude).toHaveBeenCalledTimes(1);
          const calledPrompt = mockBedrock.invokeClaude.mock.calls[0][0].prompt;

          expect(calledPrompt).toContain('decomposed into sub-queries');
          expect(calledPrompt).toContain('SUB-QUERY 1');
        }),
        { numRuns: 10 },
      );
    });

    it('synthesize() routes to standard prompt when subQueryResults is absent', async () => {
      await fc.assert(
        fc.asyncProperty(contextWithoutSubQueriesArb, async (ctx) => {
          mockBedrock.invokeClaude.mockClear();
          mockBedrock.invokeClaude.mockResolvedValue(
            'STEP 1: Facts\nSTEP 2: Narrative\nSTEP 3: Reconciliation\nSTEP 4: Conclusion\nSTEP 5: Provocation',
          );

          await service.synthesize(ctx);

          expect(mockBedrock.invokeClaude).toHaveBeenCalledTimes(1);
          const calledPrompt = mockBedrock.invokeClaude.mock.calls[0][0].prompt;

          expect(calledPrompt).toContain('Answer the following query using ONLY the data provided');
          expect(calledPrompt).not.toContain('decomposed into sub-queries');
        }),
        { numRuns: 10 },
      );
    });

    it('synthesize() routes to standard prompt when subQueryResults is empty array', async () => {
      await fc.assert(
        fc.asyncProperty(contextWithoutSubQueriesArb, async (ctx) => {
          // Explicitly set empty array
          const ctxEmptySub = { ...ctx, subQueryResults: [] };

          mockBedrock.invokeClaude.mockClear();
          mockBedrock.invokeClaude.mockResolvedValue(
            'STEP 1: Facts\nSTEP 2: Narrative\nSTEP 3: Reconciliation\nSTEP 4: Conclusion\nSTEP 5: Provocation',
          );

          await service.synthesize(ctxEmptySub);

          expect(mockBedrock.invokeClaude).toHaveBeenCalledTimes(1);
          const calledPrompt = mockBedrock.invokeClaude.mock.calls[0][0].prompt;

          // Empty subQueryResults should route to standard prompt
          expect(calledPrompt).toContain('Answer the following query using ONLY the data provided');
          expect(calledPrompt).not.toContain('decomposed into sub-queries');
        }),
        { numRuns: 10 },
      );
    });
  });
});
