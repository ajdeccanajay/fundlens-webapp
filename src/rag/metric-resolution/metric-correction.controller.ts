import { Controller, Post, Body, Logger } from '@nestjs/common';
import { MetricCorrectionService } from './metric-correction.service';

@Controller('api/metrics')
export class MetricCorrectionController {
  private readonly logger = new Logger(MetricCorrectionController.name);

  constructor(private readonly correctionService: MetricCorrectionService) {}

  @Post('correction')
  async recordCorrection(
    @Body('rawQuery') rawQuery: string,
    @Body('selectedMetricId') selectedMetricId: string,
    @Body('tenantId') tenantId: string,
  ) {
    if (!rawQuery || !selectedMetricId || !tenantId) {
      return {
        success: false,
        message: 'Missing required fields: rawQuery, selectedMetricId, tenantId',
      };
    }

    const result = await this.correctionService.recordCorrection({
      rawQuery,
      selectedMetricId,
      tenantId,
    });

    return result;
  }
}
