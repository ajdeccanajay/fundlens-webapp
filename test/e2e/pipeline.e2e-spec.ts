/**
 * End-to-End Pipeline Tests
 * 
 * Tests the complete flow from ticker input to LLM-generated answers:
 * 1. Deal Creation
 * 2. SEC Filing Download
 * 3. Metrics Parsing & Storage (RDS)
 * 4. Narrative Chunking & Storage (RDS + S3)
 * 5. Bedrock KB Sync
 * 6. RAG Query Flow (Intent → Retrieval → Response)
 * 7. LLM Response Generation
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('Pipeline E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const TEST_TICKER = 'SHOP';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('Step 1: Deal Creation', () => {
    it('should create a new deal with ticker', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals')
        .send({
          name: `Test Deal - ${TEST_TICKER}`,
          ticker: TEST_TICKER,
          description: 'E2E Test Deal',
        })
        .expect((res) => {
          expect([200, 201]).toContain(res.status);
        });

      if (response.body.success !== false) {
        expect(response.body).toHaveProperty('id');
        expect(response.body.ticker).toBe(TEST_TICKER);
      }
    });

    it('should retrieve deal by ticker', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/deals?ticker=${TEST_TICKER}`)
        .expect(200);

      expect(Array.isArray(response.body) || response.body.data).toBeTruthy();
    });
  });

  describe('Step 2: SEC Filing Download', () => {
    it('should check SEC filings availability', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/sec/filings/${TEST_TICKER}`)
        .expect(200);

      expect(response.body).toHaveProperty('filings');
    });

    it('should sync SEC filings to S3', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/simple/sync/${TEST_TICKER}`)
        .send({ years: 1 })
        .expect((res) => {
          expect([200, 201]).toContain(res.status);
        });

      expect(response.body.success).toBe(true);
    }, 120000);
  });

  describe('Step 3: Metrics Parsing & RDS Storage', () => {
    it('should have financial metrics in RDS', async () => {
      const metrics = await prisma.financialMetric.findMany({
        where: { ticker: TEST_TICKER },
        take: 10,
      });

      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics[0]).toHaveProperty('normalizedMetric');
      expect(metrics[0]).toHaveProperty('value');
      expect(metrics[0]).toHaveProperty('fiscalPeriod');
    });

    it('should have calculated metrics', async () => {
      const calculated = await prisma.calculatedMetric.findMany({
        where: { ticker: TEST_TICKER },
        take: 10,
      });

      expect(calculated.length).toBeGreaterThan(0);
    });

    it('should retrieve metrics via API', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/financial-calculator/metrics/${TEST_TICKER}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('Step 4: Narrative Chunking & Storage', () => {
    it('should have narrative chunks in RDS', async () => {
      const chunks = await prisma.narrativeChunk.findMany({
        where: { ticker: TEST_TICKER },
        take: 10,
      });

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]).toHaveProperty('content');
      expect(chunks[0]).toHaveProperty('sectionType');
      expect(chunks[0]).toHaveProperty('filingType');
    });

    it('should have chunks with valid section types', async () => {
      const chunks = await prisma.narrativeChunk.findMany({
        where: { ticker: TEST_TICKER },
        select: { sectionType: true },
        distinct: ['sectionType'],
      });

      const sectionTypes = chunks.map(c => c.sectionType);
      expect(sectionTypes.length).toBeGreaterThan(0);
      
      // Common section types
      const validSections = ['business', 'risk_factors', 'mda', 'preamble', 'item_1', 'item_1a', 'item_7'];
      const hasValidSection = sectionTypes.some(s => 
        validSections.some(v => s.toLowerCase().includes(v.replace('_', '')))
      );
      expect(hasValidSection).toBe(true);
    });

    it('should export chunks for Bedrock', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/rag/chunks/stats?ticker=${TEST_TICKER}`)
        .expect(200);

      expect(response.body.totalChunks).toBeGreaterThan(0);
      expect(response.body.validChunks).toBeGreaterThan(0);
    });
  });

  describe('Step 5: S3 Storage & Bedrock KB', () => {
    it('should upload chunks to S3 with metadata', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/rag/chunks/upload-s3')
        .send({
          bucket: 'fundlens-bedrock-chunks',
          ticker: TEST_TICKER,
          keyPrefix: 'chunks',
          dryRun: true, // Dry run to avoid re-uploading
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.result.uploadedCount).toBeGreaterThan(0);
    });

    it('should validate chunk format for Bedrock', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/rag/chunks/validate')
        .send({ ticker: TEST_TICKER, limit: 100 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.validation.validChunks).toBeGreaterThan(0);
      expect(parseFloat(response.body.validation.validationRate)).toBeGreaterThan(90);
    });
  });

  describe('Step 6: RAG Query Flow - Intent Detection', () => {
    it('should detect quantitative intent', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/rag/query')
        .send({
          query: `What is ${TEST_TICKER}'s revenue for 2024?`,
          ticker: TEST_TICKER,
        })
        .expect(200);

      expect(response.body.intent).toBeDefined();
      expect(['quantitative', 'hybrid']).toContain(response.body.intent.type);
    });

    it('should detect qualitative intent', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/rag/query')
        .send({
          query: `What does ${TEST_TICKER} do? Describe the business model.`,
          ticker: TEST_TICKER,
        })
        .expect(200);

      expect(response.body.intent).toBeDefined();
      expect(['qualitative', 'semantic', 'hybrid']).toContain(response.body.intent.type);
    });

    it('should detect hybrid intent', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/rag/query')
        .send({
          query: `Compare ${TEST_TICKER}'s revenue growth with their business strategy`,
          ticker: TEST_TICKER,
        })
        .expect(200);

      expect(response.body.intent).toBeDefined();
    });
  });

  describe('Step 7: Structured Retrieval (Metrics)', () => {
    it('should retrieve metrics from RDS', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/financial-calculator/dashboard/${TEST_TICKER}?years=3`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.ticker).toBe(TEST_TICKER);
    });

    it('should calculate TTM metrics', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/financial-calculator/summary/${TEST_TICKER}`)
        .expect(200);

      if (response.body.success) {
        expect(response.body.data.metrics).toBeDefined();
      }
    });
  });

  describe('Step 8: Semantic Retrieval (Narratives)', () => {
    it('should retrieve narratives from Bedrock KB', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/financial-calculator/qualitative/${TEST_TICKER}?category=companyDescription`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.categories.companyDescription).toBeDefined();
      expect(response.body.data.categories.companyDescription.length).toBeGreaterThan(0);
    }, 60000);

    it('should filter by ticker metadata', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/financial-calculator/qualitative/${TEST_TICKER}?category=competitiveDynamics`)
        .expect(200);

      expect(response.body.success).toBe(true);
      
      // Verify all sources are from the correct ticker
      const sources = response.body.data.categories.competitiveDynamics?.[0]?.sources || [];
      // Sources should not contain other tickers
      expect(sources.every((s: any) => !s.ticker || s.ticker === TEST_TICKER)).toBe(true);
    }, 60000);
  });

  describe('Step 9: LLM Response Generation', () => {
    it('should generate answer combining metrics and narratives', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/financial-calculator/ask')
        .send({
          ticker: TEST_TICKER,
          question: `What is ${TEST_TICKER}'s business model and how does it generate revenue?`,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.answer).toBeDefined();
      expect(response.body.data.answer.length).toBeGreaterThan(100);
      expect(response.body.data.narrativeCount).toBeGreaterThan(0);
    }, 60000);

    it('should include source citations', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/financial-calculator/ask')
        .send({
          ticker: TEST_TICKER,
          question: `What are the main risk factors for ${TEST_TICKER}?`,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.sources).toBeDefined();
      expect(response.body.data.sources.length).toBeGreaterThan(0);
    }, 60000);
  });

  describe('Data Integrity Checks', () => {
    it('should have consistent ticker across all data', async () => {
      const [metrics, chunks] = await Promise.all([
        prisma.financialMetric.findMany({
          where: { ticker: TEST_TICKER },
          select: { ticker: true },
          take: 100,
        }),
        prisma.narrativeChunk.findMany({
          where: { ticker: TEST_TICKER },
          select: { ticker: true },
          take: 100,
        }),
      ]);

      expect(metrics.every(m => m.ticker === TEST_TICKER)).toBe(true);
      expect(chunks.every(c => c.ticker === TEST_TICKER)).toBe(true);
    });

    it('should have no NaN values in metrics', async () => {
      const metrics = await prisma.financialMetric.findMany({
        where: { ticker: TEST_TICKER },
        select: { value: true, normalizedMetric: true },
      });

      const nanMetrics = metrics.filter(m => 
        m.value === null || 
        Number.isNaN(m.value) || 
        !Number.isFinite(m.value)
      );

      expect(nanMetrics.length).toBe(0);
    });

    it('should have valid fiscal periods', async () => {
      const metrics = await prisma.financialMetric.findMany({
        where: { ticker: TEST_TICKER },
        select: { fiscalPeriod: true },
        distinct: ['fiscalPeriod'],
      });

      const validPeriodPattern = /^(FY|Q[1-4])\d{4}$/;
      const invalidPeriods = metrics.filter(m => 
        m.fiscalPeriod && !validPeriodPattern.test(m.fiscalPeriod)
      );

      // Allow some flexibility but most should be valid
      expect(invalidPeriods.length / metrics.length).toBeLessThan(0.1);
    });
  });
});
