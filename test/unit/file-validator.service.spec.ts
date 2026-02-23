/**
 * Unit Tests for FileValidator Service
 * 
 * Tests batch and file validation logic
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

import { Test, TestingModule } from '@nestjs/testing';
import {
  FileValidatorService,
  MAX_FILES_PER_BATCH,
  MAX_FILE_SIZE_BYTES,
  MAX_BATCH_SIZE_BYTES,
} from '../../src/instant-rag/file-validator.service';

describe('FileValidatorService', () => {
  let service: FileValidatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FileValidatorService],
    }).compile();

    service = module.get<FileValidatorService>(FileValidatorService);
  });

  const createMockFile = (
    name: string,
    size: number,
    mimetype: string = 'application/pdf',
  ): Express.Multer.File => ({
    buffer: Buffer.alloc(size),
    originalname: name,
    mimetype,
    size,
    fieldname: 'files',
    encoding: '7bit',
    destination: '',
    filename: name,
    path: '',
    stream: null as any,
  });

  describe('validateBatch', () => {
    describe('file count validation', () => {
      it('should accept batch with 5 files', () => {
        const files = Array(5).fill(null).map((_, i) => 
          createMockFile(`file${i}.pdf`, 1024)
        );

        const result = service.validateBatch(files);

        expect(result.valid).toBe(true);
        expect(result.validFiles).toHaveLength(5);
        expect(result.batchError).toBeUndefined();
      });

      it('should reject batch with more than 5 files', () => {
        const files = Array(6).fill(null).map((_, i) => 
          createMockFile(`file${i}.pdf`, 1024)
        );

        const result = service.validateBatch(files);

        expect(result.valid).toBe(false);
        expect(result.batchError?.errorCode).toBe('BATCH_SIZE_EXCEEDED');
        expect(result.batchError?.message).toContain('5');
      });

      it('should accept empty batch', () => {
        const result = service.validateBatch([]);

        expect(result.valid).toBe(false); // No valid files
        expect(result.validFiles).toHaveLength(0);
      });
    });

    describe('total size validation', () => {
      it('should accept batch under 150MB total', () => {
        const files = [
          createMockFile('file1.pdf', 40 * 1024 * 1024), // 40MB
          createMockFile('file2.pdf', 40 * 1024 * 1024), // 40MB
          createMockFile('file3.pdf', 40 * 1024 * 1024), // 40MB
        ];

        const result = service.validateBatch(files);

        expect(result.valid).toBe(true);
        expect(result.batchError).toBeUndefined();
      });

      it('should reject batch over 150MB total', () => {
        const files = [
          createMockFile('file1.pdf', 50 * 1024 * 1024), // 50MB
          createMockFile('file2.pdf', 50 * 1024 * 1024), // 50MB
          createMockFile('file3.pdf', 51 * 1024 * 1024), // 51MB = 151MB total
        ];

        const result = service.validateBatch(files);

        expect(result.valid).toBe(false);
        expect(result.batchError?.errorCode).toBe('BATCH_TOO_LARGE');
      });

      it('should calculate total size correctly', () => {
        const files = [
          createMockFile('file1.pdf', 1000),
          createMockFile('file2.pdf', 2000),
          createMockFile('file3.pdf', 3000),
        ];

        const result = service.validateBatch(files);

        expect(result.totalSize).toBe(6000);
      });
    });

    describe('individual file validation', () => {
      it('should reject files over 50MB', () => {
        const files = [
          createMockFile('small.pdf', 1024),
          createMockFile('large.pdf', 51 * 1024 * 1024), // 51MB
        ];

        const result = service.validateBatch(files);

        expect(result.valid).toBe(true); // Partial success
        expect(result.validFiles).toHaveLength(1);
        expect(result.invalidFiles).toHaveLength(1);
        expect(result.invalidFiles[0].errorCode).toBe('FILE_TOO_LARGE');
      });

      it('should reject unsupported file types', () => {
        const files = [
          createMockFile('doc.pdf', 1024),
          createMockFile('script.exe', 1024, 'application/octet-stream'),
        ];

        const result = service.validateBatch(files);

        expect(result.valid).toBe(true); // Partial success
        expect(result.validFiles).toHaveLength(1);
        expect(result.invalidFiles).toHaveLength(1);
        expect(result.invalidFiles[0].errorCode).toBe('UNSUPPORTED_FILE_TYPE');
      });

      it('should accept all supported file types', () => {
        const files = [
          createMockFile('doc.pdf', 1024, 'application/pdf'),
          createMockFile('doc.docx', 1024, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
          createMockFile('sheet.xlsx', 1024, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
          createMockFile('data.csv', 1024, 'text/csv'),
          createMockFile('notes.txt', 1024, 'text/plain'),
        ];

        const result = service.validateBatch(files);

        expect(result.valid).toBe(true);
        expect(result.validFiles).toHaveLength(5);
        expect(result.invalidFiles).toHaveLength(0);
      });
    });

    describe('partial success', () => {
      it('should return valid=true when some files pass', () => {
        const files = [
          createMockFile('good.pdf', 1024),
          createMockFile('bad.exe', 1024, 'application/octet-stream'),
          createMockFile('toolarge.pdf', 60 * 1024 * 1024),
        ];

        const result = service.validateBatch(files);

        expect(result.valid).toBe(true);
        expect(result.validFiles).toHaveLength(1);
        expect(result.invalidFiles).toHaveLength(2);
      });

      it('should return valid=false when all files fail', () => {
        const files = [
          createMockFile('bad1.exe', 1024, 'application/octet-stream'),
          createMockFile('bad2.zip', 1024, 'application/zip'),
        ];

        const result = service.validateBatch(files);

        expect(result.valid).toBe(false);
        expect(result.validFiles).toHaveLength(0);
        expect(result.invalidFiles).toHaveLength(2);
      });
    });
  });

  describe('validateFile', () => {
    it('should return null for valid file', () => {
      const file = createMockFile('doc.pdf', 1024);

      const error = service.validateFile(file);

      expect(error).toBeNull();
    });

    it('should return error for oversized file', () => {
      const file = createMockFile('large.pdf', MAX_FILE_SIZE_BYTES + 1);

      const error = service.validateFile(file);

      expect(error).not.toBeNull();
      expect(error?.errorCode).toBe('FILE_TOO_LARGE');
    });

    it('should return error for unsupported type', () => {
      const file = createMockFile('script.exe', 1024, 'application/octet-stream');

      const error = service.validateFile(file);

      expect(error).not.toBeNull();
      expect(error?.errorCode).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('should accept file at exactly 50MB', () => {
      const file = createMockFile('exact.pdf', MAX_FILE_SIZE_BYTES);

      const error = service.validateFile(file);

      expect(error).toBeNull();
    });
  });

  describe('getFileType', () => {
    it('should detect type from MIME', () => {
      expect(service.getFileType('application/pdf', 'doc.pdf')).toBe('pdf');
      expect(service.getFileType('image/png', 'img.png')).toBe('png');
      expect(service.getFileType('image/jpeg', 'img.jpg')).toBe('jpg');
    });

    it('should fall back to extension', () => {
      expect(service.getFileType('application/octet-stream', 'doc.pdf')).toBe('pdf');
      expect(service.getFileType('application/octet-stream', 'sheet.xlsx')).toBe('xlsx');
    });

    it('should normalize jpeg to jpg', () => {
      expect(service.getFileType('application/octet-stream', 'photo.jpeg')).toBe('jpg');
    });
  });

  describe('formatSize', () => {
    it('should format bytes', () => {
      expect(service.formatSize(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(service.formatSize(1024)).toBe('1.0 KB');
      expect(service.formatSize(2048)).toBe('2.0 KB');
    });

    it('should format megabytes', () => {
      expect(service.formatSize(1024 * 1024)).toBe('1.0 MB');
      expect(service.formatSize(50 * 1024 * 1024)).toBe('50.0 MB');
    });
  });

  describe('helper methods', () => {
    it('hasValidFiles should return true when valid files exist', () => {
      const result = service.validateBatch([createMockFile('doc.pdf', 1024)]);
      expect(service.hasValidFiles(result)).toBe(true);
    });

    it('hasValidFiles should return false when no valid files', () => {
      const result = service.validateBatch([createMockFile('bad.exe', 1024, 'application/octet-stream')]);
      expect(service.hasValidFiles(result)).toBe(false);
    });

    it('hasErrors should return true when errors exist', () => {
      const result = service.validateBatch([createMockFile('bad.exe', 1024, 'application/octet-stream')]);
      expect(service.hasErrors(result)).toBe(true);
    });

    it('hasErrors should return false when no errors', () => {
      const result = service.validateBatch([createMockFile('doc.pdf', 1024)]);
      expect(service.hasErrors(result)).toBe(false);
    });

    it('getSummary should describe batch error', () => {
      const files = Array(6).fill(null).map((_, i) => createMockFile(`file${i}.pdf`, 1024));
      const result = service.validateBatch(files);
      expect(service.getSummary(result)).toContain('5');
    });

    it('getSummary should describe partial success', () => {
      const files = [
        createMockFile('good.pdf', 1024),
        createMockFile('bad.exe', 1024, 'application/octet-stream'),
      ];
      const result = service.validateBatch(files);
      expect(service.getSummary(result)).toContain('1 of 2');
    });
  });
});
