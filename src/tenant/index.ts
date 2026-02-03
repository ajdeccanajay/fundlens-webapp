/**
 * Tenant Module Exports
 * 
 * Central export point for all tenant-related functionality.
 */

// Types and interfaces
export type { TenantContext, TenantPermissions } from './tenant-context';
export {
  DEFAULT_TENANT_ID,
  ROLE_PERMISSIONS,
  TENANT_CONTEXT_KEY,
  getPermissionsForRole,
  isTenantContext,
  isPlatformAdmin,
} from './tenant-context';

// Guard
export { TenantGuard, IS_PUBLIC_KEY } from './tenant.guard';
export {
  TenantRateLimitGuard,
  RateLimit,
  RATE_LIMIT_KEY,
  DEFAULT_RATE_LIMITS,
} from './tenant-rate-limit.guard';
export type { RateLimitConfig } from './tenant-rate-limit.guard';

// Decorators
export {
  Public,
  Tenant,
  TenantId,
  UserId,
  RequirePermission,
  RequireRole,
  REQUIRE_PERMISSION_KEY,
  REQUIRE_ROLE_KEY,
} from './decorators';

// Interceptors and Filters
export { TenantResponseInterceptor } from './tenant-response.interceptor';
export { TenantExceptionFilter } from './tenant-exception.filter';

// Services
export { TenantAwarePrismaService } from './tenant-aware-prisma.service';
export { TenantAwareS3Service } from './tenant-aware-s3.service';
export { TenantAwareRAGService } from './tenant-aware-rag.service';
export { TenantUserService } from './tenant-user.service';
export type { AddTenantUserDto, UpdateTenantUserRoleDto, TenantUserInfo } from './tenant-user.service';
export { AuditService, AuditActions } from './audit.service';
export type { AuditLogEntry, AuditLogRecord, AuditLogQuery } from './audit.service';

// Controllers
export { TenantUserController } from './tenant-user.controller';
export { AuditController } from './audit.controller';

// Module
export { TenantModule } from './tenant.module';
