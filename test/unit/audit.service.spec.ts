/**
 * AuditService Unit Tests
 * 
 * Tests for audit logging functionality.
 * Validates:
 * - Audit log creation with complete context
 * - Tenant-scoped log retrieval
 * - Permission enforcement for log access
 * - IP and user agent tracking
 */

import { Test, TestingModule } from '@nestjs/testing';
import { REQUEST } from '@nestjs/core';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { AuditService, AuditActions } from '../../src/tenant/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext, TENANT_CONTEXT_KEY, ROLE_PERMISSIONS } from '../../src/tenant/tenant-context';

describe('AuditService', () => {
  let service: AuditService;
  let mockRequest: any;

  // Mock functions
  const mockAuditLogCreate = jest.fn();
  const mockAuditLogFindMany = jest.fn();
  const mockAuditLogFindFirst = jest.fn();
  const mockAuditLogCount = jest.fn();
  const mockAuditLogGroupBy = jest.fn();

  // Test tenant contexts
  const adminContext: TenantContext = {
    tenantId: 'tenant-1',
    tenantSlug: 'acme-corp',
    tenantTier: 'enterprise',
    userId: 'admin-user-1',
    userEmail: 'admin@acme.com',
    userRole: 'admin',
    permissions: ROLE_PERMISSIONS.admin,
  };

  const analystContext: TenantContext = {
    tenantId: 'tenant-1',
    tenantSlug: 'acme-corp',
    tenantTier: 'enterprise',
    userId: 'analyst-user-1',
    userEmail: 'analyst@acme.com',
    userRole: 'analyst',
    permissions: ROLE_PERMISSIONS.analyst,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockRequest = {
      [TENANT_CONTEXT_KEY]: adminContext,
      headers: {
        'x-forwarded-for': '192.168.1.100',
        'user-agent': 'Mozilla/5.0 Test Browser',
      },
      ip: '127.0.0.1',
    };

    const mockPrismaService = {
      auditLog: {
        create: mockAuditLogCreate,
        findMany: mockAuditLogFindMany,
        findFirst: mockAuditLogFindFirst,
        count: mockAuditLogCount,
        groupBy: mockAuditLogGroupBy,
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: REQUEST, useValue: mockRequest },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  describe('logAccess', () => {
    it('should create audit log entry with all fields', async () => {
      mockAuditLogCreate.mockResolvedValue({ id: 'log-1' });

      await service.logAccess({
        tenantId: 'tenant-1',
        userId: 'user-1',
        userEmail: 'user@acme.com',
        action: AuditActions.DEAL_CREATE,
        resource: 'deal',
        resourceId: 'deal-123',
        details: { dealName: 'Test Deal' },
        ipAddress: '192.168.1.100',
        userAgent: 'Test Browser',
        success: true,
      });

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'user-1',
          userEmail: 'user@acme.com',
          action: 'deal.create',
          resource: 'deal',
          resourceId: 'deal-123',
          details: { dealName: 'Test Deal' },
          ipAddress: '192.168.1.100',
          userAgent: 'Test Browser',
          success: true,
          errorMessage: null,
        }),
      });
    });

    it('should log failed operations with error message', async () => {
      mockAuditLogCreate.mockResolvedValue({ id: 'log-1' });

      await service.logAccess({
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: AuditActions.DEAL_DELETE,
        resource: 'deal',
        resourceId: 'deal-123',
        success: false,
        errorMessage: 'Permission denied',
      });

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          success: false,
          errorMessage: 'Permission denied',
        }),
      });
    });

    it('should not throw if audit logging fails', async () => {
      mockAuditLogCreate.mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(
        service.logAccess({
          tenantId: 'tenant-1',
          userId: 'user-1',
          action: AuditActions.DEAL_READ,
          resource: 'deal',
          success: true,
        })
      ).resolves.not.toThrow();
    });
  });

  describe('logFromContext', () => {
    it('should extract tenant context and log', async () => {
      mockAuditLogCreate.mockResolvedValue({ id: 'log-1' });

      await service.logFromContext(AuditActions.DEAL_LIST, 'deal', {
        details: { count: 10 },
      });

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'admin-user-1',
          userEmail: 'admin@acme.com',
          action: 'deal.list',
          resource: 'deal',
          ipAddress: '192.168.1.100', // From x-forwarded-for
          userAgent: 'Mozilla/5.0 Test Browser',
        }),
      });
    });

    it('should handle missing tenant context gracefully', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = null;

      // Should not throw, just log warning
      await expect(
        service.logFromContext(AuditActions.DEAL_READ, 'deal')
      ).resolves.not.toThrow();

      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });
  });

  describe('getAuditLogs', () => {
    it('should return logs for current tenant only', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          action: 'deal.create',
          resource: 'deal',
          timestamp: new Date(),
          success: true,
        },
      ];
      mockAuditLogFindMany.mockResolvedValue(mockLogs);
      mockAuditLogCount.mockResolvedValue(1);

      const result = await service.getAuditLogs();

      expect(result.logs).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
          }),
        })
      );
    });

    it('should filter by date range', async () => {
      mockAuditLogFindMany.mockResolvedValue([]);
      mockAuditLogCount.mockResolvedValue(0);

      const startDate = new Date('2026-01-01');
      const endDate = new Date('2026-01-31');

      await service.getAuditLogs({ startDate, endDate });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            timestamp: {
              gte: startDate,
              lte: endDate,
            },
          }),
        })
      );
    });

    it('should filter by action type', async () => {
      mockAuditLogFindMany.mockResolvedValue([]);
      mockAuditLogCount.mockResolvedValue(0);

      await service.getAuditLogs({ action: 'deal.create' });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: 'deal.create',
          }),
        })
      );
    });

    it('should filter by success status', async () => {
      mockAuditLogFindMany.mockResolvedValue([]);
      mockAuditLogCount.mockResolvedValue(0);

      await service.getAuditLogs({ success: false });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            success: false,
          }),
        })
      );
    });

    it('should support pagination', async () => {
      mockAuditLogFindMany.mockResolvedValue([]);
      mockAuditLogCount.mockResolvedValue(100);

      await service.getAuditLogs({ limit: 20, offset: 40 });

      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
          skip: 40,
        })
      );
    });

    it('should reject if user lacks canViewAuditLogs permission', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = analystContext;

      await expect(service.getAuditLogs()).rejects.toThrow(ForbiddenException);
      await expect(service.getAuditLogs()).rejects.toThrow(
        'You do not have permission to view audit logs'
      );
    });

    it('should reject if no tenant context', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = null;

      await expect(service.getAuditLogs()).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getAuditLog', () => {
    it('should return specific log entry for current tenant', async () => {
      const mockLog = {
        id: 'log-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'deal.create',
        resource: 'deal',
        timestamp: new Date(),
        success: true,
      };
      mockAuditLogFindFirst.mockResolvedValue(mockLog);

      const result = await service.getAuditLog('log-1');

      expect(result).toEqual(mockLog);
      expect(mockAuditLogFindFirst).toHaveBeenCalledWith({
        where: {
          id: 'log-1',
          tenantId: 'tenant-1',
        },
      });
    });

    it('should return 404 for log from different tenant', async () => {
      mockAuditLogFindFirst.mockResolvedValue(null);

      await expect(service.getAuditLog('log-from-other-tenant')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should reject if user lacks permission', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = analystContext;

      await expect(service.getAuditLog('log-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getAuditStats', () => {
    it('should return statistics for current tenant', async () => {
      mockAuditLogCount
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(95) // successful
        .mockResolvedValueOnce(5); // failed
      mockAuditLogGroupBy
        .mockResolvedValueOnce([{ userId: 'user-1' }, { userId: 'user-2' }]) // unique users
        .mockResolvedValueOnce([
          { action: 'deal.create', _count: 50 },
          { action: 'deal.read', _count: 30 },
        ]) // top actions
        .mockResolvedValueOnce([
          { resource: 'deal', _count: 80 },
          { resource: 'document', _count: 20 },
        ]); // top resources

      const result = await service.getAuditStats(30);

      expect(result.totalEvents).toBe(100);
      expect(result.successfulEvents).toBe(95);
      expect(result.failedEvents).toBe(5);
      expect(result.uniqueUsers).toBe(2);
      expect(result.topActions).toHaveLength(2);
      expect(result.topResources).toHaveLength(2);
    });

    it('should reject if user lacks permission', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = analystContext;

      await expect(service.getAuditStats()).rejects.toThrow(ForbiddenException);
    });
  });

  describe('IP and User Agent extraction', () => {
    it('should extract IP from x-forwarded-for header', async () => {
      mockRequest.headers['x-forwarded-for'] = '10.0.0.1, 192.168.1.1';
      mockAuditLogCreate.mockResolvedValue({ id: 'log-1' });

      await service.logFromContext(AuditActions.DEAL_READ, 'deal');

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ipAddress: '10.0.0.1',
        }),
      });
    });

    it('should extract IP from x-real-ip header', async () => {
      delete mockRequest.headers['x-forwarded-for'];
      mockRequest.headers['x-real-ip'] = '172.16.0.1';
      mockAuditLogCreate.mockResolvedValue({ id: 'log-1' });

      await service.logFromContext(AuditActions.DEAL_READ, 'deal');

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ipAddress: '172.16.0.1',
        }),
      });
    });

    it('should fall back to request.ip', async () => {
      delete mockRequest.headers['x-forwarded-for'];
      delete mockRequest.headers['x-real-ip'];
      mockAuditLogCreate.mockResolvedValue({ id: 'log-1' });

      await service.logFromContext(AuditActions.DEAL_READ, 'deal');

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ipAddress: '127.0.0.1',
        }),
      });
    });
  });

  describe('AuditActions constants', () => {
    it('should have all expected action types', () => {
      expect(AuditActions.DEAL_CREATE).toBe('deal.create');
      expect(AuditActions.DEAL_READ).toBe('deal.read');
      expect(AuditActions.DEAL_UPDATE).toBe('deal.update');
      expect(AuditActions.DEAL_DELETE).toBe('deal.delete');
      expect(AuditActions.DOCUMENT_UPLOAD).toBe('document.upload');
      expect(AuditActions.DOCUMENT_DOWNLOAD).toBe('document.download');
      expect(AuditActions.RAG_QUERY).toBe('rag.query');
      expect(AuditActions.USER_ADD).toBe('user.add');
      expect(AuditActions.AUTH_LOGIN).toBe('auth.login');
    });
  });

  describe('tenant isolation', () => {
    it('should never return logs from other tenants', async () => {
      mockAuditLogFindMany.mockResolvedValue([]);
      mockAuditLogCount.mockResolvedValue(0);

      await service.getAuditLogs();

      // Verify tenant filter is always applied
      expect(mockAuditLogFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
          }),
        })
      );
    });

    it('should filter getAuditLog by tenant', async () => {
      mockAuditLogFindFirst.mockResolvedValue(null);

      await expect(service.getAuditLog('any-id')).rejects.toThrow(NotFoundException);

      expect(mockAuditLogFindFirst).toHaveBeenCalledWith({
        where: {
          id: 'any-id',
          tenantId: 'tenant-1',
        },
      });
    });
  });
});
