import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from '../rag/bedrock.service';
import { S3Service } from '../services/s3.service';
import { BackgroundEnrichmentService } from './background-enrichment.service';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';

// pdf-parse v2.x exports PDFParse class
const { PDFParse } = require('pdf-parse');

/**
 * Spec §3.1 — Instant Intelligence Prompt (Haiku)
 * Single LLM call: classification + headline extraction + suggested questions
 */
const INSTANT_INTELLIGENCE_PROMPT = `You are a financial document classifier and headline extractor.
Given the first 2-3 pages of a document, return a JSON response with:

1. documentType: one of [sell-side-report, ic-memo, pe-cim, earnings-transcript,
   sec-10k, sec-10q, sec-8k, sec-proxy, fund-mandate, spreadsheet, presentation, generic]
2. companyName: the primary company this document is about
3. ticker: the stock ticker if identifiable
4. summary: a 1-sentence description (e.g., "Goldman Sachs initiating coverage on Apple Inc.")
5. metrics: array of headline metrics visible on the first pages. For each:
   - metric_key: canonical name (price_target, rating, revenue, ebitda, etc.)
   - raw_value: as displayed ("$275", "Overweight", "$391.0B")
   - numeric_value: parsed number or null
   - period: if identifiable (FY2024E, Q3 2024, LTM, etc.)
   - is_estimate: true if analyst estimate, false if reported actual
6. suggestedQuestions: 3 questions an analyst would likely ask about this document

Respond with ONLY valid JSON. No markdown, no explanation.

Document text:
{{FIRST_PAGES}}`;

/** Result of instant intelligence extraction (spec §3.1) */
export interface InstantIntelligenceResult {
  documentId: string;
  documentType: string;
  companyName: string | null;
  ticker: string | null;
  summary: string;
  headlineMetrics: HeadlineMetric[];
  suggestedQuestions: string[];
  fileName: string;
}

export interface HeadlineMetric {
  metric_key: string;
  raw_value: string;
  numeric_value: number | null;
  period: string | null;
  is_estimate: boolean;
}

/** Document status for polling endpoint (user feedback addition) */
export interface DocumentStatus {
  documentId: string;
  status: 'uploading' | 'queryable' | 'fully-indexed' | 'error';
  processingMode: string | null;
  documentType: string | null;
  chunkCount: number | null;
  metricCount: number | null;
  error: string | null;
  updatedAt: Date;
}

@Injectable()
export class DocumentIntelligenceService {
  private readonly logger = new Logger(DocumentIntelligenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bedrock: BedrockService,
    private readonly s3: S3Service,
    @Inject(forwardRef(() => BackgroundEnrichmentService))
    private readonly backgroundEnrichment: BackgroundEnrichmentService,
  ) {}

