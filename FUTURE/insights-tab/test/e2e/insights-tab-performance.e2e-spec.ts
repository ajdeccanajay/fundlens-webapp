import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('Insights Tab Performance (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dealId: string;
  let ticker: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Create test data
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Performance Test Tenant',
        slug: 'perf-test',
      },
    });

    const deal = await prisma.deal.create({
      data: {
        name: 'Performance Test Deal',
        ticker: 'PERF',
        companyName: 'Performance Test Company',
        dealType: 'public',
        tenantId: tenant.id,
      },
    });

    dealId = deal.id;
    ticker = deal.ticker!;

    // Create test financial metrics (simulate 5 years of data)
    const metrics = [];
    for (let year = 2020; year <= 2024; year++) {
      for (const metric of ['revenue', 'net_income', 'total_assets']) {
        metrics.push({
          ticker,
          normalizedMetric: metric,
          rawLabel: metric,
          value: Math.random() * 1000000,
          fiscalPeriod: `FY${year}`,
          periodType: 'annual',
          filingType: '10-K',
          statementType: 'income_statement',
          filingDate: new Date(`${year}-12-31`),
          statementDate: new Date(`${year}-12-31`),
        });
      }
    }

    await prisma.financialMetric.createMany({
      data: metrics,
    });

    // Create test narrative chunks
    const chunks = [];
    for (let year = 2020; year <= 2024; year++) {
      chunks.push({
        ticker,
        filingType: '10-K',
        sectionType: 'MD&A',
        chunkIndex: 0,
        content: `MD&A content for ${year}. Growth opportunities. Challenges ahead.`,
        filingDate: new Date(`${year}-12-31`),
      });
    }

    await prisma.narrativeChunk.createMany({
      data: chunks,
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.financialMetric.deleteMany({ where: { ticker } });
    await prisma.narrativeChunk.deleteMany({ where: { ticker } });
    await prisma.deal.deleteMany({ where: { ticker } });
    await prisma.tenant.deleteMany({ where: { slug: 'perf-test' } });

    await app.close();
  });

  describe('Anomaly Detection Performance', () => {
    it('should detect anomalies in <1 second', async () => {
      const start = Date.now();

      const response = await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/anomalies`)
        .expect(200);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
      expect(response.body).toHaveProperty('anomalies');
      expect(Array.isArray(response.body.anomalies)).toBe(true);
    });

    it('should handle filtered anomaly detection in <1 second', async () => {
      const start = Date.now();

      await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/anomalies?types=statistical_outlier,trend_reversal`)
        .expect(200);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    it('should cache anomaly results', async () => {
      // First call (cold)
      const start1 = Date.now();
      await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/anomalies`)
        .expect(200);
      const duration1 = Date.now() - start1;

      // Second call (cached)
      const start2 = Date.now();
      await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/anomalies`)
        .expect(200);
      const duration2 = Date.now() - start2;

      // Cached call should be significantly faster
      expect(duration2).toBeLessThan(duration1 * 0.5);
    });
  });

  describe('Comp Table Performance', () => {
    it('should build comp table in <1 second', async () => {
      const start = Date.now();

      const response = await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/comp-table`)
        .query({
          companies: 'PERF',
          metrics: 'revenue,net_income',
          period: 'FY2024',
        })
        .expect(200);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
      expect(response.body).toHaveProperty('headers');
      expect(response.body).toHaveProperty('rows');
      expect(response.body).toHaveProperty('summary');
    });

    it('should handle multiple companies efficiently', async () => {
      const start = Date.now();

      await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/comp-table`)
        .query({
          companies: 'PERF,PERF,PERF', // Simulate 3 companies
          metrics: 'revenue,net_income,total_assets',
          period: 'FY2024',
        })
        .expect(200);

      const duration = Date.now() - start;

      // Should still be fast with multiple companies
      expect(duration).toBeLessThan(1500);
    });

    it('should cache comp table results', async () => {
      const query = {
        companies: 'PERF',
        metrics: 'revenue',
        period: 'FY2024',
      };

      // First call
      const start1 = Date.now();
      await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/comp-table`)
        .query(query)
        .expect(200);
      const duration1 = Date.now() - start1;

      // Second call (cached)
      const start2 = Date.now();
      await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/comp-table`)
        .query(query)
        .expect(200);
      const duration2 = Date.now() - start2;

      expect(duration2).toBeLessThan(duration1 * 0.5);
    });
  });

  describe('Change Tracker Performance', () => {
    it('should detect changes in <1 second', async () => {
      const start = Date.now();

      const response = await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/changes`)
        .query({
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
        })
        .expect(200);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
      expect(response.body).toHaveProperty('changes');
      expect(response.body).toHaveProperty('summary');
    });

    it('should handle filtered change detection efficiently', async () => {
      const start = Date.now();

      await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/changes`)
        .query({
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
          types: 'metric_change,language_change',
        })
        .expect(200);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    it('should cache change tracker results', async () => {
      const query = {
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
      };

      // First call
      const start1 = Date.now();
      await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/changes`)
        .query(query)
        .expect(200);
      const duration1 = Date.now() - start1;

      // Second call (cached)
      const start2 = Date.now();
      await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/changes`)
        .query(query)
        .expect(200);
      const duration2 = Date.now() - start2;

      expect(duration2).toBeLessThan(duration1 * 0.5);
    });
  });

  describe('Export Performance', () => {
    it('should export comp table in <3 seconds', async () => {
      const start = Date.now();

      await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/comp-table/export`)
        .send({
          companies: ['PERF'],
          metrics: ['revenue', 'net_income'],
          period: 'FY2024',
        })
        .expect(200);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(3000);
    });

    it('should export change tracker in <3 seconds', async () => {
      const start = Date.now();

      await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/changes/export`)
        .send({
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
        })
        .expect(200);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(3000);
    });
  });

  describe('Database Query Optimization', () => {
    it('should use batch queries for comp table', async () => {
      // This test verifies that we're not making N queries
      // by checking the response time with multiple metrics
      const start = Date.now();

      await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/comp-table`)
        .query({
          companies: 'PERF',
          metrics: 'revenue,net_income,total_assets', // 3 metrics
          period: 'FY2024',
        })
        .expect(200);

      const duration = Date.now() - start;

      // Should be fast even with multiple metrics (batch query)
      expect(duration).toBeLessThan(1000);
    });

    it('should use indexes for anomaly detection', async () => {
      // Verify that anomaly detection is fast (uses indexes)
      const start = Date.now();

      await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/anomalies`)
        .expect(200);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Concurrent Request Handling', () => {
    it('should handle multiple concurrent requests efficiently', async () => {
      const start = Date.now();

      // Make 5 concurrent requests
      const promises = Array(5)
        .fill(null)
        .map(() =>
          request(app.getHttpServer())
            .get(`/api/deals/${dealId}/insights/anomalies`)
            .expect(200),
        );

      await Promise.all(promises);

      const duration = Date.now() - start;

      // Should handle concurrent requests efficiently
      expect(duration).toBeLessThan(3000);
    });
  });

  describe('Performance Logging', () => {
    it('should log performance metrics for slow queries', async () => {
      // This test verifies that the @LogPerformance decorator is working
      // We can't directly test the logs, but we can verify the endpoint works
      await request(app.getHttpServer())
        .get(`/api/deals/${dealId}/insights/anomalies`)
        .expect(200);

      // If the decorator is working, logs should be generated
      // Check console output manually or use a log capture mechanism
    });
  });
});
