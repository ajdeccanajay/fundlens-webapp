import { Test, TestingModule } from '@nestjs/testing';
import { HaikuIntentParserService } from '../../src/rag/haiku-intent-parser.service';
import { BedrockService } from '../../src/rag/bedrock.service';

/**
 * Unit tests for HaikuIntentParserService
 *
 * Covers:
 * - T0.1: "What is ABNB's latest revenue?" → ticker ABNB, metric revenue, single_metric, latest
 * - T0.7: "abnb revenue" → ABNB uppercase normalization
 * - T0.12: Invalid JSON from Haiku → parseResponse returns null
 * - Prompt version logging with API calls
 * - Markdown fence stripping (```json wrapped response)
 *
 * Requirements: 1.1, 1.2, 1.7, 1.8, 1.9
 */
describe('HaikuIntentParserService', () => {
  let service: HaikuIntentParserService;
  let bedrockMock: jest.Mocked<BedrockService>;
  let loggerDebugSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    bedrockMock = {
      invokeClaude: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HaikuIntentParserService,
        { provide: BedrockService, useValue: bedrockMock },
      ],
    }).compile();

    service = module.get<HaikuIntentParserService>(HaikuIntentParserService);

    // Spy on logger methods
    loggerDebugSpy = jest.spyOn((service as any).logger, 'debug');
    loggerWarnSpy = jest.spyOn((service as any).logger, 'warn');
  });

  // ---------------------------------------------------------------------------
  // T0.1: "What is ABNB's latest revenue?" → ticker ABNB, metric revenue,
  //        single_metric, latest
  // Requirements: 1.1, 3.1, 4.4, 5.1
  // ---------------------------------------------------------------------------
  describe('T0.1 — single metric query with explicit ticker', () => {
    it('should parse "What is ABNB\'s latest revenue?" into correct QIO', async () => {
      const haikuResponse = JSON.stringify({
        entities: [{ ticker: 'ABNB', company: 'Airbnb', confidence: 0.95 }],
        metrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
        time_period: { type: 'latest', value: null, unit: null, raw_text: 'latest' },
        query_type: 'single_metric',
        needs_narrative: false,
        needs_peer_comparison: false,
        needs_computation: false,
        original_query: "What is ABNB's latest revenue?",
      });

      bedrockMock.invokeClaude.mockResolvedValue(haikuResponse);

      const result = await service.parse("What is ABNB's latest revenue?");

      expect(result).not.toBeNull();
      expect(result!.entities).toHaveLength(1);
      expect(result!.entities[0].ticker).toBe('ABNB');
      expect(result!.entities[0].company).toBe('Airbnb');
      expect(result!.entities[0].confidence).toBe(0.95);
      expect(result!.metrics).toHaveLength(1);
      expect(result!.metrics[0].raw_name).toBe('revenue');
      expect(result!.metrics[0].canonical_guess).toBe('revenue');
      expect(result!.metrics[0].is_computed).toBe(false);
      expect(result!.time_period.type).toBe('latest');
      expect(result!.time_period.value).toBeNull();
      expect(result!.query_type).toBe('single_metric');
      expect(result!.needs_narrative).toBe(false);
      expect(result!.needs_peer_comparison).toBe(false);
      expect(result!.needs_computation).toBe(false);
      expect(result!.original_query).toBe("What is ABNB's latest revenue?");
    });

    it('should call BedrockService with correct parameters', async () => {
      bedrockMock.invokeClaude.mockResolvedValue(JSON.stringify({
        entities: [{ ticker: 'ABNB', company: 'Airbnb', confidence: 0.95 }],
        metrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
        time_period: { type: 'latest', value: null, unit: null, raw_text: 'latest' },
        query_type: 'single_metric',
        needs_narrative: false,
        needs_peer_comparison: false,
        needs_computation: false,
        original_query: "What is ABNB's latest revenue?",
      }));

      await service.parse("What is ABNB's latest revenue?");

      expect(bedrockMock.invokeClaude).toHaveBeenCalledTimes(1);
      const callArgs = bedrockMock.invokeClaude.mock.calls[0][0];
      expect(callArgs.modelId).toBe('anthropic.claude-3-5-haiku-20241022-v1:0');
      expect(callArgs.max_tokens).toBe(500);
      expect(callArgs.temperature).toBe(0);
      expect(callArgs.systemPrompt).toBeDefined();
      expect(callArgs.prompt).toContain("What is ABNB's latest revenue?");
    });
  });

  // ---------------------------------------------------------------------------
  // T0.7: "abnb revenue" → ABNB uppercase normalization
  // Requirement: 1.2
  // ---------------------------------------------------------------------------
  describe('T0.7 — lowercase ticker normalization', () => {
    it('should normalize lowercase ticker "abnb" to uppercase "ABNB"', async () => {
      const haikuResponse = JSON.stringify({
        entities: [{ ticker: 'abnb', company: 'Airbnb', confidence: 0.9 }],
        metrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'single_metric',
        needs_narrative: false,
        needs_peer_comparison: false,
        needs_computation: false,
        original_query: 'abnb revenue',
      });

      bedrockMock.invokeClaude.mockResolvedValue(haikuResponse);

      const result = await service.parse('abnb revenue');

      expect(result).not.toBeNull();
      expect(result!.entities[0].ticker).toBe('ABNB');
    });
  });

  // ---------------------------------------------------------------------------
  // T0.12: Invalid JSON from Haiku → parseResponse returns null
  // Requirement: 1.7
  // ---------------------------------------------------------------------------
  describe('T0.12 — invalid JSON handling', () => {
    it('should return null when parseResponse receives invalid JSON', () => {
      const result = service.parseResponse('this is not json at all', 'test query');
      expect(result).toBeNull();
    });

    it('should return null when parseResponse receives empty string', () => {
      const result = service.parseResponse('', 'test query');
      expect(result).toBeNull();
    });

    it('should return null when JSON is missing required entities field', () => {
      const result = service.parseResponse(JSON.stringify({
        metrics: [],
        time_period: { type: 'latest' },
        query_type: 'single_metric',
      }), 'test query');
      expect(result).toBeNull();
    });

    it('should return null when JSON is missing required metrics field', () => {
      const result = service.parseResponse(JSON.stringify({
        entities: [],
        time_period: { type: 'latest' },
        query_type: 'single_metric',
      }), 'test query');
      expect(result).toBeNull();
    });

    it('should return null when JSON is missing required time_period field', () => {
      const result = service.parseResponse(JSON.stringify({
        entities: [],
        metrics: [],
        query_type: 'single_metric',
      }), 'test query');
      expect(result).toBeNull();
    });

    it('should return null when JSON is missing required query_type field', () => {
      const result = service.parseResponse(JSON.stringify({
        entities: [],
        metrics: [],
        time_period: { type: 'latest' },
      }), 'test query');
      expect(result).toBeNull();
    });

    it('should return null when query_type is not a valid enum value', () => {
      const result = service.parseResponse(JSON.stringify({
        entities: [],
        metrics: [],
        time_period: { type: 'latest' },
        query_type: 'invalid_type',
      }), 'test query');
      expect(result).toBeNull();
    });

    it('should return null from parse() when Bedrock returns invalid JSON', async () => {
      bedrockMock.invokeClaude.mockResolvedValue('Sorry, I cannot parse that query.');

      const result = await service.parse('some query');

      expect(result).toBeNull();
      expect(loggerWarnSpy).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Prompt version logging
  // Requirement: 1.9
  // ---------------------------------------------------------------------------
  describe('Prompt version logging', () => {
    it('should log prompt version with every Bedrock API call', async () => {
      bedrockMock.invokeClaude.mockResolvedValue(JSON.stringify({
        entities: [{ ticker: 'AAPL', company: 'Apple', confidence: 0.9 }],
        metrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'single_metric',
        needs_narrative: false,
        needs_peer_comparison: false,
        needs_computation: false,
        original_query: 'AAPL revenue',
      }));

      await service.parse('AAPL revenue');

      expect(loggerDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('prompt_version=v1.0.0'),
      );
    });

    it('should log the model ID with every Bedrock API call', async () => {
      bedrockMock.invokeClaude.mockResolvedValue(JSON.stringify({
        entities: [],
        metrics: [],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'narrative_only',
        needs_narrative: true,
        needs_peer_comparison: false,
        needs_computation: false,
        original_query: 'test',
      }));

      await service.parse('test');

      expect(loggerDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('model=anthropic.claude-3-5-haiku-20241022-v1:0'),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Markdown fence stripping
  // Requirement: 1.8 (defensive parsing)
  // ---------------------------------------------------------------------------
  describe('Markdown fence stripping', () => {
    it('should strip ```json fences and parse the inner JSON', () => {
      const wrappedResponse = '```json\n' + JSON.stringify({
        entities: [{ ticker: 'MSFT', company: 'Microsoft', confidence: 0.95 }],
        metrics: [{ raw_name: 'EBITDA', canonical_guess: 'ebitda', is_computed: false }],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'single_metric',
        needs_narrative: false,
        needs_peer_comparison: false,
        needs_computation: false,
        original_query: 'MSFT EBITDA',
      }) + '\n```';

      const result = service.parseResponse(wrappedResponse, 'MSFT EBITDA');

      expect(result).not.toBeNull();
      expect(result!.entities[0].ticker).toBe('MSFT');
      expect(result!.metrics[0].canonical_guess).toBe('ebitda');
      expect(result!.query_type).toBe('single_metric');
    });

    it('should strip ``` fences without json label', () => {
      const wrappedResponse = '```\n' + JSON.stringify({
        entities: [],
        metrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'single_metric',
        needs_narrative: false,
        needs_peer_comparison: false,
        needs_computation: false,
        original_query: 'revenue',
      }) + '\n```';

      const result = service.parseResponse(wrappedResponse, 'revenue');

      expect(result).not.toBeNull();
      expect(result!.metrics[0].raw_name).toBe('revenue');
    });
  });

  // ---------------------------------------------------------------------------
  // Bedrock error handling
  // ---------------------------------------------------------------------------
  describe('Bedrock error handling', () => {
    it('should return null when Bedrock throws an error', async () => {
      bedrockMock.invokeClaude.mockRejectedValue(new Error('Bedrock unavailable'));

      const result = await service.parse('AAPL revenue');

      expect(result).toBeNull();
    });

    it('should return null on Bedrock timeout', async () => {
      // Simulate a call that takes longer than the 3s timeout
      bedrockMock.invokeClaude.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('{}'), 5000)),
      );

      const result = await service.parse('AAPL revenue');

      expect(result).toBeNull();
    }, 10000);
  });

  // ---------------------------------------------------------------------------
  // parseResponse normalization edge cases
  // ---------------------------------------------------------------------------
  describe('parseResponse normalization', () => {
    it('should default confidence to 0.5 when missing', () => {
      const response = JSON.stringify({
        entities: [{ ticker: 'AAPL', company: 'Apple' }],
        metrics: [],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'single_metric',
        needs_narrative: false,
        needs_peer_comparison: false,
        needs_computation: false,
        original_query: 'test',
      });

      const result = service.parseResponse(response, 'test');

      expect(result).not.toBeNull();
      expect(result!.entities[0].confidence).toBe(0.5);
    });

    it('should clamp confidence to [0, 1] range', () => {
      const response = JSON.stringify({
        entities: [
          { ticker: 'AAPL', company: 'Apple', confidence: 1.5 },
          { ticker: 'MSFT', company: 'Microsoft', confidence: -0.3 },
        ],
        metrics: [],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'comparative',
        needs_narrative: false,
        needs_peer_comparison: false,
        needs_computation: false,
        original_query: 'test',
      });

      const result = service.parseResponse(response, 'test');

      expect(result).not.toBeNull();
      expect(result!.entities[0].confidence).toBe(1.0);
      expect(result!.entities[1].confidence).toBe(0);
    });

    it('should set original_query to the input query, not the JSON field', () => {
      const response = JSON.stringify({
        entities: [],
        metrics: [],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'narrative_only',
        needs_narrative: true,
        needs_peer_comparison: false,
        needs_computation: false,
        original_query: 'wrong query from haiku',
      });

      const result = service.parseResponse(response, 'the actual query');

      expect(result).not.toBeNull();
      expect(result!.original_query).toBe('the actual query');
    });

    it('should normalize canonical_guess to lowercase', () => {
      const response = JSON.stringify({
        entities: [],
        metrics: [{ raw_name: 'EBITDA', canonical_guess: 'EBITDA', is_computed: false }],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'single_metric',
        needs_narrative: false,
        needs_peer_comparison: false,
        needs_computation: false,
        original_query: 'test',
      });

      const result = service.parseResponse(response, 'test');

      expect(result).not.toBeNull();
      expect(result!.metrics[0].canonical_guess).toBe('ebitda');
    });
  });

  // ---------------------------------------------------------------------------
  // Gate Test: parse("What is C's revenue?") → ticker: C, company: Citigroup,
  //            metric: revenue
  // Session 0.5a checkpoint gate
  // Requirements: 1.3 (single-letter ticker)
  // ---------------------------------------------------------------------------
  describe('Session 0.5a Gate — single-letter ticker C for Citigroup', () => {
    it('should parse "What is C\'s revenue?" into ticker C, company Citigroup, metric revenue', async () => {
      const haikuResponse = JSON.stringify({
        entities: [{ ticker: 'C', company: 'Citigroup', confidence: 0.92 }],
        metrics: [{ raw_name: 'revenue', canonical_guess: 'revenue', is_computed: false }],
        time_period: { type: 'latest', value: null, unit: null, raw_text: '' },
        query_type: 'single_metric',
        needs_narrative: false,
        needs_peer_comparison: false,
        needs_computation: false,
        original_query: "What is C's revenue?",
      });

      bedrockMock.invokeClaude.mockResolvedValue(haikuResponse);

      const result = await service.parse("What is C's revenue?");

      expect(result).not.toBeNull();
      expect(result!.entities).toHaveLength(1);
      expect(result!.entities[0].ticker).toBe('C');
      expect(result!.entities[0].company).toBe('Citigroup');
      expect(result!.metrics).toHaveLength(1);
      expect(result!.metrics[0].raw_name).toBe('revenue');
      expect(result!.metrics[0].canonical_guess).toBe('revenue');
      expect(result!.query_type).toBe('single_metric');
    });
  });

  // ---------------------------------------------------------------------------
  // buildExtractionPrompt
  // ---------------------------------------------------------------------------
  describe('buildExtractionPrompt', () => {
    it('should return systemPrompt and userMessage', () => {
      const { systemPrompt, userMessage } = service.buildExtractionPrompt('ABNB revenue');

      expect(systemPrompt).toBeDefined();
      expect(systemPrompt.length).toBeGreaterThan(100);
      expect(userMessage).toContain('ABNB revenue');
    });

    it('should include all 5 rule categories in the system prompt', () => {
      const { systemPrompt } = service.buildExtractionPrompt('test');

      expect(systemPrompt).toContain('TICKERS');
      expect(systemPrompt).toContain('METRICS');
      expect(systemPrompt).toContain('TIME PERIODS');
      expect(systemPrompt).toContain('QUERY TYPE');
      expect(systemPrompt).toContain('FLAGS');
    });
  });
});
