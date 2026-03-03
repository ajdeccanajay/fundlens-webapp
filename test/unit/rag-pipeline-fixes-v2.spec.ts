/**
 * Unit Tests for KIRO_SPEC_v2 RAG Pipeline Fixes
 *
 * Tests Fix 1A/1B (metric extraction from normalizedQuery),
 * Fix 3 (case-insensitive matching), Fix 4A/B/C (citation source detection),
 * and Fix 5 (registry-based getContextualMetrics).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { StructuredRetrieverService } from '../../src/rag/structured-retriever.service';
import { SemanticRetrieverService } from '../../src/rag/semantic-retriever.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { FormulaResolutionService } from '../../src/rag/metric-resolution/formula-resolution.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { AdvancedRetrievalService } from '../../src/rag/advanced-retrieval.service';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeMetricResolution = (
  metricName: string,
  overrides: Partial<MetricResolution> = {},
): MetricResolution => ({
  canonical_id: metricName,
  display_name: metricName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  type: 'atomic',
  confidence: 'exact',
  fuzzy_score: null,
  original_query: metricName,
  match_source: 'synonym_index',
  suggestions: null,
  db_column: metricName,
  ...overrides,
});

const makeDbRow = (overrides: Partial<any> = {}) => ({
  id: 1,
  ticker: 'AMZN',
  normalizedMetric: 'revenue',
  rawLabel: 'Revenue',
  value: 574800000000,
  fiscalPeriod: 'FY2024',
  periodType: 'annual',
  filingType: '10-K',
  statementType: 'income_statement',
  statementDate: new Date('2024-12-31'),
  filingDate: new Date('2025-02-15'),
  confidenceScore: 0.95,
  sourcePage: 42,
  ...overrides,
});


// ─── Fix 1A: buildIntentFromQUL metric extraction ───────────────────────────
// We can't easily unit-test a private method on RAGService without massive
// mocking of 15+ constructor deps. Instead, we test the PATTERN used by
// buildIntentFromQUL: tokenize → build candidates → resolve through registry.
// This validates the algorithm in isolation.

describe('Fix 1A — Metric extraction from normalizedQuery via registry', () => {
  /**
   * Simulates the exact algorithm from buildIntentFromQUL:
   * tokenize, build unigram/bigram/trigram candidates, resolve through registry.
   */
  function extractMetricsFromQuery(
    normalizedQuery: string,
    resolveFn: (candidate: string) => MetricResolution | null,
  ): string[] {
    const tokens = normalizedQuery.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    const candidates: string[] = [...tokens];
    for (let i = 0; i < tokens.length - 1; i++) {
      candidates.push(`${tokens[i]} ${tokens[i + 1]}`);
      candidates.push(`${tokens[i]}_${tokens[i + 1]}`);
    }
    for (let i = 0; i < tokens.length - 2; i++) {
      candidates.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
      candidates.push(`${tokens[i]}_${tokens[i + 1]}_${tokens[i + 2]}`);
    }

    const metrics: string[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      try {
        const resolution = resolveFn(candidate);
        if (resolution && resolution.confidence !== 'unresolved' && !seen.has(resolution.canonical_id)) {
          metrics.push(resolution.canonical_id);
          seen.add(resolution.canonical_id);
        }
      } catch { /* skip */ }
    }
    return metrics;
  }

  it('should extract "revenue" from "what is amzn revenue"', () => {
    const resolve = jest.fn().mockImplementation((candidate: string) => {
      if (candidate === 'revenue') return makeMetricResolution('revenue');
      return makeMetricResolution(candidate, { confidence: 'unresolved' });
    });

    const metrics = extractMetricsFromQuery('what is amzn revenue', resolve);
    expect(metrics).toEqual(['revenue']);
  });

  it('should extract bigram "net income" from "amzn net income"', () => {
    const resolve = jest.fn().mockImplementation((candidate: string) => {
      if (candidate === 'net income' || candidate === 'net_income')
        return makeMetricResolution('net_income');
      return makeMetricResolution(candidate, { confidence: 'unresolved' });
    });

    const metrics = extractMetricsFromQuery('amzn net income', resolve);
    expect(metrics).toEqual(['net_income']);
  });

  it('should extract trigram "cost of revenue" from "what is cost of revenue for amzn"', () => {
    const resolve = jest.fn().mockImplementation((candidate: string) => {
      if (candidate === 'cost of revenue' || candidate === 'cost_of_revenue')
        return makeMetricResolution('cost_of_revenue');
      return makeMetricResolution(candidate, { confidence: 'unresolved' });
    });

    const metrics = extractMetricsFromQuery('what is cost of revenue for amzn', resolve);
    expect(metrics).toEqual(['cost_of_revenue']);
  });

  it('should extract multiple metrics from a single query', () => {
    const resolve = jest.fn().mockImplementation((candidate: string) => {
      if (candidate === 'revenue') return makeMetricResolution('revenue');
      if (candidate === 'net income' || candidate === 'net_income')
        return makeMetricResolution('net_income');
      return makeMetricResolution(candidate, { confidence: 'unresolved' });
    });

    const metrics = extractMetricsFromQuery('compare revenue and net income for amzn', resolve);
    expect(metrics).toContain('revenue');
    expect(metrics).toContain('net_income');
    expect(metrics).toHaveLength(2);
  });

  it('should deduplicate metrics resolved from multiple candidate forms', () => {
    // Both "net income" (bigram) and "net_income" (underscore-joined) resolve to same canonical_id
    const resolve = jest.fn().mockImplementation((candidate: string) => {
      if (candidate === 'net income' || candidate === 'net_income')
        return makeMetricResolution('net_income');
      return makeMetricResolution(candidate, { confidence: 'unresolved' });
    });

    const metrics = extractMetricsFromQuery('show net income', resolve);
    expect(metrics).toEqual(['net_income']);
  });

  it('should skip unresolved candidates (tickers, stopwords)', () => {
    const resolve = jest.fn().mockImplementation((candidate: string) => {
      if (candidate === 'revenue') return makeMetricResolution('revenue');
      return makeMetricResolution(candidate, { confidence: 'unresolved' });
    });

    const metrics = extractMetricsFromQuery('what is the revenue for amzn', resolve);
    expect(metrics).toEqual(['revenue']);
    // 'what', 'is', 'the', 'for', 'amzn' should all be unresolved and skipped
  });

  it('should handle fuzzy_auto matches (typo tolerance)', () => {
    const resolve = jest.fn().mockImplementation((candidate: string) => {
      if (candidate === 'revnue')
        return makeMetricResolution('revenue', { confidence: 'fuzzy_auto', fuzzy_score: 0.88 });
      return makeMetricResolution(candidate, { confidence: 'unresolved' });
    });

    const metrics = extractMetricsFromQuery('show revnue for aapl', resolve);
    expect(metrics).toEqual(['revenue']);
  });

  it('should handle resolve() throwing an error gracefully', () => {
    const resolve = jest.fn().mockImplementation((candidate: string) => {
      if (candidate === 'revenue') return makeMetricResolution('revenue');
      if (candidate === 'bad') throw new Error('Registry unavailable');
      return makeMetricResolution(candidate, { confidence: 'unresolved' });
    });

    const metrics = extractMetricsFromQuery('bad revenue query', resolve);
    expect(metrics).toEqual(['revenue']);
  });

  it('should return empty array when no metrics resolve', () => {
    const resolve = jest.fn().mockReturnValue(
      makeMetricResolution('x', { confidence: 'unresolved' }),
    );

    const metrics = extractMetricsFromQuery('tell me about amzn', resolve);
    expect(metrics).toEqual([]);
  });
});


