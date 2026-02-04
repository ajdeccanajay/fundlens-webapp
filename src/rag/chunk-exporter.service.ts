import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export interface BedrockChunk {
  content: string;
  metadata: {
    ticker: string;
    document_type: string;
    filing_type: string;
    section_type: string;
    subsection_name?: string; // NEW: Fine-grained subsection within major sections
    fiscal_period?: string;
    filing_date?: string;
    chunk_index: number;
    page_number?: number;
    // Multi-tenant fields for Bedrock KB filtering
    visibility: 'public' | 'private';
    tenant_id: string | null; // NULL for public SEC data, tenant ID for private uploads
  };
}

export interface ExportStats {
  totalChunks: number;
  validChunks: number;
  invalidChunks: number;
  totalSize: number;
  byTicker: Record<string, number>;
  bySectionType: Record<string, number>;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Chunk Exporter Service
 * Exports narrative chunks from PostgreSQL to Bedrock-compatible format
 */
@Injectable()
export class ChunkExporterService {
  private readonly logger = new Logger(ChunkExporterService.name);
  private readonly s3Client: S3Client;

  constructor(private readonly prisma: PrismaService) {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }

  /**
   * Export chunks for Bedrock Knowledge Base
   */
  async exportChunksForBedrock(options: {
    ticker?: string;
    limit?: number;
    offset?: number;
    validateOnly?: boolean;
  } = {}): Promise<{
    chunks: BedrockChunk[];
    stats: ExportStats;
  }> {
    this.logger.log(`Exporting chunks for Bedrock KB: ${JSON.stringify(options)}`);

    // Build query filters
    const where: any = {};
    if (options.ticker) {
      where.ticker = options.ticker;
    }

    // Get narrative chunks from database
    const rawChunks = await this.prisma.narrativeChunk.findMany({
      where,
      take: options.limit || 5000, // Use 5000 as default batch size for better performance
      skip: options.offset || 0,
      orderBy: [
        { ticker: 'asc' },
        { chunkIndex: 'asc' },
      ],
    });

    this.logger.log(`Retrieved ${rawChunks.length} raw chunks from database`);

    // Validate and format chunks
    const chunks: BedrockChunk[] = [];
    const stats: ExportStats = {
      totalChunks: rawChunks.length,
      validChunks: 0,
      invalidChunks: 0,
      totalSize: 0,
      byTicker: {},
      bySectionType: {},
    };

    for (const rawChunk of rawChunks) {
      const validation = await this.validateChunk(rawChunk);
      
      if (validation.isValid) {
        const bedrockChunk = this.formatChunkForBedrock(rawChunk);
        chunks.push(bedrockChunk);
        stats.validChunks++;
        stats.totalSize += bedrockChunk.content.length;

        // Update stats
        const ticker = bedrockChunk.metadata.ticker;
        const sectionType = bedrockChunk.metadata.section_type;
        stats.byTicker[ticker] = (stats.byTicker[ticker] || 0) + 1;
        stats.bySectionType[sectionType] = (stats.bySectionType[sectionType] || 0) + 1;
      } else {
        stats.invalidChunks++;
        // Only log first invalid chunk per ticker to reduce noise
        if (!stats.byTicker[`invalid_${rawChunk.ticker}`]) {
          this.logger.warn(
            `Invalid chunk: ${rawChunk.ticker} chunk ${rawChunk.chunkIndex} - ${validation.errors.join(', ')}`
          );
          stats.byTicker[`invalid_${rawChunk.ticker}`] = 1;
        }
      }

      // Skip warning logs to reduce noise - warnings don't affect validity
    }

    this.logger.log(`Export complete: ${stats.validChunks} valid, ${stats.invalidChunks} invalid chunks`);

    return { chunks, stats };
  }

  /**
   * Validate chunk quality for Bedrock KB
   */
  async validateChunk(chunk: any): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!chunk.ticker) errors.push('Missing ticker');
    if (!chunk.sectionType) errors.push('Missing sectionType');
    if (!chunk.content) errors.push('Missing content');
    if (chunk.chunkIndex === null || chunk.chunkIndex === undefined) {
      errors.push('Missing chunkIndex');
    }

    // Content quality
    if (chunk.content) {
      if (chunk.content.length < 100) {
        warnings.push('Content too short (<100 chars)');
      }
      if (chunk.content.length > 8000) {
        warnings.push('Content very long (>8000 chars)');
      }
      if (chunk.content.includes('<') && chunk.content.includes('>')) {
        warnings.push('Content may contain HTML tags');
      }
    }

