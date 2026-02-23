import { Injectable, Logger } from '@nestjs/common';
import { BedrockService, ChunkResult, MetadataFilter } from './bedrock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StructuredRetrieverService } from './structured-retriever.service';
import { AdvancedRetrievalService, AdvancedRetrievalConfig } from './advanced-retrieval.service';
import { DocumentType } from './types/query-intent';
import { MetricResolution } from './metric-resolution/types';

export interface SemanticQuery {
  query: string;
  tickers?: string[];
  sectionTypes?: string[];
  subsectionNames?: string[]; // Phase 2: Subsection filtering
  documentTypes?: string[];
  fiscalPeriod?: string;
  numberOfResults?: number;
}

export interface RetrievalSummary {
  total: number;
  avgScore: number;
  sections: Record<string, number>;
  tickers: Record<string, number>;
}

export interface EnhancedSemanticResult {
  narratives: ChunkResult[];
  contextualMetrics: any[]; // RDS metrics relevant to the semantic query
  summary: RetrievalSummary;
}

/**
 * Semantic Retriever Service
 * Handles narrative retrieval from:
 * 1. AWS Bedrock Knowledge Base (when configured)
 * 2. PostgreSQL fallback (when Bedrock not available)
 * 
 * Phase 3: Now integrates with AdvancedRetrievalService for:
 * - HyDE (Hypothetical Document Embeddings)
 * - Query Decomposition
 * - Contextual Expansion
 * - Iterative Retrieval
 * - Reranking (when available)
 */
@Injectable()
export class SemanticRetrieverService {
  private readonly logger = new Logger(SemanticRetrieverService.name);
  private readonly useBedrockKB: boolean;
  private readonly useAdvancedRetrieval: boolean;

  constructor(
    private readonly bedrock: BedrockService,
    private readonly prisma: PrismaService,
    private readonly structuredRetriever: StructuredRetrieverService,
    private readonly advancedRetrieval: AdvancedRetrievalService,
  ) {
    this.useBedrockKB = !!process.env.BEDROCK_KB_ID;
    this.useAdvancedRetrieval = process.env.ENABLE_ADVANCED_RETRIEVAL !== 'false';

    if (this.useBedrockKB) {
      this.logger.log('Using AWS Bedrock Knowledge Base for semantic retrieval');
    } else {
      this.logger.log(
        'Using PostgreSQL fallback for semantic retrieval (Bedrock KB not configured)',
      );
    }
    
    if (this.useAdvancedRetrieval) {
      this.logger.log('🚀 Phase 3 Advanced Retrieval ENABLED');
      const status = this.advancedRetrieval.getStatus();
      this.logger.log(`   HyDE: ${status.hyde ? '✅' : '❌'}`);
      this.logger.log(`   Query Decomposition: ${status.queryDecomposition ? '✅' : '❌'}`);
      this.logger.log(`   Contextual Expansion: ${status.contextualExpansion ? '✅' : '❌'}`);
      this.logger.log(`   Iterative Retrieval: ${status.iterativeRetrieval ? '✅' : '❌'}`);
      this.logger.log(`   Reranking: ${status.reranking ? '✅' : '❌'}`);
    } else {
      this.logger.log('Phase 3 Advanced Retrieval DISABLED');
    }
  }

  /**
   * Retrieve narratives semantically
   */
  async retrieve(query: SemanticQuery): Promise<{
    narratives: ChunkResult[];
    summary: RetrievalSummary;
  }> {
    let narratives: ChunkResult[];

    if (this.useBedrockKB) {
      // Use Bedrock Knowledge Base (semantic vector search)
      narratives = await this.retrieveFromBedrock(query);
    } else {
      // Fallback to PostgreSQL (keyword search)
      narratives = await this.retrieveFromPostgres(query);
    }

    const summary = this.buildSummary(narratives);

    return { narratives, summary };
  }