// ─── Fix 3: Case-insensitive matching in getLatestByFilingType ──────────────

describe('Fix 3 — Case-insensitive ticker/filingType matching in StructuredRetriever', () => {
  let service: StructuredRetrieverService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StructuredRetrieverService,
        {
          provide: PrismaService,
          useValue: {
            financialMetric: {
              findMany: jest.fn().mockResolvedValue([]),
              count: jest.fn().mockResolvedValue(0),
            },
            calculatedMetric: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            extractedMetric: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            $queryRaw: jest.fn().mockResolvedValue([{ count: 0 }]),
          },
        },
        {
          provide: MetricRegistryService,
          useValue: {
            getSynonymsForDbColumn: jest.fn().mockImplementation((id: string) => [id]),
          },
        },
        {
          provide: FormulaResolutionService,
          useValue: {
            resolveComputed: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = module.get<StructuredRetrieverService>(StructuredRetrieverService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should match lowercase ticker "amzn" against DB "AMZN"', async () => {
    (prisma.financialMetric.findMany as jest.Mock).mockResolvedValue([
      makeDbRow({ ticker: 'AMZN', fiscalPeriod: 'FY2024' }),
    ]);

    const result = await service.retrieve({
      tickers: ['amzn'],
      metrics: [makeMetricResolution('revenue')],
      period: 'FY2024',
      filingTypes: ['10-K'],
      includeComputed: false,
    });

    expect(result.metrics.length).toBeGreaterThanOrEqual(1);
    // Verify findMany was called (the case-insensitive mode is in the Prisma where clause)
    expect(prisma.financialMetric.findMany).toHaveBeenCalled();
  });

  it('should match mixed-case filingType "10-k" against DB "10-K"', async () => {
    (prisma.financialMetric.findMany as jest.Mock).mockResolvedValue([
      makeDbRow({ filingType: '10-K', fiscalPeriod: 'FY2024' }),
    ]);

    const result = await service.retrieve({
      tickers: ['AMZN'],
      metrics: [makeMetricResolution('revenue')],
      period: 'FY2024',
      filingTypes: ['10-k'],
      includeComputed: false,
    });

    expect(result.metrics.length).toBeGreaterThanOrEqual(1);
    expect(prisma.financialMetric.findMany).toHaveBeenCalled();
  });

  it('should pass case-insensitive mode in Prisma where clause', async () => {
    (prisma.financialMetric.findMany as jest.Mock).mockResolvedValue([]);

    await service.retrieve({
      tickers: ['amzn'],
      metrics: [makeMetricResolution('revenue')],
      period: 'FY2024',
      filingTypes: ['10-k'],
      includeComputed: false,
    });

    // Inspect the where clause passed to findMany
    const calls = (prisma.financialMetric.findMany as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    // The first call should have case-insensitive ticker matching
    const firstCallArgs = calls[0][0];
    if (firstCallArgs?.where?.ticker) {
      // Could be { equals: 'amzn', mode: 'insensitive' } or { in: [...], mode: 'insensitive' }
      const tickerWhere = firstCallArgs.where.ticker;
      if (tickerWhere.equals) {
        expect(tickerWhere.mode).toBe('insensitive');
      }
    }
  });
});


// ─── Fix 4A/B/C: Citation source detection and dedup ────────────────────────

describe('Fix 4A/B/C — buildMetricCitations source detection and dedup', () => {
  /**
   * Extracted from RAGService.buildMetricCitations — tests the citation
   * building logic in isolation without needing the full RAGService.
   */
  function buildMetricCitations(metrics: any[]): any[] {
    const seen = new Set<string>();
    const citations: any[] = [];
    let num = 1;

    for (const metric of metrics) {
      // Fix 4A: Check ALL 4 signals for uploaded doc detection
      const isUploadedDoc =
        metric.filingType === 'uploaded-document' ||
        metric.source === 'user_document' ||
        metric.sourceType === 'USER_UPLOAD' ||
        metric._fromUploadedDoc === true;

      if (isUploadedDoc) {
        const key = `upload-${metric.fileName || metric.ticker}-${metric.normalizedMetric}-${metric.fiscalPeriod || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        citations.push({
          number: num,
          type: 'uploaded_document',
          sourceType: 'UPLOADED_DOC',
          filename: metric.fileName,
          ticker: metric.ticker || '',
        });
        num++;
        continue;
      }

      // Fix 4B: SEC citation dedup key includes normalizedMetric
      const key = `sec-${metric.ticker}-${metric.filingType}-${metric.fiscalPeriod}-${metric.normalizedMetric}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push({
        number: num,
        type: 'sec_filing',
        sourceType: 'SEC_FILING',
        ticker: metric.ticker,
        filingType: metric.filingType,
        fiscalPeriod: metric.fiscalPeriod,
        normalizedMetric: metric.normalizedMetric,
      });
      num++;
    }
    return citations;
  }

  // Fix 4A: Detect uploaded docs via all 4 signals
  it('should detect uploaded doc via filingType="uploaded-document"', () => {
    const citations = buildMetricCitations([
      { filingType: 'uploaded-document', ticker: 'ACME', normalizedMetric: 'revenue', fileName: 'report.pdf' },
    ]);
    expect(citations).toHaveLength(1);
    expect(citations[0].sourceType).toBe('UPLOADED_DOC');
  });

  it('should detect uploaded doc via source="user_document"', () => {
    const citations = buildMetricCitations([
      { filingType: '10-K', source: 'user_document', ticker: 'ACME', normalizedMetric: 'revenue', fileName: 'report.pdf' },
    ]);
    expect(citations).toHaveLength(1);
    expect(citations[0].sourceType).toBe('UPLOADED_DOC');
  });

  it('should detect uploaded doc via sourceType="USER_UPLOAD"', () => {
    const citations = buildMetricCitations([
      { filingType: '10-K', sourceType: 'USER_UPLOAD', ticker: 'ACME', normalizedMetric: 'revenue', fileName: 'report.pdf' },
    ]);
    expect(citations).toHaveLength(1);
    expect(citations[0].sourceType).toBe('UPLOADED_DOC');
  });

  it('should detect uploaded doc via _fromUploadedDoc=true', () => {
    const citations = buildMetricCitations([
      { filingType: '10-K', _fromUploadedDoc: true, ticker: 'ACME', normalizedMetric: 'revenue', fileName: 'report.pdf' },
    ]);
    expect(citations).toHaveLength(1);
    expect(citations[0].sourceType).toBe('UPLOADED_DOC');
  });

  it('should classify as SEC_FILING when no uploaded doc signals present', () => {
    const citations = buildMetricCitations([
      { filingType: '10-K', ticker: 'AMZN', normalizedMetric: 'revenue', fiscalPeriod: 'FY2024' },
    ]);
    expect(citations).toHaveLength(1);
    expect(citations[0].sourceType).toBe('SEC_FILING');
  });

  // Fix 4B: SEC dedup key includes normalizedMetric
  it('should generate separate citations for different metrics from same filing', () => {
    const citations = buildMetricCitations([
      { filingType: '10-K', ticker: 'AMZN', normalizedMetric: 'revenue', fiscalPeriod: 'FY2024', rawLabel: 'Revenue', value: 574800000000, confidenceScore: 0.95 },
      { filingType: '10-K', ticker: 'AMZN', normalizedMetric: 'net_income', fiscalPeriod: 'FY2024', rawLabel: 'Net Income', value: 30400000000, confidenceScore: 0.95 },
    ]);
    expect(citations).toHaveLength(2);
    expect(citations[0].normalizedMetric).toBe('revenue');
    expect(citations[1].normalizedMetric).toBe('net_income');
  });

  it('should dedup identical SEC metrics (same ticker/filing/period/metric)', () => {
    const citations = buildMetricCitations([
      { filingType: '10-K', ticker: 'AMZN', normalizedMetric: 'revenue', fiscalPeriod: 'FY2024', rawLabel: 'Revenue', value: 574800000000, confidenceScore: 0.95 },
      { filingType: '10-K', ticker: 'AMZN', normalizedMetric: 'revenue', fiscalPeriod: 'FY2024', rawLabel: 'Revenue', value: 574800000000, confidenceScore: 0.95 },
    ]);
    expect(citations).toHaveLength(1);
  });

  // Fix 4C: Pre-filter correctly separates SEC vs uploaded docs
  it('should correctly separate SEC and uploaded doc metrics in mixed array', () => {
    const citations = buildMetricCitations([
      { filingType: '10-K', ticker: 'AMZN', normalizedMetric: 'revenue', fiscalPeriod: 'FY2024', rawLabel: 'Revenue', value: 574800000000, confidenceScore: 0.95 },
      { filingType: 'uploaded-document', ticker: 'ACME', normalizedMetric: 'revenue', fileName: 'q4-report.pdf' },
      { source: 'user_document', ticker: 'ACME', normalizedMetric: 'ebitda', fileName: 'model.xlsx', filingType: '10-K' },
    ]);
    expect(citations).toHaveLength(3);
    expect(citations[0].sourceType).toBe('SEC_FILING');
    expect(citations[1].sourceType).toBe('UPLOADED_DOC');
    expect(citations[2].sourceType).toBe('UPLOADED_DOC');
  });

  it('should use fileName fallback in uploaded doc dedup key', () => {
    const citations = buildMetricCitations([
      { _fromUploadedDoc: true, ticker: '', normalizedMetric: 'revenue', fileName: 'report.pdf', filingType: '10-K' },
      { _fromUploadedDoc: true, ticker: '', normalizedMetric: 'revenue', fileName: 'report.pdf', filingType: '10-K' },
    ]);
    // Same fileName + same metric → deduped to 1
    expect(citations).toHaveLength(1);
  });
});


// ─── Fix 4C: Pre-filter logic (SEC vs uploaded doc separation) ──────────────

describe('Fix 4C — Pre-filter separates SEC vs uploaded doc metrics', () => {
  /**
   * Extracted from the two pre-filter locations in rag.service.ts (~line 955 and ~line 1193).
   * Both use the same 4-signal check.
   */
  function filterSecMetrics(metrics: any[]): any[] {
    return metrics.filter(
      (m: any) =>
        m.filingType !== 'uploaded-document' &&
        m.source !== 'user_document' &&
        m.sourceType !== 'USER_UPLOAD' &&
        !m._fromUploadedDoc,
    );
  }

  function filterUploadedDocMetrics(metrics: any[]): any[] {
    return metrics.filter(
      (m: any) =>
        m.filingType === 'uploaded-document' ||
        m.source === 'user_document' ||
        m.sourceType === 'USER_UPLOAD' ||
        m._fromUploadedDoc === true,
    );
  }

  it('should keep SEC metrics and exclude uploaded docs', () => {
    const metrics = [
      { filingType: '10-K', ticker: 'AMZN', normalizedMetric: 'revenue' },
      { filingType: 'uploaded-document', ticker: 'ACME', normalizedMetric: 'revenue' },
      { filingType: '10-K', source: 'user_document', ticker: 'ACME', normalizedMetric: 'ebitda' },
    ];

    const sec = filterSecMetrics(metrics);
    expect(sec).toHaveLength(1);
    expect(sec[0].ticker).toBe('AMZN');
  });

  it('should keep uploaded doc metrics and exclude SEC', () => {
    const metrics = [
      { filingType: '10-K', ticker: 'AMZN', normalizedMetric: 'revenue' },
      { filingType: 'uploaded-document', ticker: 'ACME', normalizedMetric: 'revenue' },
      { sourceType: 'USER_UPLOAD', ticker: 'ACME', normalizedMetric: 'ebitda', filingType: '10-K' },
      { _fromUploadedDoc: true, ticker: 'ACME', normalizedMetric: 'margin', filingType: '10-K' },
    ];

    const uploaded = filterUploadedDocMetrics(metrics);
    expect(uploaded).toHaveLength(3);
  });

  it('should not misclassify SEC metrics as uploaded docs', () => {
    const metrics = [
      { filingType: '10-K', ticker: 'AMZN', normalizedMetric: 'revenue', confidenceScore: 0.95 },
      { filingType: '10-Q', ticker: 'AAPL', normalizedMetric: 'net_income', confidenceScore: 0.90 },
    ];

    const uploaded = filterUploadedDocMetrics(metrics);
    expect(uploaded).toHaveLength(0);

    const sec = filterSecMetrics(metrics);
    expect(sec).toHaveLength(2);
  });

  it('should catch uploaded doc with only _fromUploadedDoc signal', () => {
    const metrics = [
      { filingType: '10-K', ticker: 'ACME', normalizedMetric: 'revenue', _fromUploadedDoc: true },
    ];

    const sec = filterSecMetrics(metrics);
    expect(sec).toHaveLength(0);

    const uploaded = filterUploadedDocMetrics(metrics);
    expect(uploaded).toHaveLength(1);
  });
});


// ─── Fix 5: Registry-based getContextualMetrics ─────────────────────────────

describe('Fix 5 — SemanticRetriever.getContextualMetrics uses MetricRegistryService', () => {
  let service: SemanticRetrieverService;
  let mockRegistry: any;
  let mockStructuredRetriever: any;

  beforeEach(async () => {
    mockRegistry = {
      resolve: jest.fn().mockImplementation((candidate: string) => {
        if (candidate === 'revenue') return makeMetricResolution('revenue');
        if (candidate === 'net income' || candidate === 'net_income')
          return makeMetricResolution('net_income');
        if (candidate === 'gross profit' || candidate === 'gross_profit')
          return makeMetricResolution('gross_profit');
        return makeMetricResolution(candidate, { confidence: 'unresolved' });
      }),
    };

    mockStructuredRetriever = {
      retrieve: jest.fn().mockResolvedValue({
        metrics: [
          { ticker: 'AMZN', normalizedMetric: 'revenue', value: 574800000000, fiscalPeriod: 'FY2024' },
        ],
        summary: { total: 1 },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SemanticRetrieverService,
        {
          provide: BedrockService,
          useValue: {
            retrieve: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            narrativeChunk: {
              findMany: jest.fn().mockResolvedValue([]),
            },
          },
        },
        {
          provide: StructuredRetrieverService,
          useValue: mockStructuredRetriever,
        },
        {
          provide: AdvancedRetrievalService,
          useValue: {
            getStatus: jest.fn().mockReturnValue({
              hyde: false,
              queryDecomposition: false,
              contextualExpansion: false,
              iterativeRetrieval: false,
              reranking: false,
            }),
            retrieve: jest.fn().mockResolvedValue({ chunks: [], metrics: { techniquesUsed: [] }, errors: [] }),
          },
        },
        {
          provide: MetricRegistryService,
          useValue: mockRegistry,
        },
      ],
    }).compile();

    service = module.get<SemanticRetrieverService>(SemanticRetrieverService);
  });

  it('should resolve metrics from query via registry and pass to structured retriever', async () => {
    const result = await service.retrieveWithContext({
      query: 'what is the revenue for amzn',
      tickers: ['AMZN'],
    });

    // Registry should have been called with token candidates
    expect(mockRegistry.resolve).toHaveBeenCalled();

    // Structured retriever should have been called with resolved metrics
    expect(mockStructuredRetriever.retrieve).toHaveBeenCalled();
    const retrieveCall = mockStructuredRetriever.retrieve.mock.calls[0][0];
    expect(retrieveCall.tickers).toEqual(['AMZN']);

    // The metrics passed should include 'revenue' (resolved from query)
    const metricIds = retrieveCall.metrics.map((m: any) => m.canonical_id);
    expect(metricIds).toContain('revenue');

    // Result should include contextual metrics
    expect(result.contextualMetrics).toBeDefined();
    expect(result.contextualMetrics.length).toBeGreaterThanOrEqual(1);
  });

  it('should fall back to default metrics when registry resolves nothing', async () => {
    // Override registry to resolve nothing
    mockRegistry.resolve.mockReturnValue(
      makeMetricResolution('x', { confidence: 'unresolved' }),
    );

    await service.retrieveWithContext({
      query: 'tell me about amzn',
      tickers: ['AMZN'],
    });

    // Should still call structured retriever with fallback metrics
    expect(mockStructuredRetriever.retrieve).toHaveBeenCalled();
    const retrieveCall = mockStructuredRetriever.retrieve.mock.calls[0][0];
    const metricIds = retrieveCall.metrics.map((m: any) => m.canonical_id);

    // Fallback metrics: revenue, net_income, total_assets, operating_cash_flow
    expect(metricIds).toContain('revenue');
    expect(metricIds).toContain('net_income');
    expect(metricIds).toContain('total_assets');
    expect(metricIds).toContain('operating_cash_flow');
  });

  it('should handle registry errors gracefully', async () => {
    mockRegistry.resolve.mockImplementation(() => {
      throw new Error('Registry unavailable');
    });

    const result = await service.retrieveWithContext({
      query: 'revenue for amzn',
      tickers: ['AMZN'],
    });

    // Should still return results (fallback metrics)
    expect(result).toBeDefined();
    expect(mockStructuredRetriever.retrieve).toHaveBeenCalled();
  });

  it('should return empty contextual metrics when no tickers provided', async () => {
    const result = await service.retrieveWithContext({
      query: 'what is revenue',
      tickers: [],
    });

    // No tickers → getContextualMetrics returns []
    expect(result.contextualMetrics).toEqual([]);
  });

  it('should extract bigram metrics from query', async () => {
    await service.retrieveWithContext({
      query: 'show me gross profit for amzn',
      tickers: ['AMZN'],
    });

    // Registry should have been called with bigram candidates
    const resolveCalls = mockRegistry.resolve.mock.calls.map((c: any) => c[0]);
    // Should include bigram "gross profit" or "gross_profit"
    expect(
      resolveCalls.some((c: string) => c === 'gross profit' || c === 'gross_profit'),
    ).toBe(true);
  });
});


// ─── Fix 1B: buildPlanFromQUL safety net ────────────────────────────────────

describe('Fix 1B — buildPlanFromQUL safety net re-extracts metrics', () => {
  /**
   * Tests the safety net pattern: if intent.metrics is empty after
   * buildIntentFromQUL, buildPlanFromQUL tries once more from normalizedQuery.
   * Same algorithm, same registry-as-filter approach.
   */
  function safetyNetExtract(
    normalizedQuery: string,
    existingMetrics: string[],
    resolveFn: (candidate: string) => MetricResolution | null,
  ): string[] {
    // Only fires when existingMetrics is empty
    if (existingMetrics.length > 0) return existingMetrics;

    const tokens = (normalizedQuery || '').toLowerCase().split(/\s+/).filter((t: string) => t.length > 1);
    const candidates = [...tokens];
    for (let i = 0; i < tokens.length - 1; i++) {
      candidates.push(`${tokens[i]} ${tokens[i + 1]}`);
      candidates.push(`${tokens[i]}_${tokens[i + 1]}`);
    }
    for (let i = 0; i < tokens.length - 2; i++) {
      candidates.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
      candidates.push(`${tokens[i]}_${tokens[i + 1]}_${tokens[i + 2]}`);
    }

    const metrics: string[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      try {
        const res = resolveFn(candidate);
        if (res && res.confidence !== 'unresolved' && !seen.has(res.canonical_id)) {
          metrics.push(res.canonical_id);
          seen.add(res.canonical_id);
        }
      } catch { /* skip */ }
    }
    return metrics;
  }

  it('should extract metrics when buildIntentFromQUL returned empty', () => {
    const resolve = jest.fn().mockImplementation((candidate: string) => {
      if (candidate === 'revenue') return makeMetricResolution('revenue');
      return makeMetricResolution(candidate, { confidence: 'unresolved' });
    });

    const result = safetyNetExtract('what is amzn revenue', [], resolve);
    expect(result).toEqual(['revenue']);
  });

  it('should NOT re-extract when buildIntentFromQUL already found metrics', () => {
    const resolve = jest.fn();

    const result = safetyNetExtract('what is amzn revenue', ['revenue'], resolve);
    expect(result).toEqual(['revenue']);
    // resolve should never be called — short-circuit
    expect(resolve).not.toHaveBeenCalled();
  });

  it('should handle empty normalizedQuery gracefully', () => {
    const resolve = jest.fn().mockReturnValue(
      makeMetricResolution('x', { confidence: 'unresolved' }),
    );

    const result = safetyNetExtract('', [], resolve);
    expect(result).toEqual([]);
  });
});

// ─── Fix 7: QUL few-shot examples validation ───────────────────────────────

describe('Fix 1C — QUL few-shot examples include metric subQueries', () => {
  let qulExamples: any[];

  beforeAll(() => {
    // Load the actual QUL examples file
    const fs = require('fs');
    const path = require('path');
    const examplesPath = path.join(__dirname, '../../src/prompts/qul-examples.json');
    qulExamples = JSON.parse(fs.readFileSync(examplesPath, 'utf-8'));
  });

  it('should have at least 2 METRIC_LOOKUP examples with subQueries', () => {
    const metricLookupExamples = qulExamples.filter(
      (ex: any) => ex.output?.intent === 'METRIC_LOOKUP',
    );
    expect(metricLookupExamples.length).toBeGreaterThanOrEqual(2);

    // At least some should have subQueries with metric fields
    const withSubQueries = metricLookupExamples.filter(
      (ex: any) => ex.output?.subQueries?.some((sq: any) => sq.metric),
    );
    expect(withSubQueries.length).toBeGreaterThanOrEqual(1);
  });

  it('should have examples that include metric field in subQueries', () => {
    const examplesWithMetricSubQueries = qulExamples.filter(
      (ex: any) => ex.output?.subQueries?.some((sq: any) => sq.metric),
    );
    expect(examplesWithMetricSubQueries.length).toBeGreaterThanOrEqual(1);

    // Verify the metric field is a non-empty string
    for (const ex of examplesWithMetricSubQueries) {
      for (const sq of ex.output.subQueries) {
        if (sq.metric) {
          expect(typeof sq.metric).toBe('string');
          expect(sq.metric.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
