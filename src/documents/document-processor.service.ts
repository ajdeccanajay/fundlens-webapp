/**
 * Document Processor Service with Tenant Tagging
 * 
 * Processes documents and extracts text/metrics with tenant isolation.
 * All extracted chunks are tagged with tenant_id in metadata for
 * Bedrock KB filtering.
 * 
 * SECURITY:
 * - All chunks include tenant_id in metadata
 * - Chunks are indexed to Bedrock KB with tenant filter capability
 * - Processing respects document ownership
 * 
 * Requirements: 4.6
 */

import { Injectable, Scope, Inject, Logger, NotFoundException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantAwareS3Service } from '../tenant/tenant-aware-s3.service';
import { TenantContext, TENANT_CONTEXT_KEY } from '../tenant/tenant-context';
import { firstValueFrom } from 'rxjs';

export interface ProcessingResult {
  documentId: string;
  success: boolean;
  metricsExtracted?: number;
  chunksCreated?: number;
  error?: string;
}

// Default tenant for backward compatibility
const DEFAULT_TENANT_ID = 'default-tenant';

/**
 * Request-scoped Document Processor Service with tenant tagging
 */
@Injectable({ scope: Scope.REQUEST })
export class DocumentProcessorService {
  private readonly logger = new Logger(DocumentProcessorService.name);
  private readonly parserUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly tenantS3Service: TenantAwareS3Service,
    @Inject(REQUEST) private readonly request: Request,
  ) {
    this.parserUrl = process.env.PYTHON_PARSER_URL || 'http://localhost:8000';
  }

  /**
   * Get tenant ID from request context
   */
  private getTenantId(): string {
    const context = (this.request as any)?.[TENANT_CONTEXT_KEY] as TenantContext | undefined;
    return context?.tenantId || DEFAULT_TENANT_ID;
  }

  /**
   * Verify document belongs to the current tenant
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
   * Process a document: extract text, chunk, and optionally extract metrics
   * Req 4.6: Tag all chunks with tenant_id
   */
  async processDocument(documentId: string): Promise<ProcessingResult> {
    const tenantId = this.getTenantId();
    this.logger.log(`Starting processing for document: ${documentId} (tenant: ${tenantId})`);

    try {
      // SECURITY: Verify document ownership
      const document = await this.verifyDocumentOwnership(documentId);

      // Download file from S3 using tenant-aware service
      const fileBuffer = await this.tenantS3Service.downloadTenantFile(document.s3Key);

      // Determine processing strategy based on document type
      if (document.documentType === 'sec_filing') {
        return await this.processSECFiling(document, fileBuffer, tenantId);
      } else {
        return await this.processGenericDocument(document, fileBuffer, tenantId);
      }
    } catch (error) {
      this.logger.error(`Error processing document ${documentId}: ${error.message}`);
      
      // Mark as failed (only if we have ownership)
      try {
        await this.prisma.document.updateMany({
          where: { 
            id: documentId,
            tenantId: this.getTenantId(),
          },
          data: {
            processed: false,
            processingError: error.message,
          },
        });
      } catch (updateError) {
        this.logger.warn(`Could not update document status: ${updateError.message}`);
      }

      return {
        documentId,
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Process SEC filing with full metric extraction
   * Tags all chunks with tenant_id (Req 4.6)
   */
  private async processSECFiling(
    document: any,
    fileBuffer: Buffer,
    tenantId: string,
  ): Promise<ProcessingResult> {
    this.logger.log(`Processing SEC filing: ${document.id} for tenant ${tenantId}`);

    try {
      // Call Python parser for full extraction
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', fileBuffer, {
        filename: 'filing.html',
        contentType: 'text/html',
      });
      formData.append('ticker', document.ticker || 'UNKNOWN');

      const response = await firstValueFrom(
        this.httpService.post(`${this.parserUrl}/parse`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          timeout: 120000, // 2 minutes
        }),
      );

      const result = response.data;

      // Save metrics to database
      let metricsCount = 0;
      if (result.metrics && result.metrics.length > 0) {
        for (const metric of result.metrics) {
          try {
            await this.prisma.financialMetric.upsert({
              where: {
                ticker_normalizedMetric_fiscalPeriod_filingType: {
                  ticker: metric.ticker,
                  normalizedMetric: metric.normalized_metric,
                  fiscalPeriod: metric.fiscal_period,
                  filingType: metric.filing_type,
                },
              },
              create: {
                ticker: metric.ticker,
                normalizedMetric: metric.normalized_metric,
                rawLabel: metric.raw_label,
                value: metric.value,
                fiscalPeriod: metric.fiscal_period,
                periodType: metric.period_type,
                filingType: metric.filing_type,
                statementType: metric.statement_type,
                filingDate: new Date(metric.filing_date),
                statementDate: new Date(metric.statement_date),
                confidenceScore: metric.confidence_score,
                sourcePage: metric.source_page,
                xbrlTag: metric.xbrl_tag,
              },
              update: {
                value: metric.value,
                confidenceScore: metric.confidence_score,
              },
            });
            metricsCount++;
          } catch (error) {
            this.logger.warn(`Failed to save metric: ${error.message}`);
          }
        }
      }

      // Save narrative chunks with tenant_id in metadata (Req 4.6)
      let chunksCount = 0;
      if (result.chunks && result.chunks.length > 0) {
        for (const chunk of result.chunks) {
          await this.prisma.documentChunk.create({
            data: {
              documentId: document.id,
              tenantId: tenantId, // Add required field
              chunkIndex: chunk.chunk_index,
              content: chunk.content,
              tokenCount: chunk.content.split(/\s+/).length,
              metadata: {
                // CRITICAL: Include tenant_id for Bedrock KB filtering
                tenant_id: tenantId,
                sectionType: chunk.section_type,
                ticker: chunk.ticker,
                filingType: chunk.filing_type,
                visibility: 'private', // Tenant uploads are private
                documentId: document.id,
              },
            },
          });
          chunksCount++;
        }
      }

      // Mark as processed
      await this.prisma.document.update({
        where: { id: document.id },
        data: {
          processed: true,
          processingError: null,
        },
      });

      this.logger.log(
        `✅ SEC filing processed for tenant ${tenantId}: ${metricsCount} metrics, ${chunksCount} chunks`,
      );

      return {
        documentId: document.id,
        success: true,
        metricsExtracted: metricsCount,
        chunksCreated: chunksCount,
      };
    } catch (error) {
      throw new Error(`SEC filing processing failed: ${error.message}`);
    }
  }

  /**
   * Process generic document (PDF, DOCX, PPTX) with chunking only
   * Tags all chunks with tenant_id (Req 4.6)
   */
  private async processGenericDocument(
    document: any,
    fileBuffer: Buffer,
    tenantId: string,
  ): Promise<ProcessingResult> {
    this.logger.log(`Processing generic document: ${document.id} for tenant ${tenantId}`);

    try {
      // Call Python parser for text extraction and chunking
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', fileBuffer, {
        filename: `document.${document.fileType}`,
        contentType: this.getContentType(document.fileType),
      });

      const response = await firstValueFrom(
        this.httpService.post(`${this.parserUrl}/extract-text`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          timeout: 60000, // 1 minute
        }),
      );

      const result = response.data;

      // Chunk the text
      const chunks = this.chunkText(result.text, 1500, 200);

      // Save chunks to database with tenant_id in metadata (Req 4.6)
      for (let i = 0; i < chunks.length; i++) {
        await this.prisma.documentChunk.create({
          data: {
            documentId: document.id,
            tenantId: tenantId, // Add required field
            chunkIndex: i,
            content: chunks[i],
            tokenCount: chunks[i].split(/\s+/).length,
            metadata: {
              // CRITICAL: Include tenant_id for Bedrock KB filtering
              tenant_id: tenantId,
              documentType: document.documentType,
              ticker: document.ticker,
              visibility: 'private', // Tenant uploads are private
              documentId: document.id,
            },
          },
        });
      }

      // Mark as processed
      await this.prisma.document.update({
        where: { id: document.id },
        data: {
          processed: true,
          processingError: null,
        },
      });

      this.logger.log(`✅ Generic document processed for tenant ${tenantId}: ${chunks.length} chunks`);

      return {
        documentId: document.id,
        success: true,
        chunksCreated: chunks.length,
      };
    } catch (error) {
      throw new Error(`Generic document processing failed: ${error.message}`);
    }
  }

  /**
   * Chunk text with overlap
   */
  private chunkText(
    text: string,
    chunkSize: number,
    overlap: number,
  ): string[] {
    const words = text.split(/\s+/);
    const chunks: string[] = [];

    for (let i = 0; i < words.length; i += chunkSize - overlap) {
      const chunk = words.slice(i, i + chunkSize).join(' ');
      if (chunk.trim()) {
        chunks.push(chunk);
      }
    }

    return chunks;
  }

  /**
   * Get content type for file extension
   */
  private getContentType(fileType: string): string {
    const contentTypes: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      html: 'text/html',
      txt: 'text/plain',
    };
    return contentTypes[fileType] || 'application/octet-stream';
  }

  /**
   * Batch process multiple documents (tenant-scoped)
   */
  async batchProcessDocuments(documentIds: string[]): Promise<ProcessingResult[]> {
    const tenantId = this.getTenantId();
    this.logger.log(`Batch processing ${documentIds.length} documents for tenant ${tenantId}`);

    const results: ProcessingResult[] = [];

    for (const documentId of documentIds) {
      const result = await this.processDocument(documentId);
      results.push(result);
    }

    return results;
  }

  /**
   * Process all unprocessed documents for the current tenant
   */
  async processUnprocessedDocuments(): Promise<ProcessingResult[]> {
    const tenantId = this.getTenantId();

    // Only get unprocessed documents for this tenant
    const unprocessed = await this.prisma.document.findMany({
      where: { 
        processed: false,
        tenantId,
      },
      take: 10, // Process 10 at a time
    });

    this.logger.log(`Found ${unprocessed.length} unprocessed documents for tenant ${tenantId}`);

    return this.batchProcessDocuments(unprocessed.map((d) => d.id));
  }
}