  /**
   * Enhanced retrieve with contextual RDS metrics for response building
   * This exposes RDS data to semantic queries for richer responses
   */
  async retrieveWithContext(query: SemanticQuery): Promise<EnhancedSemanticResult> {
    // CRITICAL: Handle multiple tickers separately to prevent mixing
    if (query.tickers && query.tickers.length > 1) {
      return this.retrieveMultipleTickersWithContext(query);
    }

    // Single ticker retrieval (most common case)
    const { narratives, summary } = await this.retrieve(query);

    // Extract tickers from narratives or query
    const tickers = this.extractTickersFromContext(query, narratives);
    
    // Get contextual metrics from RDS for response building
    const contextualMetrics = await this.getContextualMetrics(query, tickers);

    this.logger.log(
      `Enhanced retrieval: ${narratives.length} narratives + ${contextualMetrics.length} contextual metrics`
    );

    return {
      narratives,
      contextualMetrics,
      summary,
    };
  }

  /**
   * Handle multiple tickers separately to prevent cross-contamination
   */
  private async retrieveMultipleTickersWithContext(query: SemanticQuery): Promise<EnhancedSemanticResult> {
    this.logger.log(`🔒 Multi-ticker retrieval with strict separation: ${query.tickers?.join(', ')}`);
    
    const allNarratives: ChunkResult[] = [];
    const allContextualMetrics: any[] = [];
    const tickerCounts: Record<string, number> = {};
    const sectionCounts: Record<string, number> = {};
    let totalScore = 0;

    // Retrieve for each ticker separately
    for (const ticker of query.tickers || []) {
      const singleTickerQuery: SemanticQuery = {
        ...query,
        tickers: [ticker], // Single ticker only
      };

      try {
        const { narratives, summary } = await this.retrieve(singleTickerQuery);
        const contextualMetrics = await this.getContextualMetrics(singleTickerQuery, [ticker]);

        // Add to combined results
        allNarratives.push(...narratives);
        allContextualMetrics.push(...contextualMetrics);

        // Update counts
        tickerCounts[ticker] = narratives.length;
        Object.entries(summary.sections).forEach(([section, count]) => {
          sectionCounts[section] = (sectionCounts[section] || 0) + count;
        });
        totalScore += summary.avgScore * narratives.length;

        this.logger.log(`✅ ${ticker}: ${narratives.length} narratives, ${contextualMetrics.length} metrics`);
      } catch (error) {
        this.logger.error(`❌ Failed to retrieve for ${ticker}: ${error.message}`);
      }
    }

    const combinedSummary: RetrievalSummary = {
      total: allNarratives.length,
      avgScore: allNarratives.length > 0 ? totalScore / allNarratives.length : 0,
      sections: sectionCounts,
      tickers: tickerCounts,
    };

    this.logger.log(
      `🔒 Multi-ticker retrieval complete: ${allNarratives.length} narratives, ${allContextualMetrics.length} metrics`
    );

    return {
      narratives: allNarratives,
      contextualMetrics: allContextualMetrics,
      summary: combinedSummary,
    };
  }

