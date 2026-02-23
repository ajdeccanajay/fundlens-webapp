/**
 * Unit tests for Task 10.3: Wire QueryDecomposer into RAGService
 *
 * Tests that:
 * 1. Decomposed queries execute sub-queries and pass to HybridSynthesisService
 * 2. Non-decomposed queries follow the normal flow
 * 3. Error handling when sub-query execution fails
 *
 * Requirements: 14.1, 14.2, 14.3
 */
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
import { QueryDecomposerService } from '../../src/rag/query-decomposer.service';
import { QueryIntent } from '../../src/rag/types/query-intent';

// ── Helpers ─────────────────────────────────────────────────────────

function makeIntent(overrides: Partial<QueryIntent> = {}): QueryIntent {
  return {
    type: 'hybrid',
    ticker: 'ABNB',
    metrics: ['revenue'],
    needsNarrative: true,
    needsComparison: false,
    needsComputation: false,
    needsTrend: false,
    confidence: 0.95,
    originalQuery: 'What are ABNB margins and what does management say?',
    ...overrides,
  } as QueryIntent;
}

function makeMetric(overrides: Record<string, any> = {}) {
  return {
    ticker: 'ABNB',
    normalizedMetric: 'revenue',
    rawLabel: 'Revenue',
    value: 8400000000,
    fiscalPeriod: 'FY2024',
    periodType: 'annual',
    filingType: '10-K',
    statementType: 'income_statement',
    statementDate: new Date('2024-12-31'),
    filingDate: new Date('2025-02-15'),
    confidenceScore: 0.95,
    displayName: 'Revenue',
    ...overrides,
  };
}

function makeNarrative(overrides: Record<string, any> = {}) {
  return {
    content: 'Management noted strong growth in international markets.',
    score: 0.88,
    metadata: {
      ticker: 'ABNB',
      documentType: '10-K',
      filingType: '10-K',
      sectionType: 'item_7',
      fiscalPeriod: 'FY2024',
      chunkIndex: 0,
    },
    ...overrides,
  };
}

// ── Mock Factory ────────────────────────────────────────────────────

