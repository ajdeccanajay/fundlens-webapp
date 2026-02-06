import { Injectable, Logger } from '@nestjs/common';
import { QueryRouterService } from './query-router.service';
import { StructuredRetrieverService } from './structured-retriever.service';
import { SemanticRetrieverService } from './semantic-retriever.service';
import { BedrockService } from './bedrock.service';
import { DocumentRAGService } from './document-rag.service';
import { ComputedMetricsService } from '../dataSources/sec/computed-metrics.service';
import { PerformanceMonitorService } from './performance-monitor.service';
import { PerformanceOptimizerService } from './performance-optimizer.service';
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
    private readonly performanceMonitor: PerformanceMonitorService,
    private readonly performanceOptimizer: PerformanceOptimizerService,
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
      tickers?: string[]; // Multi-ticker array for peer comparison
    },
  ): Promise<RAGResponse> {
    const startTime = Date.now();
    this.logger.log(`🔍 Processing hybrid query: "${query}"`);

    try {
      // Step 1: Route query
      const plan = await this.queryRouter.route(query, options?.tenantId, options?.ticker);
      const intent = await this.queryRouter.getIntent(query, options?.tenantId, options?.ticker);
      
      // DEBUG: Log intent to trace wrong data bug
      this.logger.log(`🔍 DEBUG Intent Detection:`);
      this.logger.log(`   Query: "${query}"`);
      this.logger.log(`   Intent Type: ${intent.type}`);
      this.logger.log(`   Ticker: ${JSON.stringify(intent.ticker)}`);
      this.logger.log(`   Metrics: ${JSON.stringify(intent.metrics)}`);
      this.logger.log(`   Period: ${intent.period}`);
      
      // Override intent ticker with explicit tickers array for peer comparison
      if (options?.tickers && options.tickers.length > 0) {
        this.logger.log(`🔄 Overriding intent ticker with peer comparison tickers: ${options.tickers.join(', ')}`);
        intent.ticker = options.tickers;
        
        // CRITICAL: Also patch the retrieval plan — it was built before this override
        if (plan.structuredQuery) {
          plan.structuredQuery.tickers = options.tickers;
        }
        if (plan.semanticQuery) {
          plan.semanticQuery.tickers = options.tickers;
        }
      }
      
      // Step 1.5: Check if clarification needed (Phase 3)
      if (intent.needsClarification) {
        this.logger.log(`⚠️ Query needs clarification, generating clarification prompt`);
        return this.generateClarificationPrompt(intent);
      }
      
      // Step 1.5: Make optimization decisions
      const optimizationDecisions = this.performanceOptimizer.makeOptimizationDecisions(
        query,
        intent,
        options?.tenantId
      );
      
      this.logger.log(`🎯 Optimization decisions: ${optimizationDecisions.reasoning.join(', ')}`);
      
      // Step 1.6: Check cache - DISABLED FOR TESTING
      // Cache disabled to allow immediate visibility of formatting changes
      // Will re-enable after formatting improvements are verified
      /*
      if (optimizationDecisions.useCache && optimizationDecisions.cacheKey) {
        const cached = this.performanceOptimizer.getCachedQuery<RAGResponse>(
          optimizationDecisions.cacheKey
        );
        
        if (cached) {
          const cacheLatency = Date.now() - startTime;
          this.logger.log(`✅ Cache hit! Returning cached response (${cacheLatency}ms)`);
          
          // Update latency and timestamp for cached response
          return {
            ...cached,
            latency: cacheLatency,
            timestamp: new Date(),
            processingInfo: cached.processingInfo ? {
              ...cached.processingInfo,
              fromCache: true,
            } : undefined,
          };
        }
      }
      */

      // Step 2: HYBRID RETRIEVAL - Combine structured + semantic + user documents
      let metrics: any[] = [];
      let narratives: any[] = [];
      let userDocChunks: any[] = [];

      // Use parallel execution for hybrid queries
      if (optimizationDecisions.parallelExecution && plan.useStructured && plan.useSemantic) {
        this.logger.log(`⚡ Executing parallel hybrid retrieval`);
        
        const retrievalTasks: Promise<any>[] = [];
        
        // Add structured retrieval task
        if (plan.structuredQuery) {
          retrievalTasks.push(
            this.structuredRetriever.retrieve(plan.structuredQuery)
          );
        }
        
        // Add semantic retrieval task
        if (plan.semanticQuery) {
          retrievalTasks.push(
            this.semanticRetriever.retrieveWithContext(plan.semanticQuery)
          );
        }
        
        // Execute in parallel
        const results = await this.performanceOptimizer.executeParallel(retrievalTasks);
        
        // Process structured results
        if (plan.structuredQuery && results[0]) {
          metrics = results[0].metrics || [];
          
          // Get computed metrics if needed
          if (plan.structuredQuery.includeComputed && metrics.length > 0) {
            const computed = await this.getComputedMetrics(
              plan.structuredQuery.tickers,
              intent,
            );
            metrics = [...metrics, ...computed];
          }
          
          this.logger.log(`📊 Retrieved ${metrics.length} structured metrics (parallel)`);
        }
        
        // Process semantic results
        if (plan.semanticQuery && results[1]) {
          narratives = results[1].narratives || [];
          
          // Add contextual metrics from RDS
          if (results[1].contextualMetrics?.length > 0) {
            this.logger.log(`📊 Adding ${results[1].contextualMetrics.length} contextual metrics from RDS`);
            metrics = [...metrics, ...results[1].contextualMetrics];
          }
          
          this.logger.log(
            `🧠 Retrieved ${narratives.length} semantic narratives (parallel, avg score: ${results[1].summary?.avgScore?.toFixed(2) || 'N/A'})`,
          );
        }
      } else {
        // Sequential execution (original logic)
        
        // STRUCTURED PATH: Deterministic metrics from PostgreSQL
        if (plan.useStructured && plan.structuredQuery) {
          this.logger.log(`📊 Retrieving structured metrics from PostgreSQL`);
          this.logger.log(`🔍 DEBUG Structured Query:`);
          this.logger.log(`   Tickers: ${JSON.stringify(plan.structuredQuery.tickers)}`);
          this.logger.log(`   Metrics: ${JSON.stringify(plan.structuredQuery.metrics)}`);
          this.logger.log(`   Period: ${plan.structuredQuery.period}`);
          
          const result = await this.structuredRetriever.retrieve(
            plan.structuredQuery,
          );
          metrics = result.metrics;
          
          // DEBUG: Log first metric to verify correctness
          if (metrics.length > 0) {
            this.logger.log(`🔍 DEBUG First Metric Retrieved:`);
            this.logger.log(`   Ticker: ${metrics[0].ticker}`);
            this.logger.log(`   Metric: ${metrics[0].normalizedMetric}`);
            this.logger.log(`   Value: ${metrics[0].value}`);
            this.logger.log(`   Period: ${metrics[0].fiscalPeriod}`);
          }

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
      
      // Enforce token budget on narratives
      if (narratives.length > 0) {
        const budgetedNarratives = this.performanceOptimizer.enforceTokenBudget(
          narratives,
          optimizationDecisions.maxTokens
        );
        
        if (budgetedNarratives.length < narratives.length) {
          this.logger.log(
            `📉 Token budget enforced: ${budgetedNarratives.length}/${narratives.length} narratives selected`
          );
        }
        
        narratives = budgetedNarratives;
      }
      
      // Decide if LLM should be used
      const shouldUseLLM = this.performanceOptimizer.shouldUseLLM(intent, metrics, narratives);
      
      // DEBUG: Log all conditions for Claude generation
      this.logger.log(`🔍 DEBUG Claude Generation Conditions:`);
      this.logger.log(`   shouldUseLLM: ${shouldUseLLM}`);
      this.logger.log(`   BEDROCK_KB_ID: ${process.env.BEDROCK_KB_ID ? 'SET' : 'NOT SET'}`);
      this.logger.log(`   metrics.length: ${metrics.length}`);
      this.logger.log(`   narratives.length: ${narratives.length}`);
      this.logger.log(`   Will use Claude: ${shouldUseLLM && process.env.BEDROCK_KB_ID && (metrics.length > 0 || narratives.length > 0)}`);

      // Use Claude for generation if appropriate
      if (shouldUseLLM && process.env.BEDROCK_KB_ID && (metrics.length > 0 || narratives.length > 0)) {
        // Select model tier based on complexity
        const modelId = this.performanceOptimizer.getModelId(optimizationDecisions.modelTier);
        
        this.logger.log(`🤖 Generating response with ${optimizationDecisions.modelTier} (${modelId})`);
        try {
          const isPeerComparison = Array.isArray(intent.ticker) && intent.ticker.length > 1;
          const generated = await this.bedrock.generate(query, {
            metrics,
            narratives,
            systemPrompt: options?.systemPrompt, // Pass custom system prompt
            modelId, // Use selected model tier
            isPeerComparison,
          });
          answer = generated.answer;
          usage = generated.usage;
          citations = generated.citations || []; // NEW: Get citations from bedrock
          
          // Also extract citations from user document chunks if present
          if (userDocChunks.length > 0 && options?.includeCitations) {
            const userDocCitations = this.documentRAG.extractCitationsFromChunks(userDocChunks);
            citations = [...citations, ...userDocCitations];
            this.logger.log(`📎 Extracted ${userDocCitations.length} citations from user documents`);
          }
          
          this.logger.log(
            `🤖 Generated answer with ${optimizationDecisions.modelTier} (${usage.inputTokens} input, ${usage.outputTokens} output tokens, ${citations.length} citations)`,
          );
        } catch (error) {
          this.logger.warn(`Claude generation failed, falling back to structured answer: ${error.message}`);
          answer = this.buildAnswer(query, intent, metrics, narratives);
        }
      } else {
        // Fallback to structured answer (LLM not needed or no data)
        const reason = !shouldUseLLM 
          ? 'LLM not needed for simple lookup'
          : 'no Bedrock KB or no data';
        this.logger.log(`📝 Building structured answer (${reason})`);
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
          fromCache: false,
          modelTier: optimizationDecisions.modelTier,
          parallelExecution: optimizationDecisions.parallelExecution,
          optimizationDecisions: optimizationDecisions.reasoning,
        },
      };

      this.logger.log(
        `✅ Hybrid query complete: ${metrics.length} metrics + ${narratives.length} narratives + ${userDocChunks.length} user docs (${latency}ms)`,
      );

      // Record performance metrics
      this.performanceMonitor.recordQuery({
        query,
        latency,
        timestamp: new Date(),
        queryType: intent.type,
        ticker: Array.isArray(intent.ticker) ? intent.ticker[0] : intent.ticker,
        metricsCount: metrics.length,
        narrativesCount: narratives.length,
      });
      
      // Cache the response - DISABLED FOR TESTING
      // Cache disabled to allow immediate visibility of formatting changes
      /*
      if (optimizationDecisions.useCache && optimizationDecisions.cacheKey) {
        const ttl = this.performanceOptimizer.getCacheTTL(intent);
        this.performanceOptimizer.cacheQuery(
          optimizationDecisions.cacheKey,
          response,
          ttl
        );
        this.logger.log(`💾 Response cached with TTL ${ttl}s`);
      }
      */

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
      lines.push(`### ${ticker}\n`);

      // Group metrics by type for better organization
      const metricsByType: Record<string, any[]> = {};
      for (const metric of tickerMetrics) {
        const metricName = metric.normalizedMetric;
        if (!metricsByType[metricName]) {
          metricsByType[metricName] = [];
        }
        metricsByType[metricName].push(metric);
      }

      // Display each metric type as a table if multiple periods
      for (const [metricName, metricValues] of Object.entries(metricsByType)) {
        // Convert internal metric name to user-friendly display name
        const displayName = this.getMetricDisplayName(metricName);
        lines.push(`\n**${displayName}**\n`);
        
        if (metricValues.length > 1) {
          // Sort by period (most recent first)
          metricValues.sort((a, b) => {
            return b.fiscalPeriod.localeCompare(a.fiscalPeriod);
          });
          
          // Smart consolidation: Show top 5 periods for long histories
          const displayValues = metricValues.length > 5 ? metricValues.slice(0, 5) : metricValues;
          const hiddenCount = metricValues.length - displayValues.length;
          
          // Create table
          lines.push('| Period | Value | YoY Growth | Filing |');
          lines.push('|--------|-------|------------|--------|');
          
          for (let i = 0; i < displayValues.length; i++) {
            const metric = displayValues[i];
            const value = this.formatValue(metric.value, metric.normalizedMetric);
            
            // Calculate YoY growth if we have previous period
            let yoyGrowth = '-';
            if (i < displayValues.length - 1) {
              const prevValue = displayValues[i + 1].value;
              if (prevValue !== 0) {
                const growth = ((metric.value - prevValue) / Math.abs(prevValue)) * 100;
                const sign = growth > 0 ? '+' : '';
                yoyGrowth = `${sign}${growth.toFixed(1)}%`;
              }
            }
            
            lines.push(`| ${metric.fiscalPeriod} | ${value} | ${yoyGrowth} | ${metric.filingType} |`);
          }
          
          lines.push('');
          
          // Add note if data was consolidated
          if (hiddenCount > 0) {
            lines.push(`_Showing most recent 5 of ${metricValues.length} periods. ${hiddenCount} earlier periods available._\n`);
          }
          
          // Add formula if present
          if (metricValues[0].formula) {
            lines.push(`_Calculated as: ${metricValues[0].formula}_\n`);
          }
        } else {
          // Single value - just show it
          const metric = metricValues[0];
          const value = this.formatValue(metric.value, metric.normalizedMetric);
          lines.push(`${value} (${metric.fiscalPeriod}, ${metric.filingType})`);
          
          if (metric.formula) {
            lines.push(`_Calculated as: ${metric.formula}_`);
          }
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Build semantic answer (narratives only)
   * Provides comprehensive, analyst-grade content with full context
   */
  private buildSemanticAnswer(query: string, narratives: any[]): string {
    if (narratives.length === 0) {
      return 'No relevant narrative content found for your query.';
    }

    const lines: string[] = [];

    // Group narratives by ticker and section
    const grouped = this.groupNarrativesByTickerAndSection(narratives);

    for (const [ticker, sections] of Object.entries(grouped)) {
      lines.push(`### ${ticker}\n`);

      for (const [sectionType, chunks] of Object.entries(sections)) {
        const sectionName = this.formatSectionName(sectionType);
        lines.push(`**${sectionName}**\n`);

        // Take top 8 chunks per section for comprehensive, meaty content
        const topChunks = chunks.slice(0, 8);
        
        // Combine chunks into comprehensive paragraphs
        const paragraphs: string[] = [];
        
        for (let i = 0; i < topChunks.length; i++) {
          const chunk = topChunks[i];
          
          // Clean the content - remove markers and format properly
          let content = chunk.content;
          
          // Remove technical markers
          content = content.replace(/\[CONTEXT BEFORE\]/g, '');
          content = content.replace(/\[MAIN CONTENT\]/g, '');
          content = content.replace(/\[CONTEXT AFTER\]/g, '');
          
          // Extract a VERY long excerpt for comprehensive analysis (2000 chars for meaty content)
          const excerpt = this.extractCleanExcerpt(content, query, 2000);
          
          if (excerpt && excerpt.length > 50) {
            paragraphs.push(excerpt);
          }
        }
        
        // Combine all paragraphs with proper spacing
        if (paragraphs.length > 0) {
          lines.push(paragraphs.join('\n\n'));
          lines.push('');
          
          // Add comprehensive source list at the end
          lines.push('**Sources:**');
          for (let i = 0; i < Math.min(topChunks.length, paragraphs.length); i++) {
            const chunk = topChunks[i];
            const score = (chunk.score * 100).toFixed(0);
            // Handle undefined fiscalPeriod gracefully
            const fiscalPeriod = chunk.metadata.fiscalPeriod || 'Period Unknown';
            const source = `${chunk.metadata.filingType} ${fiscalPeriod}`;
            const pageInfo = chunk.metadata.pageNumber ? `, Page ${chunk.metadata.pageNumber}` : '';
            lines.push(`- ${ticker} ${source}${pageInfo} (${score}% relevance)`);
          }
          lines.push('');
        }
      }
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
    const sections: string[] = [];

    // Add metrics section with clear formatting
    if (metrics.length > 0) {
      sections.push('## 📊 Financial Metrics\n');
      sections.push(this.buildStructuredAnswer(query, metrics));
      sections.push('\n'); // Extra spacing
    }

    // Add narratives section with clear formatting
    if (narratives.length > 0) {
      sections.push('## 📄 Context & Analysis\n');
      sections.push(this.buildSemanticAnswer(query, narratives));
    }

    return sections.join('\n');
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
   * Extract clean, readable excerpt for analyst consumption
   * Ensures complete sentences with proper boundaries
   */
  private extractCleanExcerpt(content: string, query: string, maxLength: number = 1200): string {
    // Clean up the content first
    let cleaned = content
      .replace(/\[CONTEXT BEFORE\]/g, '')
      .replace(/\[MAIN CONTENT\]/g, '')
      .replace(/\[CONTEXT AFTER\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Try to find complete sentences around the query
    const queryLower = query.toLowerCase();
    const cleanedLower = cleaned.toLowerCase();
    const queryIndex = cleanedLower.indexOf(queryLower);

    if (queryIndex !== -1) {
      // Find sentence boundaries around the match - much wider range for comprehensive content
      let start = Math.max(0, queryIndex - 300);
      let end = Math.min(cleaned.length, queryIndex + query.length + maxLength - 300);

      // Adjust to sentence boundaries - find the START of the next sentence
      const sentenceStart = cleaned.lastIndexOf('. ', start);
      if (sentenceStart !== -1 && sentenceStart > start - 200) {
        // Move past the period and any whitespace to find the actual start of the sentence
        start = sentenceStart + 1;
        while (start < cleaned.length && /\s/.test(cleaned[start])) {
          start++;
        }
      } else {
        // If no period found, try to start at beginning of content or a capital letter
        while (start > 0 && start < cleaned.length && !/[A-Z]/.test(cleaned[start])) {
          start--;
        }
      }

      // Adjust end to sentence boundary
      const sentenceEnd = cleaned.indexOf('. ', end);
      if (sentenceEnd !== -1 && sentenceEnd < end + 200) {
        end = sentenceEnd + 1;
      }

      let excerpt = cleaned.substring(start, end);
      
      // Only add ellipsis if we're truly in the middle of content
      if (start > 5 && !excerpt.match(/^[A-Z]/)) {
        excerpt = '...' + excerpt;
      }
      if (end < cleaned.length - 5 && !excerpt.endsWith('.')) {
        excerpt = excerpt + '...';
      }
      
      return excerpt.trim();
    }

    // Fallback: take first complete sentences up to maxLength
    let excerpt = cleaned.substring(0, maxLength);
    const lastPeriod = excerpt.lastIndexOf('.');
    if (lastPeriod !== -1) {
      excerpt = excerpt.substring(0, lastPeriod + 1);
    } else {
      excerpt = excerpt + '...';
    }

    return excerpt.trim();
  }

  /**
   * Get user-friendly display name for metric
   * Converts internal database names to readable names
   */
  private getMetricDisplayName(metricName: string): string {
    // Map internal names to user-friendly display names
    const displayNames: Record<string, string> = {
      'revenue': 'Revenue',
      'Revenue': 'Revenue',
      'total_revenue': 'Revenue', // Database stores as total_revenue
      'Total_Revenue': 'Revenue',
      'net_income': 'Net Income',
      'Net_Income': 'Net Income',
      'gross_profit': 'Gross Profit',
      'Gross_Profit': 'Gross Profit',
      'operating_income': 'Operating Income',
      'Operating_Income': 'Operating Income',
      'cost_of_revenue': 'Cost of Revenue',
      'Cost_of_Revenue': 'Cost of Revenue',
      'research_and_development': 'Research & Development',
      'Research_and_Development': 'Research & Development',
      'selling_general_administrative': 'Selling, General & Administrative',
      'Selling_General_Administrative': 'Selling, General & Administrative',
      'total_assets': 'Total Assets',
      'Total_Assets': 'Total Assets',
      'total_liabilities': 'Total Liabilities',
      'Total_Liabilities': 'Total Liabilities',
      'total_equity': 'Total Equity',
      'Total_Equity': 'Total Equity',
      'cash': 'Cash & Cash Equivalents',
      'Cash': 'Cash & Cash Equivalents',
      'cash_and_cash_equivalents': 'Cash & Cash Equivalents',
      'Cash_and_Cash_Equivalents': 'Cash & Cash Equivalents',
      'accounts_payable': 'Accounts Payable',
      'Accounts_Payable': 'Accounts Payable',
      'accounts_receivable': 'Accounts Receivable',
      'Accounts_Receivable': 'Accounts Receivable',
      'inventory': 'Inventory',
      'Inventory': 'Inventory',
      'gross_margin': 'Gross Margin',
      'net_margin': 'Net Margin',
      'operating_margin': 'Operating Margin',
      'roe': 'Return on Equity (ROE)',
      'roa': 'Return on Assets (ROA)',
    };

    // Return display name if found, otherwise format the metric name
    if (displayNames[metricName]) {
      return displayNames[metricName];
    }

    // Fallback: Convert snake_case to Title Case
    return metricName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
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
   * Only includes sources with valid ticker and filing information
   */
  private extractSources(metrics: any[], narratives: any[]): any[] {
    const sources: any[] = [];
    const seen = new Set<string>(); // Deduplicate sources

    for (const metric of metrics) {
      // Only add if we have valid ticker and filing info
      if (metric.ticker && metric.filingType && metric.fiscalPeriod) {
        const key = `${metric.ticker}-${metric.filingType}-${metric.fiscalPeriod}`;
        if (!seen.has(key)) {
          seen.add(key);
          sources.push({
            type: 'metric',
            ticker: metric.ticker,
            filingType: metric.filingType,
            fiscalPeriod: metric.fiscalPeriod,
            pageNumber: metric.sourcePage,
          });
        }
      }
    }

    for (const narrative of narratives) {
      // Only add if we have valid metadata (fiscalPeriod is optional)
      if (narrative.metadata?.ticker && narrative.metadata?.filingType) {
        const fiscalPeriod = narrative.metadata.fiscalPeriod || 'unknown';
        const key = `${narrative.metadata.ticker}-${narrative.metadata.filingType}-${fiscalPeriod}`;
        if (!seen.has(key)) {
          seen.add(key);
          sources.push({
            type: 'narrative',
            ticker: narrative.metadata.ticker,
            filingType: narrative.metadata.filingType,
            fiscalPeriod: narrative.metadata.fiscalPeriod || 'Period Unknown',
            pageNumber: narrative.metadata.pageNumber,
            section: narrative.metadata.sectionType,
          });
        }
      }
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
   * Generate clarification prompt for ambiguous queries (Phase 3)
   * 
   * When a query is ambiguous (ticker-only with generic words), we generate
   * a comprehensive clarification prompt with 8 suggestion categories to help
   * the user refine their query.
   * 
   * @param intent The query intent marked as needing clarification
   * @returns RAGResponse with clarification prompt
   */
  private generateClarificationPrompt(intent: QueryIntent): RAGResponse {
    const ticker = Array.isArray(intent.ticker) ? intent.ticker[0] : intent.ticker;
    
    if (!ticker) {
      // Fallback if no ticker detected
      return {
        answer: 'I need more information to help you. Please specify a company ticker symbol (e.g., NVDA, AAPL, MSFT) and what you would like to know about it.',
        intent,
        sources: [],
        timestamp: new Date(),
        latency: 0,
        cost: 0,
        processingInfo: {
          structuredMetrics: 0,
          semanticNarratives: 0,
          userDocumentChunks: 0,
          usedBedrockKB: false,
          usedClaudeGeneration: false,
          hybridProcessing: false,
          needsClarification: true,
        },
      };
    }
    
    // Build suggestion categories
    const suggestions = [
      {
        category: 'Financial Performance',
        icon: '💰',
        subcategories: [
          {
            name: 'Revenue & Growth',
            queries: [
              `${ticker}'s revenue and growth rate`,
              `${ticker}'s revenue by segment`,
              `${ticker}'s revenue trends over 5 years`,
            ]
          },
          {
            name: 'Profitability',
            queries: [
              `${ticker}'s gross margin trends`,
              `${ticker}'s operating margins`,
              `${ticker}'s EBITDA and free cash flow`,
            ]
          },
          {
            name: 'Balance Sheet',
            queries: [
              `${ticker}'s cash and debt levels`,
              `${ticker}'s working capital`,
              `${ticker}'s capital structure`,
            ]
          }
        ]
      },
      {
        category: 'Business & Strategy',
        icon: '🏢',
        queries: [
          `What does ${ticker} do?`,
          `${ticker}'s business model`,
          `Who are ${ticker}'s competitors?`,
          `${ticker}'s competitive advantages`,
          `${ticker}'s growth strategy`,
        ]
      },
      {
        category: 'Comparative Analysis',
        icon: '📊',
        queries: [
          `Compare ${ticker} vs peers revenue growth`,
          `${ticker} vs industry average margins`,
          `${ticker}'s market share trends`,
          `${ticker} YoY and QoQ performance`,
        ]
      },
      {
        category: 'Risk & Quality',
        icon: '⚠️',
        queries: [
          `${ticker}'s risk factors`,
          `${ticker}'s supply chain risks`,
          `${ticker}'s debt maturity schedule`,
          `${ticker}'s accounting policies`,
        ]
      },
      {
        category: 'Forward-Looking',
        icon: '🔮',
        queries: [
          `${ticker}'s latest guidance`,
          `${ticker}'s expected margin trajectory`,
          `${ticker}'s upcoming catalysts`,
          `${ticker}'s growth drivers`,
        ]
      },
      {
        category: 'Valuation',
        icon: '💵',
        queries: [
          `${ticker}'s P/E and EV/EBITDA`,
          `${ticker}'s valuation vs peers`,
          `${ticker}'s historical valuation`,
          `${ticker}'s FCF yield`,
        ]
      },
      {
        category: 'Industry-Specific',
        icon: '🔬',
        queries: this.getIndustrySpecificQueries(ticker),
      },
      {
        category: 'ESG & Sustainability',
        icon: '🌱',
        queries: [
          `${ticker}'s carbon emissions`,
          `${ticker}'s employee diversity`,
          `${ticker}'s board composition`,
        ]
      }
    ];
    
    const answer = this.formatClarificationMessage(ticker, suggestions);
    
    return {
      answer,
      intent,
      sources: [],
      timestamp: new Date(),
      latency: 0,
      cost: 0,
      processingInfo: {
        structuredMetrics: 0,
        semanticNarratives: 0,
        userDocumentChunks: 0,
        usedBedrockKB: false,
        usedClaudeGeneration: false,
        hybridProcessing: false,
        needsClarification: true,
      },
    };
  }

  /**
   * Get industry-specific query suggestions (Phase 3)
   * 
   * Maps tickers to industries and returns relevant industry-specific queries.
   * 
   * @param ticker The company ticker symbol
   * @returns Array of industry-specific query suggestions
   */
  private getIndustrySpecificQueries(ticker: string): string[] {
    // Map tickers to industries
    const techTickers = ['NVDA', 'AMD', 'INTC', 'AAPL', 'MSFT'];
    const saasTickers = ['CRM', 'ORCL', 'ADBE'];
    const retailTickers = ['AMZN', 'WMT', 'TGT'];
    const healthcareTickers = ['JNJ', 'PFE', 'UNH'];
    
    if (techTickers.includes(ticker)) {
      return [
        `${ticker}'s R&D spending`,
        `${ticker}'s chip architecture roadmap`,
        `${ticker}'s process node migration`,
        `${ticker}'s ASP trends`,
      ];
    } else if (saasTickers.includes(ticker)) {
      return [
        `${ticker}'s ARR growth`,
        `${ticker}'s net retention rate`,
        `${ticker}'s customer acquisition cost`,
        `${ticker}'s churn rate`,
      ];
    } else if (retailTickers.includes(ticker)) {
      return [
        `${ticker}'s same-store sales growth`,
        `${ticker}'s e-commerce penetration`,
        `${ticker}'s fulfillment costs`,
        `${ticker}'s inventory turns`,
      ];
    } else if (healthcareTickers.includes(ticker)) {
      return [
        `${ticker}'s drug pipeline`,
        `${ticker}'s patent expirations`,
        `${ticker}'s clinical trial results`,
        `${ticker}'s regulatory approvals`,
      ];
    }
    
    // Default generic queries for unknown industries
    return [
      `${ticker}'s key performance indicators`,
      `${ticker}'s operational metrics`,
      `${ticker}'s industry trends`,
    ];
  }

  /**
   * Format clarification message (Phase 3)
   * 
   * Formats the clarification prompt with all suggestion categories.
   * 
   * @param ticker The company ticker symbol
   * @param suggestions Array of suggestion categories
   * @returns Formatted markdown string
   */
  private formatClarificationMessage(ticker: string, suggestions: any[]): string {
    const lines: string[] = [];
    
    lines.push(`I can provide information about ${ticker}. What would you like to know?\n`);
    
    for (const category of suggestions) {
      lines.push(`## ${category.icon} ${category.category}\n`);
      
      if (category.subcategories) {
        for (const sub of category.subcategories) {
          lines.push(`**${sub.name}**`);
          for (const query of sub.queries) {
            lines.push(`- ${query}`);
          }
          lines.push('');
        }
      } else {
        for (const query of category.queries) {
          lines.push(`- ${query}`);
        }
        lines.push('');
      }
    }
    
    lines.push(`\n**Quick Actions:**`);
    lines.push(`- View ${ticker}'s financial dashboard`);
    lines.push(`- Read ${ticker}'s latest 10-K`);
    lines.push(`- See ${ticker}'s key metrics`);
    
    return lines.join('\n');
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
