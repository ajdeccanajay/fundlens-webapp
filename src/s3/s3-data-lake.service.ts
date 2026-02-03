import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { PrismaService } from '../../prisma/prisma.service';

export interface S3UploadOptions {
  bucket?: string;
  contentType?: string;
  metadata?: Record<string, string>;
  tags?: Record<string, string>;
}

export interface DataLakeLocation {
  bucket: string;
  key: string;
  url: string;
}

/**
 * S3 Data Lake Service
 * Manages the complete S3 data lake structure with multi-tenant support
 */
@Injectable()
export class S3DataLakeService {
  private readonly logger = new Logger(S3DataLakeService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(private readonly prisma: PrismaService) {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.bucket = process.env.S3_DATA_LAKE_BUCKET || 'fundlens-data-lake';
  }

  /**
   * Upload SEC filing (public data)
   */
  async uploadSECFiling(
    ticker: string,
    filingType: string,
    fiscalPeriod: string,
    content: Buffer | string,
    fileType: 'xml' | 'html' | 'json',
  ): Promise<DataLakeLocation> {
    const key = `public/sec-filings/raw/${ticker}/${filingType}/${fiscalPeriod}/filing.${fileType}`;

    await this.upload(key, content, {
      contentType: this.getContentType(fileType),
      metadata: {
        ticker,
        filingType,
        fiscalPeriod,
        documentType: 'sec_filing',
      },
      tags: {
        visibility: 'public',
        type: 'sec_filing',
      },
    });

    return this.getLocation(key);
  }

  /**
   * Upload processed SEC data (metrics and narratives)
   */
  async uploadProcessedSECData(
    ticker: string,
    filingType: string,
    fiscalPeriod: string,
    data: {
      metrics?: any;
      narratives?: any[];
      metadata?: any;
    },
  ): Promise<{
    metricsLocation?: DataLakeLocation;
    narrativesLocations?: DataLakeLocation[];
    metadataLocation?: DataLakeLocation;
  }> {
    const basePath = `public/sec-filings/processed/${ticker}/${filingType}/${fiscalPeriod}`;
    const result: any = {};

    // Upload metrics
    if (data.metrics) {
      const key = `${basePath}/metrics.json`;
      await this.upload(key, JSON.stringify(data.metrics, null, 2), {
        contentType: 'application/json',
      });
      result.metricsLocation = this.getLocation(key);
    }

    // Upload narratives
    if (data.narratives && data.narratives.length > 0) {
      result.narrativesLocations = [];
      for (let i = 0; i < data.narratives.length; i++) {
        const key = `${basePath}/narratives/chunk-${i}.json`;
        await this.upload(key, JSON.stringify(data.narratives[i], null, 2), {
          contentType: 'application/json',
        });
        result.narrativesLocations.push(this.getLocation(key));
      }
    }

    // Upload metadata
    if (data.metadata) {
      const key = `${basePath}/metadata.json`;
      await this.upload(key, JSON.stringify(data.metadata, null, 2), {
        contentType: 'application/json',
      });
      result.metadataLocation = this.getLocation(key);
    }

    return result;
  }

  /**
   * Upload tenant-private document
   */
  async uploadTenantDocument(
    tenantId: string,
    documentId: string,
    filename: string,
    content: Buffer,
    contentType: string,
  ): Promise<DataLakeLocation> {
    const key = `tenants/${tenantId}/uploads/raw/${documentId}/${filename}`;

    await this.upload(key, content, {
      contentType,
      metadata: {
        tenantId,
        documentId,
        originalFilename: filename,
        documentType: 'upload',
      },
      tags: {
        visibility: 'private',
        type: 'upload',
        tenant: tenantId,
      },
    });

    return this.getLocation(key);
  }

  /**
   * Upload processed tenant document chunks
   */
  async uploadTenantDocumentChunks(
    tenantId: string,
    documentId: string,
    chunks: any[],
  ): Promise<DataLakeLocation[]> {
    const locations: DataLakeLocation[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const key = `tenants/${tenantId}/uploads/processed/${documentId}/chunks/chunk-${i}.json`;
      await this.upload(key, JSON.stringify(chunks[i], null, 2), {
        contentType: 'application/json',
        metadata: {
          tenantId,
          documentId,
          chunkIndex: i.toString(),
        },
      });
      locations.push(this.getLocation(key));
    }

    return locations;
  }

  /**
   * Upload news article (public or premium)
   */
  async uploadNewsArticle(
    articleId: string,
    source: string,
    date: string,
    content: any,
    visibility: 'public' | 'premium',
  ): Promise<DataLakeLocation> {
    const key = `${visibility}/news/raw/${source}/${date}/${articleId}.json`;

    await this.upload(key, JSON.stringify(content, null, 2), {
      contentType: 'application/json',
      metadata: {
        articleId,
        source,
        publishedDate: date,
        documentType: 'news',
      },
      tags: {
        visibility,
        type: 'news',
        source,
      },
    });

    return this.getLocation(key);
  }

  /**
   * Upload processed news chunks
   */
  async uploadNewsChunks(
    articleId: string,
    source: string,
    date: string,
    chunks: any[],
    visibility: 'public' | 'premium',
  ): Promise<DataLakeLocation[]> {
    const locations: DataLakeLocation[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const key = `${visibility}/news/processed/${source}/${date}/${articleId}/chunk-${i}.json`;
      await this.upload(key, JSON.stringify(chunks[i], null, 2), {
        contentType: 'application/json',
      });
      locations.push(this.getLocation(key));
    }

    return locations;
  }



  /**
   * Get S3 path for SEC filing
   */
  getSECFilingPath(
    ticker: string,
    filingType: string,
    fiscalPeriod: string,
    stage: 'raw' | 'processed' = 'raw',
  ): string {
    return `public/sec-filings/${stage}/${ticker}/${filingType}/${fiscalPeriod}`;
  }

  /**
   * Get S3 path for tenant document
   */
  getTenantDocumentPath(
    tenantId: string,
    documentId: string,
    stage: 'raw' | 'processed' = 'raw',
  ): string {
    return `tenants/${tenantId}/uploads/${stage}/${documentId}`;
  }

  /**
   * Get S3 path for news article
   */
  getNewsArticlePath(
    source: string,
    date: string,
    articleId: string,
    visibility: 'public' | 'premium' = 'public',
    stage: 'raw' | 'processed' = 'raw',
  ): string {
    return `${visibility}/news/${stage}/${source}/${date}/${articleId}`;
  }

  /**
   * Public: Upload to S3 with retry
   */
  async upload(
    key: string,
    content: Buffer | string,
    options: S3UploadOptions = {},
  ): Promise<void> {
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const body = typeof content === 'string' ? Buffer.from(content) : content;

        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: options.bucket || this.bucket,
            Key: key,
            Body: body,
            ContentType: options.contentType || 'application/octet-stream',
            Metadata: options.metadata,
            Tagging: options.tags
              ? Object.entries(options.tags)
                  .map(([k, v]) => `${k}=${v}`)
                  .join('&')
              : undefined,
          }),
        );

        this.logger.log(`Uploaded to S3: ${key}`);
        return;
      } catch (error) {
        const isRetryable = this.isRetryableS3Error(error);
        
        if (isRetryable && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.warn(`S3 upload failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${delay}ms...`);
          await this.sleep(delay);
          continue;
        }
        
        this.logger.error(`Error uploading ${key} after ${attempt} attempts: ${error.message}`);
        throw error;
      }
    }
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
   * Private: Get location object
   */
  private getLocation(key: string): DataLakeLocation {
    return {
      bucket: this.bucket,
      key,
      url: `s3://${this.bucket}/${key}`,
    };
  }

  /**
   * Download file from S3
   */
  async download(key: string, bucket?: string): Promise<Buffer> {
    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: bucket || this.bucket,
          Key: key,
        }),
      );

      if (!response.Body) {
        throw new Error('No content in S3 response');
      }

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      const stream = response.Body as any;
      
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      
      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.debug(`Error downloading ${key}: ${error.message}`);
      throw error;
    }
  }

  /**
   * List files in S3 path
   */
  async listFiles(prefix: string, bucket?: string): Promise<string[]> {
    try {
      const response = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket || this.bucket,
          Prefix: prefix,
          MaxKeys: 100,
        }),
      );

      return response.Contents?.map(obj => obj.Key || '') || [];
    } catch (error) {
      this.logger.debug(`Error listing files with prefix ${prefix}: ${error.message}`);
      return [];
    }
  }

  /**
   * Check if file exists in S3
   */
  async exists(key: string, bucket?: string): Promise<boolean> {
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: bucket || this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Private: Get content type
   */
  private getContentType(fileType: string): string {
    const types: Record<string, string> = {
      xml: 'application/xml',
      html: 'text/html',
      json: 'application/json',
      pdf: 'application/pdf',
      txt: 'text/plain',
    };
    return types[fileType] || 'application/octet-stream';
  }
}
