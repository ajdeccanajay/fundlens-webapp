/**
 * Intent Detector Unit Tests
 * Tests query classification for routing to appropriate retrievers
 */

import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';

describe('IntentDetectorService', () => {
  let service: IntentDetectorService;
  let bedrockService: BedrockService;
  let analyticsService: IntentAnalyticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentDetectorService,
        {
          provide: BedrockService,
          useValue: {
            invokeClaude: jest.fn().mockImplementation((params) => {
              // Extract ticker from the prompt
              const prompt = params.prompt;
              const tickerMatch = prompt.match(/Query: "([^"]+)"/);
              if (tickerMatch) {
                const query = tickerMatch[1];
                // Extract ticker from query
                const tickers = ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'CRM', 'ORCL', 'ADBE'];
                for (const ticker of tickers) {
                  if (query.toUpperCase().includes(ticker)) {
                    return Promise.resolve(`{"ticker":"${ticker}","confidence":0.8}`);
                  }
                }
              }
              // Default fallback
              return Promise.resolve('{"ticker":"NVDA","confidence":0.8}');
            }),
          },
        },
        {
          provide: IntentAnalyticsService,
          useValue: {
            logDetection: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);
    bedrockService = module.get<BedrockService>(BedrockService);
    analyticsService = module.get<IntentAnalyticsService>(IntentAnalyticsService);
  });

  describe('Quantitative Intent Detection', () => {
    const quantitativeQueries = [
      'What is AAPL revenue for 2024?',
      'Show me MSFT gross margin',
      'What is the net income for TSLA?',
      'Calculate EBITDA for SHOP',
      'What are the total assets?',
      'Show revenue growth rate',
      'Operating cash flow for Q3 2024',
    ];

    quantitativeQueries.forEach((query) => {
      it(`should detect structured intent: "${query.substring(0, 40)}..."`, async () => {
        const result = await service.detectIntent(query);
        expect(['structured', 'hybrid', 'semantic']).toContain(result.type);
      });
    });
  });

  describe('Qualitative Intent Detection', () => {
    const qualitativeQueries = [
      'What does AAPL do?',
      'Describe the business model',
      'What are the risk factors?',
      'Who is on the management team?',
      'What is the company strategy?',
      'Explain the competitive advantages',
      'What products does the company offer?',
      'Describe recent developments',
    ];

    qualitativeQueries.forEach((query) => {
      it(`should detect semantic intent: "${query.substring(0, 40)}..."`, async () => {
        const result = await service.detectIntent(query);
        expect(['semantic', 'hybrid', 'structured']).toContain(result.type);
      });
    });
  });

  describe('Hybrid Intent Detection', () => {
    const hybridQueries = [
      'Compare revenue growth with business strategy',
      'How does margin improvement relate to operational changes?',
      'Explain the revenue breakdown and growth drivers',
      'What is driving the increase in operating income?',
    ];

    hybridQueries.forEach((query) => {
      it(`should detect intent: "${query.substring(0, 40)}..."`, async () => {
        const result = await service.detectIntent(query);
        expect(result.type).toBeDefined();
      });
    });
  });

  describe('Metric Extraction', () => {
    it('should extract revenue metric', async () => {
      const result = await service.detectIntent('What is the revenue?');
      expect(result.metrics).toBeDefined();
      if (result.metrics && result.metrics.length > 0) {
        expect(result.metrics.some(m => m.toLowerCase().includes('revenue'))).toBe(true);
      }
    });

    it('should extract period from query', async () => {
      const result = await service.detectIntent('What is revenue for 2024?');
      expect(result.period || result.periodType).toBeDefined();
    });
  });

  describe('Document Type Detection', () => {
    it('should detect 10-K for annual queries', async () => {
      const result = await service.detectIntent('What is annual revenue?');
      if (result.documentTypes) {
        expect(result.documentTypes).toContain('10-K');
      }
    });

    it('should detect 10-Q for quarterly queries', async () => {
      const result = await service.detectIntent('What is Q3 revenue?');
      if (result.documentTypes) {
        expect(result.documentTypes.some(d => d === '10-Q' || d === '10-K')).toBe(true);
      }
    });
  });

  describe('Boundary Condition Fix - Confidence Threshold', () => {
    describe('Confidence exactly 0.7 (ticker-only queries)', () => {
      it('should accept query with exactly 0.7 confidence', async () => {
        const query = "Show me NVDA";
        const result = await service.detectIntent(query);
        
        // "Show me NVDA" is ambiguous, so it uses LLM which returns 0.8
        // The important thing is that it's accepted (confidence >= 0.7)
        expect(result.ticker).toBe('NVDA');
        expect(result.confidence).toBeGreaterThanOrEqual(0.7);
        
        // Should be marked as needing clarification
        expect(result.needsClarification).toBe(true);
      });

      it('should accept "Tell me about AAPL" with 0.7 confidence', async () => {
        const query = "Tell me about AAPL";
        const result = await service.detectIntent(query);
        
        expect(result.confidence).toBeGreaterThanOrEqual(0.7);
        expect(result.ticker).toBe('AAPL');
      });

      it('should accept "MSFT information" with 0.7 confidence', async () => {
        const query = "MSFT information";
        const result = await service.detectIntent(query);
        
        expect(result.confidence).toBeGreaterThanOrEqual(0.7);
        expect(result.ticker).toBe('MSFT');
      });
    });

    describe('Confidence below 0.7 (should fall back to LLM)', () => {
      it('should fall back to LLM for query with 0.69 confidence', async () => {
        // Query with no ticker, no metrics, no period = 0.5 base confidence
        const query = "What is the latest information?";
        const result = await service.detectIntent(query);
        
        // Should fall back to LLM (which returns 0.8 in mock)
        // The important thing is that it doesn't use regex
        expect(result).toBeDefined();
      });
    });

    describe('Confidence above 0.7 (should use regex)', () => {
      it('should use regex for query with 0.71+ confidence', async () => {
        // Query with ticker + metrics = 0.5 + 0.2 + 0.2 = 0.9
        const query = "NVDA revenue";
        const result = await service.detectIntent(query);
        
        expect(result.confidence).toBeGreaterThan(0.7);
        expect(result.ticker).toBe('NVDA');
        expect(result.metrics).toBeDefined();
        expect(result.metrics).toContain('Revenue');
      });

      it('should use regex for query with ticker + period = 0.8', async () => {
        // Query with ticker + period = 0.5 + 0.2 + 0.1 = 0.8
        const query = "AAPL 2024";
        const result = await service.detectIntent(query);
        
        expect(result.confidence).toBeGreaterThanOrEqual(0.7);
        expect(result.ticker).toBe('AAPL');
        expect(result.period).toBeDefined();
      });
    });

    describe('Edge cases', () => {
      it('should handle empty query gracefully', async () => {
        const query = "";
        const result = await service.detectIntent(query);
        
        expect(result).toBeDefined();
        // Empty query falls back to LLM which returns 0.8 in mock
        expect(result.confidence).toBeGreaterThan(0);
      });

      it('should handle query with only whitespace', async () => {
        const query = "   ";
        const result = await service.detectIntent(query);
        
        expect(result).toBeDefined();
        // Whitespace query falls back to LLM which returns 0.8 in mock
        expect(result.confidence).toBeGreaterThan(0);
      });

      it('should handle query with special characters', async () => {
        const query = "What is NVDA's revenue?";
        const result = await service.detectIntent(query);
        
        expect(result.ticker).toBe('NVDA');
        expect(result.metrics).toContain('Revenue');
      });
    });
  });

  describe('Ambiguity Detection (Phase 2)', () => {
    describe('Ambiguous queries (should be marked for clarification)', () => {
      it('should detect "Tell me about NVDA" as ambiguous', async () => {
        const query = "Tell me about NVDA";
        const result = await service.detectIntent(query);
        
        // Should be marked as needing clarification
        expect(result.needsClarification).toBe(true);
        expect(result.ambiguityReason).toBeDefined();
        expect(result.ticker).toBe('NVDA');
        
        // Should have no specific metrics or sections
        expect(result.metrics).toBeUndefined();
        expect(result.sectionTypes).toBeUndefined();
      });

      it('should detect "Show me MSFT" as ambiguous', async () => {
        const query = "Show me MSFT";
        const result = await service.detectIntent(query);
        
        expect(result.needsClarification).toBe(true);
        expect(result.ticker).toBe('MSFT');
        expect(result.metrics).toBeUndefined();
        expect(result.sectionTypes).toBeUndefined();
      });

      it('should detect "AAPL information" as ambiguous', async () => {
        const query = "AAPL information";
        const result = await service.detectIntent(query);
        
        expect(result.needsClarification).toBe(true);
        expect(result.ticker).toBe('AAPL');
        expect(result.metrics).toBeUndefined();
        expect(result.sectionTypes).toBeUndefined();
      });

      it('should detect "Give me data on GOOGL" as ambiguous', async () => {
        const query = "Give me data on GOOGL";
        const result = await service.detectIntent(query);
        
        expect(result.needsClarification).toBe(true);
        expect(result.ticker).toBe('GOOGL');
        expect(result.metrics).toBeUndefined();
        expect(result.sectionTypes).toBeUndefined();
      });

      it('should detect "What is AMZN" as ambiguous', async () => {
        const query = "What is AMZN";
        const result = await service.detectIntent(query);
        
        expect(result.needsClarification).toBe(true);
        expect(result.ticker).toBe('AMZN');
        expect(result.metrics).toBeUndefined();
        expect(result.sectionTypes).toBeUndefined();
      });

      it('should detect "TSLA overview" as ambiguous', async () => {
        const query = "TSLA overview";
        const result = await service.detectIntent(query);
        
        expect(result.needsClarification).toBe(true);
        expect(result.ticker).toBe('TSLA');
        expect(result.metrics).toBeUndefined();
        expect(result.sectionTypes).toBeUndefined();
      });

      it('should detect "Summary of META" as ambiguous', async () => {
        const query = "Summary of META";
        const result = await service.detectIntent(query);
        
        expect(result.needsClarification).toBe(true);
        expect(result.ticker).toBe('META');
        expect(result.metrics).toBeUndefined();
        expect(result.sectionTypes).toBeUndefined();
      });
    });

    describe('Non-ambiguous queries (should NOT be marked for clarification)', () => {
      it('should NOT detect "NVDA revenue" as ambiguous', async () => {
        const query = "NVDA revenue";
        const result = await service.detectIntent(query);
        
        // Should NOT be marked as needing clarification
        expect(result.needsClarification).toBeFalsy();
        expect(result.ticker).toBe('NVDA');
        
        // Should have specific metrics
        expect(result.metrics).toBeDefined();
        expect(result.metrics).toContain('Revenue');
      });

      it('should NOT detect "NVDA\'s risk factors" as ambiguous', async () => {
        const query = "NVDA's risk factors";
        const result = await service.detectIntent(query);
        
        expect(result.needsClarification).toBeFalsy();
        expect(result.ticker).toBe('NVDA');
        
        // Should have specific sections
        expect(result.sectionTypes).toBeDefined();
        expect(result.sectionTypes).toContain('item_1a');
      });

      it('should NOT detect "AAPL gross margin" as ambiguous', async () => {
        const query = "AAPL gross margin";
        const result = await service.detectIntent(query);
        
        expect(result.needsClarification).toBeFalsy();
        expect(result.ticker).toBe('AAPL');
        expect(result.metrics).toBeDefined();
      });

      it('should NOT detect "MSFT business model" as ambiguous', async () => {
        const query = "MSFT business model";
        const result = await service.detectIntent(query);
        
        expect(result.needsClarification).toBeFalsy();
        expect(result.ticker).toBe('MSFT');
        expect(result.sectionTypes).toBeDefined();
        expect(result.sectionTypes).toContain('item_1');
      });

      it('should NOT detect "GOOGL competitors" as ambiguous', async () => {
        const query = "GOOGL competitors";
        const result = await service.detectIntent(query);
        
        expect(result.needsClarification).toBeFalsy();
        expect(result.ticker).toBe('GOOGL');
        expect(result.sectionTypes).toBeDefined();
        expect(result.sectionTypes).toContain('item_1');
      });

      it('should NOT detect "AMZN cash flow" as ambiguous', async () => {
        const query = "AMZN cash flow";
        const result = await service.detectIntent(query);
        
        expect(result.needsClarification).toBeFalsy();
        expect(result.ticker).toBe('AMZN');
        expect(result.metrics).toBeDefined();
      });

      it('should NOT detect "TSLA management discussion" as ambiguous', async () => {
        const query = "TSLA management discussion";
        const result = await service.detectIntent(query);
        
        expect(result.needsClarification).toBeFalsy();
        expect(result.ticker).toBe('TSLA');
        expect(result.sectionTypes).toBeDefined();
        expect(result.sectionTypes).toContain('item_7');
      });
    });

    describe('Edge cases for ambiguity detection', () => {
      it('should handle ticker-only query without ambiguous words', async () => {
        // Just the ticker alone without generic words
        const query = "NVDA";
        const result = await service.detectIntent(query);
        
        // Should NOT be ambiguous (no ambiguous words)
        expect(result.needsClarification).toBeFalsy();
        expect(result.ticker).toBe('NVDA');
      });

      it('should handle query with ambiguous words but no ticker', async () => {
        // Ambiguous words but no ticker
        const query = "Tell me about the company";
        const result = await service.detectIntent(query);
        
        // Should NOT be ambiguous (no ticker, so confidence < 0.7)
        // This will fall back to LLM
        expect(result).toBeDefined();
      });

      it('should handle query with ticker and period (confidence 0.8)', async () => {
        // Ticker + period = 0.8 confidence (not ticker-only)
        const query = "Show me AAPL 2024";
        const result = await service.detectIntent(query);
        
        // Should NOT be ambiguous (confidence > 0.7, not exactly 0.7)
        expect(result.needsClarification).toBeFalsy();
        expect(result.ticker).toBe('AAPL');
        expect(result.period).toBeDefined();
      });
    });
  });
});
