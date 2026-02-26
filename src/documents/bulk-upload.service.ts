/**
 * Bulk Upload Service — Spec §10 (Phase 8)
 *
 * Handles data room ingestion where 20-50 documents arrive at once.
 * Prioritizes by document type (CIM first, misc last) and processes
 * in batches to avoid Bedrock throttling.
 *
 * Emits progress events for frontend WebSocket updates.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BackgroundEnrichmentService } from './background-enrichment.service';

export interface BulkUploadDocument {
  documentId: string;
  fileName: string;
  documentType?: string;
}

export interface BulkUploadProgress {
  processed: number;
  total: number;
  currentBatch: number;
  totalBatches: number;
  readyDocs: { id: string; name: string; type: string; status: string }[];
  failedDocs: { id: string; name: string; error: string }[];
}

export interface BulkUploadResult {
  total: number;
  succeeded: number;
  failed: number;
  documents: { documentId: string; fileName: string; status: string; error?: string }[];
  elapsedMs: number;
}

@Injectable()
export class BulkUploadService {
  private readonly logger = new Logger(BulkUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly enrichment: BackgroundEnrichmentService,
  ) {}

  /**
   * Process a batch of uploaded documents with prioritized ordering.
   * Returns progress after each batch for WebSocket updates.
   */
  async processBulk(
    documents: BulkUploadDocument[],
    tenantId: string,
    dealId: string,
    onProgress?: (progress: BulkUploadProgress) => void,
  ): Promise<BulkUploadResult> {
    const startTime = Date.now();
    const prioritized = this.prioritize(documents);
    const batchSize = 5; // Avoid Bedrock throttling
    const totalBatches = Math.ceil(prioritized.length / batchSize);

    const result: BulkUploadResult = {
      total: prioritized.length,
      succeeded: 0,
      failed: 0,
      documents: [],
      elapsedMs: 0,
    };

    const readyDocs: BulkUploadProgress['readyDocs'] = [];
    const failedDocs: BulkUploadProgress['failedDocs'] = [];

    this.logger.log(
      `Bulk upload: ${prioritized.length} documents, ${totalBatches} batches of ${batchSize}`,
    );

    for (let i = 0; i < prioritized.length; i += batchSize) {
      const batch = prioritized.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      this.logger.log(`Batch ${batchNum}/${totalBatches}: ${batch.map(d => d.fileName).join(', ')}`);

      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(doc => this.processOne(doc, tenantId, dealId)),
      );

      for (let j = 0; j < batchResults.length; j++) {
        const doc = batch[j];
        const batchResult = batchResults[j];

        if (batchResult.status === 'fulfilled') {
          result.succeeded++;
          result.documents.push({
            documentId: doc.documentId,
            fileName: doc.fileName,
            status: 'success',
          });
          readyDocs.push({
            id: doc.documentId,
            name: doc.fileName,
            type: doc.documentType || 'unknown',
            status: 'ready',
          });
        } else {
          result.failed++;
          const error = batchResult.reason?.message || 'Unknown error';
          result.documents.push({
            documentId: doc.documentId,
            fileName: doc.fileName,
            status: 'failed',
            error,
          });
          failedDocs.push({
            id: doc.documentId,
            name: doc.fileName,
            error,
          });
        }
      }

      // Emit progress after each batch
      if (onProgress) {
        onProgress({
          processed: Math.min(i + batchSize, prioritized.length),
          total: prioritized.length,
          currentBatch: batchNum,
          totalBatches,
          readyDocs: [...readyDocs],
          failedDocs: [...failedDocs],
        });
      }
    }

    result.elapsedMs = Date.now() - startTime;
    this.logger.log(
      `Bulk upload complete: ${result.succeeded}/${result.total} succeeded ` +
      `(${result.elapsedMs}ms)`,
    );

    return result;
  }

  /**
   * Process a single document through the enrichment pipeline.
   */
  private async processOne(
    doc: BulkUploadDocument,
    tenantId: string,
    dealId: string,
  ): Promise<void> {
    await this.enrichment.enrichDocument(doc.documentId, tenantId, dealId);
  }

  /**
   * Prioritize documents by type — Spec §10.1
   * CIM first (most valuable for PE), misc last.
   */
  private prioritize(docs: BulkUploadDocument[]): BulkUploadDocument[] {
    const priority: Record<string, number> = {
      cim: 1,
      information_memorandum: 1,
      financial_model: 2,
      management_presentation: 3,
      historical_financials: 4,
      '10-K': 4,
      '10-Q': 4,
      due_diligence_report: 5,
      earnings_transcript: 6,
      earnings_call: 6,
      data_room_misc: 10,
      generic: 9,
    };

    return [...docs].sort((a, b) =>
      (priority[a.documentType || 'generic'] ?? 9) -
      (priority[b.documentType || 'generic'] ?? 9),
    );
  }
}
