import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { DealsModule } from '../../src/deals/deals.module';
import { TenantGuard } from '../../src/tenant/tenant.guard';
import { ChangeTrackerService } from '../../src/deals/change-tracker.service';

describe('Change Tracker API (e2e)', () => {
  let app: INestApplication;
  let changeTrackerService: ChangeTrackerService;

  const mockDeal = {
    id: 'test-deal-id',
    name: 'Test Deal',
    ticker: 'AMZN',
    tenantId: 'test-tenant-id',
  };

  const mockChangeData = {
    changes: [
      {
        id: 'change-1',
        type: 'metric_change' as const,
        category: 'Discontinued Metric',
        description: 'Metric "monthly_active_users" was discontinued',
        materiality: 'high' as const,
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
        fromValue: 100000000,
        toValue: null,
        context: 'Previously reported in FY2023',
      },
      {
        id: 'change-2',
        type: 'new_disclosure' as const,
        category: 'New Section',
        description: 'New section disclosed: Risk Factors',
        materiality: 'high' as const,
        fromPeriod: 'FY2023',
        toPeriod: 'FY2024',
        fromValue: null,
        toValue: 'New cybersecurity risk disclosed',
        context: 'First appearance in FY2024',
        sourceSection: 'Risk Factors',
      },
    ],
    summary: {
      total: 2,
      byType: { metric_change: 1, new_disclosure: 1 },
      byMateriality: { high: 2 },
      byCategory: { 'Discontinued Metric': 1, 'New Section': 1 },
    },
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

    changeTrackerService = moduleFixture.get<ChangeTrackerService>(ChangeTrackerService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /deals/:dealId/insights/changes', () => {
    it('should return changes between two periods', async () => {
      jest.spyOn(changeTrackerService, 'detectChanges').mockResolvedValue(mockChangeData);

      const response = await request(app.getHttpServer())
        .get(`/deals/${mockDeal.id}/insights/changes`)
        .query({
          ticker: 'AMZN',
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
        })
        .expect(HttpStatus.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.changes).toBeInstanceOf(Array);
      expect(response.body.data.summary).toBeDefined();
      expect(response.body.data.summary.total).toBe(2);
    });

    it('should filter changes by type', async () => {
      const filteredData = {
        changes: [mockChangeData.changes[0]], // Only metric_change
        summary: {
          total: 1,
          byType: { metric_change: 1 },
          byMateriality: { high: 1 },
          byCategory: { 'Discontinued Metric': 1 },
        },
      };

      jest.spyOn(changeTrackerService, 'detectChanges').mockResolvedValue(filteredData);

      const response = await request(app.getHttpServer())
        .get(`/deals/${mockDeal.id}/insights/changes`)
        .query({
          ticker: 'AMZN',
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
          types: 'metric_change',
        })
        .expect(HttpStatus.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.changes).toBeInstanceOf(Array);
      expect(response.body.data.changes.length).toBe(1);
      expect(response.body.data.changes[0].type).toBe('metric_change');
    });

    it('should filter changes by materiality', async () => {
      jest.spyOn(changeTrackerService, 'detectChanges').mockResolvedValue(mockChangeData);

      const response = await request(app.getHttpServer())
        .get(`/deals/${mockDeal.id}/insights/changes`)
        .query({
          ticker: 'AMZN',
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
          materiality: 'high',
        })
        .expect(HttpStatus.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.changes).toBeInstanceOf(Array);
    });

    it('should return summary statistics', async () => {
      jest.spyOn(changeTrackerService, 'detectChanges').mockResolvedValue(mockChangeData);

      const response = await request(app.getHttpServer())
        .get(`/deals/${mockDeal.id}/insights/changes`)
        .query({
          ticker: 'AMZN',
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
        })
        .expect(HttpStatus.OK);

      expect(response.body.data.summary).toBeDefined();
      expect(response.body.data.summary.total).toBe(2);
      expect(response.body.data.summary.byType).toBeDefined();
      expect(response.body.data.summary.byMateriality).toBeDefined();
      expect(response.body.data.summary.byCategory).toBeDefined();
    });

    it('should return 400 if ticker is missing', async () => {
      const response = await request(app.getHttpServer())
        .get(`/deals/${mockDeal.id}/insights/changes`)
        .query({
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain('ticker');
    });

    it('should return 400 if fromPeriod is missing', async () => {
      const response = await request(app.getHttpServer())
        .get(`/deals/${mockDeal.id}/insights/changes`)
        .query({
          ticker: 'AMZN',
          toPeriod: 'FY2024',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain('fromPeriod');
    });

    it('should return 400 if toPeriod is missing', async () => {
      const response = await request(app.getHttpServer())
        .get(`/deals/${mockDeal.id}/insights/changes`)
        .query({
          ticker: 'AMZN',
          fromPeriod: 'FY2023',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain('toPeriod');
    });

    it('should return 400 for invalid materiality value', async () => {
      const response = await request(app.getHttpServer())
        .get(`/deals/${mockDeal.id}/insights/changes`)
        .query({
          ticker: 'AMZN',
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
          materiality: 'invalid',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain('materiality');
    });

    it('should handle multiple change types', async () => {
      jest.spyOn(changeTrackerService, 'detectChanges').mockResolvedValue(mockChangeData);

      const response = await request(app.getHttpServer())
        .get(`/deals/${mockDeal.id}/insights/changes`)
        .query({
          ticker: 'AMZN',
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
          types: 'new_disclosure,language_change,metric_change,accounting_change',
        })
        .expect(HttpStatus.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.changes).toBeInstanceOf(Array);
    });

    it('should return empty array for non-existent ticker', async () => {
      const emptyData = {
        changes: [],
        summary: {
          total: 0,
          byType: {},
          byMateriality: {},
          byCategory: {},
        },
      };

      jest.spyOn(changeTrackerService, 'detectChanges').mockResolvedValue(emptyData);

      const response = await request(app.getHttpServer())
        .get(`/deals/${mockDeal.id}/insights/changes`)
        .query({
          ticker: 'NONEXISTENT',
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
        })
        .expect(HttpStatus.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.changes).toEqual([]);
      expect(response.body.data.summary.total).toBe(0);
    });

    it('should handle deal ID in path', async () => {
      jest.spyOn(changeTrackerService, 'detectChanges').mockResolvedValue(mockChangeData);

      const response = await request(app.getHttpServer())
        .get(`/deals/different-deal-id/insights/changes`)
        .query({
          ticker: 'AMZN',
          fromPeriod: 'FY2023',
          toPeriod: 'FY2024',
        })
        .expect(HttpStatus.OK);

      expect(response.body.success).toBe(true);
    });
  });
});
