import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import type { RequestPresigningArguments } from '@smithy/types';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor() {
    const region = process.env.AWS_REGION || 'us-east-1';
    this.bucketName = process.env.S3_BUCKET_NAME || 'fundlens-documents-dev';

    this.s3Client = new S3Client({
      region,
      // For local development, you can use LocalStack
      ...(process.env.AWS_ENDPOINT && {
        endpoint: process.env.AWS_ENDPOINT,
        forcePathStyle: true,
      }),
    });

    this.logger.log(`S3 Service initialized with bucket: ${this.bucketName}`);
  }

  /**
   * Upload a file to S3
   */
  async uploadFile(
    file: Express.Multer.File,
    key: string,
    metadata?: Record<string, string>,
  ): Promise<{ key: string; bucket: string; size: number }> {
    try {
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.bucketName,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          Metadata: metadata,
        },
      });

      await upload.done();

      this.logger.log(`File uploaded successfully: ${key}`);

      return {
        key,
        bucket: this.bucketName,
        size: file.size,
      };
    } catch (error) {
      this.logger.error(`Error uploading file to S3: ${error.message}`);
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  /**
   * Upload buffer to S3
   */
  async uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<{ key: string; bucket: string }> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        Metadata: metadata,
      });

      await this.s3Client.send(command);

      this.logger.log(`Buffer uploaded successfully: ${key}`);

      return {
        key,
        bucket: this.bucketName,
      };
    } catch (error) {
      this.logger.error(`Error uploading buffer to S3: ${error.message}`);
      throw new Error(`Failed to upload buffer: ${error.message}`);
    }
  }

  /**
   * Get a signed URL for downloading a file
   */
  async getSignedDownloadUrl(
    key: string,
    expiresIn = 3600,
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      return url;
    } catch (error) {
      this.logger.error(`Error generating signed URL: ${error.message}`);
      throw new Error(`Failed to generate signed URL: ${error.message}`);
    }
  }
  /**
   * Get a signed URL for uploading a file (presigned PUT)
   * Used by Document Intelligence Engine for client-side uploads.
   * 
   * IMPORTANT: We create a separate S3Client without automatic checksums
   * because browsers cannot compute CRC32 checksums, and the presigned URL
   * would include checksum query params that cause CORS preflight failures.
   */
  async getSignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn = 3600,
  ): Promise<string> {
    try {
      // Create a client without checksum for browser-compatible presigned URLs
      const region = process.env.AWS_REGION || 'us-east-1';
      const presignClient = new S3Client({
        region,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        ...(process.env.AWS_ENDPOINT && {
          endpoint: process.env.AWS_ENDPOINT,
          forcePathStyle: true,
        }),
      });

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        ContentType: contentType,
      });

      const url = await getSignedUrl(presignClient, command, { expiresIn });
      presignClient.destroy();
      return url;
    } catch (error) {
      this.logger.error(`Error generating signed upload URL: ${error.message}`);
      throw new Error(`Failed to generate signed upload URL: ${error.message}`);
    }
  }

  /**
   * Get file as a stream
   */
  async getFileStream(key: string): Promise<Readable> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      return response.Body as Readable;
    } catch (error) {
      this.logger.error(`Error getting file stream: ${error.message}`);
      throw new Error(`Failed to get file stream: ${error.message}`);
    }
  }

  /**
   * Get file as buffer
   */
  async getFileBuffer(key: string): Promise<Buffer> {
    try {
      const stream = await this.getFileStream(key);
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
      });
    } catch (error) {
      this.logger.error(`Error getting file buffer: ${error.message}`);
      throw new Error(`Failed to get file buffer: ${error.message}`);
    }
  }

  /**
   * Delete a file from S3
   */
  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.log(`File deleted successfully: ${key}`);
    } catch (error) {
      this.logger.error(`Error deleting file: ${error.message}`);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (error.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(key: string): Promise<{
    size: number;
    contentType: string;
    lastModified: Date;
    metadata?: Record<string, string>;
  }> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      return {
        size: response.ContentLength || 0,
        contentType: response.ContentType || 'application/octet-stream',
        lastModified: response.LastModified || new Date(),
        metadata: response.Metadata,
      };
    } catch (error) {
      this.logger.error(`Error getting file metadata: ${error.message}`);
      throw new Error(`Failed to get file metadata: ${error.message}`);
    }
  }
}
