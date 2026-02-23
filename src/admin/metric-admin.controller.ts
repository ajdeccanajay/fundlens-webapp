/**
 * Metric Admin Controller
 *
 * Admin endpoint for managing the metric resolution registry.
 * Protected by PlatformAdminGuard (requires x-admin-key header).
 */

import {
  Controller,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';
import { MetricRegistryService } from '../rag/metric-resolution/metric-registry.service';
import { IndexBuildResult } from '../rag/metric-resolution/types';

@Controller('admin/metrics')
@UseGuards(PlatformAdminGuard)
export class MetricAdminController {
  private readonly logger = new Logger(MetricAdminController.name);

  constructor(private readonly metricRegistry: MetricRegistryService) {}

  /**
   * Rebuild the metric registry index from S3 YAML files.
   * POST /api/admin/metrics/rebuild-index
   *
   * Reloads all YAML files from S3 and rebuilds the inverted synonym index
   * without requiring an application restart.
   */
  @Post('rebuild-index')
  @HttpCode(HttpStatus.OK)
  async rebuildIndex(): Promise<{
    success: boolean;
    result: IndexBuildResult;
  }> {
    this.logger.log('Admin triggered metric registry index rebuild');

    const result = await this.metricRegistry.rebuildIndex();

    this.logger.log(
      `Index rebuild complete: ${result.metricsLoaded} metrics, ${result.synonymsIndexed} synonyms, ${result.collisions} collisions, ${result.loadTimeMs}ms`,
    );

    return {
      success: true,
      result,
    };
  }
}