  /**
   * Retrieve from AWS Bedrock Knowledge Base
   * Phase 2: Now supports subsection filtering with fallback chain
   * Phase 3: Now uses AdvancedRetrievalService for HyDE, decomposition, expansion, etc.
   * 
   * ENHANCED: Now handles multiple section types by searching each and merging results
   */
  private async retrieveFromBedrock(
    query: SemanticQuery,
  ): Promise<ChunkResult[]> {
    // CRITICAL: Always filter by ticker to prevent company mix-ups
    const primaryTicker = query.tickers?.[0];
    const primarySubsection = query.subsectionNames?.[0];
    const sectionTypes = query.sectionTypes || [];
    
    const numberOfResults = query.numberOfResults || 5;

    this.logger.log(`🔍 Bedrock retrieval with STRICT ticker filtering`);
    this.logger.log(`   Query: "${query.query}"`);
    this.logger.log(`   Primary Ticker: ${primaryTicker || 'NONE - WARNING!'}`);
    this.logger.log(`   Section Types: ${sectionTypes.join(', ') || 'NONE'}`);
    if (primarySubsection) {
      this.logger.log(`   Subsection: ${primarySubsection}`);
    }

    if (!primaryTicker) {
      this.logger.warn('⚠️ NO TICKER FILTER - This may return mixed company results!');
    }

    let results: ChunkResult[] = [];

    // ENHANCED: If multiple section types, search each and merge results
    if (sectionTypes.length > 1) {
      this.logger.log(`🔄 Multiple section types detected, searching each separately`);
      const allResults: ChunkResult[] = [];
      const resultsPerSection = Math.ceil(numberOfResults / sectionTypes.length);
      
      for (const sectionType of sectionTypes) {
        const filter: MetadataFilter = {
          ticker: primaryTicker,
          sectionType: sectionType,
          filingType: query.documentTypes?.[0],
          fiscalPeriod: query.fiscalPeriod,
        };
        
        this.logger.log(`   Searching section: ${sectionType}`);
        
        let sectionResults: ChunkResult[] = [];
        
        if (this.useAdvancedRetrieval && this.useBedrockKB) {
          const advancedConfig: AdvancedRetrievalConfig = {
            numberOfResults: resultsPerSection,
            maxTokens: parseInt(process.env.CONTEXT_TOKEN_BUDGET || '4000', 10),
          };
          
          const advancedResult = await this.advancedRetrieval.retrieve(
            query.query,
            filter,
            advancedConfig,
          );
          
          sectionResults = advancedResult.chunks.map(chunk => {
            if ('expandedContent' in chunk) {
              return {
                content: chunk.expandedContent || chunk.content,
                score: chunk.score,
                metadata: chunk.metadata,
                source: chunk.source,
              };
            }
            return chunk as ChunkResult;
          });
        } else {
          sectionResults = await this.bedrock.retrieve(query.query, filter, resultsPerSection);
        }
        
        this.logger.log(`   Found ${sectionResults.length} results in ${sectionType}`);
        allResults.push(...sectionResults);
      }
      
      // Sort by score and take top results
      results = allResults
        .sort((a, b) => b.score - a.score)
        .slice(0, numberOfResults);
      
      this.logger.log(`🔄 Merged ${allResults.length} results from ${sectionTypes.length} sections, returning top ${results.length}`);
    } else {
      // Single section type (original logic)
      const filter: MetadataFilter = {
        ticker: primaryTicker,
        sectionType: sectionTypes[0],
        subsectionName: primarySubsection,
        filingType: query.documentTypes?.[0],
        fiscalPeriod: query.fiscalPeriod,
      };

      this.logger.log(`   Filter: ${JSON.stringify(filter)}`);

      // Phase 3: Use Advanced Retrieval Service if enabled
      if (this.useAdvancedRetrieval && this.useBedrockKB) {
        this.logger.log(`🚀 Using Phase 3 Advanced Retrieval techniques`);
        
        const advancedConfig: AdvancedRetrievalConfig = {
          numberOfResults,
          maxTokens: parseInt(process.env.CONTEXT_TOKEN_BUDGET || '4000', 10),
        };
        
        const advancedResult = await this.advancedRetrieval.retrieve(
          query.query,
          filter,
          advancedConfig,
        );
        
        // Log which techniques were used
        if (advancedResult.metrics.techniquesUsed.length > 0) {
          this.logger.log(`   Techniques used: ${advancedResult.metrics.techniquesUsed.join(', ')}`);
          this.logger.log(`   Total latency: ${advancedResult.metrics.totalLatencyMs}ms`);
        }
        
        if (advancedResult.errors.length > 0) {
          this.logger.warn(`   Errors: ${advancedResult.errors.join(', ')}`);
        }
        
        // Convert ExpandedChunk[] to ChunkResult[] if needed
        results = advancedResult.chunks.map(chunk => {
          // Check if it's an ExpandedChunk (has expandedContent)
          if ('expandedContent' in chunk) {
            return {
              content: chunk.expandedContent || chunk.content,
              score: chunk.score,
              metadata: chunk.metadata,
              source: chunk.source,
            };
          }
          return chunk as ChunkResult;
        });
      } else {
        // Standard retrieval without advanced techniques
        results = await this.bedrock.retrieve(query.query, filter, numberOfResults);
      }
      
      // Phase 2: Implement fallback chain for subsection filtering
      // Fallback 1: If subsection filtering returns no results, try section-only
      if (results.length === 0 && primarySubsection) {
        this.logger.log(`⚠️ No results with subsection filter, falling back to section-only`);
        const sectionOnlyFilter: MetadataFilter = {
          ticker: primaryTicker,
          sectionType: sectionTypes[0],
          filingType: query.documentTypes?.[0],
          fiscalPeriod: query.fiscalPeriod,
        };
        results = await this.bedrock.retrieve(query.query, sectionOnlyFilter, numberOfResults);
      }
    }
    
    // Fallback 2: If section filtering returns no results, try broader search (ticker only)
    if (results.length === 0 && query.sectionTypes?.[0]) {
      this.logger.log(`⚠️ No results with section filter, falling back to broader search`);
      const broaderFilter: MetadataFilter = {
        ticker: primaryTicker,
        filingType: query.documentTypes?.[0],
        fiscalPeriod: query.fiscalPeriod,
      };
      results = await this.bedrock.retrieve(query.query, broaderFilter, numberOfResults);
    }
    
    // Post-filter results to ensure ticker accuracy (double-check)
    const filteredResults = primaryTicker 
      ? results.filter(r => r.metadata.ticker?.toUpperCase() === primaryTicker.toUpperCase())
      : results;
    
    if (filteredResults.length < results.length) {
      this.logger.warn(`🔒 Post-filtered results: ${results.length} → ${filteredResults.length} (removed mixed companies)`);
    }
    
    this.logger.log(`✅ Bedrock returned ${filteredResults.length} ticker-filtered results`);

    return filteredResults;
  }

