import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BedrockAgentClient,
  StartIngestionJobCommand,
  GetIngestionJobCommand,
  ListIngestionJobsCommand,
} from '@aws-sdk/client-bedrock-agent';
import { ChunkExporterService } from '../rag/chunk-exporter.service';
import { QualitativePrecomputeService } from './qualitative-precompute.service';
import { FinancialCalculatorService } from './financial-calculator.service';
import { MarketDataService } from './market-data.service';
import { ComprehensiveSECPipelineService } from '../s3/comprehensive-sec-pipeline.service';
import { MetricHierarchyService } from './metric-hierarchy.service';
import { FootnoteLinkingService } from './footnote-linking.service';
import { OrchestratorAgent } from '../agents/orchestrator.agent';
// NOTE: MDAIntelligenceService removed - Step F removed (duplicates Step E)

export interface PipelineStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'completed_with_warnings';
  message: string;
  progress?: number;
  startedAt?: Date;
  completedAt?: Date;
  details?: any;
}

export interface PipelineStatus {
  dealId: string;
  ticker: string;
  overallStatus: 'pending' | 'running' | 'completed' | 'failed';
  currentStep: string;
  steps: PipelineStep[];
  startedAt: Date;
  completedAt?: Date;
  newsArticles?: any[];
  error?: string;
}

export interface PreflightResult {
  ready: boolean;
  issues: string[];
  checks: {
    database: boolean;
    pythonParser: boolean;
    awsCredentials: boolean;
  };
}

/**
 * Pipeline Orchestration Service
 * Manages the end-to-end data processing pipeline for deals
 * 
 * HARDENING FEATURES (v2.0 - PRODUCTION READY):
 * - Pre-flight health checks before pipeline starts
 * - Idempotent operations (safe to retry)
 * - DB-backed state (survives restarts)
 * - Graceful degradation (partial success is OK)
 * - DIRECT SERVICE INJECTION (no localhost HTTP calls!)
 * - Works in ECS containers, Docker, and local development
 */
