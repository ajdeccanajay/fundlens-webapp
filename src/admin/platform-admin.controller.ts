/**
 * Platform Admin Controller
 * 
 * INTERNAL ONLY - Hidden admin endpoints for platform management.
 * These endpoints are NOT documented in public API docs.
 * 
 * Security:
 * - Protected by PlatformAdminGuard (API key authentication)
 * - Uses obscured path prefix to avoid discovery
 * - All operations are logged
 * - Returns minimal error information to prevent enumeration
 * 
 * Usage:
 * All requests must include header: x-admin-key: <your-admin-key>
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';
import {
  PlatformAdminService,
  CreateClientDto,
  AddUserToClientDto,
  ClientInfo,
  ClientUserInfo,
} from './platform-admin.service';

// Request DTOs
class CreateClientRequestDto {
  name: string;
  slug?: string;
  tier: 'free' | 'pro' | 'enterprise';
  settings?: Record<string, any>;
  adminEmail: string;
  adminPassword: string;
}

class AddUserRequestDto {
  email: string;
  password: string;
  role: 'admin' | 'analyst' | 'viewer';
}

class UpdateClientRequestDto {
  name?: string;
  tier?: string;
  status?: string;
  settings?: Record<string, any>;
}

class UpdateUserRoleRequestDto {
  role: 'admin' | 'analyst' | 'viewer';
}

class SuspendClientRequestDto {
  reason?: string;
}

// Use obscured path - not /admin or /management
// Note: Global prefix 'api' is added by NestJS, so we use 'v1/internal/ops'
@Controller('v1/internal/ops')
@UseGuards(PlatformAdminGuard)
export class PlatformAdminController {
  private readonly logger = new Logger(PlatformAdminController.name);

  constructor(private readonly adminService: PlatformAdminService) {}

  // ==================== CLIENT MANAGEMENT ====================

  /**
   * Create a new client (tenant) with initial admin user
   * POST /api/v1/internal/ops/clients
   */
  @Post('clients')
  @HttpCode(HttpStatus.CREATED)
  async createClient(@Body() dto: CreateClientRequestDto): Promise<{
    success: boolean;
    client: ClientInfo;
    adminUser: { userId: string; email: string };
  }> {
    this.logger.log(`Creating client: ${dto.name}`);

    const result = await this.adminService.createClient(dto);

    return {
      success: true,
      ...result,
    };
  }

  /**
   * List all clients
   * GET /api/v1/internal/ops/clients
   */
  @Get('clients')
  async listClients(
    @Query('status') status?: string,
    @Query('tier') tier?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{
    success: boolean;
    clients: ClientInfo[];
    total: number;
  }> {
    const result = await this.adminService.listClients({
      status,
      tier,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });

    return {
      success: true,
      ...result,
    };
  }

  /**
   * Get client details
   * GET /api/v1/internal/ops/clients/:id
   */
  @Get('clients/:id')
  async getClient(@Param('id') id: string): Promise<{
    success: boolean;
    client: ClientInfo;
  }> {
    const client = await this.adminService.getClient(id);

    return {
      success: true,
      client,
    };
  }

  /**
   * Update client
   * PUT /api/v1/internal/ops/clients/:id
   */
  @Put('clients/:id')
  async updateClient(
    @Param('id') id: string,
    @Body() dto: UpdateClientRequestDto,
  ): Promise<{
    success: boolean;
    client: ClientInfo;
  }> {
    this.logger.log(`Updating client: ${id}`);

    const client = await this.adminService.updateClient(id, dto);

    return {
      success: true,
      client,
    };
  }

  /**
   * Suspend client
   * POST /api/v1/internal/ops/clients/:id/suspend
   */
  @Post('clients/:id/suspend')
  @HttpCode(HttpStatus.OK)
  async suspendClient(
    @Param('id') id: string,
    @Body() dto: SuspendClientRequestDto,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.log(`Suspending client: ${id}`);

    await this.adminService.suspendClient(id, dto.reason);

    return {
      success: true,
      message: 'Client suspended successfully',
    };
  }

  /**
   * Reactivate client
   * POST /api/v1/internal/ops/clients/:id/reactivate
   */
  @Post('clients/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivateClient(@Param('id') id: string): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.log(`Reactivating client: ${id}`);

    await this.adminService.reactivateClient(id);

    return {
      success: true,
      message: 'Client reactivated successfully',
    };
  }

  // ==================== USER MANAGEMENT ====================

  /**
   * List users for a client
   * GET /api/v1/internal/ops/clients/:id/users
   */
  @Get('clients/:id/users')
  async listClientUsers(@Param('id') id: string): Promise<{
    success: boolean;
    users: ClientUserInfo[];
  }> {
    const users = await this.adminService.listClientUsers(id);

    return {
      success: true,
      users,
    };
  }

  /**
   * Add user to client
   * POST /api/v1/internal/ops/clients/:id/users
   */
  @Post('clients/:id/users')
  @HttpCode(HttpStatus.CREATED)
  async addUserToClient(
    @Param('id') id: string,
    @Body() dto: AddUserRequestDto,
  ): Promise<{
    success: boolean;
    user: ClientUserInfo;
  }> {
    this.logger.log(`Adding user to client ${id}: ${dto.email}`);

    const user = await this.adminService.addUserToClient(id, dto);

    return {
      success: true,
      user,
    };
  }

  /**
   * Update user role
   * PUT /api/v1/internal/ops/clients/:id/users/:email/role
   */
  @Put('clients/:id/users/:email/role')
  async updateUserRole(
    @Param('id') id: string,
    @Param('email') email: string,
    @Body() dto: UpdateUserRoleRequestDto,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.log(`Updating user role in client ${id}: ${email} -> ${dto.role}`);

    await this.adminService.updateUserRole(id, decodeURIComponent(email), dto.role);

    return {
      success: true,
      message: 'User role updated successfully',
    };
  }

  /**
   * Remove user from client
   * DELETE /api/v1/internal/ops/clients/:id/users/:email
   */
  @Delete('clients/:id/users/:email')
  @HttpCode(HttpStatus.OK)
  async removeUserFromClient(
    @Param('id') id: string,
    @Param('email') email: string,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.log(`Removing user from client ${id}: ${email}`);

    await this.adminService.removeUserFromClient(id, decodeURIComponent(email));

    return {
      success: true,
      message: 'User removed successfully',
    };
  }

  // ==================== PLATFORM STATS ====================

  /**
   * Get platform-wide statistics
   * GET /api/v1/internal/ops/stats
   */
  @Get('stats')
  async getPlatformStats(): Promise<{
    success: boolean;
    stats: {
      totalClients: number;
      activeClients: number;
      totalUsers: number;
      totalDeals: number;
      clientsByTier: Record<string, number>;
    };
  }> {
    const stats = await this.adminService.getPlatformStats();

    return {
      success: true,
      stats,
    };
  }
}
