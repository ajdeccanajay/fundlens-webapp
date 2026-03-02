import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { QueryRouterService } from './query-router.service';
import { StructuredRetrieverService } from './structured-retriever.service';
import { SemanticRetrieverService } from './semantic-retriever.service';
import { BedrockService } from './bedrock.service';
import { DocumentRAGService } from './document-rag.service';
import { ComputedMetricsService } from '../dataSources/sec/computed-metrics.service';
import { PerformanceMonitorService } from './performance-monitor.service';
import { PerformanceOptimizerService } from './performance-optimizer.service';
import { QueryIntent, RAGResponse, MetricResult, ChunkResult, StructuredQuery, RetrievalPlan, SemanticQuery, PeriodType, DocumentType } from './types/query-intent';
import { ResponseEnrichmentService } from './response-enrichment.service';
import { MetricsSummary } from '../deals/financial-calculator.service';
import { InstantRAGService } from '../instant-rag/instant-rag.service';
import { HybridSynthesisService, FinancialAnalysisContext, SubQueryResult } from './hybrid-synthesis.service';
import { QueryDecomposerService, DecomposedQuery } from './query-decomposer.service';
import { classifyResponseType, ResponseClassificationInput } from './types/query-intent';
import { DocumentIndexingService } from '../documents/document-indexing.service';
import { QueryUnderstanding, SubQuery } from './types/query-understanding.types';
import { DocumentMetricExtractorService, DocumentComputedResult } from './document-metric-extractor.service';
import { MetricRegistryService } from './metric-resolution/metric-registry.service';
import { FormulaResolutionService } from './metric-resolution/formula-resolution.service';
import { ConceptRegistryService } from './metric-resolution/concept-registry.service';
import { BackgroundEnrichmentService } from '../documents/background-enrichment.service';

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

  /** Maximum number of retrieval loop iterations (Req 13.1) */
  private static readonly MAX_RETRIEVAL_ITERATIONS = 3;

  constructor(
    private readonly queryRouter: QueryRouterService,
    private readonly structuredRetriever: StructuredRetrieverService,
    private readonly semanticRetriever: SemanticRetrieverService,
    private readonly bedrock: BedrockService,
    private readonly documentRAG: DocumentRAGService,
    private readonly computedMetrics: ComputedMetricsService,
    private readonly performanceMonitor: PerformanceMonitorService,
    private readonly performanceOptimizer: PerformanceOptimizerService,
    private readonly responseEnrichment: ResponseEnrichmentService,
    @Inject(forwardRef(() => InstantRAGService))
    private readonly instantRAGService: InstantRAGService,
    @Optional()
    private readonly hybridSynthesis?: HybridSynthesisService,
    @Optional()
    private readonly queryDecomposer?: QueryDecomposerService,
    @Optional()
    private readonly documentIndexing?: DocumentIndexingService,
    @Optional()
    private readonly documentMetricExtractor?: DocumentMetricExtractorService,
    @Optional()
    private readonly metricRegistry?: MetricRegistryService,
    @Optional()
    private readonly formulaResolution?: FormulaResolutionService,
    @Optional()
    private readonly conceptRegistry?: ConceptRegistryService,
    @Optional()
    private readonly backgroundEnrichment?: BackgroundEnrichmentService,
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
      instantRagSessionId?: string; // Instant RAG session ID for cross-source retrieval
      longContextText?: string; // Spec §7.1 Source 4: raw doc text for long-context fallback
      longContextFileName?: string; // File name for attribution
      dealId?: string; // Spec §7.1: deal scope for uploaded doc search
      understanding?: QueryUnderstanding; // QUL Phase 2: pre-computed query understanding
    },
  ): Promise<RAGResponse> {
    const startTime = Date.now();
    this.logger.log(`🔍 Processing hybrid query: "${query}"`);

    // Signal to background enrichment: hold off on Bedrock calls
    this.backgroundEnrichment?.markQueryStart();

    try {
      // Step 1: Route query — use QUL data when available, fall back to legacy queryRouter
      let plan: RetrievalPlan;
      let intent: QueryIntent;

      if (options?.understanding) {
        // QUL Phase 2: Build plan and intent from pre-computed QueryUnderstanding
        // This bypasses the legacy queryRouter.route() + getIntent() calls,
        // eliminating redundant LLM calls and using QUL's superior entity resolution.
        const qul = options.understanding;
        this.logger.log(`🧠 QUL-aware routing: intent=${qul.intent}, entity=${qul.primaryEntity?.ticker || 'none'}`);

        intent = this.buildIntentFromQUL(qul, query);
        plan = await this.buildPlanFromQUL(qul, intent, options?.tenantId);

        this.logger.log(`🔍 QUL Intent: type=${intent.type}, ticker=${JSON.stringify(intent.ticker)}, metrics=${JSON.stringify(intent.metrics)}`);
      } else {
        // Legacy path: use queryRouter (for non-QUL callers like chat.service.ts)
        plan = await this.queryRouter.route(query, options?.tenantId, options?.ticker);
        intent = await this.queryRouter.getIntent(query, options?.tenantId, options?.ticker);
      }
      
      // DEBUG: Log intent to trace wrong data bug
      this.logger.log(`🔍 DEBUG Intent Detection:`);
      this.logger.log(`   Query: "${query}"`);
      this.logger.log(`   Intent Type: ${intent.type}`);
      this.logger.log(`   Ticker: ${JSON.stringify(intent.ticker)}`);
      this.logger.log(`   Metrics: ${JSON.stringify(intent.metrics)}`);
      this.logger.log(`   Period: ${intent.period}`);
      
      // Override intent ticker with explicit tickers array for peer comparison
      if (options?.tickers && options.tickers.length > 0) {
        this.logger.log(`🔄 Overriding intent ticker with tickers: ${options.tickers.join(', ')}`);
        intent.ticker = options.tickers;
        
        // CRITICAL: Also patch the retrieval plan — it was built before this override
        if (plan.structuredQuery) {
          plan.structuredQuery.tickers = options.tickers;
        } else if (plan.useStructured) {
          // Plan says structured=true but no structuredQuery was built (tickers were empty at plan time)
          // Build a minimal structured query now that we have tickers
          const filingTypes: any[] = intent.periodType === 'annual' ? ['10-K'] :
            intent.periodType === 'quarterly' ? ['10-Q'] : ['10-K', '10-Q'];
          plan.structuredQuery = {
            tickers: options.tickers,
            metrics: intent.metrics ? (this['metricRegistry']?.resolveMultiple?.(intent.metrics, options?.tenantId) || []) : [],
            period: intent.period,
            periodType: intent.periodType,
            filingTypes,
            includeComputed: intent.needsComputation,
          };
          this.logger.log(`📋 Built structuredQuery from tickers override: ${options.tickers.join(', ')}`);
        }
        if (plan.semanticQuery) {
          plan.semanticQuery.tickers = options.tickers;
        }
      }
      
      // Step 1.5: Check if clarification needed (Phase 3)
      // IMPORTANT: Skip clarification when a ticker is explicitly provided via options.
      // This means the user is in a workspace context and we know the company.
      const hasExplicitTicker = options?.ticker || (options?.tickers && options.tickers.length > 0);
      if (intent.needsClarification && !hasExplicitTicker) {
        this.logger.log(`⚠️ Query needs clarification, generating clarification prompt`);
        return this.generateClarificationPrompt(intent);
      } else if (intent.needsClarification && hasExplicitTicker) {
        this.logger.log(`🔧 Skipping clarification — explicit ticker provided: ${options?.ticker || options?.tickers?.join(',')}`);
        intent.needsClarification = false;
      }
      
      // Step 1.5: Make optimization decisions
      const optimizationDecisions = this.performanceOptimizer.makeOptimizationDecisions(
        query,
        intent,
        options?.tenantId
      );
      
      this.logger.log(`🎯 Optimization decisions: ${optimizationDecisions.reasoning.join(', ')}`);
      
      // Step 1.6: Check cache
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

      // ── UPLOADED DOC SEARCH: Start early, await in any branch ─────────
      // Uploaded doc search is a top-level parallel concern. It fires on
      // every query where uploaded documents exist, regardless of whether
      // the query gets decomposed, concept-expanded, or routed to peers.
      const uploadedDocPromise = this.searchUploadedDocs(query, intent, {
        tenantId: options?.tenantId,
        ticker: options?.ticker,
        dealId: options?.dealId,
        understanding: options?.understanding,
      });

      // ── QUL §8 METRIC RESOLUTION: Also start early ────────────────────
      // When QUL provides subQueries with metric hints, route them through
      // the deterministic engine. This produces computed metrics (e.g.
      // gross_margin_pct) that supplement standard retrieval.
      const qulMetricPromise = (options?.understanding && options.understanding.subQueries?.length)
        ? this.executeQULMetricResolution(options.understanding, intent, options.tenantId)
            .catch(e => { this.logger.warn(`⚠️ §8 metric resolution failed (non-fatal): ${e.message}`); return [] as any[]; })
        : Promise.resolve([] as any[]);

      // ── Step 1.7: Query Decomposition (Req 14.1) ──────────────────────
      // QUL spec §7: QueryDecomposerService is absorbed into QUL (subQueries field).
      // When QUL is active, skip the legacy decomposer entirely — QUL's subQueries
      // are executed through the three-layer resolution stack below, alongside
      // uploaded doc search and computed metric resolution.
      if (this.queryDecomposer && !options?.understanding) {
        try {
          const decomposed = await this.queryDecomposer.decompose(query, intent);

          if (decomposed.isDecomposed) {
            this.logger.log(
              `🔀 Query decomposed into ${decomposed.subQueries.length} sub-queries`,
            );

            // Execute sub-queries independently and collect results (Req 14.1)
            const subQueryResults = await this.executeSubQueries(
              decomposed,
              intent,
              options,
            );

            // If all sub-queries failed, fall back to treating original query as single-intent
            if (subQueryResults.length === 0) {
              this.logger.warn(
                `⚠️ All sub-queries failed — falling back to single-intent flow`,
              );
              // Fall through to normal retrieval flow below
            } else {

            // ── Await uploaded doc + QUL metric results (started before decomposition) ──
            const [uploadedDocResults, qulAdditionalMetrics] = await Promise.all([
              uploadedDocPromise,
              qulMetricPromise,
            ]);

            // Merge uploaded doc metrics + narratives into sub-query results
            const uploadedMetrics = uploadedDocResults.metrics;
            const uploadedNarratives = uploadedDocResults.narratives;
            const uploadedChunkCount = uploadedDocResults.chunkCount;

            if (uploadedMetrics.length > 0 || uploadedNarratives.length > 0) {
              this.logger.log(
                `📎 Decomposed path: merging ${uploadedMetrics.length} uploaded doc metrics + ${uploadedNarratives.length} narratives + ${qulAdditionalMetrics.length} QUL computed metrics`,
              );
            }

            // Build FinancialAnalysisContext with sub-query results (Req 14.2)
            const synthesisContext: FinancialAnalysisContext = {
              originalQuery: query,
              intent,
              metrics: [...uploadedMetrics, ...qulAdditionalMetrics],
              narratives: [...uploadedNarratives, ...subQueryResults.flatMap(sq => sq.narratives)],
              computedResults: [],
              subQueryResults,
              unifyingInstruction: decomposed.unifyingInstruction,
              modelTier: optimizationDecisions.modelTier as 'haiku' | 'sonnet' | 'opus',
              tenantId: options?.tenantId,
            };

            // Use HybridSynthesisService with unifying prompt (Req 14.3)
            let answer: string;
            let usage: any;
            let citations: any[] = [];

            if (this.hybridSynthesis) {
              try {
                const synthesisResult = await this.hybridSynthesis.synthesize(synthesisContext);
                answer = synthesisResult.answer;
                usage = synthesisResult.usage;
                citations = synthesisResult.citations || [];
                this.logger.log(
                  `🤖 Decomposed synthesis complete: responseType=${synthesisResult.responseType}`,
                );
              } catch (synthError) {
                this.logger.warn(
                  `HybridSynthesis failed for decomposed query, building fallback: ${synthError.message}`,
                );
                answer = this.buildAnswer(query, intent, [], []);
                usage = undefined;
              }
            } else {
              answer = this.buildAnswer(query, intent, [], []);
              usage = undefined;
            }

            // Collect all metrics and narratives from sub-queries + uploaded docs for the response
            const allMetrics = [...subQueryResults.flatMap((sq) => sq.metrics), ...uploadedMetrics, ...qulAdditionalMetrics];
            const allNarratives = [...uploadedNarratives, ...subQueryResults.flatMap((sq) => sq.narratives)];

            const latency = Date.now() - startTime;
            const response: RAGResponse = {
              answer,
              intent,
              metrics: allMetrics.length > 0 ? allMetrics : undefined,
              narratives: allNarratives.length > 0 ? allNarratives : undefined,
              sources: this.extractSources(allMetrics, allNarratives),
              citations: citations.length > 0 ? citations : undefined,
              timestamp: new Date(),
              latency,
              cost: this.estimateCost(allMetrics, allNarratives, usage),
              usage,
              processingInfo: {
                structuredMetrics: allMetrics.length,
                semanticNarratives: allNarratives.length,
                userDocumentChunks: uploadedChunkCount,
                usedBedrockKB: !!process.env.BEDROCK_KB_ID,
                usedClaudeGeneration: !!usage,
                hybridProcessing: true,
                fromCache: false,
                modelTier: optimizationDecisions.modelTier,
                parallelExecution: false,
                optimizationDecisions: optimizationDecisions.reasoning,
              },
            };

            // Record performance metrics
            this.performanceMonitor.recordQuery({
              query,
              latency,
              timestamp: new Date(),
              queryType: intent.type,
              ticker: Array.isArray(intent.ticker) ? intent.ticker[0] : intent.ticker,
              metricsCount: allMetrics.length,
              narrativesCount: allNarratives.length,
            });

            // Enrich response with visualization
            const enrichedResponse = this.responseEnrichment.enrichResponse(
              response,
              intent,
              allMetrics,
              undefined,
            );

            // Cache the enriched response
            if (optimizationDecisions.useCache && optimizationDecisions.cacheKey) {
              const ttl = this.performanceOptimizer.getCacheTTL(intent);
              const ticker = Array.isArray(intent.ticker) ? intent.ticker[0] : intent.ticker;
              this.performanceOptimizer.cacheQuery(
                optimizationDecisions.cacheKey,
                enrichedResponse,
                ttl,
                ticker,
              );
            }

            return enrichedResponse;
            } // end else (subQueryResults.length > 0)
          }
        } catch (decomposeError) {
          // If decomposition fails entirely, fall through to normal flow
          this.logger.warn(
            `Query decomposition failed, continuing with normal flow: ${decomposeError.message}`,
          );
        }
      }

      // Quick response path DISABLED — always run full LLM synthesis
      // Skipping LLM produced raw tables with no analysis or citations.
      // All queries now go through hybrid retrieval + synthesis.
      this.logger.debug('⚡ Quick response path bypassed — using full synthesis');

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
          
          // Add contextual metrics from RDS (tagged so chart generator can filter them out)
          if (results[1].contextualMetrics?.length > 0) {
            this.logger.log(`📊 Adding ${results[1].contextualMetrics.length} contextual metrics from RDS`);
            const taggedContextual = results[1].contextualMetrics.map((m: any) => ({ ...m, _contextual: true }));
            metrics = [...metrics, ...taggedContextual];
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
          this.logger.log(`   Metrics: ${JSON.stringify(plan.structuredQuery.metrics.map(m => m.canonical_id || m.original_query))}`);
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
          
          // FALLBACK: If structured returned 0 metrics, escalate to semantic path
          // This prevents "No data found" for valid queries where metric name doesn't match DB exactly
          if (metrics.length === 0 && !plan.useSemantic) {
            this.logger.log(`⚠️ Structured retrieval returned 0 metrics — escalating to semantic fallback`);
            const tickers = plan.structuredQuery.tickers;
            plan.useSemantic = true;
            plan.semanticQuery = {
              query: intent.originalQuery,
              tickers: tickers.length > 0 ? tickers : undefined,
              documentTypes: ['10-K', '10-Q'],
              sectionTypes: undefined,
              period: plan.structuredQuery.period,
              maxResults: 5,
            };
          }
        }

        // SEMANTIC PATH: Foundation model narratives from Bedrock KB + RDS context
        if (plan.useSemantic && plan.semanticQuery) {
          this.logger.log(`🧠 Retrieving semantic narratives with RDS context`);
          const result = await this.semanticRetriever.retrieveWithContext(
            plan.semanticQuery,
          );
          narratives = result.narratives;
          
          // Add contextual metrics from RDS to enrich the response (tagged for chart filtering)
          if (result.contextualMetrics.length > 0) {
            this.logger.log(`📊 Adding ${result.contextualMetrics.length} contextual metrics from RDS`);
            const taggedContextual = result.contextualMetrics.map((m: any) => ({ ...m, _contextual: true }));
            metrics = [...metrics, ...taggedContextual];
          }
          
          this.logger.log(
            `🧠 Retrieved ${narratives.length} semantic narratives (avg score: ${result.summary.avgScore.toFixed(2)})`,
          );
        }
      }

      // ── UPLOADED DOCUMENT SOURCES (Spec §7.1 Sources 1+2) ──────────
      // Await the promise started before decomposition branch.
      // Merge uploaded doc metrics + narratives into the main results.
      let uploadedDocChunks: any[] = [];
      {
        const uploadedDocResults = await uploadedDocPromise;
        if (uploadedDocResults.metrics.length > 0) {
          metrics = [...metrics, ...uploadedDocResults.metrics];
        }
        if (uploadedDocResults.narratives.length > 0) {
          uploadedDocChunks = uploadedDocResults.narratives; // for chunkCount tracking
          narratives = [...narratives, ...uploadedDocResults.narratives];
          this.logger.log(
            `📎 Merged uploaded doc chunks AFTER SEC narratives (total: ${narratives.length})`,
          );
        }
      }

      // USER DOCUMENTS PATH: Search user-uploaded documents if tenant provided
      if (options?.tenantId && options?.includeCitations) {
        // Use the PRIMARY ticker from intent detection (query-derived),
        // not options.ticker (which is workspace context and may be wrong).
        const intentPrimaryTicker = Array.isArray(intent.ticker)
          ? intent.ticker[0]
          : intent.ticker;
        const docSearchTicker = intentPrimaryTicker || options.ticker || null;

        this.logger.log(`📄 Searching user documents for tenant ${options.tenantId} (intent ticker: ${intentPrimaryTicker}, workspace ticker: ${options.ticker}, using: ${docSearchTicker})`);
        const userDocResult = await this.documentRAG.searchUserDocuments(query, {
          tenantId: options.tenantId,
          ticker: docSearchTicker,
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

      // INSTANT RAG SESSION DOCUMENTS PATH: Retrieve and merge session docs if session ID provided
      let sessionDocsUnavailable = false;

      // ── QUL PHASE 4: Document Metric Extraction (Spec §8.4) ────────
      // When QUL identifies uploaded entities with metric hints, use the
      // DocumentMetricExtractorService to extract precise metric values
      // from uploaded documents. These feed into the same formula engine
      // as public equity metrics.
      let documentComputedResults: DocumentComputedResult[] = [];
      if (this.documentMetricExtractor && options?.understanding && options?.tenantId) {
        const qul = options.understanding;
        const uploadedEntities = qul.entities.filter(e => e.entityType === 'uploaded_entity' && e.documentId);
        const metricHints = qul.subQueries?.filter(sq => sq.metric && sq.path === 'uploaded_doc_rag').map(sq => sq.metric!) || [];

        // Also check if the main intent has metric hints for uploaded entities
        if (uploadedEntities.length > 0 && metricHints.length === 0 && qul.subQueries) {
          for (const sq of qul.subQueries) {
            if (sq.metric) metricHints.push(sq.metric);
          }
        }

        if (uploadedEntities.length > 0 && metricHints.length > 0) {
          this.logger.log(`📐 Phase 4: Extracting metrics [${metricHints.join(', ')}] from ${uploadedEntities.length} uploaded entities`);

          for (const entity of uploadedEntities) {
            try {
              for (const metricHint of metricHints) {
                const result = await this.documentMetricExtractor.extractAndCompute(
                  entity.documentId!,
                  metricHint,
                  options.tenantId,
                  qul.temporalScope,
                );
                documentComputedResults.push(result);

                if (result.value != null) {
                  // Add to metrics array for downstream synthesis
                  metrics.push({
                    ticker: entity.name || entity.ticker || 'TargetCo',
                    normalizedMetric: result.canonical_id,
                    rawLabel: result.display_name,
                    value: result.value,
                    rawValue: String(result.value),
                    fiscalPeriod: Object.values(result.resolved_inputs)[0]?.period || '',
                    periodType: 'actual',
                    filingType: 'uploaded-document',
                    statementType: 'uploaded',
                    statementDate: null,
                    filingDate: null,
                    sourcePage: null,
                    confidenceScore: 0.85,
                    source: `Computed from uploaded document (${result.formula || 'direct extraction'})`,
                    isEstimate: false,
                    fileName: entity.documentId,
                    _documentComputed: true,
                    _formula: result.formula,
                    _resolvedInputs: result.resolved_inputs,
                    _caveats: result.caveats,
                  });
                  this.logger.log(`✅ Phase 4: ${result.display_name} = ${result.value} (from doc ${entity.documentId?.slice(0, 8)})`);
                } else {
                  this.logger.log(`⚠️ Phase 4: Could not extract ${result.display_name}: ${result.explanation}`);
                }
              }
            } catch (e) {
              this.logger.warn(`⚠️ Phase 4 extraction failed for entity ${entity.name}: ${e.message}`);
            }
          }
        }
      }

      // ── QUL §8.2-8.3: Deterministic Engine Metric Resolution ───────
      // Await the promise started before decomposition branch.
      {
        const qulMetrics = await qulMetricPromise;
        if (qulMetrics.length > 0) {
          this.logger.log(`📐 §8 Integration: ${qulMetrics.length} additional metrics from deterministic engine`);
          metrics = [...metrics, ...qulMetrics];
        }
      }

      if (options?.instantRagSessionId) {
        try {
          this.logger.log(`📎 Retrieving Instant RAG session documents for session ${options.instantRagSessionId}`);
          const sessionDocs = await this.instantRAGService.getSessionDocuments(options.instantRagSessionId);
          
          // Filter to docs with non-empty extractedText
          const validDocs = sessionDocs.filter(doc => doc.extractedText && doc.extractedText.trim().length > 0);
          
          if (validDocs.length > 0) {
            // Convert SessionDocument[] to UserDocumentChunk[] format
            // Cap at 4000 chars per doc to prevent OOM (was 8000)
            const sessionChunks = validDocs.slice(0, 3).map(doc => ({
              id: doc.id,
              documentId: doc.id,
              content: doc.extractedText!.substring(0, 4000),
              pageNumber: null,
              ticker: null,
              filename: doc.fileName,
              score: 0.85, // User explicitly uploaded = high relevance
            }));
            
            this.logger.log(`📎 Found ${sessionChunks.length} valid session document chunks`);
            
            // Merge session docs with existing narratives
            narratives = this.documentRAG.mergeAndRerankResults(sessionChunks, narratives, 10);
            this.logger.log(`🔀 Merged session docs: ${narratives.length} total narratives`);
          } else {
            this.logger.log(`📎 No valid session documents found (${sessionDocs.length} total, 0 with text)`);
          }
        } catch (error) {
          this.logger.warn(`⚠️ Failed to retrieve session documents: ${error.message}`);
          sessionDocsUnavailable = true;
        }
      }

      // ── SOURCE 4: Long-Context Fallback (Spec §7.1) ───────────────
      // If caller provides raw document text (document in 'long-context-fallback'
      // mode, not yet chunked/embedded), send it directly to Claude's 200K
      // context window. The user always gets an answer.
      if (options?.longContextText && options.longContextText.length > 0) {
        this.logger.log(
          `📄 Long-context fallback active: ${options.longContextText.length} chars from "${options.longContextFileName || 'uploaded document'}"`,
        );

        // If we already have metrics/narratives from other sources, merge the
        // long-context text as an additional narrative chunk so the LLM sees it.
        const longContextChunk = {
          content: options.longContextText.substring(0, 50000), // Cap at 50K chars (~12K tokens) to prevent OOM
          score: 0.95, // High relevance — user explicitly uploaded this
          metadata: {
            ticker: options.ticker || '',
            sectionType: 'uploaded-document',
            filingType: 'user-upload',
            fiscalPeriod: undefined,
            chunkIndex: undefined,
          },
          source: {
            location: options.longContextFileName || 'uploaded-document',
            type: 'long-context-fallback',
          },
        };
        narratives = [...narratives, longContextChunk];
        this.logger.log(`📄 Injected long-context document into narratives (total: ${narratives.length})`);
      }

      // ── Bounded Retrieval Loop (Req 13.1–13.6) ────────────────────────
      // After the initial retrieval pass, evaluate completeness and re-plan
      // if needed, up to MAX_RETRIEVAL_ITERATIONS total iterations.
      let retrievalIteration = 1;
      while (
        retrievalIteration < RAGService.MAX_RETRIEVAL_ITERATIONS &&
        !this.isRetrievalComplete(intent, metrics, narratives)
      ) {
        retrievalIteration++;
        this.logger.log(
          `🔄 Retrieval loop iteration ${retrievalIteration}/${RAGService.MAX_RETRIEVAL_ITERATIONS} — data incomplete`,
        );

        try {
          // Build replanner prompt and invoke LLM
          const replanPrompt = this.buildReplanPrompt(query, intent, metrics, narratives);
          const replanResponse = await this.bedrock.invokeClaude({
            prompt: replanPrompt,
            max_tokens: 300,
          });
          const replanResult = this.parseReplanResult(replanResponse);

          // If replanner says done → exit loop (Req 13.4)
          if (replanResult.done) {
            this.logger.log('🔄 Replanner says done — exiting retrieval loop');
            break;
          }

          // Execute additional retrieval with new parameters
          const additionalMetrics: any[] = [];
          const additionalNarratives: any[] = [];

          // Structured retrieval for additional tickers/metrics
          if (
            plan.useStructured &&
            plan.structuredQuery &&
            ((replanResult.additionalTickers && replanResult.additionalTickers.length > 0) ||
              (replanResult.additionalMetrics && replanResult.additionalMetrics.length > 0))
          ) {
            const additionalTickers =
              replanResult.additionalTickers && replanResult.additionalTickers.length > 0
                ? replanResult.additionalTickers
                : plan.structuredQuery.tickers;

            // Build a lightweight structured query for the additional data
            const additionalQuery: StructuredQuery = {
              ...plan.structuredQuery,
              tickers: additionalTickers,
            };

            const additionalResult = await this.structuredRetriever.retrieve(additionalQuery);
            additionalMetrics.push(...(additionalResult.metrics || []));
          }

          // Semantic retrieval for additional sections
          if (
            plan.useSemantic &&
            plan.semanticQuery &&
            replanResult.additionalSections &&
            replanResult.additionalSections.length > 0
          ) {
            const additionalSemanticQuery = {
              ...plan.semanticQuery,
              sectionTypes: replanResult.additionalSections as any[],
            };
            const additionalResult =
              await this.semanticRetriever.retrieveWithContext(additionalSemanticQuery);
            additionalNarratives.push(...(additionalResult.narratives || []));
          }

          // Merge results (Req 13.5)
          const merged = this.mergeRetrievalResults(
            { metrics, narratives },
            { metrics: additionalMetrics, narratives: additionalNarratives },
          );
          metrics = merged.metrics;
          narratives = merged.narratives;
        } catch (error) {
          // Replanner LLM failure → exit loop, use data collected so far
          this.logger.warn(
            `⚠️ Retrieval loop iteration ${retrievalIteration} failed: ${error.message} — using data collected so far`,
          );
          break;
        }
      }

      // Log total iteration count (Req 13.6)
      if (retrievalIteration > 1) {
        this.logger.log(
          `🔄 Retrieval loop completed after ${retrievalIteration} iteration(s)`,
        );
      }

      // If both retrieval paths returned nothing, try to provide helpful context
      // about what data IS available for this ticker
      if (metrics.length === 0 && narratives.length === 0) {
        const tickers = Array.isArray(intent.ticker) ? intent.ticker : intent.ticker ? [intent.ticker] : [];
        if (tickers.length > 0) {
          try {
            const availablePeriods = await this.structuredRetriever.getAvailablePeriods(tickers[0]);
            if (availablePeriods.length > 0) {
              const periodList = availablePeriods.slice(0, 5).map(p => `${p.period} (${p.filingType})`).join(', ');
              this.logger.log(`📋 No data found, but ${tickers[0]} has data for: ${periodList}`);
            } else {
              this.logger.log(`📋 No data found — ${tickers[0]} has no ingested data at all`);
            }
          } catch (e) {
            this.logger.warn(`Could not check available data: ${e.message}`);
          }
        }
      }

      // MISSING TICKER DATA HANDLING: Identify which tickers have data and which don't
      // For multi-ticker queries, partition by data availability and build actionable messages
      const requestedTickers = Array.isArray(intent.ticker) ? intent.ticker : intent.ticker ? [intent.ticker] : [];
      let missingTickerMessage: string | undefined;

      if (requestedTickers.length > 0 && metrics.length >= 0) {
        const tickersWithData = requestedTickers.filter(t =>
          metrics.some(m => m.ticker?.toUpperCase() === t.toUpperCase()),
        );
        const tickersWithoutData = requestedTickers.filter(t =>
          !metrics.some(m => m.ticker?.toUpperCase() === t.toUpperCase()),
        );

        if (tickersWithoutData.length > 0 && tickersWithoutData.length === requestedTickers.length) {
          // ALL tickers missing structured data
          if (narratives.length === 0) {
            // No narratives either — return early with a helpful message
            this.logger.log(`⚠️ All requested tickers lack data: ${tickersWithoutData.join(', ')}`);
            const latency = Date.now() - startTime;
            return {
              answer: `No data found for ${requestedTickers.join(', ')}. Please ingest their SEC filings first.`,
              intent,
              sources: [],
              timestamp: new Date(),
              latency,
              cost: 0,
              processingInfo: {
                structuredMetrics: 0,
                semanticNarratives: 0,
                userDocumentChunks: 0,
                usedBedrockKB: !!process.env.BEDROCK_KB_ID,
                usedClaudeGeneration: false,
                hybridProcessing: true,
                fromCache: false,
              },
            };
          }
          // Has narratives but no structured metrics — continue but note the missing data
          missingTickerMessage = `No structured metric data found for ${requestedTickers.join(', ')}. Please ingest their SEC filings for quantitative analysis.`;
          this.logger.log(`⚠️ All tickers lack structured data but narratives available — continuing with semantic results`);
        }

        if (tickersWithoutData.length > 0 && tickersWithData.length > 0) {
          // Partial data — some tickers have data, others don't
          missingTickerMessage = `Data available for ${tickersWithData.join(', ')}. ` +
            `No data found for ${tickersWithoutData.join(', ')} — please ingest their SEC filings.`;
          this.logger.log(`⚠️ Partial ticker data: ${missingTickerMessage}`);
        }
      }

      // Phase 1 (Pre-LLM): Compute financial metrics for richer synthesis context
      // Always compute when we have metrics — gives the LLM growth rates, margins,
      // and derived metrics even for simple queries like "What is AMZN's revenue?"
      let computedSummary: MetricsSummary | MetricsSummary[] | undefined;
      if (metrics.length > 0) {
        const tickers = Array.isArray(intent.ticker) ? intent.ticker : intent.ticker ? [intent.ticker] : [];
        if (tickers.length > 1) {
          const summaries = await this.responseEnrichment.computeFinancialsMulti(intent, metrics);
          computedSummary = summaries.length > 0 ? summaries : undefined;
        } else if (tickers.length === 1) {
          computedSummary = await this.responseEnrichment.computeFinancials(intent, metrics);
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

        // Hard cap: truncate individual narrative content to prevent OOM during prompt building
        for (const n of narratives) {
          if (n.content && n.content.length > 4000) {
            n.content = n.content.substring(0, 4000) + '…[truncated]';
          }
        }
      }
      
      // Decide if LLM should be used
      const shouldUseLLM = this.performanceOptimizer.shouldUseLLM(intent, metrics, narratives);
      
      // DEBUG: Log all conditions for Claude generation
      this.logger.log(`🔍 DEBUG Claude Generation Conditions:`);
      this.logger.log(`   shouldUseLLM: ${shouldUseLLM}`);
      this.logger.log(`   BEDROCK_KB_ID: ${process.env.BEDROCK_KB_ID ? 'SET' : 'NOT SET'}`);
      this.logger.log(`   metrics.length: ${metrics.length}`);
      this.logger.log(`   narratives.length: ${narratives.length}`);
      this.logger.log(`   hybridSynthesis available: ${!!this.hybridSynthesis}`);
      this.logger.log(`   Will use HybridSynthesis: ${shouldUseLLM && !!this.hybridSynthesis && (metrics.length > 0 || narratives.length > 0)}`);

      // Use HybridSynthesisService for structured 5-step reasoning (Req 10.1–10.3)
      if (shouldUseLLM && this.hybridSynthesis && (metrics.length > 0 || narratives.length > 0)) {
        this.logger.log(`🤖 Synthesizing via HybridSynthesisService (${optimizationDecisions.modelTier})`);
        try {
          // Req 10.1: Construct FinancialAnalysisContext from retrieval results
          const synthesisContext: FinancialAnalysisContext = {
            originalQuery: query,
            intent,
            metrics,
            narratives,
            computedResults: [], // Populated by computed metrics from FormulaResolutionService when available
            computedSummary, // Pass FinancialCalculatorService results (includes computed margins for all tickers)
            modelTier: optimizationDecisions.modelTier as 'haiku' | 'sonnet' | 'opus',
            tenantId: options?.tenantId,
          };

          // Req 10.2: Call hybridSynthesis.synthesize() instead of bedrock.generate()
          const synthesisResult = await this.hybridSynthesis.synthesize(synthesisContext);

          // Req 10.3: Use SynthesisResult for answer, usage, citations
          answer = synthesisResult.answer;
          usage = synthesisResult.usage;
          citations = synthesisResult.citations || [];

          // ALWAYS build SEC metric citations from structured data.
          // These prove the numbers independently of which narrative chunks the LLM cited.
          if (metrics.length > 0) {
            const secMetrics = metrics.filter((m: any) =>
              m.filingType !== 'uploaded-document'
            );
            if (secMetrics.length > 0) {
              const metricCitations = this.buildMetricCitations(secMetrics);
              // Deduplicate against existing citations
              const existingKeys = new Set(
                citations.map((c: any) => `${c.ticker}-${c.filingType}-${c.fiscalPeriod}`)
              );
              const newCitations = metricCitations.filter((c: any) =>
                !existingKeys.has(`${c.ticker}-${c.filingType}-${c.fiscalPeriod}`)
              );
              if (newCitations.length > 0) {
                const nextNum = citations.length > 0
                  ? Math.max(...citations.map((c: any) => c.number || c.citationNumber || 0)) + 1
                  : 1;
                newCitations.forEach((c: any, i: number) => {
                  c.number = nextNum + i;
                  c.citationNumber = nextNum + i;
                });
                citations = [...citations, ...newCitations];
                this.logger.log(`📊 Added ${newCitations.length} SEC metric citations (total: ${citations.length})`);
              }
            }
          }
          
          // Also extract citations from user document chunks if present.
          // Renumber to follow existing citations.
          // Deduplicate by documentId to avoid double-counting the same uploaded file
          if (userDocChunks.length > 0 && options?.includeCitations) {
            const existingDocIds = new Set(
              citations
                .filter((c: any) => c.documentId)
                .map((c: any) => c.documentId),
            );
            const userDocCitations = this.documentRAG
              .extractCitationsFromChunks(userDocChunks)
              .filter((c: any) => !existingDocIds.has(c.documentId));
            if (userDocCitations.length > 0) {
              // Re-number to continue from existing citations
              const nextNum = citations.length > 0
                ? Math.max(...citations.map((c: any) => c.number || c.citationNumber || 0)) + 1
                : 1;
              userDocCitations.forEach((c: any, i: number) => {
                c.citationNumber = nextNum + i;
                c.number = nextNum + i;
              });
              citations = [...citations, ...userDocCitations];
            }
            this.logger.log(`📎 Extracted ${userDocCitations.length} unique user doc citations (deduped by documentId)`);
          }
          
          this.logger.log(
            `🤖 Synthesis complete: responseType=${synthesisResult.responseType} (${usage.inputTokens} input, ${usage.outputTokens} output tokens, ${citations.length} citations)`,
          );
        } catch (error) {
          this.logger.warn(`HybridSynthesis failed, falling back to structured answer: ${error.message}`);
          const isMultiTicker = Array.isArray(intent.ticker) && intent.ticker.length > 1;
          if (isMultiTicker && metrics.length > 0) {
            const fallbackResponse = await this.responseEnrichment.buildQuickResponse(intent, metrics);
            answer = '⚠️ Analysis temporarily unavailable — showing raw data. Try again for a full comparative analysis.\n\n' + fallbackResponse.answer;
          } else {
            answer = this.buildAnswer(query, intent, metrics, narratives);
          }
        }
      } else if (shouldUseLLM && process.env.BEDROCK_KB_ID && (metrics.length > 0 || narratives.length > 0)) {
        // Legacy fallback: use bedrock.generate() when HybridSynthesisService is not available
        const modelId = this.performanceOptimizer.getModelId(optimizationDecisions.modelTier);
        
        this.logger.log(`🤖 Generating response with legacy bedrock.generate (${optimizationDecisions.modelTier})`);
        try {
          const isPeerComparison = Array.isArray(intent.ticker) && intent.ticker.length > 1;
          const generated = await this.bedrock.generate(query, {
            metrics,
            narratives,
            systemPrompt: options?.systemPrompt,
            modelId,
            isPeerComparison,
            computedSummary,
          });
          answer = generated.answer;
          usage = generated.usage;
          citations = generated.citations || [];
          
          if (userDocChunks.length > 0 && options?.includeCitations) {
            const existingDocIds = new Set(
              citations
                .filter((c: any) => c.documentId)
                .map((c: any) => c.documentId),
            );
            const userDocCitations = this.documentRAG
              .extractCitationsFromChunks(userDocChunks)
              .filter((c: any) => !existingDocIds.has(c.documentId));
            if (userDocCitations.length > 0) {
              const nextNum = citations.length > 0
                ? Math.max(...citations.map((c: any) => c.number || c.citationNumber || 0)) + 1
                : 1;
              userDocCitations.forEach((c: any, i: number) => {
                c.citationNumber = nextNum + i;
                c.number = nextNum + i;
              });
              citations = [...citations, ...userDocCitations];
            }
            this.logger.log(`📎 Extracted ${userDocCitations.length} unique user doc citations (deduped by documentId)`);
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

      // Graceful degradation: SOURCE-AWARE check (Req 9.1–9.4)
      // Only declare metrics "unresolved" if they're missing from ALL sources
      // (structured retriever, uploaded docs, computed metrics, narratives)
      if (plan.structuredQuery && plan.structuredQuery.metrics.length > 0) {
        const { unresolved } = this.responseEnrichment.partitionResolutions(
          plan.structuredQuery.metrics,
        );

        // Build a set of all metric IDs resolved by ANY source
        const allResolvedMetricIds = new Set<string>();

        // From the merged metrics array (includes structured + uploaded doc metrics)
        for (const m of metrics) {
          if (m.normalizedMetric) allResolvedMetricIds.add(m.normalizedMetric.toLowerCase());
        }

        // From computed results (formula engine)
        if (computedSummary) {
          const summaries = Array.isArray(computedSummary) ? computedSummary : [computedSummary];
          for (const s of summaries) {
            if (s?.metrics?.profitability) {
              const prof = s.metrics.profitability;
              if (prof.grossMargin) allResolvedMetricIds.add('gross_margin');
              if (prof.operatingMargin) allResolvedMetricIds.add('operating_margin');
              if (prof.netMargin) allResolvedMetricIds.add('net_margin');
              if (prof.grossProfit) allResolvedMetricIds.add('gross_profit');
              if (prof.operatingIncome) allResolvedMetricIds.add('operating_income');
              if (prof.netIncome) allResolvedMetricIds.add('net_income');
              if (prof.ebitda) allResolvedMetricIds.add('ebitda');
              if (prof.ebitdaMargin) allResolvedMetricIds.add('ebitda_margin');
            }
            if (s?.metrics?.revenue) {
              allResolvedMetricIds.add('revenue');
              allResolvedMetricIds.add('net_sales');
            }
          }
        }

        // From narrative chunks that reference specific metrics
        for (const n of narratives) {
          if (n.metadata?.metricsReferenced) {
            for (const ref of n.metadata.metricsReferenced) {
              allResolvedMetricIds.add(ref.toLowerCase());
            }
          }
          // Uploaded doc narratives with filingType 'uploaded-document' contain metric data
          if (n.metadata?.filingType === 'uploaded-document' || n.metadata?.sectionType === 'uploaded-document') {
            // Check content for margin/profitability keywords
            const content = (n.content || '').toLowerCase();
            if (content.includes('gross margin') || content.includes('gross profit')) allResolvedMetricIds.add('gross_margin');
            if (content.includes('operating margin')) allResolvedMetricIds.add('operating_margin');
            if (content.includes('net margin') || content.includes('ni margin')) allResolvedMetricIds.add('net_margin');
            if (content.includes('revenue') || content.includes('net sales')) allResolvedMetricIds.add('revenue');
            if (content.includes('ebitda')) allResolvedMetricIds.add('ebitda');
          }
        }

        // Filter out "unresolved" metrics that were actually fulfilled by other sources
        // Also suppress qualitative concepts (sentiment, risk, outlook) when narratives
        // are available — the LLM synthesizes these from narrative context, not from
        // structured metric lookups.
        const qualitativeConcepts = new Set([
          'management_sentiment', 'sentiment', 'risk_factors', 'risk',
          'outlook', 'guidance', 'management_commentary', 'management_tone',
          'competitive_position', 'market_share', 'growth_drivers',
          'advertising_profitability', 'advertising_revenue', 'advertising_business',
          'profitability_outlook', 'segment_profitability', 'business_outlook',
        ]);
        const trulyUnresolved = unresolved.filter(u => {
          // Already resolved by another source?
          if (allResolvedMetricIds.has(u.canonical_id?.toLowerCase()) ||
              allResolvedMetricIds.has(u.original_query?.toLowerCase())) {
            return false;
          }
          // Qualitative concept with narratives available? LLM handles it.
          const queryLower = (u.original_query || '').toLowerCase().replace(/[^a-z]/g, '_');
          const canonicalLower = (u.canonical_id || '').toLowerCase();
          if (narratives.length > 0 && (qualitativeConcepts.has(queryLower) || qualitativeConcepts.has(canonicalLower))) {
            this.logger.log(`🔍 Suppressing degradation for qualitative concept "${u.original_query}" — narratives available`);
            return false;
          }
          // Also suppress compound qualitative concepts (e.g. "advertising_profitability")
          const qualitativeKeywords = ['outlook', 'profitability', 'sentiment', 'risk', 'guidance', 'commentary', 'business', 'advertising', 'segment'];
          if (narratives.length > 0 && qualitativeKeywords.some(kw => canonicalLower.includes(kw) || queryLower.includes(kw))) {
            this.logger.log(`🔍 Suppressing degradation for qualitative keyword match "${u.original_query}" — narratives available`);
            return false;
          }
          return true;
        });

        this.logger.log(
          `🔍 Degradation check: ${unresolved.length} initially unresolved, ${allResolvedMetricIds.size} resolved by all sources, ${trulyUnresolved.length} truly unresolved`,
        );

        const degradationMsg = this.responseEnrichment.buildUnresolvedMessage(trulyUnresolved);
        if (degradationMsg) {
          this.logger.log(`⚠️ ${trulyUnresolved.length} truly unresolved metric(s) — appending degradation message`);
          answer = answer ? `${answer}\n\n${degradationMsg}` : degradationMsg;
        }
      }

      // Append missing ticker data message if some tickers lacked data
      if (missingTickerMessage) {
        answer = answer ? `${answer}\n\n${missingTickerMessage}` : missingTickerMessage;
      }

      // Generate citations from metrics when none exist, or ensure uploaded doc citations are included.
      // IMPORTANT: We do NOT append source reference text (e.g. "[N] ticker ...") to the answer.
      // The frontend's renderMarkdownWithCitations has a fallback that renders a styled "Sources"
      // section from the citations array when no inline [N] markers are found. Appending [N] to
      // the answer causes `marked` to interpret them as link references, breaking clickable links.
      // ALWAYS ensure SEC metric citations exist alongside any narrative citations.
      if (metrics.length > 0) {
        const secMetrics = metrics.filter(
          (m: any) => m.filingType !== 'uploaded-document'
        );
        if (secMetrics.length > 0) {
          const metricCitations = this.buildMetricCitations(secMetrics);
          const existingKeys = new Set(
            (citations || []).map((c: any) => `${c.ticker}-${c.filingType}-${c.fiscalPeriod}`)
          );
          const newCitations = metricCitations.filter((c: any) =>
            !existingKeys.has(`${c.ticker}-${c.filingType}-${c.fiscalPeriod}`)
          );
          if (newCitations.length > 0) {
            const nextNum = (citations || []).length > 0
              ? Math.max(...citations.map((c: any) => c.number || c.citationNumber || 0)) + 1
              : 1;
            newCitations.forEach((c: any, i: number) => {
              c.number = nextNum + i;
              c.citationNumber = nextNum + i;
            });
            citations = [...(citations || []), ...newCitations];
          }
        }
      }
      if (citations && citations.length > 0 && metrics.length > 0) {
        // Ensure uploaded doc metrics are represented in citations
        // Check by both sourceType AND filename to avoid duplicates
        const existingUploadedFiles = new Set(
          citations
            .filter((c: any) => c.sourceType === 'UPLOADED_DOC' || c.type === 'uploaded_document')
            .map((c: any) => c.filename || c.fileName || ''),
        );
        const uploadedDocMetrics = metrics.filter(
          (m: any) => m.filingType === 'uploaded-document' && m.fileName && !existingUploadedFiles.has(m.fileName),
        );
        if (uploadedDocMetrics.length > 0) {
          const nextNum = Math.max(...citations.map((c: any) => c.number || c.citationNumber || 0)) + 1;
          const uploadCitations = this.buildUploadedDocCitations(uploadedDocMetrics, nextNum);
          citations = [...citations, ...uploadCitations];
        }
      }

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
          uploadedDocChunks: uploadedDocChunks.length,
          usedBedrockKB: !!process.env.BEDROCK_KB_ID,
          usedClaudeGeneration: !!usage,
          hybridProcessing: true,
          fromCache: false,
          modelTier: optimizationDecisions.modelTier,
          parallelExecution: optimizationDecisions.parallelExecution,
          optimizationDecisions: optimizationDecisions.reasoning,
          sessionDocsUnavailable,
        },
      };

      this.logger.log(
        `✅ Hybrid query complete: ${metrics.length} metrics + ${narratives.length} narratives + ${userDocChunks.length} user docs + ${uploadedDocChunks.length} uploaded doc chunks (${latency}ms)`,
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

      // ── Deduplicate metrics before visualization ─────────────────────
      // Multiple sources (structured retrieval, uploaded docs, QUL engine,
      // computed metrics) can produce the same (ticker, fiscalPeriod,
      // normalizedMetric) tuple. Keep the one with the highest confidence.
      {
        const metricMap = new Map<string, any>();
        for (const m of metrics) {
          const key = `${(m.ticker || '').toUpperCase()}|${m.fiscalPeriod || ''}|${(m.normalizedMetric || '').toLowerCase()}`;
          const existing = metricMap.get(key);
          if (!existing || (m.confidenceScore ?? 0) > (existing.confidenceScore ?? 0)) {
            metricMap.set(key, m);
          }
        }
        const before = metrics.length;
        metrics = [...metricMap.values()];
        if (metrics.length < before) {
          this.logger.log(`🧹 Deduplicated metrics: ${before} → ${metrics.length}`);
        }
        // Also update the response object so downstream consumers see deduped metrics
        if (response.metrics) {
          response.metrics = metrics.length > 0 ? metrics : undefined;
        }
      }

      // Phase 2 (Post-LLM): Enrich response with visualization
      const enrichedResponse = this.responseEnrichment.enrichResponse(response, intent, metrics, computedSummary);

      // Cache the enriched response
      if (optimizationDecisions.useCache && optimizationDecisions.cacheKey) {
        const ttl = this.performanceOptimizer.getCacheTTL(intent);
        const ticker = Array.isArray(intent.ticker) ? intent.ticker[0] : intent.ticker;
        this.performanceOptimizer.cacheQuery(
          optimizationDecisions.cacheKey,
          enrichedResponse,
          ttl,
          ticker
        );
        this.logger.log(`💾 Response cached with TTL ${ttl}s`);
      }

      return enrichedResponse;
    } catch (error) {
      this.logger.error(`❌ Error processing hybrid query: ${error.message}`);
      throw error;
    } finally {
      // Always release the lock, even on error
      this.backgroundEnrichment?.markQueryEnd();
    }
  }

  // ── Sub-Query Execution (Req 14.1) ───────────────────────────────────

  /**
   * Execute each sub-query through the standard retrieval pipeline
   * and collect results. If a sub-query fails, log a warning and
   * continue with the remaining sub-queries.
   */
  private async executeSubQueries(
    decomposed: DecomposedQuery,
    parentIntent: QueryIntent,
    options?: { tenantId?: string; ticker?: string },
  ): Promise<SubQueryResult[]> {
    const results: SubQueryResult[] = [];

    for (const subQuery of decomposed.subQueries) {
      try {
        // Route each sub-query through the standard pipeline
        const subPlan = await this.queryRouter.route(
          subQuery,
          options?.tenantId,
          options?.ticker,
        );
        const subIntent = await this.queryRouter.getIntent(
          subQuery,
          options?.tenantId,
          options?.ticker,
        );

        let subMetrics: MetricResult[] = [];
        let subNarratives: any[] = [];

        if (subPlan.useStructured && subPlan.structuredQuery) {
          const result = await this.structuredRetriever.retrieve(
            subPlan.structuredQuery,
          );
          subMetrics = result.metrics;
        }

        if (subPlan.useSemantic && subPlan.semanticQuery) {
          const result = await this.semanticRetriever.retrieveWithContext(
            subPlan.semanticQuery,
          );
          subNarratives = result.narratives;
        }

        const classificationInput: ResponseClassificationInput = {
          intent: subIntent,
          metrics: subMetrics,
          narratives: subNarratives,
          computedResults: [],
        };

        results.push({
          subQuery,
          metrics: subMetrics,
          narratives: subNarratives,
          computedResults: [],
          responseType: classifyResponseType(classificationInput),
        });

        this.logger.log(
          `✅ Sub-query "${subQuery.substring(0, 50)}…" → ${subMetrics.length} metrics, ${subNarratives.length} narratives`,
        );
      } catch (error) {
        // Error handling: log warning and continue with remaining sub-queries
        this.logger.warn(
          `⚠️ Sub-query failed: "${subQuery.substring(0, 50)}…" — ${error.message}`,
        );
      }
    }

    // If all sub-queries failed, log a warning (caller will handle fallback)
    if (results.length === 0 && decomposed.subQueries.length > 0) {
      this.logger.warn(
        `⚠️ All ${decomposed.subQueries.length} sub-queries failed — falling back to single-intent`,
      );
    }

    return results;
  }

  // ── Bounded Retrieval Loop helpers (Req 13.1–13.6) ──────────────────

  /**
   * Check whether retrieval is complete.
   * Complete when every requested ticker has at least one metric result
   * AND narrative needs are met (Req 13.2).
   */
  private isRetrievalComplete(
    intent: QueryIntent,
    metrics: MetricResult[],
    narratives: ChunkResult[],
  ): boolean {
    // Check all requested tickers have at least one metric
    const requestedTickers: string[] = Array.isArray(intent.ticker)
      ? intent.ticker
      : intent.ticker
        ? [intent.ticker]
        : [];

    if (requestedTickers.length > 0) {
      const tickersWithMetrics = new Set(
        metrics.map((m) => m.ticker?.toUpperCase()),
      );
      const allTickersCovered = requestedTickers.every((t) =>
        tickersWithMetrics.has(t.toUpperCase()),
      );
      if (!allTickersCovered) return false;
    }

    // If narrative is needed, check narratives array is non-empty
    if (intent.needsNarrative && narratives.length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Build a replanner prompt asking the LLM what additional data is needed (Req 13.3).
   */
  private buildReplanPrompt(
    query: string,
    intent: QueryIntent,
    metrics: MetricResult[],
    narratives: ChunkResult[],
  ): string {
    const requestedTickers: string[] = Array.isArray(intent.ticker)
      ? intent.ticker
      : intent.ticker
        ? [intent.ticker]
        : [];

    const tickersWithMetrics = new Set(
      metrics.map((m) => m.ticker?.toUpperCase()),
    );
    const missingTickers = requestedTickers.filter(
      (t) => !tickersWithMetrics.has(t.toUpperCase()),
    );

    const foundMetricNames = [...new Set(metrics.map((m) => m.normalizedMetric))];
    const requestedMetrics = intent.metrics ?? [];
    const missingMetrics = requestedMetrics.filter(
      (rm) => !foundMetricNames.some((fm) => fm.toLowerCase().includes(rm.toLowerCase())),
    );

    return [
      'You are a financial data retrieval planner.',
      `Original query: "${query}"`,
      '',
      'Data retrieved so far:',
      `- Metrics found: ${foundMetricNames.join(', ') || 'none'}`,
      `- Tickers with data: ${[...tickersWithMetrics].join(', ') || 'none'}`,
      `- Tickers missing data: ${missingTickers.join(', ') || 'none'}`,
      `- Missing metrics: ${missingMetrics.join(', ') || 'none'}`,
      `- Narratives found: ${narratives.length}`,
      `- Narrative needed: ${intent.needsNarrative}`,
      '',
      'Determine what additional data is needed to fully answer the query.',
      'Respond with ONLY a JSON object (no markdown, no explanation):',
      '{ "additionalMetrics": [], "additionalTickers": [], "additionalSections": [], "done": boolean }',
      '',
      'Set "done": true if the data already collected is sufficient.',
    ].join('\n');
  }

  /**
   * Parse the replanner LLM response (Req 13.4).
   * On parse failure → returns done: true to exit the loop safely.
   */
  private parseReplanResult(response: string): {
    additionalMetrics?: string[];
    additionalTickers?: string[];
    additionalSections?: string[];
    done: boolean;
  } {
    try {
      // Strip markdown code fences if present
      const cleaned = response.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        additionalMetrics: Array.isArray(parsed.additionalMetrics) ? parsed.additionalMetrics : undefined,
        additionalTickers: Array.isArray(parsed.additionalTickers) ? parsed.additionalTickers : undefined,
        additionalSections: Array.isArray(parsed.additionalSections) ? parsed.additionalSections : undefined,
        done: !!parsed.done,
      };
    } catch {
      this.logger.warn('Replanner response parse failed — exiting retrieval loop');
      return { done: true };
    }
  }

  /**
   * Merge additional retrieval results with existing data (Req 13.5).
   * Deduplicates metrics by ticker + normalizedMetric + fiscalPeriod.
   */
  private mergeRetrievalResults(
    existing: { metrics: any[]; narratives: any[] },
    additional: { metrics: any[]; narratives: any[] },
  ): { metrics: any[]; narratives: any[] } {
    // Deduplicate metrics by ticker+metric+period
    const metricKey = (m: any) =>
      `${(m.ticker || '').toUpperCase()}|${(m.normalizedMetric || '').toLowerCase()}|${m.fiscalPeriod || ''}`;

    const seen = new Set<string>(existing.metrics.map(metricKey));
    const mergedMetrics = [...existing.metrics];
    for (const m of additional.metrics) {
      const key = metricKey(m);
      if (!seen.has(key)) {
        seen.add(key);
        mergedMetrics.push(m);
      }
    }

    // Narratives: simple concat (no dedup needed — content varies)
    const mergedNarratives = [...existing.narratives, ...additional.narratives];

    return { metrics: mergedMetrics, narratives: mergedNarratives };
  }

  // ── QUL Phase 2: Build legacy-compatible intent + plan from QueryUnderstanding ──

  /**
   * Convert QUL QueryUnderstanding → legacy QueryIntent format.
   * This bridges the QUL output into the existing RAG pipeline without
   * requiring changes to every downstream consumer.
   */
  private buildIntentFromQUL(qul: QueryUnderstanding, rawQuery: string): QueryIntent {
    // Map QUL intent → legacy QueryType
    const intentToType: Record<string, 'structured' | 'semantic' | 'hybrid'> = {
      METRIC_LOOKUP: 'structured',
      METRIC_TREND: 'structured',
      METRIC_COMPARISON: 'structured',
      NARRATIVE_SEARCH: 'semantic',
      SEGMENT_ANALYSIS: 'semantic',
      CROSS_TRANSCRIPT: 'semantic',
      HYBRID_ANALYSIS: 'hybrid',
      RED_FLAG_DETECTION: 'hybrid',
      PROVOCATION: 'hybrid',
      MANAGEMENT_ASSESSMENT: 'semantic',
      DEAL_ANALYSIS: 'hybrid',
      DEAL_COMPARISON: 'hybrid',
      PEER_SCREENING: 'structured',
      IC_MEMO_GENERATION: 'hybrid',
      DOCUMENT_INTAKE: 'semantic',
      UPLOADED_DOC_QUERY: 'semantic',
      CLARIFICATION_NEEDED: 'hybrid',
      INVALID: 'hybrid',
    };

    let type = intentToType[qul.intent] || 'hybrid';

    // For PE/cross-domain queries with uploaded entities, force hybrid
    // so both uploaded_doc_rag and structured_db paths activate
    const hasUploadedEntity = qul.entities.some(e => e.entityType === 'uploaded_entity');
    if (hasUploadedEntity || qul.domain === 'cross_domain' || qul.domain === 'private_equity') {
      type = 'hybrid';
    }

    // Extract tickers from QUL entities (only public companies have tickers)
    const tickers = qul.entities
      .filter(e => e.ticker)
      .map(e => e.ticker!);
    const ticker: string | string[] | undefined =
      tickers.length > 1 ? tickers :
      tickers.length === 1 ? tickers[0] :
      undefined;

    // Map QUL temporal scope → legacy period fields
    let period: string | undefined;
    let periodType: PeriodType | undefined;
    let periodStart: string | undefined;
    let periodEnd: string | undefined;

    if (qul.temporalScope) {
      switch (qul.temporalScope.type) {
        case 'latest':
          periodType = 'latest';
          break;
        case 'specific_period':
          period = qul.temporalScope.periods?.[0];
          periodType = period?.startsWith('Q') ? 'quarterly' : 'annual';
          break;
        case 'range':
          periodType = 'range';
          periodStart = qul.temporalScope.rangeStart;
          periodEnd = qul.temporalScope.rangeEnd;
          break;
        case 'trailing':
        case 'all_available':
          periodType = 'range';
          break;
      }
    }

    // Extract metric hints from QUL subQueries
    const metrics: string[] = [];
    if (qul.subQueries && qul.subQueries.length > 0) {
      for (const sq of qul.subQueries) {
        if (sq.metric) metrics.push(sq.metric);
      }
    }

    return {
      type,
      ticker,
      metrics: metrics.length > 0 ? metrics : undefined,
      period,
      periodType,
      periodStart,
      periodEnd,
      needsNarrative: ['semantic', 'hybrid'].includes(type) ||
        ['NARRATIVE_SEARCH', 'SEGMENT_ANALYSIS', 'CROSS_TRANSCRIPT', 'HYBRID_ANALYSIS',
         'RED_FLAG_DETECTION', 'MANAGEMENT_ASSESSMENT', 'UPLOADED_DOC_QUERY',
         'DEAL_ANALYSIS', 'DEAL_COMPARISON', 'MANAGEMENT_ASSESSMENT'].includes(qul.intent),
      needsComparison: qul.needsPeerComparison || qul.intent === 'METRIC_COMPARISON' || qul.intent === 'DEAL_COMPARISON',
      needsComputation: ['METRIC_LOOKUP', 'METRIC_TREND', 'METRIC_COMPARISON'].includes(qul.intent) ||
        this.isRevenueClassMetric(metrics),
      needsTrend: qul.intent === 'METRIC_TREND' ||
        (qul.intent === 'METRIC_LOOKUP' && this.isRevenueClassMetric(metrics)),
      needsPeerComparison: qul.needsPeerComparison,
      suggestedChart: qul.suggestedChart || null,
      confidence: qul.confidence,
      originalQuery: qul.normalizedQuery || rawQuery,
    };
  }

  /**
   * Check if any of the resolved metrics are revenue-class (revenue, net_sales, etc.)
   * Used to auto-trigger trend/growth computation for common financial queries.
   */
  private isRevenueClassMetric(metrics: string[]): boolean {
    const REVENUE_CLASS = new Set([
      'revenue', 'net_sales', 'total_revenue', 'net_revenue',
      'net_income', 'gross_profit', 'operating_income', 'ebitda',
      'free_cash_flow', 'operating_cash_flow',
    ]);
    return metrics.some(m => REVENUE_CLASS.has(m.toLowerCase()));
  }

  /**
   * Build a RetrievalPlan from QUL data, using the MetricRegistry for metric resolution.
   * This replaces queryRouter.route() when QUL data is available.
   */
  private async buildPlanFromQUL(
    qul: QueryUnderstanding,
    intent: QueryIntent,
    tenantId?: string,
  ): Promise<RetrievalPlan> {
    const tickers = qul.entities
      .filter(e => e.ticker)
      .map(e => e.ticker!);

    const paths = qul.suggestedRetrievalPaths || [];
    const useStructured = paths.includes('structured_db') || paths.includes('formula_engine') || paths.includes('peer_comparison');
    let useSemantic = paths.includes('semantic_kb') || paths.includes('earnings_transcript') || paths.includes('uploaded_doc_rag') || paths.includes('deal_library');

    // For concept-level queries (e.g. "profitability"), always enable semantic
    // so uploaded doc vector search fires alongside structured retrieval.
    // Concept queries have metric hints that resolve via concept registry but
    // may also have narrative context in uploaded analyst reports.
    const hasConcept = qul.subQueries?.some(sq => sq.metricType === 'concept') ||
      qul.intent === 'HYBRID_ANALYSIS' ||
      qul.intent === 'METRIC_COMPARISON';
    if (hasConcept && !useSemantic) {
      this.logger.log(`🧩 Concept/comparison query detected — enabling semantic path for uploaded doc retrieval`);
      useSemantic = true;
    }

    // Always enable semantic for METRIC_LOOKUP queries too.
    // "What is the revenue for AMZN?" benefits from MD&A context about
    // revenue drivers, segment breakdown, and management commentary.
    // 3 lightweight narrative chunks transform a bare number into analysis.
    if (qul.intent === 'METRIC_LOOKUP' && !useSemantic) {
      this.logger.log(`📊 Metric lookup query — enabling lightweight semantic for MD&A context`);
      useSemantic = true;
    }

    // For PE/cross-domain, always enable both paths so uploaded doc sources activate
    const hasUploadedEntity = qul.entities.some(e => e.entityType === 'uploaded_entity');
    const isCrossDomain = qul.domain === 'cross_domain';
    const isPE = qul.domain === 'private_equity';

    // If QUL didn't suggest any paths, or PE/cross-domain, enable both.
    // Also always enable semantic when comparison is needed (to pull narratives for both tickers).
    const isComparison = intent.needsComparison || intent.needsPeerComparison || tickers.length > 1;
    const effectiveUseStructured = paths.length === 0 ? true : useStructured || (isCrossDomain && tickers.length > 0) || isComparison;
    const effectiveUseSemantic = paths.length === 0 ? true : useSemantic || hasUploadedEntity || isPE || isComparison;

    // Resolve metrics through MetricRegistryService (same as queryRouter does)
    const metricHints = intent.metrics || [];
    let resolvedMetrics: any[] = [];
    // Track which metric hints were expanded via concept resolution so we
    // can suppress the "I don't have a metric mapped" degradation message.
    const conceptExpandedHints = new Set<string>();

    if (metricHints.length > 0 && tickers.length > 0) {
      // Only resolve metrics for public companies (PE metrics come from uploaded docs)
      try {
        resolvedMetrics = this.metricRegistry?.resolveMultiple?.(metricHints, tenantId) || [];
      } catch (e) {
        this.logger.warn(`QUL metric resolution failed: ${e.message}`);
      }
    }

    // Concept resolution: try for high-level queries like "how levered?" or "profitability"
    // Fires when:
    //   (a) No metric hints at all (pure concept query), OR
    //   (b) Metric hints exist but ALL resolved to "unresolved" — the hint IS the concept name
    const allUnresolved = resolvedMetrics.length > 0 &&
      resolvedMetrics.every((r: any) => r.confidence === 'unresolved');
    const noMetricHints = metricHints.length === 0 && resolvedMetrics.length === 0;

    if ((noMetricHints || allUnresolved) && this.conceptRegistry) {
      // Try matching each unresolved metric hint as a concept, then fall back to normalizedQuery
      const conceptQueries = allUnresolved
        ? metricHints
        : [qul.normalizedQuery || ''];

      for (const cq of conceptQueries) {
        const conceptMatch = this.conceptRegistry.matchConcept(cq);
        if (conceptMatch) {
          this.logger.log(`🧩 QUL concept match: "${cq}" → ${conceptMatch.concept_id} (${conceptMatch.confidence})`);
          const bundle = this.conceptRegistry.getMetricBundle(conceptMatch.concept_id);
          if (bundle) {
            const bundleMetrics = [...bundle.primary_metrics, ...bundle.secondary_metrics];
            try {
              const conceptResolved = this.metricRegistry?.resolveMultiple?.(bundleMetrics, tenantId) || [];
              // Replace the unresolved metrics with the concept-expanded ones
              resolvedMetrics = conceptResolved;
              conceptExpandedHints.add(cq.toLowerCase());
              this.logger.log(`🧩 Concept bundle resolved ${conceptResolved.length} metrics from concept "${conceptMatch.concept_id}"`);
              // Also update intent.metrics so downstream knows the real metrics
              intent.metrics = bundleMetrics;
              break; // First concept match wins
            } catch (e) {
              this.logger.warn(`Concept metric resolution failed: ${e.message}`);
            }
          }
        }
      }

      // If no concept matched from hints, try the full normalized query
      if (resolvedMetrics.every((r: any) => r.confidence === 'unresolved') && allUnresolved) {
        const fallbackMatch = this.conceptRegistry.matchConcept(qul.normalizedQuery || '');
        if (fallbackMatch) {
          this.logger.log(`🧩 QUL concept fallback match: "${qul.normalizedQuery}" → ${fallbackMatch.concept_id}`);
          const bundle = this.conceptRegistry.getMetricBundle(fallbackMatch.concept_id);
          if (bundle) {
            const bundleMetrics = [...bundle.primary_metrics, ...bundle.secondary_metrics];
            try {
              const conceptResolved = this.metricRegistry?.resolveMultiple?.(bundleMetrics, tenantId) || [];
              resolvedMetrics = conceptResolved;
              for (const h of metricHints) conceptExpandedHints.add(h.toLowerCase());
              intent.metrics = bundleMetrics;
              this.logger.log(`🧩 Concept fallback resolved ${conceptResolved.length} metrics from "${fallbackMatch.concept_id}"`);
            } catch (e) {
              this.logger.warn(`Concept fallback resolution failed: ${e.message}`);
            }
          }
        }
      }
    }

    // Determine filing types from temporal scope
    const filingTypes: DocumentType[] = intent.periodType === 'annual' ? ['10-K'] :
      intent.periodType === 'quarterly' ? ['10-Q'] : ['10-K', '10-Q'];

    // For PE-only queries with no public tickers, skip structured query
    // NOTE: Even when tickers=[] here, the caller (query()) may override
    // with options.tickers AFTER this method returns. So we build the
    // structured query skeleton with empty tickers and let the caller patch it.
    // This ensures structured retrieval fires when tickers arrive via override.
    const shouldBuildStructured = effectiveUseStructured;

    const structuredQuery: StructuredQuery | undefined = shouldBuildStructured ? {
      tickers,
      metrics: resolvedMetrics,
      period: intent.period,
      periodType: intent.periodType,
      periodStart: intent.periodStart,
      periodEnd: intent.periodEnd,
      filingTypes,
      includeComputed: intent.needsComputation,
    } : undefined;

    // For the semantic query, prefer the original natural language phrasing
    // (rawQuery) over the terse normalizedQuery.  The normalized form is
    // optimised for structured DB lookups (canonical IDs) but embeds poorly
    // against narrative text in Bedrock KB and uploaded doc chunks.
    const semanticQueryText = qul.rawQuery || qul.normalizedQuery || intent.originalQuery;

    const semanticQuery: SemanticQuery | undefined = effectiveUseSemantic ? {
      query: semanticQueryText,
      tickers: tickers.length > 0 ? tickers : undefined,
      documentTypes: filingTypes,
      sectionTypes: undefined,
      period: intent.period,
      maxResults: intent.needsComparison || intent.needsTrend ? 10 : (hasUploadedEntity ? 8 : 5),
    } : undefined;

    this.logger.log(`📋 QUL Plan: structured=${shouldBuildStructured}, semantic=${effectiveUseSemantic}, ` +
      `domain=${qul.domain}, uploadedEntity=${hasUploadedEntity}, tickers=[${tickers.join(',')}] (tickers may be patched by caller)`);

    return {
      useStructured: shouldBuildStructured,
      useSemantic: effectiveUseSemantic,
      structuredQuery,
      semanticQuery,
    };
  }

  /**
   * QUL → Deterministic Engine Integration (Spec §8.2-8.3)
   *
   * Routes metric hints from QUL subQueries through the three-layer
   * metric resolution stack:
   *   Flow A: atomic → StructuredRetriever (PostgreSQL)
   *   Flow B: computed → FormulaResolutionService → Python /calculate
   *   Flow C: extracted → DocumentMetricExtractor (uploaded docs)
   *
   * Returns additional metrics to merge into the main retrieval results.
   */
  private async executeQULMetricResolution(
    qul: QueryUnderstanding,
    intent: QueryIntent,
    tenantId?: string,
  ): Promise<any[]> {
    if (!this.metricRegistry || !qul.subQueries || qul.subQueries.length === 0) {
      return [];
    }

    const additionalMetrics: any[] = [];

    for (const sq of qul.subQueries) {
      if (!sq.metric) continue;

      // Resolve the entity for this sub-query
      const entity = typeof sq.entity === 'string'
        ? qul.entities.find(e => e.ticker === sq.entity || e.name === sq.entity) || qul.primaryEntity
        : sq.entity || qul.primaryEntity;

      if (!entity) continue;

      // Step 1: Resolve metric hint through MetricRegistry
      const resolution = this.metricRegistry.resolve(sq.metric, tenantId);

      if (!resolution || resolution.confidence === 'unresolved') {
        this.logger.debug(`QUL metric "${sq.metric}" unresolved — skipping deterministic path`);
        continue;
      }

      // Step 2: Route by entity type + metric type
      const isUploadedEntity = entity.entityType === 'uploaded_entity';
      const metricType = sq.metricType || resolution.type || 'atomic';

      if (isUploadedEntity && entity.documentId && this.documentMetricExtractor) {
        // Flow C: PE document-extracted metric (§8.3 Flow C)
        try {
          const result = await this.documentMetricExtractor.extractAndCompute(
            entity.documentId,
            sq.metric,
            tenantId || '',
            sq.temporal || qul.temporalScope,
          );
          if (result.value != null) {
            additionalMetrics.push({
              ticker: entity.name || entity.ticker || 'TargetCo',
              normalizedMetric: result.canonical_id,
              rawLabel: result.display_name,
              value: result.value,
              rawValue: String(result.value),
              fiscalPeriod: Object.values(result.resolved_inputs)[0]?.period || '',
              periodType: 'actual',
              filingType: 'uploaded-document',
              statementType: 'uploaded',
              confidenceScore: 0.85,
              source: `Computed from uploaded document (${result.formula || 'direct extraction'})`,
              _documentComputed: true,
              _formula: result.formula,
              _resolvedInputs: result.resolved_inputs,
              _caveats: result.caveats,
              _metricType: metricType,
            });
            this.logger.log(`📐 §8.3C: ${result.display_name} = ${result.value} (extracted from doc)`);
          }
        } catch (e) {
          this.logger.warn(`§8.3C extraction failed for "${sq.metric}": ${e.message}`);
        }
      } else if (entity.ticker && metricType === 'computed' && this.formulaResolution) {
        // Flow B: Computed metric via FormulaResolutionService (§8.3 Flow B)
        try {
          const period = sq.temporal?.periods?.[0] || intent.period || 'latest';
          const computed = await this.formulaResolution.resolveComputed(
            resolution,
            entity.ticker,
            period,
          );
          if (computed && computed.value != null) {
            additionalMetrics.push({
              ticker: entity.ticker,
              normalizedMetric: resolution.canonical_id,
              rawLabel: resolution.display_name || resolution.canonical_id,
              value: computed.value,
              rawValue: String(computed.value),
              fiscalPeriod: computed.resolved_inputs ? Object.values(computed.resolved_inputs)[0]?.period || period : period,
              periodType: 'actual',
              filingType: '10-K',
              statementType: 'computed',
              confidenceScore: 0.95,
              source: `Formula: ${resolution.formula || resolution.canonical_id}`,
              _formula: resolution.formula,
              _resolvedInputs: computed.resolved_inputs,
              _metricType: 'computed',
            });
            this.logger.log(`📐 §8.3B: ${resolution.canonical_id} = ${computed.value} (computed for ${entity.ticker})`);
          }
        } catch (e) {
          this.logger.warn(`§8.3B computation failed for "${sq.metric}" on ${entity.ticker}: ${e.message}`);
        }
      }
      // Flow A (atomic) is handled by the normal StructuredRetriever path — no extra work needed
    }

    return additionalMetrics;
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

    // No data found — build a helpful response asynchronously is not possible here,
    // so return a descriptive message based on what we know from the intent
    return this.buildNoDataMessage(intent);
  }

  /**
   * Build a helpful "no data" message that tells the user what went wrong
   * and suggests alternatives based on the intent
   */
  private buildNoDataMessage(intent: QueryIntent): string {
    const lines: string[] = [];
    const tickers = Array.isArray(intent.ticker) ? intent.ticker : intent.ticker ? [intent.ticker] : [];
    const ticker = tickers[0] || 'the requested company';
    const metricNames = (intent.metrics || []).map(m => this.getMetricDisplayName(m)).join(', ') || 'the requested metrics';
    const period = intent.period || '';

    lines.push(`### No Data Available\n`);
    lines.push(`We couldn't find **${metricNames}** for **${ticker}**${period ? ` in **${period}**` : ''}.\n`);
    lines.push(`This typically means:\n`);
    lines.push(`- The filing for that period hasn't been ingested yet`);
    lines.push(`- The metric may be stored under a different name in the SEC filing`);
    lines.push(`- The company may not report this specific line item\n`);
    lines.push(`**Try these alternatives:**`);
    lines.push(`- Ask without a specific year: _"What is the cash and cash equivalents for ${ticker}?"_`);
    lines.push(`- Ask for the latest data: _"What is the latest ${metricNames} for ${ticker}?"_`);
    lines.push(`- Try a different period: _"What is the ${metricNames} for ${ticker} in FY2024?"_`);

    return lines.join('\n');
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
            if (i < displayValues.length - 1 && metric.value != null && typeof metric.value === 'number') {
              const prevValue = displayValues[i + 1].value;
              if (prevValue != null && typeof prevValue === 'number' && prevValue !== 0) {
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
          const value = metric.value != null
            ? this.formatValue(metric.value, metric.normalizedMetric)
            : (metric.rawValue || 'N/A');
          lines.push(`${value} (${metric.fiscalPeriod || ''}, ${metric.filingType})`);
          
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
            
            if (chunk.sourceType === 'USER_UPLOAD') {
              // Uploaded document from Instant RAG session
              const filename = chunk.filename || 'Uploaded Document';
              lines.push(`- [Uploaded Document: ${filename}] (${score}% relevance)`);
            } else {
              // SEC filing from Bedrock KB
              const fiscalPeriod = chunk.metadata?.fiscalPeriod || 'Period Unknown';
              const filingType = chunk.metadata?.filingType || 'Filing';
              const chunkTicker = chunk.metadata?.ticker || ticker;
              const pageInfo = chunk.metadata?.pageNumber ? `, Page ${chunk.metadata.pageNumber}` : '';
              lines.push(`- [SEC Filing: ${chunkTicker} ${filingType}] ${fiscalPeriod}${pageInfo} (${score}% relevance)`);
            }
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
      const ticker = narrative.metadata?.ticker || narrative.ticker || 'Uploaded Documents';
      const sectionType = narrative.metadata?.sectionType || (narrative.sourceType === 'USER_UPLOAD' ? 'uploaded_document' : 'unknown');

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
      'general': 'General Information',
      'uploaded_document': 'Uploaded Documents',
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
    if (value === null || value === undefined || typeof value !== 'number') return String(value ?? 'N/A');
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
        // Handle uploaded document metrics (Source 1)
        if (metric.filingType === 'uploaded-document' && metric.fileName) {
          const key = `upload-metric-${metric.fileName}-${metric.normalizedMetric}`;
          if (!seen.has(key)) {
            seen.add(key);
            sources.push({
              type: 'uploaded_document',
              sourceType: 'UPLOADED_DOC',
              filename: metric.fileName,
              ticker: metric.ticker || '',
              filingType: 'Uploaded Document',
              fiscalPeriod: metric.fiscalPeriod || '',
            });
          }
          continue;
        }

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
        // Handle uploaded document sources (from Instant RAG session or document intelligence)
        if (narrative.sourceType === 'USER_UPLOAD' || narrative.sourceType === 'UPLOADED_DOC') {
          const key = `upload-${narrative.filename || narrative.source?.documentId || narrative.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            sources.push({
              type: 'uploaded_document',
              sourceType: 'UPLOADED_DOC',
              filename: narrative.filename || narrative.source?.location || 'Uploaded Document',
              ticker: narrative.metadata?.ticker || '',
              filingType: 'Uploaded Document',
              pageNumber: narrative.metadata?.pageNumber,
            });
          }
          continue;
        }

        // Only add if we have valid metadata (fiscalPeriod is optional)
        if (narrative.metadata?.ticker && narrative.metadata?.filingType) {
          const fiscalPeriod = narrative.metadata.fiscalPeriod || 'unknown';
          const key = `${narrative.metadata.ticker}-${narrative.metadata.filingType}-${fiscalPeriod}`;
          if (!seen.has(key)) {
            seen.add(key);
            sources.push({
              type: 'narrative',
              sourceType: 'SEC_FILING',
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

  /**
   * Build metric citations from structured metrics
   * Used when no narrative citations exist but we have metric data
   */
  private buildMetricCitations(metrics: MetricResult[]): any[] {
      const seen = new Set<string>();
      const citations: any[] = [];
      let num = 1;

      for (const metric of metrics) {
        // Handle uploaded document metrics — generate UPLOADED_DOC citations
        if ((metric as any).filingType === 'uploaded-document' && (metric as any).fileName) {
          const key = `upload-${(metric as any).fileName}-${metric.normalizedMetric}`;
          if (seen.has(key)) continue;
          seen.add(key);

          citations.push({
            number: num,
            citationNumber: num,
            type: 'uploaded_document',
            sourceType: 'UPLOADED_DOC',
            filename: (metric as any).fileName,
            ticker: metric.ticker || '',
            filingType: 'Uploaded Document',
            fiscalPeriod: metric.fiscalPeriod || '',
            section: 'Uploaded Document',
            excerpt: `${metric.rawLabel || metric.normalizedMetric}: ${this.formatValueForCitation(metric.value)}${metric.fiscalPeriod ? ` (${metric.fiscalPeriod})` : ''} — from ${(metric as any).fileName}`,
            relevanceScore: (metric as any).confidenceScore || 0.9,
            pageNumber: (metric as any).sourcePage || null,
            documentId: (metric as any).documentId || null,
          });
          num++;
          continue;
        }

        // SEC filing metrics
        const key = `${metric.ticker}-${metric.filingType}-${metric.fiscalPeriod}`;
        if (seen.has(key)) continue;
        seen.add(key);

        citations.push({
          number: num,
          citationNumber: num,
          type: 'sec_filing',
          sourceType: 'SEC_FILING',
          ticker: metric.ticker,
          filingType: metric.filingType,
          fiscalPeriod: metric.fiscalPeriod,
          section: metric.statementType || 'Financial Statements',
          excerpt: `${metric.rawLabel}: ${this.formatValueForCitation(metric.value)} (${metric.fiscalPeriod})`,
          relevanceScore: metric.confidenceScore,
        });
        num++;
      }

      return citations;
    }

  /**
   * Build citations specifically for uploaded document metrics.
   * Used when HybridSynthesis returns SEC citations but misses uploaded doc sources.
   */
  private buildUploadedDocCitations(uploadedDocMetrics: any[], startNum: number): any[] {
    const seen = new Set<string>();
    const citations: any[] = [];
    let num = startNum;

    for (const metric of uploadedDocMetrics) {
      const key = `${metric.fileName}-${metric.normalizedMetric}`;
      if (seen.has(key)) continue;
      seen.add(key);

      citations.push({
        number: num,
        citationNumber: num,
        type: 'uploaded_document',
        sourceType: 'UPLOADED_DOC',
        filename: metric.fileName,
        ticker: metric.ticker || '',
        filingType: 'Uploaded Document',
        fiscalPeriod: metric.fiscalPeriod || '',
        section: 'Uploaded Document',
        excerpt: `${metric.rawLabel || metric.normalizedMetric}: ${metric.rawValue || this.formatValueForCitation(metric.value)}${metric.fiscalPeriod ? ` (${metric.fiscalPeriod})` : ''} — from ${metric.fileName}`,
        relevanceScore: metric.confidenceScore || 0.9,
        pageNumber: metric.sourcePage || null,
        documentId: metric.documentId || null,
      });
      num++;
    }

    return citations;
  }



  /**
   * Format value for citation display
   */
  private formatValueForCitation(value: number): string {
    if (value === null || value === undefined || typeof value !== 'number') return String(value ?? 'N/A');
    if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
    if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return `${value.toFixed(2)}`;
  }

  /**
   * Search uploaded documents (Sources 1+2 from Spec §7.1).
   * This is a top-level concern that fires on EVERY query where uploaded
   * documents exist, regardless of decomposition or routing path.
   * Returns { metrics, narratives, chunkCount } to merge into any path.
   */
  private async searchUploadedDocs(
    query: string,
    intent: QueryIntent,
    options?: {
      tenantId?: string;
      ticker?: string;
      dealId?: string;
      understanding?: QueryUnderstanding;
    },
  ): Promise<{ metrics: any[]; narratives: any[]; chunkCount: number }> {
    const result = { metrics: [] as any[], narratives: [] as any[], chunkCount: 0 };

    if (!this.documentIndexing || !options?.tenantId) {
      return result;
    }

    try {
      // Extract tickers from intent to scope uploaded doc search
      const intentTickers: string[] = Array.isArray(intent.ticker)
        ? intent.ticker
        : intent.ticker ? [intent.ticker] : [];

      // Source 1: Query uploaded doc extractions
      const uploadedDocMetricKeys = new Set<string>(intent.metrics || []);
      const queryLower = query.toLowerCase();
      const uploadedDocKeyMap: Record<string, string[]> = {
        price_target: ['price target', 'target price', 'pt', 'analyst'],
        rating: ['rating', 'recommendation', 'buy', 'sell', 'hold', 'overweight', 'underweight', 'analyst'],
        revenue: ['revenue', 'sales', 'top line', 'top-line'],
        ebitda: ['ebitda'],
        net_profit: ['net profit', 'net income', 'earnings', 'bottom line'],
        eps: ['eps', 'earnings per share'],
        gross_margin: ['gross margin', 'profitability', 'margin profile', 'margins'],
        operating_margin: ['operating margin', 'profitability', 'margin profile'],
        net_margin: ['net margin', 'profitability', 'profit margin'],
      };
      for (const [key, triggers] of Object.entries(uploadedDocKeyMap)) {
        if (triggers.some(t => queryLower.includes(t))) {
          uploadedDocMetricKeys.add(key);
        }
      }

      if (uploadedDocMetricKeys.size > 0) {
        const metricKeysArray = [...uploadedDocMetricKeys];

        // Query per-ticker if we know which tickers are requested, otherwise query all
        const tickersToQuery = intentTickers.length > 0 ? intentTickers : [undefined];
        for (const ticker of tickersToQuery) {
          this.logger.log(`📎 Source 1: Querying uploaded doc metrics (tenant-scoped, ticker=${ticker || 'all'}) for keys: [${metricKeysArray.join(', ')}]`);
          const uploadedMetrics = await this.documentIndexing.queryMetrics(
            metricKeysArray,
            options.tenantId,
            options.dealId || '',
            { companyTicker: ticker },
          );
          if (uploadedMetrics.length > 0) {
            this.logger.log(`📎 Source 1: Found ${uploadedMetrics.length} uploaded doc metrics for ${ticker || 'all tickers'}`);
            for (const um of uploadedMetrics) {
              result.metrics.push({
                ticker: um.companyTicker || ticker || options.ticker || '',
                normalizedMetric: um.metricKey,
                rawLabel: um.metricKey,
                value: um.numericValue != null ? um.numericValue : null,
                rawValue: um.rawValue,
                fiscalPeriod: um.period || '',
                periodType: um.isEstimate ? 'estimate' : 'actual',
                filingType: 'uploaded-document',
                statementType: 'uploaded',
                statementDate: null,
                filingDate: null,
                sourcePage: um.pageNumber,
                confidenceScore: um.confidence,
                source: um.source,
                isEstimate: um.isEstimate,
                fileName: um.fileName,
              });
            }
          }
        } // end for ticker
      } // end if uploadedDocMetricKeys

      // Source 2: Vector search across uploaded doc chunks (tenant-scoped, ticker-filtered)
      const semanticSearchQuery = options?.understanding?.rawQuery || query;
      // For multi-ticker queries, search per-ticker to avoid cross-contamination
      // For no-ticker queries, search all
      const vectorTickersToQuery = intentTickers.length > 0 ? intentTickers : [undefined];
      let allVectorResults: any[] = [];
      for (const vTicker of vectorTickersToQuery) {
        this.logger.log(`📎 Source 2: Vector search (tenant-scoped, ticker=${vTicker || 'all'}, query="${semanticSearchQuery.substring(0, 80)}")`);
        const vectorResults = await this.documentIndexing.searchChunks(
          semanticSearchQuery,
          options.tenantId,
          options.dealId || '',
          { topK: 5, minScore: 0.3, companyTicker: vTicker },
        );
        allVectorResults.push(...vectorResults);
      }
      if (allVectorResults.length > 0) {
        const boilerplatePatterns = [
          /\b(disclaimer|legal notice|forward[- ]looking statements?|safe harbor|not investment advice)\b/i,
          /\b(past performance .* not .* guarantee|no representation or warranty)\b/i,
          /\b(securities act|regulation [sd]|form adv|sec filing|prospectus)\b/i,
          /\b(all rights reserved|confidential.*proprietary|do not distribute)\b/i,
        ];
        const filteredResults = allVectorResults.filter(r => {
          const text = (r.content || '').substring(0, 500);
          const boilerplateHits = boilerplatePatterns.filter(p => p.test(text)).length;
          if (boilerplateHits >= 2) {
            this.logger.debug(`📎 Filtered boilerplate chunk (score=${r.score.toFixed(3)}): "${text.substring(0, 80)}..."`);
            return false;
          }
          return true;
        });

        this.logger.log(
          `📎 Source 2: Found ${allVectorResults.length} uploaded doc chunks, ${filteredResults.length} after boilerplate filter (top score: ${allVectorResults[0].score.toFixed(3)})`,
        );
        result.chunkCount = filteredResults.length;

        const uploadNarratives = filteredResults.map(r => ({
          content: r.content,
          score: r.score,
          sourceType: 'UPLOADED_DOC',
          metadata: {
            ticker: r.companyTicker || options.ticker || '',
            sectionType: r.sectionType || 'uploaded-document',
            filingType: 'uploaded-document',
            pageNumber: r.pageNumber,
          },
          source: {
            location: r.fileName,
            type: 'uploaded-document',
            documentId: r.documentId,
          },
          filename: r.fileName,
        }));
        result.narratives = uploadNarratives;
      }

      // Source 3: Long-context-fallback — when vector search returns nothing,
      // fetch raw text from S3 for docs that have no chunks/embeddings.
      // This ensures uploaded analyst reports (like DBS) are always referenced.
      if (result.narratives.length === 0 && this.documentIndexing) {
        const tickerForFallback = intentTickers[0] || options?.ticker;
        this.logger.log(`📄 Source 3: Vector search empty — checking long-context-fallback docs (ticker=${tickerForFallback || 'all'})`);
        const fallbackDocs = await this.documentIndexing.getLongContextFallbackText(
          options.tenantId,
          { companyTicker: tickerForFallback, maxDocs: 2, maxCharsPerDoc: 6000 },
        );
        if (fallbackDocs.length > 0) {
          this.logger.log(`📄 Source 3: Retrieved ${fallbackDocs.length} long-context-fallback docs`);
          for (const doc of fallbackDocs) {
            result.narratives.push({
              content: doc.content,
              score: 0.90, // High relevance — user explicitly uploaded this
              sourceType: 'UPLOADED_DOC',
              metadata: {
                ticker: doc.companyTicker || options.ticker || '',
                sectionType: 'uploaded-document',
                filingType: 'uploaded-document',
              },
              source: {
                location: doc.fileName,
                type: 'uploaded-document',
                documentId: doc.documentId,
              },
              filename: doc.fileName,
            });
          }
          result.chunkCount = fallbackDocs.length;
        }
      }
    } catch (error) {
      this.logger.warn(`⚠️ Uploaded doc search failed: ${error.message}`);
    }

    return result;
  }
}

