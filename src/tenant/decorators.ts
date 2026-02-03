/**
 * Tenant Decorators
 * 
 * Custom decorators for tenant-aware endpoints.
 */

import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantContext, TENANT_CONTEXT_KEY } from './tenant-context';

/**
 * Mark a route as public (no authentication required)
 * 
 * @example
 * @Public()
 * @Get('health')
 * healthCheck() { return { status: 'ok' }; }
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Extract TenantContext from the request
 * 
 * @example
 * @Get('deals')
 * getDeals(@Tenant() tenant: TenantContext) {
 *   return this.dealService.findAll(tenant.tenantId);
 * }
 */
export const Tenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest();
    return request[TENANT_CONTEXT_KEY];
  },
);

/**
 * Extract just the tenant ID from the request
 * 
 * @example
 * @Get('deals')
 * getDeals(@TenantId() tenantId: string) {
 *   return this.dealService.findAll(tenantId);
 * }
 */
export const TenantId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const tenantContext: TenantContext = request[TENANT_CONTEXT_KEY];
    return tenantContext?.tenantId;
  },
);

/**
 * Extract the user ID from the request
 * 
 * @example
 * @Post('deals')
 * createDeal(@UserId() userId: string, @Body() dto: CreateDealDto) {
 *   return this.dealService.create(userId, dto);
 * }
 */
export const UserId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const tenantContext: TenantContext = request[TENANT_CONTEXT_KEY];
    return tenantContext?.userId;
  },
);

/**
 * Check if user has a specific permission
 * Use with a custom guard for permission-based access control
 * 
 * @example
 * @RequirePermission('canManageUsers')
 * @Post('users')
 * addUser(@Body() dto: AddUserDto) { ... }
 */
export const REQUIRE_PERMISSION_KEY = 'requirePermission';
export const RequirePermission = (permission: keyof import('./tenant-context').TenantPermissions) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);

/**
 * Require a specific role or higher
 * 
 * @example
 * @RequireRole('admin')
 * @Delete('deals/:id')
 * deleteDeal(@Param('id') id: string) { ... }
 */
export const REQUIRE_ROLE_KEY = 'requireRole';
export const RequireRole = (role: 'admin' | 'analyst' | 'viewer') =>
  SetMetadata(REQUIRE_ROLE_KEY, role);
