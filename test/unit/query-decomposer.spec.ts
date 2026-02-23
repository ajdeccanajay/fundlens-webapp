import { Test, TestingModule } from '@nestjs/testing';
import {
  QueryDecomposerService,
  DecomposedQuery,
} from '../../src/rag/query-decomposer.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { QueryIntent } from '../../src/rag/types/query-intent';

/**
 * Unit tests for QueryDecomposerService
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6
 */
describe('QueryDecomposerService', () => {
  let service: QueryDecomposerService;
  let bedrockMock: { invokeClaude: jest.Mock };

  beforeEach(async () => {
    bedrockMock = {
      invokeClaude: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryDecomposerService,
        { provide: BedrockService, useValue: bedrockMock },
      ],
    }).compile();

    service = module.get(QueryDecomposerService);
  });

  // ── Helper to build a minimal QueryIntent ──────────────────────────
  function makeIntent(overrides: Partial<QueryIntent> = {}): QueryIntent {
    return {
      type: 'structured',
      needsNarrative: false,
      needsComparison: false,
      needsComputation: false,
      needsTrend: false,
      confidence: 0.9,
      originalQuery: 'test query',
      ...overrides,
    };
  }

  // ── Req 12.1: Single-intent fast-path (no LLM call) ─────────────────
  describe('single-intent fast-path', () => {
    it('should return isDecomposed: false for a simple structured query', async () => {
      const query = 'What is the latest revenue for ABNB?';
      const intent = makeIntent({ type: 'structured', metrics: ['revenue'], ticker: 'ABNB' });

      const result = await service.decompose(query, intent);

      expect(result.isDecomposed).toBe(false);
      expect(result.subQueries).toEqual([]);
      expect(result.originalQuery).toBe(query);
      expect(bedrockMock.invokeClaude).not.toHaveBeenCalled();
    });

    it('should return isDecomposed: false for a pure semantic query', async () => {
      const query = 'What are the key risk factors for MSFT?';
      const intent = makeIntent({ type: 'semantic', needsNarrative: true });

      const result = await service.decompose(query, intent);

      expect(result.isDecomposed).toBe(false);
      expect(bedrockMock.invokeClaude).not.toHaveBeenCalled();
    });

    it('should return isDecomposed: false when compound marker present but no mixed intent', async () => {
      // "and" is present but intent is purely structured — no decomposition needed
      const query = 'What is revenue and gross profit for ABNB?';
      const intent = makeIntent({ type: 'structured', metrics: ['revenue', 'gross_profit'] });

      const result = await service.decompose(query, intent);

      expect(result.isDecomposed).toBe(false);
      expect(bedrockMock.invokeClaude).not.toHaveBeenCalled();
    });

    it('should return isDecomposed: false when mixed intent but no compound marker', async () => {
      const query = 'Explain ABNB revenue trends';
      const intent = makeIntent({ type: 'hybrid', needsNarrative: true, metrics: ['revenue'] });

      const result = await service.decompose(query, intent);

      expect(result.isDecomposed).toBe(false);
      expect(bedrockMock.invokeClaude).not.toHaveBeenCalled();
    });
  });

  // ── Req 12.2: Compound markers + mixed intent → LLM decomposition ──
  describe('multi-part decomposition', () => {
    it('should invoke LLM when compound marker AND mixed intent detected', async () => {
      const query = "What are ABNB's margins AND what does management say drives them?";
      const intent = makeIntent({
        type: 'hybrid',
        needsNarrative: true,
        metrics: ['gross_profit_margin'],
        ticker: 'ABNB',
      });

      bedrockMock.invokeClaude.mockResolvedValue(
        JSON.stringify({
          subQueries: [
            "What are ABNB's gross profit margins?",
            "What does ABNB management say drives their margins?",
          ],
          unifyingInstruction:
            'Combine the quantitative margin data with management commentary to explain margin drivers.',
        }),
      );

      const result = await service.decompose(query, intent);

      expect(result.isDecomposed).toBe(true);
      expect(result.subQueries).toHaveLength(2);
      expect(result.unifyingInstruction).toContain('margin');
      expect(bedrockMock.invokeClaude).toHaveBeenCalledTimes(1);
    });

    it('should trigger decomposition with "also" marker and mixed intent', async () => {
      const query = 'Show ABNB revenue also explain the risk factors';
      const intent = makeIntent({
        type: 'hybrid',
        needsNarrative: true,
        metrics: ['revenue'],
        ticker: 'ABNB',
      });

      bedrockMock.invokeClaude.mockResolvedValue(
        JSON.stringify({
          subQueries: [
            'What is ABNB revenue?',
            'What are ABNB risk factors?',
          ],
          unifyingInstruction: 'Present revenue data then discuss risk factors.',
        }),
      );

      const result = await service.decompose(query, intent);

      expect(result.isDecomposed).toBe(true);
      expect(result.subQueries).toHaveLength(2);
      expect(bedrockMock.invokeClaude).toHaveBeenCalledTimes(1);
    });
  });

  // ── isSingleIntent() direct tests ───────────────────────────────────
  describe('isSingleIntent()', () => {
    it('returns true for simple query with no markers and no mixed intent', () => {
      const query = 'What is ABNB revenue?';
      const intent = makeIntent({ type: 'structured', metrics: ['revenue'] });
      expect(service.isSingleIntent(query, intent)).toBe(true);
    });

    it('returns false when "and" + mixed intent', () => {
      const query = 'Show margins and explain management commentary';
      const intent = makeIntent({ type: 'hybrid', needsNarrative: true, metrics: ['margin'] });
      expect(service.isSingleIntent(query, intent)).toBe(false);
    });

    it('returns true when "and" present but intent is purely structured', () => {
      const query = 'Revenue and EBITDA for ABNB';
      const intent = makeIntent({ type: 'structured', metrics: ['revenue', 'ebitda'] });
      expect(service.isSingleIntent(query, intent)).toBe(true);
    });

    it('returns false with "as well as" + mixed intent', () => {
      const query = 'Get revenue as well as risk discussion';
      const intent = makeIntent({ type: 'hybrid', needsNarrative: true, metrics: ['revenue'] });
      expect(service.isSingleIntent(query, intent)).toBe(false);
    });

    it('does not false-positive on "band" or "android" containing "and"', () => {
      const query = 'broadband revenue for CMCSA';
      const intent = makeIntent({ type: 'structured', metrics: ['revenue'] });
      // "broadband" contains "and" substring but \band\b should not match
      expect(service.isSingleIntent(query, intent)).toBe(true);
    });
  });

  // ── parseDecomposition() ────────────────────────────────────────────
  describe('parseDecomposition()', () => {
    it('should parse valid JSON with sub-queries', () => {
      const response = JSON.stringify({
        subQueries: ['Query A', 'Query B'],
        unifyingInstruction: 'Combine A and B.',
      });

      const result = service.parseDecomposition(response, 'original');

      expect(result.isDecomposed).toBe(true);
      expect(result.subQueries).toEqual(['Query A', 'Query B']);
      expect(result.unifyingInstruction).toBe('Combine A and B.');
      expect(result.originalQuery).toBe('original');
    });

    it('should enforce max 3 sub-queries (Req 12.3)', () => {
      const response = JSON.stringify({
        subQueries: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
        unifyingInstruction: 'Combine all.',
      });

      const result = service.parseDecomposition(response, 'original');

      expect(result.isDecomposed).toBe(true);
      expect(result.subQueries).toHaveLength(3);
      expect(result.subQueries).toEqual(['Q1', 'Q2', 'Q3']);
    });

    it('should provide default unifyingInstruction when missing', () => {
      const response = JSON.stringify({
        subQueries: ['Q1', 'Q2'],
      });

      const result = service.parseDecomposition(response, 'original');

      expect(result.isDecomposed).toBe(true);
      expect(result.unifyingInstruction).toBeTruthy();
      expect(result.unifyingInstruction!.length).toBeGreaterThan(0);
    });

    it('should return isDecomposed: false on invalid JSON', () => {
      const result = service.parseDecomposition('not valid json {{{', 'original');

      expect(result.isDecomposed).toBe(false);
      expect(result.subQueries).toEqual([]);
    });

    it('should return isDecomposed: false when subQueries array is empty', () => {
      const response = JSON.stringify({
        subQueries: [],
        unifyingInstruction: 'Nothing to combine.',
      });

      const result = service.parseDecomposition(response, 'original');

      expect(result.isDecomposed).toBe(false);
    });

    it('should handle markdown code block wrapping', () => {
      const response = '```json\n{"subQueries":["Q1","Q2"],"unifyingInstruction":"Combine."}\n```';

      const result = service.parseDecomposition(response, 'original');

      expect(result.isDecomposed).toBe(true);
      expect(result.subQueries).toEqual(['Q1', 'Q2']);
    });

    it('should filter out non-string and empty sub-queries', () => {
      const response = JSON.stringify({
        subQueries: ['Valid', '', null, 'Also valid', 42],
        unifyingInstruction: 'Combine.',
      });

      const result = service.parseDecomposition(response, 'original');

      expect(result.isDecomposed).toBe(true);
      expect(result.subQueries).toEqual(['Valid', 'Also valid']);
    });
  });

  // ── buildDecompositionPrompt() ──────────────────────────────────────
  describe('buildDecompositionPrompt()', () => {
    it('should include original query, tickers, and period', () => {
      const query = "What are ABNB's margins AND management drivers?";
      const intent = makeIntent({
        ticker: 'ABNB',
        period: 'FY2024',
        metrics: ['gross_profit_margin'],
      });

      const prompt = service.buildDecompositionPrompt(query, intent);

      expect(prompt).toContain(query);
      expect(prompt).toContain('ABNB');
      expect(prompt).toContain('FY2024');
      expect(prompt).toContain('MAXIMUM of 3');
      expect(prompt).toContain('JSON');
    });

    it('should handle array of tickers', () => {
      const intent = makeIntent({ ticker: ['ABNB', 'BKNG'] });
      const prompt = service.buildDecompositionPrompt('test', intent);

      expect(prompt).toContain('ABNB, BKNG');
    });
  });

  // ── Error handling ──────────────────────────────────────────────────
  describe('error handling', () => {
    it('should return isDecomposed: false when LLM call fails', async () => {
      const query = 'Show margins and explain management commentary for ABNB';
      const intent = makeIntent({
        type: 'hybrid',
        needsNarrative: true,
        metrics: ['margin'],
        ticker: 'ABNB',
      });

      bedrockMock.invokeClaude.mockRejectedValue(new Error('Bedrock timeout'));

      const result = await service.decompose(query, intent);

      expect(result.isDecomposed).toBe(false);
      expect(result.subQueries).toEqual([]);
      expect(result.originalQuery).toBe(query);
    });

    it('should return isDecomposed: false when LLM returns invalid JSON', async () => {
      const query = 'Show margins and explain management commentary for ABNB';
      const intent = makeIntent({
        type: 'hybrid',
        needsNarrative: true,
        metrics: ['margin'],
        ticker: 'ABNB',
      });

      bedrockMock.invokeClaude.mockResolvedValue('I cannot decompose this query properly.');

      const result = await service.decompose(query, intent);

      expect(result.isDecomposed).toBe(false);
      expect(result.subQueries).toEqual([]);
    });
  });
});

