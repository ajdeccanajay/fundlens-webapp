/**
 * TenantRateLimitGuard Unit Tests
 * 
 * Tests for per-tenant rate limiting functionality.
 * Validates:
 * - Per-tenant rate limit counters
 * - Tier-based rate limits
 * - Tenant isolation (one tenant's limit doesn't affect another)
 * - Sliding window algorithm
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  TenantRateLimitGuard,
  DEFAULT_RATE_LIMITS,
} from '../../src/tenant/tenant-rate-limit.guard';
import { TenantContext, TENANT_CONTEXT_KEY, ROLE_PERMISSIONS } from '../../src/tenant/tenant-context';

describe('TenantRateLimitGuard', () => {
  let guard: TenantRateLimitGuard;
  let reflector: Reflector;

  // Test tenant contexts
  const freeTenantContext: TenantContext = {
    tenantId: 'tenant-free',
    tenantSlug: 'free-corp',
    tenantTier: 'free',
    userId: 'user-1',
    userEmail: 'user@free.com',
    userRole: 'admin',
    permissions: ROLE_PERMISSIONS.admin,
  };

  const proTenantContext: TenantContext = {
    tenantId: 'tenant-pro',
    tenantSlug: 'pro-corp',
    tenantTier: 'pro',
    userId: 'user-2',
    userEmail: 'user@pro.com',
    userRole: 'admin',
    permissions: ROLE_PERMISSIONS.admin,
  };

  const enterpriseTenantContext: TenantContext = {
    tenantId: 'tenant-enterprise',
    tenantSlug: 'enterprise-corp',
    tenantTier: 'enterprise',
    userId: 'user-3',
    userEmail: 'user@enterprise.com',
    userRole: 'admin',
    permissions: ROLE_PERMISSIONS.admin,
  };

  const createMockContext = (tenantContext: TenantContext | null, path: string = '/api/v1/deals'): ExecutionContext => {
    const request = {
      [TENANT_CONTEXT_KEY]: tenantContext,
      path,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
      getArgs: () => [],
      getArgByIndex: () => ({}),
      switchToRpc: () => ({} as any),
      switchToWs: () => ({} as any),
      getType: () => 'http',
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantRateLimitGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn().mockReturnValue(null),
          },
        },
      ],
    }).compile();

    guard = module.get<TenantRateLimitGuard>(TenantRateLimitGuard);
    reflector = module.get<Reflector>(Reflector);

    // Reset rate limit store between tests
    guard.resetRateLimit('tenant-free');
    guard.resetRateLimit('tenant-pro');
    guard.resetRateLimit('tenant-enterprise');
  });

  describe('basic rate limiting', () => {
    it('should allow requests within rate limit', async () => {
      const context = createMockContext(freeTenantContext);

      // First request should be allowed
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should block requests exceeding rate limit', async () => {
      const context = createMockContext(freeTenantContext);
      const limit = DEFAULT_RATE_LIMITS.free.limit;

      // Make requests up to the limit
      for (let i = 0; i < limit; i++) {
        await guard.canActivate(context);
      }

      // Next request should be blocked
      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    });

    it('should return 429 status code when rate limited', async () => {
      const context = createMockContext(freeTenantContext);
      const limit = DEFAULT_RATE_LIMITS.free.limit;

      // Exhaust the limit
      for (let i = 0; i < limit; i++) {
        await guard.canActivate(context);
      }

      try {
        await guard.canActivate(context);
        fail('Should have thrown HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
    });

    it('should skip rate limiting for public routes (no tenant context)', async () => {
      const context = createMockContext(null);

      // Should always allow without tenant context
      for (let i = 0; i < 100; i++) {
        const result = await guard.canActivate(context);
        expect(result).toBe(true);
      }
    });
  });

  describe('tier-based rate limits', () => {
    it('should apply free tier limit (60/min)', async () => {
      const context = createMockContext(freeTenantContext);
      const limit = DEFAULT_RATE_LIMITS.free.limit;

      // Should allow up to limit
      for (let i = 0; i < limit; i++) {
        const result = await guard.canActivate(context);
        expect(result).toBe(true);
      }

      // Should block after limit
      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    });

    it('should apply pro tier limit (300/min)', async () => {
      const context = createMockContext(proTenantContext);
      const limit = DEFAULT_RATE_LIMITS.pro.limit;

      // Should allow up to limit
      for (let i = 0; i < limit; i++) {
        const result = await guard.canActivate(context);
        expect(result).toBe(true);
      }

      // Should block after limit
      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    });

    it('should apply enterprise tier limit (1000/min)', async () => {
      const context = createMockContext(enterpriseTenantContext);
      const limit = DEFAULT_RATE_LIMITS.enterprise.limit;

      // Should allow up to limit
      for (let i = 0; i < limit; i++) {
        const result = await guard.canActivate(context);
        expect(result).toBe(true);
      }

      // Should block after limit
      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    });
  });

  describe('tenant isolation', () => {
    it('should maintain separate counters per tenant', async () => {
      const freeContext = createMockContext(freeTenantContext);
      const proContext = createMockContext(proTenantContext);
      const freeLimit = DEFAULT_RATE_LIMITS.free.limit;

      // Exhaust free tenant's limit
      for (let i = 0; i < freeLimit; i++) {
        await guard.canActivate(freeContext);
      }

      // Free tenant should be blocked
      await expect(guard.canActivate(freeContext)).rejects.toThrow(HttpException);

      // Pro tenant should still be allowed
      const result = await guard.canActivate(proContext);
      expect(result).toBe(true);
    });

    it('should not affect other tenants when one is rate limited', async () => {
      const tenant1Context: TenantContext = {
        ...freeTenantContext,
        tenantId: 'tenant-1',
      };
      const tenant2Context: TenantContext = {
        ...freeTenantContext,
        tenantId: 'tenant-2',
      };

      const context1 = createMockContext(tenant1Context);
      const context2 = createMockContext(tenant2Context);
      const limit = DEFAULT_RATE_LIMITS.free.limit;

      // Exhaust tenant 1's limit
      for (let i = 0; i < limit; i++) {
        await guard.canActivate(context1);
      }

      // Tenant 1 should be blocked
      await expect(guard.canActivate(context1)).rejects.toThrow(HttpException);

      // Tenant 2 should have full limit available
      for (let i = 0; i < limit; i++) {
        const result = await guard.canActivate(context2);
        expect(result).toBe(true);
      }
    });
  });

  describe('path normalization', () => {
    it('should group similar paths together', async () => {
      const context1 = createMockContext(freeTenantContext, '/api/v1/deals/123');
      const context2 = createMockContext(freeTenantContext, '/api/v1/deals/456');
      const limit = DEFAULT_RATE_LIMITS.free.limit;

      // Both paths should share the same counter
      for (let i = 0; i < limit / 2; i++) {
        await guard.canActivate(context1);
        await guard.canActivate(context2);
      }

      // Both should be blocked now
      await expect(guard.canActivate(context1)).rejects.toThrow(HttpException);
      await expect(guard.canActivate(context2)).rejects.toThrow(HttpException);
    });

    it('should normalize UUID paths', async () => {
      const context = createMockContext(
        freeTenantContext,
        '/api/v1/deals/12345678-1234-1234-1234-123456789abc'
      );

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  describe('rate limit status', () => {
    it('should return correct remaining count', async () => {
      const context = createMockContext(freeTenantContext);
      const limit = DEFAULT_RATE_LIMITS.free.limit;

      // Make some requests
      for (let i = 0; i < 10; i++) {
        await guard.canActivate(context);
      }

      const status = guard.getRateLimitStatus(
        freeTenantContext.tenantId,
        '/api/v1/deals',
        'free'
      );

      expect(status.remaining).toBe(limit - 10);
      expect(status.limit).toBe(limit);
    });

    it('should return full limit for new tenant', () => {
      const status = guard.getRateLimitStatus(
        'new-tenant',
        '/api/v1/deals',
        'free'
      );

      expect(status.remaining).toBe(DEFAULT_RATE_LIMITS.free.limit);
    });
  });

  describe('rate limit reset', () => {
    it('should reset rate limit for specific path', async () => {
      const context = createMockContext(freeTenantContext);
      const limit = DEFAULT_RATE_LIMITS.free.limit;

      // Exhaust limit
      for (let i = 0; i < limit; i++) {
        await guard.canActivate(context);
      }

      // Should be blocked
      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);

      // Reset
      guard.resetRateLimit(freeTenantContext.tenantId, '/api/v1/deals');

      // Should be allowed again
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should reset all rate limits for tenant', async () => {
      const context1 = createMockContext(freeTenantContext, '/api/v1/deals');
      const context2 = createMockContext(freeTenantContext, '/api/v1/documents');

      // Make some requests on both paths
      await guard.canActivate(context1);
      await guard.canActivate(context2);

      // Reset all for tenant
      guard.resetRateLimit(freeTenantContext.tenantId);

      // Both should have full limits
      const status1 = guard.getRateLimitStatus(
        freeTenantContext.tenantId,
        '/api/v1/deals',
        'free'
      );
      const status2 = guard.getRateLimitStatus(
        freeTenantContext.tenantId,
        '/api/v1/documents',
        'free'
      );

      expect(status1.remaining).toBe(DEFAULT_RATE_LIMITS.free.limit);
      expect(status2.remaining).toBe(DEFAULT_RATE_LIMITS.free.limit);
    });
  });

  describe('custom rate limits', () => {
    it('should apply custom rate limit from decorator', async () => {
      const customLimit = { limit: 5, windowMs: 60000 };
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(customLimit);

      const context = createMockContext(enterpriseTenantContext);

      // Should allow up to custom limit
      for (let i = 0; i < customLimit.limit; i++) {
        const result = await guard.canActivate(context);
        expect(result).toBe(true);
      }

      // Should block after custom limit (not enterprise limit)
      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    });
  });

  describe('error response', () => {
    it('should include retryAfter in error response', async () => {
      const context = createMockContext(freeTenantContext);
      const limit = DEFAULT_RATE_LIMITS.free.limit;

      // Exhaust limit
      for (let i = 0; i < limit; i++) {
        await guard.canActivate(context);
      }

      try {
        await guard.canActivate(context);
        fail('Should have thrown HttpException');
      } catch (error) {
        const response = (error as HttpException).getResponse() as any;
        expect(response.retryAfter).toBeDefined();
        expect(response.retryAfter).toBeGreaterThan(0);
      }
    });
  });
});
