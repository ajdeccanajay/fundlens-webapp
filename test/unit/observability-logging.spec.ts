/**
 * Unit tests for Observability Signals (Task 12.1)
 *
 * Tests Requirements 22.1, 22.2, 22.5:
 * - 22.1: StructuredRetriever logs metric misses and triggers MetricLearningService
 * - 22.2: MetricRegistryService logs unresolved queries with YAML synonym suggestions
 * - 22.5: IntentDetectorService logs ticker candidates not in companies table
 *
 * Requirements 22.3 (RAGService retrieval loop logging) and 22.4 (QueryDecomposer
 * sub-query logging) were already implemented in earlier tasks and are verified
 * by their respective test suites.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { StructuredRetrieverService } from '../../src/rag/structured-retriever.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { FormulaResolutionService } from '../../src/rag/metric-resolution/formula-resolution.service';
import { MetricLearningService } from '../../src/rag/metric-learning.service';
import { MetricResolution } from '../../src/rag/metric-resolution/types';

/** Helper to create a MetricResolution for tests */
const makeResolution = (
  overrides: Partial<MetricResolution> = {},
): MetricResolution => ({
  canonical_id: 'revenue',
  display_name: 'Revenue',
  type: 'atomic',
  confidence: 'exact',
  fuzzy_score: null,
  original_query: 'revenue',
  match_source: 'synonym_index',
  suggestions: null,
  db_column: 'revenue',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Req 22.1: StructuredRetriever metric miss logging + MetricLearningService
// ---------------------------------------------------------------------------
describe('Req 22.1 — StructuredRetriever metric miss logging', () => {
  let service: StructuredRetrieverService;
  let mockPrisma: any;
  let mockMetricLearning: any;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockMetricLearning = {
      logUnrecognizedMetric: jest.fn().mockResolvedValue(undefined),
    };

    mockPrisma = {
      financialMetric: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      calculatedMetric: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ count: 0 }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StructuredRetrieverService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: MetricRegistryService,
          useValue: {
            getSynonymsForDbColumn: jest
              .fn()
              .mockImplementation((id: string) => [id, `${id}s`]),
          },
        },
        {
          provide: FormulaResolutionService,
          useValue: { resolveComputed: jest.fn() },
        },
        { provide: MetricLearningService, useValue: mockMetricLearning },
      ],
    }).compile();

    service = module.get(StructuredRetrieverService);
    loggerWarnSpy = jest.spyOn((service as any).logger, 'warn');
  });

  it('should log to metric_misses when DB returns no results', async () => {
    const result = await service.retrieve({
      tickers: ['ABNB'],
      metrics: [makeResolution({ canonical_id: 'revenue', original_query: 'revenue' })],
      periodType: 'latest',
    });

    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('metric_misses'),
    );
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('ABNB'),
    );
  });

  it('should trigger MetricLearningService on metric miss', async () => {
    await service.retrieve({
      tickers: ['MSFT'],
      metrics: [makeResolution({ canonical_id: 'proved_reserves', original_query: 'proved reserves' })],
      periodType: 'latest',
    });

    expect(mockMetricLearning.logUnrecognizedMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'MSFT',
        requestedMetric: 'proved_reserves',
      }),
    );
  });

  it('should NOT log metric miss when DB returns results', async () => {
    mockPrisma.financialMetric.findMany.mockResolvedValue([
      {
        id: 1,
        ticker: 'ABNB',
        normalizedMetric: 'revenue',
        value: 10000000000,
        fiscalPeriod: 'FY2024',
        filingType: '10-K',
        statementType: 'income_statement',
        statementDate: new Date(),
        filingDate: new Date(),
        confidenceScore: 0.95,
        rawLabel: 'Revenue',
      },
    ]);

    await service.retrieve({
      tickers: ['ABNB'],
      metrics: [makeResolution()],
      periodType: 'latest',
    });

    expect(mockMetricLearning.logUnrecognizedMetric).not.toHaveBeenCalled();
    // metric_misses should not appear in warn logs
    const metricMissCalls = loggerWarnSpy.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('metric_misses'),
    );
    expect(metricMissCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Req 22.2: MetricRegistryService unresolved query logging with YAML suggestions
// ---------------------------------------------------------------------------
describe('Req 22.2 — MetricRegistryService unresolved query logging', () => {
  let service: MetricRegistryService;
  let loggerWarnSpy: jest.SpyInstance;

  beforeAll(async () => {
    process.env.USE_MOCK_S3 = 'true';
    process.env.S3_BUCKET_NAME = 'fundlens-documents-dev';
    process.env.METRIC_REGISTRY_S3_PREFIX = 'metrics/';

    service = new MetricRegistryService();
    await service.onModuleInit();
    loggerWarnSpy = jest.spyOn((service as any).logger, 'warn');
  });

  afterAll(() => {
    delete process.env.USE_MOCK_S3;
  });

  beforeEach(() => {
    loggerWarnSpy.mockClear();
  });

  it('should log YAML synonym suggestion when unresolved with fuzzy matches', () => {
    // Query something that fuzzy-matches but below auto-resolve threshold (0.85)
    // "revnue margin pct" is close enough for suggestions but not auto-resolve
    const result = service.resolve('revnue margin pctg');

    // Should be unresolved (fuzzy score between 0.70 and 0.85 → suggestions, not auto-resolve)
    expect(result.confidence).toBe('unresolved');

    // Should have logged with YAML action hint
    const yamlLogCalls = loggerWarnSpy.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('YAML action'),
    );
    expect(yamlLogCalls.length).toBeGreaterThan(0);
    expect(yamlLogCalls[0][0]).toContain('[MetricRegistry:unresolved]');
  });

  it('should suggest new metric definition when no fuzzy matches', () => {
    const result = service.resolve('xyzzy_nonexistent_metric_12345');

    expect(result.confidence).toBe('unresolved');

    const yamlLogCalls = loggerWarnSpy.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('YAML action'),
    );
    expect(yamlLogCalls.length).toBeGreaterThan(0);
    expect(yamlLogCalls[0][0]).toContain('new metric definition');
  });
});

