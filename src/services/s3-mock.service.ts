import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';

/**
 * Mock S3 Service for local development
 * Stores files in local filesystem instead of AWS S3
 */
@Injectable()
export class S3MockService {
  private readonly logger = new Logger(S3MockService.name);
  private readonly localStoragePath: string;
  private readonly bucketName: string;

  constructor() {
    this.bucketName = process.env.S3_BUCKET_NAME || 'fundlens-documents-dev';
    this.localStoragePath = join(process.cwd(), 'local-s3-storage', this.bucketName);
    this.logger.log(`Mock S3 Service initialized. Files will be stored in: ${this.localStoragePath}`);
    this.ensureStorageDirectory();
  }

  private async ensureStorageDirectory() {
    try {
      await fs.mkdir(this.localStoragePath, { recursive: true });
    } catch (error) {
      this.logger.error(`Error creating storage directory: ${error.message}`);
    }
  }

  async uploadFile(
    file: Express.Multer.File,
    key: string,
    metadata?: Record<string, string>,
  ): Promise<{ key: string; bucket: string; size: number }> {
    try {
      const filePath = join(this.localStoragePath, key);
      const directory = join(filePath, '..');

      // Ensure directory exists
      await fs.mkdir(directory, { recursive: true });

      // Write file
      await fs.writeFile(filePath, file.buffer);

      // Write metadata
      if (metadata) {
        await fs.writeFile(
          `${filePath}.metadata.json`,
          JSON.stringify(metadata, null, 2),
        );
      }

      this.logger.log(`✅ File stored locally: ${key}`);

      return {
        key,
        bucket: this.bucketName,
        size: file.size,
      };
    } catch (error) {
      this.logger.error(`Error storing file locally: ${error.message}`);
      throw new Error(`Failed to store file: ${error.message}`);
    }
  }

  async uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<{ key: string; bucket: string }> {
    try {
      const filePath = join(this.localStoragePath, key);
      const directory = join(filePath, '..');

      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(filePath, buffer);

      if (metadata) {
        await fs.writeFile(
          `${filePath}.metadata.json`,
          JSON.stringify({ ...metadata, contentType }, null, 2),
        );
      }

      this.logger.log(`✅ Buffer stored locally: ${key}`);

      return {
        key,
        bucket: this.bucketName,
      };
    } catch (error) {
      this.logger.error(`Error storing buffer locally: ${error.message}`);
      throw new Error(`Failed to store buffer: ${error.message}`);
    }
  }

  async getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    // For local development, return a direct file path or local URL
    // In production, this would be a real signed URL
    const filePath = join(this.localStoragePath, key);
    
    // Check if file exists
    try {
      await fs.access(filePath);
      // Return a mock URL (in real app, you'd serve this via an endpoint)
      return `http://localhost:3000/api/documents/local-file/${encodeURIComponent(key)}?expires=${Date.now() + expiresIn * 1000}`;
    } catch {
      throw new Error(`File not found: ${key}`);
    }
  }

  async getFileStream(key: string): Promise<Readable> {
    try {
      const filePath = join(this.localStoragePath, key);
      const buffer = await fs.readFile(filePath);
      return Readable.from(buffer);
    } catch (error) {
      this.logger.error(`Error reading file: ${error.message}`);
      throw new Error(`Failed to read file: ${error.message}`);
    }
  }

  async getFileBuffer(key: string): Promise<Buffer> {
    try {
      const filePath = join(this.localStoragePath, key);
      return await fs.readFile(filePath);
    } catch (error) {
      this.logger.error(`Error reading file buffer: ${error.message}`);
      throw new Error(`Failed to read file buffer: ${error.message}`);
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      const filePath = join(this.localStoragePath, key);
      await fs.unlink(filePath);
      
      // Also delete metadata if exists
      try {
        await fs.unlink(`${filePath}.metadata.json`);
      } catch {
        // Metadata file might not exist
      }

      this.logger.log(`🗑️  File deleted: ${key}`);
    } catch (error) {
      this.logger.error(`Error deleting file: ${error.message}`);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      const filePath = join(this.localStoragePath, key);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getFileMetadata(key: string): Promise<{
    size: number;
    contentType: string;
    lastModified: Date;
    metadata?: Record<string, string>;
  }> {
    try {
      const filePath = join(this.localStoragePath, key);
      const stats = await fs.stat(filePath);

      let metadata: Record<string, string> | undefined;
      try {
        const metadataContent = await fs.readFile(`${filePath}.metadata.json`, 'utf-8');
        metadata = JSON.parse(metadataContent);
      } catch {
        // Metadata file doesn't exist
      }

      return {
        size: stats.size,
        contentType: metadata?.contentType || 'application/octet-stream',
        lastModified: stats.mtime,
        metadata,
      };
    } catch (error) {
      this.logger.error(`Error getting file metadata: ${error.message}`);
      throw new Error(`Failed to get file metadata: ${error.message}`);
    }
  }
}
