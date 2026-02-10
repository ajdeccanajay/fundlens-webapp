import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FilingNotificationController } from '../../src/filings/filing-notification.controller';
import { FilingNotificationService } from '../../src/filings/filing-notification.service';
import { FilingDetectionScheduler } from '../../src/filings/filing-detection-scheduler.service';
import { TenantGuard } from '../../src/tenant/tenant.guard';
import { TENANT_CONTEXT_KEY, TenantContext, getPermissionsForRole } from '../../src/tenant/tenant-context';
import { NotFoundException } from '@nestjs/common';

/**
 * E2E Tests for Filing Notification API Endpoints
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/filings/notifications (tenant-scoped)
 * - GET /api/filings/notifications/count (tenant-scoped)
 * - DELETE /api/filings/notifications/:id (tenant-scoped)
 * - POST /api/filings/detect (admin only)
 * - GET /api/filings/detection-status (admin only)
 * - GET /api/filings/detection-summary (admin only)
 */

function createTenantContext(
  tenantId: string,
  role: 'admin' | 'analyst' | 'viewer' = 'analyst',
): TenantContext {
  return {
    tenantId,
    tenantSlug: `slug-${tenantId}`,
    tenantTier: 'pro',
    userId: `user-${tenantId}`,
    userEmail: `user@${tenantId}.com`,
    userRole: role,
    permissions: getPermissionsForRole(role),
    isPlatformAdmin: false,
  };
}

/**
 * Creates a mock TenantGuard that injects a specific tenant context
 * into the request, simulating authenticated requests.
 */
function createMockTenantGuard(tenantContext: TenantContext) {
  return {
    canActivate: (context) => {
      const req = context.switchToHttp().getRequest();
      req[TENANT_CONTEXT_KEY] = tenantContext;
      return true;
    },
  };
}

