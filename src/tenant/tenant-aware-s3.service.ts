/**
 * Tenant-Aware S3 Service
 * 
 * Provides tenant-isolated S3 operations with prefix enforcement.
 * All tenant files are stored under `tenants/{tenant_id}/` prefix.
 * Public SEC data is accessible to all tenants via `public/` prefix.
 * 
 * SECURITY:
 * - All tenant uploads are prefixed with tenant ID
 * - Cross-tenant file access returns 404 (not 403) to prevent info leakage
 * - Security logging for denied access attempts
 * 
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 */

import { Injectable, Scope, Inject, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { TenantContext, TENANT_CONTEXT_KEY } from './tenant-context';

export interface TenantFileUploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface TenantFileInfo {
  key: string;
  bucket: string;
  size?: number;
  lastModified?: Date;
  contentType?: string;
}

// Default tenant for backward compatibility
const DEFAULT_TENANT_ID = 'default-tenant';

/**
 * Request-scoped S3 service with tenant isolation
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantAwareS3Service {
  private readonly logger = new Logger(TenantAwareS3Service.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(REQUEST) private readonly request: Request,
  ) {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.bucket = process.env.S3_DATA_LAKE_BUCKET || 'fundlens-data-lake';
  }

  /**
   * Get tenant ID from request context
   * Falls back to default tenant for backward compatibility
   */
  private getTenantId(): string {
    const context = (this.request as any)?.[TENANT_CONTEXT_KEY] as TenantContext | undefined;
    return context?.tenantId || DEFAULT_TENANT_ID;
  }

  /**
   * Get user ID from request context for audit logging
   */
  private getUserId(): string {
    const context = (this.request as any)?.[TENANT_CONTEXT_KEY] as TenantContext | undefined;
    return context?.userId || 'unknown';
  }

  /**
   * Get the tenant-specific S3 prefix
   */
  private getTenantPrefix(): string {
    return `tenants/${this.getTenantId()}`;
  }

  /**
   * Normalize S3 key to prevent path traversal attacks
   * Resolves ../ and ./ sequences
   */
  private normalizeS3Key(s3Key: string): string {
    // Split by / and resolve path traversal
    const parts = s3Key.split('/');
    const resolved: string[] = [];
    
    for (const part of parts) {
      if (part === '..') {
        resolved.pop(); // Go up one level
      } else if (part !== '.' && part !== '') {
        resolved.push(part);
      }
    }
    
    return resolved.join('/');
  }

  /**
   * Check if an S3 key belongs to the current tenant
   * Req 11.2: Prefix enforcement
   * 
   * SECURITY: Normalizes path to prevent traversal attacks
   */
  private isOwnedByTenant(s3Key: string): boolean {
    const normalizedKey = this.normalizeS3Key(s3Key);
    const tenantPrefix = `${this.getTenantPrefix()}/`;
    return normalizedKey.startsWith(tenantPrefix);
  }

  /**
   * Check if an S3 key is public data
   * 
   * SECURITY: Normalizes path to prevent traversal attacks
   */
  private isPublicFile(s3Key: string): boolean {
    const normalizedKey = this.normalizeS3Key(s3Key);
    return normalizedKey.startsWith('public/');
  }

  /**
   * Log security event for denied access attempts
   * Req 11.6: Security logging
   */
  private logSecurityEvent(action: string, s3Key: string, reason: string): void {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();
    const ip = this.request?.ip || 'unknown';
    const userAgent = this.request?.headers?.['user-agent'] || 'unknown';

    this.logger.warn({
      event: 'S3_ACCESS_DENIED',
      action,
      s3Key,
      reason,
      tenantId,
      userId,
      ip,
      userAgent,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Upload a file to tenant-specific S3 prefix
   * Req 11.1: Upload with tenant prefix enforcement
   * 
   * @param documentId - Unique document identifier
   * @param filename - Original filename
   * @param content - File content as Buffer
   * @param options - Upload options (contentType, metadata)
   * @returns S3 key of uploaded file
   */
  async uploadTenantFile(
    documentId: string,
    filename: string,
    content: Buffer,
    options: TenantFileUploadOptions = {},
  ): Promise<string> {
    const tenantId = this.getTenantId();
    const s3Key = `${this.getTenantPrefix()}/uploads/${documentId}/${filename}`;

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: content,
          ContentType: options.contentType || 'application/octet-stream',
          Metadata: {
            ...options.metadata,
            tenantId,
            documentId,
            originalFilename: filename,
            uploadedBy: this.getUserId(),
            uploadedAt: new Date().toISOString(),
          },
          Tagging: `visibility=private&tenant=${tenantId}`,
        }),
      );

      this.logger.log(`Uploaded tenant file: ${s3Key}`);
      return s3Key;
    } catch (error) {
      this.logger.error(`Failed to upload tenant file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a signed URL for downloading a tenant file
   * Req 11.3: Download with ownership verification
   * 
   * Returns 404 for files not owned by tenant (prevents info leakage)
   * 
   * @param s3Key - S3 key of the file
   * @param expiresIn - URL expiration in seconds (default 1 hour)
   * @returns Signed download URL
   */
  async getTenantFileUrl(s3Key: string, expiresIn = 3600): Promise<string> {
    // SECURITY: Verify the file belongs to this tenant
    if (!this.isOwnedByTenant(s3Key)) {
      this.logSecurityEvent('GET_FILE_URL', s3Key, 'Cross-tenant access attempt');
      throw new NotFoundException('File not found');
    }

    try {
      // Verify file exists
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
        }),
      );

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      });

      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      return url;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException('File not found');
      }
      this.logger.error(`Failed to get tenant file URL: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a tenant file
   * Req 11.4: Delete with ownership verification
   * 
   * Returns 404 for files not owned by tenant (prevents info leakage)
   * 
   * @param s3Key - S3 key of the file to delete
   */
  async deleteTenantFile(s3Key: string): Promise<void> {
    // SECURITY: Verify the file belongs to this tenant
    if (!this.isOwnedByTenant(s3Key)) {
      this.logSecurityEvent('DELETE_FILE', s3Key, 'Cross-tenant delete attempt');
      throw new NotFoundException('File not found');
    }

    try {
      // Verify file exists before deleting
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
        }),
      );

      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
        }),
      );

      this.logger.log(`Deleted tenant file: ${s3Key}`);
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException('File not found');
      }
      this.logger.error(`Failed to delete tenant file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a signed URL for public SEC data
   * Req 11.5: Access public SEC data (no tenant prefix)
   * 
   * Only allows access to files in the public/ prefix
   * 
   * @param s3Key - S3 key of the public file
   * @param expiresIn - URL expiration in seconds (default 1 hour)
   * @returns Signed download URL
   */
  async getPublicFileUrl(s3Key: string, expiresIn = 3600): Promise<string> {
    // SECURITY: Only allow access to public files
    if (!this.isPublicFile(s3Key)) {
      this.logSecurityEvent('GET_PUBLIC_URL', s3Key, 'Attempted to access non-public file as public');
      throw new ForbiddenException('Not a public file');
    }

    try {
      // Verify file exists
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
        }),
      );

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      });

      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      return url;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException('File not found');
      }
      this.logger.error(`Failed to get public file URL: ${error.message}`);
      throw error;
    }
  }

  /**
   * List files in tenant's upload directory
   * Only returns files owned by the current tenant
   * 
   * @param prefix - Optional prefix within tenant's directory
   * @param maxKeys - Maximum number of keys to return (default 100)
   * @returns Array of file info objects
   */
  async listTenantFiles(prefix?: string, maxKeys = 100): Promise<TenantFileInfo[]> {
    const tenantPrefix = prefix
      ? `${this.getTenantPrefix()}/uploads/${prefix}`
      : `${this.getTenantPrefix()}/uploads/`;

    try {
      const response = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: tenantPrefix,
          MaxKeys: maxKeys,
        }),
      );

      return (response.Contents || []).map(obj => ({
        key: obj.Key || '',
        bucket: this.bucket,
        size: obj.Size,
        lastModified: obj.LastModified,
      }));
    } catch (error) {
      this.logger.error(`Failed to list tenant files: ${error.message}`);
      return [];
    }
  }

  /**
   * Check if a tenant file exists
   * Only checks files owned by the current tenant
   * 
   * @param s3Key - S3 key to check
   * @returns true if file exists and is owned by tenant
   */
  async tenantFileExists(s3Key: string): Promise<boolean> {
    // Only check files owned by this tenant
    if (!this.isOwnedByTenant(s3Key)) {
      return false;
    }

    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
        }),
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Download tenant file content
   * Req 11.3: Download with ownership verification
   * 
   * @param s3Key - S3 key of the file
   * @returns File content as Buffer
   */
  async downloadTenantFile(s3Key: string): Promise<Buffer> {
    // SECURITY: Verify the file belongs to this tenant
    if (!this.isOwnedByTenant(s3Key)) {
      this.logSecurityEvent('DOWNLOAD_FILE', s3Key, 'Cross-tenant download attempt');
      throw new NotFoundException('File not found');
    }

    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
        }),
      );

      if (!response.Body) {
        throw new NotFoundException('File not found');
      }

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      const stream = response.Body as any;
      
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      
      return Buffer.concat(chunks);
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException('File not found');
      }
      this.logger.error(`Failed to download tenant file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get file metadata for a tenant file
   * 
   * @param s3Key - S3 key of the file
   * @returns File info with metadata
   */
  async getTenantFileInfo(s3Key: string): Promise<TenantFileInfo & { metadata?: Record<string, string> }> {
    // SECURITY: Verify the file belongs to this tenant
    if (!this.isOwnedByTenant(s3Key)) {
      this.logSecurityEvent('GET_FILE_INFO', s3Key, 'Cross-tenant info access attempt');
      throw new NotFoundException('File not found');
    }

    try {
      const response = await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
        }),
      );

      return {
        key: s3Key,
        bucket: this.bucket,
        size: response.ContentLength,
        lastModified: response.LastModified,
        contentType: response.ContentType,
        metadata: response.Metadata,
      };
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException('File not found');
      }
      this.logger.error(`Failed to get tenant file info: ${error.message}`);
      throw error;
    }
  }
}
