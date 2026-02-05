import { Injectable, Logger } from '@nestjs/common';
import { BedrockService, ChunkResult, MetadataFilter } from './bedrock.service';

export interface SubQuery {
  query: string;
  focus: string; // What aspect this sub-query addresses
  priority: number; // 1 = highest priority
}

export interface DecompositionResult {
  isMultiFaceted: boolean;
  subQueries: SubQuery[];
  originalQuery: string;
}

export interface SubQueryResult {
  subQuery: SubQuery;
  chunks: ChunkResult[];
}

export interface DecomposedRetrievalResult {
  results: SubQueryResult[];
  mergedChunks: ChunkResult[];
  decomposed: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Query Decomposition Service
 * 
 * Phase 3: Advanced retrieval technique that breaks complex multi-faceted
 * queries into simpler sub-queries, executes each independently, and
 * synthesizes results.
 * 
 * Process:
 * 1. Detect if query is multi-faceted (multiple questions/aspects)
 * 2. Use Claude to decompose into sub-queries
 * 3. Execute each sub-query independently
 * 4. Track which sub-query contributed to which results
 * 5. Merge sub-query results
 * 
 * Requirements: 22.1, 22.2, 22.3, 22.4, 22.5
 */
@Injectable()
export class QueryDecompositionService {
  private readonly logger = new Logger(QueryDecompositionService.name);
  private readonly enabled: boolean;

  constructor(private readonly bedrock: BedrockService) {
    // Feature flag for enabling/disabling query decomposition
    this.enabled = process.env.ENABLE_QUERY_DECOMPOSITION !== 'false';
    
    if (this.enabled) {
      this.logger.log('Query Decomposition Service initialized');
    } else {
      this.logger.log('Query Decomposition Service disabled via feature flag');
    }
  }

  /**
   * Detect if a query is multi-faceted and decompose if needed
   * 
   * Requirement: 22.1
   */
  async detectAndDecompose(query: string): Promise<DecompositionResult> {
    if (!this.enabled) {
      return {
        isMultiFaceted: false,
        subQueries: [{ query, focus: 'original', priority: 1 }],
        originalQuery: query,
      };
    }

    // Quick heuristic check for multi-faceted queries
    const isLikelyMultiFaceted = this.quickMultiFacetedCheck(query);
    
    if (!isLikelyMultiFaceted) {
      return {
        isMultiFaceted: false,
        subQueries: [{ query, focus: 'original', priority: 1 }],
        originalQuery: query,
      };
    }

    try {
      // Use Claude to decompose the query
      const subQueries = await this.decomposeWithClaude(query);
      
      if (subQueries.length <= 1) {
        return {
          isMultiFaceted: false,
          subQueries: [{ query, focus: 'original', priority: 1 }],
          originalQuery: query,
        };
      }

      this.logger.log(`Decomposed query into ${subQueries.length} sub-queries`);
      
      return {
        isMultiFaceted: true,
        subQueries,
        originalQuery: query,
      };
    } catch (error) {
      this.logger.error(`Query decomposition failed: ${error.message}`);
      return {
        isMultiFaceted: false,
        subQueries: [{ query, focus: 'original', priority: 1 }],
        originalQuery: query,
      };
    }
  }

