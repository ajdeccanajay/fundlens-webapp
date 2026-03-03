import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { BedrockService } from './bedrock.service';
import { PerformanceOptimizerService } from './performance-optimizer.service';
import {
  QueryIntent, MetricResult, Citation, ChunkResult,
  ResponseType, classifyResponseType, ResponseClassificationInput,
} from './types/query-intent';
import { ComputedMetricResult } from './metric-resolution/types';
import { MetricRegistryService } from './metric-resolution/metric-registry.service';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Re-export ResponseType so existing consumers that import from this file still work
export type { ResponseType } from './types/query-intent';

// ── Peer comparison result (defined here until PeerComparisonService exists) ─
export interface PeerComparisonResult {
  metric: string;
  normalizationBasis: 'FY' | 'LTM' | 'CY';
  period: string;
  rows: Array<{ ticker: string; value: number | null; rank: number }>;
  median: number;
  mean: number;
  subjectTicker?: string;
  subjectRank?: number;
  subjectVsMedianPct?: number;
  fyMismatchWarning?: string;
}

// ── Sub-query result for decomposed queries ─────────────────────────────
export interface SubQueryResult {
  subQuery: string;
  metrics: MetricResult[];
  narratives: ChunkResult[];
  computedResults: ComputedMetricResult[];
  responseType: ResponseType;
}

// ── FinancialAnalysisContext (Req 8.1) ──────────────────────────────────
export interface FinancialAnalysisContext {
  originalQuery: string;
  intent: QueryIntent;
  metrics: MetricResult[];
  narratives: ChunkResult[];
  computedResults: ComputedMetricResult[];
  computedSummary?: any;
  peerData?: PeerComparisonResult;
  subQueryResults?: SubQueryResult[];
  unifyingInstruction?: string;
  modelTier: 'haiku' | 'sonnet' | 'opus';
  tenantId?: string;
}

// ── SynthesisResult (Req 8.7) ───────────────────────────────────────────
export interface SynthesisResult {
  answer: string;
  usage: { inputTokens: number; outputTokens: number };
  citations: Citation[];
  responseType: ResponseType;
}

// ── Tenant overlay shape ────────────────────────────────────────────────
export interface TenantOverlay {
  tenant_id: string;
  display_name: string;
  asset_class?: string;
  synthesis_instructions?: string;
  synonym_mappings?: Record<string, string>;
}

// ── Constants ───────────────────────────────────────────────────────────
const MAX_NARRATIVE_CHARS = 20_000;
const MAX_PROMPT_CHARS = 40_000;

/**
 * HybridSynthesisService — Structured 5-step financial reasoning synthesis.
 *
 * Replaces freeform LLM generation with a disciplined prompt that forces
 * the model through: Quantitative Facts → Narrative Summary →
 * Reconciliation → Conclusion → Provocation.
 *
 * Requirements: 8.1–8.7, 14.3, 18.1–18.3
 */
@Injectable()
export class HybridSynthesisService {
  private readonly logger = new Logger(HybridSynthesisService.name);

  /** In-memory cache: tenantId → loaded overlay (or null if file missing) */
  private readonly overlayCache = new Map<string, TenantOverlay | null>();

  constructor(
    private readonly bedrock: BedrockService,
    private readonly performanceOptimizer: PerformanceOptimizerService,
    @Optional() @Inject(MetricRegistryService) private readonly metricRegistry?: MetricRegistryService,
  ) {}

  // ── Tenant Overlay Loading (Req 11.1) ─────────────────────────────

