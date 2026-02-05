import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryIntent } from './types/query-intent';

export interface IntentDetectionLog {
  id: string;
  tenantId: string;
  query: string;
  detectedIntent: QueryIntent;
  detectionMethod: 'regex' | 'llm' | 'generic';
  confidence: number;
  success: boolean;
  errorMessage?: string;
  latencyMs: number;
  llmCostUsd?: number;
  createdAt: Date;
}

export interface IntentAnalyticsSummary {
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  totalQueries: number;
  regexSuccessCount: number;
  llmFallbackCount: number;
  genericFallbackCount: number;
  failedQueriesCount: number;
  avgConfidence: number;
  avgLatencyMs: number;
  totalLlmCostUsd: number;
  topFailedPatterns: Array<{ query: string; count: number }>;
}

export interface FailedPattern {
  id: string;
  tenantId: string;
  queryPattern: string;
  exampleQueries: string[];
  occurrenceCount: number;
  suggestedRegex?: string;
  status: 'pending' | 'reviewed' | 'implemented' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: Date;
  notes?: string;
}

/**
 * Intent Analytics Service
 * Tracks intent detection performance for learning and optimization
 * Provides per-tenant visibility and actionable insights
 */
@Injectable()
export class IntentAnalyticsService {
  private readonly logger = new Logger(IntentAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log an intent detection attempt
   */
  async logDetection(params: {
    tenantId: string;
    query: string;
    detectedIntent: QueryIntent;
    detectionMethod: 'regex' | 'llm' | 'generic';
    confidence: number;
    success: boolean;
    errorMessage?: string;
    latencyMs: number;
    llmCostUsd?: number;
  }): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO intent_detection_logs (
          tenant_id, query, detected_intent, detection_method,
          confidence, success, error_message, latency_ms, llm_cost_usd
        ) VALUES (
          ${params.tenantId},
          ${params.query},
          ${JSON.stringify(params.detectedIntent)}::jsonb,
          ${params.detectionMethod},
          ${params.confidence},
          ${params.success},
          ${params.errorMessage || null},
          ${params.latencyMs},
          ${params.llmCostUsd || null}
        )
      `;

      // If detection failed, track the pattern
      if (!params.success || params.confidence < 0.6) {
        await this.trackFailedPattern(params.tenantId, params.query);
      }
    } catch (error) {
      // Don't throw - logging failures shouldn't break the system
      this.logger.error(`Failed to log intent detection: ${error.message}`);
    }
  }

  /**
   * Get analytics summary for a tenant
   */
  async getSummary(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<IntentAnalyticsSummary | null> {
    try {
      const result = await this.prisma.$queryRaw<any[]>`
        SELECT
          tenant_id as "tenantId",
          period_start as "periodStart",
          period_end as "periodEnd",
          total_queries as "totalQueries",
          regex_success_count as "regexSuccessCount",
          llm_fallback_count as "llmFallbackCount",
          generic_fallback_count as "genericFallbackCount",
          failed_queries_count as "failedQueriesCount",
          avg_confidence as "avgConfidence",
          avg_latency_ms as "avgLatencyMs",
          total_llm_cost_usd as "totalLlmCostUsd",
          top_failed_patterns as "topFailedPatterns"
        FROM intent_analytics_summary
        WHERE tenant_id = ${tenantId}
          AND period_start = ${periodStart}
          AND period_end = ${periodEnd}
        LIMIT 1
      `;

      return result[0] || null;
    } catch (error) {
      this.logger.error(`Failed to get analytics summary: ${error.message}`);
      return null;
    }
  }

  /**
   * Compute analytics summary for a period (run periodically)
   */
  async computeSummary(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<IntentAnalyticsSummary> {
    try {
      // Compute metrics from logs
      const metrics = await this.prisma.$queryRaw<any[]>`
        SELECT
          COUNT(*) as total_queries,
          SUM(CASE WHEN detection_method = 'regex' THEN 1 ELSE 0 END) as regex_success,
          SUM(CASE WHEN detection_method = 'llm' THEN 1 ELSE 0 END) as llm_fallback,
          SUM(CASE WHEN detection_method = 'generic' THEN 1 ELSE 0 END) as generic_fallback,
          SUM(CASE WHEN success = false THEN 1 ELSE 0 END) as failed_queries,
          AVG(confidence) as avg_confidence,
          AVG(latency_ms) as avg_latency,
          SUM(COALESCE(llm_cost_usd, 0)) as total_llm_cost
        FROM intent_detection_logs
        WHERE tenant_id = ${tenantId}
          AND created_at >= ${periodStart}
          AND created_at < ${periodEnd}
      `;

      const metric = metrics[0];

      // Get top failed patterns
      const failedPatterns = await this.prisma.$queryRaw<any[]>`
        SELECT query, COUNT(*) as count
        FROM intent_detection_logs
        WHERE tenant_id = ${tenantId}
          AND created_at >= ${periodStart}
          AND created_at < ${periodEnd}
          AND (success = false OR confidence < 0.6)
        GROUP BY query
        ORDER BY count DESC
        LIMIT 10
      `;

      // Upsert summary
      await this.prisma.$executeRaw`
        INSERT INTO intent_analytics_summary (
          tenant_id, period_start, period_end,
          total_queries, regex_success_count, llm_fallback_count,
          generic_fallback_count, failed_queries_count,
          avg_confidence, avg_latency_ms, total_llm_cost_usd,
          top_failed_patterns, updated_at
        ) VALUES (
          ${tenantId}, ${periodStart}, ${periodEnd},
          ${metric.total_queries || 0},
          ${metric.regex_success || 0},
          ${metric.llm_fallback || 0},
          ${metric.generic_fallback || 0},
          ${metric.failed_queries || 0},
          ${metric.avg_confidence || 0},
          ${Math.round(metric.avg_latency || 0)},
          ${metric.total_llm_cost || 0},
          ${JSON.stringify(failedPatterns)}::jsonb,
          NOW()
        )
        ON CONFLICT (tenant_id, period_start, period_end)
        DO UPDATE SET
          total_queries = EXCLUDED.total_queries,
          regex_success_count = EXCLUDED.regex_success_count,
          llm_fallback_count = EXCLUDED.llm_fallback_count,
          generic_fallback_count = EXCLUDED.generic_fallback_count,
          failed_queries_count = EXCLUDED.failed_queries_count,
          avg_confidence = EXCLUDED.avg_confidence,
          avg_latency_ms = EXCLUDED.avg_latency_ms,
          total_llm_cost_usd = EXCLUDED.total_llm_cost_usd,
          top_failed_patterns = EXCLUDED.top_failed_patterns,
          updated_at = NOW()
      `;

      return {
        tenantId,
        periodStart,
        periodEnd,
        totalQueries: metric.total_queries || 0,
        regexSuccessCount: metric.regex_success || 0,
        llmFallbackCount: metric.llm_fallback || 0,
        genericFallbackCount: metric.generic_fallback || 0,
        failedQueriesCount: metric.failed_queries || 0,
        avgConfidence: metric.avg_confidence || 0,
        avgLatencyMs: Math.round(metric.avg_latency || 0),
        totalLlmCostUsd: metric.total_llm_cost || 0,
        topFailedPatterns: failedPatterns,
      };
    } catch (error) {
      this.logger.error(`Failed to compute summary: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get failed patterns for review
   */
  async getFailedPatterns(
    tenantId: string,
    status?: 'pending' | 'reviewed' | 'implemented' | 'rejected',
  ): Promise<FailedPattern[]> {
    try {
      let patterns: any[];
      
      if (status) {
        patterns = await this.prisma.$queryRaw<any[]>`
          SELECT
            id,
            tenant_id as "tenantId",
            query_pattern as "queryPattern",
            example_queries as "exampleQueries",
            occurrence_count as "occurrenceCount",
            suggested_regex as "suggestedRegex",
            status,
            reviewed_by as "reviewedBy",
            reviewed_at as "reviewedAt",
            notes
          FROM intent_failed_patterns
          WHERE tenant_id = ${tenantId}
            AND status = ${status}
          ORDER BY occurrence_count DESC, created_at DESC
          LIMIT 50
        `;
      } else {
        patterns = await this.prisma.$queryRaw<any[]>`
          SELECT
            id,
            tenant_id as "tenantId",
            query_pattern as "queryPattern",
            example_queries as "exampleQueries",
            occurrence_count as "occurrenceCount",
            suggested_regex as "suggestedRegex",
            status,
            reviewed_by as "reviewedBy",
            reviewed_at as "reviewedAt",
            notes
          FROM intent_failed_patterns
          WHERE tenant_id = ${tenantId}
          ORDER BY occurrence_count DESC, created_at DESC
          LIMIT 50
        `;
      }

      return patterns as FailedPattern[];
    } catch (error) {
      this.logger.error(`Failed to get failed patterns: ${error.message}`);
      return [];
    }
  }

  /**
   * Update failed pattern status (for admin actions)
   */
  async updatePatternStatus(
    patternId: string,
    status: 'pending' | 'reviewed' | 'implemented' | 'rejected',
    reviewedBy: string,
    notes?: string,
  ): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE intent_failed_patterns
        SET
          status = ${status},
          reviewed_by = ${reviewedBy},
          reviewed_at = NOW(),
          notes = ${notes || null},
          updated_at = NOW()
        WHERE id = ${patternId}
      `;

      this.logger.log(`Updated pattern ${patternId} to status: ${status}`);
    } catch (error) {
      this.logger.error(`Failed to update pattern status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Track a failed query pattern
   */
  private async trackFailedPattern(
    tenantId: string,
    query: string,
  ): Promise<void> {
    try {
      // Normalize query to identify patterns
      const pattern = this.normalizeQuery(query);

      // Check if pattern exists
      const existing = await this.prisma.$queryRaw<any[]>`
        SELECT id, example_queries, occurrence_count
        FROM intent_failed_patterns
        WHERE tenant_id = ${tenantId}
          AND query_pattern = ${pattern}
        LIMIT 1
      `;

      if (existing.length > 0) {
        // Update existing pattern
        const exampleQueries = existing[0].example_queries || [];
        if (!exampleQueries.includes(query) && exampleQueries.length < 10) {
          exampleQueries.push(query);
        }

        await this.prisma.$executeRaw`
          UPDATE intent_failed_patterns
          SET
            example_queries = ${exampleQueries}::text[],
            occurrence_count = occurrence_count + 1,
            updated_at = NOW()
          WHERE id = ${existing[0].id}
        `;
      } else {
        // Create new pattern
        await this.prisma.$executeRaw`
          INSERT INTO intent_failed_patterns (
            tenant_id, query_pattern, example_queries, occurrence_count
          ) VALUES (
            ${tenantId}, ${pattern}, ARRAY[${query}]::text[], 1
          )
        `;
      }
    } catch (error) {
      this.logger.error(`Failed to track failed pattern: ${error.message}`);
    }
  }

  /**
   * Normalize query to identify patterns
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .replace(/\b(aapl|msft|googl|amzn|tsla|meta|nvda|[a-z]{2,5})\b/gi, '[TICKER]')
      .replace(/\b(20\d{2}|fy\d{4}|q[1-4][\s-]*20\d{2})\b/gi, '[PERIOD]')
      .replace(/\b(\d+)\b/g, '[NUMBER]')
      .trim();
  }

  /**
   * Get real-time metrics for a tenant (last 24 hours)
   */
  async getRealtimeMetrics(tenantId: string): Promise<{
    last24Hours: {
      totalQueries: number;
      regexSuccessRate: number;
      llmFallbackRate: number;
      avgConfidence: number;
      avgLatencyMs: number;
      llmCostUsd: number;
    };
    last7Days: {
      totalQueries: number;
      regexSuccessRate: number;
      llmFallbackRate: number;
      avgConfidence: number;
      avgLatencyMs: number;
      llmCostUsd: number;
    };
  }> {
    try {
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const metrics24h = await this.computeMetrics(tenantId, last24h, now);
      const metrics7d = await this.computeMetrics(tenantId, last7d, now);

      return {
        last24Hours: metrics24h,
        last7Days: metrics7d,
      };
    } catch (error) {
      this.logger.error(`Failed to get realtime metrics: ${error.message}`);
      throw error;
    }
  }

  /**
   * Compute metrics for a period
   */
  private async computeMetrics(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<{
    totalQueries: number;
    regexSuccessRate: number;
    llmFallbackRate: number;
    avgConfidence: number;
    avgLatencyMs: number;
    llmCostUsd: number;
  }> {
    const result = await this.prisma.$queryRaw<any[]>`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN detection_method = 'regex' THEN 1 ELSE 0 END) as regex_count,
        SUM(CASE WHEN detection_method = 'llm' THEN 1 ELSE 0 END) as llm_count,
        AVG(confidence) as avg_conf,
        AVG(latency_ms) as avg_lat,
        SUM(COALESCE(llm_cost_usd, 0)) as llm_cost
      FROM intent_detection_logs
      WHERE tenant_id = ${tenantId}
        AND created_at >= ${start}
        AND created_at < ${end}
    `;

    const metric = result[0];
    const total = parseInt(metric.total) || 0;

    return {
      totalQueries: total,
      regexSuccessRate: total > 0 ? (parseInt(metric.regex_count) / total) * 100 : 0,
      llmFallbackRate: total > 0 ? (parseInt(metric.llm_count) / total) * 100 : 0,
      avgConfidence: parseFloat(metric.avg_conf) || 0,
      avgLatencyMs: Math.round(parseFloat(metric.avg_lat) || 0),
      llmCostUsd: parseFloat(metric.llm_cost) || 0,
    };
  }
}
