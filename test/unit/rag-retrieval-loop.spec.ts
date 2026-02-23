/**
 * Unit tests for the bounded retrieval loop in RAGService.
 * Tests: isRetrievalComplete, buildReplanPrompt, parseReplanResult,
 *        mergeRetrievalResults, and loop integration behaviour.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */

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

describe('RAGService — Bounded Retrieval Loop', () => {
  let service: RAGService;
  let bedrockMock: jest.Mocked<Partial<BedrockService>>;
  let structuredRetrieverMock: jest.Mocked<Partial<StructuredRetrieverService>>;
  let semanticRetrieverMock: jest.Mocked<Partial<SemanticRetrieverService>>;

  // Helper factories
  const makeIntent = (overrides: Partial<QueryIntent> = {}): QueryIntent => ({
    type: 'structured',
    ticker: ['ABNB'],
    metrics: ['revenue'],
    needsNarrative: false,
    needsComparison: false,
    needsComputation: false,
    needsTrend: false,
    confidence: 0.9,
    originalQuery: 'What is ABNB revenue?',
    ...overrides,
  });

  const makeMetric = (overrides: Partial<MetricResult> = {}): MetricResult => ({
    ticker: 'ABNB',
    normalizedMetric: 'revenue',
    rawLabel: 'Revenue',
    value: 10000,
    fiscalPeriod: 'FY2024',
    periodType: 'annual',
    filingType: '10-K',
    statementType: 'income_statement',
    statementDate: new Date('2024-12-31'),
    filingDate: new Date('2025-02-15'),
    confidenceScore: 0.95,
    ...overrides,
  });

  const makeNarrative = (overrides: Partial<ChunkResult> = {}): ChunkResult => ({
    content: 'Revenue grew 12% year-over-year.',
    score: 0.88,
    metadata: {
      ticker: 'ABNB',
      documentType: '10-K',
      sectionType: 'item_7',
      fiscalPeriod: 'FY2024',
      chunkIndex: 0,
    },
    ...overrides,
  });

  beforeEach(async () => {
    bedrockMock = {
      invokeClaude: jest.fn(),
      generate: jest.fn(),
    };

    structuredRetrieverMock = {
      retrieve: jest.fn().mockResolvedValue({ metrics: [], summary: { total: 0, byTicker: {}, byMetric: {} } }),
      getAvailablePeriods: jest.fn().mockResolvedValue([]),
    };

    semanticRetrieverMock = {
      retrieveWithContext: jest.fn().mockResolvedValue({
        narratives: [],
        contextualMetrics: [],
        summary: { total: 0, avgScore: 0, sections: {}, tickers: {} },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGService,
        { provide: QueryRouterService, useValue: { route: jest.fn(), getIntent: jest.fn() } },
        { provide: StructuredRetrieverService, useValue: structuredRetrieverMock },
        { provide: SemanticRetrieverService, useValue: semanticRetrieverMock },
        { provide: BedrockService, useValue: bedrockMock },
        { provide: DocumentRAGService, useValue: { searchUserDocuments: jest.fn(), mergeAndRerankResults: jest.fn(), extractCitationsFromChunks: jest.fn() } },
        { provide: ComputedMetricsService, useValue: {} },
        { provide: PerformanceMonitorService, useValue: { recordQuery: jest.fn() } },
        { provide: PerformanceOptimizerService, useValue: {
          makeOptimizationDecisions: jest.fn().mockReturnValue({ useCache: false, parallelExecution: false, reasoning: [], modelTier: 'haiku', maxTokens: 4000 }),
          shouldUseLLM: jest.fn().mockReturnValue(false),
          enforceTokenBudget: jest.fn().mockImplementation((n: any[]) => n),
          getCacheTTL: jest.fn().mockReturnValue(60),
        } },
        { provide: ResponseEnrichmentService, useValue: {
          isQuickResponseEligible: jest.fn().mockReturnValue(false),
          enrichResponse: jest.fn().mockImplementation((r: any) => r),
          partitionResolutions: jest.fn().mockReturnValue({ resolved: [], unresolved: [] }),
          buildUnresolvedMessage: jest.fn().mockReturnValue(null),
        } },
        { provide: InstantRAGService, useValue: { getSessionDocuments: jest.fn() } },
        { provide: HybridSynthesisService, useValue: null },
      ],
    }).compile();

    service = module.get<RAGService>(RAGService);
  });

  // ── isRetrievalComplete ──────────────────────────────────────────────

  describe('isRetrievalComplete()', () => {
    it('returns true when all tickers have metrics and no narrative needed', () => {
      const intent = makeIntent({ ticker: ['ABNB'], needsNarrative: false });
      const metrics = [makeMetric({ ticker: 'ABNB' })];
      const result = (service as any).isRetrievalComplete(intent, metrics, []);
      expect(result).toBe(true);
    });

    it('returns false when a requested ticker has no metrics', () => {
      const intent = makeIntent({ ticker: ['ABNB', 'BKNG'], needsNarrative: false });
      const metrics = [makeMetric({ ticker: 'ABNB' })];
      const result = (service as any).isRetrievalComplete(intent, metrics, []);
      expect(result).toBe(false);
    });

    it('returns false when needsNarrative is true but narratives are empty', () => {
      const intent = makeIntent({ ticker: ['ABNB'], needsNarrative: true });
      const metrics = [makeMetric({ ticker: 'ABNB' })];
      const result = (service as any).isRetrievalComplete(intent, metrics, []);
      expect(result).toBe(false);
    });

    it('returns true when needsNarrative is true and narratives are present', () => {
      const intent = makeIntent({ ticker: ['ABNB'], needsNarrative: true });
      const metrics = [makeMetric({ ticker: 'ABNB' })];
      const narratives = [makeNarrative()];
      const result = (service as any).isRetrievalComplete(intent, metrics, narratives);
      expect(result).toBe(true);
    });

    it('returns true when no tickers are requested (semantic-only query)', () => {
      const intent = makeIntent({ ticker: undefined, needsNarrative: false });
      const result = (service as any).isRetrievalComplete(intent, [], []);
      expect(result).toBe(true);
    });

    it('handles ticker as a single string', () => {
      const intent = makeIntent({ ticker: 'ABNB' as any, needsNarrative: false });
      const metrics = [makeMetric({ ticker: 'ABNB' })];
      const result = (service as any).isRetrievalComplete(intent, metrics, []);
      expect(result).toBe(true);
    });
  });

  // ── parseReplanResult ────────────────────────────────────────────────

  describe('parseReplanResult()', () => {
    it('parses valid JSON with done: true', () => {
      const result = (service as any).parseReplanResult(
        '{"additionalMetrics": [], "additionalTickers": [], "additionalSections": [], "done": true}',
      );
      expect(result.done).toBe(true);
    });

    it('parses valid JSON with additional data', () => {
      const result = (service as any).parseReplanResult(
        '{"additionalMetrics": ["gross_margin"], "additionalTickers": ["BKNG"], "additionalSections": ["item_7"], "done": false}',
      );
      expect(result.done).toBe(false);
      expect(result.additionalMetrics).toEqual(['gross_margin']);
      expect(result.additionalTickers).toEqual(['BKNG']);
      expect(result.additionalSections).toEqual(['item_7']);
    });

    it('returns done: true on invalid JSON', () => {
      const result = (service as any).parseReplanResult('not valid json');
      expect(result.done).toBe(true);
    });

    it('strips markdown code fences before parsing', () => {
      const result = (service as any).parseReplanResult(
        '```json\n{"done": false, "additionalMetrics": ["ebitda"]}\n```',
      );
      expect(result.done).toBe(false);
      expect(result.additionalMetrics).toEqual(['ebitda']);
    });

    it('returns done: true when replanner says done', () => {
      const result = (service as any).parseReplanResult(
        '{"done": true, "additionalMetrics": [], "additionalTickers": [], "additionalSections": []}',
      );
      expect(result.done).toBe(true);
    });
  });

  // ── mergeRetrievalResults ────────────────────────────────────────────

  describe('mergeRetrievalResults()', () => {
    it('merges metrics without duplicates', () => {
      const existing = {
        metrics: [makeMetric({ ticker: 'ABNB', normalizedMetric: 'revenue', fiscalPeriod: 'FY2024' })],
        narratives: [],
      };
      const additional = {
        metrics: [
          makeMetric({ ticker: 'ABNB', normalizedMetric: 'revenue', fiscalPeriod: 'FY2024' }), // duplicate
          makeMetric({ ticker: 'BKNG', normalizedMetric: 'revenue', fiscalPeriod: 'FY2024' }), // new
        ],
        narratives: [],
      };
      const result = (service as any).mergeRetrievalResults(existing, additional);
      expect(result.metrics).toHaveLength(2);
      expect(result.metrics[0].ticker).toBe('ABNB');
      expect(result.metrics[1].ticker).toBe('BKNG');
    });

    it('concatenates narratives without dedup', () => {
      const existing = { metrics: [], narratives: [makeNarrative({ content: 'A' })] };
      const additional = { metrics: [], narratives: [makeNarrative({ content: 'B' })] };
      const result = (service as any).mergeRetrievalResults(existing, additional);
      expect(result.narratives).toHaveLength(2);
    });

    it('handles empty additional results', () => {
      const existing = { metrics: [makeMetric()], narratives: [makeNarrative()] };
      const additional = { metrics: [], narratives: [] };
      const result = (service as any).mergeRetrievalResults(existing, additional);
      expect(result.metrics).toHaveLength(1);
      expect(result.narratives).toHaveLength(1);
    });

    it('deduplicates by ticker+metric+period (case-insensitive)', () => {
      const existing = {
        metrics: [makeMetric({ ticker: 'abnb', normalizedMetric: 'Revenue', fiscalPeriod: 'FY2024' })],
        narratives: [],
      };
      const additional = {
        metrics: [makeMetric({ ticker: 'ABNB', normalizedMetric: 'revenue', fiscalPeriod: 'FY2024' })],
        narratives: [],
      };
      const result = (service as any).mergeRetrievalResults(existing, additional);
      expect(result.metrics).toHaveLength(1);
    });
  });

  // ── buildReplanPrompt ────────────────────────────────────────────────

  describe('buildReplanPrompt()', () => {
    it('includes the original query', () => {
      const intent = makeIntent({ ticker: ['ABNB'], metrics: ['revenue'] });
      const prompt = (service as any).buildReplanPrompt('What is ABNB revenue?', intent, [], []);
      expect(prompt).toContain('What is ABNB revenue?');
    });

    it('lists missing tickers', () => {
      const intent = makeIntent({ ticker: ['ABNB', 'BKNG'] });
      const metrics = [makeMetric({ ticker: 'ABNB' })];
      const prompt = (service as any).buildReplanPrompt('query', intent, metrics, []);
      expect(prompt).toContain('BKNG');
      expect(prompt).toContain('missing');
    });

    it('requests JSON response format', () => {
      const intent = makeIntent();
      const prompt = (service as any).buildReplanPrompt('query', intent, [], []);
      expect(prompt).toContain('additionalMetrics');
      expect(prompt).toContain('"done"');
      expect(prompt).toContain('JSON');
    });
  });

  // ── Loop integration (via query()) ───────────────────────────────────

  describe('retrieval loop integration', () => {
    it('exits after MAX_RETRIEVAL_ITERATIONS (3)', async () => {
      // Setup: route returns a plan that triggers structured retrieval
      const queryRouterMock = (service as any).queryRouter;
      const intent = makeIntent({ ticker: ['ABNB', 'BKNG'], needsNarrative: false });
      queryRouterMock.route.mockResolvedValue({
        useStructured: true,
        useSemantic: false,
        structuredQuery: {
          tickers: ['ABNB', 'BKNG'],
          metrics: [{ canonical_id: 'revenue', original_query: 'revenue', db_column: 'revenue', display_name: 'Revenue', type: 'atomic', confidence: 'high' }],
          period: undefined,
          periodType: 'latest',
          filingTypes: ['10-K'],
          includeComputed: false,
        },
      });
      queryRouterMock.getIntent.mockResolvedValue(intent);

      // Structured retriever always returns only ABNB (BKNG always missing → incomplete)
      structuredRetrieverMock.retrieve!.mockResolvedValue({
        metrics: [makeMetric({ ticker: 'ABNB' })],
        summary: { total: 1, byTicker: { ABNB: 1 }, byMetric: { revenue: 1 } },
      });

      // Replanner always says not done
      bedrockMock.invokeClaude!.mockResolvedValue(
        '{"additionalMetrics": [], "additionalTickers": ["BKNG"], "additionalSections": [], "done": false}',
      );

      const result = await service.query('What is ABNB and BKNG revenue?');

      // invokeClaude should be called exactly 2 times (iterations 2 and 3)
      expect(bedrockMock.invokeClaude).toHaveBeenCalledTimes(2);
      // structuredRetriever.retrieve called: 1 initial + 2 loop iterations = 3
      expect(structuredRetrieverMock.retrieve).toHaveBeenCalledTimes(3);
    });

    it('exits when isRetrievalComplete returns true (no loop iterations)', async () => {
      const queryRouterMock = (service as any).queryRouter;
      const intent = makeIntent({ ticker: ['ABNB'], needsNarrative: false });
      queryRouterMock.route.mockResolvedValue({
        useStructured: true,
        useSemantic: false,
        structuredQuery: {
          tickers: ['ABNB'],
          metrics: [{ canonical_id: 'revenue', original_query: 'revenue', db_column: 'revenue', display_name: 'Revenue', type: 'atomic', confidence: 'high' }],
          period: undefined,
          periodType: 'latest',
          filingTypes: ['10-K'],
          includeComputed: false,
        },
      });
      queryRouterMock.getIntent.mockResolvedValue(intent);

      // Return data for ABNB → complete on first pass
      structuredRetrieverMock.retrieve!.mockResolvedValue({
        metrics: [makeMetric({ ticker: 'ABNB' })],
        summary: { total: 1, byTicker: { ABNB: 1 }, byMetric: { revenue: 1 } },
      });

      await service.query('What is ABNB revenue?');

      // No replanner calls — loop never entered
      expect(bedrockMock.invokeClaude).not.toHaveBeenCalled();
    });

    it('exits when replanner says done', async () => {
      const queryRouterMock = (service as any).queryRouter;
      const intent = makeIntent({ ticker: ['ABNB', 'BKNG'], needsNarrative: false });
      queryRouterMock.route.mockResolvedValue({
        useStructured: true,
        useSemantic: false,
        structuredQuery: {
          tickers: ['ABNB', 'BKNG'],
          metrics: [{ canonical_id: 'revenue', original_query: 'revenue', db_column: 'revenue', display_name: 'Revenue', type: 'atomic', confidence: 'high' }],
          period: undefined,
          periodType: 'latest',
          filingTypes: ['10-K'],
          includeComputed: false,
        },
      });
      queryRouterMock.getIntent.mockResolvedValue(intent);

      // Only ABNB data → incomplete
      structuredRetrieverMock.retrieve!.mockResolvedValue({
        metrics: [makeMetric({ ticker: 'ABNB' })],
        summary: { total: 1, byTicker: { ABNB: 1 }, byMetric: { revenue: 1 } },
      });

      // Replanner says done on first call
      bedrockMock.invokeClaude!.mockResolvedValue(
        '{"additionalMetrics": [], "additionalTickers": [], "additionalSections": [], "done": true}',
      );

      await service.query('What is ABNB and BKNG revenue?');

      // Only 1 replanner call, then exit
      expect(bedrockMock.invokeClaude).toHaveBeenCalledTimes(1);
      // Only 1 initial retrieve (no additional retrieval since replanner said done)
      expect(structuredRetrieverMock.retrieve).toHaveBeenCalledTimes(1);
    });
  });
});