  /**
   * Retrieve from PostgreSQL (fallback)
   * Uses enhanced keyword search on narrative chunks
   * Phase 2: Now supports subsection filtering with fallback chain
   */
  private async retrieveFromPostgres(
    query: SemanticQuery,
  ): Promise<ChunkResult[]> {
    this.logger.log(`Retrieving from PostgreSQL: "${query.query}"`);

    // Build where clause
    const where: any = {};

    if (query.tickers && query.tickers.length > 0) {
      where.ticker = { in: query.tickers };
    }

    if (query.sectionTypes && query.sectionTypes.length > 0) {
      where.sectionType = { in: query.sectionTypes };
    }

    // Phase 2: Add subsection filtering if provided
    const primarySubsection = query.subsectionNames?.[0];
    if (primarySubsection) {
      where.subsectionName = primarySubsection;
      this.logger.log(`🔍 PostgreSQL: Filtering by subsection: ${primarySubsection}`);
    }

    if (query.documentTypes && query.documentTypes.length > 0) {
      where.filingType = { in: query.documentTypes };
    }

    // Enhanced keyword extraction and matching
    const keywords = this.extractKeywords(query.query);
    
    // Try different search strategies with fallback chain
    let chunks: any[] = [];

    // Strategy 1: Exact phrase search with subsection filter
    if (query.query.length > 10) {
      chunks = await this.prisma.narrativeChunk.findMany({
        where: {
          ...where,
          content: {
            contains: query.query,
            mode: 'insensitive' as const,
          },
        },
        take: query.numberOfResults || 5,
        orderBy: {
          chunkIndex: 'asc',
        },
      });
      
      if (chunks.length > 0) {
        this.logger.log(`✅ PostgreSQL: Found ${chunks.length} chunks with exact phrase + subsection`);
      }
    }

    // Strategy 2: Multi-keyword search if exact phrase didn't work
    if (chunks.length === 0 && keywords.length > 0) {
      chunks = await this.prisma.narrativeChunk.findMany({
        where: {
          ...where,
          AND: keywords.map((keyword) => ({
            content: {
              contains: keyword,
              mode: 'insensitive' as const,
            },
          })),
        },
        take: query.numberOfResults || 5,
        orderBy: {
          chunkIndex: 'asc',
        },
      });
      
      if (chunks.length > 0) {
        this.logger.log(`✅ PostgreSQL: Found ${chunks.length} chunks with multi-keyword + subsection`);
      }
    }

    // Strategy 3: Any keyword match if AND search didn't work
    if (chunks.length === 0 && keywords.length > 0) {
      chunks = await this.prisma.narrativeChunk.findMany({
        where: {
          ...where,
          OR: keywords.map((keyword) => ({
            content: {
              contains: keyword,
              mode: 'insensitive' as const,
            },
          })),
        },
        take: query.numberOfResults || 5,
        orderBy: {
          chunkIndex: 'asc',
        },
      });
      
      if (chunks.length > 0) {
        this.logger.log(`✅ PostgreSQL: Found ${chunks.length} chunks with any keyword + subsection`);
      }
    }

    // Phase 2 Fallback 1: If subsection filtering returns no results, try section-only
    if (chunks.length === 0 && primarySubsection) {
      this.logger.log(`⚠️ PostgreSQL: No results with subsection filter, falling back to section-only`);
      const sectionOnlyWhere = { ...where };
      delete sectionOnlyWhere.subsectionName;
      
      // Retry with section-only filter
      if (query.query.length > 10) {
        chunks = await this.prisma.narrativeChunk.findMany({
          where: {
            ...sectionOnlyWhere,
            content: {
              contains: query.query,
              mode: 'insensitive' as const,
            },
          },
          take: query.numberOfResults || 5,
          orderBy: {
            chunkIndex: 'asc',
          },
        });
      }
      
      if (chunks.length === 0 && keywords.length > 0) {
        chunks = await this.prisma.narrativeChunk.findMany({
          where: {
            ...sectionOnlyWhere,
            OR: keywords.map((keyword) => ({
              content: {
                contains: keyword,
                mode: 'insensitive' as const,
              },
            })),
          },
          take: query.numberOfResults || 5,
          orderBy: {
            chunkIndex: 'asc',
          },
        });
      }
      
      if (chunks.length > 0) {
        this.logger.log(`✅ PostgreSQL: Found ${chunks.length} chunks with section-only fallback`);
      }
    }

    // Phase 2 Fallback 2: If section filtering returns no results, try broader search
    if (chunks.length === 0 && query.sectionTypes && query.sectionTypes.length > 0) {
      this.logger.log(`⚠️ PostgreSQL: No results with section filter, falling back to broader search`);
      const broaderWhere = { ...where };
      delete broaderWhere.sectionType;
      delete broaderWhere.subsectionName;
      
      chunks = await this.getSectionBasedResults(query, broaderWhere);
      
      if (chunks.length > 0) {
        this.logger.log(`✅ PostgreSQL: Found ${chunks.length} chunks with broader fallback`);
      }
    }

    // Strategy 4: Section-based fallback for common queries (if still no results)
    if (chunks.length === 0) {
      chunks = await this.getSectionBasedResults(query, where);
    }

    this.logger.log(`Retrieved ${chunks.length} chunks from PostgreSQL`);

    // Convert to ChunkResult format with relevance scoring
    return chunks.map((chunk, index) => ({
      content: chunk.content,
      score: this.calculateRelevanceScore(chunk.content, query.query, index),
      metadata: {
        ticker: chunk.ticker,
        sectionType: chunk.sectionType,
        filingType: chunk.filingType,
        fiscalPeriod: this.extractFiscalPeriodFromContent(chunk.content) || 'Recent',
        chunkIndex: chunk.chunkIndex,
      },
      source: {
        location: `postgres://${chunk.id}`,
        type: 'database',
      },
    }));
  }

