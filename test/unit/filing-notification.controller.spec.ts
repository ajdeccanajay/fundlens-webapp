import { Test, TestingModule } from '@nestjs/testing';
import { FilingNotificationController } from '../../src/filings/filing-notification.controller';
import { FilingNotificationService } from '../../src/filings/filing-notification.service';
import { FilingDetectionScheduler } from '../../src/filings/filing-detection-scheduler.service';
import { TenantGuard } from '../../src/tenant/tenant.guard';
import { TENANT_CONTEXT_KEY, TenantContext, getPermissionsForRole } from '../../src/tenant/tenant-context';

function createTenantContext(
  tenantId: string,
  role: 'admin' | 'analyst' | 'viewer' = 'analyst',
): TenantContext {
  return {
    tenantId,
    tenantSlug: 'test-tenant',
    tenantTier: 'pro',
    userId: `user-${tenantId}`,
    userEmail: `user@${tenantId}.com`,
    userRole: role,
    permissions: getPermissionsForRole(role),
    isPlatformAdmin: false,
  };
}

function createMockRequest(tenantContext: TenantContext): any {
  return {
    [TENANT_CONTEXT_KEY]: tenantContext,
  };
}

describe('FilingNotificationController', () => {
  let controller: FilingNotificationController;
  let notificationService: FilingNotificationService;
  let detectionScheduler: FilingDetectionScheduler;

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
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
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<FilingNotificationController>(FilingNotificationController);
    notificationService = module.get<FilingNotificationService>(FilingNotificationService);
    detectionScheduler = module.get<FilingDetectionScheduler>(FilingDetectionScheduler);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================================
  // 5.3.1 Test GET notifications
  // ============================================================
  describe('GET /api/filings/notifications', () => {
    it('should return notifications for the authenticated tenant', async () => {
      const tenantContext = createTenantContext('tenant-1');
      const req = createMockRequest(tenantContext);

      const mockNotifications = [
        {
          id: 'notif-1',
          tenantId: 'tenant-1',
          ticker: 'AAPL',
          filingType: '10-K',
          filingDate: new Date('2024-11-01'),
          dismissed: false,
          createdAt: new Date(),
        },
        {
          id: 'notif-2',
          tenantId: 'tenant-1',
          ticker: 'MSFT',
          filingType: '10-Q',
          filingDate: new Date('2024-10-15'),
          dismissed: false,
          createdAt: new Date(),
        },
      ];

      mockNotificationService.getNotifications.mockResolvedValue(mockNotifications);

      const result = await controller.getNotifications(req);

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.notifications).toEqual(mockNotifications);
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        'tenant-1',
        { dismissed: false, limit: 50 },
      );
    });

    it('should pass dismissed=true query parameter', async () => {
      const tenantContext = createTenantContext('tenant-1');
      const req = createMockRequest(tenantContext);

      mockNotificationService.getNotifications.mockResolvedValue([]);

      await controller.getNotifications(req, 'true');

      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        'tenant-1',
        { dismissed: true, limit: 50 },
      );
    });

    it('should pass custom limit query parameter', async () => {
      const tenantContext = createTenantContext('tenant-1');
      const req = createMockRequest(tenantContext);

      mockNotificationService.getNotifications.mockResolvedValue([]);

      await controller.getNotifications(req, undefined, '10');

      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        'tenant-1',
        { dismissed: false, limit: 10 },
      );
    });

    it('should extract tenantId from TENANT_CONTEXT_KEY', async () => {
      const tenantContext = createTenantContext('specific-tenant-id');
      const req = createMockRequest(tenantContext);

      mockNotificationService.getNotifications.mockResolvedValue([]);

      await controller.getNotifications(req);

      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        'specific-tenant-id',
        expect.any(Object),
      );
    });

    it('should return notification count', async () => {
      const tenantContext = createTenantContext('tenant-1');
      const req = createMockRequest(tenantContext);

      mockNotificationService.getNotificationCount.mockResolvedValue(5);

      const result = await controller.getNotificationCount(req);

      expect(result.success).toBe(true);
      expect(result.count).toBe(5);
      expect(mockNotificationService.getNotificationCount).toHaveBeenCalledWith('tenant-1');
    });
  });

  // ============================================================
  // 5.3.2 Test DELETE notification
  // ============================================================
  describe('DELETE /api/filings/notifications/:id', () => {
    it('should dismiss a notification for the authenticated tenant', async () => {
      const tenantContext = createTenantContext('tenant-1');
      const req = createMockRequest(tenantContext);

      mockNotificationService.dismissNotification.mockResolvedValue(undefined);

      const result = await controller.dismissNotification(req, 'notif-1');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Notification dismissed');
      expect(mockNotificationService.dismissNotification).toHaveBeenCalledWith(
        'notif-1',
        'tenant-1',
      );
    });

    it('should pass the correct tenantId for ownership verification', async () => {
      const tenantContext = createTenantContext('tenant-abc');
      const req = createMockRequest(tenantContext);

      mockNotificationService.dismissNotification.mockResolvedValue(undefined);

      await controller.dismissNotification(req, 'notif-xyz');

      expect(mockNotificationService.dismissNotification).toHaveBeenCalledWith(
        'notif-xyz',
        'tenant-abc',
      );
    });
  });

  // ============================================================
  // 5.3.3 Test tenant isolation
  // ============================================================
  describe('Tenant Isolation', () => {
    it('tenant A request should only query tenant A notifications', async () => {
      const tenantAContext = createTenantContext('tenant-a');
      const reqA = createMockRequest(tenantAContext);

      mockNotificationService.getNotifications.mockResolvedValue([]);

      await controller.getNotifications(reqA);

      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        'tenant-a',
        expect.any(Object),
      );
    });

    it('tenant B request should only query tenant B notifications', async () => {
      const tenantBContext = createTenantContext('tenant-b');
      const reqB = createMockRequest(tenantBContext);

      mockNotificationService.getNotifications.mockResolvedValue([]);

      await controller.getNotifications(reqB);

      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        'tenant-b',
        expect.any(Object),
      );
    });

    it('dismiss passes correct tenantId for cross-tenant protection', async () => {
      const tenantAContext = createTenantContext('tenant-a');
      const reqA = createMockRequest(tenantAContext);

      mockNotificationService.dismissNotification.mockResolvedValue(undefined);

      // Tenant A tries to dismiss a notification - service will verify ownership
      await controller.dismissNotification(reqA, 'notif-from-tenant-b');

      // Controller passes tenant A's ID - service layer enforces ownership
      expect(mockNotificationService.dismissNotification).toHaveBeenCalledWith(
        'notif-from-tenant-b',
        'tenant-a',
      );
    });

    it('notification count is scoped to the requesting tenant', async () => {
      const tenantAContext = createTenantContext('tenant-a');
      const reqA = createMockRequest(tenantAContext);

      mockNotificationService.getNotificationCount.mockResolvedValue(3);

      const result = await controller.getNotificationCount(reqA);

      expect(result.count).toBe(3);
      expect(mockNotificationService.getNotificationCount).toHaveBeenCalledWith('tenant-a');
    });
  });

  // ============================================================
  // 5.3.4 Test admin endpoints
  // ============================================================
  describe('Admin Endpoints', () => {
    describe('POST /api/filings/detect', () => {
      it('should trigger detection for a ticker', async () => {
        const adminContext = createTenantContext('tenant-1', 'admin');
        const req = createMockRequest(adminContext);

        const mockResult = {
          ticker: 'AAPL',
          newFilings: 2,
          errors: [],
        };

        mockDetectionScheduler.triggerDetectionForTicker.mockResolvedValue(mockResult);

        const result = await controller.triggerDetection(req, { ticker: 'AAPL' });

        expect(result.success).toBe(true);
        expect(result.result).toEqual(mockResult);
        expect(mockDetectionScheduler.triggerDetectionForTicker).toHaveBeenCalledWith('AAPL');
      });
    });

    describe('GET /api/filings/detection-status', () => {
      it('should return detection states for all tickers', async () => {
        const adminContext = createTenantContext('tenant-1', 'admin');
        const req = createMockRequest(adminContext);

        const mockStates = [
          {
            ticker: 'AAPL',
            lastCheckDate: new Date('2024-11-01'),
            lastFilingDate: new Date('2024-10-30'),
            checkCount: 10,
            consecutiveFailures: 0,
          },
          {
            ticker: 'MSFT',
            lastCheckDate: new Date('2024-11-01'),
            lastFilingDate: null,
            checkCount: 5,
            consecutiveFailures: 1,
          },
        ];

        mockDetectionScheduler.getDetectionStatus.mockResolvedValue(mockStates);

        const result = await controller.getDetectionStatus(req);

        expect(result.success).toBe(true);
        expect(result.count).toBe(2);
        expect(result.states).toEqual(mockStates);
      });
    });

    describe('GET /api/filings/detection-summary', () => {
      it('should return detection summary', async () => {
        const adminContext = createTenantContext('tenant-1', 'admin');
        const req = createMockRequest(adminContext);

        const mockSummary = {
          trackedTickers: 15,
          tickersWithState: 12,
          lastCheckDate: new Date('2024-11-01'),
          tickersNeverChecked: 3,
          tickersWithFailures: 1,
        };

        mockDetectionScheduler.getDetectionSummary.mockResolvedValue(mockSummary);

        const result = await controller.getDetectionSummary(req);

        expect(result.success).toBe(true);
        expect(result.summary).toEqual(mockSummary);
      });
    });
  });
});