// ---------------------------------------------------------------------------
// Req 22.5: IntentDetectorService ticker miss logging
// ---------------------------------------------------------------------------
describe('Req 22.5 — IntentDetectorService ticker miss logging', () => {
  it('should log rejected ticker candidates to ticker_miss_log', () => {
    // We test the private extractTickersFromQuery method indirectly
    // by creating a minimal instance with a known ticker set
    const { IntentDetectorService } = require('../../src/rag/intent-detector.service');

    // Create a bare instance and set knownTickers directly
    const instance = Object.create(IntentDetectorService.prototype);
    const { Logger } = require('@nestjs/common');
    instance.logger = new Logger('IntentDetectorService');
    instance.knownTickers = new Set(['MSFT', 'AAPL']);

    const warnSpy = jest.spyOn(instance.logger, 'warn');

    // Call the private method — "GAAP" and "CEO" are regex candidates but not in knownTickers
    const result = instance.extractTickersFromQuery('GAAP vs non-GAAP operating income for MSFT and CEO commentary');

    expect(result).toEqual(['MSFT']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('ticker_miss_log'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('GAAP'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('CEO'),
    );
  });

  it('should NOT log when all candidates are valid tickers', () => {
    const { IntentDetectorService } = require('../../src/rag/intent-detector.service');

    const instance = Object.create(IntentDetectorService.prototype);
    const { Logger } = require('@nestjs/common');
    instance.logger = new Logger('IntentDetectorService');
    instance.knownTickers = new Set(['MSFT', 'AAPL']);

    const warnSpy = jest.spyOn(instance.logger, 'warn');

    const result = instance.extractTickersFromQuery('Compare MSFT and AAPL revenue');

    expect(result).toContain('MSFT');
    expect(result).toContain('AAPL');

    const tickerMissCalls = warnSpy.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('ticker_miss_log'),
    );
    expect(tickerMissCalls).toHaveLength(0);
  });

  it('should NOT log when no regex candidates are found', () => {
    const { IntentDetectorService } = require('../../src/rag/intent-detector.service');

    const instance = Object.create(IntentDetectorService.prototype);
    const { Logger } = require('@nestjs/common');
    instance.logger = new Logger('IntentDetectorService');
    instance.knownTickers = new Set(['MSFT']);

    const warnSpy = jest.spyOn(instance.logger, 'warn');

    const result = instance.extractTickersFromQuery('what are the latest margins?');

    expect(result).toEqual([]);

    const tickerMissCalls = warnSpy.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('ticker_miss_log'),
    );
    expect(tickerMissCalls).toHaveLength(0);
  });
});
