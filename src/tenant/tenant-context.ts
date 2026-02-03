/**
 * Tenant Context Types and Interfaces
 * 
 * Request-scoped context containing authenticated tenant and user information.
 * Extracted from Cognito JWT tokens and attached to every authenticated request.
 * 
 * PLATFORM ADMIN: Users in the default tenant (00000000-0000-0000-0000-000000000000)
 * with admin role are considered platform admins and can view all tenant data.
 */

// Default tenant ID for platform administration
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  tenantTier: 'free' | 'pro' | 'enterprise';
  userId: string;
  userEmail: string;
  userRole: 'admin' | 'analyst' | 'viewer';
  permissions: TenantPermissions;
  isPlatformAdmin: boolean; // True if default tenant admin
}

export interface TenantPermissions {
  canCreateDeals: boolean;
  canDeleteDeals: boolean;
  canUploadDocuments: boolean;
  canManageUsers: boolean;
  canViewAuditLogs: boolean;
  canExportData: boolean;
  maxDeals: number;
  maxUploadsGB: number;
}

/**
 * Role-based default permissions
 * These are the baseline permissions for each role.
 * Tenant-specific settings may override these.
 */
export const ROLE_PERMISSIONS: Record<string, TenantPermissions> = {
  admin: {
    canCreateDeals: true,
    canDeleteDeals: true,
    canUploadDocuments: true,
    canManageUsers: true,
    canViewAuditLogs: true,
    canExportData: true,
    maxDeals: -1, // unlimited
    maxUploadsGB: -1,
  },
  analyst: {
    canCreateDeals: true,
    canDeleteDeals: false,
    canUploadDocuments: true,
    canManageUsers: false,
    canViewAuditLogs: false,
    canExportData: true,
    maxDeals: 50,
    maxUploadsGB: 10,
  },
  viewer: {
    canCreateDeals: false,
    canDeleteDeals: false,
    canUploadDocuments: false,
    canManageUsers: false,
    canViewAuditLogs: false,
    canExportData: false,
    maxDeals: 0,
    maxUploadsGB: 0,
  },
};

/**
 * Request decorator key for storing tenant context
 */
export const TENANT_CONTEXT_KEY = 'tenantContext';

/**
 * Helper to get permissions for a role, with fallback to viewer
 */
export function getPermissionsForRole(role: string): TenantPermissions {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer;
}

/**
 * Type guard to check if a value is a valid TenantContext
 */
export function isTenantContext(value: unknown): value is TenantContext {
  if (!value || typeof value !== 'object') return false;
  const ctx = value as Record<string, unknown>;
  return (
    typeof ctx.tenantId === 'string' &&
    typeof ctx.userId === 'string' &&
    typeof ctx.userRole === 'string'
  );
}

/**
 * Check if a tenant context represents a platform admin
 * Platform admins are users in the default tenant with admin role
 */
export function isPlatformAdmin(context: TenantContext): boolean {
  return context.tenantId === DEFAULT_TENANT_ID && context.userRole === 'admin';
}
