/**
 * Tenant User Service
 * 
 * Tenant-scoped user management service for FundLens multi-tenant application.
 * Allows tenant admins to manage users within their own tenant.
 * 
 * This service enforces tenant isolation - users can only manage users
 * within their own tenant. Cross-tenant operations are not allowed.
 * 
 * Security:
 * - All operations require admin role within the tenant
 * - Users cannot modify their own role (prevents privilege escalation)
 * - Tenant admins cannot create platform admins
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { CognitoAuthService } from '../auth/cognito-auth.service';
import { TenantContext, TENANT_CONTEXT_KEY, ROLE_PERMISSIONS } from './tenant-context';

export interface AddTenantUserDto {
  email: string;
  password: string;
  role: 'admin' | 'analyst' | 'viewer';
  name?: string;
}

export interface UpdateTenantUserRoleDto {
  role: 'admin' | 'analyst' | 'viewer';
}

export interface TenantUserInfo {
  id: string;
  userId: string;
  email: string;
  role: string;
  permissions: Record<string, any>;
  createdAt: Date;
}

@Injectable()
export class TenantUserService {
  private readonly logger = new Logger(TenantUserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cognitoAuth: CognitoAuthService,
    @Inject(REQUEST) private readonly request: any,
  ) {}

  /**
   * Get tenant context from request
   */
  private get tenantContext(): TenantContext {
    const ctx = this.request[TENANT_CONTEXT_KEY];
    if (!ctx) {
      throw new ForbiddenException('Tenant context not available');
    }
    return ctx;
  }

  /**
   * Verify the current user has admin permissions
   */
  private verifyAdminPermission(): void {
    if (!this.tenantContext.permissions.canManageUsers) {
      throw new ForbiddenException('You do not have permission to manage users');
    }
  }

  /**
   * Add a new user to the current tenant
   * Only tenant admins can add users
   */
  async addUser(dto: AddTenantUserDto): Promise<TenantUserInfo> {
    this.verifyAdminPermission();

    const tenantId = this.tenantContext.tenantId;
    const tenantSlug = this.tenantContext.tenantSlug;

    this.logger.log(`Adding user to tenant ${tenantId}: ${dto.email}`);

    // Validate email format
    if (!this.isValidEmail(dto.email)) {
      throw new BadRequestException('Invalid email format');
    }

    // Check if user already exists in Cognito
    const existingUser = await this.cognitoAuth.adminGetUser(dto.email);
    if (existingUser) {
      // Check if user belongs to a different tenant
      if (existingUser.tenantId !== tenantId) {
        // Return 404 to prevent information leakage about other tenants
        throw new NotFoundException('Unable to add user');
      }
      throw new BadRequestException('User already exists in this tenant');
    }

    // Get tenant to verify it's active and get settings
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        _count: { select: { users: true } },
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Check user limit based on tenant tier
    const settings = tenant.settings as Record<string, any>;
    const maxUsers = settings?.maxUsers ?? -1;
    if (maxUsers !== -1 && tenant._count.users >= maxUsers) {
      throw new BadRequestException(
        `User limit reached. Your plan allows ${maxUsers} users. Please upgrade to add more users.`
      );
    }

    // Create user in Cognito
    const userId = await this.cognitoAuth.adminCreateUser(
      dto.email,
      dto.password,
      tenantId,
      tenantSlug,
      dto.role,
    );

    // Create tenant_user record
    const tenantUser = await this.prisma.tenantUser.create({
      data: {
        tenantId,
        userId,
        role: dto.role,
        permissions: this.getRolePermissions(dto.role),
      },
    });

    this.logger.log(`Added user ${dto.email} to tenant ${tenantId} with role ${dto.role}`);

    return {
      id: tenantUser.id,
      userId,
      email: dto.email,
      role: dto.role,
      permissions: tenantUser.permissions as Record<string, any>,
      createdAt: tenantUser.createdAt,
    };
  }

  /**
   * Remove a user from the current tenant
   * Only tenant admins can remove users
   * Users cannot remove themselves
   */
  async removeUser(userEmail: string): Promise<void> {
    this.verifyAdminPermission();

    const tenantId = this.tenantContext.tenantId;
    const currentUserEmail = this.tenantContext.userEmail;

    this.logger.log(`Removing user from tenant ${tenantId}: ${userEmail}`);

    // Prevent self-removal
    if (userEmail.toLowerCase() === currentUserEmail.toLowerCase()) {
      throw new BadRequestException('You cannot remove yourself from the tenant');
    }

    // Get user from Cognito
    const cognitoUser = await this.cognitoAuth.adminGetUser(userEmail);
    if (!cognitoUser) {
      throw new NotFoundException('User not found');
    }

    // Verify user belongs to this tenant (return 404 for cross-tenant to prevent info leakage)
    if (cognitoUser.tenantId !== tenantId) {
      throw new NotFoundException('User not found');
    }

    // Delete tenant_user record
    await this.prisma.tenantUser.deleteMany({
      where: {
        tenantId,
        userId: cognitoUser.userId,
      },
    });

    // Delete user from Cognito
    await this.cognitoAuth.adminDeleteUser(userEmail);

    this.logger.log(`Removed user ${userEmail} from tenant ${tenantId}`);
  }

  /**
   * Update a user's role within the current tenant
   * Only tenant admins can update roles
   * Users cannot change their own role
   */
  async updateRole(userEmail: string, dto: UpdateTenantUserRoleDto): Promise<TenantUserInfo> {
    this.verifyAdminPermission();

    const tenantId = this.tenantContext.tenantId;
    const tenantSlug = this.tenantContext.tenantSlug;
    const currentUserEmail = this.tenantContext.userEmail;

    this.logger.log(`Updating user role in tenant ${tenantId}: ${userEmail} -> ${dto.role}`);

    // Prevent self-role-change (privilege escalation prevention)
    if (userEmail.toLowerCase() === currentUserEmail.toLowerCase()) {
      throw new BadRequestException('You cannot change your own role');
    }

    // Get user from Cognito
    const cognitoUser = await this.cognitoAuth.adminGetUser(userEmail);
    if (!cognitoUser) {
      throw new NotFoundException('User not found');
    }

    // Verify user belongs to this tenant
    if (cognitoUser.tenantId !== tenantId) {
      throw new NotFoundException('User not found');
    }

    // Update Cognito attributes
    await this.cognitoAuth.adminUpdateUserTenant(
      userEmail,
      tenantId,
      tenantSlug,
      dto.role,
    );

    // Update tenant_user record
    const updatedPermissions = this.getRolePermissions(dto.role);
    
    const tenantUser = await this.prisma.tenantUser.updateMany({
      where: {
        tenantId,
        userId: cognitoUser.userId,
      },
      data: {
        role: dto.role,
        permissions: updatedPermissions,
      },
    });

    if (tenantUser.count === 0) {
      throw new NotFoundException('User not found');
    }

    // Fetch updated record
    const updated = await this.prisma.tenantUser.findFirst({
      where: {
        tenantId,
        userId: cognitoUser.userId,
      },
    });

    this.logger.log(`Updated user ${userEmail} role to ${dto.role}`);

    return {
      id: updated!.id,
      userId: cognitoUser.userId,
      email: userEmail,
      role: dto.role,
      permissions: updatedPermissions,
      createdAt: updated!.createdAt,
    };
  }

  /**
   * List all users in the current tenant
   * All authenticated users can list users (for collaboration features)
   */
  async listUsers(): Promise<TenantUserInfo[]> {
    const tenantId = this.tenantContext.tenantId;

    this.logger.debug(`Listing users for tenant ${tenantId}`);

    const tenantUsers = await this.prisma.tenantUser.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    // Get user details from Cognito for each user
    const users: TenantUserInfo[] = [];
    
    for (const tu of tenantUsers) {
      // Try to get email from Cognito, fall back to userId
      let email = tu.userId;
      try {
        // Note: In production, batch these calls or cache user info
        // For now, userId is the email in our Cognito setup
        email = tu.userId;
      } catch {
        // If Cognito lookup fails, use userId
      }

      users.push({
        id: tu.id,
        userId: tu.userId,
        email,
        role: tu.role,
        permissions: tu.permissions as Record<string, any>,
        createdAt: tu.createdAt,
      });
    }

    return users;
  }

  /**
   * Get a specific user's info
   * Returns 404 for users not in the current tenant
   */
  async getUser(userEmail: string): Promise<TenantUserInfo> {
    const tenantId = this.tenantContext.tenantId;

    // Get user from Cognito
    const cognitoUser = await this.cognitoAuth.adminGetUser(userEmail);
    if (!cognitoUser) {
      throw new NotFoundException('User not found');
    }

    // Verify user belongs to this tenant
    if (cognitoUser.tenantId !== tenantId) {
      throw new NotFoundException('User not found');
    }

    // Get tenant_user record
    const tenantUser = await this.prisma.tenantUser.findFirst({
      where: {
        tenantId,
        userId: cognitoUser.userId,
      },
    });

    if (!tenantUser) {
      throw new NotFoundException('User not found');
    }

    return {
      id: tenantUser.id,
      userId: cognitoUser.userId,
      email: userEmail,
      role: tenantUser.role,
      permissions: tenantUser.permissions as Record<string, any>,
      createdAt: tenantUser.createdAt,
    };
  }

  /**
   * Check if a permission is granted for a specific action
   * Used by TenantGuard for permission enforcement
   */
  checkPermission(permission: keyof typeof ROLE_PERMISSIONS.admin): boolean {
    return this.tenantContext.permissions[permission] === true;
  }

  // Private helper methods

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private getRolePermissions(role: string): Record<string, any> {
    const permissions: Record<string, Record<string, any>> = {
      admin: {
        canCreateDeals: true,
        canDeleteDeals: true,
        canUploadDocuments: true,
        canManageUsers: true,
        canViewAuditLogs: true,
        canExportData: true,
      },
      analyst: {
        canCreateDeals: true,
        canDeleteDeals: false,
        canUploadDocuments: true,
        canManageUsers: false,
        canViewAuditLogs: false,
        canExportData: true,
      },
      viewer: {
        canCreateDeals: false,
        canDeleteDeals: false,
        canUploadDocuments: false,
        canManageUsers: false,
        canViewAuditLogs: false,
        canExportData: false,
      },
    };

    return permissions[role] || permissions.viewer;
  }
}
