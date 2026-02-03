import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DealsModule } from '../../src/deals/deals.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('Export Insights (E2E) - Task 2.7', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dealId: string;
  const testTicker = 'AAPL';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DealsModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Create test deal
    const deal = await prisma.deal.create({
      data: {
        ticker: testTicker,
        companyName: 'Apple Inc.',
        tenantId: 'test-tenant',
      },
    });
    dealId = deal.id.toString();

    // Create test financial metrics for comp table
    const periods = ['FY2023', 'FY2024'];
    const tickers = ['AAPL', 'MSFT', 'GOOGL'];
    const metrics = ['revenue', 'net_income', 'gross_margin'];

    for (const ticker of tickers) {
      // Ensure deal exists for each ticker
      await prisma.deal.upsert({
        where: { ticker },
        update: {},
        create: {
          ticker,
          companyName: `${ticker} Inc.`,
          tenantId: 'test-tenant',
        },
      });

      for (const period of periods) {
        for (const metric of metrics) {
          await prisma.financialMetric.create({
            data: {
              ticker,
              normalizedMetric: metric,
              rawLabel: metric,
              value: Math.random() * 1000000000,
              reportingUnit: 'millions',
              fiscalPeriod: period,
              periodType: 'annual',
              filingType: '10-K',
              statementType: 'income_statement',
              filingDate: new Date('2024-01-01'),
              confidenceScore: 0.95,
            },
          });
        }
      }
    }

    // Create test narrative chunks for change tracker
    await prisma.narrativeChunk.createMany({
      data: [
        {
          ticker: testTicker,
          sectionType: 'MD&A',
          content: 'Revenue growth was strong in FY2023',
          filingDate: new Date('2023-01-01'),
          fiscalPeriod: 'FY2023',
          filingType: '10-K',
          chunkIndex: 0,
        },
        {
          ticker: testTicker,
          sectionType: 'MD&A',
          content: 'Revenue growth accelerated in FY2024',
          filingDate: new Date('2024-01-01'),
          fiscalPeriod: 'FY2024',
          filingType: '10-K',
          chunkIndex: 0,
        },
        {
          ticker: testTicker,
          sectionType: 'Risk Factors',
          content: 'Cybersecurity risks increased',
          filingDate: new Date('2024-01-01'),
          fiscalPeriod: 'FY2024',
          filingType: '10-K',
          chunkIndex: 1,
        },
      ],
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.financialMetric.deleteMany({
      where: { ticker: { in: ['AAPL', 'MSFT', 'GOOGL'] } },
    });
    await prisma.narrativeChunk.deleteMany({
      where: { ticker: testTicker },
    });
    await prisma.deal.deleteMany({
      where: { ticker: { in: ['AAPL', 'MSFT', 'GOOGL'] } },
    });

    await app.close();
  });

  describe('POST /api/deals/:dealId/insights/comp-table/export', () => {
    it('should export comp table to Excel', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/comp-table/export`)
        .send({
          ticker: testTicker,
          companies: ['AAPL', 'MSFT', 'GOOGL'],
          metrics: ['revenue', 'net_income'],
          period: 'FY2024',
        })
        .expect(200);

      // Check response headers
      expect(response.headers['content-type']).toContain('spreadsheetml.sheet');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('.xlsx');

      // Check that we got a buffer
      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should fail without required parameters', async () => {
      await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/comp-table/export`)
        .send({
          companies: ['AAPL'],
          // Missing metrics and period
        })
        .expect(400);
    });

    it('should fail with empty companies array', async () => {
      await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/comp-table/export`)
        .send({
          ticker: testTicker,
          companies: [],
          metrics: ['revenue'],
          period: 'FY2024',
        })
        .expect(400);
    });

    it('should fail with empty metrics array', async () => {
      await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/comp-table/export`)
        .send({
          ticker: testTicker,
          companies: ['AAPL'],
          metrics: [],
          period: 'FY2024',
        })
        .expect(400);
    });

    it('should handle single company export', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/comp-table/export`)
        .send({
          ticker: testTicker,
          companies: ['AAPL'],
          metrics: ['revenue'],
          period: 'FY2024',
        })
        .expect(200);

      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should handle multiple metrics export', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/comp-table/export`)
        .send({
          ticker: testTicker,
          companies: ['AAPL', 'MSFT'],
          metrics: ['revenue', 'net_income', 'gross_margin'],
          period: 'FY2024',
        })
        .expect(200);

      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/deals/:dealId/insights/changes/export', () => {
    it('should export change tracker to Excel', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/changes/export`)
        .send({
          ticker: testTicker,
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
        })
        .expect(200);

      // Check response headers
      expect(response.headers['content-type']).toContain('spreadsheetml.sheet');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('.xlsx');

      // Check that we got a buffer
      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should fail without required parameters', async () => {
      await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/changes/export`)
        .send({
          ticker: testTicker,
          // Missing fromPeriod and toPeriod
        })
        .expect(400);
    });

    it('should fail without ticker', async () => {
      await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/changes/export`)
        .send({
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
        })
        .expect(400);
    });

    it('should export with type filters', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/changes/export`)
        .send({
          ticker: testTicker,
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
          types: ['metric_change', 'new_disclosure'],
        })
        .expect(200);

      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should export with materiality filter', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/changes/export`)
        .send({
          ticker: testTicker,
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
          materiality: 'high',
        })
        .expect(200);

      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should fail with invalid materiality', async () => {
      await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/changes/export`)
        .send({
          ticker: testTicker,
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
          materiality: 'invalid',
        })
        .expect(400);
    });

    it('should export with combined filters', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/changes/export`)
        .send({
          ticker: testTicker,
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
          types: ['metric_change'],
          materiality: 'medium',
        })
        .expect(200);

      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });

  describe('Excel File Validation', () => {
    it('should generate valid Excel file for comp table', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/comp-table/export`)
        .send({
          ticker: testTicker,
          companies: ['AAPL', 'MSFT'],
          metrics: ['revenue'],
          period: 'FY2024',
        })
        .expect(200);

      // Check Excel file signature (PK header)
      const buffer = response.body;
      expect(buffer[0]).toBe(0x50); // 'P'
      expect(buffer[1]).toBe(0x4b); // 'K'
    });

    it('should generate valid Excel file for change tracker', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/changes/export`)
        .send({
          ticker: testTicker,
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
        })
        .expect(200);

      // Check Excel file signature (PK header)
      const buffer = response.body;
      expect(buffer[0]).toBe(0x50); // 'P'
      expect(buffer[1]).toBe(0x4b); // 'K'
    });

    it('should generate file with reasonable size', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/comp-table/export`)
        .send({
          ticker: testTicker,
          companies: ['AAPL', 'MSFT', 'GOOGL'],
          metrics: ['revenue', 'net_income', 'gross_margin'],
          period: 'FY2024',
        })
        .expect(200);

      // File should be between 5KB and 10MB
      expect(response.body.length).toBeGreaterThan(5000);
      expect(response.body.length).toBeLessThan(10 * 1024 * 1024);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent deal gracefully', async () => {
      await request(app.getHttpServer())
        .post('/api/deals/99999/insights/comp-table/export')
        .send({
          ticker: testTicker,
          companies: ['AAPL'],
          metrics: ['revenue'],
          period: 'FY2024',
        })
        .expect(500);
    });

    it('should handle missing data gracefully', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/deals/${dealId}/insights/comp-table/export`)
        .send({
          ticker: testTicker,
          companies: ['INVALID_TICKER'],
          metrics: ['revenue'],
          period: 'FY2024',
        });

      // Should either return 500 or empty data
      expect([200, 500]).toContain(response.status);
    });
  });
});
