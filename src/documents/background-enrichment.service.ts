/**
 * Background Enrichment Service — Spec §3.4 (Phase B)
 *
 * Runs asynchronously after Phase A (instant intelligence) completes.
 * The user is already querying via long-context fallback while this runs.
 *
 * Pipeline:
 *   1. Identify key pages (tables, charts, financial data)
 *   2. Vision extraction via Sonnet on page images
 *   3. Deterministic verification against raw text
 *   4. Persist verified extractions to intel_document_extractions
 *   5. Update document status + metric/chunk counts
 *
 * Budget: 30-120 seconds. Non-blocking.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../services/s3.service';
import { VisionExtractionService, VisionPageResult } from './vision-extraction.service';
import { VerificationService } from './verification.service';
import { DocumentChunkingService } from './document-chunking.service';
import { DocumentIndexingService } from './document-indexing.service';
import { MetricPersistenceService } from './metric-persistence.service';

@Injectable()
export class BackgroundEnrichmentService {
  private readonly logger = new Logger(BackgroundEnrichmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly visionExtraction: VisionExtractionService,
    private readonly verification: VerificationService,
    private readonly chunking: DocumentChunkingService,
    private readonly indexing: DocumentIndexingService,
    private readonly metricPersistence: MetricPersistenceService,
  ) {}

  /**
   * Main entry point — called asynchronously after Phase A.
   * Orchestrates the full Phase B pipeline.
   */
  async enrichDocument(
    documentId: string,
    tenantId: string,
    dealId: string,
  ): Promise<void> {
    const startTime = Date.now();
    this.logger.log(`[${documentId}] Starting background enrichment`);

    try {
      // Fetch document record
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT s3_key, raw_text_s3_key, file_type, document_type, file_name
        FROM intel_documents
        WHERE document_id = ${documentId}::uuid
          AND tenant_id = ${tenantId}::uuid
      `;

      if (!rows?.length) {
        this.logger.error(`[${documentId}] Document not found for enrichment`);
        return;
      }

      const doc = rows[0];

      // Get raw text for chunking + verification
      let rawText = '';
      if (doc.raw_text_s3_key) {
        const buf = await this.s3.getFileBuffer(doc.raw_text_s3_key);
        rawText = buf.toString('utf-8');
      }

      if (!rawText || rawText.length < 100) {
        this.logger.warn(`[${documentId}] No raw text available, skipping enrichment`);
        return;
      }

      // Only attempt vision extraction for PDFs (currently disabled due to OOM)
      // const isPdf = doc.file_type?.includes('pdf');

      // Steps 1-6: Vision extraction — DISABLED
      // pdf-to-img causes V8 OOM abort (not catchable) on Node 25.
      // Chunking + indexing is the critical path for RAG queries.
      // Vision extraction will be re-enabled when running on ECS with more memory.
      let visionResults: VisionPageResult[] = [];
      const metricCount = 0;
      const tableCount = 0;
      this.logger.log(`[${documentId}] Vision extraction skipped (memory optimization)`);

      // ── Step 7: Chunk raw text (Spec §3.4 Step 4) ──
      const chunks = this.chunking.chunk(rawText, visionResults, {
        maxTokens: 600,
        overlap: 100,
        preserveTables: true,
        documentType: doc.document_type || 'generic',
      });
      this.logger.log(
        `[${documentId}] Chunked into ${chunks.length} chunks`,
      );

      // ── Step 8: Embed + Index chunks with Titan V2 (Spec §6.1) ──
      let indexedCount = 0;
      if (chunks.length > 0) {
        indexedCount = await this.indexing.indexChunks(
          documentId,
          tenantId,
          dealId,
          chunks,
        );
      }

      // ── Step 9: Upgrade document to fully-indexed ──
      await this.prisma.$executeRawUnsafe(
        `UPDATE intel_documents SET
          processing_mode = 'fully-indexed',
          chunk_count = $1,
          updated_at = NOW()
        WHERE document_id = $2::uuid`,
        indexedCount,
        documentId,
      );

      // ── Step 9b: Persist extracted metrics to flat table (Spec §15 Rule 1) ──
      // Resolves JSONB metric labels → canonical IDs → extracted_metrics table
      try {
        const persistResult = await this.metricPersistence.persistFromExtractions(
          documentId,
          tenantId,
        );
        if (persistResult.persisted > 0) {
          this.logger.log(
            `[${documentId}] Persisted ${persistResult.persisted} metrics to extracted_metrics`,
          );
        }
      } catch (persistErr) {
        this.logger.warn(
          `[${documentId}] Metric persistence failed (non-fatal): ${persistErr.message}`,
        );
      }

      // ── Step 10: KB Sync Prep — write chunks to S3 kb-ready/ prefix (Spec §6.3) ──
      // Only for Deal Library documents (or chat uploads linked to Deal Library)
      const dealLibraryCheck = await this.prisma.$queryRaw<any[]>`
        SELECT deal_library_id, upload_source FROM intel_documents
        WHERE document_id = ${documentId}::uuid
      `;
      const isDealLibrary = dealLibraryCheck?.[0]?.deal_library_id != null
        || dealLibraryCheck?.[0]?.upload_source === 'deal-library';

      if (isDealLibrary && chunks.length > 0) {
        try {
          await this.prepareKBChunks(documentId, tenantId, dealId, chunks, doc);
          await this.prisma.$executeRawUnsafe(
            `UPDATE intel_documents SET kb_sync_status = 'prepared', updated_at = NOW()
             WHERE document_id = $1::uuid`,
            documentId,
          );
          this.logger.log(
            `[${documentId}] KB sync prep complete: ${chunks.length} chunks written to kb-ready/`,
          );
        } catch (kbErr) {
          this.logger.warn(
            `[${documentId}] KB sync prep failed (non-fatal): ${kbErr.message}`,
          );
          // Non-fatal — document is still queryable via OpenSearch
        }
      }

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `[${documentId}] Background enrichment complete: ` +
        `${metricCount} metrics, ${tableCount} tables, ${indexedCount} chunks indexed ` +
        `(${elapsed}ms)`,
      );
    } catch (error) {
      this.logger.error(
        `[${documentId}] Background enrichment failed: ${error.message}`,
        error.stack,
      );

      // Update error state but don't change status — document is still queryable via long-context
      await this.prisma.$executeRawUnsafe(
        `UPDATE intel_documents SET
          error = $1,
          retry_count = retry_count + 1,
          updated_at = NOW()
        WHERE document_id = $2::uuid`,
        `Background enrichment failed: ${error.message}`,
        documentId,
      ).catch(() => {}); // Don't throw on error update failure
    }
  }

  private averageTableConfidence(table: any): number {
    let total = 0;
    let count = 0;
    for (const row of table.rows || []) {
      for (const cell of row.cells || []) {
        if (cell.confidence != null) {
          total += cell.confidence;
          count++;
        }
      }
    }
    return count > 0 ? Math.round((total / count) * 100) / 100 : 0.7;
  }

  private allTableCellsVerified(table: any): boolean {
    for (const row of table.rows || []) {
      for (const cell of row.cells || []) {
        if (cell.verified === false) return false;
      }
    }
    return true;
  }

  /**
   * KB Sync Prep — Write chunks to S3 kb-ready/ prefix (Spec §6.3, §6.4)
   * Chunks are written as JSON files with metadata for Bedrock KB ingestion.
   * Actual KB sync happens via existing cron (KBSyncService).
   */
  private async prepareKBChunks(
    documentId: string,
    tenantId: string,
    dealId: string,
    chunks: any[],
    doc: any,
  ): Promise<void> {
    const safeFileName = (doc.file_name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkKey = `kb-ready/${tenantId}/${dealId}/uploads/${safeFileName}_chunk_${String(i + 1).padStart(3, '0')}.json`;

      const chunkPayload = {
        content: chunk.text || chunk.content || '',
        metadata: {
          tenant_id: tenantId,
          deal_id: dealId,
          document_id: documentId,
          document_type: doc.document_type || 'generic',
          source: 'upload',
          company_ticker: doc.company_ticker || '',
          file_name: doc.file_name || '',
          section_type: chunk.sectionType || chunk.section || 'general',
          page_number: chunk.pageNumber || chunk.page || null,
          chunk_index: i,
          total_chunks: chunks.length,
        },
      };

      await this.s3.uploadBuffer(
        Buffer.from(JSON.stringify(chunkPayload), 'utf-8'),
        chunkKey,
        'application/json',
        { documentId, tenantId },
      );
    }
  }

  private mergeEntities(visionResults: VisionPageResult[]): {
    companies: string[];
    dates: string[];
    metrics: string[];
  } {
    const companies = new Set<string>();
    const dates = new Set<string>();
    const metrics = new Set<string>();

    for (const page of visionResults) {
      for (const c of page.entities?.companies || []) companies.add(c);
      for (const d of page.entities?.dates || []) dates.add(d);
      for (const m of page.entities?.metrics || []) metrics.add(m);
    }

    return {
      companies: [...companies],
      dates: [...dates],
      metrics: [...metrics],
    };
  }
}
