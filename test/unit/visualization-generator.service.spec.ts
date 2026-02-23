import { Test, TestingModule } from '@nestjs/testing';
import { VisualizationGeneratorService } from '../../src/rag/visualization-generator.service';
import { QueryIntent, MetricResult } from '../../src/rag/types/query-intent';

/**
 * Unit tests for VisualizationGeneratorService edge cases.
 * Validates: Requirements 1.4
 */

function makeIntent(overrides: Partial<QueryIntent> = {}): QueryIntent {
  return {
    type: 'structured',
    needsNarrative: false,
    needsComparison: false,
    needsComputation: false,
    needsTrend: true,
    confidence: 0.9,
    originalQuery: 'test query',
    ...overrides,
  };
}

function makeMetric(overrides: Partial<MetricResult> = {}): MetricResult {
  return {
    ticker: 'AAPL',
    normalizedMetric: 'revenue',
    rawLabel: 'Revenue',
    value: 1000000,
    fiscalPeriod: 'FY2023',
    periodType: 'annual',
    filingType: '10-K',
    statementType: 'income_statement',
    statementDate: new Date('2023-12-31'),
    filingDate: new Date('2024-02-15'),
    confidenceScore: 0.95,
    ...overrides,
  };
}

describe('VisualizationGeneratorService', () => {
  let service: VisualizationGeneratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VisualizationGeneratorService],
    }).compile();

    service = module.get<VisualizationGeneratorService>(VisualizationGeneratorService);
  });

  describe('edge cases', () => {
    it('should return null for empty metrics array', () => {
      const intent = makeIntent({ needsTrend: true });
      const result = service.generateVisualization(intent, []);
      expect(result).toBeNull();
    });

    it('should return null for single data point', () => {
      const intent = makeIntent({ needsTrend: true });
      const metrics = [makeMetric({ fiscalPeriod: 'FY2023' })];
      const result = service.generateVisualization(intent, metrics);
      expect(result).toBeNull();
    });

    it('should handle mixed period types correctly', () => {
      const intent = makeIntent({ needsTrend: true });
      const metrics = [
        makeMetric({ fiscalPeriod: 'FY2022', periodType: 'annual', value: 500000 }),
        makeMetric({ fiscalPeriod: 'Q1-2023', periodType: 'quarterly', value: 150000 }),
        makeMetric({ fiscalPeriod: 'FY2023', periodType: 'annual', value: 1000000 }),
      ];

      const result = service.generateVisualization(intent, metrics);

      expect(result).not.toBeNull();
      expect(result!.chartType).toBe('line');
      expect(result!.labels).toHaveLength(3);
      // Labels should be sorted chronologically
      expect(result!.labels).toEqual(['FY2022', 'FY2023', 'Q1-2023']);
      expect(result!.datasets[0].data).toHaveLength(3);
    });
  });
});
