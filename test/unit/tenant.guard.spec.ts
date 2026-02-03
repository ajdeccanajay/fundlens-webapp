/**
 * TenantGuard Unit Tests
 * 
 * Tests for tenant context extraction and validation.
 * Validates Requirements 1.1, 1.4 from tenant-isolation spec.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { TenantGuard } from '../../src/tenant/tenant.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { TENANT_CONTEXT_KEY } from '../../src/tenant/tenant-context';

describe('TenantGuard', () => {
  let guard: TenantGuard;
  let prismaService: jest.Mocked<PrismaService>;
  let configService: jest.Mocked<ConfigService>;
  let reflector: jest.Mocked<Reflector>;

  const mockTenant = {
    id: 'tenant-123',
    name: 'Test Tenant',
    slug: 'test-tenant',
    tier: 'pro',
    status: 'active',
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const createMockExecutionContext = (headers: Record<string, string> = {}): ExecutionContext => {
    const mockRequest = {
      headers,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                COGNITO_USER_POOL_ID: 'us-east-1_test123',
                COGNITO_APP_CLIENT_ID: 'test-client-id',
                COGNITO_REGION: 'us-east-1',
              };
              return config[key];
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            tenant: {
              findUnique: jest.fn(),
            },
            tenantApiKey: {
              findFirst: jest.fn(),
              update: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    guard = module.get<TenantGuard>(TenantGuard);
    prismaService = module.get(PrismaService);
    configService = module.get(ConfigService);
    reflector = module.get(Reflector);
  });

  describe('Public routes', () => {
    it('should allow access to public routes without authentication', async () => {
      reflector.getAllAndOverride = jest.fn().mockReturnValue(true);
      
      const context = createMockExecutionContext();
      const result = await guard.canActivate(context);
      
      expect(result).toBe(true);
    });
  });

  describe('Missing authentication', () => {
    it('should throw UnauthorizedException when no auth header is provided', async () => {
      const context = createMockExecutionContext();
      
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for invalid Bearer token format', async () => {
      const context = createMockExecutionContext({
        authorization: 'InvalidFormat token123',
      });
      
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('JWT token validation', () => {
    it('should throw UnauthorizedException for expired JWT', async () => {
      // Create an expired JWT (simplified - real test would use actual expired token)
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImV4cCI6MTAwMDAwMDAwMH0.invalid';
      
      const context = createMockExecutionContext({
        authorization: `Bearer ${expiredToken}`,
      });
      
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for JWT missing tenant_id claim', async () => {
      // JWT without custom:tenant_id claim
      const tokenWithoutTenant = createTestJwt({
        sub: 'user-123',
        // No custom:tenant_id
      });
      
      const context = createMockExecutionContext({
        authorization: `Bearer ${tokenWithoutTenant}`,
      });
      
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Tenant validation', () => {
    it('should throw UnauthorizedException when tenant does not exist', async () => {
      const token = createTestJwt({
        sub: 'user-123',
        'custom:tenant_id': 'non-existent-tenant',
        'custom:tenant_slug': 'test',
        'custom:tenant_role': 'admin',
      });
      
      (prismaService.tenant.findUnique as jest.Mock).mockResolvedValue(null);
      
      const context = createMockExecutionContext({
        authorization: `Bearer ${token}`,
      });
      
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when tenant is not active', async () => {
      const token = createTestJwt({
        sub: 'user-123',
        'custom:tenant_id': 'tenant-123',
        'custom:tenant_slug': 'test',
        'custom:tenant_role': 'admin',
      });
      
      (prismaService.tenant.findUnique as jest.Mock).mockResolvedValue({
        ...mockTenant,
        status: 'suspended',
      });
      
      const context = createMockExecutionContext({
        authorization: `Bearer ${token}`,
      });
      
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should attach tenant context to request for valid JWT', async () => {
      const token = createTestJwt({
        sub: 'user-123',
        username: 'test@example.com',
        'custom:tenant_id': 'tenant-123',
        'custom:tenant_slug': 'test-tenant',
        'custom:tenant_role': 'admin',
      });
      
      (prismaService.tenant.findUnique as jest.Mock).mockResolvedValue(mockTenant);
      
      const mockRequest: any = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      };
      
      const context = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as ExecutionContext;
      
      const result = await guard.canActivate(context);
      
      expect(result).toBe(true);
      expect(mockRequest[TENANT_CONTEXT_KEY]).toBeDefined();
      expect(mockRequest[TENANT_CONTEXT_KEY].tenantId).toBe('tenant-123');
      expect(mockRequest[TENANT_CONTEXT_KEY].userId).toBe('user-123');
      expect(mockRequest[TENANT_CONTEXT_KEY].userRole).toBe('admin');
    });
  });

  describe('Role permissions', () => {
    it('should assign correct permissions for admin role', async () => {
      const token = createTestJwt({
        sub: 'user-123',
        'custom:tenant_id': 'tenant-123',
        'custom:tenant_slug': 'test',
        'custom:tenant_role': 'admin',
      });
      
      (prismaService.tenant.findUnique as jest.Mock).mockResolvedValue(mockTenant);
      
      const mockRequest: any = {
        headers: { authorization: `Bearer ${token}` },
      };
      
      const context = {
        switchToHttp: () => ({ getRequest: () => mockRequest }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as ExecutionContext;
      
      await guard.canActivate(context);
      
      const tenantContext = mockRequest[TENANT_CONTEXT_KEY];
      expect(tenantContext.permissions.canManageUsers).toBe(true);
      expect(tenantContext.permissions.canDeleteDeals).toBe(true);
    });

    it('should assign correct permissions for analyst role', async () => {
      const token = createTestJwt({
        sub: 'user-123',
        'custom:tenant_id': 'tenant-123',
        'custom:tenant_slug': 'test',
        'custom:tenant_role': 'analyst',
      });
      
      (prismaService.tenant.findUnique as jest.Mock).mockResolvedValue(mockTenant);
      
      const mockRequest: any = {
        headers: { authorization: `Bearer ${token}` },
      };
      
      const context = {
        switchToHttp: () => ({ getRequest: () => mockRequest }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as ExecutionContext;
      
      await guard.canActivate(context);
      
      const tenantContext = mockRequest[TENANT_CONTEXT_KEY];
      expect(tenantContext.permissions.canManageUsers).toBe(false);
      expect(tenantContext.permissions.canCreateDeals).toBe(true);
    });

    it('should assign correct permissions for viewer role', async () => {
      const token = createTestJwt({
        sub: 'user-123',
        'custom:tenant_id': 'tenant-123',
        'custom:tenant_slug': 'test',
        'custom:tenant_role': 'viewer',
      });
      
      (prismaService.tenant.findUnique as jest.Mock).mockResolvedValue(mockTenant);
      
      const mockRequest: any = {
        headers: { authorization: `Bearer ${token}` },
      };
      
      const context = {
        switchToHttp: () => ({ getRequest: () => mockRequest }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as ExecutionContext;
      
      await guard.canActivate(context);
      
      const tenantContext = mockRequest[TENANT_CONTEXT_KEY];
      expect(tenantContext.permissions.canCreateDeals).toBe(false);
      expect(tenantContext.permissions.canUploadDocuments).toBe(false);
    });
  });
});

/**
 * Helper to create a test JWT token (not cryptographically valid, but parseable)
 * In production, the guard uses aws-jwt-verify which validates signatures
 */
function createTestJwt(payload: Record<string, any>): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = 'test-signature';
  
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
