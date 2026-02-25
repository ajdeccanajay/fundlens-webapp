import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  Req,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { DealLibraryService } from './deal-library.service';
import type { DocumentTypeFilter } from './deal-library.service';

/**
 * Deal Library Controller — Spec §4
 * API endpoints for bulk document management within a deal.
 *
 * POST   /api/deals/:dealId/library/upload-url          → presigned URL for upload
 * POST   /api/deals/:dealId/library/:documentId/upload-complete → trigger processing
 * GET    /api/deals/:dealId/library                      → list documents with filters
 * GET    /api/deals/:dealId/library/counts               → document counts by type
 * DELETE /api/deals/:dealId/library/:documentId          → remove document
 */
@Controller('deals/:dealId/library')
export class DealLibraryController {
  private readonly logger = new Logger(DealLibraryController.name);

  constructor(
    private readonly libraryService: DealLibraryService,
  ) {}

  /**
   * Get presigned upload URL for Deal Library upload
   * Supports bulk — frontend calls once per file.
   */
  @Post('upload-url')
  async getUploadUrl(
    @Param('dealId') dealId: string,
    @Body() body: { fileName: string; fileType: string; fileSize: number },
    @Req() req: Request,
  ): Promise<{ uploadUrl: string; documentId: string }> {
    const tenantId = this.getTenantId(req);

    if (!body.fileName || !body.fileType || !body.fileSize) {
      throw new HttpException(
        'fileName, fileType, and fileSize are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Deal Library has no file size limit (unlike chat's 50MB)
    // but we cap at 500MB for sanity
    const maxSize = 500 * 1024 * 1024;
    if (body.fileSize > maxSize) {
      throw new HttpException(
        'File too large. Maximum 500 MB per file.',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.libraryService.createUploadUrl({
      fileName: body.fileName,
      fileType: body.fileType,
      fileSize: body.fileSize,
      tenantId,
      dealId,
    });
  }

  /**
   * Trigger background processing after S3 upload completes (Spec §4.3)
   */
  @Post(':documentId/upload-complete')
  async uploadComplete(
    @Param('dealId') dealId: string,
    @Param('documentId') documentId: string,
    @Req() req: Request,
  ): Promise<{ status: string; documentId: string }> {
    const tenantId = this.getTenantId(req);
    return this.libraryService.triggerProcessing(documentId, tenantId);
  }

  /**
   * List documents with optional type filter and sort (Spec §4.2)
   */
  @Get()
  async listDocuments(
    @Param('dealId') dealId: string,
    @Query('filter') filter: DocumentTypeFilter = 'all',
    @Query('sortBy') sortBy: 'date' | 'name' | 'type' | 'status' = 'date',
    @Query('sortDir') sortDir: 'asc' | 'desc' = 'desc',
    @Req() req: Request,
  ) {
    const tenantId = this.getTenantId(req);
    return this.libraryService.listDocuments(tenantId, dealId, filter, sortBy, sortDir);
  }

  /**
   * Get document counts by type for filter badges
   */
  @Get('counts')
  async getDocumentCounts(
    @Param('dealId') dealId: string,
    @Req() req: Request,
  ) {
    const tenantId = this.getTenantId(req);
    return this.libraryService.getDocumentCounts(tenantId, dealId);
  }

  /**
   * Delete a document from Deal Library
   */
  @Delete(':documentId')
  async deleteDocument(
    @Param('dealId') dealId: string,
    @Param('documentId') documentId: string,
    @Req() req: Request,
  ) {
    const tenantId = this.getTenantId(req);
    const result = await this.libraryService.deleteDocument(documentId, tenantId);
    if (!result.deleted) {
      throw new HttpException('Document not found or access denied', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  private getTenantId(req: Request): string {
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
