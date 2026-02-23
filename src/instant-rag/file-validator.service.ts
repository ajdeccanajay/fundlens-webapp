/**
 * File Validator Service for Instant RAG
 * 
 * Validates batch uploads against constraints:
 * - Max 5 files per batch
 * - Max 50MB per file
 * - Max 150MB total batch size
 * - Supported file types only
 * 
 * Supports partial success with detailed error reporting
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

import { Injectable, Logger } from '@nestjs/common';
import { SUPPORTED_FILE_TYPES } from './document-processor.service';

// Validation limits
export const MAX_FILES_PER_BATCH = 5;
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_BATCH_SIZE_BYTES = 150 * 1024 * 1024; // 150MB

export interface FileValidationError {
  fileName: string;
  errorCode: 'FILE_TOO_LARGE' | 'UNSUPPORTED_FILE_TYPE' | 'PROTECTED_FILE' | 'ENCRYPTED_FILE';
  message: string;
}

export interface BatchValidationError {
  errorCode: 'BATCH_SIZE_EXCEEDED' | 'BATCH_TOO_LARGE';
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  validFiles: Express.Multer.File[];
  invalidFiles: FileValidationError[];
  batchError?: BatchValidationError;
  totalSize: number;
  fileCount: number;
}

// MIME type mappings for validation
const MIME_TO_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

@Injectable()
export class FileValidatorService {
  private readonly logger = new Logger(FileValidatorService.name);

  /**
   * Validate a batch of files
   * Returns validation result with valid files and errors
   */
  validateBatch(files: Express.Multer.File[]): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      validFiles: [],
      invalidFiles: [],
      totalSize: 0,
      fileCount: files.length,
    };

    // Check batch file count
    if (files.length > MAX_FILES_PER_BATCH) {
      result.valid = false;
      result.batchError = {
        errorCode: 'BATCH_SIZE_EXCEEDED',
        message: `Maximum ${MAX_FILES_PER_BATCH} files per upload. Received ${files.length} files.`,
      };
      this.logger.warn(`Batch rejected: ${files.length} files exceeds limit of ${MAX_FILES_PER_BATCH}`);
      return result;
    }

    // Calculate total size first
    result.totalSize = files.reduce((sum, file) => sum + file.size, 0);

    // Check total batch size
    if (result.totalSize > MAX_BATCH_SIZE_BYTES) {
      result.valid = false;
      result.batchError = {
        errorCode: 'BATCH_TOO_LARGE',
        message: `Total upload size ${this.formatSize(result.totalSize)} exceeds limit of ${this.formatSize(MAX_BATCH_SIZE_BYTES)}.`,
      };
      this.logger.warn(`Batch rejected: ${this.formatSize(result.totalSize)} exceeds limit of ${this.formatSize(MAX_BATCH_SIZE_BYTES)}`);
      return result;
    }

    // Validate each file
    for (const file of files) {
      const fileError = this.validateFile(file);
      if (fileError) {
        result.invalidFiles.push(fileError);
      } else {
        result.validFiles.push(file);
      }
    }

    // Batch is valid if at least one file is valid and no batch-level errors
    result.valid = result.validFiles.length > 0 && !result.batchError;

    this.logger.log(
      `Batch validation: ${result.validFiles.length} valid, ${result.invalidFiles.length} invalid, total ${this.formatSize(result.totalSize)}`,
    );

    return result;
  }

  /**
   * Validate a single file
   * Returns error if invalid, null if valid
   */
  validateFile(file: Express.Multer.File): FileValidationError | null {
    // Check file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return {
        fileName: file.originalname,
        errorCode: 'FILE_TOO_LARGE',
        message: `File size ${this.formatSize(file.size)} exceeds limit of ${this.formatSize(MAX_FILE_SIZE_BYTES)}.`,
      };
    }

    // Check file type
    const fileType = this.getFileType(file.mimetype, file.originalname);
    if (!SUPPORTED_FILE_TYPES.includes(fileType)) {
      return {
        fileName: file.originalname,
        errorCode: 'UNSUPPORTED_FILE_TYPE',
        message: `File type '${fileType}' is not supported. Supported types: ${SUPPORTED_FILE_TYPES.join(', ')}.`,
      };
    }

    return null;
  }

  /**
   * Get file type from MIME type or extension
   */
  getFileType(mimeType: string, fileName: string): string {
    // Try MIME type first
    if (MIME_TO_TYPE[mimeType]) {
      return MIME_TO_TYPE[mimeType];
    }

    // Fall back to extension
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext && SUPPORTED_FILE_TYPES.includes(ext)) {
      // Normalize jpeg to jpg
      return ext === 'jpeg' ? 'jpg' : ext;
    }

    return ext || 'unknown';
  }

  /**
   * Format file size for display
   */
  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Check if batch has any valid files (partial success)
   */
  hasValidFiles(result: ValidationResult): boolean {
    return result.validFiles.length > 0;
  }

  /**
   * Check if batch has any errors
   */
  hasErrors(result: ValidationResult): boolean {
    return result.invalidFiles.length > 0 || !!result.batchError;
  }

  /**
   * Get summary of validation result
   */
  getSummary(result: ValidationResult): string {
    if (result.batchError) {
      return result.batchError.message;
    }

    if (result.invalidFiles.length === 0) {
      return `All ${result.validFiles.length} files validated successfully.`;
    }

    if (result.validFiles.length === 0) {
      return `All ${result.invalidFiles.length} files failed validation.`;
    }

    return `${result.validFiles.length} of ${result.fileCount} files validated. ${result.invalidFiles.length} files failed.`;
  }
}
