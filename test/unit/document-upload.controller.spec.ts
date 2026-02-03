import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DocumentUploadController } from '../../src/documents/document-upload.controller';
import { DocumentProcessingService } from '../../src/documents/document-processing.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DocumentUploadController', () => {
  let controller: DocumentUploadController;
  let processingService: jest.Mocked<DocumentProcessingService>;
  let prismaService: jest.Mocked<PrismaService>;

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'test.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('test'),
    stream: null,
    destination: '',
    filename: '',
    path: '',
  };

  const mockDocument = {
    id: 'doc-123',
    tenantId: 'tenant-123',
    ticker: 'AAPL',
    title: 'test.pdf',
    fileType: 'pdf',
    documentType: 'user_upload',
    sourceType: 'USER_UPLOAD',
    s3Bucket: 'test-bucket',
    s3Key: 'test-key',
    fileSize: BigInt(1024),
    processed: false,
    processingError: null,
    createdBy: 'user-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    uploadDate: new Date(),
    sourceUrl: null,
    metadata: null,
  };

  const mockTenant = {
    id: 'tenant-123',
    name: 'Test Tenant',
    slug: 'test-tenant',
    tier: 'free',
    status: 'active',
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentUploadController],
      providers: [
        {
          provide: DocumentProcessingService,
          useValue: {
            processDocument: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            tenant: {
              findUnique: jest.fn(),
            },
            document: {
              count: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    controller = module.get<DocumentUploadController>(
      DocumentUploadController,
    );
    processingService = module.get(
      DocumentProcessingService,
    ) as jest.Mocked<DocumentProcessingService>;
    prismaService = module.get(PrismaService) as jest.Mocked<PrismaService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadDocument', () => {
    it('should upload document successfully', async () => {
      prismaService.tenant.findUnique.mockResolvedValue(mockTenant as any);
      prismaService.document.count.mockResolvedValue(5);
      processingService.processDocument.mockResolvedValue(mockDocument as any);

      const result = await controller.uploadDocument(mockFile, {
        tenantId: 'tenant-123',
        ticker: 'AAPL',
        extractionTier: 'basic',
        userId: 'user-123',
      });

      expect(result).toEqual({
        documentId: 'doc-123',
        status: 'processing',
        message: 'Document uploaded successfully',
        extractionTier: 'basic',
      });

      expect(processingService.processDocument).toHaveBeenCalledWith({
        file: mockFile,
        tenantId: 'tenant-123',
        ticker: 'AAPL',
        extractionTier: 'basic',
        userId: 'user-123',
      });
    });

    it('should throw error if no file uploaded', async () => {
      await expect(
        controller.uploadDocument(null, {
          tenantId: 'tenant-123',
          ticker: 'AAPL',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw error if tenantId missing', async () => {
      await expect(
        controller.uploadDocument(mockFile, {
          tenantId: '',
          ticker: 'AAPL',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw error if ticker missing', async () => {
      await expect(
        controller.uploadDocument(mockFile, {
          tenantId: 'tenant-123',
          ticker: '',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw error if tenant not found', async () => {
      prismaService.tenant.findUnique.mockResolvedValue(null);

      await expect(
        controller.uploadDocument(mockFile, {
          tenantId: 'invalid-tenant',
          ticker: 'AAPL',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw error if document limit reached', async () => {
      prismaService.tenant.findUnique.mockResolvedValue(mockTenant as any);
      prismaService.document.count.mockResolvedValue(25);

      await expect(
        controller.uploadDocument(mockFile, {
          tenantId: 'tenant-123',
          ticker: 'AAPL',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(processingService.processDocument).not.toHaveBeenCalled();
    });

    it('should default to basic extraction tier', async () => {
      prismaService.tenant.findUnique.mockResolvedValue(mockTenant as any);
      prismaService.document.count.mockResolvedValue(5);
      processingService.processDocument.mockResolvedValue(mockDocument as any);

      const result = await controller.uploadDocument(mockFile, {
        tenantId: 'tenant-123',
        ticker: 'AAPL',
      });

      expect(result.extractionTier).toBe('basic');
      expect(processingService.processDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          extractionTier: 'basic',
        }),
      );
    });
  });

  describe('listDocuments', () => {
    const mockDocuments = [
      {
        ...mockDocument,
        processed: true,
        processingError: null,
      },
      {
        ...mockDocument,
        id: 'doc-456',
        processed: false,
        processingError: null,
      },
    ];

    it('should list documents for tenant', async () => {
      prismaService.document.findMany.mockResolvedValue(mockDocuments as any);

      const result = await controller.listDocuments('tenant-123');

      expect(result.documents).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.documents[0].status).toBe('indexed');
      expect(result.documents[1].status).toBe('processing');
    });

    it('should filter by ticker', async () => {
      prismaService.document.findMany.mockResolvedValue([mockDocuments[0]] as any);

      const result = await controller.listDocuments('tenant-123', 'AAPL');

      expect(prismaService.document.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-123',
          sourceType: 'USER_UPLOAD',
          ticker: 'AAPL',
        },
        orderBy: { createdAt: 'desc' },
        select: expect.any(Object),
      });

      expect(result.documents).toHaveLength(1);
    });

    it('should throw error if tenantId missing', async () => {
      await expect(controller.listDocuments('')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should handle failed documents', async () => {
      const failedDoc = {
        ...mockDocument,
        processed: true,
        processingError: 'Extraction failed',
      };

      prismaService.document.findMany.mockResolvedValue([failedDoc] as any);

      const result = await controller.listDocuments('tenant-123');

      expect(result.documents[0].status).toBe('failed');
    });
  });

  describe('getDocument', () => {
    it('should get document by id', async () => {
      const docWithChunks = {
        ...mockDocument,
        processed: true,
        chunks: [
          { id: 'chunk-1', chunkIndex: 0, pageNumber: 1, tokenCount: 100 },
          { id: 'chunk-2', chunkIndex: 1, pageNumber: 1, tokenCount: 100 },
        ],
      };

      prismaService.document.findUnique.mockResolvedValue(docWithChunks as any);

      const result = await controller.getDocument('doc-123');

      expect(result.id).toBe('doc-123');
      expect(result.status).toBe('indexed');
      expect(result.chunkCount).toBe(2);
    });

    it('should throw error if document not found', async () => {
      prismaService.document.findUnique.mockResolvedValue(null);

      await expect(controller.getDocument('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getDocumentStatus', () => {
    it('should get document status', async () => {
      const docStatus = {
        id: 'doc-123',
        processed: true,
        processingError: null,
        _count: { chunks: 5 },
      };

      prismaService.document.findUnique.mockResolvedValue(docStatus as any);

      const result = await controller.getDocumentStatus('doc-123');

      expect(result).toEqual({
        documentId: 'doc-123',
        status: 'indexed',
        error: null,
        chunkCount: 5,
      });
    });

    it('should return processing status', async () => {
      const docStatus = {
        id: 'doc-123',
        processed: false,
        processingError: null,
        _count: { chunks: 0 },
      };

      prismaService.document.findUnique.mockResolvedValue(docStatus as any);

      const result = await controller.getDocumentStatus('doc-123');

      expect(result.status).toBe('processing');
    });

    it('should return failed status with error', async () => {
      const docStatus = {
        id: 'doc-123',
        processed: true,
        processingError: 'Extraction failed',
        _count: { chunks: 0 },
      };

      prismaService.document.findUnique.mockResolvedValue(docStatus as any);

      const result = await controller.getDocumentStatus('doc-123');

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Extraction failed');
    });

    it('should throw error if document not found', async () => {
      prismaService.document.findUnique.mockResolvedValue(null);

      await expect(
        controller.getDocumentStatus('invalid-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteDocument', () => {
    it('should delete document', async () => {
      prismaService.document.findUnique.mockResolvedValue(mockDocument as any);
      prismaService.document.delete.mockResolvedValue(mockDocument as any);

      const result = await controller.deleteDocument('doc-123');

      expect(result).toEqual({
        message: 'Document deleted successfully',
        documentId: 'doc-123',
      });

      expect(prismaService.document.delete).toHaveBeenCalledWith({
        where: { id: 'doc-123' },
      });
    });

    it('should throw error if document not found', async () => {
      prismaService.document.findUnique.mockResolvedValue(null);

      await expect(controller.deleteDocument('invalid-id')).rejects.toThrow(
        NotFoundException,
      );

      expect(prismaService.document.delete).not.toHaveBeenCalled();
    });
  });
});
