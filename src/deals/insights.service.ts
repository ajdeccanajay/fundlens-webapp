import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MDAIntelligenceService } from './mda-intelligence.service';
import { MetricHierarchyService } from './metric-hierarchy.service';

export interface HeroMetric {
  name: string;
  value: number;
  change: number;
  changePercent: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  isKeyDriver: boolean;
}

export interface ComprehensiveInsights {
  heroMetrics: HeroMetric[];
  trends: any[];
  risks: any[];
  guidance: {
    text: string | null;
    sentiment: string | null;
    confidenceScore: number | null;
  };
  dataQuality: {
    metricsCount: number;
    trendsCount: number;
    risksCount: number;
    hasGuidance: boolean;
  };
}

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mdaIntelligenceService: MDAIntelligenceService,
    private readonly metricHierarchyService: MetricHierarchyService,
  ) {}

  /**
   * Get comprehensive insights for a deal and fiscal period
   */
  async getComprehensiveInsights(
    dealId: string,
    fiscalPeriod: string,
  ): Promise<ComprehensiveInsights> {
    // Get deal info
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
    });

    if (!deal) {
      throw new Error('Deal not found');
    }

    // Get hero metrics
    const heroMetrics = await this.getHeroMetrics(dealId, fiscalPeriod);

    // Get MD&A insights
    const mdaInsights = await this.prisma.mdaInsight.findUnique({
      where: {
        dealId_fiscalPeriod: {
          dealId,
          fiscalPeriod,
        },
      },
    });

    const trends = mdaInsights?.trends as any[] || [];
    const risks = mdaInsights?.risks as any[] || [];
    const guidance = {
      text: mdaInsights?.guidance || null,
      sentiment: mdaInsights?.guidanceSentiment || null,
      confidenceScore: mdaInsights?.confidenceScore
        ? parseFloat(mdaInsights.confidenceScore.toString())
        : null,
    };

    return {
      heroMetrics,
      trends,
      risks,
      guidance,
      dataQuality: {
        metricsCount: heroMetrics.length,
        trendsCount: trends.length,
        risksCount: risks.length,
        hasGuidance: !!guidance.text,
      },
    };
  }

  /**
   * Get hero metrics (top-level metrics with YoY change)
   */
  async getHeroMetrics(
    dealId: string,
    fiscalPeriod: string,
  ): Promise<HeroMetric[]> {
    // Get deal info
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
    });

    if (!deal || !deal.ticker) {
      return [];
    }

    // Define hero metric names
    const heroMetricNames = [
      'revenue',
      'net_income',
      'gross_profit',
      'operating_income',
      'total_assets',
      'operating_cash_flow',
    ];

    // Get current period metrics
    const currentMetrics = await this.prisma.financialMetric.findMany({
      where: {
        ticker: deal.ticker,
        fiscalPeriod,
        normalizedMetric: {
          in: heroMetricNames,
        },
      },
    });

    // Get previous period for YoY comparison
    const previousPeriod = this.getPreviousPeriod(fiscalPeriod);
    const previousMetrics = await this.prisma.financialMetric.findMany({
      where: {
        ticker: deal.ticker,
        fiscalPeriod: previousPeriod,
        normalizedMetric: {
          in: heroMetricNames,
        },
      },
    });

    // Get hierarchy to identify key drivers
    const hierarchy = await this.prisma.metricHierarchy.findMany({
      where: {
        dealId,
        fiscalPeriod,
        metricName: {
          in: heroMetricNames,
        },
      },
    });

    // Build hero metrics with YoY change
    const heroMetrics: HeroMetric[] = [];

    for (const metric of currentMetrics) {
      const previousMetric = previousMetrics.find(
        (m) => m.normalizedMetric === metric.normalizedMetric,
      );

      const currentValue = parseFloat(metric.value.toString());
      const previousValue = previousMetric
        ? parseFloat(previousMetric.value.toString())
        : null;

      const change = previousValue ? currentValue - previousValue : 0;
      const changePercent = previousValue
        ? ((currentValue - previousValue) / Math.abs(previousValue)) * 100
        : 0;

      let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
      if (Math.abs(changePercent) > 1) {
        trend = changePercent > 0 ? 'increasing' : 'decreasing';
      }

      const hierarchyNode = hierarchy.find(
        (h) => h.metricName === metric.normalizedMetric,
      );

      heroMetrics.push({
        name: this.formatMetricName(metric.normalizedMetric),
        value: currentValue,
        change,
        changePercent,
        trend,
        isKeyDriver: hierarchyNode?.isKeyDriver || false,
      });
    }

    // Sort by importance (key drivers first, then by absolute value)
    heroMetrics.sort((a, b) => {
      if (a.isKeyDriver && !b.isKeyDriver) return -1;
      if (!a.isKeyDriver && b.isKeyDriver) return 1;
      return Math.abs(b.value) - Math.abs(a.value);
    });

    return heroMetrics.slice(0, 6); // Return top 6
  }

  /**
   * Get trends for a fiscal period
   */
  async getTrends(dealId: string, fiscalPeriod: string): Promise<any[]> {
    const mdaInsights = await this.prisma.mdaInsight.findUnique({
      where: {
        dealId_fiscalPeriod: {
          dealId,
          fiscalPeriod,
        },
      },
    });

    return (mdaInsights?.trends as any[]) || [];
  }

  /**
   * Get risks for a fiscal period
   */
  async getRisks(dealId: string, fiscalPeriod: string): Promise<any[]> {
    const mdaInsights = await this.prisma.mdaInsight.findUnique({
      where: {
        dealId_fiscalPeriod: {
          dealId,
          fiscalPeriod,
        },
      },
    });

    const risks = (mdaInsights?.risks as any[]) || [];

    // Sort by severity (high > medium > low)
    const severityOrder = { high: 0, medium: 1, low: 2 };
    risks.sort((a, b) => {
      const severityA = severityOrder[a.severity as keyof typeof severityOrder] ?? 3;
      const severityB = severityOrder[b.severity as keyof typeof severityOrder] ?? 3;
      return severityA - severityB;
    });

    return risks;
  }

  /**
   * Get forward guidance for a fiscal period
   */
  async getGuidance(dealId: string, fiscalPeriod: string) {
    const mdaInsights = await this.prisma.mdaInsight.findUnique({
      where: {
        dealId_fiscalPeriod: {
          dealId,
          fiscalPeriod,
        },
      },
    });

    return {
      text: mdaInsights?.guidance || null,
      sentiment: mdaInsights?.guidanceSentiment || null,
      confidenceScore: mdaInsights?.confidenceScore
        ? parseFloat(mdaInsights.confidenceScore.toString())
        : null,
    };
  }

  /**
   * Get previous fiscal period
   */
  private getPreviousPeriod(fiscalPeriod: string): string {
    // Handle formats like "FY2024", "Q4 2024", "2024"
    const fyMatch = fiscalPeriod.match(/FY(\d{4})/);
    if (fyMatch) {
      const year = parseInt(fyMatch[1]);
      return `FY${year - 1}`;
    }

    const qMatch = fiscalPeriod.match(/Q(\d)\s+(\d{4})/);
    if (qMatch) {
      const quarter = parseInt(qMatch[1]);
      const year = parseInt(qMatch[2]);
      if (quarter === 1) {
        return `Q4 ${year - 1}`;
      }
      return `Q${quarter - 1} ${year}`;
    }

    const yearMatch = fiscalPeriod.match(/^(\d{4})$/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      return `${year - 1}`;
    }

    return fiscalPeriod; // Fallback
  }

  /**
   * Format metric name for display
   */
  private formatMetricName(normalizedMetric: string): string {
    const nameMap: Record<string, string> = {
      revenue: 'Revenue',
      net_income: 'Net Income',
      gross_profit: 'Gross Profit',
      operating_income: 'Operating Income',
      total_assets: 'Total Assets',
      operating_cash_flow: 'Operating Cash Flow',
    };

    return nameMap[normalizedMetric] || normalizedMetric;
  }
}
