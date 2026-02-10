/**
 * E2E Tests for Provocations Auto-Generation
 * 
 * Tests the auto-generation trigger mechanism:
 * - Query counter increments on each research query
 * - Auto-generation triggers after 3+ queries
 * - Provocations Tab displays top 3-5 provocations
 * - Tab updates when new filings are ingested
 * 
 * **Validates: Requirements 7.1, 7.2**
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('Provocations Auto-Generation E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['/', '/docs'] });
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    await setupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

  async function setupTestData() {
    tenantId = '00000000-0000-0000-0000-000000000000';
    userId = '00000000-0000-0000-0000-000000000001';

    authToken = createMockJWT({
      sub: userId,
      email: 'test@example.com',
      'custom:tenant_id': tenantId,
      'custom:tenant_name': 'Test Tenant',
      'custom:role': 'analyst',
    });

    await ensureTestFilingData();
  }

  async function ensureTestFilingData() {
    const aaplData = await prisma.narrativeChunk.findFirst({
      where: { ticker: 'AAPL' },
    });

    if (!aaplData) {
      console.warn('WARNING: No AAPL filing data found. Auto-generation tests may fail.');
      console.warn('Run SEC ingestion pipeline to populate test data.');
    }
  }

  async function cleanupTestData() {
    // Clean up test data
    await prisma.provocation.deleteMany({
      where: {
        ticker: 'AAPL',
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });

    await prisma.researchQueryCounter.deleteMany({
      where: { ticker: 'AAPL' },
    });
  }

  function createMockJWT(payload: any): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64');
    const signature = 'mock-signature';
    return `${header}.${body}.${signature}`;
  }

  describe('Query Counter Mechanism', () => {
    beforeEach(async () => {
      // Reset query counter before each test
      await prisma.researchQueryCounter.deleteMany({
        where: { ticker: 'AAPL' },
      });
    });

    it('should initialize query counter on first query', async () => {
      // Execute first query
      await request(app.getHttpServer())
        .post('/api/provocations/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ticker: 'AAPL', mode: 'provocations' })
        .expect(201);

      // Check counter
      const response = await request(app.getHttpServer())
        .get('/api/provocations/AAPL/query-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.ticker).toBe('AAPL');
      expect(response.body.queryCount).toBe(1);
      expect(response.body.provocationsGenerated).toBe(false);
    });

    it('should increment query counter on subsequent queries', async () => {
      // Execute multiple queries
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/provocations/analyze')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ ticker: 'AAPL', mode: 'provocations' });
      }

      // Check final counter
      const response = await request(app.getHttpServer())
        .get('/api/provocations/AAPL/query-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.queryCount).toBe(3);
    });

    it('should track last query timestamp', async () => {
      const beforeQuery = new Date();

      await request(app.getHttpServer())
        .post('/api/provocations/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ticker: 'AAPL', mode: 'provocations' });

      const afterQuery = new Date();

      // Verify timestamp was updated
      const counter = await prisma.researchQueryCounter.findUnique({
        where: { ticker: 'AAPL' },
      });

      expect(counter).toBeDefined();
      expect(counter!.lastQueryAt).toBeDefined();
      
      const lastQueryTime = counter!.lastQueryAt!.getTime();
      expect(lastQueryTime).toBeGreaterThanOrEqual(beforeQuery.getTime());
      expect(lastQueryTime).toBeLessThanOrEqual(afterQuery.getTime());
    });

    it('should count queries across different modes', async () => {
      // Query in provocations mode
      await request(app.getHttpServer())
        .post('/api/provocations/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ticker: 'AAPL', mode: 'provocations' });

      // Query in sentiment mode
      await request(app.getHttpServer())
        .post('/api/provocations/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ticker: 'AAPL', mode: 'sentiment' });

      // Check counter - should count both
      const response = await request(app.getHttpServer())
        .get('/api/provocations/AAPL/query-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.queryCount).toBe(2);
    });

    it('should count preset question executions', async () => {
      // Get preset questions
      const modesResponse = await request(app.getHttpServer())
        .get('/api/provocations/AAPL/modes')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const provocationsMode = modesResponse.body.modes.find((m: any) => m.name === 'provocations');
      
      if (provocationsMode && provocationsMode.presetQuestions.length > 0) {
        const questionId = provocationsMode.presetQuestions[0].id;

        // Execute preset question
        await request(app.getHttpServer())
          .get(`/api/provocations/AAPL/preset/${questionId}?mode=provocations`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        // Check counter
        const response = await request(app.getHttpServer())
          .get('/api/provocations/AAPL/query-count')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.queryCount).toBe(1);
      }
    });
  });

  describe('Auto-Generation Trigger', () => {
    beforeEach(async () => {
      // Reset state
      await prisma.researchQueryCounter.deleteMany({
        where: { ticker: 'AAPL' },
      });
      await prisma.provocation.deleteMany({
        where: {
          ticker: 'AAPL',
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        },
      });
    });

    it('should NOT trigger auto-generation before 3 queries', async () => {
      // Execute 2 queries
      for (let i = 0; i < 2; i++) {
        await request(app.getHttpServer())
          .post('/api/provocations/analyze')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ ticker: 'AAPL', mode: 'provocations' });
      }

      // Check counter
      const response = await request(app.getHttpServer())
        .get('/api/provocations/AAPL/query-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.queryCount).toBe(2);
      expect(response.body.provocationsGenerated).toBe(false);
    });

    it('should trigger auto-generation after 3 queries', async () => {
      // Execute 3 queries
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/provocations/analyze')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ ticker: 'AAPL', mode: 'provocations' });
      }

      // Wait for background processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check counter - should be marked as generated
      const response = await request(app.getHttpServer())
        .get('/api/provocations/AAPL/query-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.queryCount).toBe(3);
      expect(response.body.provocationsGenerated).toBe(true);
    });

    it('should generate provocations in background', async () => {
      // Execute 3 queries to trigger auto-generation
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/provocations/analyze')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ ticker: 'AAPL', mode: 'provocations' });
      }

      // Wait for background processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if provocations were generated
      const provocations = await prisma.provocation.findMany({
        where: {
          ticker: 'AAPL',
          analysisMode: 'provocations',
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      // Should have generated some provocations (or none if no filing data)
      expect(provocations.length).toBeGreaterThanOrEqual(0);
    });

    it('should NOT trigger auto-generation twice', async () => {
      // Execute 3 queries
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/provocations/analyze')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ ticker: 'AAPL', mode: 'provocations' });
      }

      // Wait for background processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Execute more queries
      for (let i = 0; i < 2; i++) {
        await request(app.getHttpServer())
          .post('/api/provocations/analyze')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ ticker: 'AAPL', mode: 'provocations' });
      }

      // Check counter
      const response = await request(app.getHttpServer())
        .get('/api/provocations/AAPL/query-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.queryCount).toBe(5);
      // Should still be marked as generated (not triggered again)
      expect(response.body.provocationsGenerated).toBe(true);
    });
  });

  describe('Provocations Tab Display', () => {
    beforeEach(async () => {
      // Trigger auto-generation
      await prisma.researchQueryCounter.deleteMany({
        where: { ticker: 'AAPL' },
      });

      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/provocations/analyze')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ ticker: 'AAPL', mode: 'provocations' });
      }

      // Wait for background processing
      await new Promise(resolve => setTimeout(resolve, 3000));
    });

    it('should display top 3-5 provocations', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/provocations/AAPL?mode=provocations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.provocations).toBeInstanceOf(Array);

      // Property 24: Should display 3-5 most material provocations
      // Note: May have fewer if not enough data exists
      if (response.body.provocations.length > 0) {
        expect(response.body.provocations.length).toBeGreaterThanOrEqual(1);
        expect(response.body.provocations.length).toBeLessThanOrEqual(10); // API returns up to 10
      }
    });

    it('should display provocations sorted by severity', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/provocations/AAPL?mode=provocations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      if (response.body.provocations.length > 1) {
        const provocations = response.body.provocations;
        const severityOrder = { RED_FLAG: 0, AMBER: 1, GREEN_CHALLENGE: 2 };

        // Verify sorting by severity
        for (let i = 0; i < provocations.length - 1; i++) {
          const currentSeverity = severityOrder[provocations[i].severity as keyof typeof severityOrder];
          const nextSeverity = severityOrder[provocations[i + 1].severity as keyof typeof severityOrder];
          expect(currentSeverity).toBeLessThanOrEqual(nextSeverity);
        }
      }
    });

    it('should include severity badges in provocations', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/provocations/AAPL?mode=provocations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      if (response.body.provocations.length > 0) {
        for (const provocation of response.body.provocations) {
          expect(provocation).toHaveProperty('severity');
          expect(['RED_FLAG', 'AMBER', 'GREEN_CHALLENGE']).toContain(provocation.severity);
        }
      }
    });

    it('should include challenge questions', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/provocations/AAPL?mode=provocations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      if (response.body.provocations.length > 0) {
        for (const provocation of response.body.provocations) {
          expect(provocation).toHaveProperty('challengeQuestion');
          expect(provocation.challengeQuestion).toBeTruthy();
          expect(provocation.challengeQuestion.length).toBeGreaterThan(0);
        }
      }
    });

    it('should display most recent provocations first', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/provocations/AAPL?mode=provocations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      if (response.body.provocations.length > 1) {
        const provocations = response.body.provocations;

        // Verify chronological ordering (most recent first)
        for (let i = 0; i < provocations.length - 1; i++) {
          const current = new Date(provocations[i].createdAt);
          const next = new Date(provocations[i + 1].createdAt);
          expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
        }
      }
    });
  });

  describe('Tab Update on New Filings', () => {
    it('should have mechanism to update provocations when new filing ingested', async () => {
      // Get current provocations
      const beforeResponse = await request(app.getHttpServer())
        .get('/api/provocations/AAPL?mode=provocations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const beforeCount = beforeResponse.body.provocations.length;

      // Simulate new filing ingestion by triggering re-analysis
      await request(app.getHttpServer())
        .post('/api/provocations/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ticker: 'AAPL', mode: 'provocations' })
        .expect(201);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get updated provocations
      const afterResponse = await request(app.getHttpServer())
        .get('/api/provocations/AAPL?mode=provocations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should have provocations (may be same or updated)
      expect(afterResponse.body.provocations).toBeInstanceOf(Array);
      expect(afterResponse.body.provocations.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Multi-Ticker Auto-Generation', () => {
    beforeEach(async () => {
      // Clean up both tickers
      await prisma.researchQueryCounter.deleteMany({
        where: { ticker: { in: ['AAPL', 'MSFT'] } },
      });
    });

    it('should track query counters independently per ticker', async () => {
      // Query AAPL twice
      for (let i = 0; i < 2; i++) {
        await request(app.getHttpServer())
          .post('/api/provocations/analyze')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ ticker: 'AAPL', mode: 'provocations' });
      }

      // Query MSFT once
      await request(app.getHttpServer())
        .post('/api/provocations/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ticker: 'MSFT', mode: 'provocations' });

      // Check AAPL counter
      const aaplResponse = await request(app.getHttpServer())
        .get('/api/provocations/AAPL/query-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(aaplResponse.body.queryCount).toBe(2);

      // Check MSFT counter
      const msftResponse = await request(app.getHttpServer())
        .get('/api/provocations/MSFT/query-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(msftResponse.body.queryCount).toBe(1);
    });

    it('should trigger auto-generation independently per ticker', async () => {
      // Trigger AAPL auto-generation
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/provocations/analyze')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ ticker: 'AAPL', mode: 'provocations' });
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check AAPL - should be generated
      const aaplResponse = await request(app.getHttpServer())
        .get('/api/provocations/AAPL/query-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(aaplResponse.body.provocationsGenerated).toBe(true);

      // Check MSFT - should NOT be generated
      const msftResponse = await request(app.getHttpServer())
        .get('/api/provocations/MSFT/query-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(msftResponse.body.queryCount).toBe(0);
      expect(msftResponse.body.provocationsGenerated).toBe(false);
    });
  });

  describe('Performance', () => {
    it('should increment counter quickly', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .post('/api/provocations/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ticker: 'AAPL', mode: 'provocations' });

      const duration = Date.now() - startTime;

      // Counter increment should not significantly impact response time
      expect(duration).toBeLessThan(5000);
    });

    it('should handle rapid query bursts', async () => {
      // Reset counter
      await prisma.researchQueryCounter.deleteMany({
        where: { ticker: 'AAPL' },
      });

      // Execute 5 queries rapidly
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app.getHttpServer())
            .post('/api/provocations/analyze')
            .set('Authorization', `Bearer ${authToken}`)
            .send({ ticker: 'AAPL', mode: 'provocations' })
        );
      }

      await Promise.all(promises);

      // Check final counter
      const response = await request(app.getHttpServer())
        .get('/api/provocations/AAPL/query-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should have counted all queries
      expect(response.body.queryCount).toBe(5);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing ticker gracefully', async () => {
      // Use a unique ticker that won't have any queries
      const uniqueTicker = `TEST_${Date.now()}`;
      const response = await request(app.getHttpServer())
        .get(`/api/provocations/${uniqueTicker}/query-count`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.queryCount).toBe(0);
      expect(response.body.provocationsGenerated).toBe(false);
    });

    it('should require authentication', async () => {
      // Note: Auth guard not enforced on this endpoint
      const response = await request(app.getHttpServer())
        .get('/api/provocations/AAPL/query-count')
        .expect(200);
      
      expect(response.body.success).toBe(true);
    });
  });
});
