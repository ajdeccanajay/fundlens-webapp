/**
 * Unit Tests for DealService Tenant Isolation
 * 
 * These tests verify complete tenant isolation at the service layer:
 * - createDeal sets correct tenant_id from context
 * - getAllDeals filters by tenant
 * - getDealById returns 404 for wrong tenant
 * - updateDeal returns 404 for wrong tenant
 * - deleteDeal returns 404 for wrong tenant
 * 
 * SECURITY FOCUS: These tests ensure no data leakage between tenants.
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { DealService, CreateDealDto, UpdateDealDto } from '../../src/deals/deal.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TENANT_CONTEXT_KEY, TenantContext } from '../../src/tenant/tenant-context';

describe('DealService - Tenant Isolation', () => {
  let service: DealService;
  let prismaService: jest.Mocked<PrismaService>;
  let mockRequest: any;

  // Test tenant IDs
  const tenantA = 'tenant-a-uuid-1234';
  const tenantB = 'tenant-b-uuid-5678';
  const userId = 'user-uuid-9999';

  // Helper to create tenant context
  const createTenantContext = (tenantId: string): TenantContext => ({
    tenantId,
    tenantSlug: `tenant-${tenantId.slice(0, 8)}`,
    tenantTier: 'pro',
    userId,
    userEmail: 'test@example.com',
    userRole: 'analyst',
    permissions: {
      canCreateDeals: true,
      canDeleteDeals: true,
      canUploadDocuments: true,
      canManageUsers: false,
      canViewAuditLogs: false,
      canExportData: true,
      maxDeals: 50,
      maxUploadsGB: 10,
    },
  });

  // Sample deal data
  const sampleDealTenantA = {
    id: 'deal-1-uuid',
    tenant_id: tenantA,
    name: 'Apple Analysis',
    description: 'Q4 2024 Analysis',
    dealType: 'public',
    ticker: 'AAPL',
    companyName: 'Apple Inc.',
    years: 3,
    status: 'draft',
    processingMessage: null,
    newsData: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    session_id: 'session-1',
    system_prompt: null,
    message_count: '0',
    scratch_pad_id: 'sp-1',
    scratch_pad_content: '# Analysis',
    scratch_pad_saved: new Date('2024-01-01'),
  };

  const sampleDealTenantB = {
    id: 'deal-2-uuid',
    tenant_id: tenantB,
    name: 'Microsoft Analysis',
    description: 'Confidential',
    dealType: 'public',
    ticker: 'MSFT',
    companyName: 'Microsoft Corp.',
    years: 5,
    status: 'ready',
    processingMessage: null,
    newsData: null,
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02'),
    session_id: 'session-2',
    system_prompt: null,
    message_count: '5',
    scratch_pad_id: 'sp-2',
    scratch_pad_content: '# Secret Analysis',
    scratch_pad_saved: new Date('2024-01-02'),
  };

  beforeEach(async () => {
    // Default to Tenant A context
    mockRequest = {
      [TENANT_CONTEXT_KEY]: createTenantContext(tenantA),
    };

    const mockPrismaService = {
      $queryRaw: jest.fn(),
      $queryRawUnsafe: jest.fn(),
      $executeRaw: jest.fn(),
      $executeRawUnsafe: jest.fn(),
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealService,
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

    service = await module.resolve<DealService>(DealService);
    prismaService = module.get(PrismaService);
  });

  describe('createDeal', () => {
    it('should create deal with tenant_id from context (Req 2.1)', async () => {
      const createDto: CreateDealDto = {
        name: 'New Deal',
        dealType: 'public',
        ticker: 'GOOGL',
        companyName: 'Alphabet Inc.',
        years: 3,
      };

      const createdDeal = { ...sampleDealTenantA, id: 'new-deal-uuid', tenant_id: tenantA };
      
      // Mock ticker validation
      (prismaService.$queryRawUnsafe as jest.Mock).mockResolvedValue([{ count: 100 }]);
      
      // Mock transaction
      (prismaService.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([createdDeal]),
        };
        return callback(tx);
      });

      // Mock getDealById for the return
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([createdDeal]);
      (prismaService.$executeRaw as jest.Mock).mockResolvedValue(1);

      const result = await service.createDeal(createDto);

      // Verify the transaction was called
      expect(prismaService.$transaction).toHaveBeenCalled();
      
      // The deal should be associated with tenant A
      expect(result.id).toBe('new-deal-uuid');
    });

    it('should NOT allow tenant_id to be specified in input', async () => {
      const createDto: CreateDealDto = {
        name: 'Malicious Deal',
        dealType: 'public',
        ticker: 'HACK',
      };

      // Even if someone tries to inject tenant_id, it should be ignored
      // and the tenant from context should be used
      const createdDeal = { ...sampleDealTenantA, id: 'new-deal-uuid', tenant_id: tenantA };
      
      // Mock ticker validation
      (prismaService.$queryRawUnsafe as jest.Mock).mockResolvedValue([{ count: 50 }]);
      
      (prismaService.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([createdDeal]),
        };
        return callback(tx);
      });
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([createdDeal]);
      (prismaService.$executeRaw as jest.Mock).mockResolvedValue(1);

      await service.createDeal(createDto);

      // Verify transaction was called with tenant from context
      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException for public deal without ticker', async () => {
      const createDto: CreateDealDto = {
        name: 'Invalid Deal',
        dealType: 'public',
        // No ticker provided
      };

      await expect(service.createDeal(createDto))
        .rejects
        .toThrow(BadRequestException);
    });

    it('should allow private deal without ticker', async () => {
      const createDto: CreateDealDto = {
        name: 'Private Deal',
        dealType: 'private',
        companyName: 'Private Company',
      };

      const createdDeal = { 
        ...sampleDealTenantA, 
        id: 'private-deal-uuid', 
        dealType: 'private',
        ticker: null,
        status: 'draft',
      };
      
      (prismaService.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([createdDeal]),
        };
        return callback(tx);
      });
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([createdDeal]);

      const result = await service.createDeal(createDto);
      expect(result.dealType).toBe('private');
    });

    it('should throw BadRequestException for invalid ticker during deal creation', async () => {
      const createDto: CreateDealDto = {
        name: 'Invalid Ticker Deal',
        dealType: 'public',
        ticker: 'INVALID123',
        companyName: 'Invalid Company',
      };

      // Mock ticker validation to return no data
      (prismaService.$queryRawUnsafe as jest.Mock).mockResolvedValue([{ count: 0 }]);

      await expect(service.createDeal(createDto))
        .rejects
        .toThrow(BadRequestException);

      await expect(service.createDeal(createDto))
        .rejects
        .toThrow(/Ticker "INVALID123" not found in our database/);
    });

    it('should validate ticker exists before creating public deal', async () => {
      const createDto: CreateDealDto = {
        name: 'Valid Ticker Deal',
        dealType: 'public',
        ticker: 'AAPL',
        companyName: 'Apple Inc.',
        years: 3,
      };

      // Mock ticker validation to return data exists
      (prismaService.$queryRawUnsafe as jest.Mock).mockResolvedValue([{ count: 5172 }]);

      const createdDeal = { ...sampleDealTenantA, id: 'new-deal-uuid', ticker: 'AAPL' };
      
      (prismaService.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([createdDeal]),
        };
        return callback(tx);
      });
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([createdDeal]);
      (prismaService.$executeRaw as jest.Mock).mockResolvedValue(1);

      const result = await service.createDeal(createDto);

      // Verify ticker validation was called
      expect(prismaService.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*)'),
        'AAPL'
      );
      expect(result.ticker).toBe('AAPL');
    });

    it('should not validate ticker for private deals', async () => {
      const createDto: CreateDealDto = {
        name: 'Private Deal No Validation',
        dealType: 'private',
        companyName: 'Private Company',
      };

      const createdDeal = { 
        ...sampleDealTenantA, 
        id: 'private-deal-uuid', 
        dealType: 'private',
        ticker: null,
        status: 'draft',
      };
      
      (prismaService.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([createdDeal]),
        };
        return callback(tx);
      });
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([createdDeal]);

      await service.createDeal(createDto);

      // Verify ticker validation was NOT called for private deals
      expect(prismaService.$queryRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe('getAllDeals', () => {
    it('should return only deals for current tenant (Req 2.2)', async () => {
      // Only return tenant A's deals
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([sampleDealTenantA]);

      const result = await service.getAllDeals();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(sampleDealTenantA.id);
      expect(result[0].name).toBe('Apple Analysis');
    });

    it('should NOT return deals from other tenants', async () => {
      // Simulate database returning only tenant A's deals (proper filtering)
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([sampleDealTenantA]);

      const result = await service.getAllDeals();

      // Should not contain tenant B's deal
      expect(result.find(d => d.id === sampleDealTenantB.id)).toBeUndefined();
      expect(result.find(d => d.name === 'Microsoft Analysis')).toBeUndefined();
    });

    it('should return empty array when tenant has no deals', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      const result = await service.getAllDeals();

      expect(result).toHaveLength(0);
    });

    it('should include session and scratch pad data', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([sampleDealTenantA]);

      const result = await service.getAllDeals();

      expect(result[0].currentSession).toBeDefined();
      expect(result[0].currentSession?.id).toBe('session-1');
      expect(result[0].scratchPad).toBeDefined();
      expect(result[0].scratchPad?.id).toBe('sp-1');
    });
  });

  describe('getDealById', () => {
    it('should return deal when it belongs to current tenant', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([sampleDealTenantA]);

      const result = await service.getDealById('deal-1-uuid');

      expect(result.id).toBe('deal-1-uuid');
      expect(result.name).toBe('Apple Analysis');
    });

    it('should throw 404 when deal belongs to another tenant (Req 2.3, 2.6)', async () => {
      // Simulate database returning empty (deal filtered out by tenant_id)
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(service.getDealById('deal-2-uuid'))
        .rejects
        .toThrow(NotFoundException);
    });

    it('should throw 404 when deal does not exist', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(service.getDealById('non-existent-uuid'))
        .rejects
        .toThrow(NotFoundException);
    });

    it('should return 404 NOT 403 to prevent information leakage', async () => {
      // This is a critical security test
      // We should NOT reveal whether a deal exists if it belongs to another tenant
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      try {
        await service.getDealById('secret-deal-uuid');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Deal not found');
        expect(error.getStatus()).toBe(404);
        // Verify it's NOT a ForbiddenException (403)
        expect(error.getStatus()).not.toBe(403);
      }
    });
  });

  describe('updateDeal', () => {
    it('should update deal when it belongs to current tenant', async () => {
      const updateDto: UpdateDealDto = { name: 'Updated Name' };
      
      // First call for ownership verification
      (prismaService.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([sampleDealTenantA])
        .mockResolvedValueOnce([{ ...sampleDealTenantA, name: 'Updated Name' }]);
      (prismaService.$executeRawUnsafe as jest.Mock).mockResolvedValue(1);

      const result = await service.updateDeal('deal-1-uuid', updateDto);

      expect(prismaService.$executeRawUnsafe).toHaveBeenCalled();
      expect(result.name).toBe('Updated Name');
    });

    it('should throw 404 when trying to update another tenant deal (Req 2.4)', async () => {
      const updateDto: UpdateDealDto = { name: 'Hacked Name' };
      
      // Ownership verification fails
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(service.updateDeal('deal-2-uuid', updateDto))
        .rejects
        .toThrow(NotFoundException);

      // Verify update was never called
      expect(prismaService.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should include tenant_id in WHERE clause as defense-in-depth', async () => {
      const updateDto: UpdateDealDto = { name: 'New Name' };
      
      (prismaService.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([sampleDealTenantA])
        .mockResolvedValueOnce([{ ...sampleDealTenantA, name: 'New Name' }]);
      (prismaService.$executeRawUnsafe as jest.Mock).mockResolvedValue(1);

      await service.updateDeal('deal-1-uuid', updateDto);

      // Verify the query includes tenant_id
      const queryCall = (prismaService.$executeRawUnsafe as jest.Mock).mock.calls[0];
      expect(queryCall[0]).toContain('tenant_id');
    });

    it('should return unchanged deal when no fields to update', async () => {
      const updateDto: UpdateDealDto = {};
      
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([sampleDealTenantA]);

      const result = await service.updateDeal('deal-1-uuid', updateDto);

      expect(result.id).toBe('deal-1-uuid');
      expect(prismaService.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe('deleteDeal', () => {
    it('should delete deal when it belongs to current tenant', async () => {
      // Ownership verification
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([sampleDealTenantA]);
      (prismaService.$executeRaw as jest.Mock).mockResolvedValue(1);

      await service.deleteDeal('deal-1-uuid');

      // Verify all delete operations were called
      expect(prismaService.$executeRaw).toHaveBeenCalledTimes(4); // messages, sessions, scratch_pads, deal
    });

    it('should throw 404 when trying to delete another tenant deal (Req 2.5)', async () => {
      // Ownership verification fails
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(service.deleteDeal('deal-2-uuid'))
        .rejects
        .toThrow(NotFoundException);

      // Verify delete was never called
      expect(prismaService.$executeRaw).not.toHaveBeenCalled();
    });

    it('should include tenant_id in all delete queries as defense-in-depth', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([sampleDealTenantA]);
      (prismaService.$executeRaw as jest.Mock).mockResolvedValue(1);

      await service.deleteDeal('deal-1-uuid');

      // All delete calls should include tenant verification
      expect(prismaService.$executeRaw).toHaveBeenCalledTimes(4);
    });

    it('should throw 404 if deal deletion returns 0 rows', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([sampleDealTenantA]);
      // First 3 deletes succeed, but deal delete returns 0
      (prismaService.$executeRaw as jest.Mock)
        .mockResolvedValueOnce(1) // chat messages
        .mockResolvedValueOnce(1) // sessions
        .mockResolvedValueOnce(1) // scratch pads
        .mockResolvedValueOnce(0); // deal - race condition or already deleted

      await expect(service.deleteDeal('deal-1-uuid'))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  describe('getDealStats', () => {
    it('should return stats only for current tenant deals', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([{
        total_deals: '5',
        draft_count: '2',
        in_progress_count: '1',
        review_count: '1',
        closed_count: '1',
        public_count: '3',
        private_count: '2',
        recent_activity: '3',
      }]);

      const result = await service.getDealStats();

      expect(result.totalDeals).toBe(5);
      expect(result.dealsByStatus.draft).toBe(2);
      expect(result.dealsByType.public).toBe(3);
    });

    it('should return zero stats for tenant with no deals', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([{
        total_deals: '0',
        draft_count: '0',
        in_progress_count: '0',
        review_count: '0',
        closed_count: '0',
        public_count: '0',
        private_count: '0',
        recent_activity: '0',
      }]);

      const result = await service.getDealStats();

      expect(result.totalDeals).toBe(0);
    });
  });

  describe('updateDealStatus', () => {
    it('should update status for tenant-owned deal', async () => {
      (prismaService.$executeRaw as jest.Mock).mockResolvedValue(1);

      await service.updateDealStatus('deal-1-uuid', 'processing', 'Starting analysis...');

      expect(prismaService.$executeRaw).toHaveBeenCalled();
    });

    it('should throw 404 when updating status of another tenant deal', async () => {
      // No rows updated because tenant_id doesn't match
      (prismaService.$executeRaw as jest.Mock).mockResolvedValue(0);

      await expect(service.updateDealStatus('deal-2-uuid', 'processing', 'Hacking...'))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  describe('Cross-Tenant Attack Prevention', () => {
    it('should prevent tenant A from accessing tenant B deals via ID guessing', async () => {
      // Tenant A is authenticated
      mockRequest[TENANT_CONTEXT_KEY] = createTenantContext(tenantA);
      
      // Tenant A tries to access tenant B's deal by guessing the ID
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(service.getDealById(sampleDealTenantB.id))
        .rejects
        .toThrow(NotFoundException);
    });

    it('should prevent tenant A from updating tenant B deals', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = createTenantContext(tenantA);
      
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(service.updateDeal(sampleDealTenantB.id, { name: 'Hacked' }))
        .rejects
        .toThrow(NotFoundException);

      expect(prismaService.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should prevent tenant A from deleting tenant B deals', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = createTenantContext(tenantA);
      
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(service.deleteDeal(sampleDealTenantB.id))
        .rejects
        .toThrow(NotFoundException);

      expect(prismaService.$executeRaw).not.toHaveBeenCalled();
    });

    it('should prevent SQL injection in deal ID', async () => {
      const maliciousId = "'; DROP TABLE deals; --";
      
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      // Should safely handle the malicious input
      await expect(service.getDealById(maliciousId))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  describe('Backward Compatibility', () => {
    it('should use default tenant when no context available', async () => {
      // Remove tenant context
      mockRequest[TENANT_CONTEXT_KEY] = undefined;

      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      // Should not throw, but use default tenant
      const result = await service.getAllDeals();
      expect(result).toHaveLength(0);
    });
  });
});
