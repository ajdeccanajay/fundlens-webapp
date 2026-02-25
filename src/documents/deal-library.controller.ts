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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { DealLibraryService } from './deal-library.service';
import type { DocumentTypeFilter } from './deal-library.service';
import { TenantGuard } from '../tenant/tenant.guard';
import { TENANT_CONTEXT_KEY, TenantContext } from '../tenant/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Deal Library Controller — Spec §4
 * API endpoints for bulk document management within a deal.
 *
 * The :dealId param can be either a UUID or a ticker symbol.
 * If a ticker is provided, it's resolved to the deal UUID automatically.
 */
@Controller('deals/:dealId/library')
@UseGuards(TenantGuard)
export class DealLibraryController {
  private readonly logger = new Logger(DealLibraryController.name);

  constructor(
    private readonly libraryService: DealLibraryService,
    private readonly prisma: PrismaService,
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
    const resolvedDealId = await this.resolveDealId(dealId, tenantId);

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
      dealId: resolvedDealId,
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
    const resolvedDealId = await this.resolveDealId(dealId, tenantId);
    return this.libraryService.listDocuments(tenantId, resolvedDealId, filter, sortBy, sortDir);
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
    const resolvedDealId = await this.resolveDealId(dealId, tenantId);
    return this.libraryService.getDocumentCounts(tenantId, resolvedDealId);
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
    const context = (req as any)[TENANT_CONTEXT_KEY] as TenantContext | undefined;
    if (context?.tenantId) return context.tenantId;

    // Fallback for backward compat
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

  /**
   * Resolve dealId param — accepts either UUID or ticker symbol.
   * If it looks like a UUID, use as-is. Otherwise, look up by ticker.
   */
  private async resolveDealId(dealIdOrTicker: string, tenantId: string): Promise<string> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(dealIdOrTicker)) {
      return dealIdOrTicker;
    }

    // Ticker lookup — deals.tenant_id may be text type
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id FROM deals
      WHERE UPPER(ticker) = ${dealIdOrTicker.toUpperCase()}
        AND tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!rows?.length) {
      // Platform admin fallback — try without tenant filter
      const fallback = await this.prisma.$queryRaw<any[]>`
        SELECT id FROM deals
        WHERE UPPER(ticker) = ${dealIdOrTicker.toUpperCase()}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (fallback?.length) return fallback[0].id;

      throw new HttpException(
        `Deal not found for ticker: ${dealIdOrTicker}`,
        HttpStatus.NOT_FOUND,
      );
    }

    return rows[0].id;
  }
}
