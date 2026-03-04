import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from '../rag/bedrock.service';
import { S3Service } from '../services/s3.service';
import { BackgroundEnrichmentService } from './background-enrichment.service';
import { VisionExtractionService } from './vision-extraction.service';
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
   CLASSIFICATION HINTS:
   - If the document has a price target, rating (Buy/Sell/Hold/Overweight/Underweight), or analyst estimates, it is almost certainly a "sell-side-report"
   - If the filename contains "SS", "Research", "Report", "Initiation", "Coverage", or a broker/bank name (e.g., DBS, Goldman, Morgan Stanley, JPM, Citi, Barclays, UBS), classify as "sell-side-report"
   - Only classify as sec-10k or sec-10q if the document explicitly references SEC filing headers (e.g., "UNITED STATES SECURITIES AND EXCHANGE COMMISSION", "Form 10-K", "Form 10-Q")
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

{{FILENAME_HINT}}Document text:
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
    @Optional() private readonly visionExtraction: VisionExtractionService,
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
    const headline = await this.classifyAndExtract(firstPages, fileName);
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

    // Phase B: Background enrichment (chunking, embedding, vision, KB sync)
    // Vision extraction is ALWAYS scheduled for PDFs — financial tables in analyst
    // reports are rendered as positioned graphics that pdfplumber can't extract.
    // Without vision, long-context-fallback queries miss critical data.
    // Full enrichment (chunking, embedding, KB sync) requires ENABLE_BACKGROUND_ENRICHMENT=true.
    const isPdf = fileType?.includes('pdf') || fileName?.toLowerCase().endsWith('.pdf');
    if (process.env.ENABLE_BACKGROUND_ENRICHMENT === 'true') {
      // Full enrichment: vision + chunking + embedding + KB sync
      const delayMs = parseInt(process.env.ENRICHMENT_DELAY_MS || '30000', 10);
      setTimeout(() => {
        this.backgroundEnrichment
          .enrichDocument(documentId, tenantId, dealId)
          .catch(err =>
            this.logger.error(`[${documentId}] Background enrichment failed: ${err.message}`),
          );
      }, delayMs);
      this.logger.log(`[${documentId}] Background enrichment scheduled in ${delayMs}ms`);
    } else if (isPdf && this.visionExtraction) {
      // Vision-only extraction: extract financial tables from PDF pages
      // and store as vision_text.txt alongside raw_text.txt.
      // This runs even on local dev (4GB heap) because it's a single
      // Bedrock call per batch, not the full chunking+embedding pipeline.
      const visionDelayMs = parseInt(process.env.VISION_DELAY_MS || '5000', 10);
      setTimeout(async () => {
        try {
          this.logger.log(`[${documentId}] Starting vision-only extraction for PDF`);
          const keyPages = this.visionExtraction.identifyKeyPages(rawText, headline.documentType);
          if (keyPages.length === 0) {
            this.logger.log(`[${documentId}] No key pages identified for vision extraction`);
            return;
          }
          this.logger.log(`[${documentId}] Vision: ${keyPages.length} key pages identified`);

          const visionResults = await this.visionExtraction.extractFromPages(
            s3Key, keyPages, headline.documentType,
          );

          if (visionResults.length > 0) {
            // Store vision text to S3
            const visionText = this.visionExtraction.visionResultsToText(visionResults);
            if (visionText.length > 100) {
              const visionTextS3Key = rawTextS3Key.replace(/raw_text\.txt$/, 'vision_text.txt');
              await this.s3.uploadBuffer(
                Buffer.from(visionText, 'utf-8'),
                visionTextS3Key,
                'text/plain',
              );
              await this.prisma.$executeRawUnsafe(
                `UPDATE intel_documents SET vision_text_s3_key = $1, updated_at = NOW()
                 WHERE document_id = $2::uuid`,
                visionTextS3Key,
                documentId,
              );
              this.logger.log(`[${documentId}] Vision text stored: ${visionText.length} chars → ${visionTextS3Key}`);
            }

            // Also persist extracted metrics
            const flatMetrics = this.visionExtraction.flattenMetrics(visionResults);
            for (const metric of flatMetrics) {
              await this.prisma.$executeRawUnsafe(
                `INSERT INTO intel_document_extractions (
                  id, document_id, tenant_id, extraction_type, data,
                  confidence, page_number, extraction_mode, created_at
                ) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'metric', $3::jsonb, $4, $5, 'pdf-native', NOW())`,
                documentId, tenantId,
                JSON.stringify(metric),
                typeof metric.confidence === 'number' ? metric.confidence : (metric.confidence === 'high' ? 0.90 : 0.70),
                metric.page_number || null,
              ).catch(e => this.logger.warn(`[${documentId}] Vision metric persist failed: ${e.message}`));
            }
            this.logger.log(`[${documentId}] Vision-only extraction complete: ${flatMetrics.length} metrics, ${visionText.length} chars text`);
          }
        } catch (err) {
          this.logger.warn(`[${documentId}] Vision-only extraction failed (non-fatal): ${err.message}`);
        }
      }, visionDelayMs);
      this.logger.log(`[${documentId}] Vision-only extraction scheduled in ${visionDelayMs}ms (ENABLE_BACKGROUND_ENRICHMENT!=true)`);
    } else {
      this.logger.log(`[${documentId}] Background enrichment skipped (ENABLE_BACKGROUND_ENRICHMENT!=true${isPdf ? ', no vision service' : ', not PDF'}). Document queryable via long-context fallback.`);
    }

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
        status, upload_source, upload_method, created_at, updated_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
        $5, $6, $7, $8,
        'uploading', $9, 'presigned', NOW(), NOW())`,
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
   *
   * Memory-conscious: checks file size before loading, caps buffer,
   * and nulls references promptly so GC can reclaim.
   */
  private async extractText(s3Key: string, fileType: string): Promise<string> {
    // Check file size first to avoid loading huge files into memory
    let fileSize = 0;
    try {
      const meta = await this.s3.getFileMetadata(s3Key);
      fileSize = meta.size;
    } catch {
      // If metadata check fails, proceed with load (will fail there if missing)
    }

    // Cap at 100MB — anything larger is likely not a document we can process
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    if (fileSize > MAX_FILE_SIZE) {
      this.logger.warn(`File ${s3Key} is ${(fileSize / 1024 / 1024).toFixed(1)}MB — exceeds 100MB limit, skipping text extraction`);
      return '';
    }

    let buffer = await this.s3.getFileBuffer(s3Key);
    let text = '';

    try {
      if (fileType.includes('pdf')) {
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        text = result.text || '';
      } else if (
        fileType.includes('wordprocessingml') ||
        fileType.includes('docx') ||
        fileType.includes('msword')
      ) {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value || '';
      } else if (
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
        text = texts.join('\n\n');
      } else if (fileType.includes('text') || fileType.includes('csv')) {
        text = buffer.toString('utf-8');
      } else if (fileType.includes('image')) {
        // Images — no text extraction, will rely on vision in Phase B
        text = '';
      } else {
        // Fallback: try as text
        text = buffer.toString('utf-8');
      }
    } finally {
      // Release buffer reference immediately so GC can reclaim
      // @ts-ignore — intentional null to free memory
      buffer = null;
    }

    return text;
  }

  /**
   * Classify document + extract headline metrics via Haiku (spec §3.2)
   * Single LLM call combining classification AND headline extraction.
   * Uses Haiku for speed — 5-second budget demands it.
   */
  private async classifyAndExtract(firstPages: string, fileName?: string): Promise<{
    documentType: string;
    companyName: string | null;
    ticker: string | null;
    summary: string;
    metrics: HeadlineMetric[];
    suggestedQuestions: string[];
  }> {
    // Build filename hint for classification
    let filenameHint = '';
    if (fileName) {
      filenameHint = `Filename: "${fileName}"\n`;
    }

    const prompt = INSTANT_INTELLIGENCE_PROMPT
      .replace('{{FILENAME_HINT}}', filenameHint)
      .replace('{{FIRST_PAGES}}', firstPages);

    try {
      const response = await this.bedrock.invokeClaude({
        prompt,
        modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
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
          extraction_type, data, confidence, verified, source_layer, extraction_mode, created_at
        ) VALUES ($1::uuid, $2::uuid, $3::uuid,
          'headline', $4::jsonb, 0.90, false, 'headline', 'headline', NOW())`,
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
