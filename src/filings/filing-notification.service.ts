import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { DistributedLockService } from '../common/distributed-lock.service';

export interface FilingNotification {
  id: string;
  tenantId: string;
  ticker: string;
  filingType: string;
  filingDate: Date;
  reportDate: Date | null;
  accessionNumber: string;
  dismissed: boolean;
  dismissedAt: Date | null;
  createdAt: Date;
}

export interface SECFiling {
  form: string;
  filingDate: Date;
  reportDate: Date | null;
  accessionNumber: string;
}

/**
 * Filing Notification Service
 * Manages tenant-scoped notifications for new SEC filings
 * 
 * Tenant Isolation:
 * - All queries filter by tenantId
 * - Dismissal requires tenant ownership verification
 * - Audit logging tracks all notification access and dismissals
 */
@Injectable()
export class FilingNotificationService {
  private readonly logger = new Logger(FilingNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: DistributedLockService,
  ) {}

  /**
   * Create notifications for all tenants with deals for this ticker
   */
  async createNotifications(
    ticker: string,
    filing: SECFiling,
  ): Promise<number> {
    // Find all tenants that have deals for this ticker
    const deals = await this.prisma.deal.findMany({
      where: { ticker },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });

    const tenantIds = deals.map((d) => d.tenantId);

    this.logger.log(
      `Creating notifications for ${ticker} ${filing.form} for ${tenantIds.length} tenants`,
    );

    // Create notification for each tenant
    const notifications = await Promise.all(
      tenantIds.map((tenantId) =>
        this.prisma.filingNotification.create({
          data: {
            tenantId,
            ticker,
            filingType: filing.form,
            filingDate: filing.filingDate,
            reportDate: filing.reportDate,
            accessionNumber: filing.accessionNumber,
            dismissed: false,
          },
        }),
      ),
    );

    // Audit log: notification creation for each tenant
    for (const tenantId of tenantIds) {
      await this.logAudit(
        tenantId,
        'filing_notification.create',
        'filing_notification',
        {
          ticker,
          filingType: filing.form,
          accessionNumber: filing.accessionNumber,
        },
      );
    }

    return notifications.length;
  }

  /**
   * Get notifications for a tenant
   */
  async getNotifications(
    tenantId: string,
    options?: { dismissed?: boolean; limit?: number },
  ): Promise<FilingNotification[]> {
    const notifications = await this.prisma.filingNotification.findMany({
      where: {
        tenantId,
        dismissed: options?.dismissed ?? false,
      },
      orderBy: { filingDate: 'desc' },
      take: options?.limit || 50,
    });

    // Audit log: notification access
    await this.logAudit(
      tenantId,
      'filing_notification.list',
      'filing_notification',
      {
        count: notifications.length,
        dismissed: options?.dismissed ?? false,
      },
    );

    return notifications;
  }

  /**
   * Dismiss a notification
   */
  async dismissNotification(
    notificationId: string,
    tenantId: string,
  ): Promise<void> {
    // Verify ownership before dismissing (tenant isolation enforcement)
    const notification = await this.prisma.filingNotification.findFirst({
      where: {
        id: notificationId,
        tenantId,
      },
    });

    if (!notification) {
      // Audit log: failed dismissal attempt (possible tenant isolation violation)
      await this.logAudit(
        tenantId,
        'filing_notification.dismiss_denied',
        'filing_notification',
        {
          notificationId,
          reason: 'not_found_or_wrong_tenant',
        },
      );
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.filingNotification.update({
      where: { id: notificationId },
      data: { dismissed: true, dismissedAt: new Date() },
    });

    // Audit log: successful dismissal
    await this.logAudit(
      tenantId,
      'filing_notification.dismiss',
      'filing_notification',
      {
        notificationId,
        ticker: notification.ticker,
        filingType: notification.filingType,
      },
    );
  }

  /**
   * Auto-expire old notifications (30 days)
   * Uses distributed lock to ensure only one ECS container runs this.
   */
  @Cron('0 0 * * *') // Daily at midnight
  async expireOldNotifications(): Promise<number> {
    const result = await this.lockService.withLock(
      'filing-notification-expiry',
      () => this.executeExpiry(),
    );
    return result ?? 0;
  }

  private async executeExpiry(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await this.prisma.filingNotification.updateMany({
      where: {
        createdAt: { lt: thirtyDaysAgo },
        dismissed: false,
      },
      data: { dismissed: true, dismissedAt: new Date() },
    });

    this.logger.log(`Auto-expired ${result.count} old notifications`);
    return result.count;
  }

  /**
   * Get notification count for a tenant
   */
  async getNotificationCount(tenantId: string): Promise<number> {
    return this.prisma.filingNotification.count({
      where: {
        tenantId,
        dismissed: false,
      },
    });
  }

  /**
   * Log audit event for notification access/dismissal.
   * Uses the audit_log table directly to avoid request-scope dependency,
   * since this service is also called from cron jobs (no HTTP request context).
   */
  private async logAudit(
    tenantId: string,
    eventType: string,
    resource: string,
    details: Record<string, any>,
  ): Promise<void> {
    try {
      const prismaAny = this.prisma as any;
      if (!prismaAny.auditLog) {
        // Table doesn't exist yet - log to console instead
        this.logger.debug(
          `Audit: ${eventType} ${resource} for tenant ${tenantId}`,
        );
        return;
      }

      await prismaAny.auditLog.create({
        data: {
          eventType,
          details: {
            tenantId,
            resource,
            ...details,
          },
          timestamp: new Date(),
        },
      });
    } catch (error) {
      // Don't fail the main operation if audit logging fails
      this.logger.error(`Failed to log audit entry: ${error.message}`);
    }
  }
}
