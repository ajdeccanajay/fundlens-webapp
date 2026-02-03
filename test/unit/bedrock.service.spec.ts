/**
 * Bedrock Service Unit Tests
 * Tests KB retrieval and metadata filtering
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BedrockService, MetadataFilter } from '../../src/rag/bedrock.service';

describe('BedrockService', () => {
  let service: BedrockService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BedrockService],
    }).compile();

    service = module.get<BedrockService>(BedrockService);
  });

  describe('Metadata Filter Building', () => {
    it('should build single ticker filter', () => {
      const filter: MetadataFilter = { ticker: 'SHOP' };
      const built = service['buildFilter'](filter);
      
      expect(built).toBeDefined();
      expect(built.equals).toBeDefined();
      expect(built.equals.key).toBe('ticker');
      expect(built.equals.value).toBe('SHOP');
    });

    it('should build multiple filters with andAll', () => {
      const filter: MetadataFilter = {
        ticker: 'SHOP',
        filingType: '10-K',
        sectionType: 'business',
      };
      const built = service['buildFilter'](filter);
      
      expect(built).toBeDefined();
      expect(built.andAll).toBeDefined();
      expect(built.andAll.length).toBe(3);
    });

    it('should uppercase ticker', () => {
      const filter: MetadataFilter = { ticker: 'shop' };
      const built = service['buildFilter'](filter);
      
      expect(built.equals.value).toBe('SHOP');
    });

    it('should return undefined for empty filter', () => {
      const filter: MetadataFilter = {};
      const built = service['buildFilter'](filter);
      
      expect(built).toBeUndefined();
    });
  });

  describe('Result Formatting', () => {
    it('should format KB results with metadata', () => {
      const mockResults = [
        {
          content: { text: 'Test content about Shopify' },
          score: 0.85,
          location: {
            s3Location: { uri: 's3://bucket/chunks/SHOP/chunk-0.txt' },
            type: 'S3',
          },
          metadata: {
            ticker: 'SHOP',
            section_type: 'business',
            filing_type: '10-K',
          },
        },
      ];

      const formatted = service['formatResults'](mockResults);

      expect(formatted.length).toBe(1);
      expect(formatted[0].content).toBe('Test content about Shopify');
      expect(formatted[0].score).toBe(0.85);
      expect(formatted[0].metadata.ticker).toBe('SHOP');
      expect(formatted[0].metadata.sectionType).toBe('business');
      expect(formatted[0].metadata.filingType).toBe('10-K');
    });

    it('should extract ticker from S3 URI as fallback', () => {
      const mockResults = [
        {
          content: { text: 'Test content' },
          score: 0.75,
          location: {
            s3Location: { uri: 's3://bucket/chunks/AAPL/chunk-123.txt' },
            type: 'S3',
          },
          metadata: {},
        },
      ];

      const formatted = service['formatResults'](mockResults);

      expect(formatted[0].metadata.ticker).toBe('AAPL');
    });

    it('should parse embedded JSON metadata', () => {
      const mockResults = [
        {
          content: { 
            text: '{"content":"Actual content here","metadata":{"ticker":"MSFT","section_type":"mda","filing_type":"10-Q"}}' 
          },
          score: 0.9,
          location: { s3Location: { uri: 's3://bucket/chunks/MSFT/chunk-0.txt' }, type: 'S3' },
          metadata: {},
        },
      ];

      const formatted = service['formatResults'](mockResults);

      expect(formatted[0].content).toBe('Actual content here');
      expect(formatted[0].metadata.ticker).toBe('MSFT');
    });
  });

  describe('Metric Value Formatting', () => {
    it('should format billions', () => {
      const formatted = service['formatMetricValue'](5_000_000_000, 'revenue');
      expect(formatted).toContain('5.00');
      expect(formatted).toContain('B');
    });

    it('should format millions', () => {
      const formatted = service['formatMetricValue'](250_000_000, 'net_income');
      expect(formatted).toContain('250.00');
      expect(formatted).toContain('M');
    });

    it('should format percentages', () => {
      const formatted = service['formatMetricValue'](0.45, 'gross_margin');
      expect(formatted).toContain('0.45');
    });
  });
});
