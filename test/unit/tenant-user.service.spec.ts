/**
 * TenantUserService Unit Tests
 * 
 * Tests for tenant-level user management functionality.
 * Validates:
 * - User creation within tenant
 * - User removal with proper authorization
 * - Role updates with permission checks
 * - User listing with tenant filtering
 * - Cross-tenant access prevention
 */

import { Test, TestingModule } from '@nestjs/testing';
import { REQUEST } from '@nestjs/core';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenantUserService } from '../../src/tenant/tenant-user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CognitoAuthService } from '../../src/auth/cognito-auth.service';
import { TenantContext, TENANT_CONTEXT_KEY, ROLE_PERMISSIONS } from '../../src/tenant/tenant-context';

describe('TenantUserService', () => {
  let service: TenantUserService;
  let mockRequest: any;

  // Mock functions
  const mockTenantFindUnique = jest.fn();
  const mockTenantUserCreate = jest.fn();
  const mockTenantUserFindMany = jest.fn();
  const mockTenantUserFindFirst = jest.fn();
  const mockTenantUserUpdateMany = jest.fn();
  const mockTenantUserDeleteMany = jest.fn();
  const mockAdminGetUser = jest.fn();
  const mockAdminCreateUser = jest.fn();
  const mockAdminDeleteUser = jest.fn();
  const mockAdminUpdateUserTenant = jest.fn();

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

  const viewerContext: TenantContext = {
    tenantId: 'tenant-1',
    tenantSlug: 'acme-corp',
    tenantTier: 'enterprise',
    userId: 'viewer-user-1',
    userEmail: 'viewer@acme.com',
    userRole: 'viewer',
    permissions: ROLE_PERMISSIONS.viewer,
  };

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    mockRequest = {
      [TENANT_CONTEXT_KEY]: adminContext,
    };

    const mockPrismaService = {
      tenant: {
        findUnique: mockTenantFindUnique,
      },
      tenantUser: {
        create: mockTenantUserCreate,
        findMany: mockTenantUserFindMany,
        findFirst: mockTenantUserFindFirst,
        updateMany: mockTenantUserUpdateMany,
        deleteMany: mockTenantUserDeleteMany,
      },
    };

    const mockCognitoAuthService = {
      adminGetUser: mockAdminGetUser,
      adminCreateUser: mockAdminCreateUser,
      adminDeleteUser: mockAdminDeleteUser,
      adminUpdateUserTenant: mockAdminUpdateUserTenant,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantUserService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CognitoAuthService, useValue: mockCognitoAuthService },
        { provide: REQUEST, useValue: mockRequest },
      ],
    }).compile();

    service = module.get<TenantUserService>(TenantUserService);
  });

  describe('addUser', () => {
    const addUserDto = {
      email: 'newuser@acme.com',
      password: 'SecurePass123!',
      role: 'analyst' as const,
    };

    it('should create a new user in Cognito and database', async () => {
      mockAdminGetUser.mockResolvedValue(null);
      mockAdminCreateUser.mockResolvedValue('new-user-id');
      mockTenantFindUnique.mockResolvedValue({
        id: 'tenant-1',
        name: 'Acme Corp',
        slug: 'acme-corp',
        tier: 'enterprise',
        status: 'active',
        settings: { maxUsers: 100 },
        _count: { users: 5 },
      });
      mockTenantUserCreate.mockResolvedValue({
        id: 'tenant-user-1',
        tenantId: 'tenant-1',
        userId: 'new-user-id',
        role: 'analyst',
        permissions: {},
        createdAt: new Date(),
      });

      const result = await service.addUser(addUserDto);

      expect(mockAdminCreateUser).toHaveBeenCalledWith(
        'newuser@acme.com',
        'SecurePass123!',
        'tenant-1',
        'acme-corp',
        'analyst',
      );
      expect(mockTenantUserCreate).toHaveBeenCalled();
      expect(result.email).toBe('newuser@acme.com');
      expect(result.role).toBe('analyst');
    });

    it('should reject if user already exists in same tenant', async () => {
      mockAdminGetUser.mockResolvedValue({
        userId: 'existing-user',
        email: 'newuser@acme.com',
        tenantId: 'tenant-1',
        tenantSlug: 'acme-corp',
        tenantRole: 'analyst',
        emailVerified: true,
      });

      await expect(service.addUser(addUserDto)).rejects.toThrow(BadRequestException);
      await expect(service.addUser(addUserDto)).rejects.toThrow('User already exists in this tenant');
    });

    it('should return 404 if user exists in different tenant (prevent info leakage)', async () => {
      mockAdminGetUser.mockResolvedValue({
        userId: 'existing-user',
        email: 'newuser@acme.com',
        tenantId: 'tenant-2', // Different tenant
        tenantSlug: 'other-corp',
        tenantRole: 'analyst',
        emailVerified: true,
      });

      await expect(service.addUser(addUserDto)).rejects.toThrow(NotFoundException);
      await expect(service.addUser(addUserDto)).rejects.toThrow('Unable to add user');
    });

    it('should reject if user limit is reached', async () => {
      mockAdminGetUser.mockResolvedValue(null);
      mockTenantFindUnique.mockResolvedValue({
        id: 'tenant-1',
        name: 'Acme Corp',
        slug: 'acme-corp',
        tier: 'free',
        status: 'active',
        settings: { maxUsers: 3 },
        _count: { users: 3 },
      });

      await expect(service.addUser(addUserDto)).rejects.toThrow(BadRequestException);
      await expect(service.addUser(addUserDto)).rejects.toThrow('User limit reached');
    });

    it('should reject invalid email format', async () => {
      const invalidDto = { ...addUserDto, email: 'invalid-email' };

      await expect(service.addUser(invalidDto)).rejects.toThrow(BadRequestException);
      await expect(service.addUser(invalidDto)).rejects.toThrow('Invalid email format');
    });

    it('should reject if user lacks admin permission', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = analystContext;

      await expect(service.addUser(addUserDto)).rejects.toThrow(ForbiddenException);
      await expect(service.addUser(addUserDto)).rejects.toThrow('You do not have permission to manage users');
    });
  });

  describe('removeUser', () => {
    it('should remove user from Cognito and database', async () => {
      mockAdminGetUser.mockResolvedValue({
        userId: 'user-to-remove',
        email: 'remove@acme.com',
        tenantId: 'tenant-1',
        tenantSlug: 'acme-corp',
        tenantRole: 'analyst',
        emailVerified: true,
      });
      mockTenantUserDeleteMany.mockResolvedValue({ count: 1 });
      mockAdminDeleteUser.mockResolvedValue(undefined);

      await service.removeUser('remove@acme.com');

      expect(mockTenantUserDeleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', userId: 'user-to-remove' },
      });
      expect(mockAdminDeleteUser).toHaveBeenCalledWith('remove@acme.com');
    });

    it('should return 404 for user in different tenant', async () => {
      mockAdminGetUser.mockResolvedValue({
        userId: 'other-user',
        email: 'other@other.com',
        tenantId: 'tenant-2', // Different tenant
        tenantSlug: 'other-corp',
        tenantRole: 'analyst',
        emailVerified: true,
      });

      await expect(service.removeUser('other@other.com')).rejects.toThrow(NotFoundException);
      await expect(service.removeUser('other@other.com')).rejects.toThrow('User not found');
    });

    it('should prevent self-removal', async () => {
      await expect(service.removeUser('admin@acme.com')).rejects.toThrow(BadRequestException);
      await expect(service.removeUser('admin@acme.com')).rejects.toThrow('You cannot remove yourself');
    });

    it('should return 404 for non-existent user', async () => {
      mockAdminGetUser.mockResolvedValue(null);

      await expect(service.removeUser('nonexistent@acme.com')).rejects.toThrow(NotFoundException);
    });

    it('should reject if user lacks admin permission', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = viewerContext;

      await expect(service.removeUser('someone@acme.com')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateRole', () => {
    it('should update user role in Cognito and database', async () => {
      mockAdminGetUser.mockResolvedValue({
        userId: 'user-to-update',
        email: 'update@acme.com',
        tenantId: 'tenant-1',
        tenantSlug: 'acme-corp',
        tenantRole: 'viewer',
        emailVerified: true,
      });
      mockAdminUpdateUserTenant.mockResolvedValue(undefined);
      mockTenantUserUpdateMany.mockResolvedValue({ count: 1 });
      mockTenantUserFindFirst.mockResolvedValue({
        id: 'tenant-user-1',
        tenantId: 'tenant-1',
        userId: 'user-to-update',
        role: 'analyst',
        permissions: {},
        createdAt: new Date(),
      });

      const result = await service.updateRole('update@acme.com', { role: 'analyst' });

      expect(mockAdminUpdateUserTenant).toHaveBeenCalledWith(
        'update@acme.com',
        'tenant-1',
        'acme-corp',
        'analyst',
      );
      expect(result.role).toBe('analyst');
    });

    it('should prevent self-role-change', async () => {
      await expect(
        service.updateRole('admin@acme.com', { role: 'viewer' })
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateRole('admin@acme.com', { role: 'viewer' })
      ).rejects.toThrow('You cannot change your own role');
    });

    it('should return 404 for user in different tenant', async () => {
      mockAdminGetUser.mockResolvedValue({
        userId: 'other-user',
        email: 'other@other.com',
        tenantId: 'tenant-2',
        tenantSlug: 'other-corp',
        tenantRole: 'analyst',
        emailVerified: true,
      });

      await expect(
        service.updateRole('other@other.com', { role: 'admin' })
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject if user lacks admin permission', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = analystContext;

      await expect(
        service.updateRole('someone@acme.com', { role: 'viewer' })
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listUsers', () => {
    it('should return all users in the current tenant', async () => {
      mockTenantUserFindMany.mockResolvedValue([
        {
          id: 'tu-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          role: 'admin',
          permissions: {},
          createdAt: new Date(),
        },
        {
          id: 'tu-2',
          tenantId: 'tenant-1',
          userId: 'user-2',
          role: 'analyst',
          permissions: {},
          createdAt: new Date(),
        },
      ]);

      const result = await service.listUsers();

      expect(result).toHaveLength(2);
      expect(mockTenantUserFindMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should allow non-admin users to list users', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = viewerContext;
      mockTenantUserFindMany.mockResolvedValue([]);

      const result = await service.listUsers();

      expect(result).toEqual([]);
    });

    it('should only return users from current tenant', async () => {
      mockTenantUserFindMany.mockResolvedValue([
        {
          id: 'tu-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          role: 'admin',
          permissions: {},
          createdAt: new Date(),
        },
      ]);

      await service.listUsers();

      expect(mockTenantUserFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1' },
        })
      );
    });
  });

  describe('getUser', () => {
    it('should return user info for user in current tenant', async () => {
      mockAdminGetUser.mockResolvedValue({
        userId: 'user-1',
        email: 'user@acme.com',
        tenantId: 'tenant-1',
        tenantSlug: 'acme-corp',
        tenantRole: 'analyst',
        emailVerified: true,
      });
      mockTenantUserFindFirst.mockResolvedValue({
        id: 'tu-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        role: 'analyst',
        permissions: {},
        createdAt: new Date(),
      });

      const result = await service.getUser('user@acme.com');

      expect(result.email).toBe('user@acme.com');
      expect(result.role).toBe('analyst');
    });

    it('should return 404 for user in different tenant', async () => {
      mockAdminGetUser.mockResolvedValue({
        userId: 'other-user',
        email: 'other@other.com',
        tenantId: 'tenant-2',
        tenantSlug: 'other-corp',
        tenantRole: 'analyst',
        emailVerified: true,
      });

      await expect(service.getUser('other@other.com')).rejects.toThrow(NotFoundException);
    });

    it('should return 404 for non-existent user', async () => {
      mockAdminGetUser.mockResolvedValue(null);

      await expect(service.getUser('nonexistent@acme.com')).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkPermission', () => {
    it('should return true for granted permission', () => {
      expect(service.checkPermission('canManageUsers')).toBe(true);
    });

    it('should return false for denied permission', () => {
      mockRequest[TENANT_CONTEXT_KEY] = viewerContext;
      expect(service.checkPermission('canManageUsers')).toBe(false);
    });
  });

  describe('cross-tenant isolation', () => {
    it('should not allow adding users to other tenants', async () => {
      mockAdminGetUser.mockResolvedValue(null);
      mockAdminCreateUser.mockResolvedValue('new-user-id');
      mockTenantFindUnique.mockResolvedValue({
        id: 'tenant-1',
        name: 'Acme Corp',
        slug: 'acme-corp',
        tier: 'enterprise',
        status: 'active',
        settings: { maxUsers: 100 },
        _count: { users: 5 },
      });
      mockTenantUserCreate.mockResolvedValue({
        id: 'tenant-user-1',
        tenantId: 'tenant-1',
        userId: 'new-user-id',
        role: 'analyst',
        permissions: {},
        createdAt: new Date(),
      });

      await service.addUser({
        email: 'newuser@acme.com',
        password: 'SecurePass123!',
        role: 'analyst',
      });

      // Verify the user was created with the current tenant's ID
      expect(mockAdminCreateUser).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'tenant-1', // Current tenant ID
        'acme-corp', // Current tenant slug
        expect.any(String),
      );
    });

    it('should not expose users from other tenants in listing', async () => {
      mockTenantUserFindMany.mockResolvedValue([]);

      await service.listUsers();

      // Verify the query filters by current tenant
      expect(mockTenantUserFindMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('role-based permissions', () => {
    it('should set correct permissions for admin role', async () => {
      mockAdminGetUser.mockResolvedValue(null);
      mockAdminCreateUser.mockResolvedValue('new-admin-id');
      mockTenantFindUnique.mockResolvedValue({
        id: 'tenant-1',
        name: 'Acme Corp',
        slug: 'acme-corp',
        tier: 'enterprise',
        status: 'active',
        settings: { maxUsers: 100 },
        _count: { users: 5 },
      });
      mockTenantUserCreate.mockResolvedValue({
        id: 'tenant-user-1',
        tenantId: 'tenant-1',
        userId: 'new-admin-id',
        role: 'admin',
        permissions: {
          canCreateDeals: true,
          canDeleteDeals: true,
          canUploadDocuments: true,
          canManageUsers: true,
          canViewAuditLogs: true,
          canExportData: true,
        },
        createdAt: new Date(),
      });

      await service.addUser({
        email: 'newadmin@acme.com',
        password: 'SecurePass123!',
        role: 'admin',
      });

      expect(mockTenantUserCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          role: 'admin',
          permissions: expect.objectContaining({
            canManageUsers: true,
            canDeleteDeals: true,
          }),
        }),
      });
    });

    it('should set correct permissions for viewer role', async () => {
      mockAdminGetUser.mockResolvedValue(null);
      mockAdminCreateUser.mockResolvedValue('new-viewer-id');
      mockTenantFindUnique.mockResolvedValue({
        id: 'tenant-1',
        name: 'Acme Corp',
        slug: 'acme-corp',
        tier: 'enterprise',
        status: 'active',
        settings: { maxUsers: 100 },
        _count: { users: 5 },
      });
      mockTenantUserCreate.mockResolvedValue({
        id: 'tenant-user-1',
        tenantId: 'tenant-1',
        userId: 'new-viewer-id',
        role: 'viewer',
        permissions: {
          canCreateDeals: false,
          canDeleteDeals: false,
          canUploadDocuments: false,
          canManageUsers: false,
          canViewAuditLogs: false,
          canExportData: false,
        },
        createdAt: new Date(),
      });

      await service.addUser({
        email: 'newviewer@acme.com',
        password: 'SecurePass123!',
        role: 'viewer',
      });

      expect(mockTenantUserCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          role: 'viewer',
          permissions: expect.objectContaining({
            canManageUsers: false,
            canCreateDeals: false,
          }),
        }),
      });
    });
  });
});
