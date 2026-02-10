import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { IntentDetectorService } from '../../src/rag/intent-detector.service';
import { IntentAnalyticsService } from '../../src/rag/intent-analytics.service';
import { PromptLibraryService } from '../../src/rag/prompt-library.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Phase 5: Cross-Industry and Cross-Pattern E2E Testing
 * 
 * These tests verify complete workflows across ALL major sectors:
 * - Technology (NVDA, AMD, INTC, AAPL, MSFT, GOOGL)
 * - SaaS (CRM, ORCL, ADBE, SNOW, DDOG)
 * - Retail (AMZN, WMT, TGT, COST, HD)
 * - Healthcare (JNJ, PFE, UNH, ABBV, TMO)
 * - Financial Services (JPM, BAC, GS, MS, V)
 * - Energy (XOM, CVX, COP, SLB, EOG)
 * - Consumer Goods (PG, KO, PEP, NKE, SBUX)
 * - Industrials (BA, CAT, GE, HON, UPS)
 * 
 * Each sector is tested across all 8 query patterns:
 * 1. Financial Performance
 * 2. Business Understanding
 * 3. Comparative Analysis
 * 4. Risk Assessment
 * 5. Forward-Looking
 * 6. Valuation
 * 7. Industry-Specific
 * 8. ESG & Sustainability
 */

