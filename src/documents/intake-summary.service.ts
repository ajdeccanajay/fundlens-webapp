/**
 * Intake Summary Service — Spec §12
 *
 * Generates a natural language intake summary when a document finishes
 * extraction (Tier 2 ready). Served as the first response to the analyst.
 *
 * Uses Sonnet with extracted metadata + headline metrics to produce
 * a 3-5 sentence conversational summary.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from '../rag/bedrock.service';

export interface IntakeSummaryInput {
  documentId: string;
  tenantId: string;
  fileName: string;
  documentType: string;
  reportingEntity?: string;
  ticker?: string;
  filingPeriod?: string;
  pageCount?: number;
  metricCount: number;
  chunkCount: number;
  topMetrics?: { name: string; value: number; unit?: string; period?: string }[];
  notableItems?: { severity: string; description: string }[];
  sections?: string[];
}

@Injectable()
export class IntakeSummaryService {
  private readonly logger = new Logger(IntakeSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bedrock: BedrockService,
  ) {}

  /**
   * Generate and persist an intake summary for a processed document.
   */
  async generate(input: IntakeSummaryInput): Promise<string> {
    const startTime = Date.now();

    try {
      const prompt = this.buildPrompt(input);
      const summary = await this.bedrock.invokeClaude({
        prompt,
        systemPrompt: INTAKE_SYSTEM_PROMPT,
        modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
        max_tokens: 512,
        temperature: 0.0,
      });

      // Persist to intel_documents.intake_summary
      await this.prisma.$executeRawUnsafe(
        `UPDATE intel_documents SET intake_summary = $1, updated_at = NOW()
         WHERE document_id = $2::uuid`,
        summary.trim(),
        input.documentId,
      );

      this.logger.log(
        `[${input.documentId}] Intake summary generated (${Date.now() - startTime}ms)`,
      );
      return summary.trim();
    } catch (err) {
      this.logger.warn(`[${input.documentId}] Intake summary generation failed: ${err.message}`);
      // Fallback: generate a simple summary without LLM
      const fallback = this.fallbackSummary(input);
      await this.prisma.$executeRawUnsafe(
        `UPDATE intel_documents SET intake_summary = $1, updated_at = NOW()
         WHERE document_id = $2::uuid`,
        fallback,
        input.documentId,
      ).catch(() => {});
      return fallback;
    }
  }

  private buildPrompt(input: IntakeSummaryInput): string {
    const metricsSection = input.topMetrics?.length
      ? input.topMetrics.map(m =>
          `- ${m.name}: ${m.value}${m.unit ? ` ${m.unit}` : ''}${m.period ? ` (${m.period})` : ''}`,
        ).join('\n')
      : 'No headline metrics extracted.';

    const notableSection = input.notableItems?.length
      ? input.notableItems.map(n => `- [${n.severity}] ${n.description}`).join('\n')
      : 'None.';

    return `Document: ${input.fileName}
Type: ${input.documentType || 'Unknown'}
Company: ${input.reportingEntity || 'Unknown'}${input.ticker ? ` (${input.ticker})` : ''}
Period: ${input.filingPeriod || 'Not specified'}
Pages: ${input.pageCount || 'N/A'}
Metrics Extracted: ${input.metricCount}
Chunks Indexed: ${input.chunkCount}

Headline Metrics:
${metricsSection}

Sections Found: ${input.sections?.join(', ') || 'General content'}

Notable Items:
${notableSection}`;
  }

  private fallbackSummary(input: IntakeSummaryInput): string {
    const entity = input.reportingEntity || input.ticker || 'the company';
    const type = input.documentType || 'document';
    return `I've processed ${entity}'s ${type} (${input.fileName}). ` +
      `Extracted ${input.metricCount} metrics and indexed ${input.chunkCount} searchable sections. ` +
      `What would you like to explore?`;
  }
}

const INTAKE_SYSTEM_PROMPT = `You are FundLens Research Assistant. A document has just been processed. Generate a concise intake summary for the analyst.

Write a 3-5 sentence natural language summary a financial analyst would find useful. Lead with the most important finding. If there are notable items (material weakness, restatement, going concern), mention them prominently. End with a prompt: "What would you like to explore?"

Do NOT use bullet points. Write in conversational prose. Be specific about numbers when available.`;
