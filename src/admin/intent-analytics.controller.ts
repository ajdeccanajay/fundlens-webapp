import { Controller, Get, Post, Body, Query, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBody } from '@nestjs/swagger';
import { PlatformAdminGuard } from './platform-admin.guard';
import { IntentAnalyticsService } from '../rag/intent-analytics.service';

@ApiTags('Admin - Intent Analytics')
@Controller('admin/intent-analytics')
@UseGuards(PlatformAdminGuard)
export class IntentAnalyticsController {
  private readonly logger = new Logger(IntentAnalyticsController.name);

  constructor(private readonly analytics: IntentAnalyticsService) {}

  @Get('realtime')
  async getRealtimeMetrics(@Query('tenantId') tenantId: string) {
    const metrics = await this.analytics.getRealtimeMetrics(tenantId);
    return { success: true, tenantId, metrics, timestamp: new Date() };
  }

  @Get('failed-patterns')
  async getFailedPatterns(
    @Query('tenantId') tenantId: string,
    @Query('status') status?: 'pending' | 'reviewed' | 'implemented' | 'rejected',
  ) {
    const patterns = await this.analytics.getFailedPatterns(tenantId, status);
    return { success: true, tenantId, status: status || 'all', count: patterns.length, patterns };
  }

  @Post('update-pattern')
  async updatePatternStatus(
    @Body('patternId') patternId: string,
    @Body('status') status: 'pending' | 'reviewed' | 'implemented' | 'rejected',
    @Body('reviewedBy') reviewedBy: string,
    @Body('notes') notes?: string,
  ) {
    await this.analytics.updatePatternStatus(patternId, status, reviewedBy, notes);
    return { success: true, patternId, status, reviewedBy };
  }
}
