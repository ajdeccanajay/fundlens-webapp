/**
 * TenantAwareS3Service Unit Tests
 * 
 * Tests tenant isolation for S3 operations:
 * - Upload with tenant prefix enforcement
 * - Download/URL with ownership verification
 * - Delete with ownership verification
 * - Cross-tenant access prevention (returns 404)
 * - Public file access
 * - Security logging for denied access
 * 
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 */

import { Test, TestingModule } from '@nestjs/testing';
import { REQUEST } from '@nestjs/core';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { TenantAwareS3Service } from '../../src/tenant/tenant-aware-s3.service';
import { TenantContext, TENANT_CONTEXT_KEY } from '../../src/tenant/tenant-context';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  PutObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'PutObject' })),
  GetObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'GetObject' })),
  DeleteObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'DeleteObject' })),
  HeadObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'HeadObject' })),
  ListObjectsV2Command: jest.fn().mockImplementation((params) => ({ ...params, _type: 'ListObjects' })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed-url.example.com/file'),
}));

describe('TenantAwareS3Service', () => {
  let service: TenantAwareS3Service;
  let mockS3Send: jest.Mock;
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

  beforeEach(async () => {
    mockRequest = {
      [TENANT_CONTEXT_KEY]: tenantAContext,
      ip: '192.168.1.1',
      headers: {
        'user-agent': 'test-agent',
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantAwareS3Service,
        {
          provide: REQUEST,
          useValue: mockRequest,
        },
      ],
    }).compile();

    service = await module.resolve<TenantAwareS3Service>(TenantAwareS3Service);
    
    // Get the mock S3 client's send function
    const { S3Client } = require('@aws-sdk/client-s3');
    mockS3Send = S3Client.mock.results[S3Client.mock.results.length - 1].value.send;
    mockS3Send.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadTenantFile', () => {
    it('should upload file with correct tenant prefix (Req 11.1, 11.2)', async () => {
      mockS3Send.mockResolvedValueOnce({});

      const result = await service.uploadTenantFile(
        'doc-123',
        'report.pdf',
        Buffer.from('test content'),
        { contentType: 'application/pdf' },
      );

      expect(result).toBe('tenants/tenant-a/uploads/doc-123/report.pdf');
      expect(mockS3Send).toHaveBeenCalledTimes(1);
      
      const putCommand = mockS3Send.mock.calls[0][0];
      expect(putCommand.Key).toBe('tenants/tenant-a/uploads/doc-123/report.pdf');
      expect(putCommand.ContentType).toBe('application/pdf');
      expect(putCommand.Metadata.tenantId).toBe('tenant-a');
      expect(putCommand.Metadata.documentId).toBe('doc-123');
      expect(putCommand.Metadata.uploadedBy).toBe('user-a-1');
      expect(putCommand.Tagging).toContain('visibility=private');
      expect(putCommand.Tagging).toContain('tenant=tenant-a');
    });

    it('should include custom metadata in upload', async () => {
      mockS3Send.mockResolvedValueOnce({});

      await service.uploadTenantFile(
        'doc-456',
        'data.json',
        Buffer.from('{}'),
        {
          contentType: 'application/json',
          metadata: { customField: 'customValue' },
        },
      );

      const putCommand = mockS3Send.mock.calls[0][0];
      expect(putCommand.Metadata.customField).toBe('customValue');
    });

    it('should use default content type when not specified', async () => {
      mockS3Send.mockResolvedValueOnce({});

      await service.uploadTenantFile('doc-789', 'unknown.bin', Buffer.from('data'));

      const putCommand = mockS3Send.mock.calls[0][0];
      expect(putCommand.ContentType).toBe('application/octet-stream');
    });
  });

  describe('getTenantFileUrl', () => {
    it('should return signed URL for tenant-owned file (Req 11.3)', async () => {
      mockS3Send.mockResolvedValueOnce({}); // HeadObject success

      const url = await service.getTenantFileUrl('tenants/tenant-a/uploads/doc-123/file.pdf');

      expect(url).toBe('https://signed-url.example.com/file');
      expect(mockS3Send).toHaveBeenCalledTimes(1);
    });

    it('should throw 404 for cross-tenant file access (Req 11.3, 11.6)', async () => {
      // Attempt to access tenant-b's file as tenant-a
      await expect(
        service.getTenantFileUrl('tenants/tenant-b/uploads/doc-456/secret.pdf'),
      ).rejects.toThrow(NotFoundException);

      // S3 should NOT be called - blocked before reaching S3
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('should throw 404 for non-existent file', async () => {
      const notFoundError = new Error('Not Found');
      notFoundError.name = 'NotFound';
      mockS3Send.mockRejectedValueOnce(notFoundError);

      await expect(
        service.getTenantFileUrl('tenants/tenant-a/uploads/doc-999/missing.pdf'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should use custom expiration time', async () => {
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      mockS3Send.mockResolvedValueOnce({});

      await service.getTenantFileUrl('tenants/tenant-a/uploads/doc-123/file.pdf', 7200);

      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 7200 },
      );
    });
  });

  describe('deleteTenantFile', () => {
    it('should delete tenant-owned file (Req 11.4)', async () => {
      mockS3Send
        .mockResolvedValueOnce({}) // HeadObject success
        .mockResolvedValueOnce({}); // DeleteObject success

      await service.deleteTenantFile('tenants/tenant-a/uploads/doc-123/file.pdf');

      expect(mockS3Send).toHaveBeenCalledTimes(2);
      const deleteCommand = mockS3Send.mock.calls[1][0];
      expect(deleteCommand._type).toBe('DeleteObject');
      expect(deleteCommand.Key).toBe('tenants/tenant-a/uploads/doc-123/file.pdf');
    });

    it('should throw 404 for cross-tenant delete attempt (Req 11.4, 11.6)', async () => {
      await expect(
        service.deleteTenantFile('tenants/tenant-b/uploads/doc-456/secret.pdf'),
      ).rejects.toThrow(NotFoundException);

      // S3 should NOT be called
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('should throw 404 for non-existent file', async () => {
      const notFoundError = new Error('Not Found');
      notFoundError.name = 'NotFound';
      mockS3Send.mockRejectedValueOnce(notFoundError);

      await expect(
        service.deleteTenantFile('tenants/tenant-a/uploads/doc-999/missing.pdf'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPublicFileUrl', () => {
    it('should return signed URL for public SEC file (Req 11.5)', async () => {
      mockS3Send.mockResolvedValueOnce({}); // HeadObject success

      const url = await service.getPublicFileUrl('public/sec-filings/AAPL/10-K/2024/filing.xml');

      expect(url).toBe('https://signed-url.example.com/file');
    });

    it('should throw ForbiddenException for non-public file', async () => {
      await expect(
        service.getPublicFileUrl('tenants/tenant-a/uploads/doc-123/file.pdf'),
      ).rejects.toThrow(ForbiddenException);

      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('should throw 404 for non-existent public file', async () => {
      const notFoundError = new Error('Not Found');
      notFoundError.name = 'NotFound';
      mockS3Send.mockRejectedValueOnce(notFoundError);

      await expect(
        service.getPublicFileUrl('public/sec-filings/INVALID/10-K/2024/filing.xml'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listTenantFiles', () => {
    it('should list only tenant-owned files', async () => {
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'tenants/tenant-a/uploads/doc-1/file1.pdf', Size: 1000 },
          { Key: 'tenants/tenant-a/uploads/doc-2/file2.pdf', Size: 2000 },
        ],
      });

      const files = await service.listTenantFiles();

      expect(files).toHaveLength(2);
      expect(files[0].key).toBe('tenants/tenant-a/uploads/doc-1/file1.pdf');
      
      const listCommand = mockS3Send.mock.calls[0][0];
      expect(listCommand.Prefix).toBe('tenants/tenant-a/uploads/');
    });

    it('should support prefix filtering within tenant directory', async () => {
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'tenants/tenant-a/uploads/reports/q1.pdf', Size: 1000 },
        ],
      });

      await service.listTenantFiles('reports');

      const listCommand = mockS3Send.mock.calls[0][0];
      expect(listCommand.Prefix).toBe('tenants/tenant-a/uploads/reports');
    });

    it('should return empty array on error', async () => {
      mockS3Send.mockRejectedValueOnce(new Error('S3 error'));

      const files = await service.listTenantFiles();

      expect(files).toEqual([]);
    });
  });

  describe('tenantFileExists', () => {
    it('should return true for existing tenant file', async () => {
      mockS3Send.mockResolvedValueOnce({});

      const exists = await service.tenantFileExists('tenants/tenant-a/uploads/doc-123/file.pdf');

      expect(exists).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      mockS3Send.mockRejectedValueOnce(new Error('Not Found'));

      const exists = await service.tenantFileExists('tenants/tenant-a/uploads/doc-999/missing.pdf');

      expect(exists).toBe(false);
    });

    it('should return false for cross-tenant file (without calling S3)', async () => {
      const exists = await service.tenantFileExists('tenants/tenant-b/uploads/doc-456/file.pdf');

      expect(exists).toBe(false);
      expect(mockS3Send).not.toHaveBeenCalled();
    });
  });

  describe('downloadTenantFile', () => {
    it('should download tenant-owned file', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('test ');
          yield Buffer.from('content');
        },
      };
      mockS3Send.mockResolvedValueOnce({ Body: mockStream });

      const content = await service.downloadTenantFile('tenants/tenant-a/uploads/doc-123/file.txt');

      expect(content.toString()).toBe('test content');
    });

    it('should throw 404 for cross-tenant download attempt', async () => {
      await expect(
        service.downloadTenantFile('tenants/tenant-b/uploads/doc-456/secret.pdf'),
      ).rejects.toThrow(NotFoundException);

      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('should throw 404 when file body is empty', async () => {
      mockS3Send.mockResolvedValueOnce({ Body: null });

      await expect(
        service.downloadTenantFile('tenants/tenant-a/uploads/doc-123/empty.txt'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getTenantFileInfo', () => {
    it('should return file info for tenant-owned file', async () => {
      mockS3Send.mockResolvedValueOnce({
        ContentLength: 12345,
        LastModified: new Date('2024-01-15'),
        ContentType: 'application/pdf',
        Metadata: { customField: 'value' },
      });

      const info = await service.getTenantFileInfo('tenants/tenant-a/uploads/doc-123/file.pdf');

      expect(info.key).toBe('tenants/tenant-a/uploads/doc-123/file.pdf');
      expect(info.size).toBe(12345);
      expect(info.contentType).toBe('application/pdf');
      expect(info.metadata?.customField).toBe('value');
    });

    it('should throw 404 for cross-tenant info access', async () => {
      await expect(
        service.getTenantFileInfo('tenants/tenant-b/uploads/doc-456/secret.pdf'),
      ).rejects.toThrow(NotFoundException);

      expect(mockS3Send).not.toHaveBeenCalled();
    });
  });

  describe('Cross-tenant attack prevention', () => {
    it('should prevent path traversal attacks', async () => {
      // Attempt to access tenant-b via path traversal
      await expect(
        service.getTenantFileUrl('tenants/tenant-a/../tenant-b/uploads/doc-456/secret.pdf'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should prevent access to root-level files', async () => {
      await expect(
        service.getTenantFileUrl('sensitive-config.json'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should prevent access to other tenant prefixes', async () => {
      const otherTenantPaths = [
        'tenants/tenant-b/uploads/doc-1/file.pdf',
        'tenants/tenant-c/uploads/doc-2/file.pdf',
        'tenants/admin/uploads/doc-3/file.pdf',
      ];

      for (const path of otherTenantPaths) {
        await expect(service.getTenantFileUrl(path)).rejects.toThrow(NotFoundException);
        await expect(service.deleteTenantFile(path)).rejects.toThrow(NotFoundException);
        await expect(service.downloadTenantFile(path)).rejects.toThrow(NotFoundException);
        await expect(service.getTenantFileInfo(path)).rejects.toThrow(NotFoundException);
      }
    });
  });

  describe('Default tenant fallback', () => {
    it('should use default tenant when no context is provided', async () => {
      // Create service without tenant context
      mockRequest[TENANT_CONTEXT_KEY] = undefined;
      
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TenantAwareS3Service,
          {
            provide: REQUEST,
            useValue: mockRequest,
          },
        ],
      }).compile();

      const serviceWithoutContext = await module.resolve<TenantAwareS3Service>(TenantAwareS3Service);
      
      // Get fresh mock
      const { S3Client } = require('@aws-sdk/client-s3');
      const freshMockSend = S3Client.mock.results[S3Client.mock.results.length - 1].value.send;
      freshMockSend.mockResolvedValueOnce({});

      const result = await serviceWithoutContext.uploadTenantFile(
        'doc-123',
        'file.pdf',
        Buffer.from('content'),
      );

      expect(result).toBe('tenants/default-tenant/uploads/doc-123/file.pdf');
    });
  });
});
