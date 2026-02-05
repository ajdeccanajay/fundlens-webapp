import { Injectable, Logger } from '@nestjs/common';
import {
  BedrockAgentRuntimeClient,
  RerankCommand,
  RerankCommandInput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { ChunkResult } from './bedrock.service';

export interface RerankResult {
  chunks: ChunkResult[];
  reranked: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Reranker Service
 * 
 * Phase 3: Advanced retrieval technique that re-scores retrieved chunks
 * using Cohere Rerank 3.5 via AWS Bedrock Rerank API.
 * 
 * Reranking improves search relevance by performing dynamic query-time
 * analysis of document relevance, enabling more nuanced and contextual
 * matching than static vector embeddings alone.
 * 
 * Requirements: 5A.1, 5A.2, 5A.3, 5A.4, 5A.5
 */
@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);
  private readonly client: BedrockAgentRuntimeClient;
  private readonly modelArn: string;
  private readonly enabled: boolean;

  constructor() {
    const region = process.env.AWS_REGION || 'us-east-1';
    this.client = new BedrockAgentRuntimeClient({ region });
    
    // Cohere Rerank 3.5 model ARN
    // Available in: us-west-2, ca-central-1, eu-central-1, ap-northeast-1
    this.modelArn = process.env.BEDROCK_RERANK_MODEL_ARN || 
      `arn:aws:bedrock:${region}::foundation-model/cohere.rerank-v3-5:0`;
    
    // Feature flag for enabling/disabling reranking
    this.enabled = process.env.ENABLE_RERANKING !== 'false';
    
    if (this.enabled) {
      this.logger.log(`Reranker Service initialized with model: ${this.modelArn}`);
    } else {
      this.logger.log('Reranker Service disabled via feature flag');
    }
  }

  /**
   * Rerank retrieved chunks based on query relevance
   * 
   * @param query - The user's search query
   * @param chunks - Retrieved chunks to rerank
   * @param topN - Number of top results to return (default: all)
   * @returns Reranked chunks sorted by relevance score descending
   * 
   * Requirements: 5A.1, 5A.2, 5A.4
   */
  async rerank(
    query: string,
    chunks: ChunkResult[],
    topN?: number,
  ): Promise<RerankResult> {
    const startTime = Date.now();

    // Return original if disabled or empty
    if (!this.enabled) {
      this.logger.debug('Reranking disabled, returning original chunks');
      return {
        chunks,
        reranked: false,
        latencyMs: Date.now() - startTime,
      };
    }

    if (chunks.length === 0) {
      this.logger.debug('No chunks to rerank');
      return {
        chunks: [],
        reranked: false,
        latencyMs: Date.now() - startTime,
      };
    }

    // Skip reranking for single chunk
    if (chunks.length === 1) {
      this.logger.debug('Single chunk, skipping rerank');
      return {
        chunks,
        reranked: false,
        latencyMs: Date.now() - startTime,
      };
    }

    try {
      const rerankedChunks = await this.rerankWithCohere(query, chunks, topN);
      const latencyMs = Date.now() - startTime;
      
      this.logger.log(
        `Reranked ${chunks.length} chunks in ${latencyMs}ms`
      );

      return {
        chunks: rerankedChunks,
        reranked: true,
        latencyMs,
      };
    } catch (error) {
      // Fallback to original scores on failure (Requirement 5A.3)
      const latencyMs = Date.now() - startTime;
      this.logger.error(`Reranking failed: ${error.message}`);
      
      return this.fallbackToOriginalScores(chunks, latencyMs, error.message);
    }
  }

  /**
   * Rerank using Cohere Rerank 3.5 via Bedrock Rerank API
   * 
   * Requirements: 5A.1, 5A.2
   */
  private async rerankWithCohere(
    query: string,
    chunks: ChunkResult[],
    topN?: number,
  ): Promise<ChunkResult[]> {
    // Prepare text sources for reranking
    const sources = chunks.map((chunk, index) => ({
      type: 'INLINE' as const,
      inlineDocumentSource: {
        type: 'TEXT' as const,
        textDocument: {
          text: chunk.content,
        },
      },
    }));

    const input: RerankCommandInput = {
      queries: [
        {
          type: 'TEXT' as const,
          textQuery: {
            text: query,
          },
        },
      ],
      sources,
      rerankingConfiguration: {
        type: 'BEDROCK_RERANKING_MODEL' as const,
        bedrockRerankingConfiguration: {
          modelConfiguration: {
            modelArn: this.modelArn,
          },
          numberOfResults: topN || chunks.length,
        },
      },
    };

    this.logger.debug(`Reranking ${chunks.length} chunks with query: "${query.substring(0, 50)}..."`);

    const command = new RerankCommand(input);
    const response = await this.client.send(command);

    if (!response.results || response.results.length === 0) {
      throw new Error('Rerank API returned no results');
    }

    // Map results back to chunks with new scores
    const rerankedChunks: ChunkResult[] = response.results.map((result) => {
      const originalIndex = result.index!;
      const originalChunk = chunks[originalIndex];
      
      return {
        ...originalChunk,
        score: result.relevanceScore || originalChunk.score,
      };
    });

    // Sort by reranked score descending (Requirement 5A.4)
    rerankedChunks.sort((a, b) => b.score - a.score);

    this.logger.debug(
      `Reranking complete. Top score: ${rerankedChunks[0]?.score.toFixed(3)}, ` +
      `Bottom score: ${rerankedChunks[rerankedChunks.length - 1]?.score.toFixed(3)}`
    );

    return rerankedChunks;
  }

  /**
   * Fallback to original scores when reranking fails
   * Preserves original retrieval order and scores
   * 
   * Requirement: 5A.3
   */
  private fallbackToOriginalScores(
    chunks: ChunkResult[],
    latencyMs: number,
    errorMessage: string,
  ): RerankResult {
    this.logger.warn(
      `Reranking fallback activated: preserving original ${chunks.length} chunks`
    );

    // Log for monitoring (Requirement 5A.5)
    this.logRerankingFailure(errorMessage, chunks.length);

    return {
      chunks, // Return original chunks unchanged
      reranked: false,
      latencyMs,
      error: errorMessage,
    };
  }

  /**
   * Log reranking failures for monitoring
   * 
   * Requirement: 5A.5
   */
  private logRerankingFailure(error: string, chunkCount: number): void {
    // Structured logging for monitoring/alerting
    this.logger.error({
      event: 'reranking_failure',
      error,
      chunkCount,
      modelArn: this.modelArn,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Check if reranking is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get reranker model information
   */
  getModelInfo(): { modelArn: string; enabled: boolean } {
    return {
      modelArn: this.modelArn,
      enabled: this.enabled,
    };
  }
}
