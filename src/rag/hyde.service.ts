import { Injectable, Logger } from '@nestjs/common';
import { BedrockService, ChunkResult, MetadataFilter } from './bedrock.service';

export interface HyDEResult {
  chunks: ChunkResult[];
  hydeUsed: boolean;
  hypotheticalAnswer?: string;
  latencyMs: number;
  error?: string;
}

/**
 * HyDE Service (Hypothetical Document Embeddings)
 * 
 * Phase 3: Advanced retrieval technique that generates a hypothetical
 * answer to the query, embeds it, and uses that embedding for retrieval.
 * This often retrieves more relevant documents than query-only retrieval.
 * 
 * Process:
 * 1. Generate hypothetical answer using Claude
 * 2. Embed hypothetical answer using Titan Embeddings
 * 3. Retrieve using hypothetical embedding
 * 4. Also retrieve using original query embedding
 * 5. Merge and deduplicate results
 * 
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5
 */
@Injectable()
export class HyDEService {
  private readonly logger = new Logger(HyDEService.name);
  private readonly enabled: boolean;

  constructor(private readonly bedrock: BedrockService) {
    // Feature flag for enabling/disabling HyDE
    this.enabled = process.env.ENABLE_HYDE !== 'false';
    
    if (this.enabled) {
      this.logger.log('HyDE Service initialized');
    } else {
      this.logger.log('HyDE Service disabled via feature flag');
    }
  }

  /**
   * Retrieve documents using HyDE technique
   * 
   * @param query - The user's search query
   * @param filters - Metadata filters for retrieval
   * @param numberOfResults - Number of results to return
   * @returns Combined and deduplicated results from HyDE and query-based retrieval
   * 
   * Requirements: 23.2, 23.3, 23.4
   */
  async retrieveWithHyDE(
    query: string,
    filters: MetadataFilter,
    numberOfResults = 5,
  ): Promise<HyDEResult> {
    const startTime = Date.now();

    if (!this.enabled) {
      this.logger.debug('HyDE disabled, using standard retrieval');
      return {
        chunks: [],
        hydeUsed: false,
        latencyMs: Date.now() - startTime,
      };
    }

    try {
      // Step 1: Generate hypothetical answer (Requirement 23.1)
      const hypotheticalAnswer = await this.generateHypotheticalAnswer(query, filters);
      
      if (!hypotheticalAnswer) {
        throw new Error('Failed to generate hypothetical answer');
      }

      this.logger.debug(`Generated hypothetical answer: "${hypotheticalAnswer.substring(0, 100)}..."`);

      // Step 2 & 3: Retrieve using hypothetical answer (Requirement 23.2)
      const hydeChunks = await this.bedrock.retrieve(
        hypotheticalAnswer,
        filters,
        numberOfResults,
      );

      // Step 4: Also retrieve using original query (Requirement 23.3)
      const queryChunks = await this.bedrock.retrieve(
        query,
        filters,
        numberOfResults,
      );

      // Step 5: Merge and deduplicate (Requirement 23.4)
      const mergedChunks = this.mergeAndDeduplicate(hydeChunks, queryChunks);

      // Sort by score and limit results
      mergedChunks.sort((a, b) => b.score - a.score);
      const finalChunks = mergedChunks.slice(0, numberOfResults);

      const latencyMs = Date.now() - startTime;
      this.logger.log(
        `HyDE retrieval complete: ${hydeChunks.length} HyDE + ${queryChunks.length} query → ${finalChunks.length} merged (${latencyMs}ms)`
      );

      return {
        chunks: finalChunks,
        hydeUsed: true,
        hypotheticalAnswer,
        latencyMs,
      };
    } catch (error) {
      // Fallback to standard retrieval (Requirement 23.5)
      const latencyMs = Date.now() - startTime;
      this.logger.error(`HyDE failed: ${error.message}, falling back to standard retrieval`);
      
      return this.fallbackToStandardRetrieval(query, filters, numberOfResults, latencyMs, error.message);
    }
  }

  /**
   * Generate a hypothetical answer to the query using Claude
   * 
   * Requirement: 23.1
   */
  private async generateHypotheticalAnswer(
    query: string,
    filters: MetadataFilter,
  ): Promise<string> {
    const ticker = filters.ticker || 'the company';
    const section = filters.sectionType || 'SEC filing';
    
    const prompt = `You are a financial analyst. Generate a hypothetical but realistic answer to the following question about ${ticker} based on typical SEC ${section} content.

Question: ${query}

Generate a detailed, factual-sounding answer that would typically appear in an SEC filing. Include specific details, numbers, and terminology that would be found in real filings. The answer should be 2-3 paragraphs.

Important: This is for document retrieval purposes. Generate content that would help find relevant SEC filing sections.

Hypothetical Answer:`;

    try {
      const response = await this.bedrock.invokeClaude({
        prompt,
        modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', // Fast model for HyDE
        max_tokens: 500,
      });

      return response.trim();
    } catch (error) {
      this.logger.error(`Hypothetical answer generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Merge and deduplicate chunks from HyDE and query-based retrieval
   * 
   * Requirement: 23.4
   */
  private mergeAndDeduplicate(
    hydeChunks: ChunkResult[],
    queryChunks: ChunkResult[],
  ): ChunkResult[] {
    const seen = new Map<string, ChunkResult>();

    // Process HyDE chunks first (often more relevant)
    for (const chunk of hydeChunks) {
      const key = this.getChunkKey(chunk);
      if (!seen.has(key)) {
        seen.set(key, { ...chunk, score: chunk.score * 1.1 }); // Slight boost for HyDE
      }
    }

    // Add query chunks, keeping higher score if duplicate
    for (const chunk of queryChunks) {
      const key = this.getChunkKey(chunk);
      const existing = seen.get(key);
      
      if (!existing) {
        seen.set(key, chunk);
      } else if (chunk.score > existing.score) {
        // Keep the higher score
        seen.set(key, { ...chunk, score: Math.max(chunk.score, existing.score) });
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Generate a unique key for chunk deduplication
   */
  private getChunkKey(chunk: ChunkResult): string {
    // Use content hash + metadata for deduplication
    const contentPrefix = chunk.content.substring(0, 200);
    return `${chunk.metadata.ticker}:${chunk.metadata.sectionType}:${chunk.metadata.chunkIndex || contentPrefix}`;
  }

  /**
   * Fallback to standard query-based retrieval when HyDE fails
   * 
   * Requirement: 23.5
   */
  private async fallbackToStandardRetrieval(
    query: string,
    filters: MetadataFilter,
    numberOfResults: number,
    latencyMs: number,
    errorMessage: string,
  ): Promise<HyDEResult> {
    this.logger.warn('HyDE fallback: using standard retrieval');
    
    // Log for monitoring
    this.logHyDEFailure(errorMessage, query);

    try {
      const chunks = await this.bedrock.retrieve(query, filters, numberOfResults);
      
      return {
        chunks,
        hydeUsed: false,
        latencyMs: Date.now() - (Date.now() - latencyMs), // Approximate total time
        error: errorMessage,
      };
    } catch (fallbackError) {
      this.logger.error(`HyDE fallback also failed: ${fallbackError.message}`);
      return {
        chunks: [],
        hydeUsed: false,
        latencyMs,
        error: `HyDE failed: ${errorMessage}, Fallback failed: ${fallbackError.message}`,
      };
    }
  }

  /**
   * Log HyDE failures for monitoring
   */
  private logHyDEFailure(error: string, query: string): void {
    this.logger.error({
      event: 'hyde_failure',
      error,
      queryLength: query.length,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Check if HyDE is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}
