import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';

/**
 * IntentDetectorService — MetricRegistryService Integration Tests
 *
 * Post metric-resolution-architecture: the old regex metricPatterns map and
 * resolveMetricsWithSLM() are deleted. ALL metric extraction now goes through
 * MetricRegistryService.resolve(). These tests verify:
 *
 * 1. Standard metrics (revenue, net income, FCF) resolve via the registry
 * 2. Industry-specific metrics (rate base, load factor) resolve via the registry
 * 3. Qualitative questions (debt instruments, types of...) skip metric extraction
 *    entirely and route to semantic/RAG pipeline
 * 4. Graceful degradation when registry is unavailable
 */
describe('IntentDetectorService - MetricRegistry Integration', () => {
  let service: IntentDetectorService;
  let metricRegistry: jest.Mocked<MetricRegistryService>;

  const buildResolution = (
    canonicalId: string,
    displayName: string,
    confidence: 'exact' | 'fuzzy_auto' | 'unresolved',
    dbColumn?: string,
  ) => ({
    canonical_id: canonicalId,
    display_name: displayName,
    type: 'atomic' as const,
    confidence,
    fuzzy_score: confidence === 'fuzzy_auto' ? 0.88 : null,
    original_query: canonicalId,
    match_source: confidence === 'unresolved' ? 'none' : 'synonym_index',
    suggestions: null,
    db_column: dbColumn || canonicalId,
  });

  const unresolvedResult = (query: string) => buildResolution('', '', 'unresolved');

  beforeEach(async () => {
    const mockBedrock = {
      invokeModel: jest.fn(),
      invokeClaude: jest.fn().mockRejectedValue(new Error('LLM not available in test')),
    };

    const mockAnalytics = {
      logDetection: jest.fn().mockResolvedValue(undefined),
    };

    const mockMetricRegistry = {
      resolve: jest.fn().mockReturnValue(unresolvedResult('')),
      resolveMultiple: jest.fn().mockReturnValue([]),
      getKnownMetricNames: jest.fn().mockReturnValue(new Map()),
      normalizeMetricName: jest.fn((name: string) => name),
      getAllMetrics: jest.fn().mockReturnValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentDetectorService,
        { provide: BedrockService, useValue: mockBedrock },
        { provide: IntentAnalyticsService, useValue: mockAnalytics },
        { provide: MetricRegistryService, useValue: mockMetricRegistry },
      ],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);
    metricRegistry = module.get(MetricRegistryService);

    // Populate knownTickers so regex can extract tickers from queries
    (service as any).knownTickers = new Set(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA']);
  });

  // -------------------------------------------------------------------------
  // Standard metrics resolve via MetricRegistryService
  // -------------------------------------------------------------------------
  describe('Standard metrics resolve via registry', () => {
    it('should resolve "revenue" through MetricRegistryService', async () => {
      metricRegistry.resolve.mockImplementation((query: string) => {
        if (query.includes('revenue')) {
          return buildResolution('revenue', 'Revenue', 'exact', 'revenue');
        }
        return unresolvedResult(query);
      });

      const intent = await service.detectIntent('What is the revenue for AAPL in 2023?');

      expect(intent.metrics).toBeDefined();
      expect(intent.metrics).toContain('revenue');
      expect(intent.ticker).toBe('AAPL');
      expect(metricRegistry.resolve).toHaveBeenCalled();
    });

    it('should resolve "free cash flow" through MetricRegistryService', async () => {
      metricRegistry.resolve.mockImplementation((query: string) => {
        if (query.includes('free') && query.includes('cash') && query.includes('flow')) {
          return buildResolution('free_cash_flow', 'Free Cash Flow', 'exact', 'free_cash_flow');
        }
        return unresolvedResult(query);
      });

      const intent = await service.detectIntent('What is the free cash flow for MSFT?');

      expect(intent.metrics).toBeDefined();
      expect(intent.metrics).toContain('free_cash_flow');
    });

    it('should resolve multiple metrics from a single query', async () => {
      metricRegistry.resolve.mockImplementation((query: string) => {
        if (query.includes('revenue')) {
          return buildResolution('revenue', 'Revenue', 'exact', 'revenue');
        }
        if (query.includes('operating') && query.includes('margin')) {
          return buildResolution('operating_margin', 'Operating Margin', 'exact', 'operating_margin');
        }
        return unresolvedResult(query);
      });

      const intent = await service.detectIntent('Show me revenue and operating margin for AAPL');

      expect(intent.metrics).toBeDefined();
      expect(intent.metrics!.length).toBeGreaterThanOrEqual(1);
      expect(metricRegistry.resolve).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Industry-specific metrics resolve via registry
  // Post Fix 1: With regex no longer returning early, these queries flow to
  // LLM → fallback. Without a real LLM, the fallback is conservative.
  // The registry IS still called (regex seed runs extractMetricCandidatesSimple),
  // but the overall intent may not include metrics if regex confidence is low.
  // -------------------------------------------------------------------------
  describe('Industry-specific metrics resolve via registry', () => {
    it('should call registry for "rate base" even in fallback path', async () => {
      metricRegistry.resolve.mockImplementation((query: string) => {
        if (query.includes('rate') && query.includes('base')) {
          return buildResolution('rate_base', 'Rate Base', 'exact', 'rate_base');
        }
        return unresolvedResult(query);
      });

      const intent = await service.detectIntent('What is the rate base for this utility company?');

      // Registry is called during regex seed phase
      expect(metricRegistry.resolve).toHaveBeenCalled();
      // Intent is returned (fallback path works)
      expect(intent).toBeDefined();
      expect(intent.originalQuery).toBe('What is the rate base for this utility company?');
    });

    it('should call registry for "load factor" even in fallback path', async () => {
      metricRegistry.resolve.mockImplementation((query: string) => {
        if (query.includes('load') && query.includes('factor')) {
          return buildResolution('load_factor', 'Load Factor', 'fuzzy_auto', 'load_factor');
        }
        return unresolvedResult(query);
      });

      const intent = await service.detectIntent('What is the load factor?');

      expect(metricRegistry.resolve).toHaveBeenCalled();
      expect(intent).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Qualitative questions skip metric extraction → route to semantic/RAG
  // -------------------------------------------------------------------------
  describe('Qualitative questions route to semantic pipeline (TYPE D)', () => {
    it('should NOT extract metrics for "what types of debt instruments" query', async () => {
      const intent = await service.detectIntent(
        'What types of debt instruments does the company use (revolving credit, bonds, term loans)?',
      );

      // No metrics — this is a qualitative question
      expect(intent.metrics).toBeUndefined();
      // In fallback path (LLM unavailable), intent routes to semantic
      expect(intent.type).toBe('semantic');
      // Fallback path sets needsNarrative=true for qualitative queries
      expect(intent.needsNarrative).toBe(true);
      // Intent is returned with the original query preserved
      expect(intent.originalQuery).toBe(
        'What types of debt instruments does the company use (revolving credit, bonds, term loans)?',
      );
    });

    it('should NOT extract metrics for "what kind of" questions', async () => {
      const intent = await service.detectIntent(
        'What kind of revenue recognition policy does AAPL use?',
      );

      expect(intent.metrics).toBeUndefined();
      expect(intent.type).toBe('semantic');
    });

    it('should NOT extract metrics for "describe the" questions', async () => {
      const intent = await service.detectIntent(
        'Describe the capital structure of AMZN',
      );

      expect(intent.metrics).toBeUndefined();
      expect(intent.type).toBe('semantic');
    });

    it('should NOT extract metrics for "how does the company" questions', async () => {
      const intent = await service.detectIntent(
        'How does the company manage its interest rate risk?',
      );

      expect(intent.metrics).toBeUndefined();
      expect(intent.type).toBe('semantic');
    });
  });

  // -------------------------------------------------------------------------
  // Section detection for debt/capital structure topics
  // -------------------------------------------------------------------------
  describe('Debt/capital structure section detection', () => {
    // Post Fix 1: sectionTypes are populated by the LLM layer, not regex.
    // In the fallback path (LLM unavailable), sectionTypes won't be set.
    // These tests verify the fallback still returns a valid semantic intent
    // with needsNarrative=true for debt/capital structure queries.

    it('should return semantic intent with needsNarrative for revolving credit queries', async () => {
      const intent = await service.detectIntent(
        'Tell me about the revolving credit facility',
      );

      expect(intent.type).toBe('semantic');
      expect(intent.needsNarrative).toBe(true);
      expect(intent.originalQuery).toBe('Tell me about the revolving credit facility');
    });

    it('should return semantic intent with needsNarrative for term loan queries', async () => {
      const intent = await service.detectIntent(
        'What are the term loans outstanding?',
      );

      expect(intent.type).toBe('semantic');
      expect(intent.needsNarrative).toBe(true);
    });

    it('should return semantic intent with needsNarrative for covenant queries', async () => {
      const intent = await service.detectIntent(
        'Are there any debt covenants the company must comply with?',
      );

      expect(intent.type).toBe('semantic');
      expect(intent.needsNarrative).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Graceful degradation when registry is unavailable
  // -------------------------------------------------------------------------
  describe('Graceful degradation', () => {
    it('should return empty metrics when registry returns unresolved for all candidates', async () => {
      metricRegistry.resolve.mockReturnValue(unresolvedResult(''));

      const intent = await service.detectIntent('Tell me about the company strategy');

      expect(intent.metrics).toBeUndefined();
    });

    it('should not crash when registry throws an error', async () => {
      metricRegistry.resolve.mockImplementation(() => {
        throw new Error('Registry unavailable');
      });

      const intent = await service.detectIntent('What is the rate base for this utility?');

      expect(intent).toBeDefined();
      expect(intent.originalQuery).toBe('What is the rate base for this utility?');
    });
  });
});
