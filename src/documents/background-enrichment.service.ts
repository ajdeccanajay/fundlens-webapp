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
import { ExcelExtractorService } from './excel-extractor.service';
import { EarningsCallExtractorService } from './earnings-call-extractor.service';
import { CallAnalysisPersistenceService } from './call-analysis-persistence.service';
import { DocumentFlagsPersistenceService, DocumentFlag } from './document-flags-persistence.service';
import { ModelFormulasPersistenceService } from './model-formulas-persistence.service';
import { IntakeSummaryService } from './intake-summary.service';

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
    private readonly excelExtractor: ExcelExtractorService,
    private readonly earningsExtractor: EarningsCallExtractorService,
    private readonly callAnalysisPersistence: CallAnalysisPersistenceService,
    private readonly documentFlagsPersistence: DocumentFlagsPersistenceService,
    private readonly modelFormulasPersistence: ModelFormulasPersistenceService,
    private readonly intakeSummary: IntakeSummaryService,
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
        SELECT s3_key, raw_text_s3_key, file_type, document_type, file_name,
               company_ticker, company_name
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
        // Excel files may not have raw text — check if it's an Excel file
        const isExcel = doc.file_type?.includes('spreadsheet') ||
          doc.file_type?.includes('excel') ||
          doc.file_name?.match(/\.xlsx?$/i);

        if (!isExcel) {
          this.logger.warn(`[${documentId}] No raw text available, skipping enrichment`);
          return;
        }
      }

      // ── Route by document type (Spec §3 Step 2) ──
      const isExcel = doc.file_type?.includes('spreadsheet') ||
        doc.file_type?.includes('excel') ||
        doc.file_name?.match(/\.xlsx?$/i);
      const isEarningsCall = doc.document_type === 'earnings_transcript' ||
        doc.document_type === 'earnings_call' ||
        /earnings\s*call|transcript/i.test(doc.file_name || '');

      // ── Excel extraction path (Spec §5) ──
      if (isExcel) {
        try {
          this.logger.log(`[${documentId}] Routing to Excel extractor`);
          const fileBuffer = await this.s3.getFileBuffer(doc.s3_key);
          const excelResult = await this.excelExtractor.extract(
            fileBuffer,
            doc.file_name || 'model.xlsx',
            doc.company_ticker,
          );

          // Persist extracted metrics to intel_document_extractions
          for (const metric of excelResult.metrics) {
            try {
              await this.prisma.$executeRawUnsafe(
                `INSERT INTO intel_document_extractions (
                  id, document_id, tenant_id, extraction_type, data,
                  confidence, page_number, created_at
                ) VALUES (
                  gen_random_uuid(), $1::uuid, $2::uuid, 'metric',
                  $3::jsonb, 'high', NULL, NOW()
                )`,
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
              );
            } catch (insertErr) {
              // Continue on individual metric insert failure
            }
          }

          // Use text chunks for indexing
          rawText = excelResult.textChunks.map(c => c.content).join('\n\n');
          this.logger.log(
            `[${documentId}] Excel extraction: ${excelResult.metrics.length} metrics, ` +
            `${excelResult.tables.length} tables, ${excelResult.formulaGraph.length} formulas`,
          );

          // Persist formula graph to model_formulas table (Spec §9.4)
          if (excelResult.formulaGraph.length > 0) {
            try {
              await this.modelFormulasPersistence.persist(documentId, tenantId, excelResult.formulaGraph);
            } catch (fErr) {
              this.logger.warn(`[${documentId}] Formula persistence failed (non-fatal): ${fErr.message}`);
            }
          }
        } catch (excelErr) {
          this.logger.warn(`[${documentId}] Excel extraction failed: ${excelErr.message}`);
        }
      }

      // ── Earnings call extraction path (Spec §6) ──
      if (isEarningsCall && rawText.length > 500) {
        try {
          this.logger.log(`[${documentId}] Routing to Earnings Call extractor`);

          // Look up company info
          const companyName = doc.company_name || doc.file_name || 'Unknown';
          const ticker = doc.company_ticker || '';

          const earningsResult = await this.earningsExtractor.extract(
            rawText, companyName, ticker,
          );

          // Persist metrics from earnings call
          for (const metric of earningsResult.allMetrics) {
            if (metric.value == null) continue;
            try {
              await this.prisma.$executeRawUnsafe(
                `INSERT INTO intel_document_extractions (
                  id, document_id, tenant_id, extraction_type, data,
                  confidence, page_number, created_at
                ) VALUES (
                  gen_random_uuid(), $1::uuid, $2::uuid, 'metric',
                  $3::jsonb, 'medium', NULL, NOW()
                )`,
                documentId, tenantId,
                JSON.stringify({
                  metric_key: metric.canonicalHint || metric.metricName,
                  raw_value: String(metric.value),
                  numeric_value: metric.value,
                  period: metric.period,
                  context: metric.context,
                  speaker: metric.speaker,
                }),
              );
            } catch (insertErr) {
              // Continue on individual metric insert failure
            }
          }

          // Generate specialized chunks from earnings call structure
          const earningsChunks = this.earningsExtractor.toChunks(earningsResult);
          // Prepend earnings chunks to rawText for downstream chunking
          const earningsText = earningsChunks.map(c => `## ${c.sectionHeading}\n${c.content}`).join('\n\n');
          if (earningsText.length > rawText.length) {
            rawText = earningsText; // Use structured chunks if richer
          }

          // Persist tone analysis and red flags
          if (earningsResult.toneAnalysis.overallConfidence > 0) {
            await this.prisma.$executeRawUnsafe(
              `INSERT INTO intel_document_extractions (
                id, document_id, tenant_id, extraction_type, data,
                confidence, created_at
              ) VALUES (
                gen_random_uuid(), $1::uuid, $2::uuid, 'tone_analysis',
                $3::jsonb, 'high', NOW()
              )`,
              documentId, tenantId,
              JSON.stringify(earningsResult.toneAnalysis),
            );
          }

          for (const flag of earningsResult.redFlags) {
            await this.prisma.$executeRawUnsafe(
              `INSERT INTO intel_document_extractions (
                id, document_id, tenant_id, extraction_type, data,
                confidence, created_at
              ) VALUES (
                gen_random_uuid(), $1::uuid, $2::uuid, 'red_flag',
                $3::jsonb, $4, NOW()
              )`,
              documentId, tenantId,
              JSON.stringify(flag),
              flag.severity === 'high' ? 'high' : 'medium',
            );
          }

          this.logger.log(
            `[${documentId}] Earnings call extraction: ${earningsResult.qaExchanges.length} Q&A, ` +
            `${earningsResult.allMetrics.length} metrics, ${earningsResult.redFlags.length} red flags`,
          );

          // Persist structured call analysis to call_analysis table (Spec §9.4)
          try {
            await this.callAnalysisPersistence.persist(documentId, tenantId, earningsResult);
          } catch (caErr) {
            this.logger.warn(`[${documentId}] Call analysis persistence failed (non-fatal): ${caErr.message}`);
          }

          // Persist red flags to document_flags table (Spec §9.4)
          if (earningsResult.redFlags.length > 0) {
            const flags: DocumentFlag[] = earningsResult.redFlags.map(rf => ({
              flagType: 'earnings_red_flag',
              severity: rf.severity as any || 'medium',
              description: rf.flag || '',
              evidence: rf.evidence || undefined,
            }));
            try {
              await this.documentFlagsPersistence.persist(documentId, tenantId, doc.company_ticker, flags);
            } catch (dfErr) {
              this.logger.warn(`[${documentId}] Document flags persistence failed (non-fatal): ${dfErr.message}`);
            }
          }
        } catch (earningsErr) {
          this.logger.warn(`[${documentId}] Earnings call extraction failed: ${earningsErr.message}`);
        }
      }

      // Only attempt vision extraction for PDFs
      const isPdf = doc.file_type?.includes('pdf');

      // Steps 1-6: Vision extraction — RE-ENABLED with batched processing
      // Pages are processed in batches of 10 to avoid V8 OOM.
      let visionResults: VisionPageResult[] = [];
      let metricCount = 0;
      let tableCount = 0;

      if (isPdf && rawText.length > 500) {
        try {
          const keyPages = this.visionExtraction.identifyKeyPages(rawText, doc.document_type || 'generic');
          this.logger.log(`[${documentId}] Identified ${keyPages.length} key pages for vision extraction`);

          if (keyPages.length > 0) {
            visionResults = await this.visionExtraction.extractFromPages(
              doc.s3_key,
              keyPages,
              doc.document_type || 'generic',
            );

            // Flatten metrics from vision results and persist to extractions table
            const flatMetrics = this.visionExtraction.flattenMetrics(visionResults);
            metricCount = flatMetrics.length;
            tableCount = visionResults.reduce((sum, r) => sum + r.tables.length, 0);

            // Persist vision-extracted metrics to intel_document_extractions
            for (const metric of flatMetrics) {
              try {
                await this.prisma.$executeRawUnsafe(
                  `INSERT INTO intel_document_extractions (
                    id, document_id, tenant_id, extraction_type, data,
                    confidence, page_number, created_at
                  ) VALUES (
                    gen_random_uuid(), $1::uuid, $2::uuid, 'metric',
                    $3::jsonb, $4, $5, NOW()
                  )`,
                  documentId, tenantId,
                  JSON.stringify(metric),
                  metric.confidence || 'medium',
                  metric.page_number || null,
                );
              } catch (insertErr) {
                this.logger.warn(`[${documentId}] Failed to persist metric: ${insertErr.message}`);
              }
            }

            this.logger.log(
              `[${documentId}] Vision extraction: ${metricCount} metrics, ${tableCount} tables`,
            );

            // Persist notable items from vision as document flags (Spec §9.4)
            // Vision results don't have explicit notableItems — derive from entities
            const visionFlags: DocumentFlag[] = [];
            for (const page of visionResults) {
              // Flag pages with many tables (potential restatement or complex financials)
              if (page.tables.length > 3) {
                visionFlags.push({
                  flagType: 'complex_financials',
                  severity: 'info',
                  description: `Page ${page.pageNumber} contains ${page.tables.length} tables — may warrant detailed review`,
                  sourcePageNumber: page.pageNumber,
                });
              }
            }
            if (visionFlags.length > 0) {
              try {
                await this.documentFlagsPersistence.persist(documentId, tenantId, doc.company_ticker, visionFlags);
              } catch (vfErr) {
                this.logger.warn(`[${documentId}] Vision flags persistence failed (non-fatal): ${vfErr.message}`);
              }
            }
          }
        } catch (visionErr) {
          this.logger.warn(
            `[${documentId}] Vision extraction failed (non-fatal, continuing with text-only): ${visionErr.message}`,
          );
          // Non-fatal — chunking + indexing still proceeds
        }
      } else {
        this.logger.log(`[${documentId}] Skipping vision extraction (not PDF or text too short)`);
      }

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

      // ── Step 11: Generate intake summary (Spec §12) ──
      try {
        // Gather top metrics from extractions for the summary
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

        // Gather notable items (flags)
        const flagRows = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT severity, description FROM document_flags
           WHERE document_id = $1::uuid ORDER BY created_at DESC LIMIT 5`,
          documentId,
        ).catch(() => []);
        const notableItems = (flagRows || []).map(f => ({
          severity: f.severity,
          description: f.description,
        }));

        await this.intakeSummary.generate({
          documentId,
          tenantId,
          fileName: doc.file_name || 'document',
          documentType: doc.document_type || 'generic',
          reportingEntity: doc.company_name,
          ticker: doc.company_ticker,
          metricCount,
          chunkCount: indexedCount,
          topMetrics,
          notableItems,
        });
      } catch (summaryErr) {
        this.logger.warn(`[${documentId}] Intake summary failed (non-fatal): ${summaryErr.message}`);
      }

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
