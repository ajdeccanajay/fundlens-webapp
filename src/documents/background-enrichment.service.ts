/**
 * Background Enrichment Service — Serial Pipeline Architecture
 *
 * Runs asynchronously after Phase A (instant intelligence) completes.
 * The user is already querying via long-context fallback while this runs.
 *
 * KEY DESIGN: Each step reads from persistence, does its work, writes to
 * persistence, and explicitly releases all references before the next step.
 * Nothing is held across steps. Peak memory: ~50-100MB vs ~500MB+ concurrent.
 *
 * Pipeline:
 *   Step 1: CHUNK — raw text → financial-aware chunks → DB
 *   Step 2: EMBED — chunks from DB in batches of 5 → Titan V2 → update DB
 *   Step 3: VISION EXTRACT — PDF pages → Bedrock Claude → extractions DB
 *   Step 4: KB SYNC PREP — chunks from DB (paginated) → S3 kb-ready/
 *   Step 5: FINALIZE — update status, trigger intake summary
 *
 * Concurrency guard: pauses Bedrock calls when user query is in flight.
 * Only enforced when ENRICHMENT_CONCURRENCY_GUARD=true (localhost).
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../services/s3.service';
import { BedrockService } from '../rag/bedrock.service';
import { DocumentChunkingService } from './document-chunking.service';
import { VisionExtractionService, VisionPageResult } from './vision-extraction.service';
import { MetricPersistenceService } from './metric-persistence.service';
import { IntakeSummaryService } from './intake-summary.service';
import { DocumentFlagsPersistenceService, DocumentFlag } from './document-flags-persistence.service';
import { ExcelExtractorService } from './excel-extractor.service';
import { EarningsCallExtractorService } from './earnings-call-extractor.service';
import { CallAnalysisPersistenceService } from './call-analysis-persistence.service';
import { ModelFormulasPersistenceService } from './model-formulas-persistence.service';

@Injectable()
export class BackgroundEnrichmentService {
  private readonly logger = new Logger(BackgroundEnrichmentService.name);

  /**
   * Concurrency guard: prevents Bedrock calls during active user queries.
   * Simple flag — works for single-process local dev.
   * On AWS with multiple ECS tasks, not needed (plenty of memory).
   */
  private queryInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly bedrock: BedrockService,
    private readonly chunking: DocumentChunkingService,
    private readonly visionExtraction: VisionExtractionService,
    private readonly metricPersistence: MetricPersistenceService,
    private readonly intakeSummary: IntakeSummaryService,
    private readonly documentFlagsPersistence: DocumentFlagsPersistenceService,
    private readonly excelExtractor: ExcelExtractorService,
    private readonly earningsExtractor: EarningsCallExtractorService,
    private readonly callAnalysisPersistence: CallAnalysisPersistenceService,
    private readonly modelFormulasPersistence: ModelFormulasPersistenceService,
  ) {}

  // ─── Query Lock API ──────────────────────────────────────────

  markQueryStart(): void {
    this.queryInFlight = true;
  }

  markQueryEnd(): void {
    this.queryInFlight = false;
  }

  private async waitForQuerySlot(stepName: string): Promise<void> {
    // Only enforce on memory-constrained environments
    if (process.env.ENRICHMENT_CONCURRENCY_GUARD !== 'true') return;

    let waited = 0;
    while (this.queryInFlight) {
      if (waited === 0) {
        this.logger.log(`[${stepName}] Waiting for active query to complete...`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      waited += 500;
      if (waited > 30_000) {
        this.logger.warn(`[${stepName}] Query lock held for 30s, proceeding anyway`);
        break;
      }
    }
  }

  // ─── Main Entry Point ────────────────────────────────────────

  /**
   * Main entry point. Runs the full enrichment pipeline serially.
   * Each step is isolated — reads from DB/S3, writes to DB/S3, releases.
   */
  async enrichDocument(
    documentId: string,
    tenantId: string,
    dealId: string,
  ): Promise<void> {
    const pipelineStart = Date.now();
    this.logger.log(`━━━ Starting enrichment pipeline for ${documentId} ━━━`);

    // Memory check: log heap usage and skip if dangerously high
    const heapBefore = process.memoryUsage();
    const heapUsedMB = heapBefore.heapUsed / (1024 * 1024);
    const heapTotalMB = heapBefore.heapTotal / (1024 * 1024);
    this.logger.log(`[${documentId}] Heap before enrichment: ${heapUsedMB.toFixed(0)}MB used / ${heapTotalMB.toFixed(0)}MB total`);

    // If heap is already above 80% of a 4GB limit, skip enrichment to avoid OOM
    if (heapUsedMB > 3200) {
      this.logger.warn(`[${documentId}] Skipping enrichment — heap ${heapUsedMB.toFixed(0)}MB > 3200MB safety limit`);
      return;
    }

    // Hint GC to reclaim before starting heavy work
    if (global.gc) {
      global.gc();
      this.logger.log(`[${documentId}] GC triggered before enrichment`);
    }

    // Fetch document record once for routing decisions
    const doc = await this.fetchDocumentRecord(documentId, tenantId);
    if (!doc) {
      this.logger.error(`[${documentId}] Document not found for enrichment`);
      return;
    }

    const time = async <T>(stepName: string, fn: () => Promise<T>): Promise<T> => {
      const start = Date.now();
      try {
        const result = await fn();
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        this.logger.log(`  ✅ ${stepName}: ${elapsed}s`);
        return result;
      } catch (error) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        this.logger.error(`  ❌ ${stepName}: ${elapsed}s — ${error.message}`);
        throw error;
      }
    };

    try {
      // Pre-step: Type-specific extraction (Excel, Earnings Call)
      await time('Step 0/5 Type-Specific', () =>
        this.stepTypeSpecificExtraction(documentId, tenantId, doc),
      ).catch(err => {
        this.logger.warn(`[${documentId}] Type-specific extraction failed (non-fatal): ${err.message}`);
      });

      // Step 1: CHUNK
      const chunkCount = await time('Step 1/5 Chunk', () =>
        this.stepChunk(documentId, tenantId, dealId, doc),
      ).catch(() => 0);

      // Step 2: EMBED (respects query lock)
      const embedCount = await time('Step 2/5 Embed', () =>
        this.stepEmbed(documentId, tenantId, dealId),
      ).catch(() => 0);

      // Step 3: VISION EXTRACT (respects query lock)
      const visionMode = await time('Step 3/5 Vision', () =>
        this.stepVisionExtract(documentId, tenantId, doc),
      ).catch(() => 'skipped');

      // Step 3b: Metric persistence (resolves JSONB → canonical IDs)
      await time('Step 3b Metric Persist', () =>
        this.stepMetricPersistence(documentId, tenantId),
      ).catch(err => {
        this.logger.warn(`[${documentId}] Metric persistence failed (non-fatal): ${err.message}`);
      });

      // Step 4: KB SYNC PREP
      const kbCount = await time('Step 4/5 KB Sync', () =>
        this.stepKBSyncPrep(documentId, tenantId, dealId, doc),
      ).catch(() => 0);

      // Step 5: FINALIZE
      await time('Step 5/5 Finalize', () =>
        this.stepFinalize(documentId, tenantId, doc, embedCount, chunkCount),
      );

      const totalElapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1);
      this.logger.log(`━━━ Enrichment complete for ${documentId}: ${totalElapsed}s total ━━━`);
    } catch (error) {
      this.logger.error(
        `[${documentId}] Background enrichment failed: ${error.message}`,
        error.stack,
      );
      await this.prisma.$executeRawUnsafe(
        `UPDATE intel_documents SET
          error = $1, retry_count = retry_count + 1, updated_at = NOW()
        WHERE document_id = $2::uuid`,
        `Background enrichment failed: ${error.message}`,
        documentId,
      ).catch(() => {});
    }
  }

  // ─── STEP 0: Type-Specific Extraction ──────────────────────

  private async stepTypeSpecificExtraction(
    documentId: string,
    tenantId: string,
    doc: DocumentRecord,
  ): Promise<void> {
    const isExcel = doc.file_type?.includes('spreadsheet') ||
      doc.file_type?.includes('excel') ||
      doc.file_name?.match(/\.xlsx?$/i);
    const isEarningsCall = doc.document_type === 'earnings_transcript' ||
      doc.document_type === 'earnings_call' ||
      /earnings\s*call|transcript/i.test(doc.file_name || '');

    // ── Excel extraction ──
    if (isExcel) {
      this.logger.log(`[${documentId}] Routing to Excel extractor`);
      const fileBuffer = await this.s3.getFileBuffer(doc.s3_key);
      const excelResult = await this.excelExtractor.extract(
        fileBuffer,
        doc.file_name || 'model.xlsx',
        doc.company_ticker ?? undefined,
      );

      for (const metric of excelResult.metrics) {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO intel_document_extractions (
            id, document_id, tenant_id, extraction_type, data,
            confidence, page_number, created_at
          ) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'metric', $3::jsonb, 0.90, NULL, NOW())`,
          documentId, tenantId,
          JSON.stringify({
            metric_key: metric.canonicalHint || metric.metricName,
            raw_value: String(metric.value),
            numeric_value: metric.value,
            period: metric.period,
            context: metric.context,
            source_sheet: metric.sourceSheet,
            source_cell: metric.sourceCell,
            has_formula: metric.hasFormula,
          }),
        ).catch(() => {});
      }

      // Store Excel text chunks as raw_text override for chunking step
      const excelText = excelResult.textChunks.map(c => c.content).join('\n\n');
      if (excelText.length > 100) {
        const rawTextKey = `extracted/${tenantId}/${doc.deal_id}/${documentId}/raw_text.txt`;
        await this.s3.uploadBuffer(Buffer.from(excelText, 'utf-8'), rawTextKey, 'text/plain');
        await this.prisma.$executeRawUnsafe(
          `UPDATE intel_documents SET raw_text_s3_key = $1 WHERE document_id = $2::uuid`,
          rawTextKey, documentId,
        );
      }

      if (excelResult.formulaGraph.length > 0) {
        await this.modelFormulasPersistence.persist(documentId, tenantId, excelResult.formulaGraph)
          .catch(e => this.logger.warn(`[${documentId}] Formula persistence failed: ${e.message}`));
      }

      this.logger.log(
        `[${documentId}] Excel: ${excelResult.metrics.length} metrics, ${excelResult.tables.length} tables`,
      );
    }

    // ── Earnings call extraction ──
    if (isEarningsCall) {
      let rawText: string | null = null;
      if (doc.raw_text_s3_key) {
        const buf = await this.s3.getFileBuffer(doc.raw_text_s3_key);
        rawText = buf.toString('utf-8');
      }
      if (!rawText || rawText.length < 500) return;

      this.logger.log(`[${documentId}] Routing to Earnings Call extractor`);
      const earningsResult = await this.earningsExtractor.extract(
        rawText, doc.company_name || doc.file_name || 'Unknown', doc.company_ticker || '',
      );
      rawText = null; // Release

      for (const metric of earningsResult.allMetrics) {
        if (metric.value == null) continue;
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO intel_document_extractions (
            id, document_id, tenant_id, extraction_type, data,
            confidence, page_number, created_at
          ) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'metric', $3::jsonb, 0.70, NULL, NOW())`,
          documentId, tenantId,
          JSON.stringify({
            metric_key: metric.canonicalHint || metric.metricName,
            raw_value: String(metric.value),
            numeric_value: metric.value,
            period: metric.period,
            context: metric.context,
            speaker: metric.speaker,
          }),
        ).catch(() => {});
      }

      if (earningsResult.toneAnalysis.overallConfidence > 0) {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO intel_document_extractions (
            id, document_id, tenant_id, extraction_type, data, confidence, created_at
          ) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'tone_analysis', $3::jsonb, 0.90, NOW())`,
          documentId, tenantId, JSON.stringify(earningsResult.toneAnalysis),
        ).catch(() => {});
      }

      for (const flag of earningsResult.redFlags) {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO intel_document_extractions (
            id, document_id, tenant_id, extraction_type, data, confidence, created_at
          ) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'red_flag', $3::jsonb, $4, NOW())`,
          documentId, tenantId, JSON.stringify(flag),
          flag.severity === 'high' ? 0.90 : 0.70,
        ).catch(() => {});
      }

      await this.callAnalysisPersistence.persist(documentId, tenantId, earningsResult)
        .catch(e => this.logger.warn(`[${documentId}] Call analysis persistence failed: ${e.message}`));

      if (earningsResult.redFlags.length > 0) {
        const flags: DocumentFlag[] = earningsResult.redFlags.map(rf => ({
          flagType: 'earnings_red_flag',
          severity: (rf.severity as any) || 'medium',
          description: rf.flag || '',
          evidence: rf.evidence || undefined,
        }));
        await this.documentFlagsPersistence.persist(documentId, tenantId, doc.company_ticker, flags)
          .catch(e => this.logger.warn(`[${documentId}] Document flags persistence failed: ${e.message}`));
      }

      // Store structured earnings chunks as raw_text override
      const earningsChunks = this.earningsExtractor.toChunks(earningsResult);
      const earningsText = earningsChunks.map(c => `## ${c.sectionHeading}\n${c.content}`).join('\n\n');
      if (earningsText.length > 500) {
        const rawTextKey = `extracted/${tenantId}/${doc.deal_id}/${documentId}/raw_text.txt`;
        await this.s3.uploadBuffer(Buffer.from(earningsText, 'utf-8'), rawTextKey, 'text/plain');
        await this.prisma.$executeRawUnsafe(
          `UPDATE intel_documents SET raw_text_s3_key = $1 WHERE document_id = $2::uuid`,
          rawTextKey, documentId,
        );
      }

      this.logger.log(
        `[${documentId}] Earnings: ${earningsResult.qaExchanges.length} Q&A, ` +
        `${earningsResult.allMetrics.length} metrics, ${earningsResult.redFlags.length} red flags`,
      );
    }
  }

  // ─── STEP 1: CHUNK ─────────────────────────────────────────

  private async stepChunk(
    documentId: string,
    tenantId: string,
    dealId: string,
    doc: DocumentRecord,
  ): Promise<number> {
    let rawText: string | null = null;

    try {
      // Re-fetch raw_text_s3_key in case Step 0 updated it
      const freshDoc = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT raw_text_s3_key FROM intel_documents WHERE document_id = $1::uuid`,
        documentId,
      );
      const rawTextKey = freshDoc?.[0]?.raw_text_s3_key || doc.raw_text_s3_key;

      if (!rawTextKey) {
        this.logger.warn(`[${documentId}] No raw text available, skipping chunking`);
        return 0;
      }

      const buf = await this.s3.getFileBuffer(rawTextKey);
      rawText = buf.toString('utf-8');

      if (!rawText || rawText.length < 100) {
        this.logger.warn(`[${documentId}] Raw text too short (${rawText?.length || 0} chars), skipping`);
        return 0;
      }

      // Chunk the text (no vision results — those come in Step 3)
      const chunks = this.chunking.chunk(rawText, [], {
        maxTokens: 600,
        overlap: 100,
        preserveTables: true,
        documentType: doc.document_type || 'generic',
      });

      // Release raw text BEFORE writing chunks
      rawText = null;

      // Write chunks to DB (content only — embeddings come in Step 2)
      for (let i = 0; i < chunks.length; i++) {
        await this.prisma.$executeRaw`
          INSERT INTO intel_document_chunks (
            id, document_id, tenant_id, deal_id,
            chunk_index, content, section_type, page_number,
            token_estimate, created_at
          ) VALUES (
            gen_random_uuid(),
            ${documentId}::uuid,
            ${tenantId}::uuid,
            ${dealId}::uuid,
            ${chunks[i].chunkIndex},
            ${chunks[i].content},
            ${chunks[i].sectionType || 'narrative'},
            ${chunks[i].pageNumber || null},
            ${chunks[i].tokenEstimate},
            NOW()
          )
        `;
      }

      const count = chunks.length;
      return count;
    } catch (error) {
      this.logger.error(`[${documentId}] Chunking failed: ${error.message}`);
      return 0;
    } finally {
      rawText = null;
    }
  }

  // ─── STEP 2: EMBED (batched, with query lock) ─────────────

  private async stepEmbed(
    documentId: string,
    tenantId: string,
    dealId: string,
  ): Promise<number> {
    const BATCH_SIZE = 5;
    let totalEmbedded = 0;

    try {
      // Count total chunks needing embeddings
      const countResult = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*)::int as cnt FROM intel_document_chunks
         WHERE document_id = $1::uuid AND embedding IS NULL`,
        documentId,
      );
      const totalChunks = countResult?.[0]?.cnt || 0;
      if (totalChunks === 0) return 0;

      // Process in small batches — read from DB each time
      let offset = 0;
      while (offset < totalChunks) {
        // Wait if user query is in flight
        await this.waitForQuerySlot('Embed');

        // Read one batch from DB
        const batch = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT id, content, chunk_index FROM intel_document_chunks
           WHERE document_id = $1::uuid AND embedding IS NULL
           ORDER BY chunk_index ASC LIMIT $2`,
          documentId, BATCH_SIZE,
        );

        if (!batch || batch.length === 0) break;

        // Generate embeddings one at a time (memory-safe)
        for (const chunk of batch) {
          try {
            const embedding = await this.bedrock.generateEmbedding(chunk.content);
            const embeddingStr = `[${embedding.join(',')}]`;

            await this.prisma.$executeRawUnsafe(
              `UPDATE intel_document_chunks SET embedding = $1::vector
               WHERE id = $2`,
              embeddingStr, chunk.id,
            );
            totalEmbedded++;
          } catch (embeddingError) {
            this.logger.warn(
              `[${documentId}] Embedding failed for chunk ${chunk.chunk_index}: ${embeddingError.message}`,
            );
            // Continue — partial embeddings are better than none
          }
        }

        offset += batch.length;
      }

      return totalEmbedded;
    } catch (error) {
      this.logger.error(`[${documentId}] Embedding step failed: ${error.message}`);
      return totalEmbedded;
    }
  }

  // ─── STEP 3: VISION EXTRACT (with query lock) ─────────────

  private async stepVisionExtract(
    documentId: string,
    tenantId: string,
    doc: DocumentRecord,
  ): Promise<string> {
    const isPdf = doc.file_type?.includes('pdf');
    const visionEnabled = process.env.ENABLE_VISION_EXTRACTION === 'true';

    if (!isPdf) return 'not-pdf';
    if (!visionEnabled) return 'disabled';

    // Heap guard
    const heapUsedMB = process.memoryUsage().heapUsed / (1024 * 1024);
    if (heapUsedMB > 3000) {
      this.logger.warn(`[${documentId}] Skipping vision — heap ${heapUsedMB.toFixed(0)}MB > 3GB`);
      return 'heap-guard';
    }

    try {
      // Wait if user query is in flight
      await this.waitForQuerySlot('VisionExtract');

      // Read raw text from S3 for page identification (then release)
      let rawText: string | null = null;
      if (doc.raw_text_s3_key) {
        const buf = await this.s3.getFileBuffer(doc.raw_text_s3_key);
        rawText = buf.toString('utf-8');
      }

      if (!rawText || rawText.length < 500) {
        return 'text-too-short';
      }

      const keyPages = this.visionExtraction.identifyKeyPages(rawText, doc.document_type || 'generic');
      rawText = null; // Release before vision calls

      if (keyPages.length === 0) return 'no-key-pages';

      this.logger.log(`[${documentId}] Identified ${keyPages.length} key pages for vision`);

      const visionResults = await this.visionExtraction.extractFromPages(
        doc.s3_key,
        keyPages,
        doc.document_type || 'generic',
      );

      // Persist vision results immediately, then release
      let metricCount = 0;
      const flatMetrics = this.visionExtraction.flattenMetrics(visionResults);
      metricCount = flatMetrics.length;

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

      // Persist vision flags
      const visionFlags: DocumentFlag[] = [];
      for (const page of visionResults) {
        if (page.tables.length > 3) {
          visionFlags.push({
            flagType: 'complex_financials',
            severity: 'info',
            description: `Page ${page.pageNumber} contains ${page.tables.length} tables`,
            sourcePageNumber: page.pageNumber,
          });
        }
      }
      if (visionFlags.length > 0) {
        await this.documentFlagsPersistence.persist(documentId, tenantId, doc.company_ticker, visionFlags)
          .catch(() => {});
      }

      // Append vision-extracted text to the raw text S3 file so that
      // long-context-fallback queries include financial tables that pdfplumber missed.
      const visionText = this.visionExtraction.visionResultsToText(visionResults);
      if (visionText.length > 100 && doc.raw_text_s3_key) {
        try {
          // Store vision text as a separate S3 key (sibling of raw_text.txt)
          const visionTextS3Key = doc.raw_text_s3_key.replace(/raw_text\.txt$/, 'vision_text.txt');
          await this.s3.uploadBuffer(
            Buffer.from(visionText, 'utf-8'),
            visionTextS3Key,
            'text/plain',
          );
          // Record the vision text S3 key on the document
          await this.prisma.$executeRawUnsafe(
            `UPDATE intel_documents SET vision_text_s3_key = $1, updated_at = NOW()
             WHERE document_id = $2::uuid`,
            visionTextS3Key,
            documentId,
          );
          this.logger.log(`[${documentId}] Vision text stored: ${visionText.length} chars → ${visionTextS3Key}`);
        } catch (e) {
          this.logger.warn(`[${documentId}] Vision text storage failed (non-fatal): ${e.message}`);
        }
      }

      this.logger.log(`[${documentId}] Vision: ${metricCount} metrics from ${visionResults.length} pages`);
      return 'pdf-native';
    } catch (error) {
      this.logger.warn(`[${documentId}] Vision extraction failed (non-fatal): ${error.message}`);
      return 'failed';
    }
  }

  // ─── STEP 3b: Metric Persistence ──────────────────────────

  private async stepMetricPersistence(
    documentId: string,
    tenantId: string,
  ): Promise<void> {
    const result = await this.metricPersistence.persistFromExtractions(documentId, tenantId);
    if (result.persisted > 0) {
      this.logger.log(`[${documentId}] Persisted ${result.persisted} metrics to extracted_metrics`);
    }
  }

  // ─── STEP 4: KB SYNC PREP (paginated reads) ──────────────

  private async stepKBSyncPrep(
    documentId: string,
    tenantId: string,
    dealId: string,
    doc: DocumentRecord,
  ): Promise<number> {
    // Only for Deal Library documents
    const dealLibraryCheck = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT deal_library_id, upload_source FROM intel_documents WHERE document_id = $1::uuid`,
      documentId,
    );
    const isDealLibrary = dealLibraryCheck?.[0]?.deal_library_id != null
      || dealLibraryCheck?.[0]?.upload_source === 'deal-library';

    if (!isDealLibrary) return 0;

    const PAGE_SIZE = 10;
    let written = 0;
    let offset = 0;
    const safeFileName = (doc.file_name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');

    try {
      let hasMore = true;
      while (hasMore) {
        // Read one page of chunks from DB
        const chunks = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT chunk_index, content, section_type, page_number
           FROM intel_document_chunks
           WHERE document_id = $1::uuid
           ORDER BY chunk_index ASC
           OFFSET $2 LIMIT $3`,
          documentId, offset, PAGE_SIZE,
        );

        if (!chunks || chunks.length === 0) {
          hasMore = false;
          break;
        }

        // Write each chunk to S3, then release
        for (const chunk of chunks) {
          const chunkKey = `kb-ready/${tenantId}/${dealId}/uploads/${safeFileName}_chunk_${String(chunk.chunk_index).padStart(3, '0')}.json`;
          const payload = JSON.stringify({
            content: chunk.content || '',
            metadata: {
              tenant_id: tenantId,
              deal_id: dealId,
              document_id: documentId,
              document_type: doc.document_type || 'generic',
              source: 'upload',
              company_ticker: doc.company_ticker || '',
              file_name: doc.file_name || '',
              section_type: chunk.section_type || 'general',
              page_number: chunk.page_number || null,
              chunk_index: chunk.chunk_index,
            },
          });

          await this.s3.uploadBuffer(
            Buffer.from(payload, 'utf-8'),
            chunkKey,
            'application/json',
            { documentId, tenantId },
          );
          written++;
        }

        offset += PAGE_SIZE;
        hasMore = chunks.length === PAGE_SIZE;
      }

      if (written > 0) {
        await this.prisma.$executeRawUnsafe(
          `UPDATE intel_documents SET kb_sync_status = 'prepared', updated_at = NOW()
           WHERE document_id = $1::uuid`,
          documentId,
        );
      }

      return written;
    } catch (error) {
      this.logger.error(`[${documentId}] KB sync prep failed: ${error.message}`);
      return written;
    }
  }

  // ─── STEP 5: FINALIZE ─────────────────────────────────────

  private async stepFinalize(
    documentId: string,
    tenantId: string,
    doc: DocumentRecord,
    indexedCount: number,
    chunkCount: number,
  ): Promise<void> {
    // Update document to fully-indexed
    await this.prisma.$executeRawUnsafe(
      `UPDATE intel_documents SET
        status = 'fully-indexed',
        processing_mode = 'fully-indexed',
        chunk_count = $1,
        updated_at = NOW()
      WHERE document_id = $2::uuid`,
      indexedCount,
      documentId,
    );

    // Generate intake summary
    try {
      const topMetricsRows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT data FROM intel_document_extractions
         WHERE document_id = $1::uuid AND extraction_type = 'metric'
         ORDER BY created_at DESC LIMIT 5`,
        documentId,
      );
      const topMetrics = topMetricsRows?.map(r => {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        return {
          name: d.metric_key || d.metricName || 'unknown',
          value: d.numeric_value ?? d.value ?? 0,
          unit: d.unit,
          period: d.period,
        };
      }) || [];

      const flagRows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT severity, description FROM document_flags
         WHERE document_id = $1::uuid ORDER BY created_at DESC LIMIT 5`,
        documentId,
      ).catch(() => []);
      const notableItems = (flagRows || []).map(f => ({
        severity: f.severity,
        description: f.description,
      }));

      // Count metrics for summary
      const metricCountRows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*)::int as cnt FROM intel_document_extractions
         WHERE document_id = $1::uuid AND extraction_type = 'metric'`,
        documentId,
      );
      const metricCount = metricCountRows?.[0]?.cnt || 0;

      await this.intakeSummary.generate({
        documentId,
        tenantId,
        fileName: doc.file_name || 'document',
        documentType: doc.document_type || 'generic',
        reportingEntity: doc.company_name ?? undefined,
        ticker: doc.company_ticker ?? undefined,
        metricCount,
        chunkCount: indexedCount,
        topMetrics,
        notableItems,
      });
    } catch (summaryErr) {
      this.logger.warn(`[${documentId}] Intake summary failed (non-fatal): ${summaryErr.message}`);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────

  private async fetchDocumentRecord(
    documentId: string,
    tenantId: string,
  ): Promise<DocumentRecord | null> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT s3_key, raw_text_s3_key, file_type, document_type, file_name,
             company_ticker, company_name, deal_id
      FROM intel_documents
      WHERE document_id = ${documentId}::uuid
        AND tenant_id = ${tenantId}::uuid
    `;
    if (!rows?.length) return null;
    return rows[0] as DocumentRecord;
  }
}

/** Internal type for document record fields used across steps */
interface DocumentRecord {
  s3_key: string;
  raw_text_s3_key: string | null;
  file_type: string | null;
  document_type: string | null;
  file_name: string | null;
  company_ticker: string | null;
  company_name: string | null;
  deal_id: string;
}
