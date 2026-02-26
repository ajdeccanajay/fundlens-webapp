/**
 * Metric Persistence Service — Spec §15 Rule 1, §4 Phase 4
 *
 * Resolves extracted metric labels to MetricRegistry canonical IDs
 * and persists them in the flat `extracted_metrics` table.
 *
 * This bridges the gap between:
 *   - intel_document_extractions (JSONB, raw labels)
 *   - extracted_metrics (flat, canonical IDs)
 *
 * The structured retriever can then query extracted_metrics using
 * the same synonym lookup it uses for financial_metrics.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricRegistryService } from '../rag/metric-resolution/metric-registry.service';

export interface ExtractedMetricInput {
  rawLabel: string;
  value: number;
  unit?: string;
  period?: string;
  periodEndDate?: string;
  context?: string;
  isEstimate?: boolean;
  pageNumber?: number;
  tableId?: string;
  section?: string;
  confidence?: string;
}

export interface PersistenceResult {
  total: number;
  persisted: number;
  skippedUnresolved: number;
  skippedDuplicate: number;
}

@Injectable()
export class MetricPersistenceService {
  private readonly logger = new Logger(MetricPersistenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricRegistry: MetricRegistryService,
  ) {}

  /**
   * Resolve and persist extracted metrics from a document.
   *
   * For each metric:
   *   1. Resolve rawLabel → canonical_id via MetricRegistry
   *   2. Skip unresolved metrics (log for YAML improvement)
   *   3. Store in extracted_metrics with canonical ID + output_format
   *
   * Idempotent: deletes existing metrics for the document before inserting.
   */
  async persistMetrics(
    documentId: string,
    tenantId: string,
    ticker: string,
    metrics: ExtractedMetricInput[],
    sourceFileName: string,
  ): Promise<PersistenceResult> {
    const result: PersistenceResult = {
      total: metrics.length,
      persisted: 0,
      skippedUnresolved: 0,
      skippedDuplicate: 0,
    };

    if (metrics.length === 0) return result;

    this.logger.log(
      `[${documentId}] Persisting ${metrics.length} extracted metrics for ${ticker}`,
    );

    // Idempotent: clear previous extractions for this document
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM extracted_metrics WHERE document_id = $1::uuid`,
      documentId,
    );

    // Track (canonical_id + period) to skip duplicates within same document
    const seen = new Set<string>();

    for (const m of metrics) {
      // Step 1: Resolve to canonical ID
      const resolution = this.metricRegistry.resolve(m.rawLabel, tenantId);

      if (resolution.confidence === 'unresolved') {
        this.logger.warn(
          `[${documentId}] Skipping unresolved metric: "${m.rawLabel}" — ` +
          `suggestions: ${resolution.suggestions?.map(s => s.display_name).join(', ') || 'none'}`,
        );
        result.skippedUnresolved++;
        continue;
      }

      // Step 2: Dedup within document
      const dedupeKey = `${resolution.canonical_id}:${m.period || 'unknown'}`;
      if (seen.has(dedupeKey)) {
        result.skippedDuplicate++;
        continue;
      }
      seen.add(dedupeKey);

      // Step 3: Get output_format from registry
      const metricDef = this.metricRegistry.getMetricById(resolution.canonical_id);
      const outputFormat = metricDef?.output_format || 'currency';

      // Step 4: Insert into extracted_metrics
      try {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO extracted_metrics (
            tenant_id, document_id, ticker,
            normalized_metric, raw_label, display_name,
            value, unit, period, period_end_date,
            context, output_format, is_estimate,
            source_page_number, source_table_id, source_section,
            source_file_name, extraction_confidence
          ) VALUES (
            $1, $2::uuid, $3,
            $4, $5, $6,
            $7, $8, $9, $10::date,
            $11, $12, $13,
            $14, $15, $16,
            $17, $18
          )`,
          tenantId,
          documentId,
          ticker.toUpperCase(),
          resolution.canonical_id,
          m.rawLabel,
          resolution.display_name,
          m.value,
          m.unit || null,
          m.period || null,
          m.periodEndDate || null,
          m.context || 'as-reported',
          outputFormat,
          m.isEstimate || false,
          m.pageNumber || null,
          m.tableId || null,
          m.section || null,
          sourceFileName,
          m.confidence || 'high',
        );
        result.persisted++;
      } catch (err) {
        this.logger.error(
          `[${documentId}] Failed to persist metric "${resolution.canonical_id}": ${err.message}`,
        );
      }
    }

    this.logger.log(
      `[${documentId}] Metric persistence complete: ${result.persisted} persisted, ` +
      `${result.skippedUnresolved} unresolved, ${result.skippedDuplicate} duplicates`,
    );

    return result;
  }

  /**
   * Extract metrics from intel_document_extractions JSONB and persist
   * them to the flat extracted_metrics table.
   *
   * Called during background enrichment after vision extraction completes.
   */
  async persistFromExtractions(
    documentId: string,
    tenantId: string,
  ): Promise<PersistenceResult> {
    // Fetch document metadata
    const docs = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT company_ticker, file_name FROM intel_documents
       WHERE document_id = $1::uuid AND tenant_id = $2`,
      documentId, tenantId,
    );

    if (!docs?.length || !docs[0].company_ticker) {
      this.logger.warn(`[${documentId}] No ticker found — skipping metric persistence`);
      return { total: 0, persisted: 0, skippedUnresolved: 0, skippedDuplicate: 0 };
    }

    const ticker = docs[0].company_ticker;
    const fileName = docs[0].file_name || 'unknown';

    // Fetch metric extractions from JSONB
    const extractions = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT data, confidence, page_number
       FROM intel_document_extractions
       WHERE document_id = $1::uuid
         AND tenant_id = $2
         AND extraction_type IN ('metric', 'headline')`,
      documentId, tenantId,
    );

    if (!extractions?.length) {
      this.logger.log(`[${documentId}] No metric extractions found`);
      return { total: 0, persisted: 0, skippedUnresolved: 0, skippedDuplicate: 0 };
    }

    // Convert JSONB extractions to ExtractedMetricInput
    const metrics: ExtractedMetricInput[] = [];
    for (const ext of extractions) {
      const data = ext.data;
      if (!data?.metric_key || data?.numeric_value == null) continue;

      metrics.push({
        rawLabel: data.metric_key,
        value: parseFloat(data.numeric_value),
        unit: data.unit,
        period: data.period,
        periodEndDate: data.period_end_date,
        context: data.context || 'as-reported',
        isEstimate: data.is_estimate || false,
        pageNumber: ext.page_number,
        tableId: data.table_id,
        section: data.section,
        confidence: ext.confidence || 'high',
      });
    }

    return this.persistMetrics(documentId, tenantId, ticker, metrics, fileName);
  }

  /**
   * Delete all extracted metrics for a document (for re-extraction).
   */
  async deleteForDocument(documentId: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM extracted_metrics WHERE document_id = $1::uuid`,
      documentId,
    );
  }
}