  /**
   * Execute decomposed retrieval - retrieve for each sub-query
   * 
   * Requirements: 22.2, 22.4
   */
  async decomposeAndRetrieve(
    query: string,
    filters: MetadataFilter,
    numberOfResults = 5,
  ): Promise<DecomposedRetrievalResult> {
    const startTime = Date.now();

    // Step 1: Detect and decompose
    const decomposition = await this.detectAndDecompose(query);

    if (!decomposition.isMultiFaceted) {
      // Not multi-faceted, return empty (caller should use standard retrieval)
      return {
        results: [],
        mergedChunks: [],
        decomposed: false,
        latencyMs: Date.now() - startTime,
      };
    }

    try {
      // Step 2: Execute each sub-query independently (Requirement 22.2)
      const subQueryResults: SubQueryResult[] = [];
      
      for (const subQuery of decomposition.subQueries) {
        this.logger.debug(`Executing sub-query: "${subQuery.query}" (focus: ${subQuery.focus})`);
        
        const chunks = await this.bedrock.retrieve(
          subQuery.query,
          filters,
          Math.ceil(numberOfResults / decomposition.subQueries.length) + 2, // Extra for merging
        );

        subQueryResults.push({
          subQuery,
          chunks,
        });
      }

      // Step 3: Merge results (Requirement 22.4)
      const mergedChunks = this.mergeSubQueryResults(subQueryResults, numberOfResults);

      const latencyMs = Date.now() - startTime;
      this.logger.log(
        `Decomposed retrieval complete: ${decomposition.subQueries.length} sub-queries → ${mergedChunks.length} merged chunks (${latencyMs}ms)`
      );

      return {
        results: subQueryResults,
        mergedChunks,
        decomposed: true,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      this.logger.error(`Decomposed retrieval failed: ${error.message}`);
      
      return {
        results: [],
        mergedChunks: [],
        decomposed: false,
        latencyMs,
        error: error.message,
      };
    }
  }

  /**
   * Quick heuristic check for multi-faceted queries
   */
  private quickMultiFacetedCheck(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    
    // Check for multiple question words
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which'];
    const questionCount = questionWords.filter(w => lowerQuery.includes(w)).length;
    
    // Check for conjunctions suggesting multiple aspects
    const hasMultipleAspects = 
      lowerQuery.includes(' and ') ||
      lowerQuery.includes(' also ') ||
      lowerQuery.includes(' as well as ') ||
      lowerQuery.includes(', ') ||
      lowerQuery.includes('?') && lowerQuery.indexOf('?') < lowerQuery.length - 1;
    
    // Check for comparison indicators
    const hasComparison = 
      lowerQuery.includes('compare') ||
      lowerQuery.includes('versus') ||
      lowerQuery.includes(' vs ') ||
      lowerQuery.includes('difference between');
    
    // Check query length (longer queries often multi-faceted)
    const isLongQuery = query.split(' ').length > 15;
    
    return questionCount >= 2 || hasMultipleAspects || hasComparison || isLongQuery;
  }

  /**
   * Use Claude to decompose a complex query into sub-queries
   * 
   * Requirement: 22.1
   */
  private async decomposeWithClaude(query: string): Promise<SubQuery[]> {
    const prompt = `Analyze this financial research query and break it down into simpler, focused sub-queries if it asks about multiple aspects.

Query: "${query}"

If this query asks about multiple distinct aspects, decompose it into 2-4 focused sub-queries. Each sub-query should:
1. Focus on ONE specific aspect
2. Be self-contained and answerable independently
3. Together cover all aspects of the original query

If the query is already focused on a single aspect, return just the original query.

Respond in JSON format:
{
  "isMultiFaceted": true/false,
  "subQueries": [
    {"query": "sub-query text", "focus": "what aspect this addresses", "priority": 1},
    ...
  ]
}

Only output valid JSON, no other text.`;

    try {
      const response = await this.bedrock.invokeClaude({
        prompt,
        modelId: 'us.anthropic.claude-3-haiku-20240307-v1:0',
        max_tokens: 500,
      });

      // Parse JSON response
      const parsed = JSON.parse(response.trim());
      
      if (!parsed.isMultiFaceted || !parsed.subQueries || parsed.subQueries.length === 0) {
        return [{ query, focus: 'original', priority: 1 }];
      }

      return parsed.subQueries.map((sq: any, index: number) => ({
        query: sq.query || query,
        focus: sq.focus || `aspect_${index + 1}`,
        priority: sq.priority || index + 1,
      }));
    } catch (error) {
      this.logger.error(`Claude decomposition failed: ${error.message}`);
      return [{ query, focus: 'original', priority: 1 }];
    }
  }

  /**
   * Merge results from multiple sub-queries
   * 
   * Requirements: 22.4, 22.5
   */
  private mergeSubQueryResults(
    subQueryResults: SubQueryResult[],
    maxResults: number,
  ): ChunkResult[] {
    const seen = new Map<string, ChunkResult & { sources: string[] }>();

    // Process results by priority
    const sortedResults = [...subQueryResults].sort(
      (a, b) => a.subQuery.priority - b.subQuery.priority
    );

    for (const result of sortedResults) {
      for (const chunk of result.chunks) {
        const key = this.getChunkKey(chunk);
        const existing = seen.get(key);

        if (!existing) {
          seen.set(key, {
            ...chunk,
            sources: [result.subQuery.focus],
          });
        } else {
          // Chunk found by multiple sub-queries - boost score
          existing.score = Math.max(existing.score, chunk.score) * 1.1;
          if (!existing.sources.includes(result.subQuery.focus)) {
            existing.sources.push(result.subQuery.focus);
          }
        }
      }
    }

    // Sort by score and limit
    const merged = Array.from(seen.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    // Log which sub-queries contributed
    for (const chunk of merged) {
      this.logger.debug(
        `Merged chunk from: ${(chunk as any).sources.join(', ')} (score: ${chunk.score.toFixed(3)})`
      );
    }

    return merged;
  }

  /**
   * Generate a unique key for chunk deduplication
   */
  private getChunkKey(chunk: ChunkResult): string {
    const contentPrefix = chunk.content.substring(0, 200);
    return `${chunk.metadata.ticker}:${chunk.metadata.sectionType}:${chunk.metadata.chunkIndex || contentPrefix}`;
  }

  /**
   * Check if query decomposition is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}
