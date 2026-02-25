import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../services/s3.service';
import { BackgroundEnrichmentService } from './background-enrichment.service';

/**
 * Deal Library Service — Spec §4
 * Background processing pipeline for bulk document uploads.
 * Documents uploaded here are processed at NORMAL priority
 * and synced to Bedrock KB for permanent availability.
 */

export interface DealLibraryDocument {
  document_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  document_type: string | null;
  status: string;
  processing_mode: string | null;
  upload_source: string;
  page_count: number | null;
  chunk_count: number | null;
  metric_count: number | null;
  kb_sync_status: string;
  error: string | null;
  retry_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface LibraryUploadResult {
  documentId: string;
  uploadUrl: string;
}

export type DocumentTypeFilter =
  | 'all'
  | 'sell-side'
  | 'filings'
  | 'transcripts'
  | 'cims'
  | 'memos'
  | 'other';

@Injectable()
export class DealLibraryService {
  private readonly logger = new Logger(DealLibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly enrichment: BackgroundEnrichmentService,
  ) {}

  /**
   * Create presigned upload URL for Deal Library upload (Spec §4.2)
   * Supports bulk upload — called once per file.
   */
  async createUploadUrl(params: {
    fileName: string;
    fileType: string;
    fileSize: number;
    tenantId: string;
    dealId: string;
  }): Promise<LibraryUploadResult> {
    const { fileName, fileType, fileSize, tenantId, dealId } = params;

    // Generate deal_library_id for this upload
    const dealLibraryId = crypto.randomUUID();

    // S3 key: raw-uploads/{tenant_id}/{deal_id}/{document_id}/original_file
    const documentId = crypto.randomUUID();
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const s3Key = `raw-uploads/${tenantId}/${dealId}/${documentId}/${safeFileName}`;

    // Create document record with upload_source = 'deal-library'
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO intel_documents
        (document_id, tenant_id, deal_id, deal_library_id, file_name, file_type, file_size, s3_key, status, upload_source)
      VALUES
        ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, 'uploading', 'deal-library')`,
      documentId,
      tenantId,
      dealId,
      dealLibraryId,
      fileName,
      fileType,
      fileSize,
      s3Key,
    );

    // Generate presigned PUT URL
    const uploadUrl = await this.s3.getSignedUploadUrl(s3Key, fileType, 3600);

    this.logger.log(
      `[${documentId}] Deal Library upload URL created for ${fileName}`,
    );

    return { documentId, uploadUrl };
  }

  /**
   * Trigger background processing after S3 upload completes (Spec §4.3)
   * NORMAL priority — runs in background, retries up to 3 times.
   */
  async triggerProcessing(
    documentId: string,
    tenantId: string,
  ): Promise<{ status: string; documentId: string }> {
    // Verify document exists and belongs to tenant
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT document_id, tenant_id, deal_id, s3_key, file_type, file_name, status
      FROM intel_documents
      WHERE document_id = ${documentId}::uuid
        AND tenant_id = ${tenantId}::uuid
        AND upload_source = 'deal-library'
    `;

    if (!rows?.length) {
      throw new Error('Document not found or access denied');
    }

    const doc = rows[0];

    if (doc.status !== 'uploading') {
      return { status: doc.status, documentId };
    }

    // Update status to processing
    await this.prisma.$executeRawUnsafe(
      `UPDATE intel_documents SET status = 'processing', updated_at = NOW()
       WHERE document_id = $1::uuid`,
      documentId,
    );

    // Fire background enrichment asynchronously (NORMAL priority)
    // This runs the full pipeline: text extraction → classification → vision → verify → chunk → embed → KB prep
    this.processInBackground(documentId, doc.tenant_id, doc.deal_id, doc.s3_key, doc.file_type, doc.file_name)
      .catch(err => {
        this.logger.error(`[${documentId}] Background processing failed: ${err.message}`);
      });

    return { status: 'processing', documentId };
  }

  /**
   * Full background processing pipeline for Deal Library documents (Spec §4.3)
   * More aggressive than chat — we have time. Retries up to 3 times.
   */
  private async processInBackground(
    documentId: string,
    tenantId: string,
    dealId: string,
    s3Key: string,
    fileType: string,
    fileName: string,
  ): Promise<void> {
    try {
      // Run the full enrichment pipeline directly.
      // For Deal Library, we process everything in background — no instant intelligence needed.
      await this.enrichment.enrichDocument(documentId, tenantId, dealId);

      // Update status to queryable after enrichment
      await this.prisma.$executeRawUnsafe(
        `UPDATE intel_documents SET
          status = 'queryable',
          updated_at = NOW()
        WHERE document_id = $1::uuid
          AND status != 'fully-indexed'`,
        documentId,
      );

      this.logger.log(`[${documentId}] Deal Library processing complete`);
    } catch (error) {
      // Check retry count
      const retryRows = await this.prisma.$queryRaw<any[]>`
        SELECT retry_count FROM intel_documents WHERE document_id = ${documentId}::uuid
      `;
      const retryCount = retryRows?.[0]?.retry_count || 0;

      if (retryCount < 3) {
        // Requeue with backoff (Spec §4.3)
        const backoffMs = Math.pow(2, retryCount) * 5000; // 5s, 10s, 20s
        this.logger.warn(
          `[${documentId}] Retry ${retryCount + 1}/3 in ${backoffMs}ms: ${error.message}`,
        );

        await this.prisma.$executeRawUnsafe(
          `UPDATE intel_documents SET
            retry_count = retry_count + 1,
            error = $1,
            updated_at = NOW()
          WHERE document_id = $2::uuid`,
          `Retry ${retryCount + 1}: ${error.message}`,
          documentId,
        );

        // Schedule retry
        setTimeout(() => {
          this.processInBackground(documentId, tenantId, dealId, s3Key, fileType, fileName)
            .catch(() => {});
        }, backoffMs);
      } else {
        // Max retries exceeded — mark as error
        await this.prisma.$executeRawUnsafe(
          `UPDATE intel_documents SET
            status = 'error',
            error = $1,
            updated_at = NOW()
          WHERE document_id = $2::uuid`,
          `Processing failed after 3 retries: ${error.message}`,
          documentId,
        );
        this.logger.error(
          `[${documentId}] Deal Library processing failed permanently: ${error.message}`,
        );
      }
    }
  }

