/**
 * Tenant Rate Limit Guard
 * 
 * Per-tenant rate limiting to prevent abuse and ensure fair resource usage.
 * Uses in-memory storage with sliding window algorithm.
 * 
 * Features:
 * - Per-tenant rate limit counters
 * - Tier-based rate limits (free/pro/enterprise)
 * - Sliding window algorithm for smooth rate limiting
 * - Configurable limits per endpoint
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContext, TENANT_CONTEXT_KEY } from './tenant-context';

// Decorator key for custom rate limits
export const RATE_LIMIT_KEY = 'rateLimit';

// Rate limit configuration
export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

// Default rate limits by tier (requests per minute)
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  free: { limit: 60, windowMs: 60000 },      // 60 requests per minute
  pro: { limit: 300, windowMs: 60000 },      // 300 requests per minute
  enterprise: { limit: 1000, windowMs: 60000 }, // 1000 requests per minute
};

// In-memory rate limit storage
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(TenantRateLimitGuard.name);
  
  // In-memory storage for rate limits
  // In production, use Redis for distributed rate limiting
  private readonly rateLimitStore = new Map<string, RateLimitEntry>();
  
  // Cleanup interval (every 5 minutes)
  private readonly cleanupInterval = 5 * 60 * 1000;
  private lastCleanup = Date.now();

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const tenantContext: TenantContext = request[TENANT_CONTEXT_KEY];

    // Skip rate limiting if no tenant context (public routes)
    if (!tenantContext) {
      return true;
    }

    // Get rate limit config (custom or default based on tier)
    const customLimit = this.reflector.getAllAndOverride<RateLimitConfig>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    const config = customLimit || DEFAULT_RATE_LIMITS[tenantContext.tenantTier] || DEFAULT_RATE_LIMITS.free;

    // Check rate limit
    const key = this.getRateLimitKey(tenantContext.tenantId, request.path);
    const allowed = this.checkRateLimit(key, config);

    if (!allowed) {
      this.logger.warn(
        `Rate limit exceeded for tenant ${tenantContext.tenantId} on ${request.path}`
      );
      
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: Math.ceil(config.windowMs / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Periodic cleanup of expired entries
    this.cleanupIfNeeded();

    return true;
  }

  /**
   * Generate rate limit key for tenant + path combination
   */
  private getRateLimitKey(tenantId: string, path: string): string {
    // Normalize path to group similar endpoints
    const normalizedPath = this.normalizePath(path);
    return `${tenantId}:${normalizedPath}`;
  }

  /**
   * Normalize path to group similar endpoints
   * e.g., /api/v1/deals/123 -> /api/v1/deals/:id
   */
  private normalizePath(path: string): string {
    return path
      .replace(/\/[a-f0-9-]{36}/g, '/:id') // Replace UUIDs
      .replace(/\/\d+/g, '/:id'); // Replace numeric IDs
  }

  /**
   * Check if request is within rate limit using sliding window
   */
  private checkRateLimit(key: string, config: RateLimitConfig): boolean {
    const now = Date.now();
    const entry = this.rateLimitStore.get(key);

    if (!entry) {
      // First request - create new entry
      this.rateLimitStore.set(key, {
        count: 1,
        windowStart: now,
      });
      return true;
    }

    // Check if window has expired
    if (now - entry.windowStart >= config.windowMs) {
      // Reset window
      this.rateLimitStore.set(key, {
        count: 1,
        windowStart: now,
      });
      return true;
    }

    // Check if within limit
    if (entry.count < config.limit) {
      entry.count++;
      return true;
    }

    // Rate limit exceeded
    return false;
  }

  /**
   * Get current rate limit status for a tenant
   */
  getRateLimitStatus(tenantId: string, path: string, tier: string): {
    remaining: number;
    limit: number;
    resetAt: Date;
  } {
    const key = this.getRateLimitKey(tenantId, path);
    const config = DEFAULT_RATE_LIMITS[tier] || DEFAULT_RATE_LIMITS.free;
    const entry = this.rateLimitStore.get(key);

    if (!entry) {
      return {
        remaining: config.limit,
        limit: config.limit,
        resetAt: new Date(Date.now() + config.windowMs),
      };
    }

    const now = Date.now();
    if (now - entry.windowStart >= config.windowMs) {
      return {
        remaining: config.limit,
        limit: config.limit,
        resetAt: new Date(now + config.windowMs),
      };
    }

    return {
      remaining: Math.max(0, config.limit - entry.count),
      limit: config.limit,
      resetAt: new Date(entry.windowStart + config.windowMs),
    };
  }

  /**
   * Reset rate limit for a tenant (admin use)
   */
  resetRateLimit(tenantId: string, path?: string): void {
    if (path) {
      const key = this.getRateLimitKey(tenantId, path);
      this.rateLimitStore.delete(key);
    } else {
      // Reset all limits for tenant
      for (const key of this.rateLimitStore.keys()) {
        if (key.startsWith(`${tenantId}:`)) {
          this.rateLimitStore.delete(key);
        }
      }
    }
  }

  /**
   * Cleanup expired entries periodically
   */
  private cleanupIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) {
      return;
    }

    this.lastCleanup = now;
    const maxAge = Math.max(...Object.values(DEFAULT_RATE_LIMITS).map(c => c.windowMs));

    for (const [key, entry] of this.rateLimitStore.entries()) {
      if (now - entry.windowStart > maxAge) {
        this.rateLimitStore.delete(key);
      }
    }

    this.logger.debug(`Rate limit cleanup: ${this.rateLimitStore.size} entries remaining`);
  }

  /**
   * Get all rate limit entries (for monitoring)
   */
  getAllEntries(): Map<string, RateLimitEntry> {
    return new Map(this.rateLimitStore);
  }
}

/**
 * Decorator to set custom rate limit for an endpoint
 * 
 * @example
 * @RateLimit({ limit: 10, windowMs: 60000 })
 * @Post('expensive-operation')
 * expensiveOperation() { ... }
 */
import { SetMetadata } from '@nestjs/common';
export const RateLimit = (config: RateLimitConfig) =>
  SetMetadata(RATE_LIMIT_KEY, config);
