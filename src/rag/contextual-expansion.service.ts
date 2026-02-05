import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChunkResult } from './bedrock.service';

export interface ExpandedChunk extends ChunkResult {
  expandedContent: string; // Combined content with adjacent chunks
  originalContent: string; // Original chunk content
  adjacentChunks: {
    before?: string;
    after?: string;
  };
  tokenCount: number;
}

export interface ExpansionResult {
  chunks: ExpandedChunk[];
  expanded: boolean;
  totalTokens: number;
  latencyMs: number;
  error?: string;
}

/**
 * Contextual Chunk Expansion Service
 * 
 * Phase 3: Advanced retrieval technique that expands retrieved chunks
 * by fetching adjacent chunks to provide more context for response
 * generation.
 * 
 * Process:
 * 1. For each retrieved chunk, fetch adjacent chunks (chunk_index ± 1)
 * 2. Merge adjacent chunks into coherent context window
 * 3. Preserve chunk boundaries for citations
 * 4. Enforce token budget to prevent context overflow
 * 
 * Requirements: 21.1, 21.2, 21.3, 21.4, 21.5
 */
@Injectable()
export class ContextualExpansionService {
  private readonly logger = new Logger(ContextualExpansionService.name);
  private readonly enabled: boolean;
  private readonly defaultTokenBudget: number;

  constructor(private readonly prisma: PrismaService) {
    // Feature flag for enabling/disabling contextual expansion
    this.enabled = process.env.ENABLE_CONTEXTUAL_EXPANSION !== 'false';
    
    // Token budget (default 4000 tokens as per requirements)
    this.defaultTokenBudget = parseInt(process.env.CONTEXT_TOKEN_BUDGET || '4000', 10);
    
    if (this.enabled) {
      this.logger.log(`Contextual Expansion Service initialized (budget: ${this.defaultTokenBudget} tokens)`);
    } else {
      this.logger.log('Contextual Expansion Service disabled via feature flag');
    }
  }

