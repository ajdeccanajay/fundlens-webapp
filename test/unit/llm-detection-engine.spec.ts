/**
 * Unit Tests for LlmDetectionEngine
 *
 * Tests system prompt construction, response parsing, timeout handling,
 * and malformed JSON handling.
 *
 * Requirements: 9.1, 9.3, 9.4, 9.5, 9.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LlmDetectionEngine, LlmClassificationResult } from '../../src/rag/intent-detection/llm-detection-engine';
import { BedrockService } from '../../src/rag/bedrock.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { ConceptRegistryService } from '../../src/rag/metric-resolution/concept-registry.service';

// Mock dependencies
const mockBedrock = {
  invokeClaude: vi.fn(),
} as unknown as BedrockService;

const mockMetricRegistry = {
  getAllMetrics: vi.fn().mockReturnValue(
    new Map([
      ['total_revenue', { display_name: 'Total Revenue', canonical_id: 'total_revenue', type: 'atomic' }],
      ['gross_profit', { display_name: 'Gross Profit', canonical_id: 'gross_profit', type: 'atomic' }],
      ['gross_margin', { display_name: 'Gross Margin', canonical_id: 'gross_margin', type: 'computed' }],
      ['net_income', { display_name: 'Net Income', canonical_id: 'net_income', type: 'atomic' }],
    ]),
  ),
} as unknown as MetricRegistryService;

const mockConceptRegistry = {
  getAllConceptIds: vi.fn().mockReturnValue(['leverage_profile', 'profitability_profile']),
  getConceptById: vi.fn().mockImplementation((id: string) => {
    if (id === 'leverage_profile') {
      return {
        display_name: 'Leverage Profile',
        triggers: ['how levered', 'debt level', 'leverage ratio'],
      };
    }
    if (id === 'profitability_profile') {
      return {
        display_name: 'Profitability Profile',
        triggers: ['how profitable', 'profitability', 'margin analysis'],
      };
    }
    return undefined;
  }),
} as unknown as ConceptRegistryService;

describe('LlmDetectionEngine', () => {
  let engine: LlmDetectionEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    engine = new LlmDetectionEngine(mockBedrock, mockMetricRegistry, mockConceptRegistry);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // System Prompt Construction
  // -------------------------------------------------------------------------

  describe('getSystemPrompt', () => {
    it('should contain metric display names from MetricRegistryService', () => {
      const prompt = engine.getSystemPrompt();
      expect(prompt).toContain('Total Revenue');
      expect(prompt).toContain('Gross Profit');
      expect(prompt).toContain('Gross Margin');
      expect(prompt).toContain('Net Income');
    });

    it('should contain concept triggers from ConceptRegistryService', () => {
      const prompt = engine.getSystemPrompt();
      expect(prompt).toContain('Leverage Profile');
      expect(prompt).toContain('how levered');
      expect(prompt).toContain('Profitability Profile');
      expect(prompt).toContain('how profitable');
    });

    it('should contain valid section types', () => {
      const prompt = engine.getSystemPrompt();
      expect(prompt).toContain('item_1');
      expect(prompt).toContain('item_1a');
      expect(prompt).toContain('item_7');
      expect(prompt).toContain('item_8');
    });

    it('should contain few-shot examples', () => {
      const prompt = engine.getSystemPrompt();
      expect(prompt).toContain('AAPL revenue FY2024');
      expect(prompt).toContain('Compare NVDA and MSFT gross margin');
      expect(prompt).toContain('How levered is Apple?');
      expect(prompt).toContain('What are AMZN\'s key risk factors');
      expect(prompt).toContain('NVDA revenue trend over the last 5 years');
      expect(prompt).toContain('Tell me about Tesla');
    });

    it('should contain JSON schema template', () => {
      const prompt = engine.getSystemPrompt();
      expect(prompt).toContain('"tickers"');
      expect(prompt).toContain('"rawMetricPhrases"');
      expect(prompt).toContain('"queryType"');
      expect(prompt).toContain('"confidence"');
    });

    it('should cache the system prompt on subsequent calls', () => {
      const prompt1 = engine.getSystemPrompt();
      const prompt2 = engine.getSystemPrompt();
      expect(prompt1).toBe(prompt2);
      // getAllMetrics should only be called once (during first build)
      expect(mockMetricRegistry.getAllMetrics).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidatePromptCache', () => {
    it('should rebuild prompt on next getSystemPrompt call after invalidation', () => {
      engine.getSystemPrompt();
      expect(mockMetricRegistry.getAllMetrics).toHaveBeenCalledTimes(1);

      engine.invalidatePromptCache();
      engine.getSystemPrompt();
      expect(mockMetricRegistry.getAllMetrics).toHaveBeenCalledTimes(2);
    });

    it('should increment prompt version', () => {
      expect(engine.getPromptVersion()).toBe(0);
      engine.invalidatePromptCache();
      expect(engine.getPromptVersion()).toBe(1);
      engine.invalidatePromptCache();
      expect(engine.getPromptVersion()).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Response Parsing — Valid JSON
  // -------------------------------------------------------------------------

  describe('parseResponse', () => {
    const validResponse = JSON.stringify({
      tickers: ['AAPL'],
      rawMetricPhrases: ['revenue'],
      queryType: 'structured',
      period: 'FY2024',
      needsNarrative: false,
      needsComparison: false,
      needsComputation: false,
      needsTrend: false,
      needsPeerComparison: false,
      needsClarification: false,
      confidence: 0.95,
    });

    it('should parse a valid structured query response', () => {
      const result = engine.parseResponse(validResponse, 'AAPL revenue FY2024');
      expect(result.tickers).toEqual(['AAPL']);
      expect(result.rawMetricPhrases).toEqual(['revenue']);
      expect(result.queryType).toBe('structured');
      expect(result.period).toBe('FY2024');
      expect(result.confidence).toBe(0.95);
      expect(result.needsNarrative).toBe(false);
      expect(result.needsComparison).toBe(false);
    });

    it('should parse a comparison query response', () => {
      const response = JSON.stringify({
        tickers: ['NVDA', 'MSFT'],
        rawMetricPhrases: ['gross margin'],
        queryType: 'structured',
        needsNarrative: false,
        needsComparison: true,
        needsComputation: true,
        needsTrend: false,
        needsPeerComparison: true,
        needsClarification: false,
        confidence: 0.9,
      });
      const result = engine.parseResponse(response, 'Compare NVDA and MSFT gross margin');
      expect(result.tickers).toEqual(['NVDA', 'MSFT']);
      expect(result.needsComparison).toBe(true);
      expect(result.needsPeerComparison).toBe(true);
    });

    it('should parse a trend query response', () => {
      const response = JSON.stringify({
        tickers: ['NVDA'],
        rawMetricPhrases: ['revenue'],
        queryType: 'structured',
        periodStart: 'FY2020',
        periodEnd: 'FY2024',
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: true,
        needsPeerComparison: false,
        needsClarification: false,
        confidence: 0.9,
      });
      const result = engine.parseResponse(response, 'NVDA revenue trend over 5 years');
      expect(result.needsTrend).toBe(true);
      expect(result.periodStart).toBe('FY2020');
      expect(result.periodEnd).toBe('FY2024');
    });

    it('should parse a qualitative/narrative query response', () => {
      const response = JSON.stringify({
        tickers: ['AMZN'],
        rawMetricPhrases: [],
        queryType: 'semantic',
        sectionTypes: ['item_1a'],
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: false,
        needsClarification: false,
        confidence: 0.9,
      });
      const result = engine.parseResponse(response, "What are AMZN's risk factors?");
      expect(result.queryType).toBe('semantic');
      expect(result.needsNarrative).toBe(true);
      expect(result.sectionTypes).toEqual(['item_1a']);
    });

    it('should parse a concept query response', () => {
      const response = JSON.stringify({
        tickers: ['AAPL'],
        rawMetricPhrases: [],
        queryType: 'hybrid',
        needsNarrative: true,
        needsComparison: false,
        needsComputation: true,
        needsTrend: false,
        needsPeerComparison: false,
        needsClarification: false,
        conceptMatch: 'leverage_profile',
        confidence: 0.9,
      });
      const result = engine.parseResponse(response, 'How levered is Apple?');
      expect(result.conceptMatch).toBe('leverage');
      expect(result.queryType).toBe('hybrid');
    });

    it('should parse an ambiguous query response', () => {
      const response = JSON.stringify({
        tickers: ['TSLA'],
        rawMetricPhrases: [],
        queryType: 'semantic',
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: false,
        needsClarification: true,
        ambiguityReason: 'Query mentions a company but does not specify what information is needed',
        confidence: 0.5,
      });
      const result = engine.parseResponse(response, 'Tell me about Tesla');
      expect(result.needsClarification).toBe(true);
      expect(result.ambiguityReason).toContain('does not specify');
      expect(result.confidence).toBe(0.5);
    });

    it('should normalize tickers to uppercase', () => {
      const response = JSON.stringify({
        tickers: ['aapl', 'msft'],
        rawMetricPhrases: [],
        queryType: 'structured',
        needsNarrative: false,
        needsComparison: true,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: false,
        needsClarification: false,
        confidence: 0.9,
      });
      const result = engine.parseResponse(response, 'aapl vs msft');
      expect(result.tickers).toEqual(['AAPL', 'MSFT']);
    });

    it('should clamp confidence to [0, 1]', () => {
      const response = JSON.stringify({
        tickers: [],
        rawMetricPhrases: [],
        queryType: 'semantic',
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: false,
        needsClarification: false,
        confidence: 1.5,
      });
      const result = engine.parseResponse(response, 'test');
      expect(result.confidence).toBe(1);
    });

    it('should filter invalid section types', () => {
      const response = JSON.stringify({
        tickers: ['AAPL'],
        rawMetricPhrases: [],
        queryType: 'semantic',
        sectionTypes: ['item_1a', 'invalid_section', 'item_7'],
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: false,
        needsClarification: false,
        confidence: 0.9,
      });
      const result = engine.parseResponse(response, 'AAPL risk factors');
      expect(result.sectionTypes).toEqual(['item_1a', 'item_7']);
    });
  });

  // -------------------------------------------------------------------------
  // Response Parsing — Malformed JSON
  // -------------------------------------------------------------------------

  describe('parseResponse — malformed JSON', () => {
    it('should extract JSON from markdown code blocks', () => {
      const response = '```json\n{"tickers":["AAPL"],"rawMetricPhrases":["revenue"],"queryType":"structured","needsNarrative":false,"needsComparison":false,"needsComputation":false,"needsTrend":false,"needsPeerComparison":false,"needsClarification":false,"confidence":0.9}\n```';
      const result = engine.parseResponse(response, 'AAPL revenue');
      expect(result.tickers).toEqual(['AAPL']);
      expect(result.confidence).toBe(0.9);
    });

    it('should extract JSON embedded in extra text', () => {
      const response = 'Here is the classification:\n{"tickers":["MSFT"],"rawMetricPhrases":[],"queryType":"semantic","needsNarrative":true,"needsComparison":false,"needsComputation":false,"needsTrend":false,"needsPeerComparison":false,"needsClarification":false,"confidence":0.8}\nDone.';
      const result = engine.parseResponse(response, 'MSFT overview');
      expect(result.tickers).toEqual(['MSFT']);
    });

    it('should attempt partial extraction from completely malformed response', () => {
      const response = 'I found tickers: "tickers": ["NVDA", "AMD"], and the "queryType": "structured", with "confidence": 0.7';
      const result = engine.parseResponse(response, 'NVDA vs AMD');
      expect(result.tickers).toEqual(['NVDA', 'AMD']);
      expect(result.queryType).toBe('structured');
      expect(result.confidence).toBeLessThanOrEqual(0.6); // Capped for partial
      expect(result.needsClarification).toBe(true);
    });

    it('should fall back to partial extraction for unparseable response', () => {
      const response = 'I cannot classify this query.';
      // Partial extraction returns a degraded result rather than throwing
      const result = engine.parseResponse(response, 'test');
      expect(result.needsClarification).toBe(true);
      expect(result.confidence).toBeLessThanOrEqual(0.6);
      expect(result.ambiguityReason).toContain('malformed');
    });

    it('should throw when response is not a JSON object', () => {
      const response = '"just a string"';
      expect(() => engine.parseResponse(response, 'test')).toThrow('not a JSON object');
    });

    it('should throw when required field tickers is missing', () => {
      const response = JSON.stringify({
        rawMetricPhrases: [],
        queryType: 'semantic',
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: false,
        needsClarification: false,
        confidence: 0.5,
      });
      expect(() => engine.parseResponse(response, 'test')).toThrow('tickers');
    });

    it('should throw when queryType is invalid', () => {
      const response = JSON.stringify({
        tickers: [],
        rawMetricPhrases: [],
        queryType: 'invalid',
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: false,
        needsClarification: false,
        confidence: 0.5,
      });
      expect(() => engine.parseResponse(response, 'test')).toThrow('queryType');
    });

    it('should be lenient with boolean-like values', () => {
      const response = JSON.stringify({
        tickers: ['AAPL'],
        rawMetricPhrases: [],
        queryType: 'structured',
        needsNarrative: 0,
        needsComparison: 1,
        needsComputation: 'false',
        needsTrend: 'true',
        needsPeerComparison: null,
        needsClarification: false,
        confidence: 0.9,
      });
      const result = engine.parseResponse(response, 'test');
      expect(result.needsNarrative).toBe(false);
      expect(result.needsComparison).toBe(true);
      expect(result.needsComputation).toBe(false);
      expect(result.needsTrend).toBe(true);
      expect(result.needsPeerComparison).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // classify() — LLM invocation and timeout
  // -------------------------------------------------------------------------

  describe('classify', () => {
    const validLlmResponse = JSON.stringify({
      tickers: ['AAPL'],
      rawMetricPhrases: ['revenue'],
      queryType: 'structured',
      period: 'FY2024',
      needsNarrative: false,
      needsComparison: false,
      needsComputation: false,
      needsTrend: false,
      needsPeerComparison: false,
      needsClarification: false,
      confidence: 0.95,
    });

    it('should invoke BedrockService with correct model and parameters', async () => {
      vi.useRealTimers();
      (mockBedrock.invokeClaude as ReturnType<typeof vi.fn>).mockResolvedValue(validLlmResponse);

      await engine.classify('AAPL revenue FY2024');

      expect(mockBedrock.invokeClaude).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
          max_tokens: 500,
        }),
      );
    });

    it('should include the query in the prompt', async () => {
      vi.useRealTimers();
      (mockBedrock.invokeClaude as ReturnType<typeof vi.fn>).mockResolvedValue(validLlmResponse);

      await engine.classify('AAPL revenue FY2024');

      const callArgs = (mockBedrock.invokeClaude as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.prompt).toContain('AAPL revenue FY2024');
    });

    it('should include context ticker in the prompt when provided', async () => {
      vi.useRealTimers();
      (mockBedrock.invokeClaude as ReturnType<typeof vi.fn>).mockResolvedValue(validLlmResponse);

      await engine.classify('What is the revenue?', 'MSFT');

      const callArgs = (mockBedrock.invokeClaude as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.prompt).toContain('MSFT');
      expect(callArgs.prompt).toContain('currently viewing');
    });

    it('should return parsed classification result', async () => {
      vi.useRealTimers();
      (mockBedrock.invokeClaude as ReturnType<typeof vi.fn>).mockResolvedValue(validLlmResponse);

      const result = await engine.classify('AAPL revenue FY2024');
      expect(result.tickers).toEqual(['AAPL']);
      expect(result.rawMetricPhrases).toEqual(['revenue']);
      expect(result.queryType).toBe('structured');
      expect(result.confidence).toBe(0.95);
    });

    it('should timeout after 3 seconds', async () => {
      // Mock a slow LLM response that never resolves within timeout
      (mockBedrock.invokeClaude as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(validLlmResponse), 5000)),
      );

      const classifyPromise = engine.classify('slow query');
      vi.advanceTimersByTime(3000);
      await expect(classifyPromise).rejects.toThrow('timed out');
    });

    it('should propagate LLM errors', async () => {
      vi.useRealTimers();
      (mockBedrock.invokeClaude as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Bedrock API error'),
      );

      await expect(engine.classify('test query')).rejects.toThrow('Bedrock API error');
    });
  });

  // -------------------------------------------------------------------------
  // System prompt with degraded registries
  // -------------------------------------------------------------------------

  describe('system prompt with unavailable registries', () => {
    it('should handle MetricRegistryService errors gracefully', () => {
      const failingMetricRegistry = {
        getAllMetrics: vi.fn().mockImplementation(() => {
          throw new Error('Registry unavailable');
        }),
      } as unknown as MetricRegistryService;

      const failingEngine = new LlmDetectionEngine(
        mockBedrock,
        failingMetricRegistry,
        mockConceptRegistry,
      );

      const prompt = failingEngine.getSystemPrompt();
      expect(prompt).toContain('metric list unavailable');
    });

    it('should handle ConceptRegistryService errors gracefully', () => {
      const failingConceptRegistry = {
        getAllConceptIds: vi.fn().mockImplementation(() => {
          throw new Error('Concepts unavailable');
        }),
      } as unknown as ConceptRegistryService;

      const failingEngine = new LlmDetectionEngine(
        mockBedrock,
        mockMetricRegistry,
        failingConceptRegistry,
      );

      const prompt = failingEngine.getSystemPrompt();
      expect(prompt).toContain('concept list unavailable');
    });
  });
});
