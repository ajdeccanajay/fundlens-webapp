import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IntentDetectorService } from './intent-detector.service';
import { MetricRegistryService } from './metric-resolution/metric-registry.service';
import { ConceptRegistryService } from './metric-resolution/concept-registry.service';
import { MetricResolution } from './metric-resolution/types';
import {
  QueryIntent,
  RetrievalPlan,
  StructuredQuery,
  SemanticQuery,
  DocumentType,
} from './types/query-intent';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * A single peer universe entry loaded from peer_universes.yaml.
 */
export interface PeerUniverse {
  display_name: string;
  gics_subindustry?: string;
  members: string[];
  primary_metrics: string[];
  normalization_basis: 'FY' | 'LTM' | 'CY';
}

/**
 * Query Router Service
 * Routes queries to appropriate retrieval paths based on intent
 */
@Injectable()
export class QueryRouterService implements OnModuleInit {
  private readonly logger = new Logger(QueryRouterService.name);

  /** Peer universe registry keyed by universe name (e.g. "online_travel") */
  private peerUniverses = new Map<string, PeerUniverse>();

  /** Reverse index: ticker → universe name for O(1) lookup */
  private tickerToUniverse = new Map<string, string>();

  constructor(
    private readonly intentDetector: IntentDetectorService,
    private readonly metricRegistry: MetricRegistryService,
    private readonly conceptRegistry: ConceptRegistryService,
  ) {}

  onModuleInit() {
    this.loadPeerUniverses();
  }

  /**
   * Load peer universe definitions from yaml-registries/peer_universes.yaml.
   * Builds both the forward map (universe → members) and the reverse index
   * (ticker → universe) for fast lookup during routing.
   */
  loadPeerUniverses(): void {
    const yamlPath = path.join(process.cwd(), 'yaml-registries', 'peer_universes.yaml');
    try {
      if (!fs.existsSync(yamlPath)) {
        this.logger.warn('peer_universes.yaml not found — peer universe resolution disabled');
        return;
      }
      const content = fs.readFileSync(yamlPath, 'utf-8');
      const parsed = yaml.load(content) as Record<string, any>;
      if (!parsed || typeof parsed !== 'object') {
        this.logger.warn('peer_universes.yaml is empty or invalid');
        return;
      }

      this.peerUniverses.clear();
      this.tickerToUniverse.clear();

      for (const [name, def] of Object.entries(parsed)) {
        if (!def || typeof def !== 'object') continue;
        const members: string[] = Array.isArray(def.members) ? def.members : [];
        const universe: PeerUniverse = {
          display_name: def.display_name ?? name,
          gics_subindustry: def.gics_subindustry,
          members,
          primary_metrics: Array.isArray(def.primary_metrics) ? def.primary_metrics : [],
          normalization_basis: def.normalization_basis ?? 'FY',
        };
        this.peerUniverses.set(name, universe);

        for (const ticker of members) {
          // First universe wins for a given ticker
          if (!this.tickerToUniverse.has(ticker)) {
            this.tickerToUniverse.set(ticker, name);
          }
        }
      }

      this.logger.log(
        `Loaded ${this.peerUniverses.size} peer universes with ${this.tickerToUniverse.size} ticker mappings`,
      );
    } catch (err) {
      this.logger.error(`Failed to load peer_universes.yaml: ${err.message}`);
    }
  }

  /**
   * Look up the peer universe for a single ticker.
   * Returns the universe definition or undefined if the ticker is not in any universe.
   *
   * Requirements: 17.1
   */
  lookupPeerUniverse(ticker: string): { name: string; universe: PeerUniverse } | undefined {
    const universeName = this.tickerToUniverse.get(ticker);
    if (!universeName) return undefined;
    const universe = this.peerUniverses.get(universeName);
    if (!universe) return undefined;
    return { name: universeName, universe };
  }

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

    // ── Peer Universe Resolution (Req 17.1, 17.2, 17.3) ─────────────
    // When needsPeerComparison is true and only one ticker is provided,
    // look up the peer universe and expand the ticker list.
    if (intent.needsPeerComparison) {
      const tickers = this.normalizeTickers(intent.ticker);
      if (tickers.length === 1) {
        const match = this.lookupPeerUniverse(tickers[0]);
        if (match) {
          this.logger.log(
            `🌐 PEER UNIVERSE RESOLVED: "${match.name}" (${match.universe.display_name}) → [${match.universe.members.join(', ')}]`,
          );
          intent.ticker = match.universe.members;
        }
      }
    }

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

      // Always include lightweight semantic retrieval for richer context.
      // "What is the revenue?" is technically structured, but the analyst
      // benefits from MD&A context about revenue drivers, segment breakdown,
      // and management commentary. 3 chunks adds ~200ms but transforms
      // a bare data lookup into an analytical response.
      const semanticQuery = {
        query: intent.originalQuery,
        tickers: tickers.length > 0 ? tickers : undefined,
        documentTypes: ['10-K', '10-Q'] as DocumentType[],
        sectionTypes: undefined,
        period: intent.period,
        maxResults: 3,
      };

      return {
        useStructured: true,
        useSemantic: true,
        structuredQuery,
        semanticQuery,
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
      sectionTypes: intent.sectionTypes, // Pass through LLM-detected section types (e.g. item_1a for risk factors)
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
