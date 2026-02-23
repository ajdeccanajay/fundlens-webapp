import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface CorrectionResult {
  success: boolean;
  logId: string | null;
  message: string;
}

@Injectable()
export class MetricCorrectionService {
  private readonly logger = new Logger(MetricCorrectionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record an analyst correction: when an analyst selects a suggestion
   * for an unresolved metric query, update the resolution log and
   * record the mapping as a candidate synonym for future learning.
   */
  async recordCorrection(params: {
    rawQuery: string;
    selectedMetricId: string;
    tenantId: string;
  }): Promise<CorrectionResult> {
    const { rawQuery, selectedMetricId, tenantId } = params;

    try {
      // Find the most recent MetricResolutionLog entry matching rawQuery + tenantId
      const logEntry = await this.prisma.metricResolutionLog.findFirst({
        where: {
          rawQuery,
          tenantId,
        },
        orderBy: { timestamp: 'desc' },
      });

      if (!logEntry) {
        this.logger.warn(
          `No resolution log found for query="${rawQuery}" tenant="${tenantId}"`,
        );
        return {
          success: false,
          logId: null,
          message: `No resolution log found for query "${rawQuery}"`,
        };
      }

      // Update the log entry with the analyst's choice
      await this.prisma.metricResolutionLog.update({
        where: { id: logEntry.id },
        data: { userChoice: selectedMetricId },
      });

      // Log the correction as a candidate synonym mapping for the learning loop
      this.logger.log(
        `📝 Analyst correction recorded: "${rawQuery}" → ${selectedMetricId} (tenant: ${tenantId}, log: ${logEntry.id})`,
      );

      return {
        success: true,
        logId: logEntry.id,
        message: `Correction recorded: "${rawQuery}" mapped to ${selectedMetricId}`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to record correction for "${rawQuery}": ${error.message}`,
      );
      return {
        success: false,
        logId: null,
        message: `Failed to record correction: ${error.message}`,
      };
    }
  }
}
