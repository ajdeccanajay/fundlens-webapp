import { Injectable, Logger } from '@nestjs/common';
import { BedrockService, ChunkResult, MetadataFilter } from './bedrock.service';
import { RerankerService, RerankResult } from './reranker.service';
import { HyDEService, HyDEResult } from './hyde.service';
import { QueryDecompositionService, DecomposedRetrievalResult } from './query-decomposition.service';
import { ContextualExpansionService, ExpansionResult, ExpandedChunk } from './contextual-expansion.service';
import { IterativeRetrievalService, IterativeRetrievalResult } from './iterative-retrieval.service';

export interface AdvancedRetrievalConfig {
  enableReranking?: boolean;
  enableHyDE?: boolean;
  enableQueryDecomposition?: boolean;
  enableContextualExpansion?: boolean;
  enableIterativeRetrieval?: boolean;
  numberOfResults?: number;
  maxTokens?: number;
}

export interface AdvancedRetrievalMetrics {
  totalLatencyMs: number;
  rerankingLatencyMs?: number;
  hydeLatencyMs?: number;
  decompositionLatencyMs?: number;
  expansionLatencyMs?: number;
  iterativeLatencyMs?: number;
  techniquesUsed: string[];
  chunksBeforeReranking?: number;
  chunksAfterReranking?: number;
}

export interface AdvancedRetrievalResult {
  chunks: ChunkResult[] | ExpandedChunk[];
  metrics: AdvancedRetrievalMetrics;
  errors: string[];
}

/**
 * Advanced Retrieval Service
 * 
 * Phase 3: Orchestrates all advanced retrieval techniques with feature flags.
 * 
 * Techniques:
 * 1. Reranking - Re-score chunks using Cohere Rerank 3.5
 * 2. HyDE - Hypothetical Document Embeddings for better retrieval
 * 3. Query Decomposition - Break complex queries into sub-queries
 * 4. Contextual Expansion - Expand chunks with adjacent context
 * 5. Iterative Retrieval - Follow-up queries for low-confidence results
 * 
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 38.1
 */
@Injectable()
export class AdvancedRetrievalService {
  private readonly logger = new Logger(AdvancedRetrievalService.name);

  constructor(
    private readonly bedrock: BedrockService,
    private readonly reranker: RerankerService,
    private readonly hyde: HyDEService,
    private readonly queryDecomposition: QueryDecompositionService,
    private readonly contextualExpansion: ContextualExpansionService,
    private readonly iterativeRetrieval: IterativeRetrievalService,
  ) {
    this.logger.log('Advanced Retrieval Service initialized');
    this.logEnabledTechniques();
  }

  /**
   * Perform advanced retrieval with all enabled techniques
   * 
   * @param query - The user's search query
   * @param filters - Metadata filters for retrieval
   * @param config - Configuration for which techniques to use
   * @returns Retrieved chunks with metrics
   * 
   * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5
   */
  async retrieve(
    query: string,
    filters: MetadataFilter,
    config: AdvancedRetrievalConfig = {},
  ): Promise<AdvancedRetrievalResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const techniquesUsed: string[] = [];
    const metrics: Partial<AdvancedRetrievalMetrics> = {};

    const numberOfResults = config.numberOfResults || 5;
    let chunks: ChunkResult[] = [];

