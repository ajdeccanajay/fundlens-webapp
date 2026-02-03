/**
 * Tenant User Controller
 * 
 * REST API endpoints for tenant-level user management.
 * Allows tenant admins to manage users within their own tenant.
 * 
 * All endpoints require authentication via TenantGuard.
 * User management operations require admin role.
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import { TenantUserService } from './tenant-user.service';
import type { AddTenantUserDto, UpdateTenantUserRoleDto, TenantUserInfo } from './tenant-user.service';

@Controller('api/v1/tenant/users')
@UseGuards(TenantGuard)
export class TenantUserController {
  constructor(private readonly tenantUserService: TenantUserService) {}

  /**
   * List all users in the current tenant
   * GET /api/v1/tenant/users
   * 
   * All authenticated users can list users (for collaboration features)
   */
  @Get()
  async listUsers(): Promise<{ users: TenantUserInfo[] }> {
    const users = await this.tenantUserService.listUsers();
    return { users };
  }

  /**
   * Get a specific user's info
   * GET /api/v1/tenant/users/:email
   * 
   * Returns 404 for users not in the current tenant
   */
  @Get(':email')
  async getUser(@Param('email') email: string): Promise<TenantUserInfo> {
    return this.tenantUserService.getUser(decodeURIComponent(email));
  }

  /**
   * Add a new user to the current tenant
   * POST /api/v1/tenant/users
   * 
   * Requires admin role
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addUser(@Body() dto: AddTenantUserDto): Promise<TenantUserInfo> {
    return this.tenantUserService.addUser(dto);
  }

  /**
   * Update a user's role
   * PUT /api/v1/tenant/users/:email/role
   * 
   * Requires admin role
   * Users cannot change their own role
   */
  @Put(':email/role')
  async updateRole(
    @Param('email') email: string,
    @Body() dto: UpdateTenantUserRoleDto,
  ): Promise<TenantUserInfo> {
    return this.tenantUserService.updateRole(decodeURIComponent(email), dto);
  }

  /**
   * Remove a user from the current tenant
   * DELETE /api/v1/tenant/users/:email
   * 
   * Requires admin role
   * Users cannot remove themselves
   */
  @Delete(':email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeUser(@Param('email') email: string): Promise<void> {
    await this.tenantUserService.removeUser(decodeURIComponent(email));
  }
}
