import { Test, TestingModule } from '@nestjs/testing';
import { FilingNotificationService } from '../../src/filings/filing-notification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DistributedLockService } from '../../src/common/distributed-lock.service';
import { NotFoundException } from '@nestjs/common';

describe('FilingNotificationService', () => {
  let service: FilingNotificationService;
  let prisma: PrismaService;

  const mockPrismaService = {
    deal: {
      findMany: jest.fn(),
    },
    filingNotification: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  // Lock always acquired in tests — withLock executes the callback
  const mockLockService = {
    withLock: jest.fn().mockImplementation((_key: string, cb: () => Promise<any>) => cb()),
    tryAcquire: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilingNotificationService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: DistributedLockService,
          useValue: mockLockService,
        },
      ],
    }).compile();

    service = module.get<FilingNotificationService>(FilingNotificationService);
    prisma = module.get<PrismaService>(PrismaService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // 4.3.1 Test notification creation
  // ============================================================
  describe('createNotifications', () => {
    it('should create notifications for all tenants with deals for the ticker', async () => {
      const ticker = 'AAPL';
      const filing = {
        form: '10-K',
        filingDate: new Date('2024-11-01'),
        reportDate: new Date('2024-09-30'),
        accessionNumber: '0000320193-24-000123',
      };

      const mockDeals = [
        { tenantId: 'tenant-1' },
        { tenantId: 'tenant-2' },
        { tenantId: 'tenant-3' },
      ];

      mockPrismaService.deal.findMany.mockResolvedValue(mockDeals);
      mockPrismaService.filingNotification.create.mockResolvedValue({
        id: 'notification-1',
        tenantId: 'tenant-1',
        ticker,
        filingType: filing.form,
        filingDate: filing.filingDate,
        reportDate: filing.reportDate,
        accessionNumber: filing.accessionNumber,
        dismissed: false,
        createdAt: new Date(),
      });

      const count = await service.createNotifications(ticker, filing);

      expect(count).toBe(3);
      expect(mockPrismaService.deal.findMany).toHaveBeenCalledWith({
        where: { ticker },
        select: { tenantId: true },
        distinct: ['tenantId'],
      });
      expect(mockPrismaService.filingNotification.create).toHaveBeenCalledTimes(3);

      // Verify each tenant gets a notification with correct data
      for (const deal of mockDeals) {
        expect(mockPrismaService.filingNotification.create).toHaveBeenCalledWith({
          data: {
            tenantId: deal.tenantId,
            ticker,
            filingType: filing.form,
            filingDate: filing.filingDate,
            reportDate: filing.reportDate,
            accessionNumber: filing.accessionNumber,
            dismissed: false,
          },
        });
      }
    });

    it('should return 0 if no tenants have deals for the ticker', async () => {
      const ticker = 'UNKNOWN';
      const filing = {
        form: '10-K',
        filingDate: new Date('2024-11-01'),
        reportDate: null,
        accessionNumber: '0000320193-24-000123',
      };

      mockPrismaService.deal.findMany.mockResolvedValue([]);

      const count = await service.createNotifications(ticker, filing);

      expect(count).toBe(0);
      expect(mockPrismaService.filingNotification.create).not.toHaveBeenCalled();
    });

    it('should create audit log entries for each tenant notification', async () => {
      const ticker = 'MSFT';
      const filing = {
        form: '10-Q',
        filingDate: new Date('2024-10-15'),
        reportDate: new Date('2024-09-30'),
        accessionNumber: '0000789019-24-000456',
      };

      mockPrismaService.deal.findMany.mockResolvedValue([
        { tenantId: 'tenant-a' },
        { tenantId: 'tenant-b' },
      ]);
      mockPrismaService.filingNotification.create.mockResolvedValue({
        id: 'notif-1',
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.createNotifications(ticker, filing);

      // Verify audit logs created for each tenant
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledTimes(2);
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'filing_notification.create',
          details: expect.objectContaining({
            tenantId: 'tenant-a',
            ticker: 'MSFT',
            filingType: '10-Q',
          }),
        }),
      });
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'filing_notification.create',
          details: expect.objectContaining({
            tenantId: 'tenant-b',
            ticker: 'MSFT',
            filingType: '10-Q',
          }),
        }),
      });
    });

    it('should handle filing with null reportDate', async () => {
      const ticker = 'AMZN';
      const filing = {
        form: '8-K',
        filingDate: new Date('2024-12-01'),
        reportDate: null,
        accessionNumber: '0001018724-24-000789',
      };

      mockPrismaService.deal.findMany.mockResolvedValue([
        { tenantId: 'tenant-1' },
      ]);
      mockPrismaService.filingNotification.create.mockResolvedValue({
        id: 'notif-1',
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const count = await service.createNotifications(ticker, filing);

      expect(count).toBe(1);
      expect(mockPrismaService.filingNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reportDate: null,
        }),
      });
    });
  });

  // ============================================================
  // 4.3.2 Test tenant isolation
  // ============================================================
  describe('tenant isolation', () => {
    it('tenant A cannot see tenant B notifications via getNotifications', async () => {
      const tenantA = 'tenant-a';
      const tenantB = 'tenant-b';

      // Tenant A's notifications
      const tenantANotifications = [
        {
          id: 'notif-a1',
          tenantId: tenantA,
          ticker: 'AAPL',
          filingType: '10-K',
          filingDate: new Date('2024-11-01'),
          dismissed: false,
          createdAt: new Date(),
        },
      ];

      // When tenant A queries, only tenant A's notifications are returned
      mockPrismaService.filingNotification.findMany.mockResolvedValue(
        tenantANotifications,
      );
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const resultA = await service.getNotifications(tenantA);

      // Verify the query filters by tenantId
      expect(mockPrismaService.filingNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: tenantA,
          }),
        }),
      );

      // All returned notifications belong to tenant A
      expect(resultA.every((n) => n.tenantId === tenantA)).toBe(true);

      // When tenant B queries, different results
      jest.clearAllMocks();
      mockPrismaService.filingNotification.findMany.mockResolvedValue([]);
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const resultB = await service.getNotifications(tenantB);

      expect(mockPrismaService.filingNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: tenantB,
          }),
        }),
      );
      expect(resultB).toEqual([]);
    });

    it('tenant A cannot dismiss tenant B notification', async () => {
      const tenantA = 'tenant-a';
      const tenantBNotificationId = 'notif-b1';

      // findFirst returns null because notification belongs to tenant B, not tenant A
      mockPrismaService.filingNotification.findFirst.mockResolvedValue(null);
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await expect(
        service.dismissNotification(tenantBNotificationId, tenantA),
      ).rejects.toThrow(NotFoundException);

      // Verify the query checked both id AND tenantId
      expect(mockPrismaService.filingNotification.findFirst).toHaveBeenCalledWith({
        where: {
          id: tenantBNotificationId,
          tenantId: tenantA,
        },
      });

      // Verify update was NOT called (notification not dismissed)
      expect(mockPrismaService.filingNotification.update).not.toHaveBeenCalled();

      // Verify denial was audit logged
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'filing_notification.dismiss_denied',
          details: expect.objectContaining({
            tenantId: tenantA,
            notificationId: tenantBNotificationId,
            reason: 'not_found_or_wrong_tenant',
          }),
        }),
      });
    });

    it('getNotificationCount only counts notifications for the specified tenant', async () => {
      const tenantA = 'tenant-a';

      mockPrismaService.filingNotification.count.mockResolvedValue(3);

      const count = await service.getNotificationCount(tenantA);

      expect(count).toBe(3);
      expect(mockPrismaService.filingNotification.count).toHaveBeenCalledWith({
        where: {
          tenantId: tenantA,
          dismissed: false,
        },
      });
    });

    it('createNotifications creates separate notifications per tenant', async () => {
      const ticker = 'AAPL';
      const filing = {
        form: '10-K',
        filingDate: new Date('2024-11-01'),
        reportDate: new Date('2024-09-30'),
        accessionNumber: '0000320193-24-000123',
      };

      // Both tenant A and tenant B have deals for AAPL
      mockPrismaService.deal.findMany.mockResolvedValue([
        { tenantId: 'tenant-a' },
        { tenantId: 'tenant-b' },
      ]);
      mockPrismaService.filingNotification.create.mockResolvedValue({
        id: 'notif-1',
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const count = await service.createNotifications(ticker, filing);

      expect(count).toBe(2);

      // Verify separate notification created for each tenant
      expect(mockPrismaService.filingNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId: 'tenant-a' }),
      });
      expect(mockPrismaService.filingNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId: 'tenant-b' }),
      });
    });
  });

  // ============================================================
  // 4.3.3 Test dismissal logic
  // ============================================================
  describe('dismissNotification', () => {
    it('should dismiss a notification if it belongs to the tenant', async () => {
      const notificationId = 'notification-1';
      const tenantId = 'tenant-1';

      mockPrismaService.filingNotification.findFirst.mockResolvedValue({
        id: notificationId,
        tenantId,
        ticker: 'AAPL',
        filingType: '10-K',
        dismissed: false,
      });

      mockPrismaService.filingNotification.update.mockResolvedValue({
        id: notificationId,
        dismissed: true,
        dismissedAt: new Date(),
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.dismissNotification(notificationId, tenantId);

      // Verify ownership check
      expect(mockPrismaService.filingNotification.findFirst).toHaveBeenCalledWith({
        where: {
          id: notificationId,
          tenantId,
        },
      });

      // Verify update sets dismissed flag and timestamp
      expect(mockPrismaService.filingNotification.update).toHaveBeenCalledWith({
        where: { id: notificationId },
        data: { dismissed: true, dismissedAt: expect.any(Date) },
      });
    });

    it('should throw NotFoundException if notification does not belong to tenant', async () => {
      const notificationId = 'notification-1';
      const tenantId = 'tenant-1';

      mockPrismaService.filingNotification.findFirst.mockResolvedValue(null);
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await expect(
        service.dismissNotification(notificationId, tenantId),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrismaService.filingNotification.update).not.toHaveBeenCalled();
    });

    it('should set dismissedAt timestamp when dismissing', async () => {
      const notificationId = 'notification-1';
      const tenantId = 'tenant-1';
      const beforeDismiss = new Date();

      mockPrismaService.filingNotification.findFirst.mockResolvedValue({
        id: notificationId,
        tenantId,
        ticker: 'AAPL',
        filingType: '10-K',
        dismissed: false,
      });
      mockPrismaService.filingNotification.update.mockResolvedValue({
        id: notificationId,
        dismissed: true,
        dismissedAt: new Date(),
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.dismissNotification(notificationId, tenantId);

      const updateCall = mockPrismaService.filingNotification.update.mock.calls[0][0];
      expect(updateCall.data.dismissed).toBe(true);
      expect(updateCall.data.dismissedAt).toBeInstanceOf(Date);
      expect(updateCall.data.dismissedAt.getTime()).toBeGreaterThanOrEqual(
        beforeDismiss.getTime(),
      );
    });

    it('should audit log successful dismissal with ticker and filing type', async () => {
      const notificationId = 'notification-1';
      const tenantId = 'tenant-1';

      mockPrismaService.filingNotification.findFirst.mockResolvedValue({
        id: notificationId,
        tenantId,
        ticker: 'AAPL',
        filingType: '10-K',
        dismissed: false,
      });
      mockPrismaService.filingNotification.update.mockResolvedValue({});
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.dismissNotification(notificationId, tenantId);

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'filing_notification.dismiss',
          details: expect.objectContaining({
            tenantId,
            notificationId,
            ticker: 'AAPL',
            filingType: '10-K',
          }),
        }),
      });
    });
  });

  // ============================================================
  // getNotifications (additional tests)
  // ============================================================
  describe('getNotifications', () => {
    it('should return notifications for a tenant', async () => {
      const tenantId = 'tenant-1';
      const mockNotifications = [
        {
          id: 'notification-1',
          tenantId,
          ticker: 'AAPL',
          filingType: '10-K',
          filingDate: new Date('2024-11-01'),
          dismissed: false,
          createdAt: new Date(),
        },
        {
          id: 'notification-2',
          tenantId,
          ticker: 'MSFT',
          filingType: '10-Q',
          filingDate: new Date('2024-10-15'),
          dismissed: false,
          createdAt: new Date(),
        },
      ];

      mockPrismaService.filingNotification.findMany.mockResolvedValue(
        mockNotifications,
      );
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.getNotifications(tenantId);

      expect(result).toEqual(mockNotifications);
      expect(mockPrismaService.filingNotification.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          dismissed: false,
        },
        orderBy: { filingDate: 'desc' },
        take: 50,
      });
    });

    it('should respect dismissed filter', async () => {
      const tenantId = 'tenant-1';

      mockPrismaService.filingNotification.findMany.mockResolvedValue([]);
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.getNotifications(tenantId, { dismissed: true });

      expect(mockPrismaService.filingNotification.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          dismissed: true,
        },
        orderBy: { filingDate: 'desc' },
        take: 50,
      });
    });

    it('should respect limit option', async () => {
      const tenantId = 'tenant-1';

      mockPrismaService.filingNotification.findMany.mockResolvedValue([]);
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.getNotifications(tenantId, { limit: 10 });

      expect(mockPrismaService.filingNotification.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          dismissed: false,
        },
        orderBy: { filingDate: 'desc' },
        take: 10,
      });
    });

    it('should audit log notification access', async () => {
      const tenantId = 'tenant-1';

      mockPrismaService.filingNotification.findMany.mockResolvedValue([
        { id: 'n1' },
        { id: 'n2' },
      ]);
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.getNotifications(tenantId);

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'filing_notification.list',
          details: expect.objectContaining({
            tenantId,
            count: 2,
            dismissed: false,
          }),
        }),
      });
    });
  });

  // ============================================================
  // getNotificationCount
  // ============================================================
  describe('getNotificationCount', () => {
    it('should return count of undismissed notifications for a tenant', async () => {
      const tenantId = 'tenant-1';

      mockPrismaService.filingNotification.count.mockResolvedValue(5);

      const count = await service.getNotificationCount(tenantId);

      expect(count).toBe(5);
      expect(mockPrismaService.filingNotification.count).toHaveBeenCalledWith({
        where: {
          tenantId,
          dismissed: false,
        },
      });
    });
  });

  // ============================================================
  // 4.3.4 Test auto-expiry
  // ============================================================
  describe('expireOldNotifications', () => {
    it('should auto-expire notifications older than 30 days', async () => {
      mockPrismaService.filingNotification.updateMany.mockResolvedValue({
        count: 10,
      });

      const count = await service.expireOldNotifications();

      expect(count).toBe(10);
      expect(
        mockPrismaService.filingNotification.updateMany,
      ).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: expect.any(Date) },
          dismissed: false,
        },
        data: { dismissed: true, dismissedAt: expect.any(Date) },
      });
    });

    it('should use 30-day threshold for expiry', async () => {
      const now = new Date();
      mockPrismaService.filingNotification.updateMany.mockResolvedValue({
        count: 0,
      });

      await service.expireOldNotifications();

      const call =
        mockPrismaService.filingNotification.updateMany.mock.calls[0][0];
      const thresholdDate = call.where.createdAt.lt as Date;

      // Threshold should be approximately 30 days ago (within 1 second tolerance)
      const expectedThreshold = new Date();
      expectedThreshold.setDate(expectedThreshold.getDate() - 30);

      const diffMs = Math.abs(
        thresholdDate.getTime() - expectedThreshold.getTime(),
      );
      expect(diffMs).toBeLessThan(1000); // Within 1 second
    });

    it('should only expire undismissed notifications', async () => {
      mockPrismaService.filingNotification.updateMany.mockResolvedValue({
        count: 5,
      });

      await service.expireOldNotifications();

      const call =
        mockPrismaService.filingNotification.updateMany.mock.calls[0][0];
      expect(call.where.dismissed).toBe(false);
    });

    it('should set dismissed flag and dismissedAt timestamp on expired notifications', async () => {
      const beforeExpiry = new Date();
      mockPrismaService.filingNotification.updateMany.mockResolvedValue({
        count: 3,
      });

      await service.expireOldNotifications();

      const call =
        mockPrismaService.filingNotification.updateMany.mock.calls[0][0];
      expect(call.data.dismissed).toBe(true);
      expect(call.data.dismissedAt).toBeInstanceOf(Date);
      expect(call.data.dismissedAt.getTime()).toBeGreaterThanOrEqual(
        beforeExpiry.getTime(),
      );
    });

    it('should return 0 when no notifications need expiry', async () => {
      mockPrismaService.filingNotification.updateMany.mockResolvedValue({
        count: 0,
      });

      const count = await service.expireOldNotifications();

      expect(count).toBe(0);
    });
  });

  // ============================================================
  // Audit logging resilience
  // ============================================================
  describe('audit logging resilience', () => {
    it('should not fail main operation if audit logging fails', async () => {
      const tenantId = 'tenant-1';

      mockPrismaService.filingNotification.findMany.mockResolvedValue([
        { id: 'n1', tenantId },
      ]);
      // Simulate audit log failure
      mockPrismaService.auditLog.create.mockRejectedValue(
        new Error('DB connection lost'),
      );

      // getNotifications should still succeed despite audit log failure
      const result = await service.getNotifications(tenantId);
      expect(result).toHaveLength(1);
    });
  });
});