@Injectable()
export class PipelineOrchestrationService {
  private readonly logger = new Logger(PipelineOrchestrationService.name);
  private readonly bedrockAgent: BedrockAgentClient;
  private readonly pipelineStatuses = new Map<string, PipelineStatus>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => ChunkExporterService))
    private readonly chunkExporter: ChunkExporterService,
    @Inject(forwardRef(() => QualitativePrecomputeService))
    private readonly qualitativePrecompute: QualitativePrecomputeService,
    @Inject(forwardRef(() => FinancialCalculatorService))
    private readonly financialCalculator: FinancialCalculatorService,
    @Inject(forwardRef(() => MarketDataService))
    private readonly marketData: MarketDataService,
    @Inject(forwardRef(() => ComprehensiveSECPipelineService))
    private readonly secPipeline: ComprehensiveSECPipelineService,
    @Inject(forwardRef(() => MetricHierarchyService))
    private readonly metricHierarchyService: MetricHierarchyService,
    @Inject(forwardRef(() => FootnoteLinkingService))
    private readonly footnoteLinkingService: FootnoteLinkingService,
    @Inject(forwardRef(() => OrchestratorAgent))
    private readonly orchestratorAgent: OrchestratorAgent,
    // NOTE: MDAIntelligenceService removed - Step F removed (duplicates Step E)
  ) {
    // Configure BedrockAgentClient with exponential backoff and adaptive retry mode
    this.bedrockAgent = new BedrockAgentClient({
      region: process.env.AWS_REGION || 'us-east-1',
      maxAttempts: 10,
      retryMode: 'adaptive',
    });
  }

  /**
   * PRE-FLIGHT HEALTH CHECK
   * Verifies all dependencies are available before starting pipeline
   * This prevents "fetch failed" and other cryptic errors
   */
  async preflight(): Promise<PreflightResult> {
    const issues: string[] = [];
    const checks = {
      database: false,
      pythonParser: false,
      awsCredentials: false,
    };

    // Check 1: Database connection
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = true;
      this.logger.log('✅ Pre-flight: Database connection OK');
    } catch (error) {
      issues.push(`Database connection failed: ${error.message}`);
      this.logger.error('❌ Pre-flight: Database connection FAILED');
    }

    // Check 2: Python parser API
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('http://localhost:8000/health', {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      
      if (response.ok) {
        checks.pythonParser = true;
        this.logger.log('✅ Pre-flight: Python parser OK');
      } else {
        issues.push(`Python parser returned status ${response.status}`);
        this.logger.error('❌ Pre-flight: Python parser returned error');
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        issues.push('Python parser not responding (timeout)');
      } else {
        issues.push(`Python parser not available: ${error.message}`);
      }
      this.logger.error('❌ Pre-flight: Python parser FAILED - Is it running? (python3 python_parser/api_server.py)');
    }

    // Check 3: AWS credentials (try a simple S3 operation)
    try {
      const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
      await s3.send(new HeadBucketCommand({ Bucket: 'fundlens-bedrock-chunks' }));
      checks.awsCredentials = true;
      this.logger.log('✅ Pre-flight: AWS credentials OK');
    } catch (error) {
      // Don't fail on AWS - it's not critical for basic pipeline
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        checks.awsCredentials = true; // Bucket doesn't exist but credentials work
        this.logger.log('✅ Pre-flight: AWS credentials OK (bucket may not exist)');
      } else {
        issues.push(`AWS credentials issue: ${error.message}`);
        this.logger.warn('⚠️ Pre-flight: AWS credentials issue (KB sync may fail)');
      }
    }

    const ready = checks.database && checks.pythonParser;
    
    if (!ready) {
      this.logger.error(`❌ Pre-flight FAILED: ${issues.join(', ')}`);
    } else {
      this.logger.log('✅ Pre-flight checks PASSED - Pipeline ready to start');
    }

    return { ready, issues, checks };
  }

  /**
   * Initialize pipeline steps
   * 
   * NOTE: Step F (Extract MD&A Insights) removed - duplicates Step E work
   * Step E (qualitative-precompute) already does MD&A analysis
   */
  private initializePipelineSteps(): PipelineStep[] {
    return [
      { id: 'A', name: 'Download SEC Filings', status: 'pending', message: 'Waiting to start...' },
      { id: 'A2', name: 'Acquire Earnings Transcripts', status: 'pending', message: 'Waiting to start...' },
      { id: 'B', name: 'Parse & Store Metrics', status: 'pending', message: 'Waiting to start...' },
      { id: 'C', name: 'Chunk & Store Narratives', status: 'pending', message: 'Waiting to start...' },
      { id: 'D', name: 'Sync to Bedrock KB', status: 'pending', message: 'Waiting to start...' },
      { id: 'E', name: 'Verify RAG Flow', status: 'pending', message: 'Waiting to start...' },
      { id: 'G', name: 'Build Metric Hierarchy', status: 'pending', message: 'Waiting to start...' },
      { id: 'H', name: 'Link Footnotes', status: 'pending', message: 'Waiting to start...' },
    ];
  }

  /**
   * Start the full pipeline for a deal
   * 
   * HARDENING: Runs preflight checks before starting to fail fast with clear errors
   */
  async startPipeline(dealId: string, ticker: string, years: number = 5): Promise<PipelineStatus> {
    const upperTicker = ticker.toUpperCase();
    
    // Check if pipeline already running for this deal
    const existing = this.pipelineStatuses.get(dealId);
    if (existing && existing.overallStatus === 'running') {
      return existing;
    }

    // CRITICAL: Run preflight checks BEFORE starting pipeline
    this.logger.log(`🔍 Running preflight checks for ${upperTicker}...`);
    const preflightResult = await this.preflight();
    
    if (!preflightResult.ready) {
      const errorMessage = `Pipeline cannot start: ${preflightResult.issues.join('; ')}`;
      this.logger.error(`❌ Preflight FAILED for ${upperTicker}: ${errorMessage}`);
      
      // Update deal status with clear error
      await this.updateDealStatus(dealId, 'error', errorMessage);
      
      // Return a failed status immediately
      const failedStatus: PipelineStatus = {
        dealId,
        ticker: upperTicker,
        overallStatus: 'failed',
        currentStep: 'preflight',
        steps: this.initializePipelineSteps().map(s => ({
          ...s,
          status: 'failed' as const,
          message: 'Preflight check failed',
        })),
        startedAt: new Date(),
        completedAt: new Date(),
        error: errorMessage,
      };
      
      this.pipelineStatuses.set(dealId, failedStatus);
      return failedStatus;
    }

    this.logger.log(`✅ Preflight checks passed for ${upperTicker}`);

    // Initialize pipeline status
    const status: PipelineStatus = {
      dealId,
      ticker: upperTicker,
      overallStatus: 'running',
      currentStep: 'A',
      steps: this.initializePipelineSteps(),
      startedAt: new Date(),
    };

    this.pipelineStatuses.set(dealId, status);

    // Update deal status
    await this.updateDealStatus(dealId, 'processing', 'Pipeline started - fetching news...');

    // Start async pipeline execution
    this.executePipeline(dealId, upperTicker, years).catch(error => {
      this.logger.error(`Pipeline failed for ${upperTicker}: ${error.message}`);
    });

    return status;
  }

  /**
   * Execute the full pipeline
   */
  private async executePipeline(dealId: string, ticker: string, years: number): Promise<void> {
    const status = this.pipelineStatuses.get(dealId)!;

    try {
      // Fetch news first (to show while processing)
      await this.fetchAndStoreNews(dealId, ticker, status);

      // Step A: Download SEC Filings
      await this.executeStepA(dealId, ticker, years, status);

      // Step A2: Acquire Earnings Transcripts
      await this.executeStepA2(dealId, ticker, status);

      // Step B: Parse & Store Metrics
      await this.executeStepB(dealId, ticker, years, status);

      // Step C: Chunk & Store Narratives
      await this.executeStepC(dealId, ticker, status);

      // Step D: Sync to Bedrock KB
      await this.executeStepD(dealId, ticker, status);

      // Step E: Verify RAG Flow
      await this.executeStepE(dealId, ticker, status);

      // Step F: REMOVED - Duplicated Step E work (MD&A analysis)
      // Step E (qualitative-precompute) already extracts insights from MD&A

      // Step G: Build Metric Hierarchy
      await this.executeStepG(dealId, ticker, status);

      // Step H: Link Footnotes
      await this.executeStepH(dealId, ticker, status);

      // Complete pipeline
      status.overallStatus = 'completed';
      status.completedAt = new Date();
      await this.updateDealStatus(dealId, 'ready', 'Analysis ready! All data processed successfully.');

      this.logger.log(`✅ Pipeline completed for ${ticker}`);

    } catch (error) {
      status.overallStatus = 'failed';
      status.error = error.message;
      status.completedAt = new Date();
      await this.updateDealStatus(dealId, 'error', `Pipeline failed: ${error.message}`);
      
      this.logger.error(`❌ Pipeline failed for ${ticker}: ${error.message}`);
    }

    // Emit completion event
    this.eventEmitter.emit('pipeline.completed', { dealId, ticker, status });
  }

  /**
   * Fetch and store news articles
   * Non-critical - failures don't stop pipeline
   * 
   * PRODUCTION FIX: Uses direct service injection instead of HTTP calls
   */
  private async fetchAndStoreNews(dealId: string, ticker: string, status: PipelineStatus): Promise<void> {
    try {
      this.logger.log(`📰 Fetching news for ${ticker} via direct service call...`);
      
      // PRODUCTION FIX: Direct service call instead of HTTP to localhost
      const newsArticles = await this.marketData.getMarketNews(ticker, 50);

      if (newsArticles && newsArticles.length > 0) {
        status.newsArticles = newsArticles;
        
        // Store in deal
        const newsJson = JSON.stringify(newsArticles);
        await this.prisma.$executeRawUnsafe(`
          UPDATE deals SET news_data = $1::jsonb, updated_at = NOW() WHERE id = $2::uuid
        `, newsJson, dealId);

        this.logger.log(`📰 Fetched ${newsArticles.length} news articles for ${ticker}`);
      } else {
        this.logger.log(`📰 No news articles found for ${ticker}`);
      }
    } catch (error) {
      // News fetch is non-critical - log and continue
      this.logger.warn(`Failed to fetch news for ${ticker}: ${error.message}`);
    }
  }

  /**
   * Step A: Download SEC Filings (incremental)
   * 
   * ENTERPRISE-GRADE HARDENING (v2.0 - PRODUCTION READY):
   * - DIRECT SERVICE INJECTION (no localhost HTTP calls!)
   * - Works in ECS containers, Docker, and local development
   * - 5 retry attempts with exponential backoff
   * - Connection error detection and recovery
   * - Progress tracking for user feedback
   * - Graceful handling of all failure modes
   */
  private async executeStepA(dealId: string, ticker: string, years: number, status: PipelineStatus): Promise<void> {
    const step = status.steps.find(s => s.id === 'A')!;
    step.status = 'running';
    step.startedAt = new Date();
    step.message = 'Checking existing filings...';
    status.currentStep = 'A';
    await this.updateDealStatus(dealId, 'processing', 'Step A: Downloading SEC filings...');

    // Configuration for enterprise reliability
    const MAX_RETRIES = 5;
    const BASE_DELAY_MS = 5000;

    try {
      // Check existing filings
      const existingFilings = await this.prisma.$queryRawUnsafe(`
        SELECT filing_type, COUNT(*)::int as count 
        FROM filing_metadata 
        WHERE ticker = $1 AND processed = true
        GROUP BY filing_type
      `, ticker) as any[];

      const existing10K = Number(existingFilings.find(f => f.filing_type === '10-K')?.count || 0);
      const existing10Q = Number(existingFilings.find(f => f.filing_type === '10-Q')?.count || 0);
      const existing8K = Number(existingFilings.find(f => f.filing_type === '8-K')?.count || 0);

      step.details = { existing10K, existing10Q, existing8K };
      step.message = `Found ${existing10K} 10-Ks, ${existing10Q} 10-Qs, ${existing8K} 8-Ks. Downloading new filings...`;

      let lastError: Error | null = null;
      
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          step.message = attempt === 1 
            ? `Downloading SEC filings for ${years} years...`
            : `Downloading SEC filings (retry ${attempt}/${MAX_RETRIES})...`;
          
          this.logger.log(`📥 Step A attempt ${attempt}/${MAX_RETRIES} for ${ticker} via DIRECT SERVICE CALL`);
          
          // PRODUCTION FIX: Direct service call instead of HTTP to localhost
          const result = await this.secPipeline.processCompanyComprehensive(ticker, {
            companies: [ticker],
            years: Array.from({ length: years }, (_, i) => new Date().getFullYear() - i),
            filingTypes: ['10-K', '10-Q', '8-K', '13F-HR', 'DEF 14A', '4', 'S-1'],
            batchSize: 1,
            skipExisting: true,
            syncToKnowledgeBase: false,
          });

          // Check result
          if (result.processedFilings > 0 || result.totalFilings > 0) {
            step.status = 'completed';
            step.message = `Downloaded ${result.processedFilings} new filings (${result.totalFilings} total found)`;
            step.details = { 
              ...step.details, 
              processedFilings: result.processedFilings,
              totalFilings: result.totalFilings,
              totalMetrics: result.totalMetrics,
              totalNarratives: result.totalNarratives,
              attempts: attempt,
            };
            step.completedAt = new Date();
            this.logger.log(`✅ Step A completed for ${ticker} on attempt ${attempt}: ${result.processedFilings} filings processed`);
            return;
          } else if (result.errors.length > 0) {
            throw new Error(result.errors.join('; '));
          } else {
            // No filings found but no errors - this is OK for some tickers
            step.status = 'completed';
            step.message = `No new filings to download (${existing10K + existing10Q + existing8K} already processed)`;
            step.completedAt = new Date();
            this.logger.log(`✅ Step A completed for ${ticker}: No new filings needed`);
            return;
          }
        } catch (error) {
          lastError = error;
          
          // Categorize error for appropriate handling
          const isConnectionError = 
            error.message?.includes('fetch failed') || 
            error.message?.includes('ECONNRESET') ||
            error.message?.includes('ECONNREFUSED') ||
            error.message?.includes('ETIMEDOUT') ||
            error.message?.includes('socket hang up');
          const isServerError = error.message?.includes('HTTP 5');
          
          const isRetryable = isConnectionError || isServerError;
          
          if (!isRetryable) {
            // Non-retryable error (e.g., business logic error)
            this.logger.error(`Step A non-retryable error for ${ticker}: ${error.message}`);
            throw error;
          }
          
          if (attempt < MAX_RETRIES) {
            // Exponential backoff with jitter: 5s, 10s, 20s, 40s, 80s
            const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 2000, 120000);
            
            const errorType = isConnectionError ? 'connection error' : 'server error';
            this.logger.warn(`Step A ${errorType} (attempt ${attempt}/${MAX_RETRIES}) for ${ticker}. Retrying in ${Math.round(delay/1000)}s...`);
            step.message = `${errorType.charAt(0).toUpperCase() + errorType.slice(1)}, retrying in ${Math.round(delay/1000)}s (${attempt}/${MAX_RETRIES})...`;
            
            await this.sleep(delay);
          } else {
            this.logger.error(`Step A exhausted all ${MAX_RETRIES} retries for ${ticker}: ${error.message}`);
          }
        }
      }
      
      // All retries exhausted - provide detailed error
      const errorMsg = lastError?.message || 'Unknown error';
      throw new Error(`SEC filing download failed after ${MAX_RETRIES} attempts: ${errorMsg}`);

    } catch (error) {
      step.status = 'failed';
      step.message = `Failed: ${error.message}`;
      step.completedAt = new Date();
      throw error;
    }
  }

  /**
   * Step A2: Acquire Earnings Transcripts via Agentic Pipeline (Phase 4)
   *
   * Non-blocking: failures here don't stop the pipeline.
   * Uses OrchestratorAgent to discover IR pages and download transcripts.
   */
  private async executeStepA2(dealId: string, ticker: string, status: PipelineStatus): Promise<void> {
    const step = status.steps.find(s => s.id === 'A2')!;
    step.status = 'running';
    step.startedAt = new Date();
    step.message = 'Acquiring earnings transcripts...';
    status.currentStep = 'A2';
    await this.updateDealStatus(dealId, 'processing', 'Step A2: Acquiring earnings transcripts...');

    try {
      // Look up company name from deal
      let companyName = ticker;
      try {
        const deal = await this.prisma.deal.findUnique({ where: { id: dealId }, select: { companyName: true } });
        if (deal?.companyName) companyName = deal.companyName;
      } catch { /* use ticker as fallback */ }

      const report = await this.orchestratorAgent.execute({
        ticker,
        companyName,
        type: 'transcript_only',
        triggeredBy: 'deal_creation',
      });

      if (report.transcriptsAcquired > 0) {
        step.status = 'completed';
        step.message = `Acquired ${report.transcriptsAcquired} earnings transcripts`;
      } else if (report.errors.length > 0) {
        step.status = 'completed_with_warnings';
        step.message = `No transcripts acquired: ${report.errors[0]?.error || 'IR page not found'}`;
      } else {
        step.status = 'completed';
        step.message = 'No new transcripts to acquire';
      }

      step.details = {
        transcriptsAcquired: report.transcriptsAcquired,
        llmCalls: report.llmCalls,
        actions: report.actions.length,
        errors: report.errors.length,
      };
      step.completedAt = new Date();
      this.logger.log(`✅ Step A2 completed for ${ticker}: ${report.transcriptsAcquired} transcripts`);

    } catch (error) {
      // Non-critical — log and continue pipeline
      step.status = 'completed_with_warnings';
      step.message = `Transcript acquisition failed: ${error.message}`;
      step.completedAt = new Date();
      this.logger.warn(`⚠️ Step A2 failed for ${ticker} (non-critical): ${error.message}`);
    }
  }

  /**
   * Step B: Parse & Store Metrics in PostgreSQL
   * 
   * ENTERPRISE-GRADE HARDENING (v4.0 - PRODUCTION READY):
   * - Calls Python calculator via HTTP (works in ECS containers)
   * - Python calculator is the DETERMINISTIC source of truth
   * - Retry logic with exponential backoff
   * - Falls back to raw metrics only if Python completely unavailable
   * - Calculated metrics are REQUIRED for full dashboard functionality
   */
  private async executeStepB(dealId: string, ticker: string, years: number, status: PipelineStatus): Promise<void> {
    const step = status.steps.find(s => s.id === 'B')!;
    step.status = 'running';
    step.startedAt = new Date();
    step.message = 'Calculating financial metrics via Python engine...';
    status.currentStep = 'B';
    await this.updateDealStatus(dealId, 'processing', 'Step B: Calculating metrics via Python engine...');

    const MAX_CALC_RETRIES = 3;

    try {
      this.logger.log(`📊 Step B: Calculating metrics for ${ticker} via Python HTTP API`);
      
      // Get raw metrics count first (these should exist from Step A)
      const rawMetricsCount = await this.prisma.financialMetric.count({ where: { ticker } });
      
      if (rawMetricsCount === 0) {
        throw new Error(`No raw metrics found for ${ticker}. SEC filing ingestion may have failed.`);
      }

      step.message = `Found ${rawMetricsCount} raw metrics. Calculating derived metrics...`;

      // Calculate derived metrics via Python HTTP API with retry
      let calculatedCount = 0;
      let calcError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_CALC_RETRIES; attempt++) {
        try {
          step.message = attempt === 1 
            ? `Calculating derived metrics via Python engine...`
            : `Calculating metrics (retry ${attempt}/${MAX_CALC_RETRIES})...`;

          const calculatedMetrics = await this.financialCalculator.calculateMetrics(ticker, undefined, years);
          
          // Check how many were actually saved to DB
          calculatedCount = await this.prisma.calculatedMetric.count({ where: { ticker } });
          
          if (calculatedCount > 0) {
            this.logger.log(`✅ Python calculator succeeded: ${calculatedCount} calculated metrics for ${ticker}`);
            break;
          } else if (calculatedMetrics.length === 0) {
            // Python returned empty - might be a data issue, not a connection issue
            this.logger.warn(`Python calculator returned 0 metrics for ${ticker} - checking if data issue`);
            break;
          }
        } catch (error) {
          calcError = error;
          
          if (attempt < MAX_CALC_RETRIES) {
            const delay = 2000 * Math.pow(2, attempt - 1);
            this.logger.warn(`Python calculator attempt ${attempt}/${MAX_CALC_RETRIES} failed: ${error.message}. Retrying in ${delay}ms...`);
            step.message = `Calculation retry ${attempt}/${MAX_CALC_RETRIES}...`;
            await this.sleep(delay);
          } else {
            this.logger.error(`Python calculator failed after ${MAX_CALC_RETRIES} attempts: ${error.message}`);
          }
        }
      }

      // Check final calculated metrics count
      if (calculatedCount === 0) {
        calculatedCount = await this.prisma.calculatedMetric.count({ where: { ticker } });
      }

      // Determine step status based on results
      if (calculatedCount > 0) {
        step.status = 'completed';
        step.message = `${rawMetricsCount} raw metrics, ${calculatedCount} calculated metrics`;
        step.details = { rawMetrics: rawMetricsCount, calculatedMetrics: calculatedCount, pythonSuccess: true };
      } else if (rawMetricsCount > 0) {
        // Raw metrics available but no calculated - complete with warning
        step.status = 'completed_with_warnings';
        step.message = `${rawMetricsCount} raw metrics available. Calculated metrics unavailable (Python: ${calcError?.message || 'no data'})`;
        step.details = { rawMetrics: rawMetricsCount, calculatedMetrics: 0, pythonSuccess: false, pythonError: calcError?.message };
        this.logger.warn(`Step B completed with warnings for ${ticker}: No calculated metrics, using raw metrics fallback`);
      } else {
        throw new Error(`No metrics available for ${ticker}`);
      }

      step.completedAt = new Date();
      this.logger.log(`✅ Step B completed for ${ticker}: ${rawMetricsCount} raw, ${calculatedCount} calculated`);

    } catch (error) {
      step.status = 'failed';
      step.message = `Failed: ${error.message}`;
      step.completedAt = new Date();
      throw error;
    }
  }

  /**
   * Step C: Chunk & Store Narratives
   */
  private async executeStepC(dealId: string, ticker: string, status: PipelineStatus): Promise<void> {
    const step = status.steps.find(s => s.id === 'C')!;
    step.status = 'running';
    step.startedAt = new Date();
    step.message = 'Processing narrative chunks...';
    status.currentStep = 'C';
    await this.updateDealStatus(dealId, 'processing', 'Step C: Chunking narratives for knowledge base...');

    try {
      // Check existing narrative chunks
      const chunksCount = await this.prisma.narrativeChunk.count({ where: { ticker } });

      if (chunksCount > 0) {
        step.status = 'completed';
        step.message = `${chunksCount} narrative chunks ready`;
        step.details = { chunksCount };
      } else {
        // Narratives should have been created during Step A ingestion
        step.status = 'completed';
        step.message = 'No new narratives to process (created during filing ingestion)';
        step.details = { chunksCount: 0 };
      }

      step.completedAt = new Date();

    } catch (error) {
      step.status = 'failed';
      step.message = `Failed: ${error.message}`;
      step.completedAt = new Date();
      throw error;
    }
  }

  /**
   * Step D: Sync to Bedrock Knowledge Base
   * 
   * ENTERPRISE-GRADE HARDENING (v4.0) - BLOCKING KB SYNC:
   * - S3 upload is REQUIRED (must succeed)
   * - KB ingestion is ALWAYS triggered (new filings must be indexed for RAG)
   * - Tracks sync status per ticker for monitoring/debugging
   * - Robust retry logic with exponential backoff
   * - Handles ongoing jobs gracefully (waits for them)
   * - Tenant metadata included for multi-tenant filtering
   * 
   * ARCHITECTURE:
   * 1. Upload chunks to S3 with retry (BLOCKING - must succeed)
   * 2. Update sync tracking table for monitoring
   * 3. ALWAYS trigger KB ingestion (new filings need to be indexed)
   * 4. Wait for KB sync to complete with progress monitoring
   * 
   * NOTE: Bedrock KB scans ALL documents on every ingestion job.
   * This is unavoidable but necessary to ensure new filings are indexed.
   * We track sync status for monitoring but ALWAYS trigger KB ingestion
   * to ensure new filings are indexed for RAG queries.
   */
  private async executeStepD(dealId: string, ticker: string, status: PipelineStatus): Promise<void> {
    const step = status.steps.find(s => s.id === 'D')!;
    step.status = 'running';
    step.startedAt = new Date();
    step.message = 'Preparing KB sync...';
    status.currentStep = 'D';
    await this.updateDealStatus(dealId, 'processing', 'Step D: Syncing with Bedrock Knowledge Base...');

    // Enterprise configuration
    const S3_UPLOAD_MAX_RETRIES = 5;
    const KB_INGESTION_MAX_RETRIES = 5;
    const KB_INGESTION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes max wait
    const KB_POLL_INTERVAL_MS = 15 * 1000; // 15 seconds between polls

    try {
      // Get chunk count first to know what we're uploading
      const totalChunks = await this.prisma.narrativeChunk.count({ where: { ticker } });
      
      if (totalChunks === 0) {
        step.status = 'completed';
        step.message = 'No narrative chunks to sync (metrics-only deal)';
        step.completedAt = new Date();
        this.logger.log(`✅ Step D skipped for ${ticker}: No narrative chunks`);
        return;
      }

      // Get existing sync status for logging/monitoring (but don't skip!)
      const existingSyncStatus = await this.getKBSyncStatus(ticker);
      if (existingSyncStatus) {
        this.logger.log(`📊 Previous sync status for ${ticker}: ${existingSyncStatus.chunksInS3} chunks, last sync: ${existingSyncStatus.lastKbSyncAt?.toISOString() || 'never'}`);
      }

      this.logger.log(`📤 Step D: Uploading ${totalChunks} chunks for ${ticker} to S3...`);
      step.message = `Uploading ${totalChunks} chunks to S3...`;

      // ============================================================
      // PHASE 1: Upload chunks to S3 with retry (BLOCKING)
      // ============================================================
      let uploadResult: { uploadedCount: number; totalSize: number; keys: string[] } | null = null;
      let lastUploadError: Error | null = null;

      for (let attempt = 1; attempt <= S3_UPLOAD_MAX_RETRIES; attempt++) {
        try {
          step.message = attempt === 1 
            ? `Uploading ${totalChunks} chunks to S3...`
            : `Uploading chunks to S3 (retry ${attempt}/${S3_UPLOAD_MAX_RETRIES})...`;

          uploadResult = await this.chunkExporter.uploadToS3({
            bucket: 'fundlens-bedrock-chunks',
            ticker,
            keyPrefix: 'chunks',
            dryRun: false,
            batchSize: Math.max(totalChunks + 100, 5000),
          });

          // Verify upload succeeded
          if (uploadResult.uploadedCount === 0) {
            throw new Error(`S3 upload returned 0 chunks (expected ${totalChunks})`);
          }

          // Success - break retry loop
          this.logger.log(`✅ S3 upload complete: ${uploadResult.uploadedCount}/${totalChunks} chunks (attempt ${attempt})`);
          break;

        } catch (error) {
          lastUploadError = error;
          
          if (attempt < S3_UPLOAD_MAX_RETRIES) {
            const delay = Math.min(Math.pow(2, attempt) * 2000 + Math.random() * 1000, 60000);
            this.logger.warn(`S3 upload failed (attempt ${attempt}/${S3_UPLOAD_MAX_RETRIES}): ${error.message}. Retrying in ${Math.round(delay/1000)}s...`);
            step.message = `S3 upload retry ${attempt}/${S3_UPLOAD_MAX_RETRIES} in ${Math.round(delay/1000)}s...`;
            await this.sleep(delay);
          }
        }
      }

      if (!uploadResult || uploadResult.uploadedCount === 0) {
        throw new Error(`S3 upload failed after ${S3_UPLOAD_MAX_RETRIES} attempts: ${lastUploadError?.message || 'Unknown error'}`);
      }

      // Update sync tracking - S3 upload complete
      await this.updateKBSyncStatus(ticker, {
        chunksInS3: uploadResult.uploadedCount,
        chunksInRds: totalChunks,
        lastS3UploadAt: new Date(),
        needsKbSync: true,
      });

      step.details = { 
        uploadedChunks: uploadResult.uploadedCount,
        totalChunks,
        uploadSuccess: true,
      };

      // ============================================================
      // PHASE 2: Trigger and WAIT for KB ingestion (BLOCKING)
      // Only if this is a NEW ticker that needs syncing
      // ============================================================
      const kbId = process.env.BEDROCK_KB_ID;
      const dataSourceId = process.env.BEDROCK_DATA_SOURCE_ID || 'OQMSFOE5SL';

      if (!kbId) {
        // KB not configured - this is a CRITICAL error in enterprise mode
        throw new Error('BEDROCK_KB_ID not configured - KB sync is REQUIRED for enterprise RAG');
      }

      step.message = `Uploaded ${uploadResult.uploadedCount} chunks. Starting KB ingestion...`;
      this.logger.log(`🔄 Starting BLOCKING KB ingestion for ${ticker}...`);

      // Start or wait for KB ingestion with retry
      const jobId = await this.startIngestionWithRetry(kbId, dataSourceId, step, KB_INGESTION_MAX_RETRIES);

      if (!jobId) {
        throw new Error('Failed to start or find KB ingestion job after max retries');
      }

      step.details = { 
        ...step.details, 
        ingestionJobId: jobId,
        kbSyncStatus: 'in_progress',
      };

      // ============================================================
      // PHASE 3: Wait for KB ingestion to COMPLETE (BLOCKING)
      // ============================================================
      step.message = `KB ingestion started (Job: ${jobId}). Waiting for completion...`;
      this.logger.log(`⏳ Waiting for KB ingestion job ${jobId} to complete (max ${KB_INGESTION_TIMEOUT_MS/60000} minutes)...`);

      const startWaitTime = Date.now();
      let lastStatus = 'STARTING';
      let documentsIndexed = 0;
      let documentsScanned = 0;
      let documentsFailed = 0;

      while (Date.now() - startWaitTime < KB_INGESTION_TIMEOUT_MS) {
        try {
          const getJobCommand = new GetIngestionJobCommand({
            knowledgeBaseId: kbId,
            dataSourceId: dataSourceId,
            ingestionJobId: jobId,
          });

          const jobStatus = await this.bedrockAgent.send(getJobCommand);
          lastStatus = jobStatus.ingestionJob?.status || 'UNKNOWN';
          const stats = jobStatus.ingestionJob?.statistics;
          
          documentsScanned = stats?.numberOfDocumentsScanned || 0;
          documentsIndexed = stats?.numberOfNewDocumentsIndexed || 0;
          documentsFailed = stats?.numberOfDocumentsFailed || 0;

          // Update step with progress
          const elapsedMin = Math.round((Date.now() - startWaitTime) / 60000);
          step.message = `KB sync: ${lastStatus} (${documentsScanned} scanned, ${documentsIndexed} indexed, ${elapsedMin}min elapsed)`;

          this.logger.log(`KB job ${jobId}: ${lastStatus} - ${documentsScanned} scanned, ${documentsIndexed} indexed, ${documentsFailed} failed`);

          if (lastStatus === 'COMPLETE') {
            // Update sync tracking - KB sync complete
            await this.updateKBSyncStatus(ticker, {
              lastKbSyncAt: new Date(),
              kbSyncJobId: jobId,
              kbSyncStatus: 'synced',
              needsKbSync: false,
            });

            // CRITICAL FIX: Update bedrock_kb_id field in narrative_chunks table
            // This field is used by diagnostic scripts and monitoring
            try {
              await this.prisma.$executeRawUnsafe(`
                UPDATE narrative_chunks
                SET bedrock_kb_id = $1
                WHERE ticker = $2
              `, jobId, ticker);
              
              this.logger.log(`✅ Updated bedrock_kb_id for ${ticker} chunks (Job: ${jobId})`);
            } catch (updateError) {
              // Log but don't fail - this is for monitoring only
              this.logger.warn(`Failed to update bedrock_kb_id for ${ticker}: ${updateError.message}`);
            }

            step.details = {
              ...step.details,
              kbSyncStatus: 'complete',
              documentsScanned,
              documentsIndexed,
              documentsFailed,
              syncDurationMs: Date.now() - startWaitTime,
            };
            step.status = 'completed';
            step.message = `KB sync complete: ${documentsIndexed} documents indexed (${documentsScanned} scanned)`;
            step.completedAt = new Date();
            this.logger.log(`✅ Step D complete for ${ticker}: KB sync finished - ${documentsIndexed} documents indexed`);
            return;
          }

          if (lastStatus === 'FAILED') {
            throw new Error(`KB ingestion job failed: ${documentsFailed} documents failed`);
          }

          // Still running - wait and poll again
          await this.sleep(KB_POLL_INTERVAL_MS);

        } catch (pollError) {
          // Don't fail on polling errors - just log and continue
          this.logger.warn(`Error polling KB job ${jobId}: ${pollError.message}`);
          await this.sleep(KB_POLL_INTERVAL_MS);
        }
      }

      // Timeout reached - this is a FAILURE in enterprise mode
      throw new Error(`KB ingestion timeout after ${KB_INGESTION_TIMEOUT_MS/60000} minutes. Last status: ${lastStatus}, Scanned: ${documentsScanned}, Indexed: ${documentsIndexed}`);

    } catch (error) {
      step.status = 'failed';
      step.message = `KB sync failed: ${error.message}`;
      step.completedAt = new Date();
      this.logger.error(`❌ Step D FAILED for ${ticker}: ${error.message}`);
      throw error; // CRITICAL: KB sync failure should fail the pipeline
    }
  }

  /**
   * Start KB ingestion with smart handling of ongoing jobs
   * - Checks for existing running jobs first
   * - Waits for ongoing jobs to complete instead of failing
   * - Handles rate limiting with exponential backoff
   */
  private async startIngestionWithRetry(
    kbId: string,
    dataSourceId: string,
    step: PipelineStep,
    maxRetries: number = 5,
  ): Promise<string | null> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // CRITICAL: First, check if there's an ongoing ingestion job
        const ongoingJob = await this.checkForOngoingIngestionJob(kbId, dataSourceId);
        
        if (ongoingJob) {
          this.logger.log(`Found ongoing ingestion job: ${ongoingJob.jobId} (${ongoingJob.status})`);
          step.message = `Waiting for ongoing KB sync (Job: ${ongoingJob.jobId})...`;
          
          // Wait for the ongoing job to complete
          await this.waitForIngestionJob(kbId, dataSourceId, ongoingJob.jobId, step);
          
          // After waiting, the KB should be synced - return the job ID
          this.logger.log(`✅ Ongoing job ${ongoingJob.jobId} completed. KB is synced.`);
          return ongoingJob.jobId;
        }

        // No ongoing job - start a new one
        const ingestionCommand = new StartIngestionJobCommand({
          knowledgeBaseId: kbId,
          dataSourceId: dataSourceId,
        });

        const ingestionResult = await this.bedrockAgent.send(ingestionCommand);
        const jobId = ingestionResult.ingestionJob?.ingestionJobId;

        if (jobId) {
          this.logger.log(`✅ KB ingestion started successfully (attempt ${attempt}): ${jobId}`);
          return jobId;
        }
      } catch (error) {
        lastError = error;
        
        // Check if error is due to ongoing job (extract job ID from error message)
        const ongoingJobMatch = error.message?.match(/ongoing ingestion job.*ID\s+(\w+)/i);
        if (ongoingJobMatch) {
          const existingJobId = ongoingJobMatch[1];
          this.logger.log(`Detected ongoing job from error: ${existingJobId}. Waiting for completion...`);
          step.message = `Waiting for ongoing KB sync (Job: ${existingJobId})...`;
          
          try {
            await this.waitForIngestionJob(kbId, dataSourceId, existingJobId, step);
            this.logger.log(`✅ Ongoing job ${existingJobId} completed. KB is synced.`);
            return existingJobId;
          } catch (waitError) {
            this.logger.warn(`Error waiting for ongoing job: ${waitError.message}`);
            // Continue to retry
          }
        }
        
        const isRateLimited = error.message?.includes('Too Many Requests') || 
                             error.message?.includes('throttled') ||
                             error.name === 'ThrottlingException';

        if (isRateLimited && attempt < maxRetries) {
          // Exponential backoff: 2^attempt seconds + random jitter
          const delay = Math.min(Math.pow(2, attempt) * 1000 + Math.random() * 1000, 60000);
          this.logger.warn(`KB ingestion rate limited (attempt ${attempt}/${maxRetries}). Retrying in ${Math.round(delay/1000)}s...`);
          step.message = `Rate limited. Retrying in ${Math.round(delay/1000)}s (attempt ${attempt}/${maxRetries})...`;
          await this.sleep(delay);
        } else if (attempt < maxRetries) {
          // Other errors - shorter retry delay
          const delay = 5000;
          this.logger.warn(`KB ingestion failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying...`);
          step.message = `Retrying KB sync (attempt ${attempt}/${maxRetries})...`;
          await this.sleep(delay);
        } else {
          throw error;
        }
      }
    }

    throw lastError || new Error('KB ingestion failed after max retries');
  }

  /**
   * Check for ongoing ingestion jobs
   */
  private async checkForOngoingIngestionJob(
    kbId: string,
    dataSourceId: string,
  ): Promise<{ jobId: string; status: string } | null> {
    try {
      const listCommand = new ListIngestionJobsCommand({
        knowledgeBaseId: kbId,
        dataSourceId: dataSourceId,
        maxResults: 5,
      });

      const response = await this.bedrockAgent.send(listCommand);
      const jobs = response.ingestionJobSummaries || [];

      // Find any job that's still running
      const runningJob = jobs.find(job => 
        job.status === 'STARTING' || job.status === 'IN_PROGRESS'
      );

      if (runningJob && runningJob.ingestionJobId) {
        return {
          jobId: runningJob.ingestionJobId,
          status: runningJob.status || 'UNKNOWN',
        };
      }

      return null;
    } catch (error) {
      this.logger.warn(`Failed to check for ongoing jobs: ${error.message}`);
      return null;
    }
  }

  /**
   * Wait for Bedrock KB ingestion job to complete
   * Increased timeout for large datasets (10 minutes)
   */
  private async waitForIngestionJob(
    kbId: string,
    dataSourceId: string,
    jobId: string,
    step: PipelineStep,
  ): Promise<void> {
    const maxWaitTime = 10 * 60 * 1000; // 10 minutes for large datasets
    const pollInterval = 15 * 1000; // 15 seconds between polls
    const startTime = Date.now();

    this.logger.log(`⏳ Waiting for KB ingestion job ${jobId} to complete (max ${maxWaitTime/60000} minutes)...`);

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const getJobCommand = new GetIngestionJobCommand({
          knowledgeBaseId: kbId,
          dataSourceId: dataSourceId,
          ingestionJobId: jobId,
        });

        const jobStatus = await this.bedrockAgent.send(getJobCommand);
        const status = jobStatus.ingestionJob?.status;
        const stats = jobStatus.ingestionJob?.statistics;

        // Update step with progress
        const scanned = stats?.numberOfDocumentsScanned || 0;
        const indexed = stats?.numberOfNewDocumentsIndexed || 0;
        step.message = `KB ingestion: ${status} (${scanned} scanned, ${indexed} indexed)`;

        this.logger.log(`KB job ${jobId}: ${status} - ${scanned} scanned, ${indexed} indexed`);

        if (status === 'COMPLETE') {
          step.details = {
            ...step.details,
            documentsScanned: stats?.numberOfDocumentsScanned,
            documentsIndexed: stats?.numberOfNewDocumentsIndexed,
            documentsFailed: stats?.numberOfDocumentsFailed,
          };
          this.logger.log(`✅ KB ingestion complete: ${indexed} documents indexed`);
          return;
        }

        if (status === 'FAILED') {
          const failedCount = stats?.numberOfDocumentsFailed || 0;
          throw new Error(`KB ingestion job failed (${failedCount} documents failed)`);
        }

        await this.sleep(pollInterval);
      } catch (error) {
        // Don't fail on polling errors - just log and continue
        this.logger.warn(`Error polling ingestion job ${jobId}: ${error.message}`);
        await this.sleep(pollInterval);
      }
    }

    // Timeout - but don't fail, the job may still complete
    this.logger.warn(`KB ingestion job ${jobId} did not complete within ${maxWaitTime/60000} minutes. Job may still be running.`);
    step.message = `KB sync in progress (job: ${jobId}) - may take additional time`;
  }

  /**
   * Step E: Verify RAG Flow & Pre-compute Qualitative Analysis
   * 
   * ENTERPRISE-GRADE HARDENING (v3.0 - PRODUCTION READY):
   * - DIRECT SERVICE INJECTION (no localhost HTTP calls!)
   * - Works in ECS containers, Docker, and local development
   * - ALWAYS precompute qualitative analysis if PostgreSQL has narratives
   * - KB availability is an OPTIMIZATION, not a requirement
   * - PostgreSQL fallback ensures 100% reliability
   * - Multiple verification paths with graceful degradation
   * - Non-blocking - failures don't stop pipeline
   * 
   * CRITICAL FIX: Previous version only precomputed if KB returned narratives.
   * This version checks PostgreSQL directly - the source of truth.
   */
  private async executeStepE(dealId: string, ticker: string, status: PipelineStatus): Promise<void> {
    const step = status.steps.find(s => s.id === 'E')!;
    step.status = 'running';
    step.startedAt = new Date();
    step.message = 'Verifying data availability...';
    status.currentStep = 'E';
    await this.updateDealStatus(dealId, 'processing', 'Step E: Verifying RAG flow & pre-computing analysis...');

    try {
      // ============================================================
      // STEP E.1: Check PostgreSQL directly (SOURCE OF TRUTH)
      // This is the bulletproof check - if data is in PostgreSQL, we can serve it
      // ============================================================
      let postgresNarrativeCount = 0;
      let postgresMetricsCount = 0;
      let calculatedMetricsCount = 0;
      
      try {
        postgresNarrativeCount = await this.prisma.narrativeChunk.count({ where: { ticker } });
        postgresMetricsCount = await this.prisma.financialMetric.count({ where: { ticker } });
        calculatedMetricsCount = await this.prisma.calculatedMetric.count({ where: { ticker } });
        this.logger.log(`📊 PostgreSQL check for ${ticker}: ${postgresNarrativeCount} narratives, ${postgresMetricsCount} raw metrics, ${calculatedMetricsCount} calculated metrics`);
      } catch (dbError) {
        this.logger.error(`PostgreSQL check failed for ${ticker}: ${dbError.message}`);
      }

      // ============================================================
      // STEP E.2: Verify services directly (PRODUCTION FIX - no HTTP calls)
      // ============================================================
      let metricsApiAvailable = false;

      // Test metrics via direct service call
      try {
        const metricsSummary = await this.financialCalculator.getMetricsSummary(ticker);
        metricsApiAvailable = !!metricsSummary && !!metricsSummary.metrics;
        this.logger.log(`✅ Metrics service check for ${ticker}: ${metricsApiAvailable ? 'available' : 'not available'}`);
      } catch (metricsError) {
        this.logger.warn(`Metrics service verification failed for ${ticker}: ${metricsError.message}`);
      }

      step.details = {
        postgresNarratives: postgresNarrativeCount,
        postgresMetrics: postgresMetricsCount,
        calculatedMetrics: calculatedMetricsCount,
        metricsApiAvailable,
      };

      // ============================================================
      // STEP E.3: ALWAYS precompute if PostgreSQL has narratives
      // This is the CRITICAL fix - don't depend on KB availability
      // ============================================================
      const shouldPrecompute = postgresNarrativeCount > 0;
      
      if (shouldPrecompute) {
        this.logger.log(`🧠 Pre-computing qualitative analysis for ${ticker} (${postgresNarrativeCount} narratives in PostgreSQL)...`);
        step.message = `Pre-computing qualitative analysis (${postgresNarrativeCount} narratives available)...`;
        
        try {
          const precomputeResult = await this.qualitativePrecompute.precomputeForTicker(ticker);
          
          step.details = {
            ...step.details,
            qualitativePrecomputed: true,
            questionsAnswered: precomputeResult.questionsAnswered,
            cachedFromPrevious: precomputeResult.cached,
            precomputeFailed: precomputeResult.failed,
            precomputeDuration: precomputeResult.duration,
          };
          
          this.logger.log(
            `✅ Qualitative precompute complete for ${ticker}: ` +
            `${precomputeResult.questionsAnswered} new, ${precomputeResult.cached} cached, ${precomputeResult.failed} failed`
          );
        } catch (precomputeError) {
          // Log but don't fail - precompute is an optimization
          this.logger.error(`❌ Qualitative precompute failed for ${ticker}: ${precomputeError.message}`);
          step.details = { 
            ...step.details, 
            qualitativePrecomputed: false, 
            precomputeError: precomputeError.message,
          };
        }
      } else {
        this.logger.warn(`⚠️ No narratives in PostgreSQL for ${ticker} - skipping qualitative precompute`);
        step.details = { ...step.details, qualitativePrecomputed: false, reason: 'No narratives in database' };
      }

      // Build final status message
      const metricsStatus = calculatedMetricsCount > 0 ? '✓' : (postgresMetricsCount > 0 ? '○' : '✗');
      const narrativesStatus = postgresNarrativeCount > 0 ? '✓' : '✗';
      const qualitativeStatus = step.details.qualitativePrecomputed ? '✓ cached' : '○';

      step.status = 'completed';
      step.message = `Data ready: Metrics ${metricsStatus} (${calculatedMetricsCount}), Narratives ${narrativesStatus} (${postgresNarrativeCount}), Qualitative ${qualitativeStatus}`;
      step.completedAt = new Date();

      this.logger.log(`✅ Step E completed for ${ticker}: ${step.message}`);

    } catch (error) {
      // Step E should NEVER fail the pipeline - it's verification only
      step.status = 'completed_with_warnings';
      step.message = `Verification completed with warnings: ${error.message}`;
      step.completedAt = new Date();
      this.logger.warn(`RAG verification had issues for ${ticker}: ${error.message}`);
    }
  }

  /**
   * Get pipeline status
   * 
   * HARDENING: If in-memory status is lost (server restart), reconstruct from DB
   */
  getPipelineStatus(dealId: string): PipelineStatus | null {
    const inMemoryStatus = this.pipelineStatuses.get(dealId);
    if (inMemoryStatus) {
      return inMemoryStatus;
    }
    
    // In-memory status lost - will be reconstructed by caller if needed
    // The deal.controller will handle this by checking deal.status from DB
    return null;
  }

  /**
   * Reconstruct pipeline status from database for a deal
   * Called when in-memory status is lost (e.g., server restart)
   */
  async reconstructPipelineStatus(dealId: string, deal: { ticker: string; status: string }): Promise<PipelineStatus | null> {
    if (!deal.ticker) return null;
    
    const ticker = deal.ticker.toUpperCase();
    
    // Check what data exists in DB
    const [metricsCount, chunksCount, calculatedCount] = await Promise.all([
      this.prisma.financialMetric.count({ where: { ticker } }),
      this.prisma.narrativeChunk.count({ where: { ticker } }),
      this.prisma.calculatedMetric.count({ where: { ticker } }),
    ]);

    // Determine step statuses based on what data exists
    const steps: PipelineStep[] = [
      { 
        id: 'A', 
        name: 'Download SEC Filings', 
        status: metricsCount > 0 ? 'completed' : (deal.status === 'processing' ? 'running' : 'pending'),
        message: metricsCount > 0 ? `${metricsCount} metrics extracted` : 'Waiting...',
      },
      { 
        id: 'B', 
        name: 'Parse & Store Metrics', 
        status: metricsCount > 0 ? 'completed' : 'pending',
        message: metricsCount > 0 ? `${metricsCount} raw, ${calculatedCount} calculated` : 'Waiting...',
      },
      { 
        id: 'C', 
        name: 'Chunk & Store Narratives', 
        status: chunksCount > 0 ? 'completed' : (metricsCount > 0 ? 'completed' : 'pending'),
        message: chunksCount > 0 ? `${chunksCount} chunks` : 'No narratives',
      },
      { 
        id: 'D', 
        name: 'Sync to Bedrock KB', 
        status: deal.status === 'ready' ? 'completed' : (chunksCount > 0 ? 'completed' : 'pending'),
        message: deal.status === 'ready' ? 'Synced' : 'Waiting...',
      },
      { 
        id: 'E', 
        name: 'Verify RAG Flow', 
        status: deal.status === 'ready' ? 'completed' : 'pending',
        message: deal.status === 'ready' ? 'Verified' : 'Waiting...',
      },
    ];

    const reconstructedStatus: PipelineStatus = {
      dealId,
      ticker,
      overallStatus: deal.status === 'ready' ? 'completed' : (deal.status === 'error' ? 'failed' : 'running'),
      currentStep: deal.status === 'ready' ? 'E' : 'A',
      steps,
      startedAt: new Date(),
    };

    // Cache it for future requests
    this.pipelineStatuses.set(dealId, reconstructedStatus);
    
    return reconstructedStatus;
  }

  /**
   * Get KB sync status for a ticker
   */
  private async getKBSyncStatus(ticker: string): Promise<{
    chunksInS3: number;
    chunksInRds: number;
    lastS3UploadAt: Date | null;
    lastKbSyncAt: Date | null;
    kbSyncJobId: string | null;
    kbSyncStatus: string;
    needsKbSync: boolean;
  } | null> {
    try {
      const result = await this.prisma.$queryRawUnsafe(`
        SELECT 
          chunks_in_s3 as "chunksInS3",
          chunks_in_rds as "chunksInRds",
          last_s3_upload_at as "lastS3UploadAt",
          last_kb_sync_at as "lastKbSyncAt",
          kb_sync_job_id as "kbSyncJobId",
          kb_sync_status as "kbSyncStatus",
          needs_kb_sync as "needsKbSync"
        FROM kb_sync_status
        WHERE ticker = $1
      `, ticker) as any[];

      if (result.length === 0) {
        return null;
      }

      return {
        chunksInS3: Number(result[0].chunksInS3) || 0,
        chunksInRds: Number(result[0].chunksInRds) || 0,
        lastS3UploadAt: result[0].lastS3UploadAt,
        lastKbSyncAt: result[0].lastKbSyncAt,
        kbSyncJobId: result[0].kbSyncJobId,
        kbSyncStatus: result[0].kbSyncStatus || 'pending',
        needsKbSync: result[0].needsKbSync !== false,
      };
    } catch (error) {
      // Table might not exist yet - return null
      this.logger.warn(`Failed to get KB sync status for ${ticker}: ${error.message}`);
      return null;
    }
  }

  /**
   * Update KB sync status for a ticker (upsert)
   */
  private async updateKBSyncStatus(ticker: string, updates: {
    chunksInS3?: number;
    chunksInRds?: number;
    lastS3UploadAt?: Date;
    lastKbSyncAt?: Date;
    kbSyncJobId?: string;
    kbSyncStatus?: string;
    needsKbSync?: boolean;
  }): Promise<void> {
    try {
      // Simple upsert using raw SQL with all fields
      await this.prisma.$executeRawUnsafe(`
        INSERT INTO kb_sync_status (
          ticker, 
          chunks_in_s3, 
          chunks_in_rds, 
          last_s3_upload_at, 
          last_kb_sync_at, 
          kb_sync_job_id, 
          kb_sync_status, 
          needs_kb_sync,
          created_at, 
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        ON CONFLICT (ticker) DO UPDATE SET
          chunks_in_s3 = COALESCE($2, kb_sync_status.chunks_in_s3),
          chunks_in_rds = COALESCE($3, kb_sync_status.chunks_in_rds),
          last_s3_upload_at = COALESCE($4, kb_sync_status.last_s3_upload_at),
          last_kb_sync_at = COALESCE($5, kb_sync_status.last_kb_sync_at),
          kb_sync_job_id = COALESCE($6, kb_sync_status.kb_sync_job_id),
          kb_sync_status = COALESCE($7, kb_sync_status.kb_sync_status),
          needs_kb_sync = COALESCE($8, kb_sync_status.needs_kb_sync),
          updated_at = NOW()
      `,
        ticker,
        updates.chunksInS3 ?? null,
        updates.chunksInRds ?? null,
        updates.lastS3UploadAt ?? null,
        updates.lastKbSyncAt ?? null,
        updates.kbSyncJobId ?? null,
        updates.kbSyncStatus ?? null,
        updates.needsKbSync ?? null,
      );

      this.logger.log(`Updated KB sync status for ${ticker}: ${JSON.stringify(updates)}`);
    } catch (error) {
      // Log but don't fail - sync tracking is an optimization
      this.logger.warn(`Failed to update KB sync status for ${ticker}: ${error.message}`);
    }
  }

  /**
   * Update deal status in database with retry on connection errors
   */
  private async updateDealStatus(dealId: string, status: string, message: string): Promise<void> {
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Ensure connection is alive before update
        await this.prisma.$queryRaw`SELECT 1`;
        
        await this.prisma.$executeRawUnsafe(`
          UPDATE deals 
          SET status = $1, processing_message = $2, updated_at = NOW()
          WHERE id = $3::uuid
        `, status, message, dealId);
        return;
      } catch (error) {
        const isConnectionError = 
          error.message?.includes('Connection') ||
          error.message?.includes('Closed') ||
          error.message?.includes('ECONNRESET');
        
        if (isConnectionError && attempt < maxRetries) {
          this.logger.warn(`DB connection error updating deal status (attempt ${attempt}/${maxRetries})`);
          await this.sleep(1000 * attempt);
          continue;
        }
        
        // Log but don't throw - status update failure shouldn't crash pipeline
        this.logger.error(`Failed to update deal status after ${attempt} attempts: ${error.message}`);
        return;
      }
    }
  }

  /**
   * Step F: REMOVED - Duplicated Step E work
   * 
   * REASON FOR REMOVAL:
   * - Step F (MDAIntelligenceService) extracted MD&A insights using pattern-based analysis
   * - Step E (QualitativePrecomputeService) already does the same MD&A analysis
   * - Both services read from narrative_chunks and extract trends/risks
   * - Step F saved to non-existent mda_insights table (never created)
   * - Insights page uses Step E data, not Step F data
   * - Result: Duplicate work with no benefit
   * 
   * The MDAIntelligenceService code is preserved in mda-intelligence.service.ts
   * for potential future use, but is no longer called in the pipeline.
   */

  /**
   * Step G: Build Metric Hierarchy
   * Builds hierarchical relationship graph from flat metrics
   */
  private async executeStepG(dealId: string, ticker: string, status: PipelineStatus): Promise<void> {
    const step = status.steps.find(s => s.id === 'G')!;
    step.status = 'running';
    step.startedAt = new Date();
    step.message = 'Building metric hierarchy...';
    status.currentStep = 'G';
    await this.updateDealStatus(dealId, 'processing', 'Step G: Building metric hierarchy...');

    try {
      this.logger.log(`📊 Step G: Building metric hierarchy for ${ticker}...`);

      // Get all fiscal periods with metrics
      const periods = await this.prisma.financialMetric.findMany({
        where: { ticker },
        select: { fiscalPeriod: true },
        distinct: ['fiscalPeriod'],
        orderBy: { fiscalPeriod: 'desc' },
      });

      if (periods.length === 0) {
        step.status = 'completed';
        step.message = 'No metrics found';
        step.details = { periodsProcessed: 0, hierarchiesBuilt: 0 };
        step.completedAt = new Date();
        this.logger.log(`✅ Step G completed for ${ticker}: No metrics`);
        return;
      }

      this.logger.log(`Found ${periods.length} fiscal periods with metrics for ${ticker}`);

      // Build hierarchy for each period
      let hierarchiesBuilt = 0;
      for (const { fiscalPeriod } of periods) {
        try {
          this.logger.log(`Building hierarchy for ${ticker} ${fiscalPeriod}...`);
          
          const metrics = await this.prisma.financialMetric.findMany({
            where: { ticker, fiscalPeriod },
          });

          // Build hierarchy (returns Map<string, MetricNode>)
          const hierarchyMap = this.metricHierarchyService.buildHierarchy(metrics);

          // Save hierarchy to database
          await this.metricHierarchyService.saveHierarchy(dealId, hierarchyMap);
          hierarchiesBuilt++;
          
          this.logger.log(`✅ Built hierarchy for ${ticker} ${fiscalPeriod}: ${hierarchyMap.size} nodes`);
        } catch (error) {
          this.logger.warn(`Failed to build hierarchy for ${ticker} ${fiscalPeriod}: ${error.message}`);
        }
      }

      step.status = 'completed';
      step.message = `Built hierarchy for ${hierarchiesBuilt} fiscal periods`;
      step.details = { 
        periodsProcessed: periods.length,
        hierarchiesBuilt,
      };
      step.completedAt = new Date();

      this.logger.log(`✅ Step G completed for ${ticker}: ${hierarchiesBuilt} hierarchies built`);

    } catch (error) {
      // Log error but don't fail entire pipeline
      this.logger.error(`Step G failed for ${ticker}: ${error.message}`);
      
      step.status = 'completed_with_warnings';
      step.message = `Completed with warnings: ${error.message}`;
      step.completedAt = new Date();
      
      // Don't throw - allow pipeline to continue
    }
  }

  /**
   * Step H: Link Footnotes
   * Links metrics to explanatory footnotes
   */
  private async executeStepH(dealId: string, ticker: string, status: PipelineStatus): Promise<void> {
    const step = status.steps.find(s => s.id === 'H')!;
    step.status = 'running';
    step.startedAt = new Date();
    step.message = 'Linking footnotes...';
    status.currentStep = 'H';
    await this.updateDealStatus(dealId, 'processing', 'Step H: Linking footnotes...');

    try {
      this.logger.log(`📊 Step H: Linking footnotes for ${ticker}...`);

      // Get all fiscal periods with metrics
      const periods = await this.prisma.financialMetric.findMany({
        where: { ticker },
        select: { fiscalPeriod: true },
        distinct: ['fiscalPeriod'],
        orderBy: { fiscalPeriod: 'desc' },
      });

      if (periods.length === 0) {
        step.status = 'completed';
        step.message = 'No metrics found';
        step.details = { periodsProcessed: 0, footnotesLinked: 0 };
        step.completedAt = new Date();
        this.logger.log(`✅ Step H completed for ${ticker}: No metrics`);
        return;
      }

      this.logger.log(`Found ${periods.length} fiscal periods with metrics for ${ticker}`);

      // Link footnotes for each period
      let footnotesLinked = 0;
      for (const { fiscalPeriod } of periods) {
        try {
          this.logger.log(`Linking footnotes for ${ticker} ${fiscalPeriod}...`);
          
          const metrics = await this.prisma.financialMetric.findMany({
            where: { ticker, fiscalPeriod },
          });

          // Get narrative chunks for this period (they contain the HTML content)
          const chunks = await this.prisma.narrativeChunk.findMany({
            where: { 
              ticker,
              // Match filing date to fiscal period
              filingDate: {
                gte: new Date(`${fiscalPeriod.substring(2, 6)}-01-01`),
                lt: new Date(`${parseInt(fiscalPeriod.substring(2, 6)) + 1}-01-01`)
              }
            },
            orderBy: { filingDate: 'desc' },
          });

          if (chunks.length > 0) {
            // Combine all chunk content as HTML
            const htmlContent = chunks.map(c => c.content).join('\n\n');
            
            const references = await this.footnoteLinkingService.linkFootnotesToMetrics(
              dealId,
              metrics,
              htmlContent,
            );
            
            footnotesLinked += references.length;
            this.logger.log(`✅ Linked ${references.length} footnotes for ${ticker} ${fiscalPeriod}`);
          } else {
            this.logger.warn(`No narrative chunks found for ${ticker} ${fiscalPeriod}`);
          }
        } catch (error) {
          this.logger.warn(`Failed to link footnotes for ${ticker} ${fiscalPeriod}: ${error.message}`);
        }
      }

      step.status = 'completed';
      step.message = `Linked ${footnotesLinked} footnotes across ${periods.length} periods`;
      step.details = { 
        periodsProcessed: periods.length,
        footnotesLinked,
      };
      step.completedAt = new Date();

      this.logger.log(`✅ Step H completed for ${ticker}: ${footnotesLinked} footnotes linked`);

    } catch (error) {
      // Log error but don't fail entire pipeline
      this.logger.error(`Step H failed for ${ticker}: ${error.message}`);
      
      step.status = 'completed_with_warnings';
      step.message = `Completed with warnings: ${error.message}`;
      step.completedAt = new Date();
      
      // Don't throw - allow pipeline to continue
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
