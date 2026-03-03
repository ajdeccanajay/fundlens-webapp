import { Injectable, Logger } from '@nestjs/common';
import { BedrockService, ChunkResult, MetadataFilter } from './bedrock.service';

export interface IterationInfo {
  iteration: number;
  query: string;
  chunksRetrieved: number;
  avgScore: number;
  reason: string;
}

export interface IterativeRetrievalResult {
  chunks: ChunkResult[];
  iterations: IterationInfo[];
  totalIterations: number;
  improved: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Iterative Retrieval Service
 * 
 * Phase 3: Advanced retrieval technique that detects low-confidence
 * results and performs follow-up queries to fill gaps.
 * 
 * Process:
 * 1. Detect when initial retrieval returns low-confidence results
 * 2. Generate follow-up queries to fill gaps
 * 3. Execute follow-up queries and merge results
 * 4. Track which iteration contributed to which information
 * 5. Limit to maximum 2 iterations
 * 
 * Requirements: 26.1, 26.2, 26.3, 26.4, 26.5
 */
@Injectable()
export class IterativeRetrievalService {
  private readonly logger = new Logger(IterativeRetrievalService.name);
  private readonly enabled: boolean;
  private readonly maxIterations: number;
  private readonly confidenceThreshold: number;

  constructor(private readonly bedrock: BedrockService) {
    // Feature flag for enabling/disabling iterative retrieval
    this.enabled = process.env.ENABLE_ITERATIVE_RETRIEVAL !== 'false';
    
    // Maximum iterations (Requirement 26.3)
    this.maxIterations = parseInt(process.env.MAX_RETRIEVAL_ITERATIONS || '2', 10);
    
    // Confidence threshold for triggering follow-up
    this.confidenceThreshold = parseFloat(process.env.RETRIEVAL_CONFIDENCE_THRESHOLD || '0.5');
    
    if (this.enabled) {
      this.logger.log(
        `Iterative Retrieval Service initialized (max: ${this.maxIterations} iterations, threshold: ${this.confidenceThreshold})`
      );
    } else {
      this.logger.log('Iterative Retrieval Service disabled via feature flag');
    }
  }

