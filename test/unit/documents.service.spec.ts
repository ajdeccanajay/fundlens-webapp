/**
 * DocumentsService Unit Tests
 * 
 * Tests tenant isolation for document operations:
 * - Upload with tenant S3 prefix
 * - Upload creates private data_source
 * - List filters by tenant
 * - Get/Download verifies ownership
 * - Delete verifies ownership
 * - Cross-tenant access returns 404
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { Test, TestingModule } from '@nestjs/testing';
import { REQUEST } from '@nestjs/core';
import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from '../../src/documents/documents.service';
import { TenantAwareS3Service } from '../../src/tenant/tenant-aware-s3.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext, TENANT_CONTEXT_KEY } from '../../src/tenant/tenant-context';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let mockPrisma: any;
  let mockTenantS3Service: any;
  let mockRequest: any;

  const tenantAContext: TenantContext = {
    tenantId: 'tenant-a',
    tenantSlug: 'tenant-a',
    tenantTier: 'pro',
    userId: 'user-a-1',
    userEmail: 'user@tenant-a.com',
    userRole: 'analyst',
    permissions: {
      canCreateDeals: true,
      canDeleteDeals: false,
      canUploadDocuments: true,
      canManageUsers: false,
      canViewAuditLogs: false,
      canExportData: true,
      maxDeals: 50,
      maxUploadsGB: 10,
    },
  };

  const tenantBContext: TenantContext = {
    tenantId: 'tenant-b',
    tenantSlug: 'tenant-b',
    tenantTier: 'enterprise',
    userId: 'user-b-1',
    userEmail: 'user@tenant-b.com',
    userRole: 'admin',
    permissions: {
      canCreateDeals: true,
      canDeleteDeals: true,
      canUploadDocuments: true,
      canManageUsers: true,
      canViewAuditLogs: true,
      canExportData: true,
      maxDeals: -1,
      maxUploadsGB: -1,
    },
  };

  // Sample documents
  const tenantADocument = {
    id: 'doc-a-1',
    tenantId: 'tenant-a',
    ticker: 'AAPL',
    documentType: 'user_upload',
    fileType: 'pdf',
    title: 'Apple Analysis.pdf',
    s3Bucket: 'fundlens-data-lake',
    s3Key: 'tenants/tenant-a/uploads/doc-a-1/doc-a-1.pdf',
    fileSize: BigInt(12345),
    processed: true,
    metadata: { dataSourceId: 'ds-a-1' },
    uploadDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { chunks: 5 },
  };

  const tenantBDocument = {
    id: 'doc-b-1',
    tenantId: 'tenant-b',
    ticker: 'MSFT',
    documentType: 'user_upload',
    fileType: 'pdf',
    title: 'Microsoft Analysis.pdf',
    s3Bucket: 'fundlens-data-lake',
    s3Key: 'tenants/tenant-b/uploads/doc-b-1/doc-b-1.pdf',
    fileSize: BigInt(54321),
    processed: false,
    metadata: { dataSourceId: 'ds-b-1' },
    uploadDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { chunks: 3 },
  };

  beforeEach(async () => {
    mockRequest = {
      [TENANT_CONTEXT_KEY]: tenantAContext,
      ip: '192.168.1.1',
      headers: {
        'user-agent': 'test-agent',
      },
    };

    mockPrisma = {
      document: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
      },
      documentChunk: {
        findMany: jest.fn(),
        create: jest.fn(),
      },
      dataSource: {
        create: jest.fn(),
        delete: jest.fn(),
      },
    };

    mockTenantS3Service = {
      uploadTenantFile: jest.fn(),
      getTenantFileUrl: jest.fn(),
      deleteTenantFile: jest.fn(),
      downloadTenantFile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TenantAwareS3Service, useValue: mockTenantS3Service },
        { provide: REQUEST, useValue: mockRequest },
      ],
    }).compile();

    service = await module.resolve<DocumentsService>(DocumentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadDocument', () => {
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'report.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      buffer: Buffer.from('test content'),
      size: 12345,
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    it('should upload document with tenant S3 prefix (Req 4.1)', async () => {
      const expectedS3Key = 'tenants/tenant-a/uploads/mock-uuid/mock-uuid.pdf';
      mockTenantS3Service.uploadTenantFile.mockResolvedValue(expectedS3Key);
      mockPrisma.dataSource.create.mockResolvedValue({ id: 'ds-new' });
      mockPrisma.document.create.mockResolvedValue({
        id: 'doc-new',
        s3Key: expectedS3Key,
        tenantId: 'tenant-a',
      });

      const result = await service.uploadDocument(mockFile, {
        ticker: 'AAPL',
        documentType: 'user_upload',
        title: 'Test Report',
      });

      expect(mockTenantS3Service.uploadTenantFile).toHaveBeenCalledWith(
        expect.any(String), // documentId
        expect.stringMatching(/\.pdf$/), // filename with extension
        mockFile.buffer,
        expect.objectContaining({
          contentType: 'application/pdf',
        }),
      );
      expect(result.status).toBe('uploaded');
    });

    it('should create private data_source for uploaded document (Req 4.2)', async () => {
      mockTenantS3Service.uploadTenantFile.mockResolvedValue('tenants/tenant-a/uploads/doc/doc.pdf');
      mockPrisma.dataSource.create.mockResolvedValue({ id: 'ds-new' });
      mockPrisma.document.create.mockResolvedValue({
        id: 'doc-new',
        s3Key: 'tenants/tenant-a/uploads/doc/doc.pdf',
        tenantId: 'tenant-a',
      });

      await service.uploadDocument(mockFile, {
        ticker: 'AAPL',
        documentType: 'user_upload',
      });

      expect(mockPrisma.dataSource.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          visibility: 'private',
          ownerTenantId: 'tenant-a',
          type: 'upload',
        }),
      });
    });

    it('should create document record with tenant_id (Req 4.2)', async () => {
      mockTenantS3Service.uploadTenantFile.mockResolvedValue('tenants/tenant-a/uploads/doc/doc.pdf');
      mockPrisma.dataSource.create.mockResolvedValue({ id: 'ds-new' });
      mockPrisma.document.create.mockResolvedValue({
        id: 'doc-new',
        s3Key: 'tenants/tenant-a/uploads/doc/doc.pdf',
        tenantId: 'tenant-a',
      });

      await service.uploadDocument(mockFile, {
        ticker: 'AAPL',
        documentType: 'user_upload',
      });

      expect(mockPrisma.document.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-a',
        }),
      });
    });
  });

  describe('listDocuments', () => {
    it('should filter documents by tenant (Req 4.3)', async () => {
      mockPrisma.document.findMany.mockResolvedValue([tenantADocument]);
      mockPrisma.document.count.mockResolvedValue(1);

      await service.listDocuments({});

      expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-a',
          }),
        }),
      );
    });

    it('should not return other tenant documents', async () => {
      mockPrisma.document.findMany.mockResolvedValue([tenantADocument]);
      mockPrisma.document.count.mockResolvedValue(1);

      const result = await service.listDocuments({});

      // Should only contain tenant-a documents
      expect(result.documents.every((d: any) => d.tenantId === 'tenant-a')).toBe(true);
    });

    it('should apply additional filters with tenant filter', async () => {
      mockPrisma.document.findMany.mockResolvedValue([]);
      mockPrisma.document.count.mockResolvedValue(0);

      await service.listDocuments({
        ticker: 'AAPL',
        documentType: 'user_upload',
        processed: true,
      });

      expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-a',
            ticker: 'AAPL',
            documentType: 'user_upload',
            processed: true,
          }),
        }),
      );
    });
  });

  describe('getDocument', () => {
    it('should return document owned by tenant (Req 4.3)', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(tenantADocument);
      mockPrisma.documentChunk.findMany.mockResolvedValue([]);

      const result = await service.getDocument('doc-a-1');

      expect(result.id).toBe('doc-a-1');
      expect(mockPrisma.document.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'doc-a-1',
          tenantId: 'tenant-a',
        },
      });
    });

    it('should throw 404 for document owned by different tenant (Req 4.3)', async () => {
      // Document exists but belongs to tenant-b
      mockPrisma.document.findFirst.mockResolvedValue(null);

      await expect(service.getDocument('doc-b-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw 404 for non-existent document', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null);

      await expect(service.getDocument('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDownloadUrl', () => {
    it('should return download URL for owned document (Req 4.4)', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(tenantADocument);
      mockTenantS3Service.getTenantFileUrl.mockResolvedValue('https://signed-url.example.com');

      const url = await service.getDownloadUrl('doc-a-1');

      expect(url).toBe('https://signed-url.example.com');
      expect(mockTenantS3Service.getTenantFileUrl).toHaveBeenCalledWith(
        tenantADocument.s3Key,
        3600,
      );
    });

    it('should throw 404 for cross-tenant download attempt (Req 4.4)', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null);

      await expect(service.getDownloadUrl('doc-b-1')).rejects.toThrow(NotFoundException);
      expect(mockTenantS3Service.getTenantFileUrl).not.toHaveBeenCalled();
    });

    it('should use custom expiration time', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(tenantADocument);
      mockTenantS3Service.getTenantFileUrl.mockResolvedValue('https://signed-url.example.com');

      await service.getDownloadUrl('doc-a-1', 7200);

      expect(mockTenantS3Service.getTenantFileUrl).toHaveBeenCalledWith(
        tenantADocument.s3Key,
        7200,
      );
    });
  });

  describe('deleteDocument', () => {
    it('should delete owned document (Req 4.5)', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(tenantADocument);
      mockTenantS3Service.deleteTenantFile.mockResolvedValue(undefined);
      mockPrisma.dataSource.delete.mockResolvedValue({});
      mockPrisma.document.delete.mockResolvedValue({});

      await service.deleteDocument('doc-a-1');

      expect(mockTenantS3Service.deleteTenantFile).toHaveBeenCalledWith(tenantADocument.s3Key);
      expect(mockPrisma.document.delete).toHaveBeenCalledWith({
        where: { id: 'doc-a-1' },
      });
    });

    it('should throw 404 for cross-tenant delete attempt (Req 4.5)', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null);

      await expect(service.deleteDocument('doc-b-1')).rejects.toThrow(NotFoundException);
      expect(mockTenantS3Service.deleteTenantFile).not.toHaveBeenCalled();
      expect(mockPrisma.document.delete).not.toHaveBeenCalled();
    });

    it('should delete associated data_source', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(tenantADocument);
      mockTenantS3Service.deleteTenantFile.mockResolvedValue(undefined);
      mockPrisma.dataSource.delete.mockResolvedValue({});
      mockPrisma.document.delete.mockResolvedValue({});

      await service.deleteDocument('doc-a-1');

      expect(mockPrisma.dataSource.delete).toHaveBeenCalledWith({
        where: { id: 'ds-a-1' }, // From metadata.dataSourceId
      });
    });
  });

  describe('getFileBuffer', () => {
    it('should return file buffer for owned document', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(tenantADocument);
      mockTenantS3Service.downloadTenantFile.mockResolvedValue(Buffer.from('file content'));

      const buffer = await service.getFileBuffer('doc-a-1');

      expect(buffer.toString()).toBe('file content');
    });

    it('should throw 404 for cross-tenant file access', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null);

      await expect(service.getFileBuffer('doc-b-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDocumentChunks', () => {
    it('should return chunks for owned document', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(tenantADocument);
      mockPrisma.documentChunk.findMany.mockResolvedValue([
        { id: 'chunk-1', chunkIndex: 0, content: 'test' },
      ]);

      const chunks = await service.getDocumentChunks('doc-a-1');

      expect(chunks).toHaveLength(1);
    });

    it('should throw 404 for cross-tenant chunk access', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null);

      await expect(service.getDocumentChunks('doc-b-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDocumentStats', () => {
    it('should return stats for current tenant only', async () => {
      mockPrisma.document.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8)  // processed
        .mockResolvedValueOnce(2); // unprocessed
      mockPrisma.document.groupBy.mockResolvedValue([
        { documentType: 'user_upload', _count: 7 },
        { documentType: 'sec_filing', _count: 3 },
      ]);
      mockPrisma.document.aggregate.mockResolvedValue({
        _sum: { fileSize: BigInt(1000000) },
      });

      const stats = await service.getDocumentStats();

      expect(stats.totalDocuments).toBe(10);
      expect(stats.processedCount).toBe(8);
      expect(stats.unprocessedCount).toBe(2);
      
      // Verify tenant filter was applied
      expect(mockPrisma.document.count).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-a' },
      });
    });
  });

  describe('Cross-tenant attack prevention', () => {
    it('should prevent access to other tenant documents via getDocument', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null);

      await expect(service.getDocument('doc-b-1')).rejects.toThrow(NotFoundException);
    });

    it('should prevent access to other tenant documents via getDownloadUrl', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null);

      await expect(service.getDownloadUrl('doc-b-1')).rejects.toThrow(NotFoundException);
    });

    it('should prevent deletion of other tenant documents', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null);

      await expect(service.deleteDocument('doc-b-1')).rejects.toThrow(NotFoundException);
    });

    it('should prevent access to other tenant document chunks', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null);

      await expect(service.getDocumentChunks('doc-b-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('Default tenant fallback', () => {
    it('should use default tenant when no context is provided', async () => {
      // Create service without tenant context
      mockRequest[TENANT_CONTEXT_KEY] = undefined;
      
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DocumentsService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: TenantAwareS3Service, useValue: mockTenantS3Service },
          { provide: REQUEST, useValue: mockRequest },
        ],
      }).compile();

      const serviceWithoutContext = await module.resolve<DocumentsService>(DocumentsService);
      
      mockPrisma.document.findMany.mockResolvedValue([]);
      mockPrisma.document.count.mockResolvedValue(0);

      await serviceWithoutContext.listDocuments({});

      expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'default-tenant',
          }),
        }),
      );
    });
  });
});