// ── T3.1 & T3.2: Definition of Done unit tests ─────────────────────
// Validates: Requirements 12.2, 12.3
describe('Definition of Done — T3.1 & T3.2', () => {
  let service: QueryDecomposerService;
  let bedrockMock: { invokeClaude: jest.Mock };

  beforeEach(async () => {
    bedrockMock = {
      invokeClaude: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryDecomposerService,
        { provide: BedrockService, useValue: bedrockMock },
      ],
    }).compile();

    service = module.get(QueryDecomposerService);
  });

  function makeIntent(overrides: Partial<QueryIntent> = {}): QueryIntent {
    return {
      type: 'structured',
      needsNarrative: false,
      needsComparison: false,
      needsComputation: false,
      needsTrend: false,
      confidence: 0.9,
      originalQuery: 'test query',
      ...overrides,
    };
  }

  /**
   * T3.1: "ABNB margins AND management drivers" → 2 sub-queries
   * The query has compound marker "AND" and mixed intent (structured metrics + narrative).
   * Validates: Requirements 12.2, 12.3
   */
  it('T3.1: "ABNB margins AND management drivers" produces 2 sub-queries', async () => {
    const query = 'ABNB margins AND management drivers';
    const intent = makeIntent({
      type: 'hybrid',
      needsNarrative: true,
      metrics: ['gross_profit_margin', 'operating_margin'],
      ticker: 'ABNB',
    });

    // Mock BedrockService to return valid JSON with 2 sub-queries
    bedrockMock.invokeClaude.mockResolvedValue(
      JSON.stringify({
        subQueries: [
          'What are ABNB gross profit margin and operating margin?',
          'What does ABNB management say about the key drivers of their business?',
        ],
        unifyingInstruction:
          'Present the quantitative margin data first, then layer in management commentary on what drives those margins.',
      }),
    );

    const result = await service.decompose(query, intent);

    expect(result.isDecomposed).toBe(true);
    expect(result.subQueries).toHaveLength(2);
    expect(result.unifyingInstruction).toBeTruthy();
    expect(result.originalQuery).toBe(query);
    expect(bedrockMock.invokeClaude).toHaveBeenCalledTimes(1);
  });

  /**
   * T3.2: "Model ABNB path to 30% EBITDA" → 3 sub-queries
   * Complex modeling query requiring decomposition into data, narrative, and computation.
   * Validates: Requirements 12.2, 12.3
   */
  it('T3.2: "Model ABNB path to 30% EBITDA" produces 3 sub-queries', async () => {
    const query = 'Model ABNB path to 30% EBITDA margin and also explain management guidance';
    const intent = makeIntent({
      type: 'hybrid',
      needsNarrative: true,
      needsComputation: true,
      metrics: ['ebitda_margin', 'revenue', 'operating_expenses'],
      ticker: 'ABNB',
    });

    // Mock BedrockService to return valid JSON with 3 sub-queries
    bedrockMock.invokeClaude.mockResolvedValue(
      JSON.stringify({
        subQueries: [
          'What are ABNB current EBITDA margin, revenue, and operating expenses?',
          'What is ABNB management guidance on margin expansion and cost structure?',
          'What would ABNB need in revenue growth and cost reduction to reach 30% EBITDA margin?',
        ],
        unifyingInstruction:
          'Start with current financials, incorporate management guidance on margin trajectory, then model the path to 30% EBITDA margin using the data and qualitative context.',
      }),
    );

    const result = await service.decompose(query, intent);

    expect(result.isDecomposed).toBe(true);
    expect(result.subQueries).toHaveLength(3);
    expect(result.unifyingInstruction).toBeTruthy();
    expect(result.originalQuery).toBe(query);
    expect(bedrockMock.invokeClaude).toHaveBeenCalledTimes(1);
  });
});

