import { Test, TestingModule } from '@nestjs/testing';
import { ResponseEnrichmentService } from '../../src/rag/response-enrichment.service';
import {
  FinancialCalculatorService,
} from '../../src/deals/financial-calculator.service';
import { VisualizationGeneratorService } from '../../src/rag/visualization-generator.service';
import { QueryIntent } from '../../src/rag/types/query-intent';

/**
 * Unit tests for isQuickResponseEligible() edge cases.
 *
 * Validates: Requirements 4.3
 *
 * These tests cover ticker-shape edge cases (single string, multi-element array,
 * single-element array, empty array) and a specific regression scenario for
 * multi-ticker comparison queries with a different context ticker.
 */

function makeEligibleIntent(overrides: Partial<QueryIntent> = {}): QueryIntent {
  return {
    type: 'structured',
    ticker: 'AAPL',
    confidence: 0.9,
    needsNarrative: false,
    needsComparison: false,
    needsComputation: false,
    needsTrend: false,
    originalQuery: 'AAPL revenue FY2024',
    ...overrides,
  };
}

describe('isQuickResponseEligible — edge cases', () => {
  let service: ResponseEnrichmentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResponseEnrichmentService,
        {
          provide: FinancialCalculatorService,
          useValue: { getMetricsSummary: jest.fn(), formatMetricValue: jest.fn() },
        },
        {
          provide: VisualizationGeneratorService,
          useValue: { generateVisualization: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(ResponseEnrichmentService);
  });

  it('returns true for a single string ticker when all other conditions are met', () => {
    const intent = makeEligibleIntent({ ticker: 'AAPL' });
    expect(service.isQuickResponseEligible(intent)).toBe(true);
  });

  it('returns false for an array ticker with 2+ elements', () => {
    const intent = makeEligibleIntent({ ticker: ['AMZN', 'MSFT'] });
    expect(service.isQuickResponseEligible(intent)).toBe(false);
  });

  it('returns true for a single-element array ticker (current guard only rejects length > 1)', () => {
    // NOTE: The isMultiTicker guard is `Array.isArray(ticker) && ticker.length > 1`.
    // A single-element array passes this guard. The code does NOT enforce
    // typeof ticker === 'string'. This test documents the current behavior.
    const intent = makeEligibleIntent({ ticker: ['AAPL'] });
    expect(service.isQuickResponseEligible(intent)).toBe(true);
  });

  it('returns true for an empty array ticker (current guard only rejects length > 1)', () => {
    // NOTE: An empty array passes the isMultiTicker guard (length is 0, not > 1).
    // The code does NOT check for empty arrays or enforce a string type.
    // This test documents the current behavior.
    const intent = makeEligibleIntent({ ticker: [] });
    expect(service.isQuickResponseEligible(intent)).toBe(true);
  });

  it('returns false for needsComparison=true even with a single string ticker', () => {
    const intent = makeEligibleIntent({ ticker: 'AAPL', needsComparison: true });
    expect(service.isQuickResponseEligible(intent)).toBe(false);
  });

  describe('regression: "AMZN vs MSFT revenue FY2024" with ABNB context', () => {
    it('returns false when intent has merged multi-ticker array and needsComparison', () => {
      // Simulates the intent produced by IntentDetectorService when a user in
      // the ABNB workspace asks "AMZN vs MSFT revenue FY2024". The detector
      // merges the context ticker (ABNB) with the query tickers (AMZN, MSFT)
      // and sets needsComparison=true.
      const intent = makeEligibleIntent({
        ticker: ['ABNB', 'AMZN', 'MSFT'],
        needsComparison: true,
        originalQuery: 'AMZN vs MSFT revenue FY2024',
      });
      expect(service.isQuickResponseEligible(intent)).toBe(false);
    });

    it('returns false even if needsComparison is somehow false but ticker array has 2+ elements', () => {
      // Belt-and-suspenders: the multi-ticker guard alone should reject this
      const intent = makeEligibleIntent({
        ticker: ['AMZN', 'MSFT'],
        needsComparison: false,
        originalQuery: 'AMZN vs MSFT revenue FY2024',
      });
      expect(service.isQuickResponseEligible(intent)).toBe(false);
    });
  });
});