function createMocks() {
  const queryRouterMock = {
    route: jest.fn().mockResolvedValue({
      useStructured: true,
      useSemantic: true,
      structuredQuery: {
        tickers: ['ABNB'],
        metrics: [{ canonical_id: 'revenue', confidence: 'high', original_query: 'revenue' }],
        period: 'FY2024',
        filingTypes: ['10-K'],
      },
      semanticQuery: {
        query: 'ABNB outlook',
        tickers: ['ABNB'],
        documentTypes: ['10-K'],
        maxResults: 5,
      },
    }),
    getIntent: jest.fn().mockResolvedValue(makeIntent()),
  } as unknown as QueryRouterService;

  const structuredRetrieverMock = {
    retrieve: jest.fn().mockResolvedValue({
      metrics: [makeMetric()],
    }),
    getAvailablePeriods: jest.fn().mockResolvedValue([]),
  } as unknown as StructuredRetrieverService;

  const semanticRetrieverMock = {
    retrieveWithContext: jest.fn().mockResolvedValue({
      narratives: [makeNarrative()],
      contextualMetrics: [],
      summary: { avgScore: 0.85 },
    }),
  } as unknown as SemanticRetrieverService;

  const bedrockMock = {
    invokeClaude: jest.fn().mockResolvedValue('Synthesized answer'),
    generate: jest.fn().mockResolvedValue({
      answer: 'Generated answer',
      usage: { inputTokens: 100, outputTokens: 200 },
      citations: [],
    }),
  } as unknown as BedrockService;

  const documentRAGMock = {
    searchUserDocuments: jest.fn().mockResolvedValue({ chunks: [], avgScore: 0 }),
    mergeAndRerankResults: jest.fn().mockReturnValue([]),
    extractCitationsFromChunks: jest.fn().mockReturnValue([]),
  } as unknown as DocumentRAGService;

  const computedMetricsMock = {} as unknown as ComputedMetricsService;

  const performanceMonitorMock = {
    recordQuery: jest.fn(),
  } as unknown as PerformanceMonitorService;

  const performanceOptimizerMock = {
    makeOptimizationDecisions: jest.fn().mockReturnValue({
      modelTier: 'sonnet',
      useCache: false,
      cacheKey: null,
      parallelExecution: false,
      maxTokens: 4096,
      reasoning: ['test'],
    }),
    shouldUseLLM: jest.fn().mockReturnValue(true),
    getModelId: jest.fn().mockReturnValue('us.anthropic.claude-3-5-sonnet-20241022-v2:0'),
    enforceTokenBudget: jest.fn().mockImplementation((n) => n),
    getCacheTTL: jest.fn().mockReturnValue(300),
    cacheQuery: jest.fn(),
    getCachedQuery: jest.fn().mockReturnValue(null),
    executeParallel: jest.fn(),
  } as unknown as PerformanceOptimizerService;

  const responseEnrichmentMock = {
    isQuickResponseEligible: jest.fn().mockReturnValue(false),
    enrichResponse: jest.fn().mockImplementation((r) => r),
    partitionResolutions: jest.fn().mockReturnValue({ resolved: [], unresolved: [] }),
    buildUnresolvedMessage: jest.fn().mockReturnValue(null),
    computeFinancials: jest.fn().mockResolvedValue(undefined),
    computeFinancialsMulti: jest.fn().mockResolvedValue([]),
    buildQuickResponse: jest.fn(),
  } as unknown as ResponseEnrichmentService;

  const instantRAGMock = {
    getSessionDocuments: jest.fn().mockResolvedValue([]),
  } as unknown as InstantRAGService;

  const hybridSynthesisMock = {
    synthesize: jest.fn().mockResolvedValue({
      answer: 'Unified synthesis answer with STEP 1 through STEP 5',
      usage: { inputTokens: 500, outputTokens: 300 },
      citations: [],
      responseType: 'DECOMPOSED_HYBRID',
    }),
  } as unknown as HybridSynthesisService;

  const queryDecomposerMock = {
    decompose: jest.fn().mockResolvedValue({
      isDecomposed: false,
      subQueries: [],
      originalQuery: 'test query',
    }),
  } as unknown as QueryDecomposerService;

  return {
    queryRouterMock,
    structuredRetrieverMock,
    semanticRetrieverMock,
    bedrockMock,
    documentRAGMock,
    computedMetricsMock,
    performanceMonitorMock,
    performanceOptimizerMock,
    responseEnrichmentMock,
    instantRAGMock,
    hybridSynthesisMock,
    queryDecomposerMock,
  };
}

function createService(mocks: ReturnType<typeof createMocks>): RAGService {
  return new RAGService(
    mocks.queryRouterMock,
    mocks.structuredRetrieverMock,
    mocks.semanticRetrieverMock,
    mocks.bedrockMock,
    mocks.documentRAGMock,
    mocks.computedMetricsMock,
    mocks.performanceMonitorMock,
    mocks.performanceOptimizerMock,
    mocks.responseEnrichmentMock,
    mocks.instantRAGMock,
    mocks.hybridSynthesisMock,
    mocks.queryDecomposerMock,
  );
}

// ── Tests ───────────────────────────────────────────────────────────