    // Metadata quality
    if (!chunk.filingType) warnings.push('Missing filingType');
    if (!chunk.fiscalPeriod) warnings.push('Missing fiscalPeriod');
    if (!chunk.filingDate) warnings.push('Missing filingDate');

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Format chunk for Bedrock Knowledge Base
   * 
   * MULTI-TENANT: SEC filings are public data with visibility='public' and tenant_id=NULL.
   * This allows all tenants to access SEC data via Bedrock KB filter:
   * (visibility='public' OR tenant_id=current_tenant)
   * 
   * PHASE 1: Include subsection_name metadata for fine-grained retrieval
   * 
   * Requirements: 7.1, 7.2, 7.3, 7.4, 16.1, 16.5
   */
  private formatChunkForBedrock(chunk: any): BedrockChunk {
    // Determine visibility and tenant_id based on document type
    // SEC filings are always public with no tenant ownership
    const isSecFiling = chunk.documentType === 'sec_filing' || 
                        !chunk.tenantId || 
                        chunk.visibility === 'public';
    
    const metadata: any = {
      ticker: chunk.ticker,
      document_type: chunk.documentType || 'sec_filing',
      filing_type: chunk.filingType || '10-K',
      section_type: chunk.sectionType,
      fiscal_period: chunk.fiscalPeriod,
      filing_date: chunk.filingDate ? new Date(chunk.filingDate).toISOString().split('T')[0] : undefined,
      chunk_index: chunk.chunkIndex,
      page_number: chunk.sourcePage,
      // Multi-tenant fields: SEC data is public, tenant uploads are private
      visibility: isSecFiling ? 'public' : 'private',
      tenant_id: isSecFiling ? null : chunk.tenantId,
    };
    
    // Include subsection_name if available (Phase 1 enhancement)
    // Omit if null to avoid exporting null values to Bedrock KB
    if (chunk.subsectionName) {
      metadata.subsection_name = chunk.subsectionName;
    }
    
    return {
      content: this.cleanContent(chunk.content),
      metadata,
    };
  }

  /**
   * Clean content for Bedrock ingestion
   */
  private cleanContent(content: string): string {
    if (!content) return '';

    return content
      // Remove HTML tags
      .replace(/<[^>]*>/g, '')
      // Remove XBRL namespace references (us-gaap:, aapl:, etc.)
      .replace(/\b[a-z-]+:[A-Za-z0-9_]+/g, '')
      // Remove URLs and URIs
      .replace(/https?:\/\/[^\s]+/g, '')
      // Remove date patterns like 2024-09-28
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      // Remove special characters that might cause issues
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Remove standalone numbers and codes
      .replace(/\b\d{10,}\b/g, '')
      // Clean up multiple spaces again
      .replace(/\s+/g, ' ')
      // Trim
      .trim();
  }

  /**
   * Export chunks to local JSON file (for testing)
   */
  async exportToLocal(options: {
    ticker?: string;
    outputPath: string;
    limit?: number;
  }): Promise<ExportStats> {
    const { chunks, stats } = await this.exportChunksForBedrock({
      ticker: options.ticker,
      limit: options.limit,
    });

    // Write to local file
    const fs = require('fs').promises;
    await fs.writeFile(
      options.outputPath,
      JSON.stringify(chunks, null, 2),
      'utf8'
    );

    this.logger.log(`Exported ${chunks.length} chunks to ${options.outputPath}`);

    return stats;
  }