describe('Filing Notifications E2E', () => {
  let app: INestApplication;

  const mockNotificationService = {
    getNotifications: jest.fn(),
    getNotificationCount: jest.fn(),
    dismissNotification: jest.fn(),
  };

  const mockDetectionScheduler = {
    triggerDetectionForTicker: jest.fn(),
    getDetectionStatus: jest.fn(),
    getDetectionSummary: jest.fn(),
  };

  // Default tenant context for most tests
  let currentTenantContext: TenantContext;

  async function createApp(tenantContext: TenantContext): Promise<INestApplication> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [FilingNotificationController],
      providers: [
        {
          provide: FilingNotificationService,
          useValue: mockNotificationService,
        },
        {
          provide: FilingDetectionScheduler,
          useValue: mockDetectionScheduler,
        },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue(createMockTenantGuard(tenantContext))
      .compile();

    const app = moduleFixture.createNestApplication();
    await app.init();
    return app;
  }

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    jest.clearAllMocks();
  });

  // ============================================================
  // 5.3.1 Test GET notifications
  // ============================================================
  describe('GET /api/filings/notifications', () => {
    it('should return 200 with notifications for authenticated tenant', async () => {
      currentTenantContext = createTenantContext('tenant-1');
      app = await createApp(currentTenantContext);

      const mockNotifications = [
        {
          id: 'notif-1',
          tenantId: 'tenant-1',
          ticker: 'AAPL',
          filingType: '10-K',
          filingDate: '2024-11-01T00:00:00.000Z',
          reportDate: '2024-09-30T00:00:00.000Z',
          accessionNumber: '0000320193-24-000123',
          dismissed: false,
          createdAt: '2024-11-02T06:00:00.000Z',
        },
      ];

      mockNotificationService.getNotifications.mockResolvedValue(mockNotifications);

      const response = await request(app.getHttpServer())
        .get('/api/filings/notifications')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(1);
      expect(response.body.notifications).toHaveLength(1);
      expect(response.body.notifications[0].ticker).toBe('AAPL');
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        'tenant-1',
        { dismissed: false, limit: 50 },
      );
    });

    it('should pass dismissed=true query parameter', async () => {
      currentTenantContext = createTenantContext('tenant-1');
      app = await createApp(currentTenantContext);

      mockNotificationService.getNotifications.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/api/filings/notifications?dismissed=true')
        .expect(200);

      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        'tenant-1',
        { dismissed: true, limit: 50 },
      );
    });

    it('should pass custom limit query parameter', async () => {
      currentTenantContext = createTenantContext('tenant-1');
      app = await createApp(currentTenantContext);

      mockNotificationService.getNotifications.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/api/filings/notifications?limit=10')
        .expect(200);

      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        'tenant-1',
        { dismissed: false, limit: 10 },
      );
    });

    it('should return empty array when no notifications exist', async () => {
      currentTenantContext = createTenantContext('tenant-1');
      app = await createApp(currentTenantContext);

      mockNotificationService.getNotifications.mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get('/api/filings/notifications')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(0);
      expect(response.body.notifications).toEqual([]);
    });

    it('should return notification count', async () => {
      currentTenantContext = createTenantContext('tenant-1');
      app = await createApp(currentTenantContext);

      mockNotificationService.getNotificationCount.mockResolvedValue(7);

      const response = await request(app.getHttpServer())
        .get('/api/filings/notifications/count')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(7);
    });
  });

  // ============================================================
  // 5.3.2 Test DELETE notification
  // ============================================================
  describe('DELETE /api/filings/notifications/:id', () => {
    it('should return 200 when notification is dismissed successfully', async () => {
      currentTenantContext = createTenantContext('tenant-1');
      app = await createApp(currentTenantContext);

      mockNotificationService.dismissNotification.mockResolvedValue(undefined);

      const response = await request(app.getHttpServer())
        .delete('/api/filings/notifications/notif-1')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Notification dismissed');
      expect(mockNotificationService.dismissNotification).toHaveBeenCalledWith(
        'notif-1',
        'tenant-1',
      );
    });

    it('should return 404 when notification not found or wrong tenant', async () => {
      currentTenantContext = createTenantContext('tenant-1');
      app = await createApp(currentTenantContext);

      mockNotificationService.dismissNotification.mockRejectedValue(
        new NotFoundException('Notification not found'),
      );

      const response = await request(app.getHttpServer())
        .delete('/api/filings/notifications/nonexistent-id')
        .expect(404);

      expect(response.body.statusCode).toBe(404);
    });
  });

  // ============================================================
  // 5.3.3 Test tenant isolation
  // ============================================================
  describe('Tenant Isolation', () => {
    it('tenant A should only see tenant A notifications', async () => {
      const tenantAContext = createTenantContext('tenant-a');
      app = await createApp(tenantAContext);

      const tenantANotifications = [
        { id: 'notif-a1', tenantId: 'tenant-a', ticker: 'AAPL', filingType: '10-K' },
      ];

      mockNotificationService.getNotifications.mockResolvedValue(tenantANotifications);

      const response = await request(app.getHttpServer())
        .get('/api/filings/notifications')
        .expect(200);

      expect(response.body.notifications).toHaveLength(1);
      expect(response.body.notifications[0].tenantId).toBe('tenant-a');
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        'tenant-a',
        expect.any(Object),
      );
    });

    it('tenant B should only see tenant B notifications', async () => {
      const tenantBContext = createTenantContext('tenant-b');
      app = await createApp(tenantBContext);

      const tenantBNotifications = [
        { id: 'notif-b1', tenantId: 'tenant-b', ticker: 'MSFT', filingType: '10-Q' },
      ];

      mockNotificationService.getNotifications.mockResolvedValue(tenantBNotifications);

      const response = await request(app.getHttpServer())
        .get('/api/filings/notifications')
        .expect(200);

      expect(response.body.notifications).toHaveLength(1);
      expect(response.body.notifications[0].tenantId).toBe('tenant-b');
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        'tenant-b',
        expect.any(Object),
      );
    });

    it('tenant A cannot dismiss tenant B notification (service enforces ownership)', async () => {
      const tenantAContext = createTenantContext('tenant-a');
      app = await createApp(tenantAContext);

      // Service throws NotFoundException because notification belongs to tenant B
      mockNotificationService.dismissNotification.mockRejectedValue(
        new NotFoundException('Notification not found'),
      );

      const response = await request(app.getHttpServer())
        .delete('/api/filings/notifications/notif-belongs-to-tenant-b')
        .expect(404);

      // Verify the controller passed tenant A's ID to the service
      expect(mockNotificationService.dismissNotification).toHaveBeenCalledWith(
        'notif-belongs-to-tenant-b',
        'tenant-a',
      );
    });

    it('notification count is scoped to requesting tenant', async () => {
      // Tenant A has 5 notifications
      const tenantAContext = createTenantContext('tenant-a');
      app = await createApp(tenantAContext);

      mockNotificationService.getNotificationCount.mockResolvedValue(5);

      const responseA = await request(app.getHttpServer())
        .get('/api/filings/notifications/count')
        .expect(200);

      expect(responseA.body.count).toBe(5);
      expect(mockNotificationService.getNotificationCount).toHaveBeenCalledWith('tenant-a');
    });
  });

  // ============================================================
  // 5.3.4 Test admin endpoints
  // ============================================================
  describe('Admin Endpoints', () => {
    describe('POST /api/filings/detect', () => {
      it('should trigger detection and return result', async () => {
        const adminContext = createTenantContext('tenant-1', 'admin');
        app = await createApp(adminContext);

        const mockResult = {
          ticker: 'AAPL',
          newFilings: 2,
          errors: [],
        };

        mockDetectionScheduler.triggerDetectionForTicker.mockResolvedValue(mockResult);

        const response = await request(app.getHttpServer())
          .post('/api/filings/detect')
          .send({ ticker: 'AAPL' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.result.ticker).toBe('AAPL');
        expect(response.body.result.newFilings).toBe(2);
        expect(mockDetectionScheduler.triggerDetectionForTicker).toHaveBeenCalledWith('AAPL');
      });

      it('should return detection errors in result', async () => {
        const adminContext = createTenantContext('tenant-1', 'admin');
        app = await createApp(adminContext);

        const mockResult = {
          ticker: 'INVALID',
          newFilings: 0,
          errors: ['CIK not found for ticker INVALID'],
        };

        mockDetectionScheduler.triggerDetectionForTicker.mockResolvedValue(mockResult);

        const response = await request(app.getHttpServer())
          .post('/api/filings/detect')
          .send({ ticker: 'INVALID' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.result.errors).toContain('CIK not found for ticker INVALID');
      });
    });

    describe('GET /api/filings/detection-status', () => {
      it('should return detection states for all tickers', async () => {
        const adminContext = createTenantContext('tenant-1', 'admin');
        app = await createApp(adminContext);

        const mockStates = [
          {
            ticker: 'AAPL',
            lastCheckDate: '2024-11-01T06:00:00.000Z',
            lastFilingDate: '2024-10-30T00:00:00.000Z',
            checkCount: 10,
            consecutiveFailures: 0,
          },
          {
            ticker: 'MSFT',
            lastCheckDate: '2024-11-01T06:00:00.000Z',
            lastFilingDate: null,
            checkCount: 5,
            consecutiveFailures: 1,
          },
        ];

        mockDetectionScheduler.getDetectionStatus.mockResolvedValue(mockStates);

        const response = await request(app.getHttpServer())
          .get('/api/filings/detection-status')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.count).toBe(2);
        expect(response.body.states).toHaveLength(2);
        expect(response.body.states[0].ticker).toBe('AAPL');
        expect(response.body.states[1].ticker).toBe('MSFT');
      });

      it('should return empty array when no detection states exist', async () => {
        const adminContext = createTenantContext('tenant-1', 'admin');
        app = await createApp(adminContext);

        mockDetectionScheduler.getDetectionStatus.mockResolvedValue([]);

        const response = await request(app.getHttpServer())
          .get('/api/filings/detection-status')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.count).toBe(0);
        expect(response.body.states).toEqual([]);
      });
    });

    describe('GET /api/filings/detection-summary', () => {
      it('should return detection summary', async () => {
        const adminContext = createTenantContext('tenant-1', 'admin');
        app = await createApp(adminContext);

        const mockSummary = {
          trackedTickers: 15,
          tickersWithState: 12,
          lastCheckDate: '2024-11-01T06:00:00.000Z',
          tickersNeverChecked: 3,
          tickersWithFailures: 1,
        };

        mockDetectionScheduler.getDetectionSummary.mockResolvedValue(mockSummary);

        const response = await request(app.getHttpServer())
          .get('/api/filings/detection-summary')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.summary.trackedTickers).toBe(15);
        expect(response.body.summary.tickersWithState).toBe(12);
        expect(response.body.summary.tickersNeverChecked).toBe(3);
        expect(response.body.summary.tickersWithFailures).toBe(1);
      });

      it('should handle empty summary when no tickers tracked', async () => {
        const adminContext = createTenantContext('tenant-1', 'admin');
        app = await createApp(adminContext);

        const mockSummary = {
          trackedTickers: 0,
          tickersWithState: 0,
          lastCheckDate: null,
          tickersNeverChecked: 0,
          tickersWithFailures: 0,
        };

        mockDetectionScheduler.getDetectionSummary.mockResolvedValue(mockSummary);

        const response = await request(app.getHttpServer())
          .get('/api/filings/detection-summary')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.summary.trackedTickers).toBe(0);
        expect(response.body.summary.lastCheckDate).toBeNull();
      });
    });
  });
});