    try {
      // Step 1: Query Decomposition (if enabled and query is complex)
      if (this.shouldUseDecomposition(config)) {
        const decompositionStart = Date.now();
        const decompositionResult = await this.queryDecomposition.decomposeAndRetrieve(
          query,
          filters,
          numberOfResults,
        );
        metrics.decompositionLatencyMs = Date.now() - decompositionStart;

        if (decompositionResult.decomposed && decompositionResult.mergedChunks.length > 0) {
          chunks = decompositionResult.mergedChunks;
          techniquesUsed.push('query_decomposition');
          this.logger.debug(`Query decomposition: ${decompositionResult.results.length} sub-queries`);
        }

        if (decompositionResult.error) {
          errors.push(`Decomposition: ${decompositionResult.error}`);
        }
      }

      // Step 2: HyDE retrieval (if enabled and no decomposition results)
      if (chunks.length === 0 && this.shouldUseHyDE(config)) {
        const hydeStart = Date.now();
        const hydeResult = await this.hyde.retrieveWithHyDE(query, filters, numberOfResults);
        metrics.hydeLatencyMs = Date.now() - hydeStart;

        if (hydeResult.hydeUsed && hydeResult.chunks.length > 0) {
          chunks = hydeResult.chunks;
          techniquesUsed.push('hyde');
          this.logger.debug(`HyDE retrieval: ${chunks.length} chunks`);
        }

        if (hydeResult.error) {
          errors.push(`HyDE: ${hydeResult.error}`);
        }
      }

      // Step 3: Iterative retrieval (if enabled and still low results)
      if (chunks.length < 3 && this.shouldUseIterative(config)) {
        const iterativeStart = Date.now();
        const iterativeResult = await this.iterativeRetrieval.iterativeRetrieve(
          query,
          filters,
          numberOfResults,
        );
        metrics.iterativeLatencyMs = Date.now() - iterativeStart;

        if (iterativeResult.chunks.length > chunks.length) {
          chunks = iterativeResult.chunks;
          techniquesUsed.push('iterative_retrieval');
          this.logger.debug(`Iterative retrieval: ${iterativeResult.totalIterations} iterations`);
        }

        if (iterativeResult.error) {
          errors.push(`Iterative: ${iterativeResult.error}`);
        }
      }

      // Step 4: Standard retrieval (fallback if no advanced techniques produced results)
      if (chunks.length === 0) {
        chunks = await this.bedrock.retrieve(query, filters, numberOfResults);
        techniquesUsed.push('standard');
        this.logger.debug(`Standard retrieval: ${chunks.length} chunks`);
      }

      // Step 5: Reranking (if enabled)
      if (this.shouldUseReranking(config) && chunks.length > 1) {
        const rerankStart = Date.now();
        metrics.chunksBeforeReranking = chunks.length;
        
        const rerankResult = await this.reranker.rerank(query, chunks, numberOfResults);
        metrics.rerankingLatencyMs = Date.now() - rerankStart;

        if (rerankResult.reranked) {
          chunks = rerankResult.chunks;
          techniquesUsed.push('reranking');
          metrics.chunksAfterReranking = chunks.length;
          this.logger.debug(`Reranking: improved relevance scores`);
        }

        if (rerankResult.error) {
          errors.push(`Reranking: ${rerankResult.error}`);
        }
      }

      // Step 6: Contextual Expansion (if enabled)
      let finalChunks: ChunkResult[] | ExpandedChunk[] = chunks;
      if (this.shouldUseExpansion(config)) {
        const expansionStart = Date.now();
        const expansionResult = await this.contextualExpansion.expandContext(
          chunks,
          config.maxTokens,
        );
        metrics.expansionLatencyMs = Date.now() - expansionStart;

        if (expansionResult.expanded) {
          finalChunks = expansionResult.chunks;
          techniquesUsed.push('contextual_expansion');
          this.logger.debug(`Contextual expansion: ${expansionResult.totalTokens} tokens`);
        }

        if (expansionResult.error) {
          errors.push(`Expansion: ${expansionResult.error}`);
        }
      }

      const totalLatencyMs = Date.now() - startTime;

      // Log performance (Requirement 38.1)
      this.logPerformance(totalLatencyMs, techniquesUsed, finalChunks.length);

      return {
        chunks: finalChunks,
        metrics: {
          totalLatencyMs,
          ...metrics,
          techniquesUsed,
        },
        errors,
      };
    } catch (error) {
      const totalLatencyMs = Date.now() - startTime;
      this.logger.error(`Advanced retrieval failed: ${error.message}`);
      
      // Fallback to standard retrieval
      try {
        const fallbackChunks = await this.bedrock.retrieve(query, filters, numberOfResults);
        return {
          chunks: fallbackChunks,
          metrics: {
            totalLatencyMs,
            techniquesUsed: ['standard_fallback'],
          },
          errors: [...errors, `Advanced retrieval failed: ${error.message}`],
        };
      } catch (fallbackError) {
        return {
          chunks: [],
          metrics: {
            totalLatencyMs,
            techniquesUsed: [],
          },
          errors: [...errors, `Complete failure: ${fallbackError.message}`],
        };
      }
    }
  }

  /**
   * Check if reranking should be used
   */
  private shouldUseReranking(config: AdvancedRetrievalConfig): boolean {
    if (config.enableReranking === false) return false;
    if (config.enableReranking === true) return true;
    return this.reranker.isEnabled();
  }

  /**
   * Check if HyDE should be used
   */
  private shouldUseHyDE(config: AdvancedRetrievalConfig): boolean {
    if (config.enableHyDE === false) return false;
    if (config.enableHyDE === true) return true;
    return this.hyde.isEnabled();
  }

  /**
   * Check if query decomposition should be used
   */
  private shouldUseDecomposition(config: AdvancedRetrievalConfig): boolean {
    if (config.enableQueryDecomposition === false) return false;
    if (config.enableQueryDecomposition === true) return true;
    return this.queryDecomposition.isEnabled();
  }

  /**
   * Check if contextual expansion should be used
   */
  private shouldUseExpansion(config: AdvancedRetrievalConfig): boolean {
    if (config.enableContextualExpansion === false) return false;
    if (config.enableContextualExpansion === true) return true;
    return this.contextualExpansion.isEnabled();
  }

  /**
   * Check if iterative retrieval should be used
   */
  private shouldUseIterative(config: AdvancedRetrievalConfig): boolean {
    if (config.enableIterativeRetrieval === false) return false;
    if (config.enableIterativeRetrieval === true) return true;
    return this.iterativeRetrieval.isEnabled();
  }

  /**
   * Log enabled techniques on startup
   */
  private logEnabledTechniques(): void {
    const techniques: string[] = [];
    if (this.reranker.isEnabled()) techniques.push('Reranking');
    if (this.hyde.isEnabled()) techniques.push('HyDE');
    if (this.queryDecomposition.isEnabled()) techniques.push('Query Decomposition');
    if (this.contextualExpansion.isEnabled()) techniques.push('Contextual Expansion');
    if (this.iterativeRetrieval.isEnabled()) techniques.push('Iterative Retrieval');
    
    this.logger.log(`Enabled techniques: ${techniques.join(', ') || 'None'}`);
  }

  /**
   * Log performance metrics
   * 
   * Requirement: 38.1 - Ensure latency p95 < 5 seconds
   */
  private logPerformance(
    latencyMs: number,
    techniques: string[],
    chunkCount: number,
  ): void {
    const level = latencyMs > 5000 ? 'warn' : 'log';
    
    this.logger[level]({
      event: 'advanced_retrieval_complete',
      latencyMs,
      techniques,
      chunkCount,
      withinSLA: latencyMs < 5000,
      timestamp: new Date().toISOString(),
    });

    if (latencyMs > 5000) {
      this.logger.warn(`⚠️ Retrieval exceeded 5s SLA: ${latencyMs}ms`);
    }
  }

  /**
   * Get status of all techniques
   */
  getStatus(): Record<string, boolean> {
    return {
      reranking: this.reranker.isEnabled(),
      hyde: this.hyde.isEnabled(),
      queryDecomposition: this.queryDecomposition.isEnabled(),
      contextualExpansion: this.contextualExpansion.isEnabled(),
      iterativeRetrieval: this.iterativeRetrieval.isEnabled(),
    };
  }
}
