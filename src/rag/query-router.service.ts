import { Injectable, Logger } from '@nestjs/common';
import { IntentDetectorService } from './intent-detector.service';
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

  constructor(private readonly intentDetector: IntentDetectorService) {}

  /**
   * Route a query to appropriate retrieval strategy
   */
  async route(query: string): Promise<RetrievalPlan> {
    // Detect intent
    const intent = await this.intentDetector.detectIntent(query);

    this.logger.log(`Routing query type: ${intent.type}`);

    // Build retrieval plan based on intent type
    if (intent.type === 'structured') {
      return this.buildStructuredPlan(intent);
    } else if (intent.type === 'semantic') {
      return this.buildSemanticPlan(intent);
    } else {
      return this.buildHybridPlan(intent);
    }
  }

  /**
   * Build structured retrieval plan (PostgreSQL only)
   */
  private buildStructuredPlan(intent: QueryIntent): RetrievalPlan {
    const tickers = this.normalizeTickers(intent.ticker);

    const structuredQuery: StructuredQuery = {
      tickers,
      metrics: intent.metrics || [],
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
  private buildHybridPlan(intent: QueryIntent): RetrievalPlan {
    const tickers = this.normalizeTickers(intent.ticker);

    const structuredQuery: StructuredQuery = {
      tickers,
      metrics: intent.metrics || [],
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
   */
  async getIntent(query: string): Promise<QueryIntent> {
    return this.intentDetector.detectIntent(query);
  }
}