  /**
   * Load a tenant overlay YAML from `yaml-registries/{tenantId}.yaml`.
   * Returns the parsed overlay or null if the file doesn't exist.
   * Results are cached to avoid repeated file reads.
   */
  loadTenantOverlay(tenantId: string): TenantOverlay | null {
    if (this.overlayCache.has(tenantId)) {
      return this.overlayCache.get(tenantId) ?? null;
    }

    try {
      const overlayPath = path.join(process.cwd(), 'yaml-registries', `${tenantId}.yaml`);
      if (!fs.existsSync(overlayPath)) {
        this.logger.warn(`No tenant overlay found at ${overlayPath} — continuing without overlay`);
        this.overlayCache.set(tenantId, null);
        return null;
      }

      const content = fs.readFileSync(overlayPath, 'utf-8');
      const parsed = yaml.load(content) as TenantOverlay;

      if (!parsed || typeof parsed !== 'object') {
        this.logger.warn(`Invalid tenant overlay YAML for "${tenantId}" — skipping`);
        this.overlayCache.set(tenantId, null);
        return null;
      }

      this.overlayCache.set(tenantId, parsed);
      this.logger.log(`Loaded tenant overlay for "${tenantId}" (asset_class: ${parsed.asset_class ?? 'none'})`);
      return parsed;
    } catch (err) {
      this.logger.warn(`Failed to load tenant overlay for "${tenantId}": ${(err as Error).message}`);
      this.overlayCache.set(tenantId, null);
      return null;
    }
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Synthesize a structured financial analysis response.
   *
   * 1. Build the appropriate prompt (standard or unifying)
   * 2. Invoke Bedrock with the model tier from context
   * 3. Parse the response into a SynthesisResult
   */
  async synthesize(context: FinancialAnalysisContext): Promise<SynthesisResult> {
    const startTime = Date.now();

    try {
      // Choose prompt strategy based on sub-query presence (Req 14.3)
      const prompt = context.subQueryResults && context.subQueryResults.length > 0
        ? this.buildUnifyingPrompt(context)
        : this.buildStructuredPrompt(context);

      const modelId = this.performanceOptimizer.getModelId(context.modelTier);

      this.logger.log(
        `Synthesizing with ${context.modelTier} | metrics=${context.metrics.length} narratives=${context.narratives.length} computed=${context.computedResults.length}`,
      );

      const rawResponse = await this.bedrock.invokeClaude({
        prompt,
        modelId,
        max_tokens: 4096,
      });

      const result = this.parseSynthesisResponse(rawResponse, context);

      this.logger.log(
        `Synthesis complete in ${Date.now() - startTime}ms | responseType=${result.responseType} citations=${result.citations.length}`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Synthesis failed: ${error?.message ?? error}`);
      return this.buildFallbackResult(context);
    }
  }

  // ── Prompt Builders ─────────────────────────────────────────────────

  /**
   * Build the 5-step structured reasoning prompt (Req 8.2–8.5).
   *
   * Steps:
   *  1. Quantitative Facts — metrics table as ground truth
   *  2. Narrative Summary  — attributed narrative chunks
   *  3. Reconciliation     — numbers vs. narrative alignment
   *  4. Conclusion         — investment-grade takeaway
   *  5. Provocation        — challenge question (peer-grounded when peer data present)
   */
  buildStructuredPrompt(ctx: FinancialAnalysisContext): string {
      const sections: string[] = [];

      // System preamble — produce a polished analyst note, NOT a step-by-step scaffold
      sections.push(
        'You are a senior equity research analyst at a top-tier investment bank.',
        'Write a concise, investment-grade research note answering the query below.',
        'Use ONLY the data provided. Do NOT fabricate numbers.',
        'If the provided data does not directly address the query, synthesize the MOST RELEVANT information you have and note what specific data is missing. NEVER respond with "Query Mismatch" or "No data available" — always provide value from whatever data IS available.',
        '',
        'CRITICAL CALCULATION RULES:',
        '- NEVER calculate, derive, estimate, or project any financial metrics yourself.',
        '- NEVER create forward estimates (e.g., "FY2025E") or projected values.',
        '- For margins, ratios, and derived metrics: use ONLY the values from the COMPUTED FINANCIAL METRICS section below. These were calculated by a deterministic engine and are authoritative.',
        '- If a margin or ratio is not in the COMPUTED FINANCIAL METRICS section, state that it is not available — do NOT attempt to calculate it from raw numbers.',
        '- Report only actual historical data from the provided sources. Do not extrapolate trends.',
        '',
        'FORMATTING RULES:',
        '- Use markdown ## headings for each major section (e.g., ## Executive Summary, ## Revenue Analysis).',
        '- Always put a blank line before and after each heading.',
        '- Write in natural prose with markdown formatting (bold, tables, bullet points).',
        '- Do NOT use labels like "Step 1", "Step 2", or any numbered scaffolding.',
        '- Do NOT use **Bold Text:** as inline section headers — always use ## Heading on its own line.',
        '- Start with a brief executive summary (1-2 sentences) under ## Executive Summary.',
        '- Present key figures in a comparison table when multiple tickers are involved.',
        '- Follow with analytical commentary: what the numbers mean, key differences, and implications.',
        '- End with a sharp, thought-provoking question under ## Investment Committee Challenge.',
        `- Keep the total response under ${this.getWordLimit(ctx)} words.`,
        '- Include year-over-year growth rates when historical data is available.',
        '- Always cite the specific fiscal period for each number you quote.',
        '- Do NOT describe or narrate any charts — if a chart is generated, it will be rendered separately.',
        '- When analyzing revenue, discuss segment breakdowns (e.g., AWS, advertising, subscriptions) if narrative context mentions them.',
        '- When multiple fiscal periods are available, highlight trends and growth trajectories.',
        '- For multi-ticker queries, provide a meaningful comparative analysis — don\'t just list numbers side by side.',
        '',
        `QUERY: ${ctx.originalQuery}`,
        '',
      );

      // ── Quantitative data (Req 8.3) ──────────────────────────────
      const metricsTable = this.formatMetricsTable(ctx.metrics, ctx.computedResults);
      if (metricsTable) {
        sections.push('=== QUANTITATIVE DATA (ground truth) ===', metricsTable, '');
      }

      // ── Computed summary from FinancialCalculatorService ──────────
      if (ctx.computedSummary) {
        const summaries = Array.isArray(ctx.computedSummary) ? ctx.computedSummary : [ctx.computedSummary];
        const computedLines: string[] = [];
        for (const s of summaries) {
          if (s?.ticker && s?.metrics) {
            const ticker = s.ticker.toUpperCase();
            computedLines.push(`${ticker}:`);
            const prof = s.metrics.profitability;
            if (prof) {
              if (prof.grossMargin?.ttm != null) computedLines.push(`  • Gross Margin (TTM): ${(prof.grossMargin.ttm * 100).toFixed(1)}%`);
              if (prof.operatingMargin?.ttm != null) computedLines.push(`  • Operating Margin (TTM): ${(prof.operatingMargin.ttm * 100).toFixed(1)}%`);
              if (prof.netMargin?.ttm != null) computedLines.push(`  • Net Margin (TTM): ${(prof.netMargin.ttm * 100).toFixed(1)}%`);
              if (prof.ebitdaMargin?.ttm != null) computedLines.push(`  • EBITDA Margin (TTM): ${(prof.ebitdaMargin.ttm * 100).toFixed(1)}%`);
              if (prof.grossProfit?.ttm != null) computedLines.push(`  • Gross Profit (TTM): ${this.formatValue(prof.grossProfit.ttm, 'gross_profit')}`);
              if (prof.operatingIncome?.ttm != null) computedLines.push(`  • Operating Income (TTM): ${this.formatValue(prof.operatingIncome.ttm, 'operating_income')}`);
              if (prof.netIncome?.ttm != null) computedLines.push(`  • Net Income (TTM): ${this.formatValue(prof.netIncome.ttm, 'net_income')}`);
            }
            const rev = s.metrics.revenue;
            if (rev?.ttm != null) computedLines.push(`  • Revenue (TTM): ${this.formatValue(rev.ttm, 'revenue')}`);
            if (rev?.cagr != null) computedLines.push(`  • Revenue CAGR: ${this.formatValue(rev.cagr, 'cagr')}`);
          }
        }
        if (computedLines.length > 0) {
          sections.push('=== COMPUTED FINANCIAL METRICS (authoritative — use these values, do NOT recalculate) ===', computedLines.join('\n'), '');
        }
      }

      // ── Separate uploaded doc narratives from SEC narratives ──────
      const uploadedDocNarratives = (ctx.narratives || []).filter(
        n => n.metadata?.filingType === 'uploaded-document' || n.metadata?.sectionType === 'uploaded-document',
      );
      const secNarratives = (ctx.narratives || []).filter(
        n => n.metadata?.filingType !== 'uploaded-document' && n.metadata?.sectionType !== 'uploaded-document',
      );

      // Format ALL narratives with continuous [N] numbering matching ctx.narratives order
      // (extractCitations maps [N] → ctx.narratives[N-1], so numbering must match)
      const allNarrativeBlock = this.formatNarratives(ctx.narratives);

      if (uploadedDocNarratives.length > 0 && secNarratives.length > 0) {
        // Both sources present — instruct LLM to cross-reference
        sections.push(
          '=== MULTI-SOURCE DATA ===',
          'The narrative sources below include BOTH:',
          '  • SEC FILINGS (10-K, 10-Q) — official regulatory filings, ground truth for ACTUAL reported figures',
          '  • UPLOADED DOCUMENTS — analyst reports, research notes with ESTIMATES, forecasts, and interpretations',
          '',
          'CROSS-SOURCE RULES:',
          '1. For reported financial figures, ALWAYS cite SEC filings as the authoritative source.',
          '2. Use uploaded documents for forward estimates, peer comparisons, and qualitative analysis.',
          '3. When both sources discuss the same metric, cite BOTH and note any discrepancies.',
          '4. You MUST include at least one SEC filing citation if SEC narrative sources are available.',
          '',
          '=== ACTUAL vs. ESTIMATE CROSS-ANALYSIS (CRITICAL) ===',
          'When the query asks about analyst expectations, estimates, or how actual results compare:',
          '1. EXTRACT the analyst\'s specific estimates/forecasts from the UPLOADED DOCUMENT sources (e.g., "DBS expects revenue of $X").',
          '2. EXTRACT the actual reported figures from SEC FILING sources or the QUANTITATIVE DATA section.',
          '3. DIRECTLY COMPARE them: state the actual figure, the analyst estimate, and whether the company beat/missed/met expectations.',
          '4. Calculate the delta (actual minus estimate) and express it as both absolute and percentage terms.',
          '5. Provide context: what drove the beat/miss? Reference segment-level data if available.',
          'NEVER say "the data does not include analyst estimates" if uploaded document sources contain analyst reports — those ARE the estimates.',
          'NEVER say "consensus estimates are not available" when an uploaded analyst report provides specific projections.',
          '',
        );
        sections.push('=== ALL NARRATIVE SOURCES ===', allNarrativeBlock!, '');
      } else if (uploadedDocNarratives.length > 0) {
        sections.push(
          '=== UPLOADED DOCUMENT DATA (analyst reports, user-provided) ===',
          'IMPORTANT: This data comes from documents uploaded by the analyst. Treat it as PRIMARY, authoritative evidence.',
          allNarrativeBlock!,
          '',
        );
      } else if (allNarrativeBlock) {
        sections.push('=== NARRATIVE CONTEXT ===', allNarrativeBlock, '');
      }

      // Citation rule applies to all narrative sources
      if (allNarrativeBlock) {
        sections.push(
          'CITATION RULE: Reference narrative sources using [1], [2], etc. notation corresponding to the numbered sources above. Every claim derived from narrative context MUST include a citation marker.'
        );
      }

      // ── Peer comparison data (Req 8.5) ───────────────────────────
      if (ctx.peerData) {
        sections.push('=== PEER COMPARISON DATA ===', this.formatPeerTable(ctx.peerData), '');
      }

      // ── Synthesis guidance ────────────────────────────────────────
      sections.push(
        '=== SYNTHESIS GUIDANCE ===',
        'Internally follow this reasoning (do NOT expose these steps in your output):',
        '1. State key quantitative facts with exact figures, tickers, and periods.',
        '2. If narrative context is available, summarize management disclosures.',
        '3. Reconcile numbers with narrative — flag any discrepancies.',
        '4. Provide an actionable investment conclusion.',
        '5. End with one sharp challenge question referencing specific data.',
        '',
        'Your output should read like a polished research note — NOT a numbered checklist.',
      );

      // Peer-grounded provocation hint (Req 18.1–18.3)
      if (ctx.peerData && ctx.peerData.rows.length > 0) {
        const divergence = this.findMostInterestingDivergence(ctx.peerData);
        if (divergence) {
          const peerVal = this.formatValue(divergence.peerValue, divergence.metric);
          const subjectVal = this.formatValue(divergence.subjectValue, divergence.metric);
          const metricLabel = this.formatMetricLabel(divergence.metric);
          sections.push(
            '',
            'For the challenge question, consider this divergence:',
            `${divergence.peerTicker} achieved ${peerVal} ${metricLabel} while ${ctx.peerData.subjectTicker} achieved ${subjectVal} ${metricLabel} in ${divergence.period}.`,
          );
        }
      }

      // Tenant overlay injection (Req 11.1, 11.2)
      if (ctx.tenantId) {
        const overlay = this.loadTenantOverlay(ctx.tenantId);
        if (overlay && overlay.synthesis_instructions) {
          sections.push('', '=== TENANT-SPECIFIC CONTEXT ===');
          sections.push(`Tenant: ${overlay.display_name || ctx.tenantId}`);
          if (overlay.asset_class === 'private_equity') {
            sections.push('Asset Class: Private Equity');
          }
          sections.push(overlay.synthesis_instructions);
        }
      }

      return this.truncatePrompt(sections.join('\n'));
    }
  /**
   * Dynamic word limit based on query complexity.
   * Multi-ticker and comparison queries need more room for meaningful analysis.
   */
  private getWordLimit(ctx: FinancialAnalysisContext): number {
    const tickers = Array.isArray(ctx.intent.ticker) ? ctx.intent.ticker : ctx.intent.ticker ? [ctx.intent.ticker] : [];
    const hasNarratives = (ctx.narratives?.length || 0) > 0;
    const isComparison = ctx.intent.needsComparison || ctx.intent.needsPeerComparison || tickers.length > 1;

    if (isComparison && hasNarratives) return 1200;
    if (isComparison) return 1000;
    if (hasNarratives) return 900;
    return 700;
  }

  /**
   * Build a unifying prompt for decomposed sub-query results (Req 14.3).
   *
   * Instead of the standard 5-step prompt, this combines sub-query answers
   * into a single coherent response following the unifying instruction.
   */
  buildUnifyingPrompt(ctx: FinancialAnalysisContext): string {
      const sections: string[] = [];

      sections.push(
        'You are a senior equity research analyst at a top-tier investment bank.',
        'The following query was decomposed into sub-queries that have been answered independently.',
        'Unify these answers into a single, polished research note.',
        '',
        'CRITICAL CALCULATION RULES:',
        '- NEVER calculate, derive, estimate, or project any financial metrics yourself.',
        '- NEVER create forward estimates (e.g., "FY2025E") or projected values.',
        '- For margins, ratios, and derived metrics: use ONLY the values from the COMPUTED FINANCIAL METRICS section below. These were calculated by a deterministic engine and are authoritative.',
        '- If a margin or ratio is not in the COMPUTED FINANCIAL METRICS section, state that it is not available — do NOT attempt to calculate it from raw numbers.',
        '- Report only actual historical data from the provided sources. Do not extrapolate trends.',
        '',
        'FORMATTING RULES:',
        '- Use markdown ## headings for each major section (e.g., ## Executive Summary, ## Revenue Analysis).',
        '- Always put a blank line before and after each heading.',
        '- Write in natural prose with markdown formatting (bold, tables, bullet points).',
        '- Do NOT use labels like "Step 1", "Step 2", or any numbered scaffolding.',
        '- Do NOT use **Bold Text:** as inline section headers — always use ## Heading on its own line.',
        '- Start with a brief executive summary (1-2 sentences) under ## Executive Summary.',
        '- Present key figures in a comparison table when multiple tickers are involved.',
        '- Follow with analytical commentary synthesizing all sub-query findings.',
        '- End with a sharp, thought-provoking question under ## Investment Committee Challenge.',
        '- Keep the total response under 700 words.',
        '- Include year-over-year growth rates when historical data is available.',
        '- Always cite the specific fiscal period for each number you quote.',
        '- Do NOT describe or narrate any charts — if a chart is generated, it will be rendered separately.',
        '',
        `ORIGINAL QUERY: ${ctx.originalQuery}`,
        '',
      );

      if (ctx.unifyingInstruction) {
        sections.push(`UNIFYING INSTRUCTION: ${ctx.unifyingInstruction}`, '');
      }

      // Include each sub-query result
      for (let i = 0; i < (ctx.subQueryResults?.length ?? 0); i++) {
        const sq = ctx.subQueryResults![i];
        sections.push(`--- SUB-QUERY ${i + 1}: ${sq.subQuery} ---`);

        const sqMetrics = this.formatMetricsTable(sq.metrics, sq.computedResults);
        if (sqMetrics) sections.push('Metrics:', sqMetrics);

        if (sq.narratives.length > 0) {
          sections.push('Narratives:', this.formatNarratives(sq.narratives) || '');
        }

        sections.push('');
      }

      // Also include any top-level data
      const topMetrics = this.formatMetricsTable(ctx.metrics, ctx.computedResults);
      if (topMetrics) {
        sections.push('=== ADDITIONAL QUANTITATIVE DATA ===', topMetrics, '');
      }

      // Consolidated narrative sources with GLOBAL [N] numbering for citation extraction
      // ctx.narratives is populated from subQueryResults.flatMap(sq => sq.narratives) by rag.service.ts
      // extractCitations(response, ctx.narratives) maps [1] → ctx.narratives[0], so numbering must match
      const consolidatedNarratives = this.formatNarratives(ctx.narratives);
      if (consolidatedNarratives) {
        sections.push('=== NARRATIVE SOURCES ===', consolidatedNarratives, '');
        sections.push(
          'CITATION RULE: Reference narrative sources using [1], [2], etc. notation corresponding to the numbered sources above. Every claim derived from narrative context MUST include a citation marker.'
        );
        sections.push('');
      }

      if (ctx.peerData) {
        sections.push('=== PEER COMPARISON DATA ===', this.formatPeerTable(ctx.peerData), '');
      }

      // Synthesis guidance (internal reasoning, not exposed in output)
      sections.push(
        '=== SYNTHESIS GUIDANCE ===',
        'Internally follow this reasoning (do NOT expose these steps in your output):',
        '1. Consolidate all quantitative data from sub-queries with exact figures.',
        '2. Synthesize narrative findings across sub-queries.',
        '3. Identify alignment or conflicts across findings.',
        '4. Provide a unified investment-grade conclusion.',
        '5. End with one sharp challenge question grounded in the combined evidence.',
        '',
        'Your output should read like a polished research note — NOT a numbered checklist.',
      );

      // Peer-grounded provocation hint (Req 18.1–18.3)
      if (ctx.peerData && ctx.peerData.rows.length > 0) {
        const divergence = this.findMostInterestingDivergence(ctx.peerData);
        if (divergence) {
          const peerVal = this.formatValue(divergence.peerValue, divergence.metric);
          const subjectVal = this.formatValue(divergence.subjectValue, divergence.metric);
          const metricLabel = this.formatMetricLabel(divergence.metric);
          sections.push(
            '',
            'For the challenge question, consider this divergence:',
            `${divergence.peerTicker} achieved ${peerVal} ${metricLabel} while ${ctx.peerData.subjectTicker} achieved ${subjectVal} ${metricLabel} in ${divergence.period}.`,
          );
        }
      }

      return this.truncatePrompt(sections.join('\n'));
    }

  // ── Formatting Helpers ──────────────────────────────────────────────

  /**
   * Format metrics + computed results into a markdown table (Req 8.3).
   * Columns: Ticker | Metric | Period | Value | Source
   */
  formatMetricsTable(
    metrics: MetricResult[],
    computed: ComputedMetricResult[],
  ): string | null {
    const rows: string[] = [];

    if (metrics.length > 0) {
      rows.push('| Ticker | Metric | Period | Value | Source |');
      rows.push('| --- | --- | --- | --- | --- |');

      for (const m of metrics) {
        const label = m.displayName || this.formatMetricLabel(m.normalizedMetric);
        // Use rawValue for non-numeric metrics (e.g. rating: "Buy"), fall back to formatValue
        const value = (m as any).rawValue || this.formatValue(m.value, m.normalizedMetric);
        rows.push(
          `| ${m.ticker.toUpperCase()} | ${label} | ${m.fiscalPeriod} | ${value} | ${m.filingType} |`,
        );
      }
    }

    if (computed.length > 0) {
      if (rows.length === 0) {
        rows.push('| Ticker | Metric | Value | Formula |');
        rows.push('| --- | --- | --- | --- |');
      }
      for (const c of computed) {
        const value = c.value != null ? this.formatValue(c.value, c.canonical_id) : 'N/A';
        rows.push(
          `| — | ${c.display_name} | ${value} | ${c.formula} |`,
        );
      }
    }

    return rows.length > 0 ? rows.join('\n') : null;
  }

  /**
   * Format narrative chunks with attribution (Req 8.4).
   * Each chunk shows ticker, section type, and fiscal period.
   */
  private formatNarratives(narratives: ChunkResult[]): string | null {
      if (!narratives || narratives.length === 0) return null;

      // Partition narratives by source type
      const secNarratives: { idx: number; chunk: ChunkResult }[] = [];
      const uploadedNarratives: { idx: number; chunk: ChunkResult }[] = [];

      narratives.forEach((n, idx) => {
        const isUploaded =
          (n as any).source === 'user_document' ||
          (n as any).sourceType === 'USER_UPLOAD' ||
          n.metadata?.filingType === 'uploaded-document' ||
          n.metadata?.sectionType === 'uploaded-document';
        if (isUploaded) {
          uploadedNarratives.push({ idx, chunk: n });
        } else {
          secNarratives.push({ idx, chunk: n });
        }
      });

      // Budget: SEC gets 60%, uploaded gets 40%
      const secBudget = Math.floor(MAX_NARRATIVE_CHARS * 0.6);
      const uploadedBudget = MAX_NARRATIVE_CHARS - secBudget;

      // Build blocks in original order to preserve [N] numbering
      // extractCitations maps [1] → narratives[0], so order must match ctx.narratives
      const blocks: string[] = [];
      let secChars = 0;
      let uploadedChars = 0;

      for (let i = 0; i < narratives.length; i++) {
        const n = narratives[i];
        const isUploaded =
          (n as any).source === 'user_document' ||
          (n as any).sourceType === 'USER_UPLOAD' ||
          n.metadata?.filingType === 'uploaded-document' ||
          n.metadata?.sectionType === 'uploaded-document';

        const budget = isUploaded ? uploadedBudget : secBudget;
        const usedChars = isUploaded ? uploadedChars : secChars;

        const meta = n.metadata;
        const attribution = [
          meta.ticker?.toUpperCase(),
          meta.sectionType,
          meta.fiscalPeriod,
        ]
          .filter(Boolean)
          .join(' | ');

        let content = n.content;

        // Truncate if this source type's budget is exhausted
        if (usedChars + content.length > budget) {
          const remaining = budget - usedChars;
          if (remaining <= 100) continue; // Skip — no room for meaningful content
          content = content.substring(0, remaining) + '… [truncated]';
        }

        blocks.push(`[${blocks.length + 1}] ${attribution}\n${content}`);

        if (isUploaded) {
          uploadedChars += content.length;
        } else {
          secChars += content.length;
        }
      }

      this.logger.log(`📝 Narrative budget: SEC ${secChars}/${secBudget} chars, Uploaded ${uploadedChars}/${uploadedBudget} chars`);

      return blocks.length > 0 ? blocks.join('\n\n') : null;
    }

  /**
   * Format peer comparison data into a markdown table (Req 8.5).
   */
  formatPeerTable(peerData: PeerComparisonResult): string {
    const lines: string[] = [];

    lines.push(`Metric: ${peerData.metric} | Basis: ${peerData.normalizationBasis} | Period: ${peerData.period}`);
    lines.push('| Ticker | Value | Rank |');
    lines.push('| --- | --- | --- |');

    for (const row of peerData.rows) {
      const value = row.value != null ? this.formatValue(row.value, peerData.metric) : 'N/A';
      lines.push(`| ${row.ticker} | ${value} | #${row.rank} |`);
    }

    lines.push(`Median: ${peerData.median} | Mean: ${peerData.mean.toFixed(2)}`);

    if (peerData.subjectTicker && peerData.subjectVsMedianPct != null) {
      const sign = peerData.subjectVsMedianPct >= 0 ? '+' : '';
      lines.push(
        `${peerData.subjectTicker} vs Median: ${sign}${peerData.subjectVsMedianPct.toFixed(1)}%`,
      );
    }

    if (peerData.fyMismatchWarning) {
      lines.push(`⚠️ ${peerData.fyMismatchWarning}`);
    }

    return lines.join('\n');
  }

  // ── Response Parsing ────────────────────────────────────────────────

  /**
   * Parse the raw LLM output into a SynthesisResult (Req 8.7).
   *
   * Extracts citations from [N] references and classifies the response type.
   * On parse failure, returns the raw output as the answer.
   */
  parseSynthesisResponse(
    response: string,
    ctx: FinancialAnalysisContext,
  ): SynthesisResult {
    try {
      const citations = this.extractCitations(response, ctx.narratives);
      const responseType = this.classifyResponseType(ctx);

      return {
        answer: response,
        usage: { inputTokens: 0, outputTokens: 0 }, // Bedrock invokeClaude doesn't return usage; filled by caller if needed
        citations,
        responseType,
      };
    } catch (error) {
      this.logger.warn(`Parse failure, returning raw response: ${error?.message}`);
      return {
        answer: response,
        usage: { inputTokens: 0, outputTokens: 0 },
        citations: [],
        responseType: this.classifyResponseType(ctx),
      };
    }
  }

  // ── ResponseType Classification ─────────────────────────────────────

  /**
   * Classify the response type based on context shape (Req 9.1–9.8).
   */
  private classifyResponseType(ctx: FinancialAnalysisContext): ResponseType {
    const input: ResponseClassificationInput = {
      intent: ctx.intent,
      metrics: ctx.metrics,
      narratives: ctx.narratives,
      computedResults: ctx.computedResults,
      peerData: ctx.peerData,
      subQueryResults: ctx.subQueryResults,
    };
    return classifyResponseType(input);
  }

  // ── Citation Extraction ─────────────────────────────────────────────

  /**
   * Extract [N] citation references from the LLM response and map them
   * to narrative chunks.
   */
  private extractCitations(response: string, narratives: ChunkResult[]): Citation[] {
    const citations: Citation[] = [];
    const citationPattern = /\[(\d+)\]/g;
    const seen = new Set<number>();
    let match: RegExpExecArray | null;

    while ((match = citationPattern.exec(response)) !== null) {
      const num = parseInt(match[1], 10);
      if (seen.has(num)) continue;
      seen.add(num);

      const idx = num - 1; // [1] → narratives[0]
      if (idx >= 0 && idx < narratives.length) {
        const chunk = narratives[idx];
        // Detect actual source type from chunk metadata
        const isUploadedDoc =
          (chunk as any).source === 'user_document' ||
          (chunk as any).sourceType === 'USER_UPLOAD' ||
          chunk.metadata?.filingType === 'uploaded-document' ||
          chunk.metadata?.sectionType === 'uploaded-document';
        const citationType = isUploadedDoc ? 'user_document' : 'sec_filing';
        const citationSourceType = isUploadedDoc ? 'USER_UPLOAD' : 'SEC_FILING';

        citations.push({
          id: `citation-${num}`,
          number: num,
          citationNumber: num,
          type: citationType as Citation['type'],
          sourceType: citationSourceType as Citation['sourceType'],
          title: `${chunk.metadata.ticker?.toUpperCase() ?? ''} ${chunk.metadata.sectionType ?? ''} ${chunk.metadata.fiscalPeriod ?? ''}`.trim(),
          content: chunk.content.substring(0, 500),
          excerpt: chunk.content.substring(0, 500), // Add excerpt for modal display
          metadata: {
            ticker: chunk.metadata.ticker,
            documentType: chunk.metadata.documentType,
            filingType: chunk.metadata.filingType,
            fiscalPeriod: chunk.metadata.fiscalPeriod,
            pageNumber: chunk.metadata.pageNumber,
            chunkIndex: chunk.metadata.chunkIndex,
          },
          // Flatten metadata for easier access
          ticker: chunk.metadata.ticker,
          filingType: chunk.metadata.filingType,
          fiscalPeriod: chunk.metadata.fiscalPeriod,
          section: chunk.metadata.sectionType,
          pageNumber: chunk.metadata.pageNumber,
        });
      }
    }

    return citations;
  }

  // ── Fallback & Utilities ────────────────────────────────────────────

  /**
   * Build a fallback result when Bedrock invocation fails.
   * Returns a raw metrics table with an error notice so the analyst
   * still gets data even if synthesis is unavailable.
   */
  private buildFallbackResult(ctx: FinancialAnalysisContext): SynthesisResult {
    const metricsTable = this.formatMetricsTable(ctx.metrics, ctx.computedResults);
    const answer = [
      '⚠️ Synthesis temporarily unavailable. Here is the raw data:',
      '',
      metricsTable || 'No quantitative data available.',
    ].join('\n');

    return {
      answer,
      usage: { inputTokens: 0, outputTokens: 0 },
      citations: [],
      responseType: this.classifyResponseType(ctx),
    };
  }

  /**
   * Truncate prompt to stay within token budget.
   * Narratives are trimmed first (oldest removed) before other sections.
   */
  private truncatePrompt(prompt: string): string {
    if (prompt.length <= MAX_PROMPT_CHARS) return prompt;

    this.logger.warn(
      `Prompt exceeds ${MAX_PROMPT_CHARS} chars (${prompt.length}), truncating`,
    );

    // Simple truncation: cut from the end, preserving the instruction block
    const instructionIdx = prompt.lastIndexOf('=== INSTRUCTIONS ===');
    if (instructionIdx > 0) {
      const instructions = prompt.substring(instructionIdx);
      const dataSection = prompt.substring(0, MAX_PROMPT_CHARS - instructions.length - 50);
      return dataSection + '\n\n[... data truncated for token budget ...]\n\n' + instructions;
    }

    return prompt.substring(0, MAX_PROMPT_CHARS) + '\n\n[... truncated ...]';
  }

  /**
   * Find the most interesting divergence between the subject ticker and a named peer.
   * Returns the peer with the largest absolute gap from the subject, along with
   * concrete values for use in the grounded provocation template (Req 18.2).
   */
  findMostInterestingDivergence(peerData: PeerComparisonResult): {
    peerTicker: string;
    peerValue: number;
    subjectValue: number;
    metric: string;
    period: string;
  } | null {
    if (!peerData.subjectTicker || peerData.rows.length < 2) return null;

    const subjectRow = peerData.rows.find(r => r.ticker === peerData.subjectTicker);
    if (!subjectRow || subjectRow.value == null) return null;

    let bestPeer: { ticker: string; value: number } | null = null;
    let bestGap = -1;

    for (const row of peerData.rows) {
      if (row.ticker === peerData.subjectTicker) continue;
      if (row.value == null) continue;

      const gap = Math.abs(row.value - subjectRow.value);
      if (gap > bestGap) {
        bestGap = gap;
        bestPeer = { ticker: row.ticker, value: row.value };
      }
    }

    if (!bestPeer) return null;

    return {
      peerTicker: bestPeer.ticker,
      peerValue: bestPeer.value,
      subjectValue: subjectRow.value,
      metric: peerData.metric,
      period: peerData.period,
    };
  }


  /** Convert snake_case to Title Case */
  private formatMetricLabel(metric: string): string {
    return metric
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** Format a numeric value with appropriate precision */
  /** Format a numeric value with appropriate precision, using MetricRegistry output_format */
    private formatValue(value: number, metricId: string): string {
      if (value == null || typeof value !== 'number' || isNaN(value)) return String(value ?? 'N/A');

      // Look up output_format from the MetricRegistry (authoritative source)
      const metricDef = this.metricRegistry?.getMetricById(metricId);
      const outputFormat = metricDef?.output_format;

      if (outputFormat === 'percentage') {
        // Margins/rates from MetricsSummary are stored as decimals (0.48 = 48%)
        // Values with abs < 1 are decimals that need *100; values >= 1 are already percentages
        const pctValue = Math.abs(value) < 1 ? value * 100 : value;
        return `${pctValue.toFixed(1)}%`;
      }
      if (outputFormat === 'ratio') {
        return `${value.toFixed(2)}x`;
      }
      if (outputFormat === 'days') {
        return `${value.toFixed(0)} days`;
      }
      if (outputFormat === 'currency_per_share') {
        return `$${value.toFixed(2)}`;
      }
      if (outputFormat === 'currency') {
        return this.formatCurrency(value);
      }

      // Fallback: no registry match — use metric name heuristics
      const lower = metricId.toLowerCase();
      if (/margin|pct|yield/.test(lower)) {
        // Likely a percentage stored as decimal
        const pctValue = Math.abs(value) < 1 ? value * 100 : value;
        return `${pctValue.toFixed(1)}%`;
      }
      if (/growth|cagr/.test(lower)) {
        const pctValue = Math.abs(value) < 1 ? value * 100 : value;
        return `${pctValue.toFixed(1)}%`;
      }
      if (/ratio|multiple|turnover/.test(lower)) {
        return `${value.toFixed(2)}x`;
      }

      // Default: magnitude-based currency formatting
      return this.formatCurrency(value);
    }

  /** Format a currency value with B/M/K suffixes */
  private formatCurrency(value: number): string {
    if (Math.abs(value) >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(2)}B`;
    }
    if (Math.abs(value) >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2)}M`;
    }
    if (Math.abs(value) >= 1_000) {
      return `${(value / 1_000).toFixed(2)}K`;
    }
    return value.toFixed(2);
  }
}