  /**
   * List documents for a deal with optional type filter (Spec §4.2)
   */
  async listDocuments(
    tenantId: string,
    dealId: string,
    filter: DocumentTypeFilter = 'all',
    sortBy: 'date' | 'name' | 'type' | 'status' = 'date',
    sortDir: 'asc' | 'desc' = 'desc',
  ): Promise<DealLibraryDocument[]> {
    // Build type filter clause
    let typeFilter = '';
    switch (filter) {
      case 'sell-side':
        typeFilter = `AND document_type = 'sell-side-report'`;
        break;
      case 'filings':
        typeFilter = `AND document_type IN ('sec-10k', 'sec-10q', 'sec-8k', 'sec-proxy')`;
        break;
      case 'transcripts':
        typeFilter = `AND document_type = 'earnings-transcript'`;
        break;
      case 'cims':
        typeFilter = `AND document_type = 'pe-cim'`;
        break;
      case 'memos':
        typeFilter = `AND document_type = 'ic-memo'`;
        break;
      case 'other':
        typeFilter = `AND document_type NOT IN ('sell-side-report', 'sec-10k', 'sec-10q', 'sec-8k', 'sec-proxy', 'earnings-transcript', 'pe-cim', 'ic-memo')`;
        break;
    }

    // Build sort clause
    let orderBy = 'created_at DESC';
    switch (sortBy) {
      case 'name': orderBy = `file_name ${sortDir.toUpperCase()}`; break;
      case 'type': orderBy = `document_type ${sortDir.toUpperCase()}`; break;
      case 'status': orderBy = `status ${sortDir.toUpperCase()}`; break;
      default: orderBy = `created_at ${sortDir.toUpperCase()}`; break;
    }

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT document_id, file_name, file_type, file_size, document_type,
              status, processing_mode, upload_source, page_count, chunk_count,
              metric_count, kb_sync_status, error, retry_count, created_at, updated_at
       FROM intel_documents
       WHERE tenant_id = $1::uuid
         AND deal_id = $2::uuid
         AND upload_source = 'deal-library'
         ${typeFilter}
       ORDER BY ${orderBy}`,
      tenantId,
      dealId,
    );

    // Convert BigInt fields (file_size) to Number for JSON serialization
    return rows.map(r => ({
      ...r,
      file_size: r.file_size != null ? Number(r.file_size) : null,
    }));
  }

  /**
   * Delete a document from Deal Library (Spec §4.2)
   * Removes from RDS + S3 + OpenSearch index
   */
  async deleteDocument(
    documentId: string,
    tenantId: string,
  ): Promise<{ deleted: boolean }> {
    // Verify ownership
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT s3_key, raw_text_s3_key
      FROM intel_documents
      WHERE document_id = ${documentId}::uuid
        AND tenant_id = ${tenantId}::uuid
    `;

    if (!rows?.length) {
      return { deleted: false };
    }

    const doc = rows[0];

    // Delete extractions first (FK constraint)
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM intel_document_extractions WHERE document_id = $1::uuid`,
      documentId,
    );

    // Delete chunks
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM intel_document_chunks WHERE document_id = $1::uuid`,
      documentId,
    ).catch(() => {}); // Table may not exist yet

    // Delete document record
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM intel_documents WHERE document_id = $1::uuid`,
      documentId,
    );

    // Delete S3 objects (best effort)
    try {
      if (doc.s3_key) await this.s3.deleteFile(doc.s3_key);
      if (doc.raw_text_s3_key) await this.s3.deleteFile(doc.raw_text_s3_key);
    } catch (err) {
      this.logger.warn(`[${documentId}] S3 cleanup partial: ${err.message}`);
    }

    this.logger.log(`[${documentId}] Document deleted from Deal Library`);
    return { deleted: true };
  }

  /**
   * Get document counts by type for filter badges (Spec §4.2)
   */
  async getDocumentCounts(
    tenantId: string,
    dealId: string,
  ): Promise<Record<string, number>> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE document_type = 'sell-side-report') as sell_side,
        COUNT(*) FILTER (WHERE document_type IN ('sec-10k', 'sec-10q', 'sec-8k', 'sec-proxy')) as filings,
        COUNT(*) FILTER (WHERE document_type = 'earnings-transcript') as transcripts,
        COUNT(*) FILTER (WHERE document_type = 'pe-cim') as cims,
        COUNT(*) FILTER (WHERE document_type = 'ic-memo') as memos
      FROM intel_documents
      WHERE tenant_id = ${tenantId}::uuid
        AND deal_id = ${dealId}::uuid
        AND upload_source = 'deal-library'
    `;

    const r = rows?.[0] || {};
    const total = Number(r.total) || 0;
    const known = ['sell_side', 'filings', 'transcripts', 'cims', 'memos']
      .reduce((sum, k) => sum + (Number(r[k]) || 0), 0);

    return {
      all: total,
      'sell-side': Number(r.sell_side) || 0,
      filings: Number(r.filings) || 0,
      transcripts: Number(r.transcripts) || 0,
      cims: Number(r.cims) || 0,
      memos: Number(r.memos) || 0,
      other: total - known,
    };
  }
}
