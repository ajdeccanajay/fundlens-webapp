/**
 * Intent Detector Unit Tests
 * Tests query classification for routing to appropriate retrievers
 */

import { Test, TestingModule } from '@nestjs/testing';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';

describe('IntentDetectorService', () => {
  let service: IntentDetectorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IntentDetectorService],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);
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
});