  /**
   * Upload chunks to S3 for Bedrock Knowledge Base with pagination
   * Creates both content files and .metadata.json files for KB filtering
   * 
   * Bedrock KB metadata filtering requires:
   * - chunk-0.txt (content only - plain text for better embedding)
   * - chunk-0.txt.metadata.json (metadata for filtering)
   * 
   * HARDENED: Individual chunk uploads have retry logic
   */
  async uploadToS3(options: {
    bucket: string;
    ticker?: string;
    keyPrefix?: string;
    dryRun?: boolean;
    batchSize?: number;
    offset?: number;
    concurrency?: number;
  }): Promise<{
    uploadedCount: number;
    totalSize: number;
    keys: string[];
  }> {
    const batchSize = options.batchSize || 1000;
    const offset = options.offset || 0;
    const concurrency = options.concurrency || 20; // Parallel uploads
    
    const { chunks, stats } = await this.exportChunksForBedrock({
      ticker: options.ticker,
      limit: batchSize,
      offset: offset,
    });

    if (options.dryRun) {
      this.logger.log(`DRY RUN: Would upload ${chunks.length} chunks to S3 with metadata files`);
      return {
        uploadedCount: chunks.length,
        totalSize: stats.totalSize,
        keys: chunks.map((_, i) => `${options.keyPrefix || 'chunks'}/${options.ticker || 'all'}/chunk-${i + offset}.txt`),
      };
    }

    const uploadedKeys: string[] = [];
    let uploadedCount = 0;
    let failedCount = 0;

    // Process chunks in parallel batches for faster upload
    for (let i = 0; i < chunks.length; i += concurrency) {
      const batch = chunks.slice(i, i + concurrency);
      
      const uploadPromises = batch.map(async (chunk, batchIndex) => {
        const chunkIndex = i + batchIndex;
        const uniqueIndex = chunkIndex + (options.offset || 0);
        const contentKey = `${options.keyPrefix || 'chunks'}/${chunk.metadata.ticker}/chunk-${uniqueIndex}.txt`;
        const metadataKey = `${contentKey}.metadata.json`;

        // Upload with retry
        return this.uploadChunkWithRetry(
          options.bucket,
          contentKey,
          metadataKey,
          chunk,
        );
      });

      const results = await Promise.all(uploadPromises);
      
      for (const result of results) {
        if (result.success) {
          uploadedKeys.push(result.key);
          uploadedCount++;
        } else {
          failedCount++;
        }
      }

      // Log progress every 100 chunks
      if ((i + concurrency) % 100 === 0 || i + concurrency >= chunks.length) {
        this.logger.log(`Uploaded ${Math.min(i + concurrency, chunks.length)}/${chunks.length} chunks (${failedCount} failed, batch offset: ${offset})`);
      }
    }

    if (failedCount > 0) {
      this.logger.warn(`Batch upload complete with ${failedCount} failures: ${uploadedCount}/${chunks.length} chunks uploaded to S3`);
    } else {
      this.logger.log(`Batch upload complete: ${uploadedCount}/${chunks.length} chunks uploaded to S3 (offset: ${offset})`);
    }

    return {
      uploadedCount,
      totalSize: stats.totalSize,
      keys: uploadedKeys,
    };
  }

  /**
   * Upload single chunk with retry logic
   */
  private async uploadChunkWithRetry(
    bucket: string,
    contentKey: string,
    metadataKey: string,
    chunk: BedrockChunk,
    maxRetries: number = 3,
  ): Promise<{ success: boolean; key: string }> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Upload content and metadata in parallel
        await Promise.all([
          this.s3Client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: contentKey,
            Body: chunk.content,
            ContentType: 'text/plain',
          })),
          this.s3Client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: metadataKey,
            Body: JSON.stringify({
              metadataAttributes: {
                ticker: chunk.metadata.ticker,
                document_type: chunk.metadata.document_type,
                filing_type: chunk.metadata.filing_type,
                section_type: chunk.metadata.section_type,
                ...(chunk.metadata.subsection_name ? { subsection_name: chunk.metadata.subsection_name } : {}),
                ...(chunk.metadata.fiscal_period ? { fiscal_period: chunk.metadata.fiscal_period } : {}),
                ...(chunk.metadata.filing_date ? { filing_date: chunk.metadata.filing_date } : {}),
                chunk_index: String(chunk.metadata.chunk_index),
                // Multi-tenant fields for Bedrock KB filtering
                // SEC data: visibility='public', tenant_id=NULL
                // Tenant uploads: visibility='private', tenant_id=<tenant_id>
                visibility: chunk.metadata.visibility,
                ...(chunk.metadata.tenant_id ? { tenant_id: chunk.metadata.tenant_id } : {}),
              },
            }),
            ContentType: 'application/json',
          })),
        ]);

        return { success: true, key: contentKey };
      } catch (error) {
        const isRetryable = this.isRetryableS3Error(error);
        
        if (isRetryable && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 500; // Shorter delays for individual chunks
          await this.sleep(delay);
          continue;
        }
        
        this.logger.error(`Failed to upload chunk ${contentKey} after ${attempt} attempts: ${error.message}`);
        return { success: false, key: contentKey };
      }
    }
    
    return { success: false, key: contentKey };
  }

  /**
   * Check if S3 error is retryable
   */
  private isRetryableS3Error(error: any): boolean {
    const retryableCodes = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'NetworkingError',
      'TimeoutError',
      'RequestTimeout',
      'ServiceUnavailable',
      'SlowDown',
      'InternalError',
    ];
    
    return (
      retryableCodes.includes(error.code) ||
      retryableCodes.includes(error.name) ||
      error.message?.includes('timeout') ||
      error.message?.includes('network') ||
      error.$metadata?.httpStatusCode === 500 ||
      error.$metadata?.httpStatusCode === 503
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get export statistics without actually exporting
   */
  async getExportStats(ticker?: string): Promise<ExportStats> {
    const { stats } = await this.exportChunksForBedrock({
      ticker,
      validateOnly: true,
    });

    return stats;
  }
}