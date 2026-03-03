/**
 * fix-regex-and-models.spec.ts
 *
 * Dedicated tests for the 6 fixes in FIX_REGEX_AND_MODELS.md.
 * Verifies that:
 *   Fix 1: Regex never returns early (detectIntent always reaches LLM layer)
 *   Fix 2: QUL uses Haiku 4.5 and Sonnet 4.6 model IDs
 *   Fix 3: LlmDetectionEngine.MODEL_ID is Haiku 4.5
 *   Fix 4: getModelId returns correct model IDs for all tiers
 *   Fix 5: All 5 services use Haiku 4.5 model ID
 *   Fix 6: sec-processing returns empty array on parser failure (not mock)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { PerformanceOptimizerService } from '../../src/rag/performance-optimizer.service';
import { LlmDetectionEngine } from '../../src/rag/intent-detection/llm-detection-engine';

// ── Model ID constants ──────────────────────────────────────────────
const HAIKU_4_5 = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const SONNET_4_6 = 'us.anthropic.claude-sonnet-4-6';
const OPUS_4_6 = 'us.anthropic.claude-opus-4-6-v1';

// ── Stale model IDs that should NOT appear anywhere ─────────────────
const STALE_MODELS = [
  'us.anthropic.claude-3-haiku-20240307-v1:0',       // Claude 3 Haiku (Mar 2024)
  'us.anthropic.claude-3-5-haiku-20241022-v1:0',     // Claude 3.5 Haiku (Oct 2024)
  'us.anthropic.claude-3-5-sonnet-20241022-v2:0',    // Claude 3.5 Sonnet v2
  'us.anthropic.claude-opus-4-5-20251101-v1:0',      // Opus 4.5
];

// ═══════════════════════════════════════════════════════════════════
// Fix 1: Regex never returns early — detectIntent always reaches LLM
// ═══════════════════════════════════════════════════════════════════
describe('Fix 1: Regex never short-circuits detectIntent', () => {
  let service: IntentDetectorService;
  let mockBedrock: { invokeModel: jest.Mock; invokeClaude: jest.Mock };

  beforeEach(async () => {
    mockBedrock = {
      invokeModel: jest.fn(),
      invokeClaude: jest.fn().mockRejectedValue(new Error('LLM unavailable')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentDetectorService,
        { provide: BedrockService, useValue: mockBedrock },
        { provide: IntentAnalyticsService, useValue: { logDetection: jest.fn() } },
        {
          provide: MetricRegistryService,
          useValue: {
            resolve: jest.fn().mockReturnValue({
              canonical_id: 'revenue',
              display_name: 'Revenue',
              type: 'atomic',
              confidence: 'exact',
              fuzzy_score: null,
              original_query: 'revenue',
              match_source: 'synonym_index',
              suggestions: null,
              db_column: 'revenue',
            }),
            resolveMultiple: jest.fn().mockReturnValue([]),
            getKnownMetricNames: jest.fn().mockReturnValue(new Map()),
            normalizeMetricName: jest.fn((n: string) => n),
            getAllMetrics: jest.fn().mockReturnValue(new Map()),
          },
        },
      ],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);
    // Populate knownTickers so regex can extract AAPL
    (service as any).knownTickers = new Set(['AAPL', 'MSFT', 'NVDA', 'AMZN']);
  });

  it('should attempt LLM even when regex would have high confidence (ticker + metric + period)', async () => {
    // "AAPL revenue FY2024" would have been a regex fast-path hit (≥0.9) before Fix 1.
    // Now it must attempt the LLM layer. Since LLM is mocked to fail,
    // it falls back — but the key assertion is that invokeClaude WAS called.
    const intent = await service.detectIntent('What is the revenue for AAPL in 2024?');

    // LLM was attempted (invokeClaude called by LlmDetectionEngine)
    expect(mockBedrock.invokeClaude).toHaveBeenCalled();
    // Fallback intent is returned (since LLM failed)
    expect(intent).toBeDefined();
    expect(intent.originalQuery).toBe('What is the revenue for AAPL in 2024?');
  });

  it('should use regex result as fallback seed when LLM fails', async () => {
    const intent = await service.detectIntent('What is the revenue for AAPL in 2024?');

    // Fallback uses regex seed data — ticker should be extracted
    expect(intent.ticker).toBe('AAPL');
    // Confidence is degraded in fallback path
    expect(intent.confidence).toBeLessThan(0.9);
  });

  it('should never return regex_fast_path as detection method', async () => {
    // The old code would log 'regex_fast_path' — that path is dead now.
    // We verify by checking that the regex fast-path early return is gone:
    // the service always attempts LLM (invokeClaude is called).
    await service.detectIntent('AAPL revenue FY2024');
    expect(mockBedrock.invokeClaude).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Fix 2: QUL chain uses Haiku 4.5 and Sonnet 4.6
// ═══════════════════════════════════════════════════════════════════
describe('Fix 2: QUL model IDs are upgraded', () => {
  it('should use Haiku 4.5 for primary QUL call', async () => {
    // Read the source file and verify the model ID string
    const fs = require('fs');
    const source = fs.readFileSync('src/rag/query-understanding.service.ts', 'utf-8');

    // Haiku primary call
    expect(source).toContain(`modelId: '${HAIKU_4_5}'`);
    // Should NOT contain old Haiku 3.5
    expect(source).not.toContain('claude-3-5-haiku-20241022');
  });

  it('should use Sonnet 4.6 for QUL fallback call', async () => {
    const fs = require('fs');
    const source = fs.readFileSync('src/rag/query-understanding.service.ts', 'utf-8');

    // Sonnet fallback call
    expect(source).toContain(`modelId: '${SONNET_4_6}'`);
    // Should NOT contain old Sonnet 3.5
    expect(source).not.toContain('claude-3-5-sonnet-20241022');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Fix 3: LlmDetectionEngine uses Haiku 4.5
// ═══════════════════════════════════════════════════════════════════
describe('Fix 3: LlmDetectionEngine MODEL_ID is Haiku 4.5', () => {
  it('should pass Haiku 4.5 model ID to Bedrock invokeClaude', async () => {
    const mockBedrock = {
      invokeClaude: jest.fn().mockResolvedValue(JSON.stringify({
        tickers: ['AAPL'],
        rawMetricPhrases: ['revenue'],
        queryType: 'structured',
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: false,
        needsClarification: false,
        confidence: 0.95,
      })),
    };
    const mockRegistry = {
      getAllMetrics: jest.fn().mockReturnValue(new Map()),
      resolve: jest.fn().mockReturnValue({
        canonical_id: 'revenue', display_name: 'Revenue', type: 'atomic',
        confidence: 'exact', db_column: 'revenue',
      }),
    };
    const mockConcepts = {
      getAllConceptIds: jest.fn().mockReturnValue([]),
      getConceptById: jest.fn(),
    };

    const engine = new LlmDetectionEngine(
      mockBedrock as any,
      mockRegistry as any,
      mockConcepts as any,
    );

    await engine.classify('AAPL revenue');

    // Verify the model ID passed to invokeClaude
    expect(mockBedrock.invokeClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: HAIKU_4_5,
      }),
    );
  });

  it('should NOT use any stale model IDs', () => {
    const fs = require('fs');
    const source = fs.readFileSync('src/rag/intent-detection/llm-detection-engine.ts', 'utf-8');

    for (const stale of STALE_MODELS) {
      expect(source).not.toContain(stale);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Fix 4: Synthesis model map upgraded to Sonnet 4.6 / Opus 4.6
// ═══════════════════════════════════════════════════════════════════
describe('Fix 4: PerformanceOptimizer model map is upgraded', () => {
  let optimizer: PerformanceOptimizerService;

  beforeEach(() => {
    optimizer = new PerformanceOptimizerService();
  });

  it('should return Haiku 4.5 for haiku tier', () => {
    expect(optimizer.getModelId('haiku')).toBe(HAIKU_4_5);
  });

  it('should return Sonnet 4.6 for sonnet tier', () => {
    expect(optimizer.getModelId('sonnet')).toBe(SONNET_4_6);
  });

  it('should return Opus 4.6 for opus tier', () => {
    expect(optimizer.getModelId('opus')).toBe(OPUS_4_6);
  });

  it('should select sonnet (minimum) for simple queries', () => {
    const tier = optimizer.selectModelTier({ level: 'simple', factors: [], estimatedTokens: 100, score: 5 });
    expect(tier).toBe('sonnet');
    expect(optimizer.getModelId(tier)).toBe(SONNET_4_6);
  });

  it('should select opus for complex queries', () => {
    const tier = optimizer.selectModelTier({ level: 'complex', factors: [], estimatedTokens: 5000, score: 80 });
    expect(tier).toBe('opus');
    expect(optimizer.getModelId(tier)).toBe(OPUS_4_6);
  });

  it('should NOT contain any stale model IDs in source', () => {
    const fs = require('fs');
    const source = fs.readFileSync('src/rag/performance-optimizer.service.ts', 'utf-8');

    for (const stale of STALE_MODELS) {
      expect(source).not.toContain(stale);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Fix 5: All 5 supporting services use Haiku 4.5
// ═══════════════════════════════════════════════════════════════════
describe('Fix 5: All supporting services upgraded to Haiku 4.5', () => {
  const servicePaths = [
    'src/rag/hyde.service.ts',
    'src/rag/query-decomposer.service.ts',
    'src/rag/iterative-retrieval.service.ts',
    'src/rag/haiku-intent-parser.service.ts',
    'src/rag/document-metric-extractor.service.ts',
  ];

  it.each(servicePaths)('%s should contain Haiku 4.5 model ID', (filePath) => {
    const fs = require('fs');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toContain(HAIKU_4_5);
  });

  it.each(servicePaths)('%s should NOT contain any stale model IDs', (filePath) => {
    const fs = require('fs');
    const source = fs.readFileSync(filePath, 'utf-8');

    for (const stale of STALE_MODELS) {
      expect(source).not.toContain(stale);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Fix 6: sec-processing returns empty array on parser failure
// ═══════════════════════════════════════════════════════════════════
describe('Fix 6: sec-processing returns empty array on parser failure', () => {
  it('should NOT call extractMetricsMock in the error path', () => {
    const fs = require('fs');
    const source = fs.readFileSync('src/s3/sec-processing.service.ts', 'utf-8');

    // The catch block in extractMetrics should return [] not call extractMetricsMock
    // Check that the old "falling back to mock" pattern is gone from the catch block
    expect(source).not.toContain('falling back to mock');
    expect(source).not.toContain('this.extractMetricsMock(ticker, filingType, content, accessionNumber)');
  });

  it('should return empty array with reprocessing message in error path', () => {
    const fs = require('fs');
    const source = fs.readFileSync('src/s3/sec-processing.service.ts', 'utf-8');

    // The new error handling returns [] and logs a reprocessing message
    expect(source).toContain('Returning empty');
    expect(source).toContain('return [];');
  });

  it('extractMetricsMock method should still exist but never be called from extractMetrics catch', () => {
    const fs = require('fs');
    const source = fs.readFileSync('src/s3/sec-processing.service.ts', 'utf-8');

    // The method still exists (not deleted) but is dead code
    expect(source).toContain('extractMetricsMock');

    // The catch block that mentions "Python parser failed" should contain "return []"
    // and should NOT contain "extractMetricsMock"
    const catchBlock = source.match(/catch \(error\) \{[\s\S]*?Python parser failed[\s\S]*?return \[\];/);
    expect(catchBlock).toBeTruthy();
    expect(catchBlock![0]).not.toContain('extractMetricsMock');
  });
});
