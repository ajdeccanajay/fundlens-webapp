/**
 * Platform Admin Service
 * 
 * Internal service for platform-level administration.
 * Handles client (tenant) onboarding, user management across tenants,
 * and system-wide operations.
 * 
 * This service should ONLY be called from admin-protected endpoints.
 * It bypasses all tenant isolation checks by design.
 */

import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CognitoAuthService } from '../auth/cognito-auth.service';
import * as crypto from 'crypto';

export interface CreateClientDto {
  name: string;
  slug?: string;
  tier: 'free' | 'pro' | 'enterprise';
  settings?: Record<string, any>;
  adminEmail: string;
  adminPassword: string;
  adminName?: string;
}

export interface AddUserToClientDto {
  email: string;
  password: string;
  role: 'admin' | 'analyst' | 'viewer';
  name?: string;
}

export interface ClientInfo {
  id: string;
  name: string;
  slug: string;
  tier: string;
  status: string;
  settings: any;
  createdAt: Date;
  updatedAt: Date;
  userCount: number;
  dealCount: number;
}

export interface ClientUserInfo {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  lastLogin?: Date;
}

@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cognitoAuth: CognitoAuthService,
  ) {}

  /**
   * Create a new client (tenant) with initial admin user
   * This is the primary onboarding method for enterprise clients
   */
  async createClient(dto: CreateClientDto): Promise<{
    client: ClientInfo;
    adminUser: { userId: string; email: string };
  }> {
    this.logger.log(`Creating new client: ${dto.name}`);

    // Generate slug if not provided
    const slug = dto.slug || this.generateSlug(dto.name);

    // Validate slug is unique
    const existingTenant = await this.prisma.tenant.findUnique({
      where: { slug },
    });

    if (existingTenant) {
      throw new BadRequestException(`Client with slug '${slug}' already exists`);
    }

    // Validate email format
    if (!this.isValidEmail(dto.adminEmail)) {
      throw new BadRequestException('Invalid admin email format');
    }

    // Check if user already exists in Cognito
    const existingUser = await this.cognitoAuth.adminGetUser(dto.adminEmail);
    if (existingUser) {
      throw new BadRequestException(`User with email '${dto.adminEmail}' already exists`);
    }

    // Create tenant in database
    const tenant = await this.prisma.tenant.create({
      data: {
        name: dto.name,
        slug,
        tier: dto.tier,
        status: 'active',
        settings: dto.settings || this.getDefaultSettings(dto.tier),
      },
    });

    this.logger.log(`Created tenant: ${tenant.id}`);

    try {
      // Create admin user in Cognito
      const userId = await this.cognitoAuth.adminCreateUser(
        dto.adminEmail,
        dto.adminPassword,
        tenant.id,
        slug,
        'admin',
      );

      // Create tenant_user record
      await this.prisma.tenantUser.create({
        data: {
          tenantId: tenant.id,
          userId,
          role: 'admin',
          permissions: this.getAdminPermissions(),
        },
      });

      this.logger.log(`Created admin user for tenant ${tenant.id}: ${dto.adminEmail}`);

      // Get client info with counts
      const clientInfo = await this.getClientInfo(tenant.id);

      return {
        client: clientInfo,
        adminUser: {
          userId,
          email: dto.adminEmail,
        },
      };
    } catch (error) {
      // Rollback tenant creation if user creation fails
      this.logger.error(`Failed to create admin user, rolling back tenant: ${error.message}`);
      await this.prisma.tenant.delete({ where: { id: tenant.id } });
      throw error;
    }
  }


  /**
   * Add a user to an existing client
   */
  async addUserToClient(
    clientId: string,
    dto: AddUserToClientDto,
  ): Promise<ClientUserInfo> {
    this.logger.log(`Adding user to client ${clientId}: ${dto.email}`);

    // Verify client exists
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: clientId },
    });

    if (!tenant) {
      throw new NotFoundException('Client not found');
    }

    if (tenant.status !== 'active') {
      throw new BadRequestException('Cannot add users to inactive client');
    }

    // Check if user already exists
    const existingUser = await this.cognitoAuth.adminGetUser(dto.email);
    if (existingUser) {
      throw new BadRequestException(`User with email '${dto.email}' already exists`);
    }

    // Create user in Cognito
    const userId = await this.cognitoAuth.adminCreateUser(
      dto.email,
      dto.password,
      tenant.id,
      tenant.slug,
      dto.role,
    );

    // Create tenant_user record
    const tenantUser = await this.prisma.tenantUser.create({
      data: {
        tenantId: tenant.id,
        userId,
        role: dto.role,
        permissions: this.getRolePermissions(dto.role),
      },
    });

    this.logger.log(`Added user ${dto.email} to client ${clientId}`);

    return {
      id: tenantUser.id,
      email: dto.email,
      role: dto.role,
      createdAt: tenantUser.createdAt,
    };
  }

  /**
   * Remove a user from a client
   */
  async removeUserFromClient(clientId: string, userEmail: string): Promise<void> {
    this.logger.log(`Removing user from client ${clientId}: ${userEmail}`);

    // Get user from Cognito to get userId
    const cognitoUser = await this.cognitoAuth.adminGetUser(userEmail);
    if (!cognitoUser) {
      throw new NotFoundException('User not found');
    }

    // Verify user belongs to this client
    if (cognitoUser.tenantId !== clientId) {
      throw new BadRequestException('User does not belong to this client');
    }

    // Delete tenant_user record
    await this.prisma.tenantUser.deleteMany({
      where: {
        tenantId: clientId,
        userId: cognitoUser.userId,
      },
    });

    // Delete user from Cognito
    await this.cognitoAuth.adminDeleteUser(userEmail);

    this.logger.log(`Removed user ${userEmail} from client ${clientId}`);
  }

  /**
   * Update user role within a client
   */
  async updateUserRole(
    clientId: string,
    userEmail: string,
    newRole: 'admin' | 'analyst' | 'viewer',
  ): Promise<void> {
    this.logger.log(`Updating user role in client ${clientId}: ${userEmail} -> ${newRole}`);

    // Get user from Cognito
    const cognitoUser = await this.cognitoAuth.adminGetUser(userEmail);
    if (!cognitoUser) {
      throw new NotFoundException('User not found');
    }

    // Verify user belongs to this client
    if (cognitoUser.tenantId !== clientId) {
      throw new BadRequestException('User does not belong to this client');
    }

    // Update Cognito attributes
    await this.cognitoAuth.adminUpdateUserTenant(
      userEmail,
      clientId,
      cognitoUser.tenantSlug,
      newRole,
    );

    // Update tenant_user record
    await this.prisma.tenantUser.updateMany({
      where: {
        tenantId: clientId,
        userId: cognitoUser.userId,
      },
      data: {
        role: newRole,
        permissions: this.getRolePermissions(newRole),
      },
    });

    this.logger.log(`Updated user ${userEmail} role to ${newRole}`);
  }

  /**
   * List all clients (tenants)
   */
  async listClients(options?: {
    status?: string;
    tier?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ clients: ClientInfo[]; total: number }> {
    const where: any = {};
    
    if (options?.status) {
      where.status = options.status;
    }
    if (options?.tier) {
      where.tier = options.tier;
    }

    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        take: options?.limit || 50,
        skip: options?.offset || 0,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              users: true,
            },
          },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    const clients = await Promise.all(
      tenants.map(async (t) => this.getClientInfo(t.id)),
    );

    return { clients, total };
  }

  /**
   * Get detailed client info
   */
  async getClient(clientId: string): Promise<ClientInfo> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: clientId },
    });

    if (!tenant) {
      throw new NotFoundException('Client not found');
    }

    return this.getClientInfo(clientId);
  }

  /**
   * List users for a specific client
   */
  async listClientUsers(clientId: string): Promise<ClientUserInfo[]> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: clientId },
    });

    if (!tenant) {
      throw new NotFoundException('Client not found');
    }

    const tenantUsers = await this.prisma.tenantUser.findMany({
      where: { tenantId: clientId },
      orderBy: { createdAt: 'desc' },
    });

    // Get user details from Cognito for each user
    const users: ClientUserInfo[] = [];
    for (const tu of tenantUsers) {
      try {
        // Fetch user info from Cognito using the userId
        const cognitoUser = await this.cognitoAuth.adminGetUserById(tu.userId);
        users.push({
          id: tu.id,
          email: cognitoUser?.email || tu.userId, // Fallback to userId if Cognito lookup fails
          role: tu.role,
          createdAt: tu.createdAt,
        });
      } catch (error) {
        // If Cognito lookup fails, use userId as fallback
        this.logger.warn(`Failed to get Cognito user for ${tu.userId}: ${error.message}`);
        users.push({
          id: tu.id,
          email: tu.userId,
          role: tu.role,
          createdAt: tu.createdAt,
        });
      }
    }

    return users;
  }

  /**
   * Update client settings
   */
  async updateClient(
    clientId: string,
    updates: {
      name?: string;
      tier?: string;
      status?: string;
      settings?: Record<string, any>;
    },
  ): Promise<ClientInfo> {
    this.logger.log(`Updating client ${clientId}`);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: clientId },
    });

    if (!tenant) {
      throw new NotFoundException('Client not found');
    }

    await this.prisma.tenant.update({
      where: { id: clientId },
      data: {
        ...(updates.name && { name: updates.name }),
        ...(updates.tier && { tier: updates.tier }),
        ...(updates.status && { status: updates.status }),
        ...(updates.settings && { 
          settings: { ...tenant.settings as object, ...updates.settings } 
        }),
      },
    });

    this.logger.log(`Updated client ${clientId}`);

    return this.getClientInfo(clientId);
  }

  /**
   * Suspend a client (disable all access)
   */
  async suspendClient(clientId: string, reason?: string): Promise<void> {
    this.logger.log(`Suspending client ${clientId}: ${reason || 'No reason provided'}`);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: clientId },
    });

    if (!tenant) {
      throw new NotFoundException('Client not found');
    }

    await this.prisma.tenant.update({
      where: { id: clientId },
      data: {
        status: 'suspended',
        settings: {
          ...tenant.settings as object,
          suspendedAt: new Date().toISOString(),
          suspendReason: reason,
        },
      },
    });

    this.logger.log(`Suspended client ${clientId}`);
  }

  /**
   * Reactivate a suspended client
   */
  async reactivateClient(clientId: string): Promise<void> {
    this.logger.log(`Reactivating client ${clientId}`);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: clientId },
    });

    if (!tenant) {
      throw new NotFoundException('Client not found');
    }

    if (tenant.status !== 'suspended') {
      throw new BadRequestException('Client is not suspended');
    }

    await this.prisma.tenant.update({
      where: { id: clientId },
      data: {
        status: 'active',
        settings: {
          ...tenant.settings as object,
          reactivatedAt: new Date().toISOString(),
        },
      },
    });

    this.logger.log(`Reactivated client ${clientId}`);
  }

  /**
   * Get platform-wide statistics
   */
  async getPlatformStats(): Promise<{
    totalClients: number;
    activeClients: number;
    totalUsers: number;
    totalDeals: number;
    clientsByTier: Record<string, number>;
  }> {
    const [
      totalClients,
      activeClients,
      totalUsers,
      totalDeals,
      tierCounts,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: 'active' } }),
      this.prisma.tenantUser.count(),
      this.prisma.deal.count(),
      this.prisma.tenant.groupBy({
        by: ['tier'],
        _count: true,
      }),
    ]);

    const clientsByTier: Record<string, number> = {};
    for (const tc of tierCounts) {
      clientsByTier[tc.tier] = tc._count;
    }

    return {
      totalClients,
      activeClients,
      totalUsers,
      totalDeals,
      clientsByTier,
    };
  }

  // Private helper methods

  private async getClientInfo(tenantId: string): Promise<ClientInfo> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        _count: {
          select: {
            users: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('Client not found');
    }

    // Count deals for this tenant (once tenant_id is added to deals)
    // For now, return 0 as deals don't have tenant_id yet
    const dealCount = 0;

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      tier: tenant.tier,
      status: tenant.status,
      settings: tenant.settings,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      userCount: tenant._count.users,
      dealCount,
    };
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private getDefaultSettings(tier: string): Record<string, any> {
    const settings: Record<string, Record<string, any>> = {
      free: {
        maxDeals: 5,
        maxUploadsGB: 1,
        maxUsers: 3,
        features: ['basic_rag', 'sec_data'],
      },
      pro: {
        maxDeals: 50,
        maxUploadsGB: 25,
        maxUsers: 25,
        features: ['basic_rag', 'sec_data', 'document_upload', 'advanced_analytics'],
      },
      enterprise: {
        maxDeals: -1, // unlimited
        maxUploadsGB: -1,
        maxUsers: -1,
        features: ['basic_rag', 'sec_data', 'document_upload', 'advanced_analytics', 'api_access', 'custom_integrations'],
      },
    };

    return settings[tier] || settings.free;
  }

  private getAdminPermissions(): Record<string, any> {
    return {
      canCreateDeals: true,
      canDeleteDeals: true,
      canUploadDocuments: true,
      canManageUsers: true,
      canViewAuditLogs: true,
      canExportData: true,
    };
  }

  private getRolePermissions(role: string): Record<string, any> {
    const permissions: Record<string, Record<string, any>> = {
      admin: this.getAdminPermissions(),
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