  /**
   * Spec §3.1 — Phase A: Instant Intelligence (0-5 seconds, BLOCKING)
   * The user WAITS for this. Must complete in < 5 seconds.
   *
   * Steps:
   *   1. Parse raw text (pdf-parse/mammoth/xlsx) — < 2s
   *   2. Haiku classification + headline extraction — < 3s
   *   3. Store raw text for long-context fallback
   *   4. Persist headline metrics to document_extractions
   */
  async processInstantIntelligence(
    documentId: string,
    s3Key: string,
    fileType: string,
    fileName: string,
    tenantId: string,
    dealId: string,
  ): Promise<InstantIntelligenceResult> {
    const startTime = Date.now();

    // Step 1: Parse raw text (< 2 seconds)
    const rawText = await this.extractText(s3Key, fileType);
    const hasTextLayer = rawText.length > 100;
    this.logger.log(
      `[${documentId}] Text extracted: ${rawText.length} chars, hasTextLayer=${hasTextLayer} (${Date.now() - startTime}ms)`,
    );

    // Step 2: Haiku classification + headline extraction (< 3 seconds)
    const firstPages = rawText.substring(0, 8000); // ~first 2-3 pages
    const headline = await this.classifyAndExtract(firstPages);
    this.logger.log(
      `[${documentId}] Classified as ${headline.documentType} (${Date.now() - startTime}ms)`,
    );

    // Step 3: Store raw text for long-context fallback
    const rawTextS3Key = `extracted/${tenantId}/${dealId}/${documentId}/raw_text.txt`;
    await this.s3.uploadBuffer(
      Buffer.from(rawText, 'utf-8'),
      rawTextS3Key,
      'text/plain',
    );

    // Step 4: Update document record — now queryable via long-context fallback
    await this.prisma.$executeRawUnsafe(
      `UPDATE intel_documents SET
        status = 'queryable',
        processing_mode = 'long-context-fallback',
        document_type = $1,
        raw_text_s3_key = $2,
        company_ticker = $3,
        company_name = $4,
        page_count = $5,
        updated_at = NOW()
      WHERE document_id = $6::uuid`,
      headline.documentType,
      rawTextS3Key,
      headline.ticker,
      headline.companyName,
      this.estimatePageCount(rawText),
      documentId,
    );

    // Step 5: Persist headline metrics to document_extractions
    if (headline.metrics?.length > 0) {
      await this.persistHeadlineMetrics(
        documentId,
        tenantId,
        dealId,
        headline.metrics,
      );
    }

    this.logger.log(
      `[${documentId}] Instant intelligence complete in ${Date.now() - startTime}ms`,
    );

    // Phase B: Fire background enrichment asynchronously (non-blocking)
    // User is already querying via long-context fallback while this runs
    setImmediate(() => {
      this.backgroundEnrichment
        .enrichDocument(documentId, tenantId, dealId)
        .catch(err =>
          this.logger.error(`[${documentId}] Background enrichment failed: ${err.message}`),
        );
    });

    return {
      documentId,
      documentType: headline.documentType,
      companyName: headline.companyName,
      ticker: headline.ticker,
      summary: headline.summary,
      headlineMetrics: headline.metrics || [],
      suggestedQuestions: headline.suggestedQuestions || [],
      fileName,
    };
  }

  /**
   * Get document status — polling endpoint (user feedback addition)
   */
  async getDocumentStatus(documentId: string): Promise<DocumentStatus | null> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT document_id, status, processing_mode, document_type,
             chunk_count, metric_count, error, updated_at
      FROM intel_documents
      WHERE document_id = ${documentId}::uuid
    `;
    if (!rows.length) return null;
    const r = rows[0];
    return {
      documentId: r.document_id,
      status: r.status,
      processingMode: r.processing_mode,
      documentType: r.document_type,
      chunkCount: r.chunk_count,
      metricCount: r.metric_count,
      error: r.error,
      updatedAt: r.updated_at,
    };
  }

  /**
   * Create a presigned upload URL + document record (spec §10.1 step 1)
   */
  async createUploadUrl(params: {
    fileName: string;
    fileType: string;
    fileSize: number;
    tenantId: string;
    dealId: string;
    chatSessionId?: string;
    uploadSource: 'chat' | 'deal-library';
  }): Promise<{ uploadUrl: string; documentId: string }> {
    // Generate document ID
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT gen_random_uuid()::text as id
    `;
    const documentId = rows[0].id;

    // S3 key per spec §6.3
    const s3Key = `raw-uploads/${params.tenantId}/${params.dealId}/${documentId}/${params.fileName}`;

