/**
 * Unit Tests for TenantAwarePrismaService
 * 
 * Tests tenant isolation at the database layer:
 * - findDeals returns only tenant's deals
 * - findDealById returns 404 for other tenant's deal
 * - findAccessibleDataSources includes public and owned sources
 * 
 * Requirements: 2.2, 2.3, 10.1
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { TenantAwarePrismaService } from '../../src/tenant/tenant-aware-prisma.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TENANT_CONTEXT_KEY, TenantContext } from '../../src/tenant/tenant-context';

describe('TenantAwarePrismaService', () => {
  let service: TenantAwarePrismaService;
  let prismaService: jest.Mocked<PrismaService>;
  let mockRequest: any;

  const tenantA = 'tenant-a-uuid';
  const tenantB = 'tenant-b-uuid';
  const userId = 'user-uuid';

  const createTenantContext = (tenantId: string): TenantContext => ({
    tenantId,
    tenantSlug: `tenant-${tenantId.slice(0, 8)}`,
    tenantTier: 'pro',
    userId,
    userEmail: 'test@example.com',
    userRole: 'analyst',
    permissions: {
      canCreateDeals: true,
      canDeleteDeals: false,
      canUploadDocuments: true,
      canManageUsers: false,
      canViewAuditLogs: false,
      canExportData: true,
      maxDeals: 50,
      maxUploadsGB: 10,
    },
  });

  beforeEach(async () => {
    mockRequest = {
      [TENANT_CONTEXT_KEY]: createTenantContext(tenantA),
    };

    const mockPrismaService = {
      deal: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      document: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      analysisSession: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      chatMessage: {
        findMany: jest.fn(),
        create: jest.fn(),
      },
      dataSource: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      financialMetric: {
        findMany: jest.fn(),
      },
      narrativeChunk: {
        findMany: jest.fn(),
      },
      uploadedDocument: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      scratchPad: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      $queryRawUnsafe: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantAwarePrismaService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: REQUEST,
          useValue: mockRequest,
        },
      ],
    }).compile();

    service = await module.resolve<TenantAwarePrismaService>(TenantAwarePrismaService);
    prismaService = module.get(PrismaService);
  });

  describe('tenantContext', () => {
    it('should return tenant context from request', () => {
      const context = service.tenantContext;
      expect(context.tenantId).toBe(tenantA);
      expect(context.userRole).toBe('analyst');
    });

    it('should throw error when no tenant context available', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = undefined;
      
      expect(() => service.tenantContext).toThrow(
        'No tenant context available - ensure TenantGuard is applied'
      );
    });
  });

  describe('findDeals', () => {
    it('should return only deals for current tenant (Req 2.2)', async () => {
      const tenantADeals = [
        { id: 'deal-1', name: 'Deal 1', tenantId: tenantA },
        { id: 'deal-2', name: 'Deal 2', tenantId: tenantA },
      ];

      (prismaService.deal.findMany as jest.Mock).mockResolvedValue(tenantADeals);

      const result = await service.findDeals();

      expect(prismaService.deal.findMany).toHaveBeenCalledWith({
        where: { tenantId: tenantA },
        orderBy: { updatedAt: 'desc' },
        take: undefined,
        skip: undefined,
        include: undefined,
      });
      expect(result).toEqual(tenantADeals);
      expect(result.every(d => d.tenantId === tenantA)).toBe(true);
    });

    it('should apply additional filters while maintaining tenant filter', async () => {
      (prismaService.deal.findMany as jest.Mock).mockResolvedValue([]);

      await service.findDeals({
        where: { status: 'ready' },
        take: 10,
      });

      expect(prismaService.deal.findMany).toHaveBeenCalledWith({
        where: { status: 'ready', tenantId: tenantA },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        skip: undefined,
        include: undefined,
      });
    });

    it('should not return deals from other tenants', async () => {
      // Simulate Prisma filtering - only return tenant A's deals
      (prismaService.deal.findMany as jest.Mock).mockImplementation(({ where }) => {
        if (where.tenantId === tenantA) {
          return Promise.resolve([{ id: 'deal-1', tenantId: tenantA }]);
        }
        return Promise.resolve([]);
      });

      const result = await service.findDeals();
      
      expect(result).toHaveLength(1);
      expect(result[0].tenantId).toBe(tenantA);
    });
  });

  describe('findDealById', () => {
    it('should return deal when it belongs to current tenant', async () => {
      const deal = { id: 'deal-1', name: 'My Deal', tenantId: tenantA };
      (prismaService.deal.findFirst as jest.Mock).mockResolvedValue(deal);

      const result = await service.findDealById('deal-1');

      expect(prismaService.deal.findFirst).toHaveBeenCalledWith({
        where: { id: 'deal-1', tenantId: tenantA },
        include: undefined,
      });
      expect(result).toEqual(deal);
    });

    it('should throw 404 when deal belongs to another tenant (Req 2.3, 2.6)', async () => {
      // Prisma returns null because the deal doesn't match tenant filter
      (prismaService.deal.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findDealById('other-tenant-deal'))
        .rejects
        .toThrow(NotFoundException);
      
      await expect(service.findDealById('other-tenant-deal'))
        .rejects
        .toThrow('Deal not found');
    });

    it('should throw 404 when deal does not exist', async () => {
      (prismaService.deal.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findDealById('non-existent'))
        .rejects
        .toThrow(NotFoundException);
    });

    it('should return 404 not 403 to prevent information leakage', async () => {
      // This is a security requirement - we don't reveal whether the deal exists
      (prismaService.deal.findFirst as jest.Mock).mockResolvedValue(null);

      try {
        await service.findDealById('secret-deal');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Deal not found');
        // Verify it's not a ForbiddenException or similar
        expect(error.getStatus()).toBe(404);
      }
    });
  });

  describe('createDeal', () => {
    it('should create deal with current tenant ID', async () => {
      const dealData = { name: 'New Deal', dealType: 'public', ticker: 'AAPL' };
      const createdDeal = { id: 'new-deal', ...dealData, tenantId: tenantA };
      
      (prismaService.deal.create as jest.Mock).mockResolvedValue(createdDeal);

      const result = await service.createDeal(dealData as any);

      expect(prismaService.deal.create).toHaveBeenCalledWith({
        data: {
          ...dealData,
          tenant: { connect: { id: tenantA } },
        },
      });
      expect(result.tenantId).toBe(tenantA);
    });
  });

  describe('updateDeal', () => {
    it('should update deal after verifying ownership', async () => {
      const existingDeal = { id: 'deal-1', name: 'Old Name', tenantId: tenantA };
      const updatedDeal = { ...existingDeal, name: 'New Name' };
      
      (prismaService.deal.findFirst as jest.Mock).mockResolvedValue(existingDeal);
      (prismaService.deal.update as jest.Mock).mockResolvedValue(updatedDeal);

      const result = await service.updateDeal('deal-1', { name: 'New Name' });

      expect(prismaService.deal.findFirst).toHaveBeenCalled();
      expect(prismaService.deal.update).toHaveBeenCalledWith({
        where: { id: 'deal-1' },
        data: { name: 'New Name' },
      });
      expect(result.name).toBe('New Name');
    });

    it('should throw 404 when trying to update another tenant deal (Req 2.4)', async () => {
      (prismaService.deal.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.updateDeal('other-deal', { name: 'Hacked' }))
        .rejects
        .toThrow(NotFoundException);
      
      // Verify update was never called
      expect(prismaService.deal.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteDeal', () => {
    it('should delete deal after verifying ownership', async () => {
      const deal = { id: 'deal-1', tenantId: tenantA };
      (prismaService.deal.findFirst as jest.Mock).mockResolvedValue(deal);
      (prismaService.deal.delete as jest.Mock).mockResolvedValue(deal);

      await service.deleteDeal('deal-1');

      expect(prismaService.deal.findFirst).toHaveBeenCalled();
      expect(prismaService.deal.delete).toHaveBeenCalledWith({
        where: { id: 'deal-1' },
      });
    });

    it('should throw 404 when trying to delete another tenant deal (Req 2.5)', async () => {
      (prismaService.deal.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteDeal('other-deal'))
        .rejects
        .toThrow(NotFoundException);
      
      expect(prismaService.deal.delete).not.toHaveBeenCalled();
    });
  });

  describe('findAccessibleDataSources', () => {
    it('should include public data sources (Req 10.1)', async () => {
      const publicSource = { id: 'ds-1', visibility: 'public', ownerTenantId: null };
      (prismaService.dataSource.findMany as jest.Mock).mockResolvedValue([publicSource]);

      const result = await service.findAccessibleDataSources();

      expect(prismaService.dataSource.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { visibility: 'public' },
            { ownerTenantId: tenantA },
            {
              accessGrants: {
                some: {
                  tenantId: tenantA,
                  OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: expect.any(Date) } },
                  ],
                },
              },
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toContainEqual(publicSource);
    });

    it('should include tenant-owned data sources', async () => {
      const ownedSource = { id: 'ds-2', visibility: 'private', ownerTenantId: tenantA };
      (prismaService.dataSource.findMany as jest.Mock).mockResolvedValue([ownedSource]);

      const result = await service.findAccessibleDataSources();

      expect(result).toContainEqual(ownedSource);
    });

    it('should include data sources with granted access', async () => {
      const grantedSource = { 
        id: 'ds-3', 
        visibility: 'private', 
        ownerTenantId: tenantB,
        accessGrants: [{ tenantId: tenantA, expiresAt: null }],
      };
      (prismaService.dataSource.findMany as jest.Mock).mockResolvedValue([grantedSource]);

      const result = await service.findAccessibleDataSources();

      expect(result).toContainEqual(grantedSource);
    });

    it('should filter by type when specified', async () => {
      (prismaService.dataSource.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAccessibleDataSources({ type: 'sec_filing' });

      expect(prismaService.dataSource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'sec_filing',
          }),
        })
      );
    });
  });

  describe('findDocuments', () => {
    it('should return only documents for current tenant', async () => {
      const docs = [{ id: 'doc-1', tenantId: tenantA }];
      (prismaService.document.findMany as jest.Mock).mockResolvedValue(docs);

      const result = await service.findDocuments();

      expect(prismaService.document.findMany).toHaveBeenCalledWith({
        where: { tenantId: tenantA },
        orderBy: { uploadDate: 'desc' },
        take: undefined,
        skip: undefined,
        include: undefined,
      });
      expect(result).toEqual(docs);
    });
  });

  describe('findDocumentById', () => {
    it('should return document when it belongs to current tenant', async () => {
      const doc = { id: 'doc-1', tenantId: tenantA };
      (prismaService.document.findFirst as jest.Mock).mockResolvedValue(doc);

      const result = await service.findDocumentById('doc-1');

      expect(result).toEqual(doc);
    });

    it('should throw 404 for document from another tenant', async () => {
      (prismaService.document.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findDocumentById('other-doc'))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  describe('findSessionById', () => {
    it('should return session when deal belongs to current tenant', async () => {
      const session = {
        id: 'session-1',
        dealId: 'deal-1',
        deal: { id: 'deal-1', tenantId: tenantA },
      };
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(session);

      const result = await service.findSessionById('session-1');

      expect(result).toEqual(session);
    });

    it('should throw 404 when session deal belongs to another tenant', async () => {
      const session = {
        id: 'session-1',
        dealId: 'deal-1',
        deal: { id: 'deal-1', tenantId: tenantB }, // Different tenant!
      };
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(session);

      await expect(service.findSessionById('session-1'))
        .rejects
        .toThrow(NotFoundException);
    });

    it('should throw 404 when session does not exist', async () => {
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findSessionById('non-existent'))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  describe('hasAccessToDataSource', () => {
    it('should return true for public data source', async () => {
      (prismaService.dataSource.findFirst as jest.Mock).mockResolvedValue({
        id: 'ds-1',
        visibility: 'public',
      });

      const result = await service.hasAccessToDataSource('ds-1');

      expect(result).toBe(true);
    });

    it('should return true for owned data source', async () => {
      (prismaService.dataSource.findFirst as jest.Mock).mockResolvedValue({
        id: 'ds-2',
        ownerTenantId: tenantA,
      });

      const result = await service.hasAccessToDataSource('ds-2');

      expect(result).toBe(true);
    });

    it('should return false for inaccessible data source', async () => {
      (prismaService.dataSource.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.hasAccessToDataSource('ds-private');

      expect(result).toBe(false);
    });
  });

  describe('countDeals', () => {
    it('should count only tenant deals', async () => {
      (prismaService.deal.count as jest.Mock).mockResolvedValue(5);

      const result = await service.countDeals();

      expect(prismaService.deal.count).toHaveBeenCalledWith({
        where: { tenantId: tenantA },
      });
      expect(result).toBe(5);
    });

    it('should apply additional filters while maintaining tenant filter', async () => {
      (prismaService.deal.count as jest.Mock).mockResolvedValue(2);

      await service.countDeals({ status: 'ready' });

      expect(prismaService.deal.count).toHaveBeenCalledWith({
        where: { status: 'ready', tenantId: tenantA },
      });
    });
  });
});