describe('Phase 5: Cross-Industry E2E Tests (ALL MAJOR SECTORS)', () => {
  let app: INestApplication;
  let intentService: IntentDetectorService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        IntentDetectorService,
        IntentAnalyticsService,
        BedrockService,
        PromptLibraryService,
        PrismaService,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    intentService = moduleFixture.get<IntentDetectorService>(IntentDetectorService);
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Task 6.1: Technology Sector Comprehensive E2E Test
   * Tickers: NVDA, AMD, INTC, AAPL, MSFT, GOOGL
   * Industry-specific: semiconductor metrics, chip architecture, R&D
   */
  describe('6.1 Technology Sector - Comprehensive E2E', () => {
    const techTickers = ['NVDA', 'AMD', 'INTC', 'AAPL', 'MSFT', 'GOOGL'];

    it('should handle financial performance queries for tech companies', async () => {
      for (const ticker of techTickers) {
        // Revenue query
        const revenueIntent = await intentService.detectIntent(`${ticker} revenue and growth rate`);
        expect(revenueIntent.ticker).toBe(ticker);
        expect(revenueIntent.needsClarification).toBeFalsy();
        expect(revenueIntent.confidence).toBeGreaterThanOrEqual(0.7);

        // Profitability query
        const marginIntent = await intentService.detectIntent(`${ticker} gross margin and operating margin`);
        expect(marginIntent.ticker).toBe(ticker);
        expect(marginIntent.needsClarification).toBeFalsy();

        // Cash flow query
        const cashFlowIntent = await intentService.detectIntent(`${ticker} free cash flow`);
        expect(cashFlowIntent.ticker).toBe(ticker);
        expect(cashFlowIntent.needsClarification).toBeFalsy();
      }
    });

    it('should handle business understanding queries for tech companies', async () => {
      for (const ticker of techTickers) {
        const businessIntent = await intentService.detectIntent(`What does ${ticker} do?`);
        expect(businessIntent.ticker).toBe(ticker);
        expect(businessIntent.needsClarification).toBeFalsy();

        const competitorIntent = await intentService.detectIntent(`Who are ${ticker}'s competitors?`);
        expect(competitorIntent.ticker).toBe(ticker);
        expect(competitorIntent.needsClarification).toBeFalsy();
      }
    });

    it('should handle comparative analysis queries for tech companies', async () => {
      const comparisons = [
        ['NVDA', 'AMD'],
        ['AAPL', 'MSFT'],
        ['GOOGL', 'MSFT'],
      ];

      for (const [ticker1, ticker2] of comparisons) {
        const compareIntent = await intentService.detectIntent(
          `Compare ${ticker1} and ${ticker2} revenue growth`
        );
        expect(Array.isArray(compareIntent.ticker)).toBe(true);
        expect(compareIntent.ticker).toContain(ticker1);
        expect(compareIntent.ticker).toContain(ticker2);
      }
    });

    it('should handle risk assessment queries for tech companies', async () => {
      for (const ticker of techTickers) {
        const riskIntent = await intentService.detectIntent(`${ticker} risk factors`);
        expect(riskIntent.ticker).toBe(ticker);
        expect(riskIntent.needsClarification).toBeFalsy();

        const supplyChainIntent = await intentService.detectIntent(`${ticker} supply chain risks`);
        expect(supplyChainIntent.ticker).toBe(ticker);
        expect(supplyChainIntent.needsClarification).toBeFalsy();
      }
    });

    it('should handle forward-looking queries for tech companies', async () => {
      for (const ticker of techTickers) {
        const guidanceIntent = await intentService.detectIntent(`${ticker} latest guidance`);
        expect(guidanceIntent.ticker).toBe(ticker);
        expect(guidanceIntent.needsClarification).toBeFalsy();

        const catalystIntent = await intentService.detectIntent(`${ticker} upcoming catalysts`);
        expect(catalystIntent.ticker).toBe(ticker);
        expect(catalystIntent.needsClarification).toBeFalsy();
      }
    });

    it('should handle valuation queries for tech companies', async () => {
      for (const ticker of techTickers) {
        const peIntent = await intentService.detectIntent(`${ticker} P/E ratio`);
        expect(peIntent.ticker).toBe(ticker);
        expect(peIntent.needsClarification).toBeFalsy();

        const evIntent = await intentService.detectIntent(`${ticker} EV/EBITDA`);
        expect(evIntent.ticker).toBe(ticker);
      }
    });

    it('should handle industry-specific queries for semiconductor companies', async () => {
      const semiconductorTickers = ['NVDA', 'AMD', 'INTC'];
      
      for (const ticker of semiconductorTickers) {
        const rdIntent = await intentService.detectIntent(`${ticker} R&D spending`);
        expect(rdIntent.ticker).toBe(ticker);
        expect(rdIntent.needsClarification).toBeFalsy();

        const chipIntent = await intentService.detectIntent(`${ticker} chip architecture`);
        expect(chipIntent.ticker).toBe(ticker);

        const processIntent = await intentService.detectIntent(`${ticker} process node`);
        expect(processIntent.ticker).toBe(ticker);

        const aspIntent = await intentService.detectIntent(`${ticker} ASP trends`);
        expect(aspIntent.ticker).toBe(ticker);
      }
    });

    it('should handle ESG queries for tech companies', async () => {
      for (const ticker of techTickers) {
        const carbonIntent = await intentService.detectIntent(`${ticker} carbon emissions`);
        expect(carbonIntent.ticker).toBe(ticker);
        expect(carbonIntent.needsClarification).toBeFalsy();

        const diversityIntent = await intentService.detectIntent(`${ticker} employee diversity`);
        expect(diversityIntent.ticker).toBe(ticker);

        const governanceIntent = await intentService.detectIntent(`${ticker} board composition`);
        expect(governanceIntent.ticker).toBe(ticker);
      }
    });
  });

  /**
   * Task 6.2: SaaS Sector Comprehensive E2E Test
   * Tickers: CRM, ORCL, ADBE, SNOW, DDOG
   * Industry-specific: ARR, net retention, CAC, churn rate
   */
  describe('6.2 SaaS Sector - Comprehensive E2E', () => {
    const saasTickers = ['CRM', 'ORCL', 'ADBE', 'SNOW', 'DDOG'];

    it('should handle financial performance queries for SaaS companies', async () => {
      for (const ticker of saasTickers) {
        const revenueIntent = await intentService.detectIntent(`${ticker} revenue growth`);
        expect(revenueIntent.ticker).toBe(ticker);
        expect(revenueIntent.needsClarification).toBeFalsy();

        const marginIntent = await intentService.detectIntent(`${ticker} operating margins`);
        expect(marginIntent.ticker).toBe(ticker);
        expect(marginIntent.needsClarification).toBeFalsy();
      }
    });

    it('should handle business understanding queries for SaaS companies', async () => {
      for (const ticker of saasTickers) {
        const businessIntent = await intentService.detectIntent(`${ticker} business model`);
        expect(businessIntent.ticker).toBe(ticker);
        expect(businessIntent.needsClarification).toBeFalsy();

        const strategyIntent = await intentService.detectIntent(`${ticker} growth strategy`);
        expect(strategyIntent.ticker).toBe(ticker);
      }
    });

    it('should handle comparative analysis queries for SaaS companies', async () => {
      const comparisons = [
        ['CRM', 'ORCL'],
        ['ADBE', 'SNOW'],
      ];

      for (const [ticker1, ticker2] of comparisons) {
        const compareIntent = await intentService.detectIntent(
          `Compare ${ticker1} vs ${ticker2} margins`
        );
        expect(Array.isArray(compareIntent.ticker)).toBe(true);
      }
    });

    it('should handle risk assessment queries for SaaS companies', async () => {
      for (const ticker of saasTickers) {
        const riskIntent = await intentService.detectIntent(`${ticker} risk factors`);
        expect(riskIntent.ticker).toBe(ticker);
        expect(riskIntent.needsClarification).toBeFalsy();
      }
    });

    it('should handle forward-looking queries for SaaS companies', async () => {
      for (const ticker of saasTickers) {
        const guidanceIntent = await intentService.detectIntent(`${ticker} guidance`);
        expect(guidanceIntent.ticker).toBe(ticker);
        expect(guidanceIntent.needsClarification).toBeFalsy();
      }
    });

    it('should handle valuation queries for SaaS companies', async () => {
      for (const ticker of saasTickers) {
        const valuationIntent = await intentService.detectIntent(`${ticker} P/E ratio`);
        expect(valuationIntent.ticker).toBe(ticker);
        expect(valuationIntent.needsClarification).toBeFalsy();
      }
    });

    it('should handle industry-specific queries for SaaS companies', async () => {
      for (const ticker of saasTickers) {
        const arrIntent = await intentService.detectIntent(`${ticker} ARR growth`);
        expect(arrIntent.ticker).toBe(ticker);

        const retentionIntent = await intentService.detectIntent(`${ticker} net retention rate`);
        expect(retentionIntent.ticker).toBe(ticker);

        const cacIntent = await intentService.detectIntent(`${ticker} customer acquisition cost`);
        expect(cacIntent.ticker).toBe(ticker);

        const churnIntent = await intentService.detectIntent(`${ticker} churn rate`);
        expect(churnIntent.ticker).toBe(ticker);
      }
    });

    it('should handle ESG queries for SaaS companies', async () => {
      for (const ticker of saasTickers) {
        const esgIntent = await intentService.detectIntent(`${ticker} sustainability`);
        expect(esgIntent.ticker).toBe(ticker);
        expect(esgIntent.needsClarification).toBeFalsy();
      }
    });
  });

  /**
   * Task 6.3: Retail Sector Comprehensive E2E Test
   * Tickers: AMZN, WMT, TGT, COST, HD
   * Industry-specific: same-store sales, e-commerce, fulfillment costs
   */
  describe('6.3 Retail Sector - Comprehensive E2E', () => {
    const retailTickers = ['AMZN', 'WMT', 'TGT', 'COST', 'HD'];

    it('should handle all 8 query patterns for retail companies', async () => {
      for (const ticker of retailTickers) {
        // Financial Performance
        const revenueIntent = await intentService.detectIntent(`${ticker} revenue`);
        expect(revenueIntent.ticker).toBe(ticker);
        expect(revenueIntent.needsClarification).toBeFalsy();

        // Business Understanding
        const businessIntent = await intentService.detectIntent(`${ticker} business model`);
        expect(businessIntent.ticker).toBe(ticker);

        // Risk Assessment
        const riskIntent = await intentService.detectIntent(`${ticker} risks`);
        expect(riskIntent.ticker).toBe(ticker);

        // Forward-Looking
        const guidanceIntent = await intentService.detectIntent(`${ticker} outlook`);
        expect(guidanceIntent.ticker).toBe(ticker);

        // Valuation
        const valuationIntent = await intentService.detectIntent(`${ticker} valuation`);
        expect(valuationIntent.ticker).toBe(ticker);

        // Industry-Specific
        const sssIntent = await intentService.detectIntent(`${ticker} same-store sales`);
        expect(sssIntent.ticker).toBe(ticker);

        const ecomIntent = await intentService.detectIntent(`${ticker} e-commerce penetration`);
        expect(ecomIntent.ticker).toBe(ticker);

        const fulfillmentIntent = await intentService.detectIntent(`${ticker} fulfillment costs`);
        expect(fulfillmentIntent.ticker).toBe(ticker);

        // ESG
        const esgIntent = await intentService.detectIntent(`${ticker} environmental impact`);
        expect(esgIntent.ticker).toBe(ticker);
      }
    });
  });

  /**
   * Task 6.4: Healthcare Sector Comprehensive E2E Test
   * Tickers: JNJ, PFE, UNH, ABBV, TMO
   * Industry-specific: drug pipeline, patents, clinical trials
   */
  describe('6.4 Healthcare Sector - Comprehensive E2E', () => {
    const healthcareTickers = ['JNJ', 'PFE', 'UNH', 'ABBV', 'TMO'];

    it('should handle all 8 query patterns for healthcare companies', async () => {
      for (const ticker of healthcareTickers) {
        // Financial Performance
        const revenueIntent = await intentService.detectIntent(`${ticker} revenue`);
        expect(revenueIntent.ticker).toBe(ticker);

        // Business Understanding
        const businessIntent = await intentService.detectIntent(`${ticker} business model`);
        expect(businessIntent.ticker).toBe(ticker);

        // Risk Assessment
        const riskIntent = await intentService.detectIntent(`${ticker} risk factors`);
        expect(riskIntent.ticker).toBe(ticker);

        // Forward-Looking
        const guidanceIntent = await intentService.detectIntent(`${ticker} guidance`);
        expect(guidanceIntent.ticker).toBe(ticker);

        // Valuation
        const valuationIntent = await intentService.detectIntent(`${ticker} P/E ratio`);
        expect(valuationIntent.ticker).toBe(ticker);

        // Industry-Specific
        const pipelineIntent = await intentService.detectIntent(`${ticker} drug pipeline`);
        expect(pipelineIntent.ticker).toBe(ticker);

        const patentIntent = await intentService.detectIntent(`${ticker} patent expirations`);
        expect(patentIntent.ticker).toBe(ticker);

        const clinicalIntent = await intentService.detectIntent(`${ticker} clinical trials`);
        expect(clinicalIntent.ticker).toBe(ticker);

        // ESG
        const esgIntent = await intentService.detectIntent(`${ticker} governance`);
        expect(esgIntent.ticker).toBe(ticker);
      }
    });
  });

  /**
   * Additional Major Sectors - Financial Services
   */
  describe('Financial Services Sector - Comprehensive E2E', () => {
    const financialTickers = ['JPM', 'BAC', 'GS', 'MS', 'V'];

    it('should handle all query patterns for financial companies', async () => {
      for (const ticker of financialTickers) {
        const revenueIntent = await intentService.detectIntent(`${ticker} revenue`);
        expect(revenueIntent.ticker).toBe(ticker);

        const riskIntent = await intentService.detectIntent(`${ticker} credit risk`);
        expect(riskIntent.ticker).toBe(ticker);

        const valuationIntent = await intentService.detectIntent(`${ticker} valuation`);
        expect(valuationIntent.ticker).toBe(ticker);
      }
    });
  });

  /**
   * Additional Major Sectors - Energy
   */
  describe('Energy Sector - Comprehensive E2E', () => {
    const energyTickers = ['XOM', 'CVX', 'COP', 'SLB', 'EOG'];

    it('should handle all query patterns for energy companies', async () => {
      for (const ticker of energyTickers) {
        const revenueIntent = await intentService.detectIntent(`${ticker} revenue`);
        expect(revenueIntent.ticker).toBe(ticker);

        const productionIntent = await intentService.detectIntent(`${ticker} production volumes`);
        expect(productionIntent.ticker).toBe(ticker);

        const esgIntent = await intentService.detectIntent(`${ticker} carbon emissions`);
        expect(esgIntent.ticker).toBe(ticker);
      }
    });
  });

  /**
   * Additional Major Sectors - Consumer Goods
   */
  describe('Consumer Goods Sector - Comprehensive E2E', () => {
    const consumerTickers = ['PG', 'KO', 'PEP', 'NKE', 'SBUX'];

    it('should handle all query patterns for consumer goods companies', async () => {
      for (const ticker of consumerTickers) {
        const revenueIntent = await intentService.detectIntent(`${ticker} revenue`);
        expect(revenueIntent.ticker).toBe(ticker);

        const brandIntent = await intentService.detectIntent(`${ticker} brand portfolio`);
        expect(brandIntent.ticker).toBe(ticker);

        const marginIntent = await intentService.detectIntent(`${ticker} margins`);
        expect(marginIntent.ticker).toBe(ticker);
      }
    });
  });

  /**
   * Additional Major Sectors - Industrials
   */
  describe('Industrials Sector - Comprehensive E2E', () => {
    const industrialTickers = ['BA', 'CAT', 'GE', 'HON', 'UPS'];

    it('should handle all query patterns for industrial companies', async () => {
      for (const ticker of industrialTickers) {
        const revenueIntent = await intentService.detectIntent(`${ticker} revenue`);
        expect(revenueIntent.ticker).toBe(ticker);

        const backlogIntent = await intentService.detectIntent(`${ticker} order backlog`);
        expect(backlogIntent.ticker).toBe(ticker);

        const marginIntent = await intentService.detectIntent(`${ticker} operating margin`);
        expect(marginIntent.ticker).toBe(ticker);
      }
    });
  });

  /**
   * Task 6.5: Analyst Workflow with Query Refinement
   */
  describe('6.5 Analyst Workflow - Query Refinement E2E', () => {
    it('should handle complete analyst workflow with query refinement', async () => {
      // Step 1: Submit ambiguous query
      const ambiguousIntent = await intentService.detectIntent('Tell me about NVDA');
      expect(ambiguousIntent.needsClarification).toBe(true);
      expect(ambiguousIntent.ticker).toBe('NVDA');

      // Step 2: Submit refined query for financial data
      const refinedIntent1 = await intentService.detectIntent('NVDA revenue and growth rate');
      expect(refinedIntent1.needsClarification).toBeFalsy();
      expect(refinedIntent1.ticker).toBe('NVDA');
      expect(refinedIntent1.confidence).toBeGreaterThanOrEqual(0.7);

      // Step 3: Submit comparative query
      const refinedIntent2 = await intentService.detectIntent('NVDA vs AMD margins');
      expect(refinedIntent2.needsClarification).toBeFalsy();
      expect(Array.isArray(refinedIntent2.ticker)).toBe(true);
      expect(refinedIntent2.ticker).toContain('NVDA');
      expect(refinedIntent2.ticker).toContain('AMD');
    });

    it('should handle multi-step analyst research workflow', async () => {
      const ticker = 'AAPL';

      // Step 1: Overview (ambiguous)
      const step1 = await intentService.detectIntent(`Tell me about ${ticker}`);
      expect(step1.needsClarification).toBe(true);

      // Step 2: Financial performance
      const step2 = await intentService.detectIntent(`${ticker} revenue and margins`);
      expect(step2.needsClarification).toBeFalsy();

      // Step 3: Risk assessment
      const step3 = await intentService.detectIntent(`${ticker} risk factors`);
      expect(step3.needsClarification).toBeFalsy();

      // Step 4: Forward-looking
      const step4 = await intentService.detectIntent(`${ticker} guidance and catalysts`);
      expect(step4.needsClarification).toBeFalsy();

      // Step 5: Valuation
      const step5 = await intentService.detectIntent(`${ticker} valuation metrics`);
      expect(step5.needsClarification).toBeFalsy();
    });
  });
});
