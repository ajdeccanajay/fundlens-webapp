import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface MetricQueryOptions {
  ticker?: string;
  cik?: string;
  metricName?: string;
  filingType?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

@Injectable()
export class SecQueryService {
  constructor(private readonly prisma: PrismaService) {}

  // Query financial metrics with flexible filters
  async queryMetrics(options: MetricQueryOptions) {
    const {
      ticker,
      cik,
      metricName,
      filingType,
      startDate,
      endDate,
      limit = 100,
    } = options;

    const where: any = {};

    if (ticker) where.ticker = ticker.toUpperCase();
    // Note: CIK is not stored in FinancialMetric, only in FilingMetadata
    if (metricName) where.normalizedMetric = metricName;
    if (filingType) where.filingType = filingType;

    if (startDate || endDate) {
      where.filingDate = {};
      if (startDate) where.filingDate.gte = new Date(startDate);
      if (endDate) where.filingDate.lte = new Date(endDate);
    }

    const metrics = await this.prisma.financialMetric.findMany({
      where,
      orderBy: [
        { filingDate: 'desc' },
        { normalizedMetric: 'asc' },
      ],
      take: limit,
    });

    return {
      count: metrics.length,
      filters: options,
      metrics: metrics.map(m => ({
        id: m.id,
        ticker: m.ticker,
        metric: m.normalizedMetric,
        value: m.value.toString(),
        fiscalPeriod: m.fiscalPeriod,
        periodType: m.periodType,
        filingType: m.filingType,
        filingDate: m.filingDate,
        statementType: m.statementType,
        confidence: m.confidenceScore,
        rawLabel: m.rawLabel,
        xbrlTag: m.xbrlTag,
      })),
    };
  }

  // Get latest metrics for a ticker (like a financial snapshot)
  async getLatestMetrics(ticker: string) {
    const upperTicker = ticker.toUpperCase();

    // Get the most recent filing date for this ticker
    const latestFiling = await this.prisma.financialMetric.findFirst({
      where: { ticker: upperTicker },
      orderBy: { filingDate: 'desc' },
      select: { filingDate: true, filingType: true },
    });

    if (!latestFiling) {
      throw new NotFoundException(`No metrics found for ticker: ${ticker}`);
    }

    // Get all metrics from that filing
    const metrics = await this.prisma.financialMetric.findMany({
      where: {
        ticker: upperTicker,
        filingDate: latestFiling.filingDate,
      },
      orderBy: { normalizedMetric: 'asc' },
    });

    return {
      ticker: upperTicker,
      filingDate: latestFiling.filingDate,
      filingType: latestFiling.filingType,
      metricsCount: metrics.length,
      metrics: metrics.map(m => ({
        metric: m.normalizedMetric,
        value: m.value.toString(),
        fiscalPeriod: m.fiscalPeriod,
        periodType: m.periodType,
        statementType: m.statementType,
        confidence: m.confidenceScore,
        rawLabel: m.rawLabel,
      })),
    };
  }

  // Get time series for a specific metric
  async getMetricTimeSeries(ticker: string, metricName: string) {
    const metrics = await this.prisma.financialMetric.findMany({
      where: {
        ticker: ticker.toUpperCase(),
        normalizedMetric: metricName,
      },
      orderBy: { filingDate: 'desc' },
    });

    if (metrics.length === 0) {
      throw new NotFoundException(
        `No data found for ${ticker} - ${metricName}`,
      );
    }

    return {
      ticker: ticker.toUpperCase(),
      metric: metricName,
      dataPoints: metrics.length,
      timeSeries: metrics.map(m => ({
        date: m.filingDate,
        value: m.value.toString(),
        fiscalPeriod: m.fiscalPeriod,
        periodType: m.periodType,
        filingType: m.filingType,
        statementType: m.statementType,
        confidence: m.confidenceScore,
      })),
    };
  }

  // Query narrative chunks (for RAG/context)
  async queryNarratives(
    ticker: string,
    options?: {
      sectionType?: string;
      searchText?: string;
      limit?: number;
    },
  ) {
    const { sectionType, searchText, limit = 50 } = options || {};

    const where: any = {
      ticker: ticker.toUpperCase(),
    };

    if (sectionType) where.sectionType = sectionType;
    if (searchText) {
      where.content = {
        contains: searchText,
        mode: 'insensitive',
      };
    }

    const chunks = await this.prisma.narrativeChunk.findMany({
      where,
      orderBy: [
        { createdAt: 'desc' },
        { chunkIndex: 'asc' },
      ],
      take: limit,
    });

    return {
      ticker: ticker.toUpperCase(),
      count: chunks.length,
      chunks: chunks.map(c => ({
        id: c.id,
        sectionType: c.sectionType,
        content: c.content,
        filingType: c.filingType,
        chunkIndex: c.chunkIndex,
      })),
    };
  }

  // Get available tickers in database
  async getAvailableTickers() {
    const tickers = await this.prisma.financialMetric.findMany({
      distinct: ['ticker'],
      select: {
        ticker: true,
      },
      orderBy: { ticker: 'asc' },
    });

    const tickerStats = await Promise.all(
      tickers.map(async t => {
        const [metricCount, latestFiling, filingMetadata] = await Promise.all([
          this.prisma.financialMetric.count({
            where: { ticker: t.ticker },
          }),
          this.prisma.financialMetric.findFirst({
            where: { ticker: t.ticker },
            orderBy: { filingDate: 'desc' },
            select: { filingDate: true, filingType: true },
          }),
          this.prisma.filingMetadata.findFirst({
            where: { ticker: t.ticker },
            select: { cik: true },
          }),
        ]);

        return {
          ticker: t.ticker,
          cik: filingMetadata?.cik || null,
          metricsCount: metricCount,
          latestFiling: latestFiling?.filingDate,
          latestFilingType: latestFiling?.filingType,
        };
      }),
    );

    return {
      count: tickerStats.length,
      tickers: tickerStats,
    };
  }

  // Get available metrics for a ticker
  async getAvailableMetrics(ticker: string) {
    const metrics = await this.prisma.financialMetric.findMany({
      where: { ticker: ticker.toUpperCase() },
      distinct: ['normalizedMetric'],
      select: {
        normalizedMetric: true,
      },
      orderBy: { normalizedMetric: 'asc' },
    });

    const metricStats = await Promise.all(
      metrics.map(async m => {
        const [count, latest] = await Promise.all([
          this.prisma.financialMetric.count({
            where: {
              ticker: ticker.toUpperCase(),
              normalizedMetric: m.normalizedMetric,
            },
          }),
          this.prisma.financialMetric.findFirst({
            where: {
              ticker: ticker.toUpperCase(),
              normalizedMetric: m.normalizedMetric,
            },
            orderBy: { filingDate: 'desc' },
            select: { value: true, filingDate: true, fiscalPeriod: true },
          }),
        ]);

        return {
          metric: m.normalizedMetric,
          dataPoints: count,
          latestValue: latest?.value.toString(),
          fiscalPeriod: latest?.fiscalPeriod,
          latestDate: latest?.filingDate,
        };
      }),
    );

    return {
      ticker: ticker.toUpperCase(),
      metricsCount: metricStats.length,
      metrics: metricStats,
    };
  }
}
