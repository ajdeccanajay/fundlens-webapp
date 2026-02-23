import { Injectable, Logger } from '@nestjs/common';
import { IntentDetectorService } from './intent-detector.service';
import { MetricRegistryService } from './metric-resolution/metric-registry.service';
import { ConceptRegistryService } from './metric-resolution/concept-registry.service';
import { MetricResolution } from './metric-resolution/types';
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
    private readonly metricRegistry: MetricRegistryService,
    private readonly conceptRegistry: ConceptRegistryService,
  ) {}

  /**
   * Route a query to appropriate retrieval strategy
   * 
   * @param query The natural language query
   * @param tenantId Optional tenant ID for analytics
   * @param contextTicker Optional ticker from workspace context
   */
  async route(query: string, tenantId?: string, contextTicker?: string): Promise<RetrievalPlan> {
    // Check for concept match first (TYPE C: analytical question → metric bundle)
    const conceptMatch = this.conceptRegistry.matchConcept(query);
    if (conceptMatch) {
      this.logger.log(`🎯 CONCEPT MATCH: "${query}" → ${conceptMatch.concept_id} (${conceptMatch.confidence})`);
      return this.buildConceptPlan(query, conceptMatch.concept_id, tenantId, contextTicker);
    }

    // Detect intent
    const intent = await this.intentDetector.detectIntent(query, tenantId, contextTicker);

    this.logger.log(`🔍 QUERY ROUTER: Routing query type: ${intent.type}`);
    this.logger.log(`🔍 QUERY ROUTER: Intent detected - ticker: ${intent.ticker}, metrics: ${JSON.stringify(intent.metrics)}`);

    // Build retrieval plan based on intent type
    if (intent.type === 'structured') {
      return await this.buildStructuredPlan(intent, tenantId);
    } else if (intent.type === 'semantic') {
      return this.buildSemanticPlan(intent);
    } else {
      return await this.buildHybridPlan(intent, tenantId);
    }
  }

  /**
   * Build structured retrieval plan (PostgreSQL only)
   */
  private async buildStructuredPlan(intent: QueryIntent, tenantId?: string): Promise<RetrievalPlan> {
    const tickers = this.normalizeTickers(intent.ticker);
    const normalizedMetrics = this.resolveMetrics(intent.metrics || [], tenantId);

    const structuredQuery: StructuredQuery = {
      tickers,
      metrics: normalizedMetrics,
      period: intent.period,
      periodType: intent.periodType,
      periodStart: intent.periodStart,
      periodEnd: intent.periodEnd,
      filingTypes: intent.periodType === 'range' ? ['10-K'] : this.determineFilingTypes(intent),
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
  private async buildHybridPlan(intent: QueryIntent, tenantId?: string): Promise<RetrievalPlan> {
    const tickers = this.normalizeTickers(intent.ticker);
    const normalizedMetrics = this.resolveMetrics(intent.metrics || [], tenantId);

    const structuredQuery: StructuredQuery = {
      tickers,
      metrics: normalizedMetrics,
      period: intent.period,
      periodType: intent.periodType,
      periodStart: intent.periodStart,
      periodEnd: intent.periodEnd,
      filingTypes: intent.periodType === 'range' ? ['10-K'] : this.determineFilingTypes(intent),
      includeComputed: intent.needsComputation,
    };

    const semanticQuery: SemanticQuery = {
      query: intent.originalQuery,
      tickers: tickers.length > 0 ? tickers : undefined,
      documentTypes: intent.documentTypes || ['10-K', '10-Q'],
      sectionTypes: intent.sectionTypes || ['item_7'], // Default to MD&A (Item 7) for hybrid
      period: intent.periodType === 'range'
        ? `${intent.periodStart}-${intent.periodEnd}`
        : intent.period,
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
   * Build concept-driven retrieval plan (TYPE C: analytical question → metric bundle).
   * Expands a concept into primary + secondary metrics, resolves each through the registry,
   * and builds a hybrid plan with the concept's context_prompt for RAG.
   */
  private async buildConceptPlan(
    query: string,
    conceptId: string,
    tenantId?: string,
    contextTicker?: string,
  ): Promise<RetrievalPlan> {
    // Detect intent for ticker/period extraction (we still need these from the query)
    const intent = await this.intentDetector.detectIntent(query, tenantId, contextTicker);
    const tickers = this.normalizeTickers(intent.ticker);

    // TODO: In the future, look up the company's sector from DB for sector-filtered bundles.
    // For now, pass undefined to get "all" metrics.
    const bundle = this.conceptRegistry.getMetricBundle(conceptId);
    if (!bundle) {
      this.logger.warn(`Concept "${conceptId}" matched but no bundle found — falling back to standard routing`);
      return this.buildHybridPlan(intent, tenantId);
    }

    // Combine primary + secondary metrics and resolve each
    const allMetricIds = [...bundle.primary_metrics, ...bundle.secondary_metrics];
    const resolutions = this.resolveMetrics(allMetricIds, tenantId);

    this.logger.log(
      `🎯 CONCEPT PLAN: ${conceptId} → ${resolutions.length} metrics (${resolutions.filter(r => r.confidence !== 'unresolved').length} resolved)`,
    );

    const structuredQuery: StructuredQuery = {
      tickers,
      metrics: resolutions,
      period: intent.period,
      periodType: intent.periodType,
      filingTypes: this.determineFilingTypes(intent),
      includeComputed: true, // Concepts often include computed metrics
    };

    // Use the concept's context_prompt for semantic retrieval
    const semanticQuery: SemanticQuery = {
      query: bundle.context_prompt || query,
      tickers: tickers.length > 0 ? tickers : undefined,
      documentTypes: ['10-K', '10-Q'],
      sectionTypes: ['item_7'],
      period: intent.period,
      maxResults: 8, // More results for comprehensive concept analysis
    };

    return {
      useStructured: true,
      useSemantic: true,
      structuredQuery,
      semanticQuery,
    };
  }

  /**
   * Resolve metrics using MetricRegistryService
   * Returns MetricResolution[] directly — StructuredQuery now carries full resolution objects.
   */
  private resolveMetrics(metrics: string[], tenantId?: string): MetricResolution[] {
    this.logger.log(`🔍 METRIC RESOLUTION: Resolving ${metrics.length} metrics via MetricRegistryService`);

    const resolutions = this.metricRegistry.resolveMultiple(metrics, tenantId);

    for (const resolution of resolutions) {
      if (resolution.confidence === 'unresolved') {
        this.logger.warn(`⚠️ METRIC RESOLUTION: Unresolved metric "${resolution.original_query}"`);
      } else {
        this.logger.log(`✅ METRIC RESOLUTION: "${resolution.original_query}" → "${resolution.canonical_id}" (${resolution.confidence})`);
      }
    }

    return resolutions;
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
