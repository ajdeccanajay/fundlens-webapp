import {
  Controller,
  Get,
  Delete,
  Post,
  Param,
  Query,
  UseGuards,
  Req,
  Body,
  Logger,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { FilingNotificationService } from './filing-notification.service';
import { FilingDetectionScheduler } from './filing-detection-scheduler.service';
import { TenantGuard } from '../tenant/tenant.guard';
import { RequireRole } from '../tenant/decorators';
import { TENANT_CONTEXT_KEY, TenantContext } from '../tenant/tenant-context';

/**
 * Filing Notification Controller
 * Provides API endpoints for filing notifications and admin detection management.
 *
 * Endpoints:
 * - GET  /api/filings/notifications          - Get notifications for current tenant
 * - GET  /api/filings/notifications/count     - Get notification count for current tenant
 * - DELETE /api/filings/notifications/:id     - Dismiss a notification (tenant ownership verified)
 * - POST /api/filings/detect                  - Manually trigger detection (admin only)
 * - GET  /api/filings/detection-status        - Get detection state for all tickers (admin only)
 * - GET  /api/filings/detection-summary       - Get detection summary (admin only)
 */
@Controller('api/filings')
@UseGuards(TenantGuard)
export class FilingNotificationController {
  private readonly logger = new Logger(FilingNotificationController.name);

  constructor(
    private readonly notificationService: FilingNotificationService,
    private readonly detectionScheduler: FilingDetectionScheduler,
  ) {}

  // ==================== TENANT NOTIFICATION ENDPOINTS ====================

  /**
   * Get notifications for current tenant
   * GET /api/filings/notifications?dismissed=false&limit=50
   */
  @Get('notifications')
  async getNotifications(
    @Req() req: any,
    @Query('dismissed') dismissed?: string,
    @Query('limit') limit?: string,
  ) {
    const tenantContext: TenantContext = req[TENANT_CONTEXT_KEY];
    const tenantId = tenantContext.tenantId;

    const notifications = await this.notificationService.getNotifications(
      tenantId,
      {
        dismissed: dismissed === 'true',
        limit: limit ? parseInt(limit, 10) : 50,
      },
    );

    return {
      success: true,
      count: notifications.length,
      notifications,
    };
  }

  /**
   * Get notification count for current tenant
   * GET /api/filings/notifications/count
   */
  @Get('notifications/count')
  async getNotificationCount(@Req() req: any) {
    const tenantContext: TenantContext = req[TENANT_CONTEXT_KEY];
    const tenantId = tenantContext.tenantId;

    const count = await this.notificationService.getNotificationCount(tenantId);

    return {
      success: true,
      count,
    };
  }

  /**
   * Dismiss a notification
   * DELETE /api/filings/notifications/:id
   * Tenant ownership is verified in the service layer
   */
  @Delete('notifications/:id')
  @HttpCode(HttpStatus.OK)
  async dismissNotification(@Req() req: any, @Param('id') id: string) {
    const tenantContext: TenantContext = req[TENANT_CONTEXT_KEY];
    const tenantId = tenantContext.tenantId;

    await this.notificationService.dismissNotification(id, tenantId);

    return {
      success: true,
      message: 'Notification dismissed',
    };
  }

  // ==================== ADMIN-ONLY ENDPOINTS ====================

  /**
   * Manually trigger detection for a ticker (admin only)
   * POST /api/filings/detect
   * Body: { ticker: "AAPL" }
   */
  @Post('detect')
  @RequireRole('admin')
  @HttpCode(HttpStatus.OK)
  async triggerDetection(@Req() req: any, @Body() body: { ticker: string }) {
    const tenantContext: TenantContext = req[TENANT_CONTEXT_KEY];
    this.logger.log(
      `Admin ${tenantContext.userEmail} triggering detection for ${body.ticker}`,
    );

    const result = await this.detectionScheduler.triggerDetectionForTicker(
      body.ticker,
    );

    return {
      success: true,
      result,
    };
  }

  /**
   * Get detection state for all tickers (admin only)
   * GET /api/filings/detection-status
   */
  @Get('detection-status')
  @RequireRole('admin')
  async getDetectionStatus(@Req() req: any) {
    const tenantContext: TenantContext = req[TENANT_CONTEXT_KEY];
    this.logger.log(
      `Admin ${tenantContext.userEmail} requesting detection status`,
    );

    const states = await this.detectionScheduler.getDetectionStatus();

    return {
      success: true,
      count: states.length,
      states,
    };
  }

  /**
   * Get detection summary (admin only)
   * GET /api/filings/detection-summary
   */
  @Get('detection-summary')
  @RequireRole('admin')
  async getDetectionSummary(@Req() req: any) {
    const tenantContext: TenantContext = req[TENANT_CONTEXT_KEY];
    this.logger.log(
      `Admin ${tenantContext.userEmail} requesting detection summary`,
    );

    const summary = await this.detectionScheduler.getDetectionSummary();

    return {
      success: true,
      summary,
    };
  }
}
