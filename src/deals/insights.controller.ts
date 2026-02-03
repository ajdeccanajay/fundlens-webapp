import { Controller, Get, Param, UseGuards, HttpException, HttpStatus, Post, Query, Body } from '@nestjs/common';
import { InsightsService } from './insights.service';
import { MetricHierarchyService } from './metric-hierarchy.service';
import { FootnoteLinkingService } from './footnote-linking.service';
import { AnomalyDetectionService, AnomalyType } from './anomaly-detection.service';
import { CompTableService } from './comp-table.service';
import { TenantGuard } from '../tenant/tenant.guard';

@Controller('deals/:dealId/insights')
@UseGuards(TenantGuard)
export class InsightsController {
  constructor(
    private readonly insightsService: InsightsService,
    private readonly metricHierarchyService: MetricHierarchyService,
    private readonly footnoteLinkingService: FootnoteLinkingService,
    private readonly anomalyDetectionService: AnomalyDetectionService,
    private readonly compTableService: CompTableService,
  ) {}

  @Get(':fiscalPeriod')
  async getInsights(
    @Param('dealId') dealId: string,
    @Param('fiscalPeriod') fiscalPeriod: string,
  ) {
    try {
      const insights = await this.insightsService.getComprehensiveInsights(
        dealId,
        fiscalPeriod,
      );
      return insights;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error.message === 'Deal not found') {
        throw new HttpException('Insights not found for this deal and period', HttpStatus.NOT_FOUND);
      }
      throw new HttpException('Failed to load insights', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':fiscalPeriod/trends')
  async getTrends(
    @Param('dealId') dealId: string,
    @Param('fiscalPeriod') fiscalPeriod: string,
  ) {
    try {
      return await this.insightsService.getTrends(dealId, fiscalPeriod);
    } catch (error) {
      throw new HttpException('Failed to load trends', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':fiscalPeriod/risks')
  async getRisks(
    @Param('dealId') dealId: string,
    @Param('fiscalPeriod') fiscalPeriod: string,
  ) {
    try {
      return await this.insightsService.getRisks(dealId, fiscalPeriod);
    } catch (error) {
      throw new HttpException('Failed to load risks', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':fiscalPeriod/guidance')
  async getGuidance(
    @Param('dealId') dealId: string,
    @Param('fiscalPeriod') fiscalPeriod: string,
  ) {
    try {
      return await this.insightsService.getGuidance(dealId, fiscalPeriod);
    } catch (error) {
      throw new HttpException('Failed to load guidance', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':fiscalPeriod/hero-metrics')
  async getHeroMetrics(
    @Param('dealId') dealId: string,
    @Param('fiscalPeriod') fiscalPeriod: string,
  ) {
    try {
      return await this.insightsService.getHeroMetrics(dealId, fiscalPeriod);
    } catch (error) {
      throw new HttpException('Failed to load hero metrics', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':fiscalPeriod/data-quality')
  async getDataQuality(
    @Param('dealId') dealId: string,
    @Param('fiscalPeriod') fiscalPeriod: string,
  ) {
    try {
      const insights = await this.insightsService.getComprehensiveInsights(dealId, fiscalPeriod);
      return insights.dataQuality;
    } catch (error) {
      throw new HttpException('Failed to load data quality', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('hierarchy')
  async getHierarchy(@Param('dealId') dealId: string) {
    try {
      const hierarchy = await this.metricHierarchyService.getHierarchyForDeal(dealId);
      const rootMetrics = this.metricHierarchyService.getRootMetrics(hierarchy);
      
      return {
        success: true,
        data: {
          totalNodes: hierarchy.size,
          rootMetrics: rootMetrics.map(node => ({
            metricId: node.metricId,
            label: node.label,
            normalizedName: node.normalizedName,
            value: node.value,
            hasChildren: node.childrenIds.length > 0,
            childrenCount: node.childrenIds.length,
            level: node.level,
            statementType: node.statementType,
            fiscalPeriod: node.fiscalPeriod,
          })),
        },
      };
    } catch (error) {
      throw new HttpException('Failed to load hierarchy', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('hierarchy/:metricId/children')
  async getHierarchyChildren(
    @Param('dealId') dealId: string,
    @Param('metricId') metricId: string,
  ) {
    try {
      const hierarchy = await this.metricHierarchyService.getHierarchyForDeal(dealId);
      const children = this.metricHierarchyService.getChildren(metricId, hierarchy);
      
      return {
        success: true,
        data: children.map(node => ({
          metricId: node.metricId,
          label: node.label,
          normalizedName: node.normalizedName,
          value: node.value,
          hasChildren: node.childrenIds.length > 0,
          childrenCount: node.childrenIds.length,
          level: node.level,
          statementType: node.statementType,
          fiscalPeriod: node.fiscalPeriod,
        })),
      };
    } catch (error) {
      throw new HttpException('Failed to load hierarchy children', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('footnotes')
  async getFootnotes(@Param('dealId') dealId: string) {
    try {
      const footnotes = await this.footnoteLinkingService.getFootnoteReferencesForDeal(dealId);
      
      return {
        success: true,
        data: footnotes,
      };
    } catch (error) {
      throw new HttpException('Failed to load footnotes', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('footnotes/:metricId')
  async getFootnotesForMetric(
    @Param('dealId') dealId: string,
    @Param('metricId') metricId: string,
  ) {
    try {
      const footnotes = await this.footnoteLinkingService.getFootnoteReferencesForMetric(metricId);
      
      return {
        success: true,
        data: footnotes,
      };
    } catch (error) {
      throw new HttpException('Failed to load footnotes for metric', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('anomalies')
  async getAnomalies(
    @Param('dealId') dealId: string,
    @Query('types') types?: string,
  ) {
    try {
      // Parse types if provided
      let anomalyTypes: AnomalyType[] | undefined;
      if (types) {
        anomalyTypes = types.split(',') as AnomalyType[];
      }

      const anomalies = await this.anomalyDetectionService.detectAnomalies(
        dealId,
        anomalyTypes,
      );

      const summary = this.anomalyDetectionService.calculateSummary(anomalies);

      return {
        success: true,
        data: {
          anomalies,
          summary,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to detect anomalies', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('anomalies/:anomalyId/dismiss')
  async dismissAnomaly(
    @Param('dealId') dealId: string,
    @Param('anomalyId') anomalyId: string,
  ) {
    try {
      // For now, just return success
      // In production, you'd store dismissed anomalies in the database
      return {
        success: true,
        message: 'Anomaly dismissed',
        anomalyId,
      };
    } catch (error) {
      throw new HttpException('Failed to dismiss anomaly', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('comp-table')
  async getCompTable(
    @Param('dealId') dealId: string,
    @Query('companies') companies?: string,
    @Query('metrics') metrics?: string,
    @Query('period') period?: string,
  ) {
    try {
      // Validate required parameters
      if (!companies || !metrics || !period) {
        throw new HttpException(
          'Missing required parameters: companies, metrics, period',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Parse comma-separated values
      const companiesList = companies.split(',').map(c => c.trim()).filter(c => c);
      const metricsList = metrics.split(',').map(m => m.trim()).filter(m => m);

      if (companiesList.length === 0) {
        throw new HttpException(
          'At least one company ticker is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (metricsList.length === 0) {
        throw new HttpException(
          'At least one metric is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Build comp table
      const compTable = await this.compTableService.buildCompTable({
        companies: companiesList,
        metrics: metricsList,
        period,
      });

      return {
        success: true,
        data: compTable,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to build comp table',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('comp-table/export')
  async exportCompTable(
    @Param('dealId') dealId: string,
    @Body() body: {
      companies: string[];
      metrics: string[];
      period: string;
    },
  ) {
    try {
      // Validate required parameters
      if (!body.companies || !body.metrics || !body.period) {
        throw new HttpException(
          'Missing required parameters: companies, metrics, period',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (body.companies.length === 0) {
        throw new HttpException(
          'At least one company ticker is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (body.metrics.length === 0) {
        throw new HttpException(
          'At least one metric is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Build comp table
      const compTable = await this.compTableService.buildCompTable({
        companies: body.companies,
        metrics: body.metrics,
        period: body.period,
      });

      // For now, return the data
      // In Task 2.7, we'll implement Excel export
      return {
        success: true,
        message: 'Export functionality will be implemented in Task 2.7',
        data: compTable,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to export comp table',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
