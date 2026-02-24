import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { DocumentIntelligenceService } from './document-intelligence.service';
import type { InstantIntelligenceResult } from './document-intelligence.service';

/**
 * Document Intelligence Controller
 * Spec §10.1 — API endpoints for chat upload flow
 *
 * POST /api/documents/upload-url        → presigned S3 URL + document record
 * POST /api/documents/:id/upload-complete → triggers instant intelligence
 * GET  /api/documents/:id/status        → polling endpoint for processing state
 */
@Controller('documents')
export class DocumentIntelligenceController {
  private readonly logger = new Logger(DocumentIntelligenceController.name);

  constructor(
    private readonly intelligenceService: DocumentIntelligenceService,
  ) {}

  /**
   * Step 1: Get presigned upload URL (spec §10.1)
   * Frontend calls this FIRST, gets back { uploadUrl, documentId }
   */
  @Post('upload-url')
  async getUploadUrl(
    @Body()
    body: {
      fileName: string;
      fileType: string;
      fileSize: number;
      dealId: string;
      chatSessionId?: string;
      uploadSource: 'chat' | 'deal-library';
    },
    @Req() req: Request,
  ): Promise<{ uploadUrl: string; documentId: string }> {
    const tenantId = this.getTenantId(req);

    // Spec §2.3 — Chat upload restrictions
    if (body.uploadSource === 'chat') {
      const maxSize = 50 * 1024 * 1024; // 50 MB
      if (body.fileSize > maxSize) {
        throw new HttpException(
          'File too large. Chat uploads limited to 50 MB.',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    return this.intelligenceService.createUploadUrl({
      fileName: body.fileName,
      fileType: body.fileType,
      fileSize: body.fileSize,
      tenantId,
      dealId: body.dealId,
      chatSessionId: body.chatSessionId,
      uploadSource: body.uploadSource,
    });
  }

  /**
   * Step 3: Upload complete — trigger instant intelligence (spec §3.1)
   * Frontend calls this AFTER S3 PUT succeeds.
   * Returns instant intelligence result in < 5 seconds.
   */
  @Post(':id/upload-complete')
  async uploadComplete(
    @Param('id') documentId: string,
    @Req() req: Request,
  ): Promise<InstantIntelligenceResult> {
    const tenantId = this.getTenantId(req);

    // Fetch document record to get s3Key and fileType
    const doc = await this.intelligenceService.getDocumentStatus(documentId);
    if (!doc) {
      throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    }

    // Get full document record for s3_key and file_type
    const rows = await (this.intelligenceService as any).prisma.$queryRaw`
      SELECT s3_key, file_type, file_name, tenant_id, deal_id
      FROM intel_documents
      WHERE document_id = ${documentId}::uuid
        AND tenant_id = ${tenantId}::uuid
    `;

    if (!rows?.length) {
      throw new HttpException(
        'Document not found or access denied',
        HttpStatus.NOT_FOUND,
      );
    }

    const record = rows[0];

    return this.intelligenceService.processInstantIntelligence(
      documentId,
      record.s3_key,
      record.file_type,
      record.file_name,
      record.tenant_id,
      record.deal_id,
    );
  }

  /**
   * Status polling endpoint (user feedback addition)
   * Frontend polls this to know when Phase B enrichment completes.
   */
  @Get(':id/status')
  async getStatus(@Param('id') documentId: string) {
    const status =
      await this.intelligenceService.getDocumentStatus(documentId);
    if (!status) {
      throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    }
    return status;
  }

  /**
   * List documents for a deal (used by both chat and deal library)
   */
  @Get('deal/:dealId')
  async listByDeal(
    @Param('dealId') dealId: string,
    @Req() req: Request,
  ) {
    const tenantId = this.getTenantId(req);
    const rows = await (this.intelligenceService as any).prisma.$queryRaw`
      SELECT document_id, file_name, file_type, document_type, status,
             processing_mode, upload_source, page_count, chunk_count,
             metric_count, created_at, updated_at
      FROM intel_documents
      WHERE tenant_id = ${tenantId}::uuid
        AND deal_id = ${dealId}::uuid
      ORDER BY created_at DESC
    `;
    return rows;
  }

  /**
   * Get extracted comp tables for a document (Spec §5.3)
   * Used by frontend to render inline comp tables in chat.
   */
  @Get(':id/tables')
  async getExtractedTables(
    @Param('id') documentId: string,
    @Req() req: Request,
  ) {
    const tenantId = this.getTenantId(req);
    const rows = await (this.intelligenceService as any).prisma.$queryRaw`
      SELECT e.data, e.page_number, e.confidence, e.verified, e.section
      FROM intel_document_extractions e
      JOIN intel_documents d ON e.document_id = d.document_id
      WHERE e.document_id = ${documentId}::uuid
        AND d.tenant_id = ${tenantId}::uuid
        AND e.extraction_type = 'table'
      ORDER BY e.page_number ASC
    `;
    return rows;
  }

  /**
   * Get all extracted metrics for a document (Spec §9.3)
   */
  @Get(':id/metrics')
  async getExtractedMetrics(
    @Param('id') documentId: string,
    @Req() req: Request,
  ) {
    const tenantId = this.getTenantId(req);
    const rows = await (this.intelligenceService as any).prisma.$queryRaw`
      SELECT e.data, e.page_number, e.confidence, e.verified, e.source_layer
      FROM intel_document_extractions e
      JOIN intel_documents d ON e.document_id = d.document_id
      WHERE e.document_id = ${documentId}::uuid
        AND d.tenant_id = ${tenantId}::uuid
        AND e.extraction_type = 'metric'
      ORDER BY e.confidence DESC, e.page_number ASC
    `;
    return rows;
  }

  private getTenantId(req: Request): string {
    // Match existing pattern — tenant from auth context or header
    const tenantId =
      (req as any).tenantId ||
      (req as any).user?.tenantId ||
      req.headers['x-tenant-id'];

    if (!tenantId) {
      throw new HttpException(
        'Tenant context required',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return tenantId as string;
  }
}
