/**
 * Documents Service with Tenant Isolation
 * 
 * Provides tenant-isolated document management operations.
 * All documents are stored with tenant-specific S3 prefixes and
 * database records include tenant_id for filtering.
 * 
 * SECURITY:
 * - All uploads use tenant-specific S3 prefix (tenants/{tenant_id}/uploads/)
 * - All queries filter by tenant_id
 * - Cross-tenant access returns 404 (not 403) to prevent info leakage
 * - Creates private data_source records for uploaded documents
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { Injectable, Scope, Inject, Logger, NotFoundException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantAwareS3Service } from '../tenant/tenant-aware-s3.service';
import { TenantContext, TENANT_CONTEXT_KEY } from '../tenant/tenant-context';

export interface UploadDocumentDto {
  ticker?: string;
  documentType: string;
  title?: string;
  sourceUrl?: string;
  metadata?: Record<string, any>;
}

export interface DocumentListFilters {
  ticker?: string;
  documentType?: string;
  processed?: boolean;
  limit?: number;
  offset?: number;
}

// Default tenant for backward compatibility
const DEFAULT_TENANT_ID = 'default-tenant';

/**
 * Request-scoped Documents Service with tenant isolation
 */
@Injectable({ scope: Scope.REQUEST })
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantS3Service: TenantAwareS3Service,
    @Inject(REQUEST) private readonly request: Request,
  ) {}

  /**
   * Get tenant ID from request context
   * Falls back to default tenant for backward compatibility
   */
  private getTenantId(): string {
    const context = (this.request as any)?.[TENANT_CONTEXT_KEY] as TenantContext | undefined;
    return context?.tenantId || DEFAULT_TENANT_ID;
  }

  /**
   * Get user ID from request context
   */
  private getUserId(): string {
    const context = (this.request as any)?.[TENANT_CONTEXT_KEY] as TenantContext | undefined;
    return context?.userId || 'unknown';
  }

  /**
   * Verify document belongs to the current tenant
   * Returns 404 for both "not found" and "wrong tenant" to prevent info leakage
   * 
   * SECURITY: Core tenant isolation check for document operations
   */
  private async verifyDocumentOwnership(documentId: string): Promise<any> {
    const tenantId = this.getTenantId();

    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        tenantId,
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }

  /**
   * Upload a document to S3 and store metadata in database
   * Req 4.1: Upload with tenant S3 prefix
   * Req 4.2: Create document record with tenant_id
   */
  async uploadDocument(
    file: Express.Multer.File,
    dto: UploadDocumentDto,
  ): Promise<any> {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();
    const documentId = randomUUID();
    const fileExtension = this.getFileExtension(file.originalname);

    this.logger.log(`Uploading document: ${file.originalname} for tenant ${tenantId}`);

    try {
      // Upload to S3 with tenant prefix enforcement (Req 4.1)
      const s3Key = await this.tenantS3Service.uploadTenantFile(
        documentId,
        `${documentId}.${fileExtension}`,
        file.buffer,
        {
          contentType: file.mimetype,
          metadata: {
            originalFilename: file.originalname,
            ticker: dto.ticker || 'none',
            documentType: dto.documentType,
          },
        },
      );

      // Create private data_source record for this upload
      const dataSource = await this.prisma.dataSource.create({
        data: {
          type: 'upload',
          sourceId: documentId, // Use document ID as source ID
          visibility: 'private',
          ownerTenantId: tenantId,
          s3Path: s3Key,
          metadata: {
            ticker: dto.ticker,
            title: dto.title || file.originalname,
            uploadedBy: userId,
            originalFilename: file.originalname,
            documentType: dto.documentType,
          },
        },
      });

      // Save document metadata to database with tenant_id (Req 4.2)
      const document = await this.prisma.document.create({
        data: {
          id: documentId,
          tenantId,
          ticker: dto.ticker,
          documentType: dto.documentType,
          fileType: fileExtension,
          title: dto.title || file.originalname,
          s3Bucket: process.env.S3_DATA_LAKE_BUCKET || 'fundlens-data-lake',
          s3Key,
          fileSize: BigInt(file.size),
          sourceUrl: dto.sourceUrl,
          metadata: {
            ...dto.metadata,
            uploadedBy: userId,
            originalFilename: file.originalname,
            dataSourceId: dataSource.id, // Store reference in metadata
          },
          processed: false,
        },
      });

      this.logger.log(`Document uploaded successfully: ${document.id} for tenant ${tenantId}`);

      return {
        id: document.id,
        s3Key: document.s3Key,
        dataSourceId: dataSource.id,
        status: 'uploaded',
        message: 'Document uploaded successfully and ready for processing.',
      };
    } catch (error) {
      this.logger.error(`Error uploading document: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get document by ID with tenant ownership verification
   * Req 4.3: Verify tenant ownership
   */
  async getDocument(id: string) {
    // SECURITY: Verify document ownership
    const document = await this.verifyDocumentOwnership(id);

    // Get chunks count
    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId: id },
      select: {
        id: true,
        chunkIndex: true,
        tokenCount: true,
      },
      orderBy: {
        chunkIndex: 'asc',
      },
    });

    return {
      ...document,
      fileSize: document.fileSize.toString(),
      chunksCount: chunks.length,
      chunks,
    };
  }

  /**
   * List documents with tenant filtering
   * Req 4.3: Filter by tenant
   */
  async listDocuments(filters: DocumentListFilters) {
    const tenantId = this.getTenantId();
    const { ticker, documentType, processed, limit = 50, offset = 0 } = filters;

    // Build WHERE clause with tenant filter
    const where: any = {
      tenantId, // Always filter by tenant
    };
    if (ticker) where.ticker = ticker;
    if (documentType) where.documentType = documentType;
    if (processed !== undefined) where.processed = processed;

    const [documents, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: {
          uploadDate: 'desc',
        },
        include: {
          _count: {
            select: {
              chunks: true,
            },
          },
        },
      }),
      this.prisma.document.count({ where }),
    ]);

    return {
      documents: documents.map((doc) => ({
        ...doc,
        fileSize: doc.fileSize.toString(),
        chunksCount: doc._count.chunks,
      })),
      total,
      limit,
      offset,
    };
  }

  /**
   * Get download URL for a document with ownership verification
   * Req 4.4: Verify tenant ownership before providing download URL
   */
  async getDownloadUrl(id: string, expiresIn = 3600): Promise<string> {
    // SECURITY: Verify document ownership
    const document = await this.verifyDocumentOwnership(id);

    // Use tenant-aware S3 service for URL generation
    return this.tenantS3Service.getTenantFileUrl(document.s3Key, expiresIn);
  }

  /**
   * Delete a document with ownership verification
   * Req 4.5: Verify tenant ownership before deletion
   */
  async deleteDocument(id: string): Promise<void> {
    const tenantId = this.getTenantId();

    // SECURITY: Verify document ownership
    const document = await this.verifyDocumentOwnership(id);

    this.logger.log(`Deleting document ${id} for tenant ${tenantId}`);

    // Delete from S3 using tenant-aware service
    await this.tenantS3Service.deleteTenantFile(document.s3Key);

    // Delete associated data_source if exists (stored in metadata)
    const dataSourceId = (document.metadata as any)?.dataSourceId;
    if (dataSourceId) {
      await this.prisma.dataSource.delete({
        where: { id: dataSourceId },
      }).catch(() => {
        // Ignore if data_source doesn't exist
      });
    }

    // Delete from database (cascades to chunks)
    await this.prisma.document.delete({
      where: { id },
    });

    this.logger.log(`Document deleted: ${id}`);
  }

  /**
   * Mark document as processed
   */
  async markAsProcessed(id: string, error?: string): Promise<void> {
    // SECURITY: Verify document ownership
    await this.verifyDocumentOwnership(id);

    await this.prisma.document.update({
      where: { id },
      data: {
        processed: !error,
        processingError: error,
      },
    });
  }

  /**
   * Get file extension from filename
   */
  private getFileExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'bin';
  }

  /**
   * Get file buffer for download with ownership verification
   */
  async getFileBuffer(id: string): Promise<Buffer> {
    // SECURITY: Verify document ownership
    const document = await this.verifyDocumentOwnership(id);

    return this.tenantS3Service.downloadTenantFile(document.s3Key);
  }

  /**
   * Get document chunks with ownership verification
   */
  async getDocumentChunks(
    documentId: string,
    limit?: number,
    offset?: number,
  ): Promise<any[]> {
    // SECURITY: Verify document ownership
    await this.verifyDocumentOwnership(documentId);

    return this.prisma.documentChunk.findMany({
      where: { documentId },
      take: limit,
      skip: offset,
      orderBy: { chunkIndex: 'asc' },
    });
  }

  /**
   * Get documents statistics for the current tenant
   */
  async getDocumentStats(): Promise<{
    totalDocuments: number;
    totalSize: bigint;
    processedCount: number;
    unprocessedCount: number;
    byType: Record<string, number>;
  }> {
    const tenantId = this.getTenantId();

    const [total, processed, unprocessed, byType, sizeResult] = await Promise.all([
      this.prisma.document.count({ where: { tenantId } }),
      this.prisma.document.count({ where: { tenantId, processed: true } }),
      this.prisma.document.count({ where: { tenantId, processed: false } }),
      this.prisma.document.groupBy({
        by: ['documentType'],
        where: { tenantId },
        _count: true,
      }),
      this.prisma.document.aggregate({
        where: { tenantId },
        _sum: { fileSize: true },
      }),
    ]);

    const byTypeMap: Record<string, number> = {};
    for (const item of byType) {
      byTypeMap[item.documentType] = item._count;
    }

    return {
      totalDocuments: total,
      totalSize: sizeResult._sum.fileSize || BigInt(0),
      processedCount: processed,
      unprocessedCount: unprocessed,
      byType: byTypeMap,
    };
  }
}
