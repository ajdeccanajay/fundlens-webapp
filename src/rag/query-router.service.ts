import { Injectable, Logger } from '@nestjs/common';
import { IntentDetectorService } from './intent-detector.service';
import { MetricMappingService } from './metric-mapping.service';
import {
  QueryIntent,
  RetrievalPlan,
  StructuredQuery,
  SemanticQuery,
} from './types/query-intent';

/**
 * Query Router Service
 * Routes queries to appropriate retrieval paths based on intent
 */
@Injectable()
export class QueryRouterService {
  private readonly logger = new Logger(QueryRouterService.name);

  constructor(
    private readonly intentDetector: IntentDetectorService,
    private readonly metricMapping: MetricMappingService,
  ) {}

  /**
   * Route a query to appropriate retrieval strategy
   * 
   * @param query The natural language query
   * @param tenantId Optional tenant ID for analytics
   * @param contextTicker Optional ticker from workspace context
   */
  async route(query: string, tenantId?: string, contextTicker?: string): Promise<RetrievalPlan> {
    // Detect intent
    const intent = await this.intentDetector.detectIntent(query, tenantId, contextTicker);

    this.logger.log(`🔍 QUERY ROUTER: Routing query type: ${intent.type}`);
    this.logger.log(`🔍 QUERY ROUTER: Intent detected - ticker: ${intent.ticker}, metrics: ${JSON.stringify(intent.metrics)}`);

    // Build retrieval plan based on intent type
    if (intent.type === 'structured') {
      return await this.buildStructuredPlan(intent);
    } else if (intent.type === 'semantic') {
      return this.buildSemanticPlan(intent);
    } else {
      return await this.buildHybridPlan(intent);
    }
  }

  /**
   * Build structured retrieval plan (PostgreSQL only)
   */
  private async buildStructuredPlan(intent: QueryIntent): Promise<RetrievalPlan> {
    const tickers = this.normalizeTickers(intent.ticker);
    const normalizedMetrics = await this.normalizeMetrics(intent.metrics || [], tickers[0]);

    const structuredQuery: StructuredQuery = {
      tickers,
      metrics: normalizedMetrics,
      period: intent.period,
      periodType: intent.periodType,
      filingTypes: this.determineFilingTypes(intent),
      includeComputed: intent.needsComputation,
    };

    return {
      useStructured: true,
      useSemantic: false,
      structuredQuery,
    };
  }

  /**
   * Build semantic retrieval plan (Bedrock KB only)
   */
  private buildSemanticPlan(intent: QueryIntent): RetrievalPlan {
    const tickers = this.normalizeTickers(intent.ticker);

    const semanticQuery: SemanticQuery = {
      query: intent.originalQuery,
      tickers: tickers.length > 0 ? tickers : undefined,
      documentTypes: intent.documentTypes || ['10-K', '10-Q'],
      sectionTypes: intent.sectionTypes,
      period: intent.period,
      maxResults: this.determineMaxResults(intent),
    };

    return {
      useStructured: false,
      useSemantic: true,
      semanticQuery,
    };
  }

  /**
   * Build hybrid retrieval plan (Both PostgreSQL + Bedrock KB)
   */
  private async buildHybridPlan(intent: QueryIntent): Promise<RetrievalPlan> {
    const tickers = this.normalizeTickers(intent.ticker);
    const normalizedMetrics = await this.normalizeMetrics(intent.metrics || [], tickers[0]);

    const structuredQuery: StructuredQuery = {
      tickers,
      metrics: normalizedMetrics,
      period: intent.period,
      periodType: intent.periodType,
      filingTypes: this.determineFilingTypes(intent),
      includeComputed: intent.needsComputation,
    };

    const semanticQuery: SemanticQuery = {
      query: intent.originalQuery,
      tickers: tickers.length > 0 ? tickers : undefined,
      documentTypes: intent.documentTypes || ['10-K', '10-Q'],
      sectionTypes: intent.sectionTypes || ['mda'], // Default to MD&A for hybrid
      period: intent.period,
      maxResults: this.determineMaxResults(intent),
    };

    return {
      useStructured: true,
      useSemantic: true,
      structuredQuery,
      semanticQuery,
    };
  }

  /**
   * Normalize metrics using MetricMappingService
   * Maps user-friendly names (e.g., "Revenue") to database names (e.g., "total_revenue")
   */
  private async normalizeMetrics(metrics: string[], ticker?: string): Promise<string[]> {
    this.logger.log(`🔍 METRIC NORMALIZATION: Starting normalization for ${metrics.length} metrics: ${JSON.stringify(metrics)}`);
    
    const normalized: string[] = [];

    for (const metric of metrics) {
      try {
        // Try to resolve the metric using the mapping service
        const match = await this.metricMapping.resolve(metric, ticker);
        
        if (match) {
          // Use the canonical name from the mapping
          normalized.push(match.canonicalName);
          this.logger.log(
            `✅ METRIC NORMALIZATION: "${metric}" → "${match.canonicalName}" (${match.method}, confidence: ${match.confidence.toFixed(2)})`
          );
        } else {
          // Fallback: use the original metric name
          this.logger.warn(`⚠️ METRIC NORMALIZATION: No mapping found for metric "${metric}", using as-is`);
          normalized.push(metric);
        }
      } catch (error) {
        this.logger.error(`❌ METRIC NORMALIZATION: Error normalizing metric "${metric}": ${error.message}`);
        // Fallback: use the original metric name
        normalized.push(metric);
      }
    }

    this.logger.log(`🔍 METRIC NORMALIZATION: Completed - normalized metrics: ${JSON.stringify(normalized)}`);
    return normalized;
  }

  /**
   * Normalize tickers to array
   */
  private normalizeTickers(ticker?: string | string[]): string[] {
    if (!ticker) return [];
    return Array.isArray(ticker) ? ticker : [ticker];
  }

  /**
   * Determine filing types based on intent
   */
  private determineFilingTypes(intent: QueryIntent): any[] {
    // If document types specified, use those
    if (intent.documentTypes && intent.documentTypes.length > 0) {
      return intent.documentTypes.filter((t) =>
        ['10-K', '10-Q', '8-K'].includes(t),
      );
    }

    // If period type specified
    if (intent.periodType === 'annual') {
      return ['10-K'];
    } else if (intent.periodType === 'quarterly') {
      return ['10-Q'];
    } else if (intent.periodType === 'latest') {
      return ['10-K', '10-Q']; // Both for latest
    }

    // Default to both annual and quarterly
    return ['10-K', '10-Q'];
  }

  /**
   * Determine max results for semantic search
   */
  private determineMaxResults(intent: QueryIntent): number {
    // More results for comparison or trend queries
    if (intent.needsComparison || intent.needsTrend) {
      return 10;
    }

    // Fewer results for specific queries
    if (intent.sectionTypes && intent.sectionTypes.length > 0) {
      return 5;
    }

    // Default
    return 5;
  }

  /**
   * Get intent without routing (for testing)
   * 
   * @param query The natural language query
   * @param tenantId Optional tenant ID for analytics
   * @param contextTicker Optional ticker from workspace context
   */
  async getIntent(query: string, tenantId?: string, contextTicker?: string): Promise<QueryIntent> {
    return this.intentDetector.detectIntent(query, tenantId, contextTicker);
  }
}