  /**
   * Extract meaningful keywords from query
   */
  private extractKeywords(query: string): string[] {
    const stopWords = new Set([
      'what', 'are', 'is', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'how', 'why', 'when', 'where', 'who', 'which', 'that', 'this', 'these', 'those', 'a', 'an'
    ]);

    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
      .slice(0, 5); // Limit to 5 most important keywords
  }

  /**
   * Get section-based results for common query patterns
   */
  private async getSectionBasedResults(query: SemanticQuery, where: any): Promise<any[]> {
    const queryLower = query.query.toLowerCase();
    let sectionType: string | undefined;

    // Map common queries to section types
    if (queryLower.includes('risk') || queryLower.includes('factor')) {
      sectionType = 'risk_factors';
    } else if (queryLower.includes('business') || queryLower.includes('segment') || queryLower.includes('operation')) {
      sectionType = 'business';
    } else if (queryLower.includes('management') || queryLower.includes('discussion') || queryLower.includes('analysis')) {
      sectionType = 'mda';
    }

    if (sectionType) {
      this.logger.log(`Using section-based fallback: ${sectionType}`);
      return this.prisma.narrativeChunk.findMany({
        where: {
          ...where,
          sectionType,
        },
        take: query.numberOfResults || 5,
        orderBy: {
          chunkIndex: 'asc',
        },
      });
    }

    return [];
  }

