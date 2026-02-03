import { Injectable, Logger } from '@nestjs/common';
import { QueryRouterService } from './query-router.service';
import { StructuredRetrieverService } from './structured-retriever.service';
import { SemanticRetrieverService } from './semantic-retriever.service';
import { BedrockService } from './bedrock.service';
import { DocumentRAGService } from './document-rag.service';
import { ComputedMetricsService } from '../dataSources/sec/computed-metrics.service';
import { QueryIntent, RAGResponse } from './types/query-intent';

/**
 * RAG Service
 * Orchestrates the entire RAG pipeline:
 * 1. Route query
 * 2. Retrieve data (structured and/or semantic)
 * 3. Merge user documents with SEC filings
 * 4. Build response
 */
@Injectable()
export class RAGService {
  private readonly logger = new Logger(RAGService.name);

  constructor(
    private readonly queryRouter: QueryRouterService,
    private readonly structuredRetriever: StructuredRetrieverService,
    private readonly semanticRetriever: SemanticRetrieverService,
    private readonly bedrock: BedrockService,
    private readonly documentRAG: DocumentRAGService,
    private readonly computedMetrics: ComputedMetricsService,
  ) {}

  /**
   * Main query method - full RAG pipeline with hybrid retrieval
   */
  async query(
    query: string,
    options?: {
      includeNarrative?: boolean;
      includeCitations?: boolean;
      systemPrompt?: string; // Custom system prompt from user
      tenantId?: string; // For user document search
      ticker?: string; // For scoped user document search
    },
  ): Promise<RAGResponse> {
    const startTime = Date.now();
    this.logger.log(`🔍 Processing hybrid query: "${query}"`);

    try {
      // Step 1: Route query
      const plan = await this.queryRouter.route(query);
      const intent = await this.queryRouter.getIntent(query);

      // Step 2: HYBRID RETRIEVAL - Combine structured + semantic + user documents
      let metrics: any[] = [];
      let narratives: any[] = [];
      let userDocChunks: any[] = [];

      // STRUCTURED PATH: Deterministic metrics from PostgreSQL
      if (plan.useStructured && plan.structuredQuery) {
        this.logger.log(`📊 Retrieving structured metrics from PostgreSQL`);
        const result = await this.structuredRetriever.retrieve(
          plan.structuredQuery,
        );
        metrics = result.metrics;

        // Get computed metrics if needed
        if (plan.structuredQuery.includeComputed && metrics.length > 0) {
          const computed = await this.getComputedMetrics(
            plan.structuredQuery.tickers,
            intent,
          );
          metrics = [...metrics, ...computed];
        }

        this.logger.log(`📊 Retrieved ${metrics.length} structured metrics`);
      }

      // SEMANTIC PATH: Foundation model narratives from Bedrock KB + RDS context
      if (plan.useSemantic && plan.semanticQuery) {
        this.logger.log(`🧠 Retrieving semantic narratives with RDS context`);
        const result = await this.semanticRetriever.retrieveWithContext(
          plan.semanticQuery,
        );
        narratives = result.narratives;
        
        // Add contextual metrics from RDS to enrich the response
        if (result.contextualMetrics.length > 0) {
          this.logger.log(`📊 Adding ${result.contextualMetrics.length} contextual metrics from RDS`);
          metrics = [...metrics, ...result.contextualMetrics];
        }
        
        this.logger.log(
          `🧠 Retrieved ${narratives.length} semantic narratives (avg score: ${result.summary.avgScore.toFixed(2)})`,
        );
      }

      // USER DOCUMENTS PATH: Search user-uploaded documents if tenant provided
      if (options?.tenantId && options?.includeCitations) {
        this.logger.log(`📄 Searching user documents for tenant ${options.tenantId}`);
        const userDocResult = await this.documentRAG.searchUserDocuments(query, {
          tenantId: options.tenantId,
          ticker: options.ticker || null,
          topK: 5,
          minScore: 0.7,
        });
        
        userDocChunks = userDocResult.chunks;
        
        if (userDocChunks.length > 0) {
          this.logger.log(
            `📄 Found ${userDocChunks.length} relevant user document chunks (avg score: ${userDocResult.avgScore.toFixed(2)})`,
          );
          
          // Merge user documents with SEC narratives
          const mergedNarratives = this.documentRAG.mergeAndRerankResults(
            userDocChunks,
            narratives,
            10, // Top 10 combined results
          );
          
          narratives = mergedNarratives;
          this.logger.log(`🔀 Merged results: ${narratives.length} total narratives`);
        }
      }

      // Step 3: HYBRID RESPONSE GENERATION
      let answer: string;
      let usage: any = undefined;
      let citations: any[] = [];

      // Use Claude Opus 4.5 for generation if we have Bedrock KB configured
      if (process.env.BEDROCK_KB_ID && (metrics.length > 0 || narratives.length > 0)) {
        this.logger.log(`🤖 Generating response with Claude Opus 4.5`);
        try {
          const generated = await this.bedrock.generate(query, {
            metrics,
            narratives,
            systemPrompt: options?.systemPrompt, // Pass custom system prompt
          });
          answer = generated.answer;
          usage = generated.usage;
          
          // Extract citations from user document chunks
          if (userDocChunks.length > 0 && options?.includeCitations) {
            citations = this.documentRAG.extractCitationsFromChunks(userDocChunks);
            this.logger.log(`📎 Extracted ${citations.length} citations from user documents`);
          }
          
          this.logger.log(
            `🤖 Generated answer with Claude Opus 4.5 (${usage.inputTokens} input, ${usage.outputTokens} output tokens)`,
          );
        } catch (error) {
          this.logger.warn(`Claude generation failed, falling back to structured answer: ${error.message}`);
          answer = this.buildAnswer(query, intent, metrics, narratives);
        }
      } else {
        // Fallback to structured answer
        this.logger.log(`📝 Building structured answer (no Bedrock KB or no data)`);
        answer = this.buildAnswer(query, intent, metrics, narratives);
      }

      const latency = Date.now() - startTime;

      const response: RAGResponse = {
        answer,
        intent,
        metrics: metrics.length > 0 ? metrics : undefined,
        narratives: narratives.length > 0 ? narratives : undefined,
        sources: this.extractSources(metrics, narratives),
        citations: citations.length > 0 ? citations : undefined,
        timestamp: new Date(),
        latency,
        cost: this.estimateCost(metrics, narratives, usage),
        usage,
        // Add hybrid processing info
        processingInfo: {
          structuredMetrics: metrics.length,
          semanticNarratives: narratives.length,
          userDocumentChunks: userDocChunks.length,
          usedBedrockKB: !!process.env.BEDROCK_KB_ID,
          usedClaudeGeneration: !!usage,
          hybridProcessing: true,
        },
      };

      this.logger.log(
        `✅ Hybrid query complete: ${metrics.length} metrics + ${narratives.length} narratives + ${userDocChunks.length} user docs (${latency}ms)`,
      );

      return response;
    } catch (error) {
      this.logger.error(`❌ Error processing hybrid query: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get computed metrics based on intent
   */
  private async getComputedMetrics(
    tickers: string[],
    intent: QueryIntent,
  ): Promise<any[]> {
    const computed: any[] = [];

    for (const ticker of tickers) {
      // Check if computed metrics are requested
      if (intent.metrics?.includes('gross_margin')) {
        try {
          const margins = await this.computedMetrics.calculateGrossMargin(
            ticker,
            intent.period,
          );
          computed.push(...margins.map(this.formatComputedMetric));
        } catch (error) {
          this.logger.warn(`Could not calculate gross margin for ${ticker}`);
        }
      }

      if (intent.metrics?.includes('net_margin')) {
        try {
          const margins = await this.computedMetrics.calculateNetMargin(
            ticker,
            intent.period,
          );
          computed.push(...margins.map(this.formatComputedMetric));
        } catch (error) {
          this.logger.warn(`Could not calculate net margin for ${ticker}`);
        }
      }

      if (intent.metrics?.includes('ebitda')) {
        try {
          const ebitda = await this.computedMetrics.calculateEBITDA(
            ticker,
            intent.period,
          );
          computed.push(...ebitda.map(this.formatComputedMetric));
        } catch (error) {
          this.logger.warn(`Could not calculate EBITDA for ${ticker}`);
        }
      }

      if (intent.metrics?.includes('fcf')) {
        try {
          const fcf = await this.computedMetrics.calculateFCF(
            ticker,
            intent.period,
          );
          computed.push(...fcf.map(this.formatComputedMetric));
        } catch (error) {
          this.logger.warn(`Could not calculate FCF for ${ticker}`);
        }
      }
    }

    return computed;
  }

  /**
   * Format computed metric to match MetricResult interface
   */
  private formatComputedMetric(computed: any): any {
    return {
      ticker: computed.ticker,
      normalizedMetric: computed.metric,
      rawLabel: computed.metric,
      value: parseFloat(computed.value),
      fiscalPeriod: computed.fiscalPeriod,
      periodType: computed.periodType,
      filingType: computed.filingType,
      statementType: 'computed',
      statementDate: computed.filingDate,
      filingDate: computed.filingDate,
      sourcePage: null,
      confidenceScore: 1.0,
      formula: computed.formula,
      components: computed.components,
    };
  }

  /**
   * Build answer from retrieved data
   * For now, returns structured data
   * In Week 4, will use LLM to generate natural language
   */
  private buildAnswer(
    query: string,
    intent: QueryIntent,
    metrics: any[],
    narratives: any[],
  ): string {
    if (intent.type === 'structured' && metrics.length > 0) {
      return this.buildStructuredAnswer(query, metrics);
    }

    if (intent.type === 'semantic' && narratives.length > 0) {
      return this.buildSemanticAnswer(query, narratives);
    }

    if (intent.type === 'hybrid') {
      return this.buildHybridAnswer(query, metrics, narratives);
    }

    return 'No data found for your query.';
  }

  /**
   * Build structured answer (metrics only)
   */
  private buildStructuredAnswer(query: string, metrics: any[]): string {
    const lines: string[] = [];

    // Group by ticker
    const byTicker = this.groupByTicker(metrics);

    for (const [ticker, tickerMetrics] of Object.entries(byTicker)) {
      lines.push(`\n${ticker}:`);

      for (const metric of tickerMetrics) {
        const value = this.formatValue(metric.value, metric.normalizedMetric);
        lines.push(
          `  ${metric.normalizedMetric}: ${value} (${metric.fiscalPeriod}, ${metric.filingType})`,
        );

        if (metric.formula) {
          lines.push(`    Formula: ${metric.formula}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Build semantic answer (narratives only)
   */
  private buildSemanticAnswer(query: string, narratives: any[]): string {
    if (narratives.length === 0) {
      return 'No relevant narrative content found for your query.';
    }

    const lines: string[] = [];
    lines.push(`Found ${narratives.length} relevant sections:\n`);

    // Group narratives by ticker and section
    const grouped = this.groupNarrativesByTickerAndSection(narratives);

    for (const [ticker, sections] of Object.entries(grouped)) {
      lines.push(`**${ticker}**:`);

      for (const [sectionType, chunks] of Object.entries(sections)) {
        const sectionName = this.formatSectionName(sectionType);
        lines.push(`\n  ${sectionName}:`);

        for (const chunk of chunks) {
          // Add relevance score and excerpt
          const score = (chunk.score * 100).toFixed(0);
          const excerpt = this.extractExcerpt(chunk.content, query, 200);
          
          lines.push(`    • (${score}% relevant) ${excerpt}`);
          
          // Add source info
          const source = `${chunk.metadata.filingType} ${chunk.metadata.fiscalPeriod}`;
          lines.push(`      Source: ${source}`);
        }
      }
      lines.push(''); // Empty line between tickers
    }

    return lines.join('\n');
  }

  /**
   * Build hybrid answer (metrics + narratives)
   */
  private buildHybridAnswer(
    query: string,
    metrics: any[],
    narratives: any[],
  ): string {
    let answer = '';

    if (metrics.length > 0) {
      answer += 'Metrics:\n';
      answer += this.buildStructuredAnswer(query, metrics);
    }

    if (narratives.length > 0) {
      answer += '\n\nContext:\n';
      answer += this.buildSemanticAnswer(query, narratives);
    }

    return answer;
  }

  /**
   * Group metrics by ticker
   */
  private groupByTicker(metrics: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};

    for (const metric of metrics) {
      if (!grouped[metric.ticker]) {
        grouped[metric.ticker] = [];
      }
      grouped[metric.ticker].push(metric);
    }

    return grouped;
  }

  /**
   * Group narratives by ticker and section type
   */
  private groupNarrativesByTickerAndSection(narratives: any[]): Record<string, Record<string, any[]>> {
    const grouped: Record<string, Record<string, any[]>> = {};

    for (const narrative of narratives) {
      const ticker = narrative.metadata.ticker;
      const sectionType = narrative.metadata.sectionType;

      if (!grouped[ticker]) {
        grouped[ticker] = {};
      }
      if (!grouped[ticker][sectionType]) {
        grouped[ticker][sectionType] = [];
      }
      grouped[ticker][sectionType].push(narrative);
    }

    return grouped;
  }

  /**
   * Format section type for display
   */
  private formatSectionName(sectionType: string): string {
    const sectionNames: Record<string, string> = {
      'risk_factors': 'Risk Factors',
      'business': 'Business Overview',
      'mda': 'Management Discussion & Analysis',
      'properties': 'Properties',
      'legal_proceedings': 'Legal Proceedings',
      'directors_officers': 'Directors & Officers',
      'controls_procedures': 'Controls & Procedures',
      'executive_compensation': 'Executive Compensation',
      'general': 'General Information'
    };

    return sectionNames[sectionType] || sectionType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  /**
   * Extract relevant excerpt from content
   */
  private extractExcerpt(content: string, query: string, maxLength: number = 200): string {
    const queryLower = query.toLowerCase();
    const contentLower = content.toLowerCase();

    // Try to find the query in the content
    const queryIndex = contentLower.indexOf(queryLower);
    
    if (queryIndex !== -1) {
      // Extract around the query match
      const start = Math.max(0, queryIndex - 50);
      const end = Math.min(content.length, queryIndex + query.length + maxLength - 50);
      let excerpt = content.substring(start, end);
      
      if (start > 0) excerpt = '...' + excerpt;
      if (end < content.length) excerpt = excerpt + '...';
      
      return excerpt.trim();
    }

    // Fallback: extract keywords and find best match
    const keywords = query.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    let bestIndex = 0;
    let bestScore = 0;

    for (let i = 0; i < content.length - maxLength; i += 50) {
      const segment = content.substring(i, i + maxLength).toLowerCase();
      const score = keywords.reduce((acc, keyword) => {
        return acc + (segment.includes(keyword) ? 1 : 0);
      }, 0);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    let excerpt = content.substring(bestIndex, bestIndex + maxLength);
    if (bestIndex > 0) excerpt = '...' + excerpt;
    if (bestIndex + maxLength < content.length) excerpt = excerpt + '...';

    return excerpt.trim();
  }

  /**
   * Format value based on metric type
   */
  private formatValue(value: number, metric: string): string {
    // Percentages
    if (metric.includes('margin') || metric.includes('pct')) {
      return `${value.toFixed(2)}%`;
    }

    // Large numbers (billions)
    if (Math.abs(value) >= 1_000_000_000) {
      return `$${(value / 1_000_000_000).toFixed(2)}B`;
    }

    // Millions
    if (Math.abs(value) >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(2)}M`;
    }

    // Thousands
    if (Math.abs(value) >= 1_000) {
      return `$${(value / 1_000).toFixed(2)}K`;
    }

    return `$${value.toFixed(2)}`;
  }

  /**
   * Extract sources from metrics and narratives
   */
  private extractSources(metrics: any[], narratives: any[]): any[] {
    const sources: any[] = [];

    for (const metric of metrics) {
      sources.push({
        type: 'metric',
        ticker: metric.ticker,
        filingType: metric.filingType,
        fiscalPeriod: metric.fiscalPeriod,
        pageNumber: metric.sourcePage,
      });
    }

    for (const narrative of narratives) {
      sources.push({
        type: 'narrative',
        ticker: narrative.metadata.ticker,
        filingType: narrative.metadata.filingType,
        fiscalPeriod: narrative.metadata.fiscalPeriod,
        pageNumber: narrative.metadata.pageNumber,
        section: narrative.metadata.sectionType,
      });
    }

    return sources;
  }

  /**
   * Estimate cost of query
   */
  private estimateCost(
    metrics: any[],
    narratives: any[],
    usage?: any,
  ): number {
    // PostgreSQL queries: free
    let cost = 0;

    // Bedrock KB retrieval: $0.0004 per chunk
    cost += narratives.length * 0.0004;

    // Claude Opus 4.5 pricing (per 1M tokens):
    // Input: $15, Output: $75
    if (usage) {
      cost += (usage.inputTokens / 1_000_000) * 15;
      cost += (usage.outputTokens / 1_000_000) * 75;
    }

    return cost;
  }

  /**
   * Test methods for development
   */
  async testStructuredRetrieval(query: any) {
    return this.structuredRetriever.retrieve(query);
  }

  async testComparison(tickers: string[], metrics: string[], period?: string) {
    return this.structuredRetriever.compareMetrics(tickers, metrics, period);
  }

  async testTimeSeries(ticker: string, metric: string, filingType?: string) {
    return this.structuredRetriever.getTimeSeries(ticker, metric, filingType);
  }
}
