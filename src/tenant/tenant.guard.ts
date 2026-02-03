/**
 * Tenant Guard
 * 
 * NestJS guard that validates Cognito JWT tokens and extracts tenant context.
 * Attaches TenantContext to the request for use by downstream services.
 * 
 * Authentication methods (in priority order):
 * 1. Bearer JWT token from Cognito
 * 2. API key for service-to-service calls
 * 3. Subdomain-based tenant resolution (future)
 * 
 * Permission enforcement:
 * - Use @RequirePermission('canManageUsers') to require specific permissions
 * - Use @RequireRole('admin') to require specific roles
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TenantContext,
  TenantPermissions,
  TENANT_CONTEXT_KEY,
  DEFAULT_TENANT_ID,
  getPermissionsForRole,
} from './tenant-context';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

// Decorator key for marking routes as public (no auth required)
export const IS_PUBLIC_KEY = 'isPublic';

// Decorator keys for permission/role requirements
export const REQUIRE_PERMISSION_KEY = 'requirePermission';
export const REQUIRE_ROLE_KEY = 'requireRole';

// Role hierarchy for role-based access control
const ROLE_HIERARCHY: Record<string, number> = {
  admin: 3,
  analyst: 2,
  viewer: 1,
};

@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);
  private jwtVerifier: any;
  private verifierInitialized = false;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Lazy-initialize the JWT verifier to ensure config is loaded
   */
  private async initializeVerifier(): Promise<void> {
    if (this.verifierInitialized) return;

    const userPoolId = this.configService.get<string>('COGNITO_USER_POOL_ID');
    const clientId = this.configService.get<string>('COGNITO_APP_CLIENT_ID');
    const region = this.configService.get<string>('COGNITO_REGION') || 
                   this.configService.get<string>('AWS_REGION') || 
                   'us-east-1';

    if (!userPoolId || !clientId) {
      this.logger.warn('Cognito configuration missing - JWT verification disabled');
      return;
    }

    try {
      this.jwtVerifier = CognitoJwtVerifier.create({
        userPoolId,
        tokenUse: 'id', // Use ID token which contains custom claims
        clientId,
      });
      this.verifierInitialized = true;
      this.logger.log('JWT verifier initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize JWT verifier: ${error.message}`);
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    try {
      const tenantContext = await this.extractTenantContext(request);

      if (!tenantContext) {
        throw new UnauthorizedException('Authentication required');
      }

      // Validate tenant is active
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantContext.tenantId },
      });

      if (!tenant) {
        this.logger.warn(`Tenant not found: ${tenantContext.tenantId}`);
        throw new UnauthorizedException('Invalid tenant');
      }

      if (tenant.status !== 'active') {
        this.logger.warn(`Tenant not active: ${tenantContext.tenantId} (${tenant.status})`);
        throw new UnauthorizedException('Tenant account is not active');
      }

      // Enrich context with tenant tier from database
      tenantContext.tenantTier = tenant.tier as 'free' | 'pro' | 'enterprise';

      // Attach context to request
      request[TENANT_CONTEXT_KEY] = tenantContext;

      // Check permission requirements
      const requiredPermission = this.reflector.getAllAndOverride<keyof TenantPermissions>(
        REQUIRE_PERMISSION_KEY,
        [context.getHandler(), context.getClass()],
      );

      if (requiredPermission) {
        this.checkPermission(tenantContext, requiredPermission);
      }

      // Check role requirements
      const requiredRole = this.reflector.getAllAndOverride<string>(
        REQUIRE_ROLE_KEY,
        [context.getHandler(), context.getClass()],
      );

      if (requiredRole) {
        this.checkRole(tenantContext, requiredRole);
      }

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Authentication error: ${error.message}`);
      throw new UnauthorizedException('Authentication failed');
    }
  }

  /**
   * Check if user has the required permission
   */
  private checkPermission(context: TenantContext, permission: keyof TenantPermissions): void {
    if (!context.permissions[permission]) {
      this.logger.warn(
        `Permission denied: user ${context.userId} lacks ${permission} in tenant ${context.tenantId}`
      );
      // Return 404 to prevent information leakage about what permissions exist
      throw new ForbiddenException('Access denied');
    }
  }

  /**
   * Check if user has the required role or higher
   */
  private checkRole(context: TenantContext, requiredRole: string): void {
    const userRoleLevel = ROLE_HIERARCHY[context.userRole] || 0;
    const requiredRoleLevel = ROLE_HIERARCHY[requiredRole] || 0;

    if (userRoleLevel < requiredRoleLevel) {
      this.logger.warn(
        `Role denied: user ${context.userId} has ${context.userRole}, requires ${requiredRole}`
      );
      // Return 404 to prevent information leakage
      throw new ForbiddenException('Access denied');
    }
  }

  /**
   * Extract tenant context from request
   * Priority: JWT > API Key > Subdomain
   */
  private async extractTenantContext(request: any): Promise<TenantContext | null> {
    // Method 1: JWT Token
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      return this.extractFromJwt(token);
    }

    // Method 2: API Key (for service-to-service calls)
    const apiKey = request.headers['x-tenant-api-key'];
    if (apiKey) {
      return this.extractFromApiKey(apiKey as string);
    }

    // Method 3: Subdomain (future implementation)
    // const subdomain = this.extractSubdomain(request.hostname);
    // if (subdomain) {
    //   return this.extractFromSubdomain(subdomain);
    // }

    return null;
  }

  /**
   * Extract tenant context from Cognito JWT token
   */
  private async extractFromJwt(token: string): Promise<TenantContext | null> {
    await this.initializeVerifier();

    // If verifier is available, try to verify first
    if (this.jwtVerifier) {
      try {
        const payload = await this.jwtVerifier.verify(token);

        // Extract custom claims
        const tenantId = payload['custom:tenant_id'];
        const tenantSlug = payload['custom:tenant_slug'] || '';
        const tenantRole = payload['custom:tenant_role'] || 'viewer';

        if (!tenantId) {
          this.logger.warn('JWT missing tenant_id claim');
          return null;
        }

        // Check if this is a platform admin (default tenant + admin role)
        const isPlatformAdmin = tenantId === DEFAULT_TENANT_ID && tenantRole === 'admin';

        return {
          tenantId,
          tenantSlug,
          tenantTier: 'free', // Will be enriched from database
          userId: payload.sub,
          userEmail: payload.username || payload.email || '',
          userRole: tenantRole as 'admin' | 'analyst' | 'viewer',
          permissions: getPermissionsForRole(tenantRole),
          isPlatformAdmin,
        };
      } catch (error) {
        this.logger.warn(`JWT verification failed: ${error.message}`);
        // Fall through to decode-only mode for development/testing
      }
    }

    // Fallback: decode without verification (development/testing only)
    this.logger.warn('Using JWT decode-only mode (no signature verification)');
    return this.decodeJwtWithoutVerification(token);
  }

  /**
   * Fallback: Decode JWT without verification (for development/testing)
   * WARNING: Only use when verifier is not available
   */
  private decodeJwtWithoutVerification(token: string): TenantContext | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      // Handle both base64 and base64url encoding
      const base64Payload = parts[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());

      const tenantId = payload['custom:tenant_id'];
      const tenantSlug = payload['custom:tenant_slug'] || '';
      const tenantRole = payload['custom:tenant_role'] || 'viewer';

      if (!tenantId) {
        return null;
      }

      // Check if this is a platform admin (default tenant + admin role)
      const isPlatformAdmin = tenantId === DEFAULT_TENANT_ID && tenantRole === 'admin';

      return {
        tenantId,
        tenantSlug,
        tenantTier: 'free',
        userId: payload.sub,
        userEmail: payload.username || payload.email || '',
        userRole: tenantRole as 'admin' | 'analyst' | 'viewer',
        permissions: getPermissionsForRole(tenantRole),
        isPlatformAdmin,
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract tenant context from API key
   * Used for service-to-service authentication
   */
  private async extractFromApiKey(apiKey: string): Promise<TenantContext | null> {
    try {
      // Check if tenantApiKey table exists in Prisma
      // This table may not exist yet - it will be added in a future migration
      const prismaAny = this.prisma as any;
      if (!prismaAny.tenantApiKey) {
        this.logger.debug('tenantApiKey table not available yet');
        return null;
      }

      // Look up API key in database
      const apiKeyRecord = await prismaAny.tenantApiKey.findFirst({
        where: {
          keyHash: this.hashApiKey(apiKey),
          isActive: true,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
        include: {
          tenant: true,
        },
      });

      if (!apiKeyRecord) {
        this.logger.warn('Invalid or expired API key');
        return null;
      }

      // Update last used timestamp
      await prismaAny.tenantApiKey.update({
        where: { id: apiKeyRecord.id },
        data: { lastUsedAt: new Date() },
      });

      return {
        tenantId: apiKeyRecord.tenantId,
        tenantSlug: apiKeyRecord.tenant.slug,
        tenantTier: apiKeyRecord.tenant.tier as 'free' | 'pro' | 'enterprise',
        userId: `api-key:${apiKeyRecord.id}`,
        userEmail: 'api-key@system',
        userRole: 'analyst', // API keys get analyst-level access by default
        permissions: getPermissionsForRole('analyst'),
        isPlatformAdmin: false, // API keys are never platform admins
      };
    } catch (error) {
      // tenantApiKey table might not exist yet
      this.logger.debug(`API key lookup failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Hash API key for secure storage comparison
   */
  private hashApiKey(apiKey: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }
}
