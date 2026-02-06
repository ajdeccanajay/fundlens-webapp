import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Metric Learning Service
 * 
 * Tracks unrecognized metrics and queries that we couldn't answer.
 * This data is used by the "Learning Agent" to improve the system over time.
 * 
 * When a user asks for a metric we don't have:
 * 1. We log it to the database
 * 2. We return a graceful message to the user
 * 3. The learning agent picks it up later and adds support
 */
@Injectable()
export class MetricLearningService {
  private readonly logger = new Logger(MetricLearningService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log an unrecognized metric request
   * 
   * This is called when:
   * - User asks for a metric we don't have in our database
   * - User asks for a computed metric we can't calculate yet
   * - Query fails due to missing data
   */
  async logUnrecognizedMetric(params: {
    tenantId: string;
    ticker: string;
    query: string;
    requestedMetric: string;
    metricCategory?: 'financial' | 'valuation' | 'efficiency' | 'quality' | 'growth';
    failureReason: string;
    userMessage: string;
  }): Promise<void> {
    try {
      this.logger.log(`📚 Learning Agent: Logging unrecognized metric request`);
      this.logger.log(`  Tenant: ${params.tenantId}`);
      this.logger.log(`  Ticker: ${params.ticker}`);
      this.logger.log(`  Metric: ${params.requestedMetric}`);
      this.logger.log(`  Reason: ${params.failureReason}`);

      // Log to database for learning agent
      await this.prisma.$executeRaw`
        INSERT INTO metric_learning_log (
          tenant_id,
          ticker,
          query,
          requested_metric,
          metric_category,
          failure_reason,
          user_message,
          created_at
        ) VALUES (
          ${params.tenantId},
          ${params.ticker},
          ${params.query},
          ${params.requestedMetric},
          ${params.metricCategory || 'financial'},
          ${params.failureReason},
          ${params.userMessage},
          NOW()
        )
        ON CONFLICT (tenant_id, ticker, requested_metric) 
        DO UPDATE SET
          request_count = metric_learning_log.request_count + 1,
          last_requested_at = NOW(),
          query = ${params.query}
      `;

      this.logger.log(`✅ Logged to learning agent database`);
    } catch (error) {
      this.logger.error(`Failed to log unrecognized metric: ${error.message}`);
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Get graceful failure message for user
   * 
   * This message:
   * 1. Acknowledges we don't have the data yet
   * 2. Tells them we've recorded their request
   * 3. Explains the learning agent will add it
   * 4. Provides alternative suggestions
   */
  getGracefulFailureMessage(params: {
    ticker: string;
    requestedMetric: string;
    availableAlternatives?: string[];
  }): string {
    const { ticker, requestedMetric, availableAlternatives } = params;

    let message = `I don't have **${requestedMetric}** data for ${ticker} yet, but I've recorded your request.\n\n`;
    
    message += `🤖 **Learning Agent Update**\n`;
    message += `Our system has logged this metric request. Our learning agent will:\n`;
    message += `- Analyze if this metric can be calculated from existing data\n`;
    message += `- Add it to our metric library if available in SEC filings\n`;
    message += `- Prioritize it based on user demand\n\n`;

    if (availableAlternatives && availableAlternatives.length > 0) {
      message += `**Available alternatives you might find useful:**\n`;
      for (const alt of availableAlternatives) {
        message += `- ${alt}\n`;
      }
      message += `\n`;
    }

    message += `**What you can do now:**\n`;
    message += `- Try asking for related metrics (revenue, cash flow, margins)\n`;
    message += `- Check ${ticker}'s financial statements for available data\n`;
    message += `- Come back later - we're constantly adding new metrics!\n`;

    return message;
  }

  /**
   * Get top requested metrics for learning agent prioritization
   */
  async getTopRequestedMetrics(params: {
    tenantId?: string;
    limit?: number;
    minRequestCount?: number;
  }): Promise<Array<{
    metric: string;
    category: string;
    requestCount: number;
    lastRequested: Date;
    tickers: string[];
  }>> {
    const { tenantId, limit = 50, minRequestCount = 2 } = params;

    try {
      const results = await this.prisma.$queryRaw<Array<{
        requested_metric: string;
        metric_category: string;
        request_count: bigint;
        last_requested_at: Date;
        tickers: string;
      }>>`
        SELECT 
          requested_metric,
          metric_category,
          SUM(request_count) as request_count,
          MAX(last_requested_at) as last_requested_at,
          STRING_AGG(DISTINCT ticker, ', ') as tickers
        FROM metric_learning_log
        WHERE 
          ${tenantId ? this.prisma.$queryRaw`tenant_id = ${tenantId}` : this.prisma.$queryRaw`TRUE`}
        GROUP BY requested_metric, metric_category
        HAVING SUM(request_count) >= ${minRequestCount}
        ORDER BY request_count DESC, last_requested_at DESC
        LIMIT ${limit}
      `;

      return results.map(r => ({
        metric: r.requested_metric,
        category: r.metric_category,
        requestCount: Number(r.request_count),
        lastRequested: r.last_requested_at,
        tickers: r.tickers.split(', '),
      }));
    } catch (error) {
      this.logger.error(`Failed to get top requested metrics: ${error.message}`);
      return [];
    }
  }
}
