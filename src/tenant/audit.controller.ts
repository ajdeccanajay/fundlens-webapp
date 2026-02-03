/**
 * Audit Controller
 * 
 * REST API endpoints for audit log access.
 * Only users with canViewAuditLogs permission can access these endpoints.
 */

import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import { RequirePermission } from './decorators';
import { AuditService } from './audit.service';
import type { AuditLogRecord, AuditLogQuery } from './audit.service';

@Controller('api/v1/tenant/audit')
@UseGuards(TenantGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * List audit logs for the current tenant
   * GET /api/v1/tenant/audit/logs
   * 
   * Query parameters:
   * - startDate: ISO date string
   * - endDate: ISO date string
   * - userId: Filter by user
   * - action: Filter by action type
   * - resource: Filter by resource type
   * - success: Filter by success status (true/false)
   * - limit: Max results (default 100)
   * - offset: Pagination offset
   */
  @Get('logs')
  @RequirePermission('canViewAuditLogs')
  async getAuditLogs(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('resource') resource?: string,
    @Query('success') success?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ logs: AuditLogRecord[]; total: number }> {
    const query: AuditLogQuery = {};

    if (startDate) query.startDate = new Date(startDate);
    if (endDate) query.endDate = new Date(endDate);
    if (userId) query.userId = userId;
    if (action) query.action = action;
    if (resource) query.resource = resource;
    if (success !== undefined) query.success = success === 'true';
    if (limit) query.limit = parseInt(limit, 10);
    if (offset) query.offset = parseInt(offset, 10);

    return this.auditService.getAuditLogs(query);
  }

  /**
   * Get a specific audit log entry
   * GET /api/v1/tenant/audit/logs/:id
   */
  @Get('logs/:id')
  @RequirePermission('canViewAuditLogs')
  async getAuditLog(@Param('id') id: string): Promise<AuditLogRecord> {
    return this.auditService.getAuditLog(id);
  }

  /**
   * Get audit statistics for the current tenant
   * GET /api/v1/tenant/audit/stats
   * 
   * Query parameters:
   * - days: Number of days to include (default 30)
   */
  @Get('stats')
  @RequirePermission('canViewAuditLogs')
  async getAuditStats(
    @Query('days') days?: string,
  ): Promise<{
    totalEvents: number;
    successfulEvents: number;
    failedEvents: number;
    uniqueUsers: number;
    topActions: { action: string; count: number }[];
    topResources: { resource: string; count: number }[];
  }> {
    const daysNum = days ? parseInt(days, 10) : 30;
    return this.auditService.getAuditStats(daysNum);
  }
}
