/**
 * Unit Tests: Degradation Notice in RAGService
 *
 * Validates Requirements 5.1, 5.2 — when HybridSynthesis fails for a multi-ticker
 * query, the response contains the degradation notice; when synthesis succeeds,
 * the notice is absent.
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
import { QueryIntent, MetricResult, RAGResponse } from '../../src/rag/types/query-intent';

const DEGRADATION_NOTICE =
  '⚠️ Analysis temporarily unavailable — showing raw data. Try again for a full comparative analysis.';

// ── Helpers ─────────────────────────────────────────────────────────

function makeMultiTickerIntent(overrides: Partial<QueryIntent> = {}): QueryIntent {
  return {
    type: 'structured',
    ticker: ['AMZN', 'MSFT'],
    metrics: ['revenue'],
    period: 'FY2024',
    needsNarrative: false,
    needsComparison: true,
    needsComputation: false,
    needsTrend: false,
    confidence: 0.92,
    originalQuery: 'AMZN vs MSFT revenue FY2024',
    ...overrides,
  };
}

function makeMetric(ticker: string): MetricResult {
  return {
    ticker,
    normalizedMetric: 'revenue',
    rawLabel: 'Revenue',
    value: 500_000_000_000,
    fiscalPeriod: 'FY2024',
    periodType: 'annual',
    filingType: '10-K',
    statementType: 'income_statement',
    statementDate: new Date('2024-12-31'),
    filingDate: new Date('2025-02-15'),
    confidenceScore: 0.95,
    displayName: 'Revenue',
  };
}

// ── Mock factories ──────────────────────────────────────────────────

function buildMocks() {
  const multiTickerIntent = makeMultiTickerIntent();
  const metrics = [makeMetric('AMZN'), makeMetric('MSFT')];

  const queryRouter = {
    route: jest.fn().mockResolvedValue({
      useStructured: true,
      useSemantic: false,
      structuredQuery: {
        tickers: ['AMZN', 'MSFT'],
        metrics: [],
        period: 'FY2024',
      },
    }),
    getIntent: jest.fn().mockResolvedValue(multiTickerIntent),
  };

  const structuredRetriever = {
    retrieve: jest.fn().mockResolvedValue({ metrics }),
    getAvailablePeriods: jest.fn().mockResolvedValue([]),
  };

  const semanticRetriever = {
    retrieveWithContext: jest.fn().mockResolvedValue({
      narratives: [],
      contextualMetrics: [],
      summary: { avgScore: 0 },
    }),
  };

  const bedrock = {
    invokeClaude: jest.fn(),
    generate: jest.fn(),
  };

  const documentRAG = {
    searchUserDocuments: jest.fn().mockResolvedValue({ chunks: [], avgScore: 0 }),
    mergeAndRerankResults: jest.fn().mockReturnValue([]),
    extractCitationsFromChunks: jest.fn().mockReturnValue([]),
  };

  const computedMetrics = {};

  const performanceMonitor = {
    recordQuery: jest.fn(),
  };

  const performanceOptimizer = {
    makeOptimizationDecisions: jest.fn().mockReturnValue({
      useCache: false,
      cacheKey: null,
      parallelExecution: false,
      modelTier: 'sonnet',
      maxTokens: 4000,
      reasoning: ['test'],
    }),
    shouldUseLLM: jest.fn().mockReturnValue(true),
    enforceTokenBudget: jest.fn().mockImplementation((n) => n),
    getCachedQuery: jest.fn().mockReturnValue(null),
    getModelId: jest.fn().mockReturnValue('claude-3-sonnet'),
    executeParallel: jest.fn(),
    getCacheTTL: jest.fn().mockReturnValue(300),
    cacheQuery: jest.fn(),
  };

  const responseEnrichment = {
    isQuickResponseEligible: jest.fn().mockReturnValue(false),
    buildQuickResponse: jest.fn().mockResolvedValue({
      answer: '| Ticker | Revenue |\n|---|---|\n| AMZN | $500B |\n| MSFT | $500B |',
      intent: multiTickerIntent,
      metrics,
      sources: [],
      timestamp: new Date(),
      latency: 10,
      cost: 0,
      processingInfo: {
        structuredMetrics: 2,
        semanticNarratives: 0,
        userDocumentChunks: 0,
        usedBedrockKB: false,
        usedClaudeGeneration: false,
        hybridProcessing: false,
      },
    } as RAGResponse),
    enrichResponse: jest.fn().mockImplementation((r) => r),
    partitionResolutions: jest.fn().mockReturnValue({ resolved: [], unresolved: [] }),
    buildUnresolvedMessage: jest.fn().mockReturnValue(null),
    computeFinancials: jest.fn().mockResolvedValue(undefined),
    computeFinancialsMulti: jest.fn().mockResolvedValue([]),
  };

  const instantRAGService = {
    getSessionDocuments: jest.fn().mockResolvedValue([]),
  };

  return {
    queryRouter,
    structuredRetriever,
    semanticRetriever,
    bedrock,
    documentRAG,
    computedMetrics,
    performanceMonitor,
    performanceOptimizer,
    responseEnrichment,
    instantRAGService,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('RAGService — Degradation Notice', () => {
  let service: RAGService;
  let mocks: ReturnType<typeof buildMocks>;
  let hybridSynthesis: { synthesize: jest.Mock };

  beforeEach(async () => {
    mocks = buildMocks();
    hybridSynthesis = {
      synthesize: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGService,
        { provide: QueryRouterService, useValue: mocks.queryRouter },
        { provide: StructuredRetrieverService, useValue: mocks.structuredRetriever },
        { provide: SemanticRetrieverService, useValue: mocks.semanticRetriever },
        { provide: BedrockService, useValue: mocks.bedrock },
        { provide: DocumentRAGService, useValue: mocks.documentRAG },
        { provide: ComputedMetricsService, useValue: mocks.computedMetrics },
        { provide: PerformanceMonitorService, useValue: mocks.performanceMonitor },
        { provide: PerformanceOptimizerService, useValue: mocks.performanceOptimizer },
        { provide: ResponseEnrichmentService, useValue: mocks.responseEnrichment },
        { provide: InstantRAGService, useValue: mocks.instantRAGService },
        { provide: HybridSynthesisService, useValue: hybridSynthesis },
      ],
    }).compile();

    service = module.get(RAGService);
  });

  it('should prepend degradation notice when HybridSynthesis throws for multi-ticker query (Req 5.1, 5.2)', async () => {
    hybridSynthesis.synthesize.mockRejectedValue(new Error('LLM timeout'));

    const result = await service.query('AMZN vs MSFT revenue FY2024');

    expect(result.answer).toContain(DEGRADATION_NOTICE);
    // The fallback table content should follow the notice
    expect(result.answer.indexOf(DEGRADATION_NOTICE)).toBe(0);
    expect(mocks.responseEnrichment.buildQuickResponse).toHaveBeenCalled();
  });

  it('should NOT contain degradation notice when HybridSynthesis succeeds (Req 5.2)', async () => {
    hybridSynthesis.synthesize.mockResolvedValue({
      answer: 'AMZN revenue was $500B vs MSFT at $500B in FY2024.',
      usage: { inputTokens: 100, outputTokens: 50 },
      citations: [],
      responseType: 'peer_comparison',
    });

    const result = await service.query('AMZN vs MSFT revenue FY2024');

    expect(result.answer).not.toContain(DEGRADATION_NOTICE);
    expect(result.answer).toContain('AMZN revenue was $500B');
    expect(mocks.responseEnrichment.buildQuickResponse).not.toHaveBeenCalled();
  });
});