  /**
   * Perform iterative retrieval with follow-up queries
   * 
   * @param query - The user's search query
   * @param filters - Metadata filters for retrieval
   * @param numberOfResults - Number of results to return
   * @returns Combined results from all iterations
   * 
   * Requirements: 26.1, 26.2, 26.3, 26.4
   */
  async iterativeRetrieve(
    query: string,
    filters: MetadataFilter,
    numberOfResults = 5,
  ): Promise<IterativeRetrievalResult> {
    const startTime = Date.now();
    const iterations: IterationInfo[] = [];
    const allChunks: ChunkResult[] = [];
    const seenChunkKeys = new Set<string>();

    if (!this.enabled) {
      return {
        chunks: [],
        iterations: [],
        totalIterations: 0,
        improved: false,
        latencyMs: Date.now() - startTime,
      };
    }

    try {
      // Iteration 1: Initial retrieval
      const initialChunks = await this.bedrock.retrieve(query, filters, numberOfResults);
      const initialAvgScore = this.calculateAvgScore(initialChunks);
      
      iterations.push({
        iteration: 1,
        query,
        chunksRetrieved: initialChunks.length,
        avgScore: initialAvgScore,
        reason: 'initial',
      });

      // Add initial chunks
      for (const chunk of initialChunks) {
        const key = this.getChunkKey(chunk);
        if (!seenChunkKeys.has(key)) {
          seenChunkKeys.add(key);
          allChunks.push({ ...chunk, metadata: { ...chunk.metadata } });
        }
      }

      // Check if we need follow-up (Requirement 26.1)
      if (!this.needsFollowUp(initialChunks, initialAvgScore)) {
        this.logger.debug('Initial retrieval sufficient, no follow-up needed');
        return {
          chunks: allChunks,
          iterations,
          totalIterations: 1,
          improved: false,
          latencyMs: Date.now() - startTime,
        };
      }

      // Iterative follow-up (Requirement 26.2, 26.3)
      let currentIteration = 1;
      let previousAvgScore = initialAvgScore;

      while (currentIteration < this.maxIterations) {
        currentIteration++;
        
        // Generate follow-up query
        const followUpQuery = await this.generateFollowUpQuery(
          query,
          allChunks,
          filters,
        );

        if (!followUpQuery) {
          this.logger.debug('No follow-up query generated, stopping iteration');
          break;
        }

        this.logger.debug(`Iteration ${currentIteration}: "${followUpQuery}"`);

        // Execute follow-up query (Requirement 26.2)
        const followUpChunks = await this.bedrock.retrieve(
          followUpQuery,
          filters,
          numberOfResults,
        );

        const followUpAvgScore = this.calculateAvgScore(followUpChunks);

        iterations.push({
          iteration: currentIteration,
          query: followUpQuery,
          chunksRetrieved: followUpChunks.length,
          avgScore: followUpAvgScore,
          reason: 'follow_up',
        });

        // Add new chunks (Requirement 26.4)
        let newChunksAdded = 0;
        for (const chunk of followUpChunks) {
          const key = this.getChunkKey(chunk);
          if (!seenChunkKeys.has(key)) {
            seenChunkKeys.add(key);
            allChunks.push({ ...chunk, metadata: { ...chunk.metadata } });
            newChunksAdded++;
          }
        }

        // Check if iteration improved results (Requirement 26.5)
        if (newChunksAdded === 0 || followUpAvgScore <= previousAvgScore * 0.9) {
          this.logger.debug(
            `Iteration ${currentIteration} did not improve results (new: ${newChunksAdded}, score: ${followUpAvgScore.toFixed(3)} vs ${previousAvgScore.toFixed(3)})`
          );
          break;
        }

        previousAvgScore = Math.max(previousAvgScore, followUpAvgScore);
      }

      // Sort all chunks by score and limit
      allChunks.sort((a, b) => b.score - a.score);
      const finalChunks = allChunks.slice(0, numberOfResults);

      const latencyMs = Date.now() - startTime;
      this.logger.log(
        `Iterative retrieval complete: ${iterations.length} iterations, ${finalChunks.length} chunks (${latencyMs}ms)`
      );

      return {
        chunks: finalChunks,
        iterations,
        totalIterations: iterations.length,
        improved: iterations.length > 1,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      this.logger.error(`Iterative retrieval failed: ${error.message}`);
      
      return {
        chunks: allChunks,
        iterations,
        totalIterations: iterations.length,
        improved: false,
        latencyMs,
        error: error.message,
      };
    }
  }

  /**
   * Detect if initial retrieval needs follow-up
   * 
   * Requirement: 26.1
   */
  private needsFollowUp(chunks: ChunkResult[], avgScore: number): boolean {
    // Low confidence if:
    // 1. Few chunks retrieved
    // 2. Low average score
    // 3. High score variance (inconsistent results)
    
    if (chunks.length < 3) {
      this.logger.debug('Low chunk count, needs follow-up');
      return true;
    }

    if (avgScore < this.confidenceThreshold) {
      this.logger.debug(`Low avg score (${avgScore.toFixed(3)} < ${this.confidenceThreshold}), needs follow-up`);
      return true;
    }

    // Check score variance
    const scores = chunks.map(c => c.score);
    const variance = this.calculateVariance(scores);
    if (variance > 0.1) {
      this.logger.debug(`High score variance (${variance.toFixed(3)}), needs follow-up`);
      return true;
    }

    return false;
  }

  /**
   * Generate a follow-up query to fill gaps
   * 
   * Requirement: 26.2
   */
  private async generateFollowUpQuery(
    originalQuery: string,
    currentChunks: ChunkResult[],
    filters: MetadataFilter,
  ): Promise<string | null> {
    // Analyze what's missing from current results
    const currentTopics = this.extractTopics(currentChunks);
    
    const prompt = `Given this original query and the topics already covered, generate a follow-up query to find additional relevant information.

Original Query: "${originalQuery}"
Company: ${filters.ticker || 'Unknown'}
Section: ${filters.sectionType || 'Any'}

Topics Already Covered:
${currentTopics.join('\n')}

Generate a single follow-up query that:
1. Addresses aspects of the original query not yet covered
2. Uses different keywords to find additional relevant content
3. Is specific and focused

If the original query is fully addressed, respond with "NONE".

Follow-up Query:`;

    try {
      const response = await this.bedrock.invokeClaude({
        prompt,
        modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        max_tokens: 100,
      });

      const followUp = response.trim();
      
      if (followUp === 'NONE' || followUp.toLowerCase().includes('none')) {
        return null;
      }

      return followUp;
    } catch (error) {
      this.logger.error(`Follow-up query generation failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract topics from retrieved chunks
   */
  private extractTopics(chunks: ChunkResult[]): string[] {
    const topics: string[] = [];
    
    for (const chunk of chunks.slice(0, 5)) {
      // Extract first sentence or key phrase
      const firstSentence = chunk.content.split(/[.!?]/)[0]?.trim();
      if (firstSentence && firstSentence.length > 20) {
        topics.push(`- ${firstSentence.substring(0, 100)}...`);
      }
    }

    return topics;
  }

  /**
   * Calculate average score of chunks
   */
  private calculateAvgScore(chunks: ChunkResult[]): number {
    if (chunks.length === 0) return 0;
    return chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length;
  }

  /**
   * Calculate variance of scores
   */
  private calculateVariance(scores: number[]): number {
    if (scores.length === 0) return 0;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    return scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
  }

  /**
   * Generate a unique key for chunk deduplication
   */
  private getChunkKey(chunk: ChunkResult): string {
    const contentPrefix = chunk.content.substring(0, 200);
    return `${chunk.metadata.ticker}:${chunk.metadata.sectionType}:${chunk.metadata.chunkIndex || contentPrefix}`;
  }

  /**
   * Check if iterative retrieval is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get configuration
   */
  getConfig(): { maxIterations: number; confidenceThreshold: number } {
    return {
      maxIterations: this.maxIterations,
      confidenceThreshold: this.confidenceThreshold,
    };
  }
}
