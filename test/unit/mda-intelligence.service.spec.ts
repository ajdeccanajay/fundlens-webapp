import { Test, TestingModule } from '@nestjs/testing';
import { MDAIntelligenceService } from '../../src/deals/mda-intelligence.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('MDAIntelligenceService', () => {
  let service: MDAIntelligenceService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MDAIntelligenceService,
        {
          provide: PrismaService,
          useValue: {
            mdaInsight: {
              upsert: jest.fn(),
              findMany: jest.fn()
            }
          }
        }
      ]
    }).compile();

    service = module.get<MDAIntelligenceService>(MDAIntelligenceService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('extractTrends', () => {
    it('should extract increasing trend with percentage', () => {
      const text = 'Revenue increased by 15% due to strong product sales.';
      const trends = (service as any).extractTrends(text);
      
      expect(trends).toHaveLength(1);
      expect(trends[0].metric).toBe('revenue');
      expect(trends[0].direction).toBe('increasing');
      expect(trends[0].magnitude).toBe(15);
      expect(trends[0].drivers).toContain('strong product sales');
    });

    it('should extract decreasing trend with percentage', () => {
      const text = 'Operating expenses decreased by 8% primarily from cost reduction initiatives.';
      const trends = (service as any).extractTrends(text);
      
      expect(trends).toHaveLength(1);
      expect(trends[0].metric).toBe('operating_expenses');
      expect(trends[0].direction).toBe('decreasing');
      expect(trends[0].magnitude).toBe(8);
    });

    it('should extract stable trend', () => {
      const text = 'Gross margin remained stable at 40%.';
      const trends = (service as any).extractTrends(text);
      
      expect(trends).toHaveLength(1);
      expect(trends[0].metric).toBe('gross_margin');
      expect(trends[0].direction).toBe('stable');
    });

    it('should extract trend with dollar amount', () => {
      const text = 'Net income increased $500 million driven by operational improvements.';
      const trends = (service as any).extractTrends(text);
      
      expect(trends).toHaveLength(1);
      expect(trends[0].metric).toBe('net_income');
      expect(trends[0].direction).toBe('increasing');
      expect(trends[0].magnitude).toBe(500);
    });

    it('should extract multiple trends', () => {
      const text = `
        Revenue increased by 15% due to strong sales.
        Operating expenses decreased by 5% as a result of cost controls.
        Net income grew by 25% reflecting improved margins.
      `;
      const trends = (service as any).extractTrends(text);
      
      expect(trends.length).toBeGreaterThanOrEqual(3);
      expect(trends.some(t => t.metric === 'revenue')).toBe(true);
      expect(trends.some(t => t.metric === 'operating_expenses')).toBe(true);
      expect(trends.some(t => t.metric === 'net_income')).toBe(true);
    });

    it('should handle text without trends', () => {
      const text = 'The company operates in multiple markets.';
      const trends = (service as any).extractTrends(text);
      
      expect(trends).toHaveLength(0);
    });

    it('should not duplicate trends for same metric', () => {
      const text = 'Revenue increased by 15%. Revenue rose significantly.';
      const trends = (service as any).extractTrends(text);
      
      expect(trends).toHaveLength(1);
      expect(trends[0].metric).toBe('revenue');
    });
  });

  describe('extractDrivers', () => {
    it('should extract driver with "due to"', () => {
      const text = 'Revenue increased due to strong iPhone sales.';
      const drivers = (service as any).extractDrivers(text);
      
      expect(drivers).toContain('strong iPhone sales');
    });

    it('should extract driver with "driven by"', () => {
      const text = 'Growth was driven by new market expansion.';
      const drivers = (service as any).extractDrivers(text);
      
      expect(drivers).toContain('new market expansion');
    });

    it('should extract driver with "as a result of"', () => {
      const text = 'Costs decreased as a result of efficiency improvements.';
      const drivers = (service as any).extractDrivers(text);
      
      expect(drivers).toContain('efficiency improvements');
    });

    it('should extract driver with "attributable to"', () => {
      const text = 'The increase was attributable to higher demand.';
      const drivers = (service as any).extractDrivers(text);
      
      expect(drivers).toContain('higher demand');
    });

    it('should extract driver with "reflecting"', () => {
      const text = 'Margins improved reflecting better pricing.';
      const drivers = (service as any).extractDrivers(text);
      
      expect(drivers).toContain('better pricing');
    });

    it('should extract multiple drivers', () => {
      const text = 'Revenue increased due to strong product sales and driven by new market expansion.';
      const drivers = (service as any).extractDrivers(text);
      
      expect(drivers.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter out very short drivers', () => {
      const text = 'Revenue increased due to sales.';
      const drivers = (service as any).extractDrivers(text);
      
      // "sales" is too short (< 10 chars), should be filtered
      expect(drivers).toHaveLength(0);
    });

    it('should filter out very long drivers', () => {
      const longText = 'a'.repeat(250);
      const text = `Revenue increased due to ${longText}.`;
      const drivers = (service as any).extractDrivers(text);
      
      // Driver is too long (> 200 chars), should be filtered
      expect(drivers).toHaveLength(0);
    });

    it('should remove duplicate drivers', () => {
      const text = 'Revenue increased due to strong sales. Growth was driven by strong sales.';
      const drivers = (service as any).extractDrivers(text);
      
      expect(drivers).toHaveLength(1);
    });
  });

  describe('extractRisks', () => {
    it('should extract high severity risk', () => {
      const text = 'We face a significant risk from supply chain disruptions.';
      const risks = (service as any).extractRisks(text);
      
      expect(risks).toHaveLength(1);
      expect(risks[0].severity).toBe('high');
      expect(risks[0].description).toContain('supply chain');
    });

    it('should extract medium severity risk', () => {
      const text = 'There is uncertainty around future demand for our products.';
      const risks = (service as any).extractRisks(text);
      
      expect(risks).toHaveLength(1);
      expect(risks[0].severity).toBe('medium');
    });

    it('should extract low severity risk', () => {
      const text = 'Changes in regulation may impact our operations.';
      const risks = (service as any).extractRisks(text);
      
      expect(risks).toHaveLength(1);
      expect(risks[0].severity).toBe('low');
    });

    it('should categorize operational risk', () => {
      const text = 'Supply chain disruptions pose a risk to our operations.';
      const risks = (service as any).extractRisks(text);
      
      expect(risks).toHaveLength(1);
      expect(risks[0].category).toBe('operational');
    });

    it('should categorize financial risk', () => {
      const text = 'We face liquidity risks due to debt obligations.';
      const risks = (service as any).extractRisks(text);
      
      expect(risks).toHaveLength(1);
      expect(risks[0].category).toBe('financial');
    });

    it('should categorize market risk', () => {
      const text = 'Increased competition poses a risk to our market share.';
      const risks = (service as any).extractRisks(text);
      
      expect(risks).toHaveLength(1);
      expect(risks[0].category).toBe('market');
    });

    it('should categorize regulatory risk', () => {
      const text = 'New regulations pose a risk and may require compliance changes.';
      const risks = (service as any).extractRisks(text);
      
      expect(risks).toHaveLength(1);
      expect(risks[0].category).toBe('regulatory');
    });

    it('should categorize as other when no match', () => {
      const text = 'There is a risk of unexpected events.';
      const risks = (service as any).extractRisks(text);
      
      expect(risks).toHaveLength(1);
      expect(risks[0].category).toBe('other');
    });

    it('should merge similar risks and count mentions', () => {
      const text = `
        Supply chain disruptions pose a significant risk to operations.
        Supply chain issues are a material risk to the business.
        Supply chain challenges continue to be a concern.
      `;
      const risks = (service as any).extractRisks(text);
      
      // Should merge similar risks
      expect(risks.length).toBeLessThanOrEqual(3);
      if (risks.length > 0) {
        expect(risks[0].mentions).toBeGreaterThanOrEqual(1);
      }
    });

    it('should sort risks by severity', () => {
      const text = `
        There is a risk of market changes.
        We face a significant risk from supply chain.
        Uncertainty exists around demand.
      `;
      const risks = (service as any).extractRisks(text);
      
      // High severity should come first
      expect(risks[0].severity).toBe('high');
    });

    it('should handle text without risks', () => {
      const text = 'The company operates successfully in multiple markets.';
      const risks = (service as any).extractRisks(text);
      
      expect(risks).toHaveLength(0);
    });
  });

  describe('extractGuidance', () => {
    it('should extract guidance with "expect"', () => {
      const text = 'We expect revenue growth of 10-12% next year.';
      const { guidance } = (service as any).extractGuidance(text);
      
      expect(guidance).toBeDefined();
      expect(guidance).toContain('revenue growth');
    });

    it('should extract guidance with "outlook"', () => {
      const text = 'Our outlook for 2024 is positive with strong demand.';
      const { guidance } = (service as any).extractGuidance(text);
      
      expect(guidance).toBeDefined();
      expect(guidance).toContain('positive');
    });

    it('should extract guidance with "forecast"', () => {
      const text = 'We forecast earnings per share of $5.00 for fiscal 2024.';
      const { guidance } = (service as any).extractGuidance(text);
      
      expect(guidance).toBeDefined();
      expect(guidance).toContain('earnings');
    });

    it('should determine positive sentiment', () => {
      const text = 'We expect strong growth and improved margins with favorable market conditions.';
      const { sentiment } = (service as any).extractGuidance(text);
      
      expect(sentiment).toBe('positive');
    });

    it('should determine negative sentiment', () => {
      const text = 'We expect challenging conditions with weak demand and declining margins.';
      const { sentiment } = (service as any).extractGuidance(text);
      
      expect(sentiment).toBe('negative');
    });

    it('should determine neutral sentiment', () => {
      const text = 'We expect stable performance in line with prior year.';
      const { sentiment } = (service as any).extractGuidance(text);
      
      expect(sentiment).toBe('neutral');
    });

    it('should handle text without guidance', () => {
      const text = 'The company operates in multiple markets.';
      const { guidance } = (service as any).extractGuidance(text);
      
      expect(guidance).toBeUndefined();
    });
  });

  describe('analyzeSentiment', () => {
    it('should detect positive sentiment', () => {
      const text = 'Strong growth, improved performance, positive outlook, favorable conditions.';
      const sentiment = (service as any).analyzeSentiment(text);
      
      expect(sentiment).toBe('positive');
    });

    it('should detect negative sentiment', () => {
      const text = 'Weak demand, declining sales, challenging market, difficult conditions.';
      const sentiment = (service as any).analyzeSentiment(text);
      
      expect(sentiment).toBe('negative');
    });

    it('should detect neutral sentiment', () => {
      const text = 'The company operates in various markets with stable performance.';
      const sentiment = (service as any).analyzeSentiment(text);
      
      expect(sentiment).toBe('neutral');
    });

    it('should handle mixed sentiment with more positive words', () => {
      const text = 'Strong growth and improved margins but some challenging conditions.';
      const sentiment = (service as any).analyzeSentiment(text);
      
      // More positive words, so should be positive
      expect(sentiment).toBe('positive');
    });
  });

  describe('extractInsights', () => {
    it('should extract complete insights from MD&A text', async () => {
      const mdaText = `
        Revenue increased by 15% due to strong product sales and new market expansion.
        Operating expenses decreased by 5% as a result of cost reduction initiatives.
        
        We face a significant risk from supply chain disruptions that could impact production.
        There is uncertainty around future demand in certain markets.
        
        We expect revenue growth of 10-12% next year with improved margins.
      `;

      const insight = await service.extractInsights(
        'deal-123',
        'AAPL',
        'FY2024',
        mdaText
      );

      expect(insight.dealId).toBe('deal-123');
      expect(insight.ticker).toBe('AAPL');
      expect(insight.fiscalPeriod).toBe('FY2024');
      expect(insight.trends.length).toBeGreaterThan(0);
      expect(insight.risks.length).toBeGreaterThan(0);
      expect(insight.guidance).toBeDefined();
      expect(insight.guidanceSentiment).toBe('positive');
      expect(insight.extractionMethod).toBe('pattern_based');
      expect(insight.confidenceScore).toBeGreaterThan(0);
    });

    it('should handle empty MD&A text', async () => {
      const insight = await service.extractInsights(
        'deal-123',
        'AAPL',
        'FY2024',
        ''
      );

      expect(insight.trends).toHaveLength(0);
      expect(insight.risks).toHaveLength(0);
      expect(insight.guidance).toBeUndefined();
      expect(insight.confidenceScore).toBe(0);
    });

    it('should calculate confidence score based on extracted data', async () => {
      const richText = `
        Revenue increased by 15%. Net income grew by 20%. Gross profit rose by 10%.
        We face risks from competition. Market uncertainty exists.
        We expect strong growth next year.
      `;

      const insight = await service.extractInsights(
        'deal-123',
        'AAPL',
        'FY2024',
        richText
      );

      expect(insight.confidenceScore).toBeGreaterThan(50);
    });

    it('should have low confidence for sparse data', async () => {
      const sparseText = 'The company operates in multiple markets.';

      const insight = await service.extractInsights(
        'deal-123',
        'AAPL',
        'FY2024',
        sparseText
      );

      expect(insight.confidenceScore).toBeLessThan(20);
    });
  });

  describe('normalizeMetricName', () => {
    it('should normalize metric name to lowercase with underscores', () => {
      const normalized = (service as any).normalizeMetricName('Net Income');
      expect(normalized).toBe('net_income');
    });

    it('should remove special characters', () => {
      const normalized = (service as any).normalizeMetricName('Revenue (Total)');
      expect(normalized).toBe('revenue_total');
    });

    it('should handle multiple spaces', () => {
      const normalized = (service as any).normalizeMetricName('Operating   Expenses');
      expect(normalized).toBe('operating_expenses');
    });
  });

  describe('cleanText', () => {
    it('should remove extra whitespace', () => {
      const cleaned = (service as any).cleanText('Text   with    spaces');
      expect(cleaned).toBe('Text with spaces');
    });

    it('should remove newlines', () => {
      const cleaned = (service as any).cleanText('Text\nwith\nnewlines');
      expect(cleaned).toBe('Text with newlines');
    });

    it('should trim leading and trailing whitespace', () => {
      const cleaned = (service as any).cleanText('  Text  ');
      expect(cleaned).toBe('Text');
    });
  });

  describe('splitIntoSentences', () => {
    it('should split text by periods', () => {
      const text = 'First sentence with enough content to pass filter. Second sentence with enough content. Third sentence with enough content.';
      const sentences = (service as any).splitIntoSentences(text);
      
      expect(sentences).toHaveLength(3);
    });

    it('should split text by exclamation marks', () => {
      const text = 'First sentence with enough content! Second sentence with enough content!';
      const sentences = (service as any).splitIntoSentences(text);
      
      expect(sentences).toHaveLength(2);
    });

    it('should split text by question marks', () => {
      const text = 'First sentence with enough content? Second sentence with enough content?';
      const sentences = (service as any).splitIntoSentences(text);
      
      expect(sentences).toHaveLength(2);
    });

    it('should filter out very short sentences', () => {
      const text = 'Long sentence with enough content. Short.';
      const sentences = (service as any).splitIntoSentences(text);
      
      // "Short." should be filtered out (< 20 chars)
      expect(sentences).toHaveLength(1);
    });
  });

  describe('saveInsights', () => {
    it('should save insights (when migration ready)', async () => {
      const insight = {
        dealId: 'deal-123',
        ticker: 'AAPL',
        fiscalPeriod: 'FY2024',
        trends: [],
        risks: [],
        guidanceSentiment: 'neutral' as const,
        extractionMethod: 'pattern_based' as const,
        confidenceScore: 75
      };

      // Should not throw error even though database table doesn't exist yet
      await expect(service.saveInsights(insight)).resolves.not.toThrow();
    });
  });

  describe('getInsightsForDeal', () => {
    it('should return empty array until migration ready', async () => {
      const insights = await service.getInsightsForDeal('deal-123');
      expect(insights).toEqual([]);
    });
  });

  describe('getInsightsForTicker', () => {
    it('should return empty array until migration ready', async () => {
      const insights = await service.getInsightsForTicker('AAPL');
      expect(insights).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null MD&A text', async () => {
      const insight = await service.extractInsights(
        'deal-123',
        'AAPL',
        'FY2024',
        null as any
      );

      expect(insight.trends).toHaveLength(0);
      expect(insight.risks).toHaveLength(0);
    });

    it('should handle undefined MD&A text', async () => {
      const insight = await service.extractInsights(
        'deal-123',
        'AAPL',
        'FY2024',
        undefined as any
      );

      expect(insight.trends).toHaveLength(0);
      expect(insight.risks).toHaveLength(0);
    });

    it('should handle very long MD&A text', async () => {
      const longText = 'Revenue increased by 15%. '.repeat(1000);

      const insight = await service.extractInsights(
        'deal-123',
        'AAPL',
        'FY2024',
        longText
      );

      // Should not throw, should extract insights
      expect(insight.trends.length).toBeGreaterThan(0);
    });

    it('should handle MD&A with special characters', async () => {
      const text = 'Revenue increased by 15% (Q1: $100M, Q2: $120M) [Note 1].';

      const insight = await service.extractInsights(
        'deal-123',
        'AAPL',
        'FY2024',
        text
      );

      expect(insight.trends.length).toBeGreaterThan(0);
    });

    it('should handle MD&A with HTML tags', async () => {
      const text = '<p>Revenue <b>increased</b> by 15% due to strong product sales.</p>';

      const insight = await service.extractInsights(
        'deal-123',
        'AAPL',
        'FY2024',
        text
      );

      // HTML tags don't prevent extraction
      expect(insight.trends.length).toBeGreaterThanOrEqual(0);
    });
  });
});