    // Insert document record
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO intel_documents (
        document_id, tenant_id, deal_id, chat_session_id,
        file_name, file_type, file_size, s3_key,
        status, upload_source, created_at, updated_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
        $5, $6, $7, $8,
        'uploading', $9, NOW(), NOW())`,
      documentId,
      params.tenantId,
      params.dealId,
      params.chatSessionId || null,
      params.fileName,
      params.fileType,
      params.fileSize,
      s3Key,
      params.uploadSource,
    );

    // Generate presigned PUT URL
    const uploadUrl = await this.s3.getSignedUploadUrl(s3Key, params.fileType);

    return { uploadUrl, documentId };
  }

  // ─── Private helpers ───────────────────────────────────────────

  /**
   * Extract text from uploaded file (spec §3.1 step 1)
   * Uses pdf-parse for PDFs, mammoth for DOCX, xlsx for spreadsheets.
   * NO external API calls — all local processing.
   */
  private async extractText(s3Key: string, fileType: string): Promise<string> {
    const buffer = await this.s3.getFileBuffer(s3Key);

    if (fileType.includes('pdf')) {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return result.text || '';
    }

    if (
      fileType.includes('wordprocessingml') ||
      fileType.includes('docx') ||
      fileType.includes('msword')
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    }

    if (
      fileType.includes('spreadsheetml') ||
      fileType.includes('xlsx') ||
      fileType.includes('csv')
    ) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const texts: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        texts.push(`Sheet: ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}`);
      }
      return texts.join('\n\n');
    }

    if (fileType.includes('text') || fileType.includes('csv')) {
      return buffer.toString('utf-8');
    }

    // Images — no text extraction, will rely on vision in Phase B
    if (fileType.includes('image')) {
      return '';
    }

    // Fallback: try as text
    return buffer.toString('utf-8');
  }

  /**
   * Classify document + extract headline metrics via Haiku (spec §3.2)
   * Single LLM call combining classification AND headline extraction.
   * Uses Haiku for speed — 5-second budget demands it.
   */
  private async classifyAndExtract(firstPages: string): Promise<{
    documentType: string;
    companyName: string | null;
    ticker: string | null;
    summary: string;
    metrics: HeadlineMetric[];
    suggestedQuestions: string[];
  }> {
    const prompt = INSTANT_INTELLIGENCE_PROMPT.replace(
      '{{FIRST_PAGES}}',
      firstPages,
    );

    try {
      const response = await this.bedrock.invokeClaude({
        prompt,
        modelId: 'us.anthropic.claude-3-haiku-20240307-v1:0',
        max_tokens: 1024,
        temperature: 0,
      });

      // Parse JSON response — strip any markdown fencing
      const cleaned = response
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);

      return {
        documentType: parsed.documentType || 'generic',
        companyName: parsed.companyName || null,
        ticker: parsed.ticker || null,
        summary: parsed.summary || 'Document uploaded',
        metrics: (parsed.metrics || []).map((m: any) => ({
          metric_key: m.metric_key || m.metricKey || 'unknown',
          raw_value: m.raw_value || m.rawValue || '',
          numeric_value: m.numeric_value ?? m.numericValue ?? null,
          period: m.period || null,
          is_estimate: m.is_estimate ?? m.isEstimate ?? false,
        })),
        suggestedQuestions: parsed.suggestedQuestions || [],
      };
    } catch (err) {
      this.logger.warn(`Classification failed, using fallback: ${err.message}`);
      return {
        documentType: 'generic',
        companyName: null,
        ticker: null,
        summary: 'Document uploaded — classification unavailable',
        metrics: [],
        suggestedQuestions: [
          'What is this document about?',
          'What are the key takeaways?',
          'Are there any financial metrics mentioned?',
        ],
      };
    }
  }

  /**
   * Persist headline metrics to document_extractions (spec §3.1 step 4)
   */
  private async persistHeadlineMetrics(
    documentId: string,
    tenantId: string,
    dealId: string,
    metrics: HeadlineMetric[],
  ): Promise<void> {
    for (const metric of metrics) {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO intel_document_extractions (
          document_id, tenant_id, deal_id,
          extraction_type, data, confidence, verified, source_layer, created_at
        ) VALUES ($1::uuid, $2::uuid, $3::uuid,
          'headline', $4::jsonb, 0.90, false, 'headline', NOW())`,
        documentId,
        tenantId,
        dealId,
        JSON.stringify(metric),
      );
    }

    // Update metric count on document
    await this.prisma.$executeRawUnsafe(
      `UPDATE intel_documents SET metric_count = $1 WHERE document_id = $2::uuid`,
      metrics.length,
      documentId,
    );
  }

  private estimatePageCount(text: string): number {
    // ~3000 chars per page is a reasonable estimate for financial docs
    return Math.max(1, Math.ceil(text.length / 3000));
  }
}
