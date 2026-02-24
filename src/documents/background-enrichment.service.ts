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

@Injectable()
export class BackgroundEnrichmentService {
  private readonly logger = new Logger(BackgroundEnrichmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly visionExtraction: VisionExtractionService,
    private readonly verification: VerificationService,
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

      // Only process PDFs with vision (other types already fully extracted in Phase A)
      const isPdf = doc.file_type?.includes('pdf');
      if (!isPdf) {
        this.logger.log(`[${documentId}] Non-PDF file, skipping vision extraction`);
        return;
      }

      // Get raw text for verification
      let rawText = '';
      if (doc.raw_text_s3_key) {
        const buf = await this.s3.getFileBuffer(doc.raw_text_s3_key);
        rawText = buf.toString('utf-8');
      }

      // Step 1: Identify key pages
      const keyPages = this.visionExtraction.identifyKeyPages(
        rawText,
        doc.document_type || 'generic',
      );
      this.logger.log(
        `[${documentId}] Identified ${keyPages.length} key pages: [${keyPages.join(', ')}]`,
      );

      if (keyPages.length === 0) {
        this.logger.log(`[${documentId}] No key pages found, skipping vision extraction`);
        return;
      }

      // Step 2: Vision extraction on key pages
      const visionResults = await this.visionExtraction.extractFromPages(
        doc.s3_key,
        keyPages,
        doc.document_type || 'generic',
      );

      // Step 3: Flatten metrics from vision results
      const allMetrics = this.visionExtraction.flattenMetrics(visionResults);

      // Step 4: Deterministic verification against raw text
      const verifiedMetrics = allMetrics.map(metric => {
        if (metric.numeric_value != null) {
          const result = this.verification.verifyExtractedNumber(
            { value: metric.numeric_value, rawDisplay: metric.raw_value || '' },
            rawText,
            metric.units,
          );
          return { ...metric, confidence: result.confidence, verified: result.verified };
        }
        return { ...metric, confidence: 0.7, verified: false };
      });

      // Step 5: Persist verified extractions to intel_document_extractions
      let metricCount = 0;
      let tableCount = 0;

      // Persist metrics
      for (const metric of verifiedMetrics) {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO intel_document_extractions
            (id, document_id, tenant_id, deal_id, extraction_type, data, page_number, confidence, verified, source_layer)
          VALUES
            (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'metric',
             $4::jsonb, $5, $6, $7, 'vision')`,
          documentId,
          tenantId,
          dealId,
          JSON.stringify({
            metric_key: metric.metric_key,
            raw_value: metric.raw_value,
            numeric_value: metric.numeric_value,
            period: metric.period,
            is_estimate: metric.is_estimate,
            is_negative: metric.is_negative,
            table_type: metric.table_type,
          }),
          metric.page_number,
          metric.confidence,
          metric.verified,
        );
        metricCount++;
      }

      // Persist tables (full structure for comp table rendering)
      for (const page of visionResults) {
        for (const table of page.tables) {
          // Verify table cells
          const verifiedTable = this.verification.verifyVisionExtractions(
            { metrics: [], tables: [table], narratives: [], footnotes: [], entities: {} },
            rawText,
          ).tables[0];

          await this.prisma.$executeRawUnsafe(
            `INSERT INTO intel_document_extractions
              (id, document_id, tenant_id, deal_id, extraction_type, data, page_number, section, confidence, verified, source_layer)
            VALUES
              (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'table',
               $4::jsonb, $5, $6, $7, $8, 'vision')`,
            documentId,
            tenantId,
            dealId,
            JSON.stringify(verifiedTable),
            page.pageNumber,
            table.tableType || 'other',
            this.averageTableConfidence(verifiedTable),
            this.allTableCellsVerified(verifiedTable),
          );
          tableCount++;
        }
      }

      // Persist narratives
      for (const page of visionResults) {
        if (page.narratives?.length > 0) {
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO intel_document_extractions
              (id, document_id, tenant_id, deal_id, extraction_type, data, page_number, source_layer)
            VALUES
              (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'narrative',
               $4::jsonb, $5, 'vision')`,
            documentId,
            tenantId,
            dealId,
            JSON.stringify({ items: page.narratives }),
            page.pageNumber,
          );
        }
      }

      // Persist footnotes
      for (const page of visionResults) {
        if (page.footnotes?.length > 0) {
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO intel_document_extractions
              (id, document_id, tenant_id, deal_id, extraction_type, data, page_number, source_layer)
            VALUES
              (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'footnote',
               $4::jsonb, $5, 'vision')`,
            documentId,
            tenantId,
            dealId,
            JSON.stringify({ items: page.footnotes }),
            page.pageNumber,
          );
        }
      }

      // Persist entities
      const allEntities = this.mergeEntities(visionResults);
      if (allEntities.companies.length > 0 || allEntities.metrics.length > 0) {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO intel_document_extractions
            (id, document_id, tenant_id, deal_id, extraction_type, data, source_layer)
          VALUES
            (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'entity',
             $4::jsonb, 'vision')`,
          documentId,
          tenantId,
          dealId,
          JSON.stringify(allEntities),
        );
      }

      // Step 6: Update document status
      await this.prisma.$executeRawUnsafe(
        `UPDATE intel_documents SET
          metric_count = COALESCE(metric_count, 0) + $1,
          updated_at = NOW()
        WHERE document_id = $2::uuid`,
        metricCount,
        documentId,
      );

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `[${documentId}] Background enrichment complete: ` +
        `${metricCount} metrics, ${tableCount} tables ` +
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
