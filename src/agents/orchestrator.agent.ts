/**
 * Orchestrator Agent — plan/execute loop for data acquisition.
 * Phase 4 of Filing Expansion spec (§6.2).
 *
 * Coordinates SEC filing acquisition (deterministic via EDGAR) and
 * transcript acquisition (agentic via IR page browsing).
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from '../rag/bedrock.service';
import { IrPageFinderAgent } from './ir-page-finder.agent';
import { TranscriptAcquisitionAgent, TranscriptResult } from './transcript-acquisition.agent';

export interface AcquisitionTask {
  ticker: string;
  companyName: string;
  type: 'full_acquisition' | 'freshness_check' | 'transcript_only' | 'specific';
  description?: string;
  triggeredBy: 'scheduled' | 'deal_creation' | 'query_triggered' | 'manual';
}

export interface AcquisitionAction {
  description: string;
  tool: string;
  status: 'success' | 'failed' | 'skipped';
  duration_ms: number;
  details?: Record<string, any>;
}

export interface AcquisitionError {
  step: string;
  error: string;
  recoveryAttempted: boolean;
}

export interface AcquisitionReport {
  ticker: string;
  triggeredBy: string;
  startedAt: Date;
  completedAt?: Date;
  actions: AcquisitionAction[];
  errors: AcquisitionError[];
  llmCalls: number;
  totalTokens: number;
  transcriptsAcquired: number;
}

export interface CoverageAssessment {
  ticker: string;
  filingCounts: Record<string, number>;
  latestFilingDates: Record<string, string>;
  transcriptQuarters: string[];
  hasIrMapping: boolean;
}

@Injectable()
export class OrchestratorAgent {
  private readonly logger = new Logger(OrchestratorAgent.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bedrock: BedrockService,
    private readonly irPageFinder: IrPageFinderAgent,
    private readonly transcriptAgent: TranscriptAcquisitionAgent,
  ) {}

  /**
   * Execute an acquisition task with plan/execute loop.
   */
  async execute(task: AcquisitionTask): Promise<AcquisitionReport> {
    const report: AcquisitionReport = {
      ticker: task.ticker,
      triggeredBy: task.triggeredBy,
      startedAt: new Date(),
      actions: [],
      errors: [],
      llmCalls: 0,
      totalTokens: 0,
      transcriptsAcquired: 0,
    };

    this.logger.log(
      `Orchestrator starting: ${task.type} for ${task.ticker} (triggered by ${task.triggeredBy})`,
    );

    try {
      // Step 1: Assess current coverage
      const coverage = await this.assessCurrentCoverage(task.ticker);
      report.actions.push({
        description: 'Assessed current data coverage',
        tool: 'database_query',
        status: 'success',
        duration_ms: 0,
        details: coverage,
      });

      // Step 2: Acquire transcripts if needed
      if (task.type === 'full_acquisition' || task.type === 'transcript_only' || task.type === 'freshness_check') {
        await this.acquireTranscripts(task, coverage, report);
      }
    } catch (error) {
      this.logger.error(`Orchestrator failed for ${task.ticker}: ${error.message}`);
      report.errors.push({
        step: 'orchestrator_execute',
        error: error.message,
        recoveryAttempted: false,
      });
    }

    report.completedAt = new Date();
    const durationMs = report.completedAt.getTime() - report.startedAt.getTime();
    this.logger.log(
      `Orchestrator complete for ${task.ticker}: ${report.actions.length} actions, ` +
      `${report.errors.length} errors, ${report.transcriptsAcquired} transcripts, ${durationMs}ms`,
    );

    return report;
  }

  /**
   * Assess what data we already have for a ticker.
   */
  async assessCurrentCoverage(ticker: string): Promise<CoverageAssessment> {
    const upperTicker = ticker.toUpperCase();

    // Count filings by type
    const filingCounts: Record<string, number> = {};
    const latestFilingDates: Record<string, string> = {};

    const narrativeCounts = await this.prisma.narrativeChunk.groupBy({
      by: ['filingType'],
      where: { ticker: upperTicker },
      _count: true,
    });

    for (const nc of narrativeCounts) {
      filingCounts[nc.filingType] = nc._count;
    }

    // Get latest filing dates
    const latestFilings = await this.prisma.narrativeChunk.findMany({
      where: { ticker: upperTicker },
      distinct: ['filingType'],
      orderBy: { filingDate: 'desc' },
      select: { filingType: true, filingDate: true },
    });

    for (const f of latestFilings) {
      latestFilingDates[f.filingType] = f.filingDate?.toISOString().split('T')[0] || 'unknown';
    }

    // Get existing transcript quarters
    const transcriptChunks = await this.prisma.narrativeChunk.findMany({
      where: {
        ticker: upperTicker,
        filingType: 'EARNINGS',
      },
      distinct: ['sectionType'],
      select: { sectionType: true, filingDate: true },
    });
    const transcriptQuarters = transcriptChunks
      .map(c => c.sectionType)
      .filter(Boolean) as string[];

    // Check IR mapping
    let hasIrMapping = false;
    try {
      const irMapping = await this.prisma.$queryRaw`
        SELECT ticker FROM ir_page_mappings WHERE ticker = ${upperTicker} LIMIT 1
      ` as any[];
      hasIrMapping = irMapping.length > 0;
    } catch {
      // Table may not exist yet
    }

    return {
      ticker: upperTicker,
      filingCounts,
      latestFilingDates,
      transcriptQuarters,
      hasIrMapping,
    };
  }

  /**
   * Acquire earnings transcripts via the agentic pipeline.
   */
  private async acquireTranscripts(
    task: AcquisitionTask,
    coverage: CoverageAssessment,
    report: AcquisitionReport,
  ): Promise<void> {
    const startMs = Date.now();

    try {
      // Step 1: Find IR page
      const irMapping = await this.irPageFinder.findIrPage(task.ticker, task.companyName);
      report.llmCalls += 1;

      report.actions.push({
        description: `Found IR page: ${irMapping.irBaseUrl || 'not found'}`,
        tool: 'ir_page_finder',
        status: irMapping.confidence > 0.3 ? 'success' : 'failed',
        duration_ms: Date.now() - startMs,
        details: { confidence: irMapping.confidence, url: irMapping.irBaseUrl },
      });

      if (irMapping.confidence < 0.3) {
        report.errors.push({
          step: 'ir_page_discovery',
          error: `Low confidence IR page for ${task.ticker}: ${irMapping.confidence}`,
          recoveryAttempted: false,
        });
        return;
      }

      // Step 2: Acquire transcripts
      const transcriptStartMs = Date.now();
      const results = await this.transcriptAgent.acquireTranscripts(
        irMapping,
        task.ticker,
        coverage.transcriptQuarters,
      );
      report.llmCalls += 1;

      const successCount = results.filter(r => r.status === 'success').length;
      report.transcriptsAcquired = successCount;

      report.actions.push({
        description: `Acquired ${successCount} transcripts`,
        tool: 'transcript_acquisition',
        status: successCount > 0 ? 'success' : 'skipped',
        duration_ms: Date.now() - transcriptStartMs,
        details: {
          total: results.length,
          success: successCount,
          failed: results.filter(r => r.status === 'failed').length,
          skipped: results.filter(r => r.status === 'skipped').length,
        },
      });

      // Step 3: Dispatch successful transcripts to parser
      for (const result of results.filter(r => r.status === 'success' && r.content)) {
        await this.dispatchTranscriptToParser(task.ticker, result);
      }

      // Record errors
      for (const result of results.filter(r => r.status === 'failed')) {
        report.errors.push({
          step: `transcript_download_${result.quarter}`,
          error: result.error || 'Unknown error',
          recoveryAttempted: false,
        });
      }
    } catch (error) {
      report.errors.push({
        step: 'transcript_acquisition',
        error: error.message,
        recoveryAttempted: false,
      });
    }
  }

  /**
   * Dispatch a downloaded transcript to the Python parser via the sec-parser endpoint.
   */
  private async dispatchTranscriptToParser(
    ticker: string,
    result: TranscriptResult,
  ): Promise<void> {
    if (!result.content) return;

    try {
      // Call the Python parser's /sec-parser endpoint with EARNINGS type
      const parserUrl = process.env.PYTHON_PARSER_URL || 'http://localhost:8000';
      const response = await fetch(`${parserUrl}/sec-parser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          filing_type: 'EARNINGS',
          html_content: result.content,
          quarter: result.quarter,
          source: 'ir_page',
        }),
      });

      if (!response.ok) {
        this.logger.error(`Parser dispatch failed for ${ticker} ${result.quarter}: HTTP ${response.status}`);
      } else {
        this.logger.log(`Dispatched transcript to parser: ${ticker} ${result.quarter}`);
      }
    } catch (error) {
      this.logger.error(`Failed to dispatch transcript: ${error.message}`);
    }
  }
}