  /**
   * Extract fiscal period from content (fallback method)
   */
  private extractFiscalPeriodFromContent(content: string): string | null {
    // Look for common fiscal period patterns in the content
    const patterns = [
      /fiscal\s+year\s+(\d{4})/i,
      /year\s+ended?\s+\w+\s+\d+,?\s+(\d{4})/i,
      /september\s+\d+,?\s+(\d{4})/i,
      /december\s+\d+,?\s+(\d{4})/i,
      /(\d{4})\s+form\s+10-k/i,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Calculate relevance score for PostgreSQL results
   */
  private calculateRelevanceScore(content: string, query: string, position: number): number {
    const contentLower = content.toLowerCase();
    const queryLower = query.toLowerCase();
    
    let score = 0.3; // Base score

    // Exact phrase match
    if (contentLower.includes(queryLower)) {
      score += 0.4;
    }

    // Keyword matches
    const keywords = this.extractKeywords(query);
    const matchedKeywords = keywords.filter(keyword => contentLower.includes(keyword));
    score += (matchedKeywords.length / keywords.length) * 0.2;

    // Position penalty (earlier results are better)
    score -= position * 0.02;

    // Content length bonus (longer content might be more comprehensive)
    if (content.length > 1000) {
      score += 0.05;
    }

    return Math.max(0.1, Math.min(0.95, score));
  }

  /**
   * Build retrieval summary
   */
  private buildSummary(narratives: ChunkResult[]): RetrievalSummary {
    const sections: Record<string, number> = {};
    const tickers: Record<string, number> = {};
    let totalScore = 0;

    for (const narrative of narratives) {
      // Count sections
      const section = narrative.metadata.sectionType;
      sections[section] = (sections[section] || 0) + 1;

      // Count tickers
      const ticker = narrative.metadata.ticker;
      tickers[ticker] = (tickers[ticker] || 0) + 1;

      // Sum scores
      totalScore += narrative.score;
    }

    return {
      total: narratives.length,
      avgScore: narratives.length > 0 ? totalScore / narratives.length : 0,
      sections,
      tickers,
    };
  }

  /**
   * Extract tickers from query and narratives for contextual metrics
   */
  private extractTickersFromContext(query: SemanticQuery, narratives: ChunkResult[]): string[] {
    const tickers = new Set<string>();

    // Add tickers from query
    if (query.tickers) {
      query.tickers.forEach(ticker => tickers.add(ticker));
    }

    // Add tickers from retrieved narratives
    narratives.forEach(narrative => {
      if (narrative.metadata.ticker) {
        tickers.add(narrative.metadata.ticker);
      }
    });

    // If no tickers found, try to extract from query text
    if (tickers.size === 0) {
      const queryTickers = this.extractTickersFromText(query.query);
      queryTickers.forEach(ticker => tickers.add(ticker));
    }

    return Array.from(tickers);
  }

  /**
   * Extract ticker symbols from query text
   */
  private extractTickersFromText(text: string): string[] {
    const commonTickers = [
      'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 
      'JPM', 'BAC', 'WFC', 'WMT', 'Apple', 'Microsoft', 'Google', 
      'Amazon', 'Tesla', 'Meta', 'Nvidia', 'JPMorgan', 'Bank of America'
    ];

    const found: string[] = [];
    const upperText = text.toUpperCase();

    for (const ticker of commonTickers) {
      if (upperText.includes(ticker.toUpperCase())) {
        // Convert company names to ticker symbols
        const tickerMap: Record<string, string> = {
          'APPLE': 'AAPL',
          'MICROSOFT': 'MSFT',
          'GOOGLE': 'GOOGL',
          'AMAZON': 'AMZN',
          'TESLA': 'TSLA',
          'META': 'META',
          'NVIDIA': 'NVDA',
          'JPMORGAN': 'JPM',
          'BANK OF AMERICA': 'BAC'
        };
        
        const mappedTicker = tickerMap[ticker.toUpperCase()] || ticker;
        if (mappedTicker.length <= 5 && !found.includes(mappedTicker)) {
          found.push(mappedTicker);
        }
      }
    }

    return found;
  }

  /**
   * Get contextual metrics from RDS based on semantic query
   * This provides structured data to enrich semantic responses
   */
  private async getContextualMetrics(query: SemanticQuery, tickers: string[]): Promise<any[]> {
    if (tickers.length === 0) {
      return [];
    }

    try {
      // Determine what metrics to fetch based on query content
      const queryLower = query.query.toLowerCase();
      const metrics: string[] = [];

      // Map query terms to relevant metrics
      // CRITICAL FIX: Be more precise - don't add multiple metrics for a single query term
      if ((queryLower.includes('revenue') || queryLower.includes('sales') || queryLower.includes('top line')) 
          && !queryLower.includes('net income') && !queryLower.includes('income statement')) {
        metrics.push('revenue', 'total_revenue');
      }
      
      if (queryLower.includes('net income') || queryLower.includes('profit') || queryLower.includes('earnings') || queryLower.includes('bottom line')) {
        metrics.push('net_income');
      }
      
      if (queryLower.includes('gross profit') || queryLower.includes('gross margin')) {
        metrics.push('gross_profit');
      }
      
      if (queryLower.includes('operating income') || queryLower.includes('operating profit') || queryLower.includes('ebit')) {
        metrics.push('operating_income');
      }
      
      if (queryLower.includes('cash') || queryLower.includes('flow')) {
        metrics.push('operating_cash_flow', 'free_cash_flow', 'cash_and_equivalents');
      }
      
      if (queryLower.includes('debt') || queryLower.includes('liability')) {
        metrics.push('total_debt', 'total_liabilities', 'long_term_debt');
      }
      
      if (queryLower.includes('asset') || queryLower.includes('balance')) {
        metrics.push('total_assets', 'current_assets', 'total_equity');
      }

      if (queryLower.includes('margin') || queryLower.includes('profitability')) {
        metrics.push('gross_margin', 'operating_margin', 'net_margin');
      }

      // If no specific metrics identified, get key financial metrics
      if (metrics.length === 0) {
        metrics.push('revenue', 'net_income', 'total_assets', 'operating_cash_flow');
      }

      // Build structured query for contextual metrics
      // Create lightweight MetricResolution objects for each metric name
      const metricResolutions: MetricResolution[] = metrics.map(m => ({
        canonical_id: m,
        display_name: m.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        type: 'atomic' as const,
        confidence: 'exact' as const,
        fuzzy_score: null,
        original_query: m,
        match_source: 'semantic_retriever_contextual',
        suggestions: null,
        db_column: m,
      }));

      const structuredQuery = {
        tickers,
        metrics: metricResolutions,
        periods: ['FY2024', 'FY2023'], // Recent periods for context
        filingTypes: ['10-K', '10-Q'] as DocumentType[], // Include both annual and quarterly
        includeComputed: false,
        limit: 20 // Limit to avoid overwhelming the response
      };

      const result = await this.structuredRetriever.retrieve(structuredQuery);
      
      this.logger.log(
        `Retrieved ${result.metrics.length} contextual metrics for tickers: ${tickers.join(', ')}`
      );

      return result.metrics;
    } catch (error) {
      this.logger.warn(`Failed to retrieve contextual metrics: ${error.message}`);
      return [];
    }
  }

  /**
   * Test method - retrieve narratives for a ticker
   */
  async getNarrativesForTicker(
    ticker: string,
    sectionType?: string,
    limit = 10,
  ): Promise<any[]> {
    const where: any = { ticker };

    if (sectionType) {
      where.sectionType = sectionType;
    }

    return this.prisma.narrativeChunk.findMany({
      where,
      take: limit,
      orderBy: {
        chunkIndex: 'asc',
      },
    });
  }
}
