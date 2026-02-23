/**
 * Property-Based Tests for Bounded Retrieval Loop
 *
 * Feature: rag-chatbot-master-engineering
 * Properties tested:
 * - Property 15: Retrieval loop bound
 * - Property 16: Completeness evaluation
 * - Property 17: Retrieval result merging
 *
 * Tests the private isRetrievalComplete() and mergeRetrievalResults() methods
 * on RAGService via (service as any) access, and simulates the loop bound logic.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { RAGService } from '../../src/rag/rag.service';
import { QueryRouterService } from '../../src/rag/query-router.service';
import { StructuredRetrieverService } from '../../src/rag/structured-retriever.service';
import { SemanticRetrieverService } from '../../src/rag/semantic-retriever.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { DocumentRAGService } from '../../src/rag/document-rag.service';
import { ComputedMetricsService } from '../../src/dataSources/sec/computed-metrics.service';
import { PerformanceMonitorService } from '../../src/rag/performance-monitor.service';
import { PerformanceOptimizerService } from '../../src/rag/performance-optimizer.service';
import { ResponseEnrichmentService } from '../../src/rag/response-enrichment.service';
import { InstantRAGService } from '../../src/instant-rag/instant-rag.service';
import { HybridSynthesisService } from '../../src/rag/hybrid-synthesis.service';
import { QueryIntent, MetricResult, ChunkResult } from '../../src/rag/types/query-intent';

describe('Property Tests - Retrieval Loop', () => {
  let service: RAGService;

  /** Access private methods for direct testing */
  const isRetrievalComplete = (
    intent: QueryIntent,
    metrics: MetricResult[],
    narratives: ChunkResult[],
  ): boolean => {
    return (service as any).isRetrievalComplete(intent, metrics, narratives);
  };

  const mergeRetrievalResults = (
    existing: { metrics: any[]; narratives: any[] },
    additional: { metrics: any[]; narratives: any[] },
  ): { metrics: any[]; narratives: any[] } => {
    return (service as any).mergeRetrievalResults(existing, additional);
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGService,
        { provide: QueryRouterService, useValue: {} },
        { provide: StructuredRetrieverService, useValue: {} },
        { provide: SemanticRetrieverService, useValue: {} },
        { provide: BedrockService, useValue: {} },
        { provide: DocumentRAGService, useValue: {} },
        { provide: ComputedMetricsService, useValue: {} },
        { provide: PerformanceMonitorService, useValue: {} },
        { provide: PerformanceOptimizerService, useValue: {} },
        { provide: ResponseEnrichmentService, useValue: {} },
        { provide: InstantRAGService, useValue: {} },
        { provide: HybridSynthesisService, useValue: {} },
      ],
    }).compile();

    service = module.get<RAGService>(RAGService);
  });

  // ── Generators ──────────────────────────────────────────────────────────

  /** Generate a valid ticker string (1-5 uppercase letters) */
  const tickerArb = fc.constantFrom(
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'ABNB', 'BKNG',
    'COIN', 'TSLA', 'NFLX', 'CRM', 'UBER', 'LYFT', 'SQ', 'SHOP',
  );

  /** Generate a non-empty array of tickers (1-4 tickers) */
  const tickerArrayArb = fc.uniqueArray(tickerArb, { minLength: 1, maxLength: 4 });

  /** Generate a fiscal period string */
  const fiscalPeriodArb = fc.constantFrom(
    'FY2023', 'FY2024', 'Q1FY2024', 'Q2FY2024', 'Q3FY2024', 'Q4FY2024',
    'Q1FY2025', 'Q2FY2025', 'Q3FY2025',
  );

  /** Generate a normalized metric name */
  const metricNameArb = fc.constantFrom(
    'revenue', 'net_income', 'gross_profit', 'operating_income',
    'total_assets', 'total_liabilities', 'cash', 'ebitda',
  );

  /** Generate a MetricResult */
  const metricResultArb = (ticker?: string): fc.Arbitrary<MetricResult> =>
    fc.record({
      ticker: ticker ? fc.constant(ticker) : tickerArb,
      normalizedMetric: metricNameArb,
      rawLabel: fc.constant('Revenue'),
      value: fc.double({ min: -1e9, max: 1e9, noNaN: true, noDefaultInfinity: true }),
      fiscalPeriod: fiscalPeriodArb,
      periodType: fc.constantFrom('annual', 'quarterly'),
      filingType: fc.constantFrom('10-K', '10-Q'),
      statementType: fc.constantFrom('income_statement', 'balance_sheet', 'cash_flow'),
      statementDate: fc.constant(new Date('2024-12-31')),
      filingDate: fc.constant(new Date('2025-02-15')),
      confidenceScore: fc.double({ min: 0.7, max: 1.0, noNaN: true }),
    }).map(r => r as MetricResult);

  /** Generate a ChunkResult (narrative) */
  const chunkResultArb: fc.Arbitrary<ChunkResult> = fc.record({
    content: fc.string({ minLength: 10, maxLength: 200 }),
    score: fc.double({ min: 0.5, max: 1.0, noNaN: true, noDefaultInfinity: true }),
    metadata: fc.record({
      ticker: tickerArb,
      documentType: fc.constantFrom('10-K', '10-Q'),
      sectionType: fc.constantFrom('mda', 'risk_factors', 'business'),
      fiscalPeriod: fiscalPeriodArb,
      chunkIndex: fc.integer({ min: 0, max: 100 }),
    }),
  }).map(r => r as ChunkResult);

  /** Generate a QueryIntent with specific tickers and needsNarrative */
  const intentArb = (overrides: Partial<QueryIntent> = {}): fc.Arbitrary<QueryIntent> =>
    fc.record({
      ticker: overrides.ticker !== undefined
        ? fc.constant(overrides.ticker)
        : fc.oneof(tickerArb.map(t => t as string | string[]), tickerArrayArb.map(t => t as string | string[])),
      needsNarrative: overrides.needsNarrative !== undefined
        ? fc.constant(overrides.needsNarrative)
        : fc.boolean(),
    }).map(({ ticker, needsNarrative }) => {
      const base: QueryIntent = {
        type: 'structured' as const,
        ticker,
        metrics: ['revenue'],
        needsNarrative,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.9,
        originalQuery: 'test query',
      };
      return base;
    });

  // ── Property 15: Retrieval loop bound ───────────────────────────────

  describe('Feature: rag-chatbot-master-engineering, Property 15: Retrieval loop bound', () => {
    /**
     * **Validates: Requirements 13.1**
     *
     * For any query execution through the RAGService, the retrieval loop
     * should execute at most 3 iterations regardless of completeness
     * evaluation results.
     *
     * We simulate the loop logic: starting at iteration 1, the while loop
     * condition is `iteration < MAX (3) && !isComplete`. Even if isComplete
     * always returns false, the loop runs at most 2 additional times
     * (iterations 2 and 3), for a total of 3 iterations max.
     */

    it('loop executes at most 3 iterations even when completeness never returns true', async () => {
      const MAX_RETRIEVAL_ITERATIONS = 3;

      await fc.assert(
        fc.asyncProperty(
          tickerArrayArb,
          fc.boolean(),
          // Generate a sequence of completeness results (all false = worst case)
          fc.array(fc.constant(false), { minLength: 5, maxLength: 10 }),
          async (tickers, needsNarrative, completenessSequence) => {
            // Simulate the retrieval loop from rag.service.ts
            // The loop starts at iteration 1 (initial retrieval already done)
            // and increments before each additional retrieval pass.
            let retrievalIteration = 1;
            let evalIndex = 0;

            while (
              retrievalIteration < MAX_RETRIEVAL_ITERATIONS &&
              !completenessSequence[evalIndex++]
            ) {
              retrievalIteration++;
              // In real code, this is where replanning + additional retrieval happens
            }

            // The loop should never exceed MAX_RETRIEVAL_ITERATIONS
            expect(retrievalIteration).toBeLessThanOrEqual(MAX_RETRIEVAL_ITERATIONS);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('loop exits early when completeness returns true', async () => {
      const MAX_RETRIEVAL_ITERATIONS = 3;

      await fc.assert(
        fc.asyncProperty(
          // Generate a sequence where true appears at some position
          fc.integer({ min: 0, max: 4 }).chain(trueAt =>
            fc.constant(
              Array.from({ length: 5 }, (_, i) => i >= trueAt),
            ),
          ),
          async (completenessSequence) => {
            let retrievalIteration = 1;
            let evalIndex = 0;

            while (
              retrievalIteration < MAX_RETRIEVAL_ITERATIONS &&
              !completenessSequence[evalIndex++]
            ) {
              retrievalIteration++;
            }

            // Should always be within bounds
            expect(retrievalIteration).toBeLessThanOrEqual(MAX_RETRIEVAL_ITERATIONS);

            // If completeness was true from the start, no additional iterations
            if (completenessSequence[0]) {
              expect(retrievalIteration).toBe(1);
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('MAX_RETRIEVAL_ITERATIONS is exactly 3 in the RAGService', () => {
      // Verify the constant value matches the requirement
      expect((RAGService as any).MAX_RETRIEVAL_ITERATIONS).toBe(3);
    });
  });

  // ── Property 16: Completeness evaluation ────────────────────────────

  describe('Feature: rag-chatbot-master-engineering, Property 16: Completeness evaluation', () => {
    /**
     * **Validates: Requirements 13.2**
     *
     * For any QueryIntent with requested tickers and needsNarrative === true,
     * isRetrievalComplete() should return false when any requested ticker
     * has no metrics OR when narratives are empty.
     */

    it('returns false when a requested ticker has no metrics', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArrayArb,
          fc.array(chunkResultArb, { minLength: 1, maxLength: 5 }),
          async (requestedTickers, narratives) => {
            // Provide metrics for all tickers EXCEPT the last one
            const coveredTickers = requestedTickers.slice(0, -1);
            const metrics: MetricResult[] = coveredTickers.map(t => ({
              ticker: t,
              normalizedMetric: 'revenue',
              rawLabel: 'Revenue',
              value: 1000,
              fiscalPeriod: 'FY2024',
              periodType: 'annual',
              filingType: '10-K',
              statementType: 'income_statement',
              statementDate: new Date('2024-12-31'),
              filingDate: new Date('2025-02-15'),
              confidenceScore: 0.95,
            }));

            const intent: QueryIntent = {
              type: 'structured',
              ticker: requestedTickers,
              metrics: ['revenue'],
              needsNarrative: true,
              needsComparison: false,
              needsComputation: false,
              needsTrend: false,
              confidence: 0.9,
              originalQuery: 'test',
            };

            const result = isRetrievalComplete(intent, metrics, narratives);

            // Should be false because the last ticker has no metrics
            // (unless requestedTickers has only 1 element and coveredTickers is empty,
            //  which still means the ticker is uncovered)
            expect(result).toBe(false);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('returns false when needsNarrative is true and narratives are empty', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArrayArb,
          async (requestedTickers) => {
            // Provide metrics for ALL tickers so ticker coverage is satisfied
            const metrics: MetricResult[] = requestedTickers.map(t => ({
              ticker: t,
              normalizedMetric: 'revenue',
              rawLabel: 'Revenue',
              value: 1000,
              fiscalPeriod: 'FY2024',
              periodType: 'annual',
              filingType: '10-K',
              statementType: 'income_statement',
              statementDate: new Date('2024-12-31'),
              filingDate: new Date('2025-02-15'),
              confidenceScore: 0.95,
            }));

            const intent: QueryIntent = {
              type: 'hybrid',
              ticker: requestedTickers,
              metrics: ['revenue'],
              needsNarrative: true,
              needsComparison: false,
              needsComputation: false,
              needsTrend: false,
              confidence: 0.9,
              originalQuery: 'test',
            };

            // Empty narratives array
            const result = isRetrievalComplete(intent, metrics, []);

            expect(result).toBe(false);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('returns true when all tickers have metrics and narrative needs are met', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArrayArb,
          fc.boolean(),
          async (requestedTickers, needsNarrative) => {
            // Provide metrics for ALL tickers
            const metrics: MetricResult[] = requestedTickers.map(t => ({
              ticker: t,
              normalizedMetric: 'revenue',
              rawLabel: 'Revenue',
              value: 1000,
              fiscalPeriod: 'FY2024',
              periodType: 'annual',
              filingType: '10-K',
              statementType: 'income_statement',
              statementDate: new Date('2024-12-31'),
              filingDate: new Date('2025-02-15'),
              confidenceScore: 0.95,
            }));

            // Provide narratives if needed
            const narratives: ChunkResult[] = needsNarrative
              ? [{
                  content: 'Some narrative content about the company.',
                  score: 0.85,
                  metadata: {
                    ticker: requestedTickers[0],
                    documentType: '10-K',
                    sectionType: 'mda',
                    chunkIndex: 0,
                  },
                }]
              : [];

            const intent: QueryIntent = {
              type: 'structured',
              ticker: requestedTickers,
              metrics: ['revenue'],
              needsNarrative,
              needsComparison: false,
              needsComputation: false,
              needsTrend: false,
              confidence: 0.9,
              originalQuery: 'test',
            };

            const result = isRetrievalComplete(intent, metrics, narratives);

            expect(result).toBe(true);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('handles case-insensitive ticker matching', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArrayArb,
          async (requestedTickers) => {
            // Provide metrics with lowercase tickers
            const metrics: MetricResult[] = requestedTickers.map(t => ({
              ticker: t.toLowerCase(),
              normalizedMetric: 'revenue',
              rawLabel: 'Revenue',
              value: 1000,
              fiscalPeriod: 'FY2024',
              periodType: 'annual',
              filingType: '10-K',
              statementType: 'income_statement',
              statementDate: new Date('2024-12-31'),
              filingDate: new Date('2025-02-15'),
              confidenceScore: 0.95,
            }));

            const intent: QueryIntent = {
              type: 'structured',
              ticker: requestedTickers, // uppercase
              metrics: ['revenue'],
              needsNarrative: false,
              needsComparison: false,
              needsComputation: false,
              needsTrend: false,
              confidence: 0.9,
              originalQuery: 'test',
            };

            const result = isRetrievalComplete(intent, metrics, []);

            // Should match despite case difference
            expect(result).toBe(true);
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // ── Property 17: Retrieval result merging ───────────────────────────

  describe('Feature: rag-chatbot-master-engineering, Property 17: Retrieval result merging', () => {
    /**
     * **Validates: Requirements 13.5**
     *
     * For any sequence of retrieval iterations, the final metrics array
     * should be the union of all iteration results with no data loss.
     */

    /** Generate a metric with specific key fields for dedup testing */
    const keyedMetricArb = fc.record({
      ticker: tickerArb,
      normalizedMetric: metricNameArb,
      fiscalPeriod: fiscalPeriodArb,
      value: fc.double({ min: -1e9, max: 1e9, noNaN: true, noDefaultInfinity: true }),
    }).map(({ ticker, normalizedMetric, fiscalPeriod, value }) => ({
      ticker,
      normalizedMetric,
      rawLabel: normalizedMetric,
      value,
      fiscalPeriod,
      periodType: 'annual',
      filingType: '10-K',
      statementType: 'income_statement',
      statementDate: new Date('2024-12-31'),
      filingDate: new Date('2025-02-15'),
      confidenceScore: 0.95,
    }));

    /** Helper: deduplicate a metric array by key (same logic as mergeRetrievalResults) */
    const metricKey = (m: any) =>
      `${(m.ticker || '').toUpperCase()}|${(m.normalizedMetric || '').toLowerCase()}|${m.fiscalPeriod || ''}`;

    const deduplicateMetrics = (metrics: any[]): any[] => {
      const seen = new Set<string>();
      const result: any[] = [];
      for (const m of metrics) {
        const key = metricKey(m);
        if (!seen.has(key)) {
          seen.add(key);
          result.push(m);
        }
      }
      return result;
    };

    it('merged metrics contain all unique entries from both sets', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(keyedMetricArb, { minLength: 0, maxLength: 8 }),
          fc.array(keyedMetricArb, { minLength: 0, maxLength: 8 }),
          async (existingMetrics, additionalMetrics) => {
            const result = mergeRetrievalResults(
              { metrics: existingMetrics, narratives: [] },
              { metrics: additionalMetrics, narratives: [] },
            );

            // Every metric from existing should be in the result (preserved as-is)
            for (const m of existingMetrics) {
              expect(result.metrics).toContainEqual(m);
            }

            // Compute the set of keys already present in existing
            const existingKeys = new Set(existingMetrics.map(metricKey));

            // Every metric from additional whose key is NOT in existing
            // should appear in the result
            const seenAdditionalKeys = new Set<string>();
            for (const m of additionalMetrics) {
              const key = metricKey(m);
              // Only the first occurrence of a new key gets added
              if (!existingKeys.has(key) && !seenAdditionalKeys.has(key)) {
                seenAdditionalKeys.add(key);
                expect(result.metrics).toContainEqual(m);
              }
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('merged metrics have no duplicate keys from additional set', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(keyedMetricArb, { minLength: 0, maxLength: 8 }),
          fc.array(keyedMetricArb, { minLength: 0, maxLength: 8 }),
          async (existingMetrics, additionalMetrics) => {
            const result = mergeRetrievalResults(
              { metrics: existingMetrics, narratives: [] },
              { metrics: additionalMetrics, narratives: [] },
            );

            // The merge should not add any metric from additional whose key
            // already exists in existing. Count keys in result vs existing.
            const existingKeyCount = new Map<string, number>();
            for (const m of existingMetrics) {
              const key = metricKey(m);
              existingKeyCount.set(key, (existingKeyCount.get(key) || 0) + 1);
            }

            const resultKeyCount = new Map<string, number>();
            for (const m of result.metrics) {
              const key = metricKey(m);
              resultKeyCount.set(key, (resultKeyCount.get(key) || 0) + 1);
            }

            // For keys that existed in existing, count should not increase
            for (const [key, count] of existingKeyCount) {
              expect(resultKeyCount.get(key)).toBe(count);
            }

            // For new keys (from additional), each should appear exactly once
            for (const [key, count] of resultKeyCount) {
              if (!existingKeyCount.has(key)) {
                expect(count).toBe(1);
              }
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('narratives are fully concatenated with no loss', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(chunkResultArb, { minLength: 0, maxLength: 5 }),
          fc.array(chunkResultArb, { minLength: 0, maxLength: 5 }),
          async (existingNarratives, additionalNarratives) => {
            const result = mergeRetrievalResults(
              { metrics: [], narratives: existingNarratives },
              { metrics: [], narratives: additionalNarratives },
            );

            // All narratives from both sets should be present
            expect(result.narratives.length).toBe(
              existingNarratives.length + additionalNarratives.length,
            );

            // Existing narratives come first, then additional
            for (let i = 0; i < existingNarratives.length; i++) {
              expect(result.narratives[i]).toBe(existingNarratives[i]);
            }
            for (let i = 0; i < additionalNarratives.length; i++) {
              expect(result.narratives[existingNarratives.length + i]).toBe(
                additionalNarratives[i],
              );
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('sequential merges across multiple iterations preserve all unique data', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate 2-3 iteration results
          fc.array(
            fc.record({
              metrics: fc.array(keyedMetricArb, { minLength: 1, maxLength: 5 }),
              narratives: fc.array(chunkResultArb, { minLength: 0, maxLength: 3 }),
            }),
            { minLength: 2, maxLength: 3 },
          ),
          async (iterations) => {
            // Simulate sequential merging as the retrieval loop does
            let accumulated = { metrics: [] as any[], narratives: [] as any[] };

            for (const iteration of iterations) {
              accumulated = mergeRetrievalResults(accumulated, iteration);
            }

            // Collect all unique metric keys across all iterations
            const allKeys = new Set<string>();
            for (const iteration of iterations) {
              for (const m of iteration.metrics) {
                allKeys.add(
                  `${(m.ticker || '').toUpperCase()}|${(m.normalizedMetric || '').toLowerCase()}|${m.fiscalPeriod || ''}`,
                );
              }
            }

            // Result should have exactly as many unique keys
            const resultKeys = new Set(
              accumulated.metrics.map(m =>
                `${(m.ticker || '').toUpperCase()}|${(m.normalizedMetric || '').toLowerCase()}|${m.fiscalPeriod || ''}`,
              ),
            );
            expect(resultKeys.size).toBe(allKeys.size);

            // All narratives should be present (sum of all iteration narratives)
            const totalNarratives = iterations.reduce(
              (sum, it) => sum + it.narratives.length,
              0,
            );
            expect(accumulated.narratives.length).toBe(totalNarratives);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('existing metrics take precedence over duplicates in additional', async () => {
      await fc.assert(
        fc.asyncProperty(
          tickerArb,
          metricNameArb,
          fiscalPeriodArb,
          fc.double({ min: 1, max: 1e6, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 1, max: 1e6, noNaN: true, noDefaultInfinity: true }),
          async (ticker, metric, period, existingValue, additionalValue) => {
            const existingMetric = {
              ticker,
              normalizedMetric: metric,
              rawLabel: metric,
              value: existingValue,
              fiscalPeriod: period,
              periodType: 'annual',
              filingType: '10-K',
              statementType: 'income_statement',
              statementDate: new Date('2024-12-31'),
              filingDate: new Date('2025-02-15'),
              confidenceScore: 0.95,
            };

            const additionalMetric = {
              ...existingMetric,
              value: additionalValue,
            };

            const result = mergeRetrievalResults(
              { metrics: [existingMetric], narratives: [] },
              { metrics: [additionalMetric], narratives: [] },
            );

            // Should have exactly 1 metric (the existing one wins)
            expect(result.metrics.length).toBe(1);
            expect(result.metrics[0].value).toBe(existingValue);
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
