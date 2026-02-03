/**
 * Audit Service
 * 
 * Enterprise-grade audit logging for FundLens multi-tenant application.
 * Captures all data access operations with full context for compliance
 * and security monitoring.
 * 
 * Features:
 * - Tenant-scoped audit logs
 * - Comprehensive access logging (who, what, when, where)
 * - IP address and user agent tracking
 * - Query filtering and pagination
 * - Retention policy support
 */

import {
  Injectable,
  Logger,
  Inject,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext, TENANT_CONTEXT_KEY } from './tenant-context';

export interface AuditLogEntry {
  tenantId: string;
  userId: string;
  userEmail?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
  success: boolean;
  errorMessage?: string;
}

export interface AuditLogRecord {
  id: string;
  tenantId: string;
  userId: string;
  userEmail: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  details: Record<string, any>;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: Date;
  success: boolean;
  errorMessage: string | null;
}

export interface AuditLogQuery {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  action?: string;
  resource?: string;
  success?: boolean;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REQUEST) private readonly request: any,
  ) {}

  /**
   * Get tenant context from request (if available)
   */
  private get tenantContext(): TenantContext | null {
    return this.request?.[TENANT_CONTEXT_KEY] || null;
  }

  /**
   * Log a data access operation
   * This is the primary method for recording audit events
   */
  async logAccess(entry: Omit<AuditLogEntry, 'timestamp'>): Promise<void> {
    try {
      // Check if audit_logs table exists
      const prismaAny = this.prisma as any;
      if (!prismaAny.auditLog) {
        // Table doesn't exist yet - log to console instead
        this.logger.debug(`Audit: ${entry.action} ${entry.resource} by ${entry.userId}`);
        return;
      }

      await prismaAny.auditLog.create({
        data: {
          tenantId: entry.tenantId,
          userId: entry.userId,
          userEmail: entry.userEmail || null,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId || null,
          details: entry.details || {},
          ipAddress: entry.ipAddress || null,
          userAgent: entry.userAgent || null,
          timestamp: new Date(),
          success: entry.success,
          errorMessage: entry.errorMessage || null,
        },
      });

      this.logger.debug(
        `Audit logged: ${entry.action} ${entry.resource} by ${entry.userId} (${entry.success ? 'success' : 'failed'})`
      );
    } catch (error) {
      // Don't fail the main operation if audit logging fails
      this.logger.error(`Failed to log audit entry: ${error.message}`);
    }
  }

  /**
   * Log access from the current request context
   * Automatically extracts tenant, user, IP, and user agent
   */
  async logFromContext(
    action: string,
    resource: string,
    options?: {
      resourceId?: string;
      details?: Record<string, any>;
      success?: boolean;
      errorMessage?: string;
    }
  ): Promise<void> {
    const ctx = this.tenantContext;
    if (!ctx) {
      this.logger.warn('Cannot log audit - no tenant context available');
      return;
    }

    await this.logAccess({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      userEmail: ctx.userEmail,
      action,
      resource,
      resourceId: options?.resourceId,
      details: options?.details,
      ipAddress: this.getClientIp(),
      userAgent: this.getUserAgent(),
      success: options?.success ?? true,
      errorMessage: options?.errorMessage,
    });
  }

  /**
   * Get audit logs for the current tenant
   * Only users with canViewAuditLogs permission can access
   */
  async getAuditLogs(query?: AuditLogQuery): Promise<{
    logs: AuditLogRecord[];
    total: number;
  }> {
    const ctx = this.tenantContext;
    if (!ctx) {
      throw new ForbiddenException('Tenant context required');
    }

    if (!ctx.permissions.canViewAuditLogs) {
      throw new ForbiddenException('You do not have permission to view audit logs');
    }

    const prismaAny = this.prisma as any;
    if (!prismaAny.auditLog) {
      return { logs: [], total: 0 };
    }

    const where: any = {
      tenantId: ctx.tenantId,
    };

    if (query?.startDate) {
      where.timestamp = { ...where.timestamp, gte: query.startDate };
    }
    if (query?.endDate) {
      where.timestamp = { ...where.timestamp, lte: query.endDate };
    }
    if (query?.userId) {
      where.userId = query.userId;
    }
    if (query?.action) {
      where.action = query.action;
    }
    if (query?.resource) {
      where.resource = query.resource;
    }
    if (query?.success !== undefined) {
      where.success = query.success;
    }

    const [logs, total] = await Promise.all([
      prismaAny.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: query?.limit || 100,
        skip: query?.offset || 0,
      }),
      prismaAny.auditLog.count({ where }),
    ]);

    return { logs, total };
  }

  /**
   * Get a specific audit log entry
   * Returns 404 for logs from other tenants
   */
  async getAuditLog(id: string): Promise<AuditLogRecord> {
    const ctx = this.tenantContext;
    if (!ctx) {
      throw new ForbiddenException('Tenant context required');
    }

    if (!ctx.permissions.canViewAuditLogs) {
      throw new ForbiddenException('You do not have permission to view audit logs');
    }

    const prismaAny = this.prisma as any;
    if (!prismaAny.auditLog) {
      throw new NotFoundException('Audit log not found');
    }

    const log = await prismaAny.auditLog.findFirst({
      where: {
        id,
        tenantId: ctx.tenantId,
      },
    });

    if (!log) {
      throw new NotFoundException('Audit log not found');
    }

    return log;
  }

  /**
   * Get audit log statistics for the current tenant
   */
  async getAuditStats(days: number = 30): Promise<{
    totalEvents: number;
    successfulEvents: number;
    failedEvents: number;
    uniqueUsers: number;
    topActions: { action: string; count: number }[];
    topResources: { resource: string; count: number }[];
  }> {
    const ctx = this.tenantContext;
    if (!ctx) {
      throw new ForbiddenException('Tenant context required');
    }

    if (!ctx.permissions.canViewAuditLogs) {
      throw new ForbiddenException('You do not have permission to view audit logs');
    }

    const prismaAny = this.prisma as any;
    if (!prismaAny.auditLog) {
      return {
        totalEvents: 0,
        successfulEvents: 0,
        failedEvents: 0,
        uniqueUsers: 0,
        topActions: [],
        topResources: [],
      };
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const where = {
      tenantId: ctx.tenantId,
      timestamp: { gte: startDate },
    };

    const [
      totalEvents,
      successfulEvents,
      failedEvents,
      uniqueUsersResult,
      actionCounts,
      resourceCounts,
    ] = await Promise.all([
      prismaAny.auditLog.count({ where }),
      prismaAny.auditLog.count({ where: { ...where, success: true } }),
      prismaAny.auditLog.count({ where: { ...where, success: false } }),
      prismaAny.auditLog.groupBy({
        by: ['userId'],
        where,
        _count: true,
      }),
      prismaAny.auditLog.groupBy({
        by: ['action'],
        where,
        _count: true,
        orderBy: { _count: { action: 'desc' } },
        take: 10,
      }),
      prismaAny.auditLog.groupBy({
        by: ['resource'],
        where,
        _count: true,
        orderBy: { _count: { resource: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      totalEvents,
      successfulEvents,
      failedEvents,
      uniqueUsers: uniqueUsersResult.length,
      topActions: actionCounts.map((a: any) => ({
        action: a.action,
        count: a._count,
      })),
      topResources: resourceCounts.map((r: any) => ({
        resource: r.resource,
        count: r._count,
      })),
    };
  }

  // Helper methods

  /**
   * Extract client IP from request
   */
  private getClientIp(): string | undefined {
    if (!this.request) return undefined;

    // Check common headers for proxied requests
    const forwarded = this.request.headers?.['x-forwarded-for'];
    if (forwarded) {
      return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
    }

    const realIp = this.request.headers?.['x-real-ip'];
    if (realIp) {
      return Array.isArray(realIp) ? realIp[0] : realIp;
    }

    return this.request.ip || this.request.connection?.remoteAddress;
  }

  /**
   * Extract user agent from request
   */
  private getUserAgent(): string | undefined {
    if (!this.request) return undefined;
    const ua = this.request.headers?.['user-agent'];
    return Array.isArray(ua) ? ua[0] : ua;
  }
}

/**
 * Audit action constants for consistency
 */
export const AuditActions = {
  // Deal operations
  DEAL_CREATE: 'deal.create',
  DEAL_READ: 'deal.read',
  DEAL_UPDATE: 'deal.update',
  DEAL_DELETE: 'deal.delete',
  DEAL_LIST: 'deal.list',

  // Document operations
  DOCUMENT_UPLOAD: 'document.upload',
  DOCUMENT_DOWNLOAD: 'document.download',
  DOCUMENT_DELETE: 'document.delete',
  DOCUMENT_LIST: 'document.list',

  // Chat operations
  CHAT_MESSAGE: 'chat.message',
  CHAT_HISTORY: 'chat.history',
  CHAT_CLEAR: 'chat.clear',

  // RAG operations
  RAG_QUERY: 'rag.query',
  RAG_RETRIEVE: 'rag.retrieve',

  // User management
  USER_ADD: 'user.add',
  USER_REMOVE: 'user.remove',
  USER_UPDATE_ROLE: 'user.updateRole',
  USER_LIST: 'user.list',

  // Authentication
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_REFRESH: 'auth.refresh',

  // Admin operations
  ADMIN_VIEW_LOGS: 'admin.viewLogs',
  ADMIN_EXPORT_DATA: 'admin.exportData',
} as const;