describe('RAGService — Decomposed Query Wiring (Task 10.3)', () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: RAGService;

  beforeEach(() => {
    mocks = createMocks();
    service = createService(mocks);
  });

  describe('Decomposed queries execute sub-queries and pass to HybridSynthesisService', () => {
    it('should execute sub-queries when decomposed and call HybridSynthesisService with subQueryResults', async () => {
      // Arrange: decomposer returns a decomposed result with 2 sub-queries
      (mocks.queryDecomposerMock.decompose as jest.Mock).mockResolvedValue({
        isDecomposed: true,
        subQueries: [
          'What are ABNB gross and operating margins for FY2024?',
          'What does ABNB management say drives margin expansion?',
        ],
        unifyingInstruction: 'Combine quantitative margin data with qualitative management commentary.',
        originalQuery: 'What are ABNB margins AND what does management say drives them?',
      });

      // Act
      const result = await service.query('What are ABNB margins AND what does management say drives them?');

      // Assert: decomposer was called
      expect(mocks.queryDecomposerMock.decompose).toHaveBeenCalledTimes(1);

      // Assert: queryRouter.route and getIntent called for each sub-query
      expect(mocks.queryRouterMock.route).toHaveBeenCalledTimes(3); // 1 for main + 2 for sub-queries
      expect(mocks.queryRouterMock.getIntent).toHaveBeenCalledTimes(3);

      // Assert: structuredRetriever called for each sub-query
      expect(mocks.structuredRetrieverMock.retrieve).toHaveBeenCalledTimes(2);

      // Assert: semanticRetriever called for each sub-query
      expect(mocks.semanticRetrieverMock.retrieveWithContext).toHaveBeenCalledTimes(2);

      // Assert: HybridSynthesisService.synthesize called with subQueryResults
      expect(mocks.hybridSynthesisMock.synthesize).toHaveBeenCalledTimes(1);
      const synthCall = (mocks.hybridSynthesisMock.synthesize as jest.Mock).mock.calls[0][0];
      expect(synthCall.subQueryResults).toHaveLength(2);
      expect(synthCall.unifyingInstruction).toBe(
        'Combine quantitative margin data with qualitative management commentary.',
      );

      // Assert: response is returned
      expect(result.answer).toContain('Unified synthesis answer');
    });

    it('should pass sub-query metrics and narratives in SubQueryResult objects', async () => {
      const marginMetric = makeMetric({ normalizedMetric: 'gross_profit_margin', value: 82.1 });
      const narrativeChunk = makeNarrative({ content: 'Management discussed margin drivers.' });

      // First sub-query returns metrics, second returns narratives
      (mocks.structuredRetrieverMock.retrieve as jest.Mock)
        .mockResolvedValueOnce({ metrics: [marginMetric] })
        .mockResolvedValueOnce({ metrics: [] });
      (mocks.semanticRetrieverMock.retrieveWithContext as jest.Mock)
        .mockResolvedValueOnce({ narratives: [], contextualMetrics: [], summary: { avgScore: 0 } })
        .mockResolvedValueOnce({ narratives: [narrativeChunk], contextualMetrics: [], summary: { avgScore: 0.85 } });

      (mocks.queryDecomposerMock.decompose as jest.Mock).mockResolvedValue({
        isDecomposed: true,
        subQueries: ['ABNB margins FY2024', 'ABNB management margin commentary'],
        unifyingInstruction: 'Combine data with commentary.',
        originalQuery: 'test',
      });

      await service.query('test');

      const synthCall = (mocks.hybridSynthesisMock.synthesize as jest.Mock).mock.calls[0][0];
      expect(synthCall.subQueryResults[0].metrics).toEqual([marginMetric]);
      expect(synthCall.subQueryResults[1].narratives).toEqual([narrativeChunk]);
    });
  });

  describe('Non-decomposed queries follow the normal flow', () => {
    it('should follow normal retrieval when decomposer returns isDecomposed: false', async () => {
      (mocks.queryDecomposerMock.decompose as jest.Mock).mockResolvedValue({
        isDecomposed: false,
        subQueries: [],
        originalQuery: 'What is ABNB revenue?',
      });

      const result = await service.query('What is ABNB revenue?');

      // Assert: decomposer was called but did not trigger sub-query execution
      expect(mocks.queryDecomposerMock.decompose).toHaveBeenCalledTimes(1);

      // Assert: normal retrieval flow was used (structuredRetriever called once for main query)
      expect(mocks.structuredRetrieverMock.retrieve).toHaveBeenCalled();

      // Assert: HybridSynthesisService called with normal context (no subQueryResults)
      expect(mocks.hybridSynthesisMock.synthesize).toHaveBeenCalledTimes(1);
      const synthCall = (mocks.hybridSynthesisMock.synthesize as jest.Mock).mock.calls[0][0];
      expect(synthCall.subQueryResults).toBeUndefined();

      expect(result.answer).toBeDefined();
    });
  });

  describe('Error handling when sub-query execution fails', () => {
    it('should continue with remaining sub-queries when one fails', async () => {
      (mocks.queryDecomposerMock.decompose as jest.Mock).mockResolvedValue({
        isDecomposed: true,
        subQueries: ['sub-query 1', 'sub-query 2'],
        unifyingInstruction: 'Combine results.',
        originalQuery: 'test',
      });

      // First sub-query route fails, second succeeds
      (mocks.queryRouterMock.route as jest.Mock)
        .mockResolvedValueOnce({
          useStructured: true,
          useSemantic: false,
          structuredQuery: { tickers: ['ABNB'], metrics: [], period: 'FY2024', filingTypes: ['10-K'] },
        }) // main query route
        .mockRejectedValueOnce(new Error('Route failed for sub-query 1'))
        .mockResolvedValueOnce({
          useStructured: true,
          useSemantic: false,
          structuredQuery: { tickers: ['ABNB'], metrics: [], period: 'FY2024', filingTypes: ['10-K'] },
        });

      // getIntent: main + sub-query 2 (sub-query 1 fails before getIntent)
      (mocks.queryRouterMock.getIntent as jest.Mock)
        .mockResolvedValueOnce(makeIntent()) // main
        .mockResolvedValueOnce(makeIntent()); // sub-query 2

      const result = await service.query('test');

      // Assert: HybridSynthesisService still called with 1 successful sub-query result
      expect(mocks.hybridSynthesisMock.synthesize).toHaveBeenCalledTimes(1);
      const synthCall = (mocks.hybridSynthesisMock.synthesize as jest.Mock).mock.calls[0][0];
      expect(synthCall.subQueryResults).toHaveLength(1);
    });

    it('should fall back to normal flow when all sub-queries fail', async () => {
      (mocks.queryDecomposerMock.decompose as jest.Mock).mockResolvedValue({
        isDecomposed: true,
        subQueries: ['sub-query 1', 'sub-query 2'],
        unifyingInstruction: 'Combine results.',
        originalQuery: 'test',
      });

      // Both sub-query routes fail
      (mocks.queryRouterMock.route as jest.Mock)
        .mockResolvedValueOnce({
          useStructured: true,
          useSemantic: true,
          structuredQuery: { tickers: ['ABNB'], metrics: [{ canonical_id: 'revenue', confidence: 'high', original_query: 'revenue' }], period: 'FY2024', filingTypes: ['10-K'] },
          semanticQuery: { query: 'test', tickers: ['ABNB'], documentTypes: ['10-K'], maxResults: 5 },
        }) // main query route
        .mockRejectedValueOnce(new Error('Route failed 1'))
        .mockRejectedValueOnce(new Error('Route failed 2'));

      const result = await service.query('test');

      // Assert: falls back to normal flow — HybridSynthesisService called with normal context
      expect(mocks.hybridSynthesisMock.synthesize).toHaveBeenCalledTimes(1);
      const synthCall = (mocks.hybridSynthesisMock.synthesize as jest.Mock).mock.calls[0][0];
      // No subQueryResults since we fell back to normal flow
      expect(synthCall.subQueryResults).toBeUndefined();
    });

    it('should fall back to normal flow when decomposer throws', async () => {
      (mocks.queryDecomposerMock.decompose as jest.Mock).mockRejectedValue(
        new Error('Decomposer LLM failure'),
      );

      const result = await service.query('What is ABNB revenue?');

      // Assert: normal flow was used
      expect(mocks.structuredRetrieverMock.retrieve).toHaveBeenCalled();
      expect(result.answer).toBeDefined();
    });
  });
});