  /**
   * Expand chunks with adjacent context
   * 
   * @param chunks - Retrieved chunks to expand
   * @param maxTokens - Maximum total tokens for expanded context
   * @returns Expanded chunks with adjacent context
   * 
   * Requirements: 21.1, 21.2, 21.3, 21.4
   */
  async expandContext(
    chunks: ChunkResult[],
    maxTokens?: number,
  ): Promise<ExpansionResult> {
    const startTime = Date.now();
    const tokenBudget = maxTokens || this.defaultTokenBudget;

    if (!this.enabled) {
      return {
        chunks: chunks.map(c => this.toExpandedChunk(c)),
        expanded: false,
        totalTokens: this.estimateTotalTokens(chunks),
        latencyMs: Date.now() - startTime,
      };
    }

    if (chunks.length === 0) {
      return {
        chunks: [],
        expanded: false,
        totalTokens: 0,
        latencyMs: Date.now() - startTime,
      };
    }

    try {
      // Step 1: Fetch adjacent chunks for each retrieved chunk (Requirement 21.1)
      const expandedChunks: ExpandedChunk[] = [];
      let totalTokens = 0;

      // Sort by score to prioritize high-relevance chunks (Requirement 21.5)
      const sortedChunks = [...chunks].sort((a, b) => b.score - a.score);

      for (const chunk of sortedChunks) {
        // Check if we have budget for more expansion
        const currentTokens = this.estimateTokens(chunk.content);
        
        if (totalTokens + currentTokens > tokenBudget) {
          this.logger.debug(`Token budget reached (${totalTokens}/${tokenBudget}), stopping expansion`);
          break;
        }

        // Fetch adjacent chunks (Requirement 21.1)
        const expanded = await this.expandSingleChunk(chunk, tokenBudget - totalTokens);
        expandedChunks.push(expanded);
        totalTokens += expanded.tokenCount;
      }

      const latencyMs = Date.now() - startTime;
      this.logger.log(
        `Expanded ${expandedChunks.length} chunks, total tokens: ${totalTokens}/${tokenBudget} (${latencyMs}ms)`
      );

      return {
        chunks: expandedChunks,
        expanded: true,
        totalTokens,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      this.logger.error(`Contextual expansion failed: ${error.message}`);
      
      return {
        chunks: chunks.map(c => this.toExpandedChunk(c)),
        expanded: false,
        totalTokens: this.estimateTotalTokens(chunks),
        latencyMs,
        error: error.message,
      };
    }
  }

  /**
   * Expand a single chunk with adjacent context
   * 
   * Requirements: 21.1, 21.2, 21.3
   */
  private async expandSingleChunk(
    chunk: ChunkResult,
    remainingBudget: number,
  ): Promise<ExpandedChunk> {
    const chunkIndex = chunk.metadata.chunkIndex;
    
    // If no chunk index, can't expand
    if (chunkIndex === undefined || chunkIndex === null) {
      return this.toExpandedChunk(chunk);
    }

    const ticker = chunk.metadata.ticker;
    const sectionType = chunk.metadata.sectionType;

    // Fetch adjacent chunks from database (Requirement 21.1)
    const [beforeChunk, afterChunk] = await Promise.all([
      this.fetchAdjacentChunk(ticker, sectionType, chunkIndex - 1),
      this.fetchAdjacentChunk(ticker, sectionType, chunkIndex + 1),
    ]);

    // Calculate what we can include within budget (Requirement 21.4)
    const originalTokens = this.estimateTokens(chunk.content);
    let beforeContent = '';
    let afterContent = '';
    let totalTokens = originalTokens;

    // Try to add before chunk
    if (beforeChunk) {
      const beforeTokens = this.estimateTokens(beforeChunk);
      if (totalTokens + beforeTokens <= remainingBudget) {
        beforeContent = beforeChunk;
        totalTokens += beforeTokens;
      }
    }

    // Try to add after chunk
    if (afterChunk) {
      const afterTokens = this.estimateTokens(afterChunk);
      if (totalTokens + afterTokens <= remainingBudget) {
        afterContent = afterChunk;
        totalTokens += afterTokens;
      }
    }

    // Merge into coherent context (Requirement 21.2)
    const expandedContent = this.mergeChunks(beforeContent, chunk.content, afterContent);

    return {
      ...chunk,
      expandedContent,
      originalContent: chunk.content,
      adjacentChunks: {
        before: beforeContent || undefined,
        after: afterContent || undefined,
      },
      tokenCount: totalTokens,
    };
  }

  /**
   * Fetch an adjacent chunk from the database
   */
  private async fetchAdjacentChunk(
    ticker: string,
    sectionType: string,
    chunkIndex: number,
  ): Promise<string | null> {
    if (chunkIndex < 0) return null;

    try {
      const chunk = await this.prisma.narrativeChunk.findFirst({
        where: {
          ticker,
          sectionType,
          chunkIndex,
        },
        select: {
          content: true,
        },
      });

      return chunk?.content || null;
    } catch (error) {
      this.logger.debug(`Failed to fetch adjacent chunk: ${error.message}`);
      return null;
    }
  }

  /**
   * Merge chunks into coherent context
   * Preserves chunk boundaries with markers for citations (Requirement 21.3)
   */
  private mergeChunks(
    before: string,
    original: string,
    after: string,
  ): string {
    const parts: string[] = [];

    if (before) {
      parts.push(`[CONTEXT BEFORE]\n${before}\n[/CONTEXT BEFORE]`);
    }

    parts.push(`[MAIN CONTENT]\n${original}\n[/MAIN CONTENT]`);

    if (after) {
      parts.push(`[CONTEXT AFTER]\n${after}\n[/CONTEXT AFTER]`);
    }

    return parts.join('\n\n');
  }

  /**
   * Convert a regular chunk to an expanded chunk (no expansion)
   */
  private toExpandedChunk(chunk: ChunkResult): ExpandedChunk {
    return {
      ...chunk,
      expandedContent: chunk.content,
      originalContent: chunk.content,
      adjacentChunks: {},
      tokenCount: this.estimateTokens(chunk.content),
    };
  }

  /**
   * Estimate token count for text
   * Uses rough approximation: ~4 characters per token
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate total tokens for all chunks
   */
  private estimateTotalTokens(chunks: ChunkResult[]): number {
    return chunks.reduce((sum, chunk) => sum + this.estimateTokens(chunk.content), 0);
  }

  /**
   * Check if contextual expansion is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get current token budget
   */
  getTokenBudget(): number {
    return this.defaultTokenBudget;
  }
}
