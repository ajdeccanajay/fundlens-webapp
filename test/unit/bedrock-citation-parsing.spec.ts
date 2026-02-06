import { Test, TestingModule } from '@nestjs/testing';
import { BedrockService } from '../../src/rag/bedrock.service';
import { PromptLibraryService } from '../../src/rag/prompt-library.service';

describe('BedrockService - Citation Parsing', () => {
  let service: BedrockService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BedrockService,
        {
          provide: PromptLibraryService,
          useValue: {
            getPrompt: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BedrockService>(BedrockService);
  });

  describe('parseCitations', () => {
    it('should extract citation numbers from response', () => {
      const response = `NVIDIA faces supply chain risks [1]. Competition is intensifying [2].`;
      const sourceChunks = [
        {
          content: 'NVIDIA production concentrated at TSMC...',
          score: 0.95,
          metadata: {
            ticker: 'NVDA',
            filingType: '10-K',
            fiscalPeriod: 'FY2024',
            sectionType: 'Risk Factors',
            chunkIndex: 23,
          },
          source: { location: 's3://bucket/chunks/NVDA/chunk-1.txt', type: 's3' },
        },
        {
          content: 'AI accelerator market seeing new entrants...',
          score: 0.92,
          metadata: {
            ticker: 'NVDA',
            filingType: '10-Q',
            fiscalPeriod: 'Q3 2024',
            sectionType: 'MD&A',
            chunkIndex: 45,
          },
          source: { location: 's3://bucket/chunks/NVDA/chunk-2.txt', type: 's3' },
        },
      ];

      // Access private method via reflection
      const citations = (service as any).parseCitations(response, sourceChunks);

      expect(citations).toHaveLength(2);
      expect(citations[0]).toMatchObject({
        number: 1,
        ticker: 'NVDA',
        filingType: '10-K',
        fiscalPeriod: 'FY2024',
        section: 'Risk Factors',
      });
      expect(citations[1]).toMatchObject({
        number: 2,
        ticker: 'NVDA',
        filingType: '10-Q',
        fiscalPeriod: 'Q3 2024',
        section: 'MD&A',
      });
    });

    it('should handle multiple citations in same sentence', () => {
      const response = `NVIDIA faces risks from supply chain [1] and competition [2], [3].`;
      const sourceChunks = [
        {
          content: 'Supply chain content...',
          score: 0.95,
          metadata: {
            ticker: 'NVDA',
            filingType: '10-K',
            fiscalPeriod: 'FY2024',
            sectionType: 'Risk Factors',
          },
          source: { location: 's3://bucket/chunks/NVDA/chunk-1.txt', type: 's3' },
        },
        {
          content: 'Competition content...',
          score: 0.92,
          metadata: {
            ticker: 'NVDA',
            filingType: '10-K',
            fiscalPeriod: 'FY2024',
            sectionType: 'Risk Factors',
          },
          source: { location: 's3://bucket/chunks/NVDA/chunk-2.txt', type: 's3' },
        },
        {
          content: 'More competition content...',
          score: 0.90,
          metadata: {
            ticker: 'NVDA',
            filingType: '10-Q',
            fiscalPeriod: 'Q3 2024',
            sectionType: 'MD&A',
          },
          source: { location: 's3://bucket/chunks/NVDA/chunk-3.txt', type: 's3' },
        },
      ];

      const citations = (service as any).parseCitations(response, sourceChunks);

      expect(citations).toHaveLength(3);
      expect(citations.map((c: any) => c.number)).toEqual([1, 2, 3]);
    });

    it('should handle no citations in response', () => {
      const response = `NVIDIA is a technology company.`;
      const sourceChunks = [
        {
          content: 'Some content...',
          score: 0.95,
          metadata: {
            ticker: 'NVDA',
            filingType: '10-K',
            fiscalPeriod: 'FY2024',
            sectionType: 'Business',
          },
          source: { location: 's3://bucket/chunks/NVDA/chunk-1.txt', type: 's3' },
        },
      ];

      const citations = (service as any).parseCitations(response, sourceChunks);

      expect(citations).toHaveLength(0);
    });

    it('should handle invalid citation numbers gracefully', () => {
      const response = `NVIDIA faces risks [1]. Invalid citation [99].`;
      const sourceChunks = [
        {
          content: 'Risk content...',
          score: 0.95,
          metadata: {
            ticker: 'NVDA',
            filingType: '10-K',
            fiscalPeriod: 'FY2024',
            sectionType: 'Risk Factors',
          },
          source: { location: 's3://bucket/chunks/NVDA/chunk-1.txt', type: 's3' },
        },
      ];

      const citations = (service as any).parseCitations(response, sourceChunks);

      // Should only include valid citation [1], skip [99]
      expect(citations).toHaveLength(1);
      expect(citations[0].number).toBe(1);
    });

    it('should truncate excerpt to 500 characters', () => {
      const longContent = 'A'.repeat(1000);
      const response = `Test citation [1].`;
      const sourceChunks = [
        {
          content: longContent,
          score: 0.95,
          metadata: {
            ticker: 'NVDA',
            filingType: '10-K',
            fiscalPeriod: 'FY2024',
            sectionType: 'Business',
          },
          source: { location: 's3://bucket/chunks/NVDA/chunk-1.txt', type: 's3' },
        },
      ];

      const citations = (service as any).parseCitations(response, sourceChunks);

      expect(citations[0].excerpt).toHaveLength(500);
      expect(citations[0].excerpt).toBe('A'.repeat(500));
    });

    it('should include relevance score from chunk', () => {
      const response = `Test citation [1].`;
      const sourceChunks = [
        {
          content: 'Content...',
          score: 0.87,
          metadata: {
            ticker: 'NVDA',
            filingType: '10-K',
            fiscalPeriod: 'FY2024',
            sectionType: 'Business',
          },
          source: { location: 's3://bucket/chunks/NVDA/chunk-1.txt', type: 's3' },
        },
      ];

      const citations = (service as any).parseCitations(response, sourceChunks);

      expect(citations[0].relevanceScore).toBe(0.87);
    });
  });

  describe('deduplicateNarratives', () => {
    it('should remove duplicate narratives based on content fingerprint', () => {
      const narratives = [
        {
          content: 'NVIDIA faces supply chain concentration risk with over 80% of production at TSMC in Taiwan and this creates significant geopolitical exposure for the company.',
          score: 0.95,
          metadata: { ticker: 'NVDA', filingType: '10-K', fiscalPeriod: 'FY2024', sectionType: 'Risk Factors' },
          source: { location: 's3://bucket/chunks/NVDA/chunk-1.txt', type: 's3' },
        },
        {
          content: 'NVIDIA faces supply chain concentration risk with over 80% of production at TSMC in Taiwan and this is a major concern for investors and stakeholders.',
          score: 0.93,
          metadata: { ticker: 'NVDA', filingType: '10-K', fiscalPeriod: 'FY2024', sectionType: 'Risk Factors' },
          source: { location: 's3://bucket/chunks/NVDA/chunk-2.txt', type: 's3' },
        },
        {
          content: 'Competition in AI accelerators is intensifying with hyperscaler custom chips...',
          score: 0.90,
          metadata: { ticker: 'NVDA', filingType: '10-Q', fiscalPeriod: 'Q3 2024', sectionType: 'MD&A' },
          source: { location: 's3://bucket/chunks/NVDA/chunk-3.txt', type: 's3' },
        },
      ];

      const unique = (service as any).deduplicateNarratives(narratives);

      expect(unique).toHaveLength(2);
      expect(unique[0].content).toContain('supply chain');
      expect(unique[1].content).toContain('Competition');
    });

    it('should keep all narratives if they are unique', () => {
      const narratives = [
        {
          content: 'First unique narrative about supply chain...',
          score: 0.95,
          metadata: { ticker: 'NVDA', filingType: '10-K', fiscalPeriod: 'FY2024', sectionType: 'Risk Factors' },
          source: { location: 's3://bucket/chunks/NVDA/chunk-1.txt', type: 's3' },
        },
        {
          content: 'Second unique narrative about competition...',
          score: 0.93,
          metadata: { ticker: 'NVDA', filingType: '10-Q', fiscalPeriod: 'Q3 2024', sectionType: 'MD&A' },
          source: { location: 's3://bucket/chunks/NVDA/chunk-2.txt', type: 's3' },
        },
      ];

      const unique = (service as any).deduplicateNarratives(narratives);

      expect(unique).toHaveLength(2);
    });
  });

  describe('groupMetricsBySource', () => {
    it('should group metrics by ticker, filing type, and period', () => {
      const metrics = [
        { ticker: 'NVDA', filingType: '10-K', fiscalPeriod: 'FY2024', normalizedMetric: 'Revenue', value: 60000 },
        { ticker: 'NVDA', filingType: '10-K', fiscalPeriod: 'FY2024', normalizedMetric: 'Net Income', value: 15000 },
        { ticker: 'NVDA', filingType: '10-Q', fiscalPeriod: 'Q3 2024', normalizedMetric: 'Revenue', value: 18000 },
      ];

      const grouped = (service as any).groupMetricsBySource(metrics);

      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped['NVDA-10-K-FY2024']).toHaveLength(2);
      expect(grouped['NVDA-10-Q-Q3 2024']).toHaveLength(1);
    });
  });

  describe('undefined fiscalPeriod handling', () => {
    it('should handle undefined fiscalPeriod in narratives gracefully', () => {
      const narratives = [
        {
          content: 'Test content',
          score: 0.9,
          metadata: {
            ticker: 'NVDA',
            filingType: '10-K',
            fiscalPeriod: undefined, // Missing fiscal period
            sectionType: 'risk_factors',
          },
        },
      ];

      const citations = (service as any).parseCitations('[1] Test citation', narratives);

      expect(citations).toHaveLength(1);
      expect(citations[0].fiscalPeriod).toBeUndefined();
      expect(citations[0].ticker).toBe('NVDA');
      expect(citations[0].filingType).toBe('10-K');
    });
  });
});
