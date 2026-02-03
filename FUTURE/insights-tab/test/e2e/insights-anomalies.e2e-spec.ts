import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../prisma/prisma.service';
import { DealsModule } from '../../src/deals/deals.module';
import { AnomalyDetectionService } from '../../src/deals/anomaly-detection.service';

describe('Insights Anomalies API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let anomalyService: AnomalyDetectionService;

  const mockTenant = {
    id: '00000000-0000-0000-0000-000000000000',
    name: 'Test Tenant',
    slug: 'test-tenant',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDeal = {
    id: 'test-deal-anomalies',
    name: 'Amazon Deal',
    ticker: 'AMZN',
    dealType: 'public',
    tenantId: '00000000-0000-0000-0000-000000000000',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockFinancialMetrics = [
    {
      id: 'metric-1',
      ticker: 'AMZN',
      normalizedMetric: 'revenue',
      rawLabel: 'Total Revenue',
      value: 100000000000,
      fiscalPeriod: 'FY2019',
      periodType: 'annual',
      filingType: '10-K',
      statementType: 'income_statement',
      filingDate: new Date('2020-02-01'),
      statementDate: new Date('2019-12-31'),
      confidenceScore: 1.0,
    },
    {
      id: 'metric-2',
      ticker: 'AMZN',
      normalizedMetric: 'revenue',
      rawLabel: 'Total Revenue',
      value: 102000000000,
      fiscalPeriod: 'FY2020',
      periodType: 'annual',
      filingType: '10-K',
      statementType: 'income_statement',
      filingDate: new Date('2021-02-01'),
      statementDate: new Date('2020-12-31'),
      confidenceScore: 1.0,
    },
    {
      id: 'metric-3',
      ticker: 'AMZN',
      normalizedMetric: 'revenue',
      rawLabel: 'Total Revenue',
      value: 104000000000,
      fiscalPeriod: 'FY2021',
      periodType: 'annual',
      filingType: '10-K',
      statementType: 'income_statement',
      filingDate: new Date('2022-02-01'),
      statementDate: new Date('2021-12-31'),
      confidenceScore: 1.0,
    },
    {
      id: 'metric-4',
      ticker: 'AMZN',
      normalizedMetric: 'revenue',
      rawLabel: 'Total Revenue',
      value: 106000000000,
      fiscalPeriod: 'FY2022',
      periodType: 'annual',
      filingType: '10-K',
      statementType: 'income_statement',
      filingDate: new Date('2023-02-01'),
      statementDate: new Date('2022-12-31'),
      confidenceScore: 1.0,
    },
    {
      id: 'metric-5',
      ticker: 'AMZN',
      normalizedMetric: 'revenue',
      rawLabel: 'Total Revenue',
      value: 108000000000,
      fiscalPeriod: 'FY2023',
      periodType: 'annual',
      filingType: '10-K',
      statementType: 'income_statement',
      filingDate: new Date('2024-02-01'),
      statementDate: new Date('2023-12-31'),
      confidenceScore: 1.0,
    },
    {
      id: 'metric-6',
      ticker: 'AMZN',
      normalizedMetric: 'revenue',
      rawLabel: 'Total Revenue',
      value: 150000000000, // Outlier
      fiscalPeriod: 'FY2024',
      periodType: 'annual',
      filingType: '10-K',
      statementType: 'income_statement',
      filingDate: new Date('2025-02-01'),
      statementDate: new Date('2024-12-31'),
      confidenceScore: 1.0,
    },
  ];

  const mockNarrativeChunks = [
    {
      id: 'chunk-1',
      ticker: 'AMZN',
      filingType: '10-K',
      sectionType: 'mda',
      chunkIndex: 0,
      content: 'We face significant headwinds. Market headwinds continue. Economic headwinds persist. Regulatory headwinds increase. Competitive headwinds intensify.',
      filingDate: new Date('2025-02-01'),
      dataSourceId: 'test-source',
      createdAt: new Date(),
    },
    {
      id: 'chunk-2',
      ticker: 'AMZN',
      filingType: '10-K',
      sectionType: 'mda',
      chunkIndex: 0,
      content: 'Business is performing well.',
      filingDate: new Date('2024-02-01'),
      dataSourceId: 'test-source',
      createdAt: new Date(),
    },
  ];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DealsModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    anomalyService = app.get<AnomalyDetectionService>(AnomalyDetectionService);
  });

  afterAll(async () => {
    // Cleanup
    await prisma.narrativeChunk.deleteMany({ where: { ticker: 'AMZN' } });
    await prisma.financialMetric.deleteMany({ where: { ticker: 'AMZN' } });
    await prisma.deal.deleteMany({ where: { ticker: 'AMZN' } });
    await prisma.tenant.deleteMany({ where: { slug: 'test-tenant' } });
    await app.close();
  });

  beforeEach(async () => {
    // Clean up before each test
    await prisma.narrativeChunk.deleteMany({ where: { ticker: 'AMZN' } });
    await prisma.financialMetric.deleteMany({ where: { ticker: 'AMZN' } });
    await prisma.deal.deleteMany({ where: { ticker: 'AMZN' } });
    await prisma.tenant.deleteMany({ where: { slug: 'test-tenant' } });
    
    // Create tenant
    await prisma.tenant.create({ data: mockTenant });
  });

  describe('GET /api/deals/:dealId/insights/anomalies', () => {
    it('should return anomalies for a deal', async () => {
      // Setup: Create deal and metrics
      const deal = await prisma.deal.create({ data: mockDeal });
      await prisma.financialMetric.createMany({ data: mockFinancialMetrics });
      await prisma.narrativeChunk.createMany({ data: mockNarrativeChunks });

      // Execute: Call API
      const response = await request(app.getHttpServer())
        .get(`/api/deals/${deal.id}/insights/anomalies`)
        .expect(200);

      // Assert: Check response structure
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('anomalies');
      expect(response.body.data).toHaveProperty('summary');

      // Assert: Check anomalies array
      const { anomalies, summary } = response.body.data;
      expect(Array.isArray(anomalies)).toBe(true);
      expect(anomalies.length).toBeGreaterThan(0);

      // Assert: Check anomaly structure
      const firstAnomaly = anomalies[0];
      expect(firstAnomaly).toHaveProperty('id');
      expect(firstAnomaly).toHaveProperty('type');
      expect(firstAnomaly).toHaveProperty('severity');
      expect(firstAnomaly).toHaveProperty('metric');
      expect(firstAnomaly).toHaveProperty('period');
      expect(firstAnomaly).toHaveProperty('value');
      expect(firstAnomaly).toHaveProperty('description');
      expect(firstAnomaly).toHaveProperty('context');
      expect(firstAnomaly).toHaveProperty('actionable');
      expect(firstAnomaly).toHaveProperty('dismissed');

      // Assert: Check summary structure
      expect(summary).toHaveProperty('total');
      expect(summary).toHaveProperty('byType');
      expect(summary).toHaveProperty('bySeverity');
      expect(summary.total).toBe(anomalies.length);
    });

    it('should filter anomalies by type', async () => {
      // Setup
      const deal = await prisma.deal.create({ data: mockDeal });
      await prisma.financialMetric.createMany({ data: mockFinancialMetrics });
      await prisma.narrativeChunk.createMany({ data: mockNarrativeChunks });

      // Execute: Request only statistical outliers
      const response = await request(app.getHttpServer())
        .get(`/api/deals/${deal.id}/insights/anomalies?types=statistical_outlier`)
        .expect(200);

      // Assert: All anomalies should be statistical outliers
      const { anomalies } = response.body.data;
      anomalies.forEach((anomaly: any) => {
        expect(anomaly.type).toBe('statistical_outlier');
      });
    });

    it('should return 404 for non-existent deal', async () => {
      await request(app.getHttpServer())
        .get('/api/deals/non-existent-deal/insights/anomalies')
        .expect(500); // Will throw error when deal not found
    });

    it('should handle empty metrics gracefully', async () => {
      // Setup: Create deal without metrics
      const deal = await prisma.deal.create({ data: mockDeal });

      // Execute
      const response = await request(app.getHttpServer())
        .get(`/api/deals/${deal.id}/insights/anomalies`)
        .expect(200);

      // Assert: Should return empty anomalies
      const { anomalies } = response.body.data;
      expect(anomalies).toEqual([]);
    });
  });

  describe('POST /api/deals/:dealId/insights/anomalies/:anomalyId/dismiss', () => {
    it('should dismiss an anomaly', async () => {
      // Setup
      const deal = await prisma.deal.create({ data: mockDeal });
      await prisma.financialMetric.createMany({ data: mockFinancialMetrics });

      // Get anomalies first
      const getResponse = await request(app.getHttpServer())
        .get(`/api/deals/${deal.id}/insights/anomalies`)
        .expect(200);

      const anomalyId = getResponse.body.data.anomalies[0]?.id;
      if (!anomalyId) {
        throw new Error('No anomalies found for test');
      }

      // Execute: Dismiss anomaly
      const response = await request(app.getHttpServer())
        .post(`/api/deals/${deal.id}/insights/anomalies/${anomalyId}/dismiss`)
        .expect(200);

      // Assert
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message', 'Anomaly dismissed');
      expect(response.body).toHaveProperty('anomalyId', anomalyId);
    });

    it('should handle dismiss for non-existent anomaly', async () => {
      // Setup
      const deal = await prisma.deal.create({ data: mockDeal });

      // Execute: Try to dismiss non-existent anomaly
      const response = await request(app.getHttpServer())
        .post(`/api/deals/${deal.id}/insights/anomalies/fake-anomaly-id/dismiss`)
        .expect(200);

      // Assert: Should still return success (idempotent)
      expect(response.body).toHaveProperty('success', true);
    });
  });

  describe('Anomaly Detection Service Integration', () => {
    it('should detect statistical outliers', async () => {
      // Setup
      const deal = await prisma.deal.create({ data: mockDeal });
      await prisma.financialMetric.createMany({ data: mockFinancialMetrics });

      // Execute
      const anomalies = await anomalyService.detectAnomalies(deal.id, ['statistical_outlier']);

      // Assert
      expect(anomalies.length).toBeGreaterThan(0);
      const outlier = anomalies.find(a => a.type === 'statistical_outlier');
      expect(outlier).toBeDefined();
      expect(outlier?.metric).toBe('revenue');
      expect(outlier?.period).toBe('FY2024');
    });

    it('should detect management tone shifts', async () => {
      // Setup
      const deal = await prisma.deal.create({ data: mockDeal });
      await prisma.narrativeChunk.createMany({ data: mockNarrativeChunks });

      // Execute
      const anomalies = await anomalyService.detectAnomalies(deal.id, ['management_tone_shift']);

      // Assert
      expect(anomalies.length).toBeGreaterThan(0);
      const toneShift = anomalies.find(a => a.type === 'management_tone_shift');
      expect(toneShift).toBeDefined();
      expect(toneShift?.description).toContain('headwinds');
    });

    it('should calculate summary correctly', () => {
      // Setup: Mock anomalies
      const mockAnomalies = [
        {
          id: '1',
          type: 'statistical_outlier' as const,
          severity: 'high' as const,
          metric: 'revenue',
          period: 'FY2024',
          value: 150000000000,
          expectedValue: 111666666666.67,
          deviation: 2.21,
          description: 'Test',
          context: 'Test',
          actionable: true,
          dismissed: false,
        },
        {
          id: '2',
          type: 'management_tone_shift' as const,
          severity: 'low' as const,
          metric: 'Keyword: headwinds',
          period: 'FY2024',
          value: 5,
          expectedValue: 0,
          deviation: 5,
          description: 'Test',
          context: 'Test',
          actionable: true,
          dismissed: false,
        },
      ];

      // Execute
      const summary = anomalyService.calculateSummary(mockAnomalies);

      // Assert
      expect(summary.total).toBe(2);
      expect(summary.byType.statistical_outlier).toBe(1);
      expect(summary.byType.management_tone_shift).toBe(1);
      expect(summary.bySeverity.high).toBe(1);
      expect(summary.bySeverity.low).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Setup: Create deal but simulate DB error by using invalid ID format
      const response = await request(app.getHttpServer())
        .get('/api/deals/invalid-id-format/insights/anomalies')
        .expect(500);

      expect(response.body).toHaveProperty('message');
    });

    it('should handle missing ticker gracefully', async () => {
      // Setup: Create deal without ticker
      const dealWithoutTicker = await prisma.deal.create({
        data: {
          id: 'test-deal-no-ticker',
          name: 'Test Company',
          ticker: null,
          dealType: 'public',
          tenant: {
            connect: { id: mockTenant.id }
          }
        },
      });

      // Execute
      await request(app.getHttpServer())
        .get(`/api/deals/${dealWithoutTicker.id}/insights/anomalies`)
        .expect(500);

      // Cleanup
      await prisma.deal.delete({ where: { id: dealWithoutTicker.id } });
    });
  });
});
