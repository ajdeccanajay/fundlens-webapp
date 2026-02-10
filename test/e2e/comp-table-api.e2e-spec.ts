import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { DealsModule } from '../../src/deals/deals.module';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantGuard } from '../../src/tenant/tenant.guard';

describe('Comp Table API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const mockDeal = {
    id: 'test-deal-1',
    ticker: 'AMZN',
    companyName: 'Amazon',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDeal2 = {
    id: 'test-deal-2',
    ticker: 'GOOGL',
    companyName: 'Alphabet',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DealsModule],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /deals/:dealId/insights/comp-table', () => {
    it('should return comp table for multiple companies', async () => {
      // Mock Prisma responses
      jest.spyOn(prisma.deal, 'findFirst')
        .mockResolvedValueOnce(mockDeal as any)
        .mockResolvedValueOnce(mockDeal2 as any);

      jest.spyOn(prisma.financialMetric, 'findFirst')
        .mockResolvedValueOnce({
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: 574785000000,
          statementType: 'income_statement',
        } as any)
        .mockResolvedValueOnce({
          ticker: 'GOOGL',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: 307394000000,
          statementType: 'income_statement',
        } as any);

      const response = await request(app.getHttpServer())
        .get('/deals/test-deal-1/insights/comp-table')
        .query({
          companies: 'AMZN,GOOGL',
          metrics: 'revenue',
          period: 'FY2024',
        })
        .expect(HttpStatus.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.rows).toHaveLength(2);
      expect(response.body.data.headers).toContain('revenue');
      expect(response.body.data.summary).toBeDefined();
    });

    it('should return 400 if companies parameter is missing', async () => {
      const response = await request(app.getHttpServer())
        .get('/deals/test-deal-1/insights/comp-table')
        .query({
          metrics: 'revenue',
          period: 'FY2024',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain('Missing required parameters');
    });

    it('should return 400 if metrics parameter is missing', async () => {
      const response = await request(app.getHttpServer())
        .get('/deals/test-deal-1/insights/comp-table')
        .query({
          companies: 'AMZN,GOOGL',
          period: 'FY2024',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain('Missing required parameters');
    });

    it('should return 400 if period parameter is missing', async () => {
      const response = await request(app.getHttpServer())
        .get('/deals/test-deal-1/insights/comp-table')
        .query({
          companies: 'AMZN,GOOGL',
          metrics: 'revenue',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain('Missing required parameters');
    });

    it('should return 400 if companies list is empty', async () => {
      const response = await request(app.getHttpServer())
        .get('/deals/test-deal-1/insights/comp-table')
        .query({
          companies: '',
          metrics: 'revenue',
          period: 'FY2024',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain('At least one company ticker is required');
    });

    it('should return 400 if metrics list is empty', async () => {
      const response = await request(app.getHttpServer())
        .get('/deals/test-deal-1/insights/comp-table')
        .query({
          companies: 'AMZN,GOOGL',
          metrics: '',
          period: 'FY2024',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain('At least one metric is required');
    });

    it('should handle multiple metrics', async () => {
      jest.spyOn(prisma.deal, 'findFirst').mockResolvedValue(mockDeal as any);

      jest.spyOn(prisma.financialMetric, 'findFirst')
        .mockResolvedValueOnce({
          ticker: 'AMZN',
          normalizedMetric: 'revenue',
          fiscalPeriod: 'FY2024',
          value: 574785000000,
        } as any)
        .mockResolvedValueOnce({
          ticker: 'AMZN',
          normalizedMetric: 'gross_profit',
          fiscalPeriod: 'FY2024',
          value: 270458000000,
        } as any);

      const response = await request(app.getHttpServer())
        .get('/deals/test-deal-1/insights/comp-table')
        .query({
          companies: 'AMZN',
          metrics: 'revenue,gross_profit',
          period: 'FY2024',
        })
        .expect(HttpStatus.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.headers).toContain('revenue');
      expect(response.body.data.headers).toContain('gross_profit');
    });

    it('should trim whitespace from company tickers', async () => {
      jest.spyOn(prisma.deal, 'findFirst').mockResolvedValue(mockDeal as any);

      jest.spyOn(prisma.financialMetric, 'findFirst').mockResolvedValue({
        ticker: 'AMZN',
        normalizedMetric: 'revenue',
        fiscalPeriod: 'FY2024',
        value: 574785000000,
      } as any);

      const response = await request(app.getHttpServer())
        .get('/deals/test-deal-1/insights/comp-table')
        .query({
          companies: ' AMZN , GOOGL ',
          metrics: 'revenue',
          period: 'FY2024',
        })
        .expect(HttpStatus.OK);

      expect(response.body.success).toBe(true);
    });

    it('should return 500 if service throws error', async () => {
      jest.spyOn(prisma.deal, 'findFirst').mockRejectedValue(new Error('Database error'));

      await request(app.getHttpServer())
        .get('/deals/test-deal-1/insights/comp-table')
        .query({
          companies: 'AMZN',
          metrics: 'revenue',
          period: 'FY2024',
        })
        .expect(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('POST /deals/:dealId/insights/comp-table/export', () => {
    it('should accept export request with valid data', async () => {
      jest.spyOn(prisma.deal, 'findFirst').mockResolvedValue(mockDeal as any);

      jest.spyOn(prisma.financialMetric, 'findFirst').mockResolvedValue({
        ticker: 'AMZN',
        normalizedMetric: 'revenue',
        fiscalPeriod: 'FY2024',
        value: 574785000000,
      } as any);

      const response = await request(app.getHttpServer())
        .post('/deals/test-deal-1/insights/comp-table/export')
        .send({
          companies: ['AMZN', 'GOOGL'],
          metrics: ['revenue', 'gross_profit'],
          period: 'FY2024',
        })
        .expect(HttpStatus.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Task 2.7');
    });

    it('should return 400 if companies is missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/deals/test-deal-1/insights/comp-table/export')
        .send({
          metrics: ['revenue'],
          period: 'FY2024',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain('Missing required parameters');
    });

    it('should return 400 if metrics is missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/deals/test-deal-1/insights/comp-table/export')
        .send({
          companies: ['AMZN'],
          period: 'FY2024',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain('Missing required parameters');
    });

    it('should return 400 if period is missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/deals/test-deal-1/insights/comp-table/export')
        .send({
          companies: ['AMZN'],
          metrics: ['revenue'],
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain('Missing required parameters');
    });

    it('should return 400 if companies array is empty', async () => {
      const response = await request(app.getHttpServer())
        .post('/deals/test-deal-1/insights/comp-table/export')
        .send({
          companies: [],
          metrics: ['revenue'],
          period: 'FY2024',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain('At least one company ticker is required');
    });

    it('should return 400 if metrics array is empty', async () => {
      const response = await request(app.getHttpServer())
        .post('/deals/test-deal-1/insights/comp-table/export')
        .send({
          companies: ['AMZN'],
          metrics: [],
          period: 'FY2024',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain('At least one metric is required');
    });

    it('should return 500 if service throws error', async () => {
      jest.spyOn(prisma.deal, 'findFirst').mockRejectedValue(new Error('Database error'));

      await request(app.getHttpServer())
        .post('/deals/test-deal-1/insights/comp-table/export')
        .send({
          companies: ['AMZN'],
          metrics: ['revenue'],
          period: 'FY2024',
        })
        .expect(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });
});
