import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';

/**
 * Unit tests for ticker extraction edge cases (T1.2, T1.3, T1.4).
 * Validates Requirements 6.4, 6.5: ticker regex + companies table filtering
 * correctly extracts real tickers and rejects financial acronyms.
 */
describe('IntentDetectorService — ticker edge cases', () => {
  let service: IntentDetectorService;

  // Known tickers that should be recognized
  const KNOWN_TICKERS = new Set([
    'COIN', 'MSFT', 'AAPL', 'GOOGL', 'AMZN', 'META', 'NVDA',
    'ABNB', 'BKNG', 'EXPE', 'TRIP', 'TSLA', 'NFLX',
  ]);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentDetectorService,
        { provide: BedrockService, useValue: {} },
        { provide: IntentAnalyticsService, useValue: {} },
        { provide: MetricRegistryService, useValue: {} },
      ],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);

    // Inject the knownTickers set directly (bypasses DB load)
    (service as any).knownTickers = KNOWN_TICKERS;
  });

  it('T1.2: "COIN gross margin FY2024" → extracts COIN', () => {
    const result = (service as any).extractTickersFromQuery('COIN gross margin FY2024');
    expect(result).toEqual(['COIN']);
  });

  it('T1.3: "GAAP vs non-GAAP operating income for MSFT" → extracts only MSFT', () => {
    const result = (service as any).extractTickersFromQuery(
      'GAAP vs non-GAAP operating income for MSFT',
    );
    expect(result).toEqual(['MSFT']);
    expect(result).not.toContain('GAAP');
  });

  it('T1.4: "What did the 10-K say about risks?" → extracts no tickers', () => {
    const result = (service as any).extractTickersFromQuery(
      'What did the 10-K say about risks?',
    );
    expect(result).toEqual([]);
  });
});
